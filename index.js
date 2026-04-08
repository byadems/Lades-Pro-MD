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
    if (usedMb > PM2_RESTART_MB + 20) process.exit(1);
  }
}, 120000);

function startKeepAlive() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    const mem = process.memoryUsage();
    res.end(JSON.stringify({
      status: "ok", bot: "Lades-Pro-MD",
      uptime: Math.floor((Date.now() - global.botStartTime) / 1000),
      memory: Math.round(mem.heapUsed / 1024 / 1024) + "MB"
    }));
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
    const dashboardPath = path.join(__dirname, 'scripts', 'dashboard.js');
    if (fs.existsSync(dashboardPath)) {
      const dashboard = fork(dashboardPath, [], {
        stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, NODE_ENV: 'production' }
      });

      // Forward QR and Status from BotManager to Dashboard
      manager.on('qr', (data) => {
        if (dashboard.connected) dashboard.send({ type: 'qr', qr: data.qr });
      });
      manager.on('status', (data) => {
        const isConnected = data.status === 'open';
        if (dashboard.connected) {
          const sock = manager.getSession(data.sessionId);
          dashboard.send({
            type: 'bot_status',
            data: {
              connected: isConnected,
              phone: sock?.user?.id ? sock.user.id.split('@')[0].split(':')[0] : null
            }
          });
        }
      });

      let isLogging = false;
      const sendLog = (d) => {
        if (isLogging || !dashboard || !dashboard.connected) return;
        const s = d.toString();
        if (s.length < 5 || s.includes('rootKey')) return;
        isLogging = true;
        try { dashboard.send({ type: 'log', data: s }); } catch (e) { }
        isLogging = false;
      };

      dashboard.stdout?.on('data', (d) => { process.stdout.write(d); sendLog(d); });
      dashboard.stderr?.on('data', (d) => { process.stderr.write(d); sendLog(d); });

      dashboard.on('message', async (msg) => {
        if (msg.type === 'broadcast') {
          const sock = manager.getSession('lades-session');
          if (sock) {
            const { jid, message } = msg.data;
            if (jid === 'all') {
              const chats = await sock.groupFetchAllParticipating();
              const groupJids = Object.keys(chats).slice(0, 300); // Limit to max 300 groups
              
              const { default: PQueue } = await import('p-queue');
              const queue = new PQueue({ concurrency: 1, interval: 3000, intervalCap: 1 });
              
              for (const j of groupJids) {
                queue.add(async () => {
                  try {
                    await sock.sendMessage(j, { text: message });
                  } catch (err) {
                    logger.error({ jid: j, err: err.message }, "Broadcast failed for group");
                  }
                });
              }
            } else {
              try {
                await sock.sendMessage(jid.includes('@') ? jid : jid + '@s.whatsapp.net', { text: message });
              } catch (err) {
                logger.error({ jid, err: err.message }, "Broadcast failed");
              }
            }
          }
        } else if (msg.type === 'restart') {
          const restartType = msg.restartType || 'session';
          if (restartType === 'system') {
            const child = fork(__filename, process.argv.slice(2), { detached: true, stdio: 'inherit' });
            child.unref();
            process.exit(0);
          } else {
            logger.info("Bot oturumu yenileniyor (Resume triggered)...");
            manager.resume("lades-session");
            await manager.removeSession("lades-session", false);
            await manager.addSession("lades-session", { phoneNumber: process.env.PAIR_PHONE });
          }
        } else if (msg.type === 'dashboard_login_complete') {
          // Dashboard completed login - copy credentials to main session
          logger.info("Dashboard girişi tamamlandı. Oturum aktarılıyor...");
          try {
            const authDir = msg.authDir;
            const credsFile = require('path').join(authDir, 'creds.json');
            if (require('fs').existsSync(credsFile)) {
              const { WhatsappSession } = require('./core/database');
              const credsData = JSON.parse(require('fs').readFileSync(credsFile, 'utf-8'));
              const keysData = {};
              const keyFiles = require('fs').readdirSync(authDir).filter(f => f !== 'creds.json' && f.endsWith('.json'));
              for (const kf of keyFiles) {
                try {
                  const kd = JSON.parse(require('fs').readFileSync(require('path').join(authDir, kf), 'utf-8'));
                  // Key files are named like: pre-key-123.json → type=pre-key, id=123
                  const baseName = kf.replace('.json', '');
                  const lastDash = baseName.lastIndexOf('-');
                  if (lastDash > 0) {
                    const type = baseName.substring(0, lastDash);
                    const id = baseName.substring(lastDash + 1);
                    if (type && id) {
                      keysData[type] = keysData[type] || {};
                      keysData[type][id] = kd;
                    }
                  }
                } catch { }
              }
              const sessionData = JSON.stringify({ creds: credsData, keys: keysData });
              await WhatsappSession.upsert({ sessionId: 'lades-session', sessionData });
              logger.info("Oturum verisi 'lades-session' DB'ye aktarıldı.");
            } else {
              logger.warn("dashboard_login_complete: creds.json bulunamadı! Aktarım atlandı.");
            }
          } catch (e) {
            logger.error({ err: e.message }, "Oturum aktarım hatası");
          }
          // CRITICAL: Remove existing (possibly fake/waiting) session before resuming
          // Without this, addSession sees the existing fakeSock and returns early → bot never starts!
          manager.resume("lades-session");
          await manager.removeSession("lades-session", false);
          // Brief pause to ensure cleanup is complete  
          await new Promise(r => setTimeout(r, 500));
          await manager.addSession("lades-session", { phoneNumber: process.env.PAIR_PHONE });
        } else if (msg.type === 'stop') {
          logger.info(`Dashboard ${msg.isLogout ? 'Kapatma' : 'Durdurma'} sinyali alındı. Suspending...`);
          manager.suspend("lades-session");
          await manager.removeSession("lades-session", !!msg.isLogout);
          if (dashboard.connected) {
            dashboard.send({ type: 'bot_status', data: { connected: false } });
            dashboard.send({ type: 'ready_to_login' });
          }
        }
      });

      process.removeAllListeners('dashboard_activity');
      process.on('dashboard_activity', (act) => {
        if (dashboard.connected) dashboard.send({ type: 'activity', data: act });
      });

      process.removeAllListeners('test_progress');
      process.on('test_progress', (prog) => {
        if (dashboard.connected) dashboard.send({ type: 'test_progress', data: prog });
      });

      const statusTimer = setInterval(() => {
        const isConnected = manager.isConnected('lades-session');
        const sock = manager.getSession('lades-session');
        if (dashboard.connected) {
          dashboard.send({
            type: 'bot_status',
            data: {
              connected: isConnected,
              phone: sock?.user?.id ? sock.user.id.split('@')[0].split(':')[0] : null
            }
          });
        } else {
          clearInterval(statusTimer);
        }
      }, 5000);

      dashboard.on('exit', () => clearInterval(statusTimer));
    }

    logger.info("Lades-Pro-MD Aktif!");
  } catch (err) {
    logger.error(err, "Kritik Hata");
    process.exit(1);
  }
})();
