"use strict";

const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

function setupDashboardBridge(manager, config) {
  const { logger } = config;
  const dashboardPath = path.join(__dirname, '..', 'scripts', 'dashboard.js');
  
  if (!fs.existsSync(dashboardPath)) return null;

  const dashboard = fork(dashboardPath, [], {
    stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'production' }
  });

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
          const groupJids = Object.keys(chats).slice(0, 300);
          
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
        const mainFile = path.join(__dirname, '..', 'index.js');
        const child = fork(mainFile, process.argv.slice(2), { detached: true, stdio: 'inherit' });
        child.unref();
        process.exit(0);
      } else {
        logger.info("Bot oturumu yenileniyor (Resume triggered)...");
        manager.resume("lades-session");
        await manager.removeSession("lades-session", false);
        await manager.addSession("lades-session", { phoneNumber: process.env.PAIR_PHONE });
      }
    } else if (msg.type === 'dashboard_login_complete') {
      logger.info("Dashboard girişi tamamlandı. Oturum aktarılıyor...");
      try {
        const authDir = msg.authDir;
        const credsFile = path.join(authDir, 'creds.json');
        if (fs.existsSync(credsFile)) {
          const { WhatsappSession } = require('./database');
          const credsData = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
          const keysData = {};
          const keyFiles = fs.readdirSync(authDir).filter(f => f !== 'creds.json' && f.endsWith('.json'));
          for (const kf of keyFiles) {
            try {
              const kd = JSON.parse(fs.readFileSync(path.join(authDir, kf), 'utf-8'));
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
      manager.resume("lades-session");
      await manager.removeSession("lades-session", false);
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

  return dashboard;
}

module.exports = { setupDashboardBridge };
