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
const { getNumericalId, getMessageText, isGroup, suppressLibsignalLogs, startTempCleanup, stopTempCleanup, loadBaileys } = require("./yardimcilar");
const runtime = require("./runtime");
const { WhatsappOturum, sequelize } = require("./database");
const { migrateSudoToLID } = require("./yardimcilar");
const { startSchedulers } = require("./zamanlayici");
const { runSelfTest } = require("./self-test");
// ── Libsignal gürültüsünü modül yüklenirken hemen bastır ──────────────────
// process.stderr.write seviyesinde intercept: libsignal'ın "Bad MAC", "Session error"
// gibi hataları doğrudan stderr'e yazar; console.* override'ları bunları yakalamaz.
// Bu çağrı socket oluşturulmadan önce olmalı — bu yüzden module-scope'ta.
suppressLibsignalLogs();

// ── PQueue: module-level başlat (lazy async init overhead'i önce)
let _queue = null;
let _queueReady = false;
let _firstConnectDone = false; // loadPlugins + startSchedulers sadece 1 kez çalışsın

// Pre-warm: Bot başlar başlamaz queue'yu hazırla
import('p-queue').then(({ default: PQueue }) => {
  // concurrency: 8  — Eş zamanlı işleme sayısı
  // intervalCap kaldırıldı: Rate-limit kuyruk darboğazına yol açıyordu
  _queue = new PQueue({ concurrency: 8 });
  _queueReady = true;
}).catch(() => { /* fallback: create on demand */ });

async function getMessageQueue() {
  if (_queue) return _queue;
  const { default: PQueue } = await import('p-queue');
  _queue = new PQueue({ concurrency: 8 });
  _queueReady = true;
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

// ── Timer Leak Koruması: Tüm interval referansları dış scope'ta tutulur
// Her yeni 'connection.update → open' olayında önce clearInterval çağrılır.
let _presenceTimer = null;
let _ntpTimer = null;
let _proactiveTimer = null;
let _watchdogTimer = null;
let _heartbeatTimer = null;
let _heartbeatTimeout = null;
let _heartbeatMsgKey = null;
let _lastActivity = Date.now();

// scheduled_message_sender ve otomasyonun tekrar kayıt olmamasını sağlayan guardlar
let _scheduledMsgRegistered = false;
let _automationRegistered = false;

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
        const existingInDb = await WhatsappOturum.findByPk(sessionId, { transaction: t, lock: true });
        if (!existingInDb) {
          logger.info(`Oturum senkronizasyonu: Yerel dosyadan veri tabanına aktarılıyor (${sessionId})...`);
          const data = await fsp.readFile(credsFile, 'utf-8');
          const creds = JSON.parse(data);
          await WhatsappOturum.create({ 
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

  // ── PLUGİNLERİ ÖNCEDEN YÜKLE ───────────────────────────────────────────
  // NEDEN BURADA: loadPlugins socket'ten ÖNCE çağrılmalı.
  // connection.update içinde await loadPlugins() yaparsak, messages.upsert
  // aynı anda tetiklenebilir ve commands[] hâlâ boşken komutlar işlenemez.
  // Socket oluşmadan önce yüklersek, ilk mesaj geldiğinde komutlar hazırdır.
  if (!_firstConnectDone) {
    const pluginsDir = path.join(__dirname, "..", "plugins");
    await loadPlugins(pluginsDir);
    logger.info(`[Init] Pluginler socket öncesinde yüklendi — komutlar hazır.`);
  }

  const { state, saveCreds, clearState, clearSessions } = await getAuthState(config, sessionId);
  
  // SESSION VALIDATION: Sadece 'me' (bağlı telefon) varlığını kontrol et.
  // signedPreKey gibi kriptografik alanları zorunlu kılmıyoruz — deploy sonrası
  // DB'den yüklenen session'da bu alanlar geçici olarak eksik gelebilir ve
  // Baileys bunları handshake sırasında kendisi yeniler.
  // KURAL: Eğer 'me' yoksa (hiç giriş yapılmamış), o zaman QR/pair code iste.
  const hasValidSession = !!(state.creds && state.creds.me);
    
  if (!hasValidSession) {
    logger.info(`[${sessionId}] Kayıtlı oturum bulunamadı. Dashboard üzerinden giriş yapılması bekleniyor...`);
    const fakeSock = createFakeSocket(sessionId);
    setTimeout(() => {
      fakeSock.ev.emit('connection.update', { connection: 'waiting_for_login' });
    }, 100);
    return fakeSock;
  }

  // HEALTH CHECK 1: registered:false durumunu onar
  if (state.creds && state.creds.me && state.creds.registered === false) {
    logger.warn(`[Sağlık] registered:false tespit edildi, onarılıyor...`);
    state.creds.registered = true;
    await saveCreds(true); // force=true: hemen kaydet, throttle bekleme
  }

  // HEALTH CHECK 2: signedPreKey eksikse uyar ama bağlanmaya devam et
  // Baileys handshake sırasında sunucudan prekey'leri senkronize edecek
  if (state.creds && state.creds.me && !state.creds.signedPreKey) {
    logger.warn(`[Sağlık] signedPreKey eksik — Baileys handshake sırasında senkronize edecek.`);
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

  let decryptionErrorCount = 0;
  let lastDecryptionErrorAt = 0;
  let _isClosing = false; // Çift kapatma koruması
  let _lastRepairAt = 0;  // Onarım cooldown — art arda onarım döngüsünü önler
  let _connectedAt = 0;   // Bağlantı zamanı — startup grace period için

  /**
   * Zombie socket bırakmadan bağlantıyı kapat.
   * sock.end() yerine ws.terminate() kullanır — graceful handshake beklemiyor.
   */
  function gracefulClose(reason = 'Manual close') {
    if (_isClosing) return;
    _isClosing = true;
    logger.debug(`[GracefulClose] ${reason}`);
    try {
      // 1. Event pipeline'ı kes — pending ACK/receipt handler'ları iptal et
      // NOT: removeAllListeners ÇAĞIRILMIYOR — connection.update'in çalışması gerekiyor
      // sock.ev.removeAllListeners(); // Bu satır kasıtlı yorum satırı!
      
      // 2. WebSocket'i anında kapat (terminate = graceful handshake yok = hızlı)
      if (sock.ws && sock.ws.readyState !== 3 /* CLOSED */) {
        try { sock.ws.terminate(); } catch { try { sock.ws.close(); } catch { } }
      }
    } catch (e) {
      logger.debug(`[GracefulClose] Hata: ${e.message}`);
    }
  }

  // ── Baileys Özel Log Filtresi (Stream) ──
  // Baileys alt-log (child) üretse bile tüm loglar bu akıştan (stream) geçmek zorundadır.
  const baileysLogDestination = {
    write(chunk) {
      if (!chunk) return;
      const raw = chunk.toString();
      try {
        const logData = JSON.parse(raw);
        
        // ── STREAM HATASI YAKALAMA (503 vb.) ──
        if (logData.msg === "stream errored out" || (logData.node && logData.node.tag === "stream:error")) {
          logger.warn(`[Bağlantı] WhatsApp stream hatası tespit edildi (${logData.node?.attrs?.code || 'bilinmiyor'}). Zorla yeniden bağlanılıyor...`);
          gracefulClose("Stream Errored Out");
          return;
        }


        // ── Şifre çözme hatalarını ikiye ayır ──────────────────────────────────────
        // TİP 1 — "No session found": YENİ CİHAZ NORMAL DAVRANIŞI
        //   Sebebi: Bot yeni giriş yapınca grup üyeleri mesajlarını ESKİ session
        //   key'leriyle şifrelemiş. Bot'un bu keyleri yok → açamaz.
        //   Çözümü: Baileys retry receipt gönderir, karşı taraf yeniden şifreler.
        //   clearSessions() çağırmak YANLIŞ — elindeki yeni keyleri de silersin!
        //
        // TİP 2 — "Bad MAC" / "SessionError": GERÇEK BOZUKLUK
        //   Sebebi: Var olan session key'i bozuk/eskimiş → şifre doğrulaması başarısız.
        //   Çözümü: clearSessions() ile bozuk keyleri temizle, yeniden müzakere başlasın.
        const isNoSessionError = !!(
          logData.err?.message?.includes('No session found') ||
          logData.err?.message?.includes('No SenderKey found') ||
          (logData.msg && logData.msg.includes('Failed to decrypt message with any known session'))
        );

        const isRealDecryptionError = !!(
          logData.err?.type === 'MessageCounterError' ||
          logData.err?.type === 'SessionError' ||
          (logData.msg && (
            logData.msg.includes('Bad MAC') ||
            logData.msg.includes('Session error') ||
            logData.msg.includes('Closing open session') ||
            logData.msg.includes('Decrypted message with closed session')
          )) ||
          (logData.err?.message && logData.err.message.includes('Bad MAC'))
        );

        const isDecryptionError = isNoSessionError || isRealDecryptionError ||
          (logData.msg && logData.msg.includes('failed to decrypt'));

        if (isDecryptionError) {
          const now = Date.now();

          // TİP 1: "No session found" — sadece sessizce say, clearSessions ASLA tetikleme
          if (isNoSessionError) {
            // Bu tamamen normaldir: yeni girişten sonra ~2-5 dakika içinde kendiliğinden düzelir.
            // Baileys kendi retry mekanizmasıyla karşı tarafa yeniden şifreleme isteği gönderir.
            return; // Sayaca ekleme, ekrana basma, hiçbir şey yapma
          }

          // TİP 2: Gerçek bozukluk — sayaca ekle, eşikte clearSessions çalıştır
          if (now - lastDecryptionErrorAt > 30000) {
            decryptionErrorCount = 0;
          }
          decryptionErrorCount++;
          lastDecryptionErrorAt = now;

          if (decryptionErrorCount === 20) {
            logger.warn(`[Şifre] ${sessionId}: 20 gerçek şifre bozukluğu (Bad MAC/SessionError) birikti.`);
          }

          // ── SONSUZ DÖNGÜ ÖNLEYICI ─────────────────────────────────────────────
          // Sadece TİP 2 (gerçek bozukluk) 100 kez birikirse session cache temizle.
          if (decryptionErrorCount >= 100) {
            decryptionErrorCount = 0;

            // Startup grace period: yeni giriş sonrası 120sn onarım yapma
            const timeSinceConnect = _connectedAt > 0 ? now - _connectedAt : Infinity;
            if (timeSinceConnect < 120000) {
              logger.warn(`[Şifre] ${sessionId}: Startup grace (${Math.round(timeSinceConnect/1000)}sn/120sn). Onarım ertelendi.`);
              return;
            }

            // Cooldown: Son onarımdan bu yana 5 dakika geçmediyse tekrar onarım yapma
            const timeSinceRepair = now - _lastRepairAt;
            if (_lastRepairAt > 0 && timeSinceRepair < 5 * 60 * 1000) {
              logger.warn(`[Şifre] ${sessionId}: Onarım cooldown aktif (${Math.round(timeSinceRepair/1000)}sn / 300sn). Atlandı.`);
              return;
            }

            _lastRepairAt = now;
            logger.warn(`[Şifre] ${sessionId}: 100 deşifre hatası — session cache temizleniyor (bağlantı KORUNUYOR)...`);

            // Sadece bozuk session cache'ini temizle — SOCKET'İ ASLA KAPATMA
            // Socket kapatmak sonsuz döngüye girer.
            if (clearSessions) {
              clearSessions().catch(() => {});
            }
            // NOT: gracefulClose() ÇAĞIRILMIYOR — bu kasıtlı tasarım kararıdır.
          }
          
          // UYARI EKRANINI KİRLETMEMEK İÇİN BU LOGU SESSİZCE YUT
          return; 
        }

        // Level kontrolü: warn (40) altındaki hiçbir logı yazma
        // (pino seviyesi ile çäşmayabilir — burada da filtrele)
        if (!config.DEBUG && logData.level < 40) return;

        // Lades-Pro'nun diğer gereksiz Baileys loglarını engelleme (konsol spam engeli)
        const strLog = JSON.stringify(logData);
        if (strLog.includes("signalstore") || strLog.includes("libsignal") || strLog.includes("SessionEntry")) {
           return;
        }

        // Sadece warn+ seviyeli logları yazdır
        if (config.DEBUG || logData.level >= 40) {
          process.stdout.write(raw + '\n');
        }
      } catch (e) {
        // Parse hatası: JSON olmayan binary veri — sessizce yut
        // (eski kod: parse hatasında her şeyi yazdırıyordu → debug flood)
      }
    }
  };

  // Baileys logger: sadece warn+ seviyesi (level:40) geçer
  // Bu sayede level:20 (debug) receipt/event buffer logları filtrelenir
  const pino = require('pino');
  const baileysLogger = pino({ 
    level: "warn",  // < 40 seviyeli hiçbir log write()'a ulaşamaz
    name: "baileys"
  }, baileysLogDestination);


  const sock = makeWASocket({
    version,
    logger: baileysLogger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: state.keys, 
    },
    msgRetryCounterCache: createNodeCacheAdapter(50, 5 * 60 * 1000),
    userDevicesCache: createNodeCacheAdapter(50, 5 * 60 * 1000),
    browser: Browsers.ubuntu("Chrome"),
    getMessage: async (key) => {
      const { getMessageByKey } = require("./store");
      const msg = getMessageByKey(key);
      return msg ? msg.message : undefined;
    },
    syncFullHistory: false,
    markOnlineOnConnect: !options.markOffline,
    defaultQueryTimeoutMs: 60000,  // 60s: Allow time for large group metadata fetch
    connectTimeoutMs: 60000,       // 60s: Allow time for connection
    keepAliveIntervalMs: 15000,
    retryRequestDelayMs: 500,
    maxMsgRetryCount: 5,
  });

  // Store events
  bindToSocket(sock);

  // ─── iOS UYUMLU SESLİ MESAJ (PTT) DÜZELTİCİ ────────────────────────────────
  // Sorunun Doğrusu: iOS cihazlar, normal müzik dosyalarında "audio/mpeg" (MP3) 
  // açabilirler! Ancak bir ses mesajı (ptt: true) gönderiliyorsa, bunun KESİNLİKLE 
  // "audio/ogg; codecs=opus" formatında olması gerekir, aksi takdirde iOS'ta açılamaz.
  // Bu interceptor, şarkılara (ptt: false) ASLA DOKUNMAZ. Sadece MP3 olarak gelen 
  // sesli mesajları (ptt: true) OGG formatına dönüştürür.
  const { toOpus } = require('./media-utils');

  const originalSendMessage = sock.sendMessage;
  sock.sendMessage = async (jid, content, options) => {
    if (content && content.audio && content.ptt) {
      const mime = content.mimetype || '';
      
      // Eğer PTT ise ancak doğru kodek değilse dönüştürmemiz gerekir
      if (!mime.includes('ogg') && !mime.includes('opus')) {
        let audioBuf = null;

        if (Buffer.isBuffer(content.audio)) {
          audioBuf = content.audio;
        } else if (typeof content.audio.url === 'string') {
          const audioUrl = content.audio.url;
          const isLocalPath = !audioUrl.startsWith('http://') && !audioUrl.startsWith('https://');
          if (isLocalPath) {
            try {
              if (fs.existsSync(audioUrl)) {
                audioBuf = await fsp.readFile(audioUrl);
              }
            } catch (e) {
              logger.debug('[PttFix] Yerel dosya okunamadı:', e.message);
            }
          }
        }

        if (audioBuf) {
          try {
            content.audio = await toOpus(audioBuf);
            content.mimetype = 'audio/ogg; codecs=opus';
          } catch (e) {
            logger.debug('[PttFix] Opus dönüşümü başarısız, ptt iptal edildi:', e.message);
            content.ptt = false; // Dönüştürülemediyse düz müzik gibi gönder
          }
        } else {
          // Stream veya URL ise dönüştüremeyiz, oynatılabilir olması için ptt'yi kapat
          content.ptt = false;
        }
      }
    }
    return originalSendMessage.call(sock, jid, content, options);
  };


  // --- ALBUM MESSAGE IMPLEMENTATION ---
  let _baileysCache = null;
  sock.albumMessage = async (jid, medias, options = {}) => {
    if (!_baileysCache) {
      _baileysCache = await loadBaileys();
    }
    const { generateWAMessageFromContent, prepareWAMessageMedia, proto } = _baileysCache;
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

  // Watchdog için aktivite takibi
  sock.ev.on("messages.upsert", () => {
    _lastActivity = Date.now();
  });



  // ── Connection events ────────────────────────────────
  sock.ev.on("connection.update", async (update) => {
    // isOnline-only güncellemeleri debug seviyesinde logla (her 2-4 dk'da spam önleme)
    if (update.isOnline !== undefined && Object.keys(update).length === 1) {
      logger.debug({ update }, "[connection.update] isOnline");
    } else {
      logger.info({ update }, "[connection.update] Event emitted");
    }
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
      _connectedAt = Date.now(); // Startup grace period başlangıcı
      decryptionErrorCount = 0;  // Yeni bağlantıda sayacı sıfırla
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
      // Guard: Her reconnect'te tekrar register etmez (timer leak önlemi)
      if (!_scheduledMsgRegistered) {
        _scheduledMsgRegistered = true;
        const { scheduledMessages } = require("../plugins/utils/db/zamanlayicilar");
        const scheduler = require("./zamanlayici").scheduler;

        scheduler.register('scheduled_message_sender', async () => {
          try {
            const due = await scheduledMessages.getDueForSending();
            if (due.length === 0) return;
            for (const item of due) {
              try {
                const msgData = JSON.parse(item.message);
                delete msgData._mediaType;

                const toBuffer = (b64) => Buffer.isBuffer(b64) ? b64 : Buffer.from(b64, 'base64');
                if (msgData.image)    msgData.image    = toBuffer(msgData.image);
                if (msgData.video)    msgData.video    = toBuffer(msgData.video);
                if (msgData.audio)    msgData.audio    = toBuffer(msgData.audio);
                if (msgData.document) msgData.document = toBuffer(msgData.document);
                if (msgData.sticker)  msgData.sticker  = toBuffer(msgData.sticker);

                await sock.sendMessage(item.jid, msgData);
                logger.info(`[Planlı] Mesaj gönderildi → ${item.jid}`);
              } catch (e) {
                logger.error({ err: e.message, jid: item.jid }, '[Planlı] Mesaj gönderilemedi');
              } finally {
                await scheduledMessages.markAsSent(item.id).catch(() => {});
              }
            }
          } catch (e) {
            logger.debug({ err: e.message }, '[Planlı] Scheduler döngüsünde hata');
          }
        }, 30000, { runImmediately: false });
      }

      if (!_automationRegistered) {
        _automationRegistered = true;
        const { automute, autounmute } = require("../plugins/utils/db/zamanlayicilar");
        const moment = require("moment-timezone");
        const scheduler = require("./zamanlayici").scheduler;

        scheduler.register('group_automation_processor', async () => {
          try {
            const now = moment().tz("Europe/Istanbul");
            const currentTime = now.format("HH mm"); // DB formatı "HH MM"

            // 1. Otomatik Susturma (Mute)
            const mutes = await automute.get();
            for (const item of mutes) {
              if (item.time === currentTime) {
                try {
                  await sock.groupSettingUpdate(item.chat, "announcement");
                  await sock.sendMessage(item.chat, { 
                    text: `🔒 *Otomatik Grup Kapatma*\n\n⏰ Saat: \`${now.format("HH:mm")}\`\nℹ️ _Sohbet otomatik olarak kapatıldı._` 
                  });
                  logger.info(`[Otomasyon] Grup susturuldu: ${item.chat}`);
                } catch (e) {
                  logger.error({ err: e.message, chat: item.chat }, "[Otomasyon] Grup susturma hatası");
                }
              }
            }

            // 2. Otomatik Açma (Unmute)
            const unmutes = await autounmute.get();
            for (const item of unmutes) {
              if (item.time === currentTime) {
                try {
                  await sock.groupSettingUpdate(item.chat, "not_announcement");
                  await sock.sendMessage(item.chat, { 
                    text: `🔓 *Otomatik Grup Açma*\n\n⏰ Saat: \`${now.format("HH:mm")}\`\nℹ️ _Sohbet otomatik olarak açıldı. Keyifli sohbetler!_` 
                  });
                  logger.info(`[Otomasyon] Grup açıldı: ${item.chat}`);
                } catch (e) {
                  logger.error({ err: e.message, chat: item.chat }, "[Otomasyon] Grup açma hatası");
                }
              }
            }
          } catch (e) {
            logger.debug({ err: e.message }, '[Otomasyon] İşlemci döngüsünde hata');
          }
        }, 60000, { runImmediately: false });
      }
      // ── PLANLI MESAJ GÖNDERİCİSİ SONU ──────────────────────

      // startSchedulers: socket gerektirir, burada çalışması doğru.
      // loadPlugins: socket öncesinde (yukarıda) zaten çağrıldı.
      if (!_firstConnectDone) {
        _firstConnectDone = true;
        await startSchedulers(sock);
      }

      // Self-test: tüm komutları ilk bağlantıda test et
      if (config.SELF_TEST && !selfTestRan) {
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
      // Timer Leak Koruması: Önceki interval'lar varsa temizle,
      // sonra yeniden oluştur. Bu sayede her reconnect'te biriken
      // interval'lar önlenir.
      if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
      if (_ntpTimer)      { clearInterval(_ntpTimer);      _ntpTimer = null; }
      if (_proactiveTimer){ clearInterval(_proactiveTimer); _proactiveTimer = null; }
      if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null; }
      if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
      if (_heartbeatTimeout) { clearTimeout(_heartbeatTimeout); _heartbeatTimeout = null; }
      _lastActivity = Date.now();

      // --- Heartbeat Status (Bio/About only) ---
      // NOT: Pinned mesaj (delete+resend döngüsü) kaldırıldı.
      // Her silme/gönderme grup event'i üretiyordu → queue'ya giriyordu → kuyruk taşıyordu.
      // Sadece profil biyografisi güncellenir: sessiz, queue-free.
      const getBioText = () => `✅ ${new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })}`;

      _heartbeatTimeout = setTimeout(async () => {
        const doUpdate = async () => {
          if (!sock.user) return;
          const text = getBioText();
          try {
            await sock.updateProfileStatus(text);
            logger.debug(`[Heartbeat] Bio güncellendi: "${text}"`);
          } catch (e) {
            logger.debug(`[Heartbeat] Bio güncellenemedi: ${e.message}`);
          }
        };

        await doUpdate();
        _heartbeatTimer = setInterval(doUpdate, 10 * 60 * 1000); // Her 10 dakikada bir
      }, 15000);
      // --------------------------------

      // 1) Periyodik presence güncellemesi (her 4 dakikada bir)
      const PRESENCE_INTERVAL_MS = 4 * 60 * 1000;
      _presenceTimer = setInterval(async () => {
        if (!sock.user) return;
        try {
          await sock.sendPresenceUpdate('available');
          logger.debug('[Keepalive] Presence güncellendi.');
        } catch {
          // Bağlantı kopuksa sessizce geç
        }
      }, PRESENCE_INTERVAL_MS);

      // 2) Saat kayması izleyicisi — 60 dakikada bir (CPU tasarrufu)
      //    timeout 3s'e düşürüldü (event-loop blokajını azaltır)
      const NTP_CHECK_INTERVAL_MS  = 60 * 60 * 1000; // 60 dakika (30dk → 60dk)
      const PROACTIVE_RECONNECT_MS =  6 * 60 * 60 * 1000;

      _ntpTimer = setInterval(async () => {
        if (!sock.user) return;
        try {
          const hasDrift = await checkTimeDrift(3000);
          if (hasDrift) {
            logger.warn('[NTP] Saat kayması kritik. Graceful reconnect başlatılıyor...');
            if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
            if (_ntpTimer)      { clearInterval(_ntpTimer);      _ntpTimer = null; }
            if (_proactiveTimer){ clearInterval(_proactiveTimer); _proactiveTimer = null; }
            gracefulClose("NTP Time Drift");
          }
        } catch {
          // Güvenli geç
        }
      }, NTP_CHECK_INTERVAL_MS);

      _proactiveTimer = setInterval(async () => {
        if (!sock.user) return;
        logger.info('[Proaktif] 6 saatlik oturum yenileme...');
        if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
        if (_ntpTimer)      { clearInterval(_ntpTimer);      _ntpTimer = null; }
        if (_proactiveTimer){ clearInterval(_proactiveTimer); _proactiveTimer = null; }
        if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null; }
        gracefulClose("Proactive 6h reconnect");
      }, PROACTIVE_RECONNECT_MS);

      // 3) Watchdog Timer (Zombie socket koruması)
      const WATCHDOG_INTERVAL = 5 * 60 * 1000;   // Her 5 dk kontrol et
      const WATCHDOG_TIMEOUT_MS = 10 * 60 * 1000; // 10 dk hareketsizlik (eskiden 30dk)
      _watchdogTimer = setInterval(() => {
        if (!sock.user) return;
        if (Date.now() - _lastActivity > WATCHDOG_TIMEOUT_MS && sock.ws?.readyState === 1) {
          logger.warn('[Watchdog] 10 dakikadır hareket yok (Zombie socket). Zorla reconnect başlatılıyor...');
          if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
          if (_ntpTimer)      { clearInterval(_ntpTimer);      _ntpTimer = null; }
          if (_proactiveTimer){ clearInterval(_proactiveTimer); _proactiveTimer = null; }
          if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null; }
          gracefulClose("Watchdog timeout (Inactive)");
        }
      }, WATCHDOG_INTERVAL);
      // ── SAAT KAYMA ENGELLEYİCİ SONU ────────────────────
    }

    if (connection === "close") {
      // Timer Leak: bağlantı kesilince tüm interval'ları temizle
      if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
      if (_ntpTimer)      { clearInterval(_ntpTimer);      _ntpTimer = null; }
      if (_proactiveTimer){ clearInterval(_proactiveTimer); _proactiveTimer = null; }
      if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null; }
      if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
      if (_heartbeatTimeout) { clearTimeout(_heartbeatTimeout); _heartbeatTimeout = null; }
      stopTempCleanup();
      // Bağlantı kapanınca bekleyen mesaj işlemleri temizle (bellek aşımı engellenir)
      if (_queue) { try { _queue.clear(); } catch { } }
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      // ── LOGOUT KORUMA ─────────────────────────────────────────────────────────
      // WA sunucusu zaman zaman geçici 401 (loggedOut) sinyali gönderebilir.
      // Koşullardan HERHANGİ BİRİ sağlanıyorsa oturumu ASLA silme, yeniden bağlan:
      //   a) SESSION env mevcutsa (cloud ephemeral ortam)
      //   b) DB'den yüklenen geçerli oturum varsa (hasValidSession = creds.me mevcut)
      //   c) Kasıtlı logout DEĞİLSE (sock.__intentionalLogout !== true)
      // Sadece kasıtlı logout VE (SESSION env YOK VE DB oturumu YOK) durumunda sil.
      const isIntentionalLogout = sock.__intentionalLogout === true;
      const hasSessionEnv = !!(config.SESSION && config.SESSION.length > 20);
      // hasValidSession: createBot başında set edildi — creds.me varsa true
      const hasPersistedSession = hasValidSession || hasSessionEnv;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut ||
                              (!isIntentionalLogout && hasPersistedSession);
      
      // Geçici ağ hataları (stream hataları vb.) için sessiz reconnect loglaması
      if (statusCode === 515 || statusCode === 503 || statusCode === 408) {
        logger.warn(`Bağlantı kesildi (${statusCode} Stream Hatası). Yeniden bağlanılıyor...`);
      } else if (statusCode === 428) {
        logger.warn(`Bağlantı kesildi (428 Precondition Required). Kapanan bağlantı yenileniyor...`);
      } else if (statusCode === 440) {
        // 440 = conflict/replaced: Başka bir bağlantı bu oturumun yerini aldı.
        // Bu genellikle birden fazla socket aynı anda bağlanmaya çalıştığında olur.
        // Agresif reconnect YANLIŞ — daha fazla conflict üretir.
        // Çözüm: Eski soketi temizle, 5sn bekle, SADECE BİR KEZ yeniden bağlan.
        logger.warn(`[Conflict] Bağlantı 440 (replaced) ile kesildi. 5sn sonra tek seferlik reconnect...`);
        // reconnectCount'u sıfırla — bu bir conflict, art arda hata değil
        if (reconnectCount > 1) reconnectCount = 1;
      } else if (statusCode === DisconnectReason.loggedOut && !isIntentionalLogout) {
        logger.warn(
          `[KORUMA] WhatsApp 401 (loggedOut) gönderdi ama kasıtlı logout değil. ` +
          `Kalıcı oturum: ${hasPersistedSession ? 'VAR (SESSION env veya DB)' : 'YOK'} → ` +
          `${hasPersistedSession ? 'Yeniden bağlanılıyor (oturum KORUNUYOR).' : 'Oturum geçersiz sayılıyor.'}`
        );
      } else {
        logger.warn({ statusCode, shouldReconnect }, `Bağlantı kesildi.`);
      }

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
          // Event listener'ları temizle (memory leak + çift reconnect önlemi)
          try { sock.ev.removeAllListeners(); } catch { }
          _isClosing = false; // Yeni socket için sıfırla
          const newSock = await createBot(sessionId, { ...options, reconnectCount });
          if (options.manager) {
            options.manager.updateSocket(sessionId, newSock);
          }
        }, statusCode === 440 ? 5000 : delay); // 440 conflict: sabit 5sn bekle
      } else {
        // Kasıtlı logout (dashboard) veya SESSION olmayan gerçek 401
        if (isIntentionalLogout) {
          logger.info("Oturum manuel olarak kapatıldı. Veriler temizleniyor...");
          await clearState().catch(() => {});
          return;
        }

        logger.error("Oturum tamamen geçersiz! SESSION env olmadan QR/kod ile yeniden giriş gerekiyor.");
        try {
          await clearState();
          const sessionsDir = path.join(__dirname, "..", "sessions", sessionId);
          const credsFile = path.join(sessionsDir, "creds.json");
          if (fs.existsSync(credsFile)) {
            fs.unlinkSync(credsFile);
            logger.info("Geçersiz creds.json silindi.");
          }

          if (options.manager && options.manager.isSuspended(sessionId)) {
            logger.info(`Session ${sessionId} askıya alınmış. Otomatik yeniden başlatma atlandı.`);
            return;
          }

          logger.info("Yeni QR oturumu için bağlantı başlatılıyor (10sn içinde)...");
          setTimeout(async () => {
            if (options.manager && options.manager.isSuspended(sessionId)) return;
            const newSock = await createBot(sessionId, options);
            if (options.manager) options.manager.updateSocket(sessionId, newSock);
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
  // Deduplication: Aynı mesajın iki kez işlenmesini önle (60s temizleme)
  const processedMsgIds = new Set();
  setInterval(() => processedMsgIds.clear(), 60 * 1000).unref();

  const MAX_QUEUE_SIZE = 200;
  const MESSAGE_AGE_LIMIT = 5 * 60 * 1000; // 5 dakikadan eski mesajları işleme

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return; // Sadece canlı/yeni mesajları işle

    for (const msg of messages) {
      if (!msg.message) continue;
      const jid = msg.key.remoteJid;
      if (!jid) continue;
      const msgId = msg.key.id;

      // Deduplication: aynı mesajı iki kez işleme
      if (processedMsgIds.has(msgId)) continue;
      processedMsgIds.add(msgId);

      // Yaş filtresi: 5 dakikadan eski mesajları işleme (QR sonrası sync koruması)
      if (msg.messageTimestamp) {
        const age = Date.now() - (Number(msg.messageTimestamp) * 1000);
        if (age > MESSAGE_AGE_LIMIT) continue;
      }

      try {
        const q = await getMessageQueue();

        // BACKPRESSURE: Queue çok doluysa yeni mesajı kuyruğa alma
        if (q.size >= MAX_QUEUE_SIZE) {
          logger.warn(`[Queue] Kuyruk dolu (${q.size}/${MAX_QUEUE_SIZE}). Mesaj düşürüldü: ${jid}`);
          continue;
        }

        const msgCopy = msg;
        const jidCopy = jid;

        q.add(() => {
          // ── KnightBot-Mini yaklaşımı: Komutu ANINDA çalıştır ──
          // Grup meta verisini BEKLEMEDEN handleMessage'ı hemen çağır.
          // handleMessage kendi içinde zaten fetchGroupMeta (cache'li) çağırıyor.
          // Eski yaklaşım: fetchGroupMeta bekleniyor → her grup mesajı 5sn kilitleniyordu.
          return handleMessage(sock, msgCopy, null).catch((err) => {
            if (!err?.message?.includes('rate-overlimit') &&
                !err?.message?.includes('Connection Closed')) {
              logger.error({ err: err?.message, jid: jidCopy }, "Mesaj işleme hatası");
            }
          });
        });
      } catch (err) {
        // Queue hazır değilse fallback
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
      // Dinamik config değişikliğini yakalamak için her seferinde require'dan oku
      const liveConfig = require("../config");
      const rejectCalls = liveConfig.REJECT_CALLS === true || liveConfig.REJECT_CALLS === "true";

      if (call.status === "offer" && rejectCalls) {
        const callerNumber = call.from.split("@")[0];
        const allowedRaw = liveConfig.ALLOWED_CALLS || "";
        const allowedNumbers = allowedRaw ? allowedRaw.split(",").map(n => n.trim()).filter(Boolean) : [];
        
        // Eğer arayan beyaz listedeyse reddetme
        if (allowedNumbers.includes(callerNumber)) continue;

        try {
          await sock.rejectCall(call.id, call.from);
          logger.info(`[Aramaengel] Gelen arama reddedildi: ${call.from}`);
        } catch (e) {
          logger.debug({ err: e.message }, "[Aramaengel] rejectCall hatası");
        }
        
        // Eğer bir reddetme mesajı belirlenmişse arayana gönder
        const rejectMsg = liveConfig.CALL_REJECT_MESSAGE;
        if (rejectMsg && rejectMsg.trim() !== "") {
          await sock.sendMessage(call.from, { 
            text: rejectMsg.trim() 
          }).catch(() => {});
        }
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
