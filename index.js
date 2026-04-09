"use strict";

/**
 * index.js - Lades-MD Entry Point
 * Stabilized and clean version.
 */

const path = require("path");
const fs = require("fs");
const http = require("http");
const { fork } = require('child_process');

const PID_FILE = path.join(__dirname, "bot.pid");

function checkSingleInstance() {
  if (fs.existsSync(PID_FILE)) {
    try {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim());
      if (!isNaN(oldPid) && oldPid !== process.pid) {
        try {
          process.kill(oldPid, 0);
          console.log(`[ANTI-DUBLE] Eski bot süreci (PID: ${oldPid}) tespit edildi. Sonlandırılıyor...`);
          process.kill(oldPid, "SIGKILL");
        } catch (e) {
          // PID not found or no permission
        }
      }
    } catch (e) {
      console.error("[ANTI-DUBLE] PID hatası:", e.message);
    }
  }
  fs.writeFileSync(PID_FILE, process.pid.toString());
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
const config = require("./config");
const { logger } = config;
const { initializeDatabase } = require("./core/database");
const { BotManager } = require("./core/manager");
const { suppressLibsignalLogs, startTempCleanup } = require("./core/helpers");
const { applyDatabaseCaching, shutdownCache } = require("./core/db-cache");

suppressLibsignalLogs();
startTempCleanup();
global.botStartTime = Date.now();

const PM2_RESTART_MB = config.PM2_RESTART_LIMIT_MB || 450;
let _memTimer = setInterval(() => {
  const heap = process.memoryUsage();
  const usedMb = Math.round(heap.heapUsed / 1024 / 1024);
  if (usedMb > PM2_RESTART_MB) {
    if (global.gc) global.gc();
    if (usedMb > PM2_RESTART_MB + 20) {
      logger.warn(`Memory limit exceeded (${usedMb}MB). Graceful shutdown initiating...`);
      shutdown("SIGTERM");
    }
  }
}, 120000);

function startKeepAlive() {
  const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };
  const publicDir = path.join(__dirname, 'public');

  const server = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { "Content-Type": "application/json" });
      const mem = process.memoryUsage();
      return res.end(JSON.stringify({
        status: "ok", bot: "Lades-Pro-MD",
        uptime: Math.floor((Date.now() - global.botStartTime) / 1000),
        memory: Math.round(mem.heapUsed / 1024 / 1024) + "MB"
      }));
    }

    // Serve static files from /public
    let filePath = path.join(publicDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // Fallback to index.html for SPA routing
        fs.readFile(path.join(publicDir, 'index.html'), (err2, data2) => {
          if (err2) {
            res.writeHead(404);
            return res.end('Not Found');
          }
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(data2);
        });
        return;
      }
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    });
  });
  server.on('error', () => { });
  server.listen(process.env.PORT || 3000);
}

async function shutdown(signal) {
  logger.info(`${signal} sinyali alındı.`);
  if (_memTimer) clearInterval(_memTimer);
  shutdownCache();
  if (fs.existsSync(PID_FILE)) try { fs.unlinkSync(PID_FILE); } catch { }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  if (err.code === "ERR_IPC_DISCONNECTED") return;
  logger.error(err, "Beklenmedik Hata");
});

(async () => {
  try {
    checkSingleInstance();
    await initializeDatabase();
    applyDatabaseCaching();
    startKeepAlive();

    const manager = new BotManager();
    const phoneNumber = process.env.PAIR_PHONE || null;
    await manager.addSession("lades-session", { phoneNumber });

    // Dashboard initialization
    const { setupDashboardBridge } = require("./core/dashboard-bridge");
    setupDashboardBridge(manager, config);

    logger.info("Lades-Pro-MD Aktif!");
  } catch (err) {
    logger.error(err, "Kritik Hata");
    process.exit(1);
  }
})();
