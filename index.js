"use strict";

/**
 * index.js - Lades-Pro Entry Point
 * Stabilized and clean version.
 */

// Global saat dilimi ayarı: Tüm bot işleyişi varsayılan olarak Türkiye (Avrupa/İstanbul) saatine sabitlenir.
process.env.TZ = process.env.TIMEZONE || "Europe/Istanbul";

const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const express = require("express");
const compression = require("compression");
const { fork } = require('child_process');
const runtime = require("./core/runtime");
const { scheduler } = require("./core/zamanlayici");
const PID_FILE = path.join(__dirname, "bot.pid");
const config = require("./config");
const { logger } = config;
const { initializeDatabase, WhatsappOturum } = require("./core/database");
const { BotManager } = require("./core/manager");
const { suppressLibsignalLogs, startTempCleanup } = require("./core/yardimcilar");
const { shutdownCache } = require("./core/db-cache");
const { getAllGroups } = require("./core/store");
const { setupDashboardBridge } = require("./core/dashboard-bridge");
const diskMonitor = require("./core/disk-monitor");

async function checkSingleInstance() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const data = await fsp.readFile(PID_FILE, "utf-8");
      const oldPid = parseInt(data.trim());
      if (!isNaN(oldPid) && oldPid !== process.pid) {
        try {
          process.kill(oldPid, 0);
          logger.info(`[ANTI-DUBLE] Eski bot süreci (PID: ${oldPid}) tespit edildi. Sonlandırılıyor...`);
          process.kill(oldPid, "SIGTERM");
          await new Promise(r => setTimeout(r, 2000));
          try {
            process.kill(oldPid, 0);
            process.kill(oldPid, "SIGKILL");
          } catch { }
        } catch (e) { }
      }
    }
    await fsp.writeFile(PID_FILE, process.pid.toString());
  } catch (e) {
    logger.error({ err: e.message }, "[ANTI-DUBLE] PID hatası");
  }
}

try {
  const ffmpeg = require("fluent-ffmpeg");
  const ffmpegPath = require("ffmpeg-static");
  ffmpeg.setFfmpegPath(ffmpegPath);

  // Baileys requires ffmpeg in the system PATH to generate video thumbnails.
  const ffmpegDir = path.dirname(ffmpegPath);
  process.env.PATH = ffmpegDir + path.delimiter + process.env.PATH;
} catch (e) {
  console.log("ffmpeg config skipped");
}

suppressLibsignalLogs();
runtime.startTime = Date.now();

// 0.2 vCPU / 512MB tuning: heap=240MB + native peak ~140MB = ~380MB normal RSS.
// PM2 max_memory_restart=400M zaten zorlar; biz 380'de erken/temiz çıkıyoruz ki
// in-flight mesajlar tamamlansın ve OOM-kill (signal: 9) hiç yaşanmasın.
const PM2_RESTART_MB = parseInt(process.env.PM2_RESTART_LIMIT_MB || config.PM2_RESTART_LIMIT_MB || "380", 10);
let _isShuttingDown = false;

// ─────────────────────────────────────────────────────────
//  Processed Message Deduplication
//  Aynı msg.key.id'nin iki kere işlenmesini engeller.
//  Baileys bağlantı yenilenmelerinde / history-sync'lerde mesaj
//  "append" tipiyle yeniden yayınlanabiliyor; bu da daha önce
//  cevaplanmış komutların tekrar çalıştırılmasına neden oluyordu.
//
//  Tasarım: Map<msgId, timestamp>
//   • TTL    : 60 dk — Baileys replay'leri için yeterli güvenlik penceresi
//   • CAP    : 10.000 — bellek sızıntısı koruması (taşarsa eski %10 atılır)
//   • PRUNE  : Her 5 dk'da süresi geçmiş ID'leri ayıkla
// ─────────────────────────────────────────────────────────
const processedMessages = new Map();
const DEDUPE_TTL_MS = 15 * 60 * 1000;   // 30dk→15dk: Baileys replay penceresi için yeterli, bellek yarıya iner
const DEDUPE_MAX = 3_000;               // 5K→3K: ~150KB (her entry ~50 byte)

function isMessageProcessed(id) {
  if (!id) return false;
  const ts = processedMessages.get(id);
  if (!ts) return false;
  if (Date.now() - ts > DEDUPE_TTL_MS) {
    processedMessages.delete(id);
    return false;
  }
  return true;
}

function markMessageProcessed(id) {
  if (!id) return;
  // Bellek kapağı: limit aşılırsa en eski %10 ID'yi at (Map insertion order)
  if (processedMessages.size >= DEDUPE_MAX) {
    const dropCount = Math.floor(DEDUPE_MAX * 0.1);
    let i = 0;
    for (const k of processedMessages.keys()) {
      processedMessages.delete(k);
      if (++i >= dropCount) break;
    }
  }
  processedMessages.set(id, Date.now());
}

// 24/7 OPT: Periyodik temizlik — 3 dakikada bir (5dk→3dk)
// Daha sık temizlik = daha düşük ortalama bellek kullanımı
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [id, ts] of processedMessages) {
    if (now - ts > DEDUPE_TTL_MS) {
      processedMessages.delete(id);
      removed++;
    }
  }
  if (removed > 0) {
    logger.debug(`[Dedupe] ${removed} eski ID temizlendi (mevcut: ${processedMessages.size})`);
  }
}, 2 * 60 * 1000);  // 3dk→2dk: Daha sık temizlik = daha düşük ortalama bellek

// Process sonlanırken temizle
process.on('beforeExit', () => processedMessages.clear());

// Handler'lar bu yardımcılara global üzerinden ulaşır
global.processedMessages = processedMessages;
global.isMessageProcessed = isMessageProcessed;
global.markMessageProcessed = markMessageProcessed;

// ─────────────────────────────────────────────────────────
//  Bellek Gözcüsü — 0.2 vCPU / 512MB için kademeli baskı yönetimi
//
//  Üç seviye:
//   • SOFT  (0.70 * limit) → cache trim + manuel GC (eğer açıksa)
//   • HARD  (0.88 * limit) → tüm LRU cache'leri temizle, agresif GC
//   • PANIC (1.00 * limit) → temiz restart (in-flight kuyruğu tamamla)
//
//  Heap %70 = 266MB, %88 = 334MB, %100 = 380MB (RSS budget).
//  Bu sayede OS OOM-kill ve PM2 max_memory_restart bizi devirmeden
//  proaktif olarak basıncı düşürürüz.
// ─────────────────────────────────────────────────────────
let _lastEmergencyTrim = 0;
function _emergencyTrimCaches() {
  // 30s cooldown — sürekli temizlik CPU yer
  if (Date.now() - _lastEmergencyTrim < 30000) return;
  _lastEmergencyTrim = Date.now();
  try {
    const cache = require("./core/db-cache");
    if (cache.shutdownCache) cache.shutdownCache();
  } catch { }
  try {
    if (runtime.metrics) {
      if (runtime.metrics.users && runtime.metrics.users.clear) runtime.metrics.users.clear();
      if (runtime.metrics.groups && runtime.metrics.groups.clear) runtime.metrics.groups.clear();
      runtime.metrics.allGroupsCache = null;
      runtime.metrics.allGroupsLastFetch = 0;
    }
    if (runtime.lidCache && runtime.lidCache.clear) runtime.lidCache.clear();
  } catch { }
  if (typeof global.gc === "function") {
    try { global.gc(); } catch { }
  }
}

// Bellek kontrolü 45s'de bir — kademeli yanıt
scheduler.register('memory_check', () => {
  if (_isShuttingDown) return;
  const mem = process.memoryUsage();
  const rssMB = mem.rss / (1024 * 1024);
  const heapUsedMB = mem.heapUsed / (1024 * 1024);
  const heapTotalMB = mem.heapTotal / (1024 * 1024);
  const externalMB = mem.external / (1024 * 1024);

  // PANIC: RSS limiti aşıldı → temiz çıkış
  if (rssMB > PM2_RESTART_MB) {
    logger.warn(`[Bellek][PANIC] RSS=${Math.round(rssMB)}MB > ${PM2_RESTART_MB}MB — temiz restart`);
    shutdown("MEMORY_LIMIT_EXCEEDED");
    return;
  }

  // HARD: %88 — emergency trim
  if (rssMB > PM2_RESTART_MB * 0.88 || heapUsedMB > PM2_RESTART_MB * 0.78) {
    logger.warn(`[Bellek][HARD] RSS=${Math.round(rssMB)}MB Heap=${Math.round(heapUsedMB)}MB — cache flush + GC`);
    _emergencyTrimCaches();
    return;
  }

  // SOFT: %70 — sadece GC öner
  if (typeof global.gc === 'function' && (heapUsedMB > PM2_RESTART_MB * 0.70 || externalMB > 80)) {
    try { global.gc(); } catch { }
    logger.debug(`[Bellek][SOFT] GC (RSS=${Math.round(rssMB)}MB Heap=${Math.round(heapUsedMB)}/${Math.round(heapTotalMB)}MB Ext=${Math.round(externalMB)}MB)`);
  }
}, 45000);

// Periyodik GC: 4dk'de bir — V8 --optimize-for-size + 4MB semi-space zaten
// agresif scavenge yapıyor; bu sadece old-gen için bir nudge.
scheduler.register('periodic_gc', () => {
  if (typeof global.gc === 'function') {
    try { global.gc(); } catch { }
    if (process.env.LOG_LEVEL === 'debug') {
      const mem = process.memoryUsage();
      const toMB = (b) => Math.round(b / 1024 / 1024);
      logger.debug(`[GC-4m] RSS=${toMB(mem.rss)}MB Heap=${toMB(mem.heapUsed)}/${toMB(mem.heapTotal)}MB Ext=${toMB(mem.external)}MB`);
    }
  }
}, 4 * 60 * 1000);

// ─────────────────────────────────────────────────────────
//  Event Loop Lag İzleyici — CPU starvation erken uyarı
//
//  0.2 vCPU'da event loop lag ilk uyarı sinyalidir. Lag > 500ms ise
//  PQueue zaten kuyruğu tutuyor demektir; lag > 2s ise tıkanma var.
//  Sürekli lag > 5s görürsek soketi yenileyerek temizlik yaparız.
// ─────────────────────────────────────────────────────────
let _lagSamples = []; // son 5 örnek
let _lastLagWarn = 0;
function _measureEventLoopLag() {
  const start = Date.now();
  setImmediate(() => {
    const lag = Date.now() - start;
    _lagSamples.push(lag);
    if (_lagSamples.length > 5) _lagSamples.shift();
    const avgLag = _lagSamples.reduce((a, b) => a + b, 0) / _lagSamples.length;
    // 5 örneğin ortalaması 2s'yi aşarsa: kalıcı starvation
    if (avgLag > 2000 && Date.now() - _lastLagWarn > 60000) {
      _lastLagWarn = Date.now();
      logger.warn(`[EventLoop] Kalıcı lag tespit edildi (avg=${Math.round(avgLag)}ms). CPU baskısı altındayız — geçici trim uygulanıyor.`);
      _emergencyTrimCaches();
    }
  });
}
scheduler.register('event_loop_lag', _measureEventLoopLag, 30000);


function startKeepAlive() {
  const app = express();
  const publicDir = path.join(__dirname, 'public');

  app.use(compression());

  // ─────────────────────────────────────────────────────────
  //  Ultra Health Check Endpoint
  // ─────────────────────────────────────────────────────────
  let _healthCache = null;
  let _healthCacheAt = 0;
  // 0.2 vCPU OPT: Health cache 10s → 30s. Dashboard refresh + container
  // health check sıklığında bile 30s yeterince taze; her sorgu DB ping
  // + memoryUsage() + cache stats tarama yapıyordu. CPU tasarrufu önemli.
  const HEALTH_CACHE_MS = 30000;

  app.get('/health', async (req, res) => {
    const now = Date.now();
    // Fast path: cache geçerliyse direkt dön
    if (_healthCache && (now - _healthCacheAt) < HEALTH_CACHE_MS) {
      return res.json(_healthCache);
    }

    try {
      const mem = process.memoryUsage();
      const uptime = Math.floor((now - runtime.startTime) / 1000);

      // CPU kullanımı (basit yaklaşım)
      const cpuUsage = process.cpuUsage();
      const cpuPercent = Math.round((cpuUsage.user + cpuUsage.system) / 1e6 / process.uptime() * 100) / 100;

      // DB sağlık kontrolü
      let dbStatus = 'unknown';
      let dbMs = -1;
      try {
        const { sequelize } = require('./core/database');
        const dbT0 = Date.now();
        await sequelize.query('SELECT 1');
        dbMs = Date.now() - dbT0;
        dbStatus = dbMs < 200 ? 'healthy' : dbMs < 1000 ? 'slow' : 'degraded';
      } catch (e) {
        dbStatus = 'error';
      }

      // Cache istatistikleri
      let cacheStats = {};
      try {
        const { getCacheStats } = require('./core/db-cache');
        cacheStats = getCacheStats();
      } catch (e) { }

      // Mesaj store boyutu
      let storeStats = {};
      try {
        const { getStoreStats } = require('./core/store');
        storeStats = getStoreStats();
      } catch (e) { }

      // Bot bağlantı durumu
      let botConnected = false;
      let botPhone = null;
      let activeSessions = 0;
      try {
        const mgr = runtime.manager;
        if (mgr && mgr.bots instanceof Map) {
          activeSessions = mgr.bots.size;
          for (const [sid, sock] of mgr.bots) {
            if (sock && sock.user) {
              botConnected = true;
              botPhone = sock.user.id;
              break;
            }
          }
        }
      } catch (e) { }

      // Komut sayısı & self-test durumu
      let commandCount = 0;
      let selfTestStatus = 'idle';
      try {
        const handler = require('./core/handler');
        commandCount = handler.commands ? handler.commands.length : 0;
        selfTestStatus = runtime.testProgress ? runtime.testProgress.status : 'idle';
      } catch (e) { }

      // RAW memory bytes MB'ye çevir
      const toMB = (b) => Math.round(b / 1024 / 1024 * 10) / 10;

      // Hata oranı
      const totalErr = runtime.metrics ? (runtime.metrics.errors || 0) : 0;
      const totalMsg = runtime.metrics ? (runtime.metrics.messages || 0) : 0;
      const errorRate = totalMsg > 0 ? Math.round((totalErr / totalMsg) * 10000) / 100 : 0;

      _healthCache = {
        status: dbStatus === 'error' ? 'degraded' : 'ok',
        bot: 'Lades-Pro',
        timestamp: new Date().toISOString(),
        uptime: {
          seconds: uptime,
          human: `${Math.floor(uptime / 3600)}s ${Math.floor((uptime % 3600) / 60)}d ${uptime % 60}sn`
        },
        memory: {
          heapUsed: `${toMB(mem.heapUsed)} MB`,
          heapTotal: `${toMB(mem.heapTotal)} MB`,
          rss: `${toMB(mem.rss)} MB`,
          external: `${toMB(mem.external)} MB`,
          heapPct: `${Math.round(mem.heapUsed / mem.heapTotal * 100)}%`
        },
        cpu: {
          usagePercent: cpuPercent,
          processUptime: Math.floor(process.uptime())
        },
        database: {
          status: dbStatus,
          pingMs: dbMs,
          dialect: (() => { try { return require('./core/database').sequelize.getDialect(); } catch { return 'unknown'; } })()
        },
        connection: {
          botConnected,
          botPhone: botPhone ? botPhone.split(':')[0] + '@s.whatsapp.net' : null,
          activeSessions
        },
        commands: {
          count: commandCount,
          selfTest: selfTestStatus,
          selfTestProgress: runtime.testProgress || null
        },
        cache: cacheStats,
        messageStore: storeStats,
        metrics: {
          totalMessages: (runtime.metrics && runtime.metrics.messages) || 0,
          totalCommands: (runtime.metrics && runtime.metrics.commands) || 0,
          totalErrors: totalErr,
          errorRate: `${errorRate}%`,
          activeUsers: runtime.metrics && runtime.metrics.users ? runtime.metrics.users.size : 0,
          activeGroups: runtime.metrics && runtime.metrics.groups ? runtime.metrics.groups.size : 0
        }
      };
      _healthCacheAt = now;
      res.json(_healthCache);
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  // Lightweight ping (no DB check, no cache needed) — Dockerfile HEALTHCHECK bunu kullanır
  app.get('/ping', (req, res) => {
    res.json({ ok: true, t: Date.now() });
  });

  // Orchestrator-friendly liveness/readiness — sıfır iş, sıfır JSON parse
  app.get('/healthz', (req, res) => {
    if (_isShuttingDown) return res.status(503).type('text/plain').send('shutting_down');
    res.type('text/plain').send('ok');
  });

  // ─── Yönetici token doğrulaması ───────────────────────────
  const _adminToken = process.env.ADMIN_SYNC_SECRET || null;
  const _requireAdminToken = (req, res, next) => {
    if (!_adminToken) return res.status(503).json({ error: 'Bu endpoint devre dışı: ADMIN_SYNC_SECRET ortam değişkeni ayarlanmamış.' });
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.body && req.body.secret);
    if (token !== _adminToken) return res.status(401).json({ error: 'Yetkisiz: Geçersiz yönetici tokeni' });
    next();
  };
  // Force re-pair: DB'deki oturumu temizle ve yeniden eşleştir
  app.post('/api/force-repair', express.json(), _requireAdminToken, async (req, res) => {
    try {
      const { Op } = require('sequelize');
      const deletedCount = await WhatsappOturum.destroy({
        where: { sessionId: { [Op.like]: 'lades-session%' } }
      });
      logger.warn(`[Force-Repair] ${deletedCount} oturum kaydı silindi. Yeniden eşleştirme başlatılıyor...`);

      const mgr = runtime.manager;
      if (mgr) {
        mgr.resume('lades-session');
        await mgr.removeSession('lades-session', false).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));
        await mgr.addSession('lades-session', { phoneNumber: process.env.PAIR_PHONE });
      }
      res.json({ ok: true, deleted: deletedCount, msg: 'Oturum temizlendi. QR kodu bekleniyor...' });
    } catch (e) {
      logger.error({ err: e.message }, '[Force-Repair] Hata');
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Serve static files with caching
  app.use(express.static(publicDir, {
    maxAge: '1h',
    immutable: true
  }));

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    logger.info(`Keep-alive sunucusu aktif (Port: ${port})`);
  }).on('error', () => { });
}

async function shutdown(signal) {
  if (_isShuttingDown) {
    logger.debug(`[Shutdown] '${signal}' sinyali alındı fakat zaten kapanış sürecindeyiz. Atlanıyor.`);
    return;
  }
  _isShuttingDown = true;
  logger.info(`${signal} sinyali alındı. Kapatılıyor...`);
  scheduler.stop();

  if (runtime.manager) {
    // Wait for all sessions to close (max 8s — production'da uzun bekleme gereksiz)
    await Promise.race([
      runtime.manager.stopAll(),
      new Promise(r => setTimeout(r, 8000))
    ]);
  }

  shutdownCache();
  try {
    const exists = await fsp.access(PID_FILE).then(() => true).catch(() => false);
    if (exists) await fsp.unlink(PID_FILE);
  } catch { }
  logger.info("Sistem temiz bir şekilde kapatıldı.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Global hata yakalama — Bot çökmesini engeller ─────────────────────────
const FATAL_ERRORS = ["ERR_OUT_OF_MEMORY", "ENOMEM", "SQLITE_CORRUPT"];

// Baileys'in bilinen geçici hataları — reconnect mekanizması bunları zaten ele alıyor.
// Bu hatalar uncaughtException/unhandledRejection'da botu çökermaniyor.
const KNOWN_RECOVERABLE = [
  "Bad MAC", "Bad error", "Connection Closed", "Connection Reset",
  "ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "Socket closed",
  "Timed Out", "Stream Errored", "boom", "not-authorized",
];

function isRecoverableError(err) {
  if (!err) return false;
  const msg = String(err.message || err || '');
  return KNOWN_RECOVERABLE.some(s => msg.includes(s));
}

// ─────────────────────────────────────────────────────────
//  ENOSPC (disk dolu) durumunda acil temizlik
// ────────���────────────────────────────────────────────────
async function cleanupDiskSpace() {
  const fs = await import("fs");
  const path = await import("path");
  const dirs = ["/tmp", "./temp", "./uploads", "./downloads"].filter(d => {
    try { return fs.existsSync(d); } catch { return false; }
  });
  let freed = 0;
  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const fp = path.join(dir, f);
        try {
          const stat = fs.statSync(fp);
          // 30 dakikadan eski dosyaları sil
          if (Date.now() - stat.mtimeMs > 30 * 60 * 1000) {
            if (stat.isDirectory()) fs.rmSync(fp, { recursive: true, force: true });
            else fs.unlinkSync(fp);
            freed++;
          }
        } catch { /* dosyaya erişilemiyorsa geç */ }
      }
    } catch { /* dizine erişilemiyorsa geç */ }
  }
  logger.warn(`[ENOSPC] Disk temizlendi. ${freed} dosya silindi.`);
}

function isEnospc(err) {
  if (!err) return false;
  return err.code === "ENOSPC" || err.errno === -28 ||
    String(err.message || "").includes("ENOSPC") ||
    String(err.message || "").includes("no space left");
}

process.on("uncaughtException", (err) => {
  if (err.code === "ERR_IPC_DISCONNECTED") return;

  // Disk dolu hatası — temizle ve devam et, botu çökertme
  if (isEnospc(err)) {
    logger.error("[ENOSPC] Disk dolu! Acil temizlik başlatılıyor...");
    cleanupDiskSpace().catch(() => {});
    return;
  }

  // Bilinen geçici Baileys hatalarını sessizce logla — bot çökmesin
  if (isRecoverableError(err)) {
    logger.warn(`[Baileys] Geçici hata (bot devam ediyor): ${err.message}`);
    return;
  }

  logger.error(err, "[KRİTİK] Uncaught Exception");
  runtime.metrics.errors++;

  // Fatal hata durumunda güvenli yeniden başlatma
  if (FATAL_ERRORS.some(e => err.code === e || err.message?.includes(e))) {
    logger.warn("Kritik sistem hatası algılandı. Yeniden başlatılıyor...");
    shutdown("FATAL_ERROR");
  }
});

process.on("unhandledRejection", (reason, promise) => {
  if (reason?.code === "ERR_IPC_DISCONNECTED") return;

  // Disk dolu hatası — temizle ve devam et
  if (isEnospc(reason)) {
    logger.error("[ENOSPC] Disk dolu (rejection)! Acil temizlik başlatılıyor...");
    cleanupDiskSpace().catch(() => {});
    return;
  }

  // Bilinen geçici Baileys hatalarını sessizce logla
  if (isRecoverableError(reason)) {
    logger.warn(`[Baileys] Geçici rejection (bot devam ediyor): ${reason?.message || reason}`);
    return;
  }

  logger.error({
    reason: String(reason),
    stack: reason?.stack,
  }, "[KRİTİK] Unhandled Rejection");

  runtime.metrics.errors++;

  if (config.DEBUG) {
    console.error("Tam rejection detayı:", reason);
  }
});

// ─────────────────────────────────────────────────────────
//  Auth Session Cleanup (Point 15)
// ─────────────────────────────────────────────────────────
async function startSessionCleanup() {
  const dashAuthDir = path.join(__dirname, 'sessions', 'dashboard-auth');
  const exists = await fsp.access(dashAuthDir).then(() => true).catch(() => false);
  if (!exists) return;

  const cleanup = async () => {
    try {
      const files = await fsp.readdir(dashAuthDir);
      const now = Date.now();
      let count = 0;
      for (const f of files) {
        const fp = path.join(dashAuthDir, f);
        const stat = await fsp.stat(fp);
        if (now - stat.mtimeMs > 7 * 24 * 60 * 60 * 1000) { // 7 days
          await fsp.unlink(fp);
          count++;
        }
      }
      if (count > 0) logger.info(`[Cleanup] ${count} eski dashboard oturum dosyası silindi.`);
    } catch (e) { }
  };
  await cleanup(); // Run at startup
  scheduler.register('session_cleanup', cleanup, 24 * 60 * 60 * 1000); // 1x per day

  // ─────────────────────────────────────────────────────────
  //  Veritabanı Bakım Zamanlayıcısı (SQLite + PostgreSQL Uyumlu)
  //
  //  SQLite:     WAL checkpoint — WAL dosyası büyüdükçe sorgu yavaşlar
  //              ve mmap belleğe alınır → RAM basıncı. PASSIVE checkpoint
  //              okuma/yazma bloğu olmadan arka planda WAL'ı temizler.
  //
  //  PostgreSQL: VACUUM ANALYZE — Dead tuple'ları temizler ve tablo
  //              istatistiklerini günceller → sorgu planlaması hızlanır.
  //              Yoğun bot trafiğinde critical — yoksa sequential scan'e düşer.
  // ─────────────────────────────────────────────────────────
  scheduler.register('db_maintenance', async () => {
    try {
      const { sequelize, isPostgres } = require('./core/database');
      if (isPostgres) {
        // PostgreSQL: sadece en yoğun tabloları VACUUM et (tam VACUUM çok ağır)
        await sequelize.query('VACUUM ANALYZE mesaj_istatistikler');
        await sequelize.query('VACUUM ANALYZE bot_metrikler');
        logger.debug('[DB] PostgreSQL VACUUM ANALYZE tamamlandı.');
      } else {
        // SQLite: WAL checkpoint
        await sequelize.query('PRAGMA wal_checkpoint(PASSIVE)');
        logger.debug('[DB] SQLite WAL checkpoint tamamlandı.');
      }
    } catch (e) {
      // DB bakım hatası kritik değil — sessizce atla, sonraki turda tekrar dener
      logger.debug(`[DB] Bakım başarısız: ${e.message}`);
    }
  }, 10 * 60 * 1000); // 10 dakikada bir

  // ─────────────────────────────────────────────────────────
  //  Runtime metrics LRU Periyodik Temizlik
  //  Problem: LRUCache TTL ile otomatik temizlense de, yoğun
  //  trafikte cache sürekli dolup GC basıncı artıyor.
  //  Çözüm: 4 saatte bir tamamen sıfırla. Dashboard'daki "aktif
  //  kullanıcı" sayısı geçici olarak düşer ama DB'deki istatistikler korunur.
  // ─────────────────────────────────────────────────────────
  scheduler.register('metrics_users_reset', () => {
    if (runtime.metrics) {
      const prevUsers = runtime.metrics.users?.size || 0;
      const prevGroups = runtime.metrics.groups?.size || 0;
      // LRUCache.clear() — tüm entry'leri anında serbest bırak
      if (runtime.metrics.users && typeof runtime.metrics.users.clear === 'function') {
        runtime.metrics.users.clear();
      }
      if (runtime.metrics.groups && typeof runtime.metrics.groups.clear === 'function') {
        runtime.metrics.groups.clear();
      }
      // allGroupsCache de büyük obje — periyodik olarak serbest bırak
      runtime.metrics.allGroupsCache = null;
      runtime.metrics.allGroupsLastFetch = 0;
      if (prevUsers > 0 || prevGroups > 0) {
        logger.debug(`[Metrics] LRU temizlendi: ${prevUsers} kullanıcı, ${prevGroups} grup sıfırlandı.`);
      }
    }
  }, 4 * 60 * 60 * 1000); // 4 saatte bir (6h→4h: daha sık temizlik)
}

(async () => {
  try {
    await checkSingleInstance();
    await initializeDatabase();
    logger.info("Bot başlatılıyor...");
    await startSessionCleanup();
    // 0.2 vCPU / 2GB disk: Disk gözcüsünü erken aç. /tmp/sessions/temp/wal'ı
    // 4dk'da bir tarar, eşiklere göre kademeli temizlik yapar.
    try { diskMonitor.start(); } catch (e) { logger.warn({ err: e.message }, "[DiskMon] başlatılamadı"); }
    // startKeepAlive(); // Disabled again! This steals PORT 3000 from the dashboard server!

    const manager = new BotManager();
    runtime.manager = manager;
    const phoneNumber = process.env.PAIR_PHONE || null;
    await manager.addSession("lades-session", { phoneNumber });

    setupDashboardBridge(manager, config);

    logger.info("Lades-Pro Aktif!");
  } catch (err) {
    logger.error(err, "Kritik Hata");
    await shutdown("STARTUP_CRASH");
  }
})();
