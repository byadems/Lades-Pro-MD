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
    const dashboardPath = path.join(__dirname, 'scripts', 'dashboard.js');
    if (fs.existsSync(dashboardPath)) {
      global.dashboard = fork(dashboardPath, [], {
        stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, NODE_ENV: 'production', PORT: process.env.PORT || 3000 }
      });
      const dashboard = global.dashboard;

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
              const chats = await getAllGroups(sock);
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
        } else if (msg.type === 'fetch_groups') {
          const sock = manager.getSession('lades-session');
          if (sock) {
            try {
              const groups = await getAllGroups(sock);
              const groupList = Object.values(groups).map(g => ({
                jid: g.id,
                subject: g.subject,
                participants: g.participants?.length || 0,
                owner: g.owner || null,
              }));
              if (dashboard.connected) dashboard.send({ type: 'groups_result', data: groupList, requestId: msg.requestId });
            } catch (e) {
              if (dashboard.connected) dashboard.send({ type: 'groups_result', data: [], requestId: msg.requestId, error: e.message });
            }
          } else {
            if (dashboard.connected) dashboard.send({ type: 'groups_result', data: [], requestId: msg.requestId, error: 'Bot bağlı değil' });
          }
        } else if (msg.type === 'fetch_group_pp') {
          const sock = manager.getSession('lades-session');
          if (sock) {
            try {
              const jid = msg.data.jid;
              const imgUrl = await Promise.race([
                sock.profilePictureUrl(jid, 'preview').catch(() => null),
                new Promise(r => setTimeout(() => r(null), 2000))
              ]);
              if (dashboard.connected) dashboard.send({ type: 'group_pp_result', jid, imgUrl, requestId: msg.requestId });
            } catch (e) {
              if (dashboard.connected) dashboard.send({ type: 'group_pp_result', jid: msg.data.jid, imgUrl: null, requestId: msg.requestId });
            }
          }
        } else if (msg.type === 'send_to_chat') {
          const sock = manager.getSession('lades-session');
          if (sock) {
            try {
              const jid = msg.data.jid.includes('@') ? msg.data.jid : msg.data.jid + '@s.whatsapp.net';
              await sock.sendMessage(jid, { text: msg.data.text });
              if (dashboard.connected) dashboard.send({ type: 'send_result', success: true, requestId: msg.requestId });
            } catch (e) {
              if (dashboard.connected) dashboard.send({ type: 'send_result', success: false, error: e.message, requestId: msg.requestId });
            }
          } else {
            if (dashboard.connected) dashboard.send({ type: 'send_result', success: false, error: 'Bot bağlı değil', requestId: msg.requestId });
          }
        } else if (msg.type === 'restart') {
          const restartType = msg.restartType || (msg.data && msg.data.type) || 'session';
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
            const credsFile = path.join(authDir, 'creds.json');
            if (fs.existsSync(credsFile)) {
              const credsData = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
              const keysData = {};
              const keyFiles = fs.readdirSync(authDir).filter(f => f !== 'creds.json' && f.endsWith('.json'));
              for (const kf of keyFiles) {
                try {
                  const kd = JSON.parse(fs.readFileSync(path.join(authDir, kf), 'utf-8'));
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
              logger.info("Oturum veritabanına kaydedildi.");
            }
          } catch (e) {
            logger.error(e, "Oturum aktarma hatası");
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
        if (!dashboard || !dashboard.connected) {
          clearInterval(statusTimer);
          return;
        }
        const isConnected = manager.isConnected('lades-session');
        const sock = manager.getSession('lades-session');
        dashboard.send({
          type: 'bot_status',
          data: {
            connected: isConnected,
            phone: sock?.user?.id ? sock.user.id.split('@')[0].split(':')[0] : null
          }
        });
      }, 5000);

      dashboard.on('exit', () => {
        clearInterval(statusTimer);
      });
      dashboard.on('error', () => {
        clearInterval(statusTimer);
      });
    }

    logger.info("Lades-Pro-MD Aktif!");
  } catch (err) {
    logger.error(err, "Kritik Hata");
    process.exit(1);
  }
})();