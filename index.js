"use strict";

/**
 * index.js - Lades-MD Entry Point
 * Memory watchdog, event loop monitor, graceful shutdown.
 */

const path = require("path");
const fs = require("fs");
const { monitorEventLoopDelay } = require("perf_hooks");
const http = require("http");

if (fs.existsSync("./config.env")) require("dotenv").config({ path: "./config.env" });
else if (fs.existsSync("./.env")) require("dotenv").config({ path: "./.env" });

const config = require("./config");
const { logger } = config;
const { initializeDatabase } = require("./core/database");
const { BotManager } = require("./core/manager");
const { suppressLibsignalLogs, startTempCleanup } = require("./core/helpers");
const { applyDatabaseCaching, shutdownCache } = require("./core/db-cache");

suppressLibsignalLogs();
startTempCleanup();

// Global startup time tracking
global.botStartTime = Date.now();

// ─────────────────────────────────────────────────────────
//  Memory monitor
// ─────────────────────────────────────────────────────────
const HEAP_WARN_MB = Math.floor((config.HEAP_LIMIT_MB || 512) * 0.75);
const PM2_RESTART_MB = config.PM2_RESTART_LIMIT_MB || 450;
let _memTimer = null;

function startMemoryMonitor() {
  _memTimer = setInterval(() => {
    const heap = process.memoryUsage();
    const usedMb = Math.round(heap.heapUsed / 1024 / 1024);
    if (usedMb > PM2_RESTART_MB) {
      logger.error({ usedMb, limit: PM2_RESTART_MB }, "Bellek limitine ulaşıldı - yeniden başlatılıyor");
      if (global.gc) global.gc();
      if (usedMb > PM2_RESTART_MB + 20) process.exit(1);
    } else if (usedMb > HEAP_WARN_MB) {
      logger.warn({ usedMb, warn: HEAP_WARN_MB }, "Yüksek bellek kullanımı");
      if (global.gc) global.gc();
    }
  }, 2 * 60 * 1000); // every 2 minutes
}

// ─────────────────────────────────────────────────────────
//  Keepalive HTTP server (for cloud platforms like Render)
// ─────────────────────────────────────────────────────────
function startKeepAlive(port = process.env.PORT || 3000) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    const mem = process.memoryUsage();
    res.end(JSON.stringify({
      status: "ok",
      bot: "Lades-Pro-MD",
      uptime: Math.floor((Date.now() - global.botStartTime) / 1000),
      memory: { heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + "MB" },
    }));
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`Port ${port} kullanımda, sunucu sessiz modda tutuluyor.`);
    } else {
      logger.error({ err }, "Keepalive sunucu hatası");
    }
  });
  server.listen(port, () => logger.info(`HTTP keepalive portu: ${port}`));
  return server;
}

// ─────────────────────────────────────────────────────────
//  Graceful shutdown
// ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`${signal} sinyali alındı. Kapatılıyor...`);
  if (_memTimer) clearInterval(_memTimer);
  shutdownCache();
  try {
    await config.sequelize.close();
    logger.info("Veri tabanı bağlantısı kapatıldı.");
  } catch {}
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Beklenmedik hata (Uncaught exception)");
  if (err.code === "ERR_IPC_DISCONNECTED") return;
});
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Yakalanmamış reddedilme (Unhandled rejection)");
});

// ─────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────
(async () => {
  try {
    logger.info("Lades-Pro-MD başlatılıyor...");

    // Database
    await initializeDatabase();
    applyDatabaseCaching();

    // Start the manager
    const manager = new BotManager();

    // Parse options
    const phoneNumber = process.env.PAIR_PHONE || null;
    await manager.addSession("lades-session", { phoneNumber });

    // Memory monitor
    startMemoryMonitor();

    // Keepalive server (Port 3000)
    startKeepAlive();

    // Start Dashboard (Port 3001) in an isolated process
    try {
      const { fork } = require('child_process');
      const dashboardPath = path.join(__dirname, 'scripts', 'dashboard.js');
      if (fs.existsSync(dashboardPath)) {
        const dashboard = fork(dashboardPath, [], {
          stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
          execArgv: ['--no-warnings'],
          env: { ...process.env, NODE_ENV: 'production' }
        });

        const sendLog = (d) => {
           if (!dashboard || !dashboard.connected) return;
           const s = d.toString();
           // Gürültülü protokol loglarını filtrele (Hex dökümleri, teknik anahtar verileri vb.)
           if (s.includes('previousCounter') || s.includes('rootKey') || s.includes('RemoteIdentityKey')) return;
           if (/[0-9a-fA-F]{2} [0-9a-fA-F]{2} [0-9a-fA-F]{2}/.test(s)) return;
           
           dashboard.send({ type: 'log', data: s });
        };

        dashboard.stdout?.on('data', (d) => process.stdout.write(d));
        dashboard.stderr?.on('data', (d) => process.stderr.write(d));

        const _stdoutWrite = process.stdout.write;
        process.stdout.write = function(chunk) {
          sendLog(chunk);
          return _stdoutWrite.apply(process.stdout, arguments);
        };
        const _stderrWrite = process.stderr.write;
        process.stderr.write = function(chunk) {
          sendLog(chunk);
          return _stderrWrite.apply(process.stderr, arguments);
        };

        // Broadcast stats and system health every 3 seconds
        setInterval(() => {
          if (dashboard && dashboard.connected) {
            const mem = process.memoryUsage();
            dashboard.send({
              type: 'metrics',
              data: {
                messages: global.metrics_messages || 0,
                commands: global.metrics_commands || 0,
                users: global.metrics_users_set ? global.metrics_users_set.size : 0,
                groups: global.metrics_groups_set ? global.metrics_groups_set.size : 0,
                memHeap: Math.round(mem.heapUsed / 1024 / 1024),
                memMax: Math.round(mem.heapTotal / 1024 / 1024),
                cpuLoad: (process.cpuUsage().user / 1000000).toFixed(2) // Simulating load
              }
            });
          }
        }, 3000);

        // Listen to dashboard messages
        dashboard.on('message', async (msg) => {
          if (msg.type === 'broadcast') {
            const { jid, message } = msg.data;
            try {
              if (manager && manager.bots.has('lades-session')) {
                const sock = manager.bots.get('lades-session');
                if (sock) {
                   if (jid === 'all') {
                      // Broadcast to all active groups
                      const chats = await sock.groupFetchAllParticipating();
                      for (const j of Object.keys(chats)) {
                        await sock.sendMessage(j, { text: message });
                        await new Promise(r => setTimeout(r, 1000));
                      }
                   } else {
                      await sock.sendMessage(jid.includes('@') ? jid : jid + '@s.whatsapp.net', { text: message });
                   }
                }
              }
            } catch (err) {
              logger.error({ err }, "Dashboard broadcast hatası");
            }
          } else if (msg.type === 'restart') {
            logger.info("Yeniden başlatma sinyali alındı. Bot oturumu yenileniyor...");
            global.botStartTime = Date.now();
            if (dashboard && dashboard.connected) {
              dashboard.send({ type: 'reset_uptime' });
            }
            try {
              if (manager && manager.bots.has('lades-session')) {
                const sock = manager.bots.get('lades-session');
                sock.ev.removeAllListeners('connection.update');
                sock.ws.close();
                manager.bots.delete('lades-session');
              }
              const phoneNumber = process.env.PAIR_PHONE || null;
              await manager.addSession("lades-session", { phoneNumber });
              logger.info("Bot oturumu başarıyla yenilendi.");
            } catch (err) {
              logger.error({ err }, "Bot restart hatası");
            }
          }
        });

        // Listen for new activity events from anywhere and push
        process.on('dashboard_activity', (act) => {
          if (dashboard && dashboard.connected) {
            dashboard.send({ type: 'activity', data: act });
          }
        });
      }
    } catch (err) {
      logger.error({ err }, "Dashboard süreci başlatılamadı");
    }

    logger.info("Lades-Pro-MD çalışıyor!");
  } catch (err) {
    logger.error({ err }, "Kritik başlangıç hatası");
    process.exit(1);
  }
})();
