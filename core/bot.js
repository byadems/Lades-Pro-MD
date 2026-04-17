"use strict";

/**
 * core/bot.js
 * Creates a Baileys socket, manages connection state,
 * binds all event handlers, and implements reconnect logic.
 */

const path = require("path");
const fs = require("fs");
const https = require("https");
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
//  NTP Zaman Senkronizasyon Kontrolü
//  WhatsApp multi-device protokolü kriptografik zaman
//  damgaları kullandığından sistem saati kayması
//  "Cihazlar senkronize edilemedi" hatasına yol açar.
// ─────────────────────────────────────────────────────────

/** Sistem saatini worldtimeapi.org üzerinden kontrol eder.
 *  Drift > eşik değerini aşarsa true döner. */
async function checkTimeDrift(thresholdMs = 5000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.get(
      "https://worldtimeapi.org/api/ip",
      { timeout: 5000 },
      (res) => {
        let raw = "";
        res.on("data", (d) => (raw += d));
        res.on("end", () => {
          try {
            const rtt = Date.now() - t0;
            const serverMs = new Date(
              JSON.parse(raw).datetime
            ).getTime();
            const localMs = t0 + rtt / 2; // Ağ gecikmesini çıkar
            const driftMs = Math.abs(serverMs - localMs);
            if (driftMs > thresholdMs) {
              logger.warn(
                `[NTP] Sistem saati kayması tespit edildi: ${driftMs}ms` +
                ` (eşik: ${thresholdMs}ms). Yeniden bağlanma tetikleniyor.`
              );
              resolve(true);
            } else {
              logger.debug(`[NTP] Saat senkronizasyonu normal: ${driftMs}ms`);
              resolve(false);
            }
          } catch {
            resolve(false); // Parse hatası → güvenli geç
          }
        });
      }
    );
    req.on("error", () => resolve(false)); // Ağ hatası → güvenli geç
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
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

  logger.info(`Lades-Pro Başlatılıyor (Baileys ${version.join(".")})`);

  const { LRUCache } = require("lru-cache");
  const createNodeCacheAdapter = (max, ttl) => {
    const lru = new LRUCache({ max, ttl });
    return {
      get: (key) => lru.get(key),
      set: (key, value) => { lru.set(key, value); return true; },
      del: (key) => { lru.delete(key); },
      flushAll: () => { lru.clear(); }
    };
  };

  const sock = makeWASocket({
    version,
    logger: logger.child({ module: "baileys", level: config.DEBUG ? "debug" : "warn" }),
    printQRInTerminal: false, // We handle QR ourselves
    auth: {
      creds: state.creds,
      // Baileys 'useMultiFileAuthState' ve 'useDbAuthState' zaten state.keys'i cache ile sarmalar.
      // Çift önbellekleme (double-cache) durumunu ve bellek sızıntısını önlemek için direkt kullanıyoruz:
      keys: state.keys, 
    },
    msgRetryCounterCache: createNodeCacheAdapter(500, 5 * 60 * 1000), // Max 500 mesaj, 5 dk
    userDevicesCache: createNodeCacheAdapter(500, 5 * 60 * 1000), // Max 500 cihaz, 5 dk
    browser: Browsers.ubuntu("Chrome"),
    getMessage: async (key) => {
      const { getMessageByKey } = require("./store");
      const msg = getMessageByKey(key);
      return msg ? msg.message : undefined;
    },
    syncFullHistory: false,
    markOnlineOnConnect: !options.markOffline,
    defaultQueryTimeoutMs: 60000,
    connectTimeoutMs: 60000,
    // Keepalive aralığı: 15sn — 25sn'den kısa tutarak WA sunucusu
    // bağlantıyı stale (bayat) saymadan önce ping göndermesini sağlar.
    keepAliveIntervalMs: 15000,
    retryRequestDelayMs: 500,
    maxMsgRetryCount: 5,
  });

  // Store events
  bindToSocket(sock);

  // --- AUDIO MESSAGE PLAYBACK FIX (SES DOSYASI YÜRÜTME SORUNU) ---
  // WhatsApp'ın son güncellemeleri audio/mpeg veya hatalı gönderilmiş ptt: true mesajlarını çökertmektedir.
  // Bu yüzden tüm ses mesajlarını global olarak araya girip onarıyoruz.
  const originalSendMessage = sock.sendMessage;
  sock.sendMessage = async (jid, content, options) => {
    if (content && content.audio) {
      if (content.mimetype === "audio/mpeg") {
        content.mimetype = "audio/mp4"; // iOS ve modern WA Web MP4 mimetipi (M4A) istiyor
      }
      if (!content.mimetype) {
        content.mimetype = "audio/mp4";
      }
      // OGG OPUS codec ile encode edilmemiş PTT'ler yeni WA sürümlerinde çalışmaz
      // Normal ses dosyası (oynatma çubuğu olan) formatına çeviriyoruz
      if (content.ptt && (!content.mimetype.includes("ogg") && !content.mimetype.includes("opus"))) {
        content.ptt = false;
      }
    }
    return originalSendMessage.call(sock, jid, content, options);
  };

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
      
      // MIGRATION: Convert SUDO numbers to LIDs (Lades-Pro style)
      try {
        await migrateSudoToLID(sock);
      } catch (e) {
        logger.warn({ err: e.message }, "SUDO to LID migration failed");
      }
      
      // Force "Online" state on connect to update Last Seen
      await sock.sendPresenceUpdate('available').catch(() => {});
      
      startTempCleanup();

      // ── PLANLI MESAJ GÖNDERİCİSİ ────────────────────────────
      // Her 30 saniyede bir DB'deki zamanlanmış mesajları kontrol et.
      // Bu olmadan .planla komutu DB'ye yazar ama asla göndermez!
      const { scheduledMessages } = require('../plugins/utils/db/schedulers');
      const scheduler = require('./scheduler');

      scheduler.register('scheduled_message_sender', async () => {
        try {
          const due = await scheduledMessages.getDueForSending();
          if (due.length === 0) return;
          for (const item of due) {
            try {
              const msgData = JSON.parse(item.message);
              const mediaType = msgData._mediaType;
              delete msgData._mediaType;

              // Base64 string → Buffer dönüşümü (medya için)
              const toBuffer = (b64) => Buffer.isBuffer(b64) ? b64 : Buffer.from(b64, 'base64');
              if (msgData.image) msgData.image = toBuffer(msgData.image);
              if (msgData.video) msgData.video = toBuffer(msgData.video);
              if (msgData.audio) msgData.audio = toBuffer(msgData.audio);
              if (msgData.document) msgData.document = toBuffer(msgData.document);
              if (msgData.sticker) msgData.sticker = toBuffer(msgData.sticker);

              await sock.sendMessage(item.jid, msgData);
              logger.info(`[Planlı] Mesaj gönderildi → ${item.jid}`);
            } catch (e) {
              logger.error({ err: e.message, jid: item.jid }, '[Planlı] Mesaj gönderilemedi');
            } finally {
              // Gönderilen veya hata veren mesajı her durumda DB'den sil
              await scheduledMessages.markAsSent(item.id).catch(() => {});
            }
          }
        } catch (e) {
          logger.debug({ err: e.message }, '[Planlı] Scheduler döngüsünde hata');
        }
      }, 30000, { runImmediately: false });
      // ── PLANLI MESAJ GÖNDERİCİSİ SONU ──────────────────────

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

      // ── SAAT KAYMA ENGELLEYİCİ ───────────────────────────
      // 1) Periyodik presence güncellemesi (her 4 dakikada bir)
      //    WA sunucusunun bağlantıyı stale (bayat) saymasını önler.
      const PRESENCE_INTERVAL_MS = 4 * 60 * 1000; // 4 dakika
      const _presenceTimer = setInterval(async () => {
        if (!sock.user) return; // Bağlantı kopmuşsa geç
        try {
          await sock.sendPresenceUpdate('available');
          logger.debug('[Keepalive] Presence güncellendi.');
        } catch {
          // Bağlantı kopuksa sessizce geç — reconnect mekanizması zaten devrede
        }
      }, PRESENCE_INTERVAL_MS);

      // 2) Saat kayması izleyicisi + 6 saatlik proaktif yeniden bağlanma
      //    WhatsApp multi-device protokolü kriptografik zaman damgaları kullandığından
      //    sistem saati kayması "Cihazlar senkronize edilemedi" hatasına yol açar.
      const NTP_CHECK_INTERVAL_MS  = 30 * 60 * 1000;  // 30 dakikada bir NTP kontrolü
      const PROACTIVE_RECONNECT_MS =  6 * 60 * 60 * 1000; // 6 saatte bir zorla yeniden bağlan

      const _ntpTimer = setInterval(async () => {
        if (!sock.user) return;
        try {
          const hasDrift = await checkTimeDrift(5000); // 5sn eşik
          if (hasDrift) {
            logger.warn('[NTP] Saat kayması kritik seviyede. Bağlantı yenileniyor...');
            clearInterval(_presenceTimer);
            clearInterval(_ntpTimer);
            clearInterval(_proactiveTimer);
            // Mevcut soketi kapat — connection.update 'close' tetikleyecek
            // ve reconnect mantığı devreye girecek
            sock.ws?.close();
          }
        } catch {
          // Güvenli geç
        }
      }, NTP_CHECK_INTERVAL_MS);

      const _proactiveTimer = setInterval(async () => {
        if (!sock.user) return;
        logger.info('[Proaktif] 6 saatlik oturum yenileme tetiklendi. Saat kaymalarını önlemek için yeniden bağlanılıyor...');
        clearInterval(_presenceTimer);
        clearInterval(_ntpTimer);
        clearInterval(_proactiveTimer);
        sock.ws?.close();
      }, PROACTIVE_RECONNECT_MS);

      // Bağlantı kesilince tüm timer'ları temizle
      sock.ev.once('connection.update', ({ connection: c }) => {
        if (c === 'close') {
          clearInterval(_presenceTimer);
          clearInterval(_ntpTimer);
          clearInterval(_proactiveTimer);
        }
      });
      // ── SAAT KAYMA ENGELLEYİCİ SONU ────────────────────
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
