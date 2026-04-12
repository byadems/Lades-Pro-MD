"use strict";

/**
 * index.js - Lades-MD Entry Point
 * Stabilized and clean version.
 */

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
const { applyDatabaseCaching, shutdownCache } = require("./core/db-cache");
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
          } catch {}
        } catch (e) {}
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

if (fs.existsSync("./config.env")) require("dotenv").config({ path: "./config.env" });
suppressLibsignalLogs();
// startTempCleanup(); // Redundant, bot.js handles it
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
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
      status: "ok", 
      bot: "Lades-Pro-MD",
      uptime: Math.floor((Date.now() - runtime.startTime) / 1000),
      memory: Math.round(mem.heapUsed / 1024 / 1024) + "MB"
    });
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
  }).on('error', () => {});
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
    applyDatabaseCaching();
    await startSessionCleanup();
    // startKeepAlive(); // Still disabled to avoid port conflict, but optimized for when needed

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