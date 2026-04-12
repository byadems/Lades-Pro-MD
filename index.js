"use strict";

/**
 * index.js - Lades-MD Entry Point
 * Stabilized and clean version.
 */

const path = require("path");
const fs = require("fs");
const http = require("http");
const { fork } = require('child_process');
const runtime = require("./core/runtime");

const PID_FILE = path.join(__dirname, "bot.pid");

function checkSingleInstance() {
  if (fs.existsSync(PID_FILE)) {
    try {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim());
      if (!isNaN(oldPid) && oldPid !== process.pid) {
        try {
          process.kill(oldPid, 0);
          console.log(`[ANTI-DUBLE] Eski bot süreci (PID: ${oldPid}) tespit edildi. Sonlandırılıyor...`);
          
          process.kill(oldPid, "SIGTERM");
          
          // Wait 2s for graceful exit
          setTimeout(() => {
            try {
              process.kill(oldPid, 0);
              console.log(`[ANTI-DUBLE] Eski süreç hala aktif, SIGKILL gönderiliyor.`);
              process.kill(oldPid, "SIGKILL");
            } catch {
              // Successfully exited
            }
          }, 2000);
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
process.env.YTDL_NO_DEBUG_FILE = "1";
const config = require("./config");
const { logger } = config;
const { initializeDatabase, WhatsappSession } = require("./core/database");
const { BotManager } = require("./core/manager");
const { suppressLibsignalLogs, startTempCleanup } = require("./core/helpers");
const { applyDatabaseCaching, shutdownCache } = require("./core/db-cache");
const { getAllGroups } = require("./core/store");

suppressLibsignalLogs();
// startTempCleanup(); // Redundant, bot.js handles it
runtime.startTime = Date.now();

const PM2_RESTART_MB = config.PM2_RESTART_LIMIT_MB || 450;
let _memTimer = setInterval(() => {
  const mem = process.memoryUsage();
  if (mem.heapUsed > PM2_RESTART_MB * 1024 * 1024) {
    logger.warn(`Bellek sınırı (${PM2_RESTART_MB}MB) aşıldı. Otomatik yeniden başlatılıyor...`);
    process.exit(1);
  }
  // STATUS IPC optimization: Unifying status reporting into statusTimer
}, 10000); // Check memory every 10s

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
        uptime: Math.floor((Date.now() - runtime.startTime) / 1000),
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
  logger.info(`${signal} sinyali alındı. Kapatılıyor...`);
  if (_memTimer) clearInterval(_memTimer);

  if (runtime.manager) {
    // Wait for all sessions to close (max 10s)
    await Promise.race([
      runtime.manager.stopAll(),
      new Promise(r => setTimeout(r, 10000))
    ]);
  }

  shutdownCache();
  if (fs.existsSync(PID_FILE)) try { fs.unlinkSync(PID_FILE); } catch { }
  logger.info("Sistem temiz bir şekilde kapatıldı.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Global hata yakalama — Bot çökmesini engeller ─────────────────────────
process.on("uncaughtException", (err) => {
  if (err.code === "ERR_IPC_DISCONNECTED") return;
  logger.error(err, "[KRİTİK] Beklenmedik İstisna (uncaughtException)");
  // Kritik sistem hatası değilse devam et — process.exit() KULLANMA
});

process.on("unhandledRejection", (reason, promise) => {
  // Yalnızca loglama yap — süreci öldürme
  // Her komut handler try-catch ile sarıldığı için bu nadiren tetiklenir
  if (reason?.code === "ERR_IPC_DISCONNECTED") return;
  logger.error({ reason: String(reason), promise }, "[KRİTİK] Yakalanmamış Promise Rejection");
  // process.exit() is intentionally omitted — bot should survive rejections
});

// ─────────────────────────────────────────────────────────
//  Auth Session Cleanup (Point 15)
// ─────────────────────────────────────────────────────────
function startSessionCleanup() {
  const dashAuthDir = path.join(__dirname, 'sessions', 'dashboard-auth');
  if (!fs.existsSync(dashAuthDir)) return;

  const cleanup = () => {
    try {
      const files = fs.readdirSync(dashAuthDir);
      const now = Date.now();
      let count = 0;
      for (const f of files) {
        const fp = path.join(dashAuthDir, f);
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > 7 * 24 * 60 * 60 * 1000) { // 7 days
          fs.unlinkSync(fp);
          count++;
        }
      }
      if (count > 0) logger.info(`[Cleanup] ${count} eski dashboard oturum dosyası silindi.`);
    } catch (e) { }
  };
  cleanup(); // Run at startup
  setInterval(cleanup, 24 * 60 * 60 * 1000); // 1x per day
}

(async () => {
  try {
    checkSingleInstance();
    await initializeDatabase();
    applyDatabaseCaching();
    startSessionCleanup();
    // startKeepAlive(); // Disabled redundant server to let Dashboard take port 3000

    const manager = new BotManager();
    runtime.manager = manager;
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