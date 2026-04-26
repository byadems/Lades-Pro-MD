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

  let _dashboardRef = dashboard; // Module-level reference

  /**
   * sendIPC
   * Sends a message to the dashboard and optionally waits for a response based on requestId.
   */
  async function sendIPC(type, data = {}, requestId = null, timeoutMs = 5000) {
    if (!_dashboardRef || !_dashboardRef.connected) return;

    return new Promise((resolve, reject) => {
      const payload = { type, data, requestId };
      
      let timer = null;
      const handler = (msg) => {
        if (requestId && msg.requestId === requestId) {
          if (timer) clearTimeout(timer);
          _dashboardRef.off('message', handler);
          resolve(msg);
        }
      };

      if (requestId) {
        timer = setTimeout(() => {
          _dashboardRef.off('message', handler);
          reject(new Error(`IPC Timeout: ${type} (${requestId})`));
        }, timeoutMs);
        _dashboardRef.on('message', handler);
      }

      try {
        _dashboardRef.send(payload, (err) => {
          if (err) {
            if (timer) clearTimeout(timer);
            _dashboardRef.off('message', handler);
            reject(err);
          } else if (!requestId) {
            resolve({ success: true });
          }
        });
      } catch (e) {
        if (timer) clearTimeout(timer);
        _dashboardRef.off('message', handler);
        reject(e);
      }
    });
  }

  // --- BOT -> DASHBOARD EVENTS ---

  manager.on('qr', (data) => {
    sendIPC('qr', { qr: data.qr }).catch(() => {});
  });

  manager.on('status', (data) => {
    const isConnected = data.status === 'open';
    const sock = manager.getSession(data.sessionId);
    sendIPC('bot_status', {
      connected: isConnected,
      phone: sock?.user?.id ? sock.user.id.split('@')[0].split(':')[0] : null
    }).catch(() => {});
  });

  // --- LOG STREAMING ---

  let isLogging = false;
  const sendLog = (d) => {
    if (isLogging || !_dashboardRef || !_dashboardRef.connected) return;
    const s = d.toString();
    if (s.length < 5 || s.includes('rootKey')) return;
    isLogging = true;
    try { 
      _dashboardRef.send({ type: 'log', data: s }); 
    } catch (e) { }
    isLogging = false;
  };

  dashboard.stdout?.on('data', (d) => { process.stdout.write(d); sendLog(d); });
  dashboard.stderr?.on('data', (d) => { process.stderr.write(d); sendLog(d); });

  // --- BROADCAST QUEUE (Singleton) ---
  let _broadcastQueue = null;
  async function getBroadcastQueue() {
    if (!_broadcastQueue) {
      const { default: PQueue } = await import('p-queue');
      _broadcastQueue = new PQueue({ concurrency: 1, interval: 3000, intervalCap: 1 });
    }
    return _broadcastQueue;
  }

  // --- DASHBOARD -> BOT MESSAGES ---

  dashboard.on('message', async (msg) => {
    const sock = manager.getSession('lades-session');
    
    // 1. Broadcast / Send Logic
    if (msg.type === 'broadcast') {
      if (sock) {
        const { jid, message, broadcastType } = msg.data;
        const isCommand = broadcastType === 'command';

        const runAction = async (targetJid) => {
          try {
            const finalJid = targetJid.includes('@') ? targetJid : targetJid + '@s.whatsapp.net';
            
            if (isCommand) {
              // Simüle edilmiş komut yürütme
              const { handleMessage } = require("./handler");
              const { fetchGroupMeta } = require("./store");
              const { isGroup } = require("./yardimcilar");
              
              const botJid = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
              const rawMsg = {
                key: {
                  remoteJid: finalJid,
                  fromMe: true,
                  id: 'DASHBOARD_BC_' + Date.now(),
                  participant: botJid
                },
                participant: botJid,
                message: { conversation: message },
                pushName: 'Kontrol Paneli (Toplu)',
                messageTimestamp: Math.floor(Date.now() / 1000)
              };

              let groupMeta = null;
              if (isGroup(finalJid)) groupMeta = await fetchGroupMeta(sock, finalJid);
              
              await handleMessage(sock, rawMsg, groupMeta);
            } else {
              // Standart mesaj gönderimi
              await sock.sendMessage(finalJid, { text: message });
            }
          } catch (err) {
            logger.error({ jid: targetJid, err: err.message, type: broadcastType }, "Yayın işlemi başarısız");
          }
        };

        if (jid === 'all') {
          const chats = await getAllGroups(sock);
          const groupJids = Object.keys(chats).slice(0, 300);
          const queue = await getBroadcastQueue();
          
          for (const j of groupJids) {
            queue.add(() => runAction(j));
          }
        } else {
          // Tekli hedef (genelde app.js zaten döngüyle tekli gönderiyor ama API desteği tam olsun)
          await runAction(jid);
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
          sendIPC('groups_result', groupList, msg.requestId).catch(() => {});
        } catch (e) {
          sendIPC('groups_result', { error: e.message }, msg.requestId).catch(() => {});
        }
      } else {
        sendIPC('groups_result', { error: 'Bot bağlı değil' }, msg.requestId).catch(() => {});
      }
    } else if (msg.type === 'fetch_group_pp') {
      if (sock) {
        try {
          const jid = msg.data.jid;
          const imgUrl = await Promise.race([
            sock.profilePictureUrl(jid, 'preview').catch(() => null),
            new Promise(r => setTimeout(() => r(null), 2000))
          ]);
          sendIPC('group_pp_result', { jid, imgUrl }, msg.requestId).catch(() => {});
        } catch (e) {
          sendIPC('group_pp_result', { jid: msg.data.jid, imgUrl: null }, msg.requestId).catch(() => {});
        }
      }
    } else if (msg.type === 'send_to_chat') {
       if (sock) {
         try {
           const jid = msg.data.jid.includes('@') ? msg.data.jid : msg.data.jid + '@s.whatsapp.net';
           await sock.sendMessage(jid, { text: msg.data.text });
           sendIPC('send_result', { success: true }, msg.requestId).catch(() => {});
         } catch (e) {
           sendIPC('send_result', { success: false, error: e.message }, msg.requestId).catch(() => {});
         }
       } else {
         sendIPC('send_result', { success: false, error: 'Bot bağlı değil' }, msg.requestId).catch(() => {});
       }
    } else if (msg.type === 'execute_command') {
      if (sock) {
        try {
          const { handleMessage } = require("./handler");
          const { fetchGroupMeta } = require("./store");
          const { isGroup } = require("./yardimcilar");
          
          const jid = msg.data.jid.includes('@') ? msg.data.jid : msg.data.jid + '@s.whatsapp.net';
          const command = msg.data.command;
          
          // Bottan geliyormuş gibi (Sahip/Sudo yetkisiyle) bir mesaj simüle et
          const botJid = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
          const rawMsg = {
            key: {
              remoteJid: jid,
              fromMe: true,
              id: 'DASHBOARD_' + Date.now(),
              participant: botJid
            },
            participant: botJid,
            message: {
              conversation: command
            },
            pushName: 'Kontrol Paneli',
            messageTimestamp: Math.floor(Date.now() / 1000)
          };

          let groupMeta = null;
          if (isGroup(jid)) {
            groupMeta = await fetchGroupMeta(sock, jid);
          }

          console.log(`[DASHBOARD] Komut yürütülüyor: "${command}" -> ${jid}`);
          
          // Komutu botun içinde çalıştır
          await handleMessage(sock, rawMsg, groupMeta);
          sendIPC('send_result', { success: true }, msg.requestId).catch(() => {});
        } catch (e) {
          console.error(`[DASHBOARD ERROR] Komut yürütme başarısız:`, e);
          sendIPC('send_result', { success: false, error: e.message }, msg.requestId).catch(() => {});
        }
      } else {
        sendIPC('send_result', { success: false, error: 'Bot bağlı değil' }, msg.requestId).catch(() => {});
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
        const { WhatsappOturum } = require('./database');
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
          await WhatsappOturum.upsert({ sessionId: 'lades-session', sessionData });
          logger.info("Oturum verisi 'lades-session' DB'ye aktarıldı.");

          // ── KRİTİK: dashboard-auth klasörünü sil ───────────────────────────
          // Bir sonraki yeniden başlatmada getAuthState, dashboard-auth'u ÖNCE kontrol eder.
          // Klasör duruyorsa bot bu geçici (ve artık geçersiz) oturumu kullanır → bozulur.
          // DB'ye aktarım tamamlandıktan HEMEN SONRA silerek DB önceliğini garanti altına al.
          try {
            fs.rmSync(authDir, { recursive: true, force: true });
            logger.info(`[Auth] dashboard-auth dizini temizlendi (DB'ye aktarım tamamlandı): ${authDir}`);
          } catch (cleanErr) {
            logger.warn({ err: cleanErr.message }, "[Auth] dashboard-auth temizlenemedi, sonraki restart'ta sorun çıkabilir.");
          }
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
      sendIPC('bot_status', { connected: false }).catch(() => {});
      sendIPC('ready_to_login').catch(() => {});
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

  // --- STATUS POLLING (Migrated to Scheduler) ---

  const scheduler = require("./zamanlayici").scheduler;
  const statusTask = scheduler.register('dashboard_status_polling', () => {
    if (!_dashboardRef || !_dashboardRef.connected) return;
    const isConnected = manager.isConnected('lades-session');
    const sock = manager.getSession('lades-session');
    sendIPC('bot_status', {
      connected: isConnected,
      phone: sock?.user?.id ? sock.user.id.split('@')[0].split(':')[0] : null
    }).catch(() => {});
  }, 5000, { runImmediately: true });

  dashboard.on('exit', () => {
    _dashboardRef = null;
    statusTask(); // Unregister task
  });

  return dashboard;
}

module.exports = { setupDashboardBridge };
