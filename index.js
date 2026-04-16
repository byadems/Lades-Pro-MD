"use strict";

/**
 * index.js - Lades-MD Entry Point
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
const scheduler = require("./core/scheduler");
const PID_FILE = path.join(__dirname, "bot.pid");
const config = require("./config");
const { logger } = config;
const { initializeDatabase, WhatsappSession } = require("./core/database");
const { BotManager } = require("./core/manager");
const { suppressLibsignalLogs, startTempCleanup } = require("./core/helpers");
const { shutdownCache } = require("./core/db-cache");
const { getAllGroups } = require("./core/store");
const { setupDashboardBridge } = require("./core/dashboard-bridge");

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

const PM2_RESTART_MB = config.PM2_RESTART_LIMIT_MB || 450;
scheduler.register('memory_check', () => {
  const mem = process.memoryUsage();
  if (mem.heapUsed > PM2_RESTART_MB * 1024 * 1024) {
    logger.warn(`Bellek sınırı (${PM2_RESTART_MB}MB) aşıldı. Otomatik yeniden başlatılıyor...`);
    process.exit(1);
  }
}, 10000);

function startKeepAlive() {
  const app = express();
  const publicDir = path.join(__dirname, 'public');

  app.use(compression());

  // ─────────────────────────────────────────────────────────
  //  Ultra Health Check Endpoint
  // ─────────────────────────────────────────────────────────
  let _healthCache = null;
  let _healthCacheAt = 0;
  const HEALTH_CACHE_MS = 10000; // 10 saniye cache — dashboard her refresh DB'yi çarpmıyor

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
        bot: 'Lades-Pro-MD',
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

  // Lightweight ping (no DB check, no cache needed)
  app.get('/ping', (req, res) => {
    res.json({ ok: true, t: Date.now() });
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
  logger.info(`${signal} sinyali alındı. Kapatılıyor...`);
  scheduler.stop();

  if (runtime.manager) {
    // Wait for all sessions to close (max 10s)
    await Promise.race([
      runtime.manager.stopAll(),
      new Promise(r => setTimeout(r, 10000))
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

process.on("uncaughtException", (err) => {
  if (err.code === "ERR_IPC_DISCONNECTED") return;

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

  logger.error({
    reason: String(reason),
    stack: reason?.stack,
    promise
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
}

(async () => {
  try {
    await checkSingleInstance();
    await initializeDatabase();
    logger.info("Bot is initializing...");
    await startSessionCleanup();
    // startKeepAlive(); // Disabled again! This steals PORT 3000 from the dashboard server!

    const manager = new BotManager();
    runtime.manager = manager;
    const phoneNumber = process.env.PAIR_PHONE || null;
    await manager.addSession("lades-session", { phoneNumber });

    setupDashboardBridge(manager, config);

    logger.info("Lades-Pro-MD Aktif!");
  } catch (err) {
    logger.error(err, "Kritik Hata");
    process.exit(1);
  }
})();