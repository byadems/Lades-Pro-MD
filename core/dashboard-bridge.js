"use strict";

const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getAllGroups } = require("./store");

/**
 * setupDashboardBridge
 * Consolidates all IPC logic for the dashboard.
 * Prevents code duplication in index.js.
 */
function setupDashboardBridge(manager, config) {
  const { logger } = config;
  const dashboardPath = path.join(__dirname, '..', 'scripts', 'dashboard.js');
  
  if (!fs.existsSync(dashboardPath)) return null;

  const dashboard = fork(dashboardPath, [], {
    stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'production', PORT: process.env.PORT || 3000 }
  });

  // Export to global for situational access if needed
  global.dashboard = dashboard;

  // --- BOT -> DASHBOARD EVENTS ---

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

  // --- LOG STREAMING ---

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

  // --- DASHBOARD -> BOT MESSAGES ---

  dashboard.on('message', async (msg) => {
    const sock = manager.getSession('lades-session');
    
    // 1. Broadcast / Send Logic
    if (msg.type === 'broadcast') {
      if (sock) {
        const { jid, message } = msg.data;
        if (jid === 'all') {
          const chats = await getAllGroups(sock);
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
    } 
    // 2. Data Fetching Logic (Groups, PP)
    else if (msg.type === 'fetch_groups') {
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
    }
    // 3. Lifecycle Logic (Restart, Stop, Session Transfer)
    else if (msg.type === 'restart') {
      const restartType = msg.restartType || (msg.data && msg.data.type) || 'session';
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
        const { WhatsappSession } = require('./database');
        const authDir = msg.authDir;
        const credsFile = path.join(authDir, 'creds.json');
        if (fs.existsSync(credsFile)) {
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

  // --- SYSTEM EVENT FORWARDING ---

  process.removeAllListeners('dashboard_activity');
  process.on('dashboard_activity', (act) => {
    if (dashboard.connected) dashboard.send({ type: 'activity', data: act });
  });

  process.removeAllListeners('test_progress');
  process.on('test_progress', (prog) => {
    if (dashboard.connected) dashboard.send({ type: 'test_progress', data: prog });
  });

  // --- STATUS POLLING ---

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

  dashboard.on('exit', () => clearInterval(statusTimer));

  return dashboard;
}

module.exports = { setupDashboardBridge };
