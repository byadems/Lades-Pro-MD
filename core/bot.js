"use strict";

/**
 * core/bot.js
 * Creates a Baileys socket, manages connection state,
 * binds all event handlers, and implements reconnect logic.
 */

const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const { logger, ...config } = require("../config");
const { getAuthState, displayQR } = require("./auth");
const { bindToSocket, fetchGroupMeta } = require("./store");
const { handleMessage, handleGroupUpdate, handleGroupParticipantsUpdate, loadPlugins } = require("./handler");
const { getNumericalId, getMessageText, isGroup, suppressLibsignalLogs, startTempCleanup, stopTempCleanup, loadBaileys } = require("./helpers");
const runtime = require("./runtime");
const { WhatsappSession, sequelize } = require("./database");
const { migrateSudoToLID } = require("./lid-helper");
const { startSchedulers } = require("./schedulers");
const { runSelfTest } = require("./self-test");
let _queue = null;
async function getMessageQueue() {
  if (!_queue) {
    const { default: PQueue } = await import('p-queue');
    _queue = new PQueue({ concurrency: 5 });
  }
  return _queue;
}

// ─────────────────────────────────────────────────────────
//  Reconnect state constants
// ─────────────────────────────────────────────────────────
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;

// ─────────────────────────────────────────────────────────
//  Create bot instance
// ─────────────────────────────────────────────────────────
async function createBot(sessionId = "lades-session", options = {}) {
  let reconnectCount = options.reconnectCount || 0;
  let selfTestRan = false;
  let pairCodeRequested = false;
  // Load Baileys library dynamically (ESM)
  const { 
    default: makeWASocket, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore, 
    Browsers, 
    proto 
  } = await loadBaileys();

  // --- SESSION MIGRATION & HEALTH CHECK ---
  const sessionsDir = path.join(__dirname, "..", "sessions", sessionId);
  const credsFile = path.join(sessionsDir, "creds.json");
  
  // 1. Migration: If file exists but DB is empty, migrate to DB
  const MIGRATION_FLAG = path.join(sessionsDir, ".migrated");
  const credsExists = await fsp.access(credsFile).then(() => true).catch(() => false);
  const flagExists = await fsp.access(MIGRATION_FLAG).then(() => true).catch(() => false);

  if (credsExists && !flagExists) {
    try {
      let shouldMove = false;
      
      await sequelize.transaction(async (t) => {
        // Use lock to prevent concurrent migrations during multi-instance boot
        const existingInDb = await WhatsappSession.findByPk(sessionId, { transaction: t, lock: true });
        if (!existingInDb) {
          logger.info(`Oturum senkronizasyonu: Yerel dosyadan veri tabanına aktarılıyor (${sessionId})...`);
          const data = await fsp.readFile(credsFile, 'utf-8');
          const creds = JSON.parse(data);
          await WhatsappSession.create({ 
            sessionId, 
            sessionData: JSON.stringify({ creds, keys: {} }) 
          }, { transaction: t });
          shouldMove = true;
        }
      });

      if (shouldMove) {
        // Create flag to prevent future re-migration attempts
        await fsp.writeFile(MIGRATION_FLAG, Date.now().toString());
        // Rename folder only after DB commit
        await fsp.rename(sessionsDir, sessionsDir + "_migrated_" + Date.now());
        logger.info("Oturum taşıma başarıyla tamamlandı.");
      }
    } catch (e) {
      logger.warn({ err: e.message }, "Oturum taşıma sırasında hata oluştu");
    }
  }

  const { state, saveCreds, clearState } = await getAuthState(config, sessionId);
  
  // CRITICAL: Validate session before attempting connection.
  // If creds are empty or missing cryptographic keys, do NOT connect - let the dashboard handle login.
  const hasValidSession = state.creds 
    && state.creds.me 
    && state.creds.signedPreKey
    && state.creds.signedPreKey.keyPair;
    
  if (!hasValidSession) {
    logger.info(`[${sessionId}] Geçerli oturum bulunamadı. Dashboard üzerinden giriş yapılması bekleniyor...`);
    // Return a minimal fake socket so manager doesn't crash
    // The dashboard will handle the actual login flow
    const fakeSock = createFakeSocket(sessionId);
    // Emit events that manager needs
    setTimeout(() => {
      fakeSock.ev.emit('connection.update', { connection: 'waiting_for_login' });
    }, 100);
    return fakeSock;
  }

  // 2. Health Check: Detect corrupted registered=false state
  if (state.creds && state.creds.me && state.creds.registered === false) {
    logger.warn(`[Sağlık Kontrolü] Oturum 'kayıtlı değil' (registered: false) olarak işaretlenmiş. Onarılıyor...`);
    state.creds.registered = true; // Attempt fix
    await saveCreds(); 
  }

  const { version } = await fetchLatestBaileysVersion().catch(() => ({
    version: [2, 3000, 1017531287],
  }));

  logger.info(`Lades-Pro-MD Başlatılıyor (Baileys ${version.join(".")})`);

  const sock = makeWASocket({
    version,
    logger: logger.child({ module: "baileys", level: config.DEBUG ? "debug" : "warn" }),
    printQRInTerminal: false, // We handle QR ourselves
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger.child({ module: "signal", level: config.DEBUG ? "debug" : "warn" })),
    },
    browser: Browsers.ubuntu("Chrome"),
    getMessage: async (key) => {
      const { getMessageByKey } = require("./store");
      const msg = getMessageByKey(key);
      return msg ? msg.message : proto.Message.fromObject({});
    },
    syncFullHistory: false,
    markOnlineOnConnect: !options.markOffline,
    defaultQueryTimeoutMs: 60000,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    retryRequestDelayMs: 500,
    maxMsgRetryCount: 5,
  });

  // Store events
  bindToSocket(sock);

  // --- ALBUM MESSAGE IMPLEMENTATION ---
  sock.albumMessage = async (jid, medias, options = {}) => {
    const { generateWAMessageFromContent, prepareWAMessageMedia, proto } = await loadBaileys();
    const albumMedias = [];
    
    for (const media of medias) {
      try {
        const type = media.image ? "imageMessage" : "videoMessage";
        const content = media.image || media.video;
        
        let mediaPayload;
        
        if (content.url) {
          // If it's a URL (local path or http), pass it directly so Baileys can use it for ffmpeg
          mediaPayload = { url: content.url };
        } else if (Buffer.isBuffer(content)) {
          mediaPayload = content;
        } else if (typeof content === 'string') {
          // Assume local path
          mediaPayload = { url: content };
        } else {
          continue;
        }

        const prepared = await prepareWAMessageMedia({
          [media.image ? "image" : "video"]: mediaPayload
        }, { upload: sock.waUploadToServer });
        
        const msg = prepared[type];
        if (media.caption) msg.caption = media.caption;
        
        // Add mimetype if missing (required for correct rendering in album)
        if (!msg.mimetype) {
          msg.mimetype = media.image ? "image/jpeg" : "video/mp4";
        }
        
        albumMedias.push({ type, msg });
      } catch (err) {
        logger.error({ err: err.message }, "Error preparing album media");
      }
    }

    if (albumMedias.length === 0) return null;

    // Generate the parent AlbumMessage
    const albumMsg = await generateWAMessageFromContent(jid, {
      messageContextInfo: {
        deviceListMetadata: {},
        deviceListMetadataVersion: 2
      },
      albumMessage: {
        expectedImageCount: albumMedias.filter(m => m.type === "imageMessage").length,
        expectedVideoCount: albumMedias.filter(m => m.type === "videoMessage").length,
      }
    }, { quoted: options.quoted || options });

    // Send the parent AlbumMessage first
    await sock.relayMessage(jid, albumMsg.message, { messageId: albumMsg.key.id });

    // Send each media as a child of the AlbumMessage
    for (let i = 0; i < albumMedias.length; i++) {
      const { type, msg } = albumMedias[i];
      
      const childContent = {
        [type]: msg,
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2,
          messageAssociation: {
            associationType: 1, // proto.MessageAssociation.AssociationType.MEDIA_ALBUM
            parentMessageKey: albumMsg.key,
            messageIndex: i
          }
        }
      };

      const individualMsg = await generateWAMessageFromContent(jid, childContent, { quoted: options.quoted || options });
      
      await sock.relayMessage(jid, individualMsg.message, { messageId: individualMsg.key.id });
      await new Promise(r => setTimeout(r, 200)); // Small delay to maintain order
    }

    return albumMsg;
  };


  // Credential updates → save to DB/file
  sock.ev.on("creds.update", saveCreds);

  // ── Connection events ────────────────────────────────
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr, isNewLogin } = update;

    // CRITICAL: If suspended (dashboard is and should be in control), do nothing!
    if (options.manager && options.manager.isSuspended(sessionId)) {
      if (connection === "close") logger.info(`[Suspended] Connection closed for ${sessionId}. Ignoring.`);
      return; 
    }

    if (qr) {
      displayQR(qr);
      if (options.manager) {
        options.manager.emit("qr", { sessionId, qr });
      }
      
      // If pair code is enabled and not yet requested
      if (options.phoneNumber && !pairCodeRequested) {
        pairCodeRequested = true;
        setTimeout(async () => {
          try {
            const code = await sock.requestPairingCode(options.phoneNumber);
            logger.info(`📱 Eşleşme Kodu: ${code}`);
            if (process.send) process.send({ type: 'qr', qr: code }); // Send pair code as 'qr' type for simplicity in dashboard
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📱 Telefonunuzda WhatsApp > Bağlı Cihazlar > Cihaz Bağla\n   Kod: ${code}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
          } catch (err) {
            logger.error({ err }, "Pair code request failed");
          }
        }, 3000);
      }
    }

    if (connection === "open") {
      // Reconnect sayacını sıfırla (manager üzerinden de sıfırlanmalı)
      reconnectCount = 0;
      if (options.manager) options.manager.reconnectCount = 0;
      pairCodeRequested = false;
      logger.info(`✅ Bot bağlandı! JID: ${sock.user?.id}`);
      if (process.send) process.send({ type: 'bot_status', data: { connected: true, phone: sock.user.id } });
      
      // MIGRATION: Convert SUDO numbers to LIDs (Raganork-MD style)
      try {
        await migrateSudoToLID(sock);
      } catch (e) {
        logger.warn({ err: e.message }, "SUDO to LID migration failed");
      }
      
      // Force "Online" state on connect to update Last Seen
      await sock.sendPresenceUpdate('available').catch(() => {});
      
      startTempCleanup();

      // Load plugins and schedulers on first connect
      const pluginsDir = path.join(__dirname, "..", "plugins");
      await loadPlugins(pluginsDir);
      await startSchedulers(sock);

      // Self-test: tüm komutları ilk bağlantıda test et
      if (process.env.SELF_TEST !== 'false' && !selfTestRan) {
        selfTestRan = true;
        setTimeout(async () => {
          try {
            await runSelfTest(sock);
          } catch (e) {
            logger.warn({ err: e.message }, "Self-test atlandı");
          }
        }, 3000);
      }
    }

    if (connection === "close") {
      stopTempCleanup();
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn({ statusCode, shouldReconnect }, `Bağlantı kesildi.`);

      if (shouldReconnect) {
        reconnectCount++;
        const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectCount - 1), RECONNECT_MAX_MS);
        logger.info(`${delay}ms içinde yeniden bağlanılıyor (Deneme ${reconnectCount})...`);

        if (reconnectCount > 15) {
            logger.error("Maksimum yeniden bağlanma denemesine ulaşıldı. Oturum duraklatılıyor.");
            if (process.send) process.send({ type: 'bot_status', data: { connected: false, error: 'Maksimum yeniden bağlanma denemesi aşıldı.' } });
            if (options.manager) {
              options.manager.suspend(sessionId);
              options.manager.removeSession(sessionId, false);
            }
            return;
        }

        setTimeout(async () => {
          sock.ev.removeAllListeners(); // Temizlik
          const newSock = await createBot(sessionId, { ...options, reconnectCount });
          if (options.manager) {
            options.manager.updateSocket(sessionId, newSock);
          }
        }, delay);
      } else {
        // Manual dashboard stop/logout - still clear state if it's a full logout
        if (sock.__intentionalLogout) {
          logger.info("Oturum manuel olarak kapatıldı. Veriler temizleniyor...");
          await clearState().catch(() => {});
          return;
        }

        logger.error("Oturum kapatıldı! Lütfen yeniden doğrulama yapın.");
        // Oturum geçersiz olduğunda HEM yerel dosyayı HEM veri tabanını temizleyelim
        try {
          await clearState(); // NEW: Clear database sessionData
          const sessionsDir = path.join(__dirname, "..", "sessions", sessionId);
          const credsFile = path.join(sessionsDir, "creds.json");
          if (fs.existsSync(credsFile)) {
            fs.unlinkSync(credsFile);
            logger.info("Geçersiz creds.json silindi.");
          }
          
          // NEW: Trigger a fresh connection attempt to get the QR code
          // BUT: Only if NOT suspended (dashboard should handle it otherwise)
          if (options.manager && options.manager.isSuspended(sessionId)) {
            logger.info(`Session ${sessionId} is suspended. Skipping auto-restart.`);
            return;
          }

          logger.info("Yeni oturum için taze bir bağlantı başlatılıyor (10sn içinde)...");
          setTimeout(async () => {
            if (options.manager && options.manager.isSuspended(sessionId)) {
              logger.info(`Session ${sessionId} was suspended during wait. Aborting restart.`);
              return;
            }
            const newSock = await createBot(sessionId, options);
            if (options.manager) {
              options.manager.updateSocket(sessionId, newSock);
            }
          }, 10000);
        } catch (e) {
          logger.warn({ err: e.message }, "Oturum verileri temizlenemedi");
        }
        
        if (process.send) process.send({ type: 'bot_status', data: { connected: false } });
        return;
      }
    }

    if (connection === "connecting") {
      logger.info("WhatsApp'a bağlanılıyor...");
    }
  });

  // ── Message events ───────────────────────────────────
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;
    for (const msg of messages) {
      if (!msg.message) continue;
      const jid = msg.key.remoteJid;
      if (!jid) continue;

      const fromMe = msg.key.fromMe;
      const text = getMessageText(msg.message);
      const isChannelJid = jid.endsWith('@newsletter');

      // Use p-queue to prevent memory spikes in large groups (Point 5 & 17)
      try {
        const q = await getMessageQueue();
        q.add(async () => {
          try {
            if (config.DEBUG) console.log(`[RAW UPSERT] JID: ${jid} | Channel: ${isChannelJid} | Text: "${text?.slice(0, 30)}..."`);
            let groupMeta = null;
            // Grup metadatası yalnızca @g.us grupları için çekilir
            // Kanallar (@newsletter) için null kalır — handler.js bunu zaten destekliyor
            if (isGroup(jid)) {
              groupMeta = await fetchGroupMeta(sock, jid);
            }
            await handleMessage(sock, msg, groupMeta);
          } catch (err) {
            logger.error({ err, jid }, "Mesaj işleme hatası (upsert)");
          }
        });
      } catch (err) {
        // Fallback or early error
        handleMessage(sock, msg).catch(() => {});
      }
    }
  });


  // ── Group events ─────────────────────────────────────
  sock.ev.on("groups.update", async (updates) => {
    for (const update of updates) {
      await handleGroupUpdate(sock, update);
    }
  });

  sock.ev.on("group-participants.update", async (update) => {
    await handleGroupParticipantsUpdate(sock, update);
  });

  // ── Call events (reject if needed) ───────────────────
  sock.ev.on("call", async (calls) => {
    for (const call of calls) {
      if (call.status === "offer" && process.env.REJECT_CALLS === "true") {
        await sock.rejectCall(call.id, call.from).catch(() => {});
      }
    }
  });

  return sock;
}

module.exports = { createBot };

/**
 * createFakeSocket
 * Returns a Proxy that mimics a Baileys socket to prevent crashes while waiting for login.
 */
function createFakeSocket(sessionId) {
  const { EventEmitter } = require('events');
  const ev = new EventEmitter();
  
  return new Proxy(ev, {
    get(target, prop) {
      if (prop === 'ev') return ev;
      if (prop === 'user') return null;
      if (prop === '__isWaitingForLogin') return true;
      if (prop === 'ws') return { close: () => { }, readyState: 3 };
      
      // Methods that must return promises to avoid 'await' crashes
      const asyncMethods = ['sendMessage', 'groupMetadata', 'profilePictureUrl', 'groupFetchAllParticipating'];
      if (asyncMethods.includes(prop)) {
        return async () => {
          if (prop === 'sendMessage') throw new Error("Oturum henüz başlatılmadı. Lütfen cihaz bağlayın.");
          if (prop === 'groupMetadata') return { participants: [] };
          return null;
        };
      }

      // Default for unknown methods/props
      if (typeof prop === 'string') {
        logger.debug({ sessionId, prop }, `FakeSocket: ${prop} called but not active`);
      }
      
      return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
    }
  });
}
