"use strict";

/**
 * core/disk-monitor.js
 *
 * Sınırlı disk (2 GB) ortamlar için disk gözcüsü.
 * 400+ grup yükünde ana disk dolma kaynakları:
 *   1. SQLite WAL dosyası (database.sqlite-wal) — yoğun yazımda hızlı büyür
 *   2. /tmp ve ./temp altındaki medya işlem artıkları (ffmpeg, sharp)
 *   3. Logs dizini (pm2-error.log, pm2-out.log)
 *   4. Eski "sessions/*_migrated_*" yedekleri
 *   5. AI tarafından üretilmiş eklenti/medya artıkları
 *
 * Bu modül:
 *   • Kritik dizinlerin toplam boyutunu sayar (du benzeri)
 *   • %75 (1.5 GB) eşiğinde proaktif temizlik yapar (eski temp + log truncate)
 *   • %88 (1.76 GB) eşiğinde acil temizlik + WAL checkpoint(TRUNCATE) yapar
 *   • %95 üzerinde sürecin temiz şekilde yeniden başlamasını ister
 *
 * Tasarım kuralı: hata olursa sessizce yut. Disk gözcüsü asla
 * botu çökerten bir hata fırlatmamalıdır.
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { logger } = require("../config");

// ── Sabitler ──────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, "..");
const TARGETS = {
  tempOs: "/tmp",
  tempApp: path.join(ROOT, "temp"),
  uploads: path.join(ROOT, "uploads"),
  downloads: path.join(ROOT, "downloads"),
  sessions: path.join(ROOT, "sessions"),
  logs: path.join(ROOT, "logs"),
  aiPlugins: path.join(ROOT, "plugins", "ai-generated"),
  sqliteFile: path.join(ROOT, "database.sqlite"),
  sqliteWal: path.join(ROOT, "database.sqlite-wal"),
  sqliteShm: path.join(ROOT, "database.sqlite-shm"),
};

// 2 GB diskte güvenli bütçe
const DISK_BUDGET_BYTES = parseInt(process.env.DISK_BUDGET_BYTES || String(2 * 1024 * 1024 * 1024), 10);
const SOFT_THRESHOLD = 0.75; // proaktif temizlik
const HARD_THRESHOLD = 0.88; // acil temizlik
const PANIC_THRESHOLD = 0.95; // restart isteği

const TEMP_FILE_AGE_SOFT = 20 * 60 * 1000;   // 20 dakika
const TEMP_FILE_AGE_HARD = 5 * 60 * 1000;    // 5 dakika
const LOG_TRUNCATE_OVER = 5 * 1024 * 1024;   // 5 MB üstündeki logları truncate et
const SESSION_BACKUP_TTL = 7 * 24 * 60 * 60 * 1000; // 7 gün

let _running = false;
let _lastReport = 0;

// ── Yardımcılar ───────────────────────────────────────────────────────────

async function safeStat(p) {
  try { return await fsp.stat(p); } catch { return null; }
}

async function dirSize(dirPath) {
  let total = 0;
  let stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      const full = path.join(current, e.name);
      try {
        if (e.isDirectory()) {
          stack.push(full);
        } else if (e.isFile()) {
          const st = await fsp.stat(full);
          total += st.size;
        }
      } catch { /* dosya silinmiş olabilir */ }
    }
  }
  return total;
}

async function fileSize(p) {
  const st = await safeStat(p);
  return st && st.isFile() ? st.size : 0;
}

async function pruneOlderThan(dirPath, ageMs) {
  let removed = 0;
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch { return 0; }
  const now = Date.now();
  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    try {
      const st = await fsp.stat(full);
      if (now - st.mtimeMs > ageMs) {
        await fsp.rm(full, { recursive: true, force: true });
        removed++;
      }
    } catch { /* yarış, geç */ }
  }
  return removed;
}

async function truncateLargeLog(filePath, maxBytes = LOG_TRUNCATE_OVER) {
  const st = await safeStat(filePath);
  if (!st || !st.isFile() || st.size <= maxBytes) return false;
  try {
    // Dosyayı tamamen siler değil, son ~512KB'ı tutarak yeniden yaz.
    // pm2 file-handle açık tuttuğu için truncate(0) kullanırız;
    // o sırada yazılan loglar dosyanın yeni başına eklenir.
    const fd = await fsp.open(filePath, "r");
    const tail = Math.min(512 * 1024, st.size);
    const buf = Buffer.alloc(tail);
    await fd.read(buf, 0, tail, st.size - tail);
    await fd.close();
    await fsp.truncate(filePath, 0);
    await fsp.appendFile(filePath, buf);
    return true;
  } catch (e) {
    logger.debug({ err: e.message, filePath }, "[DiskMon] log truncate başarısız");
    return false;
  }
}

async function pruneOldSessionBackups() {
  const sessions = TARGETS.sessions;
  if (!fs.existsSync(sessions)) return 0;
  let removed = 0;
  try {
    const entries = await fsp.readdir(sessions, { withFileTypes: true });
    const now = Date.now();
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      // Sadece "*_migrated_*" yedeklerini hedefle (canlı oturuma dokunma!)
      if (!/_migrated_\d+/.test(e.name)) continue;
      const full = path.join(sessions, e.name);
      const st = await safeStat(full);
      if (st && now - st.mtimeMs > SESSION_BACKUP_TTL) {
        await fsp.rm(full, { recursive: true, force: true });
        removed++;
      }
    }
  } catch { /* sessizce geç */ }
  return removed;
}

// ── Ana akış ──────────────────────────────────────────────────────────────

async function getDiskSnapshot() {
  const [tempOs, tempApp, uploads, downloads, sessions, logs, aiPlugins, sqlite, wal, shm] = await Promise.all([
    dirSize(TARGETS.tempOs),
    dirSize(TARGETS.tempApp),
    dirSize(TARGETS.uploads),
    dirSize(TARGETS.downloads),
    dirSize(TARGETS.sessions),
    dirSize(TARGETS.logs),
    dirSize(TARGETS.aiPlugins),
    fileSize(TARGETS.sqliteFile),
    fileSize(TARGETS.sqliteWal),
    fileSize(TARGETS.sqliteShm),
  ]);
  const total = tempOs + tempApp + uploads + downloads + sessions + logs + aiPlugins + sqlite + wal + shm;
  return { tempOs, tempApp, uploads, downloads, sessions, logs, aiPlugins, sqlite, wal, shm, total };
}

async function softCleanup() {
  let freed = 0;
  for (const dir of [TARGETS.tempOs, TARGETS.tempApp, TARGETS.uploads, TARGETS.downloads, TARGETS.aiPlugins]) {
    if (fs.existsSync(dir)) freed += await pruneOlderThan(dir, TEMP_FILE_AGE_SOFT);
  }
  freed += await pruneOldSessionBackups();
  // Logları kabarmışsa kırp
  await truncateLargeLog(path.join(TARGETS.logs, "pm2-error.log"));
  await truncateLargeLog(path.join(TARGETS.logs, "pm2-out.log"));
  return freed;
}

async function hardCleanup() {
  let freed = 0;
  for (const dir of [TARGETS.tempOs, TARGETS.tempApp, TARGETS.uploads, TARGETS.downloads, TARGETS.aiPlugins]) {
    if (fs.existsSync(dir)) freed += await pruneOlderThan(dir, TEMP_FILE_AGE_HARD);
  }
  freed += await pruneOldSessionBackups();
  await truncateLargeLog(path.join(TARGETS.logs, "pm2-error.log"), 1 * 1024 * 1024);
  await truncateLargeLog(path.join(TARGETS.logs, "pm2-out.log"), 1 * 1024 * 1024);

  // SQLite WAL'ı zorla küçült — bot 400+ grupta saatte 100MB+ WAL üretebilir
  try {
    const { sequelize } = require("./database");
    if (sequelize.getDialect() === "sqlite") {
      await sequelize.query("PRAGMA wal_checkpoint(TRUNCATE);");
      logger.warn("[DiskMon] WAL TRUNCATE checkpoint yürütüldü.");
    }
  } catch (e) {
    logger.debug({ err: e.message }, "[DiskMon] WAL truncate başarısız");
  }
  return freed;
}

async function runOnce(opts = {}) {
  if (_running) return;
  _running = true;
  try {
    const snap = await getDiskSnapshot();
    const ratio = snap.total / DISK_BUDGET_BYTES;

    // 5 dakikada bir özet log
    const now = Date.now();
    if (now - _lastReport > 5 * 60 * 1000) {
      _lastReport = now;
      const toMB = (b) => Math.round(b / 1024 / 1024);
      logger.debug(
        `[DiskMon] kullanım=%${Math.round(ratio * 100)} ` +
        `(toplam=${toMB(snap.total)}MB / bütçe=${toMB(DISK_BUDGET_BYTES)}MB | ` +
        `wal=${toMB(snap.wal)}MB sqlite=${toMB(snap.sqlite)}MB temp=${toMB(snap.tempOs + snap.tempApp)}MB ` +
        `logs=${toMB(snap.logs)}MB sessions=${toMB(snap.sessions)}MB)`
      );
    }

    if (ratio >= PANIC_THRESHOLD) {
      logger.error(`[DiskMon] DİSK %${Math.round(ratio * 100)} doluluk! Acil temizlik + restart isteniyor...`);
      await hardCleanup();
      // Yeni snapshot — hala panic seviyesindeyse çıkış sinyali ver
      const after = await getDiskSnapshot();
      if (after.total / DISK_BUDGET_BYTES >= PANIC_THRESHOLD) {
        logger.error("[DiskMon] Temizlik sonrası hâlâ kritik. Süreç temiz çıkışla yeniden başlatılıyor.");
        try { if (process.send) process.send({ type: "bot_status", data: { connected: false, error: "Disk dolu" } }); } catch { }
        setTimeout(() => process.exit(2), 500);
      }
      return;
    }

    if (ratio >= HARD_THRESHOLD) {
      const freed = await hardCleanup();
      logger.warn(`[DiskMon] Sert eşik (%${Math.round(ratio * 100)}). ${freed} öğe temizlendi + WAL truncate.`);
      return;
    }

    if (ratio >= SOFT_THRESHOLD) {
      const freed = await softCleanup();
      if (freed > 0) {
        logger.info(`[DiskMon] Yumuşak eşik (%${Math.round(ratio * 100)}). ${freed} öğe proaktif temizlendi.`);
      }
    }
  } catch (e) {
    logger.debug({ err: e.message }, "[DiskMon] hata (yutuldu)");
  } finally {
    _running = false;
  }
}

function start() {
  const scheduler = require("./zamanlayici").scheduler;
  // Başlangıçta hemen bir tarama yap — ardından her 4 dakikada bir
  scheduler.register("disk_monitor", runOnce, 4 * 60 * 1000, { runImmediately: true });
}

module.exports = { start, runOnce, getDiskSnapshot };
