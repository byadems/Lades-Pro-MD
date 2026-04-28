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
const { WhatsappOturum, sequelize, BotVariable } = require("./database");
const { migrateSudoToLID } = require("./yardimcilar");
const { startSchedulers } = require("./zamanlayici");
const { runSelfTest } = require("./self-test");
const grupstat = require("../plugins/utils/grupstat");
const channelCache = require("./channel-cache");

// ─── Oto-Durum (Auto Status) in-memory state ─────────────────────────────────
const _autoStatus = { enabled: false, react: false, lastRefresh: 0 };
const AUTO_STATUS_REFRESH_MS = 2 * 60 * 1000; // 2 dakikada bir DB'den yenile

async function _refreshAutoStatusState() {
  try {
    const enabled = await BotVariable.get("AUTO_STATUS_ENABLED", "false");
    const react   = await BotVariable.get("AUTO_STATUS_REACT",    "false");
    _autoStatus.enabled = enabled === "true";
    _autoStatus.react   = react   === "true";
    _autoStatus.lastRefresh = Date.now();
  } catch { /* DB bağlantısı yoksa mevcut durumu koru */ }
}

async function getAutoStatusState() {
  if (Date.now() - _autoStatus.lastRefresh > AUTO_STATUS_REFRESH_MS) {
    await _refreshAutoStatusState();
  }
  return _autoStatus;
}

// ─── Oto-Görüldü (Auto Read) in-memory state ────────────────────────────────
const _autoRead = { enabled: false, lastRefresh: 0 };
const AUTO_READ_REFRESH_MS = 2 * 60 * 1000;

async function _refreshAutoReadState() {
  try {
    const v = await BotVariable.get("AUTO_READ_ENABLED", "false");
    _autoRead.enabled = v === "true";
    _autoRead.lastRefresh = Date.now();
  } catch { /* DB hazır değilse mevcut durumu koru */ }
}

async function getAutoReadState() {
  if (Date.now() - _autoRead.lastRefresh > AUTO_READ_REFRESH_MS) {
    await _refreshAutoReadState();
  }
  return _autoRead;
}
// ── PQueue: module-level başlat (lazy async init overhead'i önce)
let _queue = null;
let _queueReady = false;
let _firstConnectDone = false; // loadPlugins + startSchedulers sadece 1 kez çalışsın

// Pre-warm: Bot başlar başlamaz queue'yu hazırla
import('p-queue').then(({ default: PQueue }) => {
  // concurrency: 20 — 101 grup için yeterli; hafif komutlar çoğunluk
  // intervalCap + interval: saniyede max 50 mesaj işle (burst engeli)
  // throwOnTimeout: false — timeout'da hata fırlatma, sessizce geç
  _queue = new PQueue({ concurrency: 20, intervalCap: 50, interval: 1000, throwOnTimeout: false });
  _queueReady = true;
}).catch(() => { /* fallback: create on demand */ });

async function getMessageQueue() {
  if (_queue) return _queue;
  const { default: PQueue } = await import('p-queue');
  _queue = new PQueue({ concurrency: 20, intervalCap: 50, interval: 1000, throwOnTimeout: false });
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

// scheduled_message_sender ve otomasyonun tekrar kayıt olmamasını sağlayan guardlar
let _scheduledMsgRegistered = false;
let _automationRegistered = false;

// ─────────────────────────────────────────────────────────
//  Create bot instance
// ─────────────────────────────────────────────────────────
async function createBot(sessionId = "lades-session", options = {}) {
  let reconnectCount = options.reconnectCount || 0;
  let zombieRecoveryCount = options.zombieRecoveryCount || 0;
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
  let _lastZombieFire = 0; // Zombie pino interceptor debounce (ms)

  // ─────────────────────────────────────────────────────────
  //  Eski-Soket "Connection Closed" Sel Dedektörü
  //  428 ACK hatası şelalesini tespit eder. Yeniden bağlandıktan sonra
  //  eski soketin processNodeWithBuffer'ı kapanmış WebSocket'te ACK
  //  yollamaya devam ederse, event loop tıkanır ve yeni soket mesaj
  //  alamaz. Bu sayaç 30s pencerede 200+ hata olursa süreci yeniden
  //  başlatır (Reserved VM otomatik kalkar).
  // ─────────────────────────────────────────────────────────
  let _ccErrorWindow = []; // Son 30s'deki "Connection Closed" zamanları
  let _suppressedCcErrors = 0; // Bastırılan toplam (özet için)
  let _lastCcSummaryAt = 0;
  const CC_BURST_WINDOW_MS = 30 * 1000;
  const CC_BURST_THRESHOLD = 200; // 30s'de 200 hata = sıkışma kanıtı

  /**
   * Zombie socket bırakmadan bağlantıyı kapat.
   * sock.end() yerine ws.terminate() kullanır — graceful handshake beklemiyor.
   */
  function gracefulClose(reason = 'Manual close') {
    if (_isClosing) return;
    _isClosing = true;
    logger.debug(`[GracefulClose] ${reason}`);
    try {
      // WebSocket'i anında kapatmak (terminate) pending query'leri patlatır
      // Bunun yerine sock.end(Error) kullanarak güvenli şekilde kapatın
      if (sock && typeof sock.end === 'function') {
        sock.end(new Error(reason));
      } else if (sock.ws && sock.ws.readyState !== 3 /* CLOSED */) {
        try { sock.ws.close(); } catch { }
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
        
        // Event buffer ve receipt log'larını bastır (spam önleme)
        const logMsg = JSON.stringify(logData);
        if (logMsg.includes('Event buffer') || 
            logMsg.includes('Flushing') || 
            logMsg.includes('sending receipt') ||
            logMsg.includes('communication recv') ||
            logMsg.includes('sent ack')) {
          return;
        }

        // ─────────────────────────────────────────────────────
        //  KRİTİK: Eski soketin "Connection Closed" (428) sel'ini bastır
        //  Yeniden bağlandıktan sonra eski soketin offline mesaj kuyruğu
        //  kapanmış WebSocket üzerinden ACK göndermeye devam eder. Her
        //  hata pino → process.stdout → console.log = event loop tıkanır.
        //  Yüzlerce hata/saniye yeni soketin mesaj almasını engeller.
        //  Çözüm: Bu hataları sessizce yut, sadece özet say + sıkışma
        //  yakalanırsa süreci yeniden başlat.
        // ─────────────────────────────────────────────────────
        const isClosedSocketAckError =
          logData.err?.message === 'Connection Closed' &&
          (logMsg.includes('handling receipt') ||
           logMsg.includes('handling notification') ||
           logMsg.includes('handling message') ||
           logMsg.includes('processNodeWithBuffer') ||
           logMsg.includes('sendMessageAck') ||
           logMsg.includes('sendRawMessage'));

        if (isClosedSocketAckError) {
          const now = Date.now();
          _suppressedCcErrors++;
          _ccErrorWindow.push(now);
          // 30s öncesinden gelen kayıtları temizle
          while (_ccErrorWindow.length && _ccErrorWindow[0] < now - CC_BURST_WINDOW_MS) {
            _ccErrorWindow.shift();
          }

          // Her 30s'de bir özet (kullanıcıya görünürlük)
          if (now - _lastCcSummaryAt > 30000 && _suppressedCcErrors > 0) {
            _lastCcSummaryAt = now;
            logger.warn(`[Bağlantı] Eski soket ACK hataları bastırıldı: ${_suppressedCcErrors} (son 30s: ${_ccErrorWindow.length})`);
            _suppressedCcErrors = 0;
          }

          // SIKIŞMA TESPİTİ: 30s pencerede 200+ hata = eski buffer event loop'u tıkıyor
          // Reserved VM otomatik kalkar — temiz başlangıç garantili.
          if (_ccErrorWindow.length >= CC_BURST_THRESHOLD) {
            logger.error(`[KRİTİK] Eski soket ACK seli (${_ccErrorWindow.length}/${Math.round(CC_BURST_WINDOW_MS/1000)}s) — event loop tıkalı. Süreç temiz yeniden başlatılıyor...`);
            _ccErrorWindow = []; // tekrar tetiklemeyi engelle
            // Zaman ver ki son loglar yazılsın, sonra süreç kapansın
            setTimeout(() => {
              try {
                if (process.send) process.send({ type: 'bot_status', data: { connected: false, error: 'ACK seli — yeniden başlatma' } });
              } catch {}
              process.exit(1);
            }, 500);
          }
          return; // Sessizce yut
        }
        
        // Şifre çözme veya oturum hatalarını yakala
        const isDecryptionError = 
           logData.err?.type === 'MessageCounterError' || 
           logData.err?.type === 'SessionError' ||
           (logData.msg && logData.msg.includes('failed to decrypt')) ||
           (logData.err?.message && logData.err.message.includes('No session'));

        if (isDecryptionError) {
          const now = Date.now();
          if (now - lastDecryptionErrorAt > 30000) {
            // Eğer son hatadan bu yana 30 saniye geçtiyse sayacı sıfırla
            decryptionErrorCount = 0;
          }
          decryptionErrorCount++;
          lastDecryptionErrorAt = now;

          if (decryptionErrorCount === 50) {
            logger.warn(`[Şifre] ${sessionId}: Çok sayıda deşifre hatası alındı. Eski (offline) mesajlar işleniyor olabilir, yoksayılıyor.`);
          }

          // Otomatik yeniden bağlanma DÖNGÜSÜNE girmemesi için kapatıldı.
          // Çünkü eski çevrimdışı (offline) mesajlar okunduğunda yoğun deşifre hataları alınması normaldir.
          // Baileys zaten mesajlar için retry isteyecek veya drop edecektir.
          /*
          if (decryptionErrorCount >= 25) {
            logger.error(`[KRİTİK] ${sessionId}: 25 deşifre hatası aşıldı! Oturum onarımı için yeniden bağlanılıyor...`);
            decryptionErrorCount = 0;
            setTimeout(() => {
              try { gracefulClose("Decryption error threshold"); } catch { }
            }, 300);
          }
          */
          
          // UYARI EKRANINI KİRLETMEMEK İÇİN BU LOGU SESSİZCE YUT
          return; 
        }

        // ZOMBIE SOKET KORUMASI: Uzun süreli çalışmada soketin donup kalmasını (keep-alive hatası vs) engeller
        const isDeadSocket = 
          logData.msg === 'error in sending keep alive' || 
          logData.msg === 'socket connection timeout' ||
          (logData.err && logData.err.message === 'Timed Out');
          
        if (isDeadSocket) {
          // Soket zaten kapanıyor/kapalıysa (readyState !== 1) Baileys kendi reconnect'ini
          // hallediyordur. gracefulClose çağırmak çift reconnect döngüsüne neden olur.
          const wsState = sock?.ws?.readyState;
          const socketIsOpen = wsState === 1; // WebSocket.OPEN
          const now = Date.now();
          const cooldownOk = !_lastZombieFire || (now - _lastZombieFire > 30000);

          if (socketIsOpen && cooldownOk) {
            _lastZombieFire = now;
            logger.error(`[ZOMBIE KORUMASI] Soket zaman aşımı veya keep-alive hatası! Bağlantı ölü, yenileniyor...`);
            setTimeout(() => {
              try { gracefulClose("Zombie Socket Keep-Alive Timeout"); } catch { }
            }, 300);
          }
          return;
        }

        // Lades-Pro'nun diğer gereksiz Baileys loglarını engelleme (konsol spam engeli)
        const strLog = JSON.stringify(logData);
        if (strLog.includes("signalstore") || strLog.includes("libsignal") || strLog.includes("SessionEntry")) {
           return;
        }

        // ── Katman 5: Pre-key sağlık izleme ──
        // "0 pre-keys found on server" + oturum kayıtlıysa → uyarı ver
        if (logData.msg && logData.msg.includes('pre-keys found on server') && state.creds && state.creds.me) {
          const found = parseInt(raw.match(/"count"\s*:\s*(\d+)/)?.[1] || logData.count || '0', 10);
          if (found === 0) {
            logger.warn('[PreKey] ⚠️  Sunucuda 0 pre-key bulundu (kayıtlı oturum). Baileys şimdi yeni pre-key yükleyecek.');
          } else {
            logger.info(`[PreKey] Sunucuda ${found} pre-key mevcut — oturum sağlıklı.`);
          }
        }

        // Normal logları (eğer çok düşük seviyeli değilse) ana logger'a pasla veya stdout'a bas
        if (config.DEBUG) {
          process.stdout.write(raw + '\n');
        } else if (logData.level >= 40) { // Warn veya daha yüksek
          process.stdout.write(raw + '\n');
        }
      } catch (e) {
        // Parse hatası olsa da ekrana bas
        process.stdout.write(raw + '\n');
      }
    }
  };

  // Özel pino instance'ını stream ile oluştur
  const pino = require('pino');
  const baileysLogger = pino({ 
    level: config.DEBUG ? "debug" : "warn",
    name: "baileys"
  }, baileysLogDestination);


  // ─────────────────────────────────────────────────────────
  //  Group Metadata Cache (KRİTİK PERFORMANS + RATE LIMIT FİX)
  //  Baileys her grup mesajı gönderilirken WhatsApp'a groupMetadata
  //  query'si atar. Çoklu grupta bu rate-overlimit'e yol açar ve
  //  mesaj göndermeyi başarısız kılar ("Mesaj bekleniyor" balonu).
  //  cachedGroupMetadata callback'i Baileys'in iç sorgularını cache'ler.
  // ─────────────────────────────────────────────────────────
  const groupMetaCache = new LRUCache({ max: 200, ttl: 5 * 60 * 1000 });
  const cachedGroupMetadata = async (jid) => {
    try {
      const cached = groupMetaCache.get(jid);
      if (cached) return cached;
      // Cache yoksa ham sock.groupMetadata'yı çağır (recursion'u önlemek için
      // wrapper'dan değil — sock henüz yaratılmadığı için aşağıda dolduruyoruz)
      return undefined;
    } catch { return undefined; }
  };

  const sock = makeWASocket({
    version,
    logger: baileysLogger,
    printQRInTerminal: false, // We handle QR ourselves
    auth: {
      creds: state.creds,
      // Baileys 'useMultiFileAuthState' ve 'useDbAuthState' zaten state.keys'i cache ile sarmalar.
      // Çift önbellekleme (double-cache) durumunu ve bellek sızıntısını önlemek için direkt kullanıyoruz:
      keys: state.keys, 
    },
    msgRetryCounterCache: createNodeCacheAdapter(100, 5 * 60 * 1000), // 500→100 mesaj, 5 dk
    userDevicesCache: createNodeCacheAdapter(100, 5 * 60 * 1000), // 500→100 cihaz, 5 dk
    cachedGroupMetadata, // ← YENİ: rate-overlimit'i ve send timeout'unu çözer
    // macOS/Safari: WhatsApp'ın multi-device korelasyon algoritmasının
    // istatistiksel olarak en az "şüpheli" gördüğü kombinasyon. Hermit-bot
    // ve KnightBot-Mini gibi uzun-ömürlü bot projelerinde tercih edilir.
    // Daha az flag'lenme + daha stabil oturum.
    browser: Browsers.macOS('Safari'),
    getMessage: async (key) => {
      // Eski/atılmış soket için DB sorgulaması yapma — buffer flood event loop'unu tıkıyor
      if (sock?.__discarded) return undefined;
      const { getMessageByKey } = require("./store");
      const msg = getMessageByKey(key);
      return msg ? msg.message : undefined;
    },
    syncFullHistory: false,
    markOnlineOnConnect: !options.markOffline,
    // ─────────────────────────────────────────────────────────
    //  KRİTİK: init queries'i devre dışı bırak.
    //  Replit ağında fetchProps + presenceSubscribe sık sık 60-90s timeout
    //  olur; bu süre boyunca Baileys event-buffer messages.upsert event'lerini
    //  TUTAR ve handler hiç tetiklenmez. Yan etki: server property'leri
    //  (max upload size gibi) varsayılan değerlerle kullanılır — mesaj
    //  alma/gönderme için zorunlu değil.
    // ─────────────────────────────────────────────────────────
    fireInitQueries: false,
    defaultQueryTimeoutMs: 60000,
    connectTimeoutMs: 60000,
    // Keepalive aralığı: Baileys varsayılanı (30000ms) ile PDO timeout hatalarını önler.
    keepAliveIntervalMs: 30000,
    retryRequestDelayMs: 500,
    maxMsgRetryCount: 5,
  });

  // ── Group metadata wrapper: tüm groupMetadata çağrılarını cache'ler ──
  // Hem Baileys'in iç çağrıları (cachedGroupMetadata) hem plugin'lerin
  // direkt sock.groupMetadata() çağrıları cache'i besler ve okur.
  const _origGroupMetadata = sock.groupMetadata?.bind(sock);
  if (_origGroupMetadata) {
    sock.groupMetadata = async (jid) => {
      const cached = groupMetaCache.get(jid);
      if (cached) return cached;
      const meta = await _origGroupMetadata(jid);
      if (meta) groupMetaCache.set(jid, meta);
      return meta;
    };
  }
  // Grup güncellemelerinde cache'i invalidate et
  sock.ev.on('groups.update', (updates) => {
    for (const u of updates) {
      if (u?.id) groupMetaCache.delete(u.id);
    }
  });
  sock.ev.on('group-participants.update', (ev) => {
    if (ev?.id) groupMetaCache.delete(ev.id);
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
        logger.error({ err: err.message }, "Albüm medya hazırlama hatası");
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
    // İSTİSNA: Eğer kullanıcı dashboard'dan çıkış (intentional logout) tetiklediyse,
    // suspend olsa bile session/creds temizliği için close handler'a girmesine izin ver.
    if (options.manager && options.manager.isSuspended(sessionId)) {
      const isIntentionalLogoutClose = connection === "close" && sock?.__intentionalLogout;
      if (!isIntentionalLogoutClose) {
        if (connection === "close") logger.info(`[Suspended] Connection closed for ${sessionId}. Ignoring.`);
        return;
      }
      logger.info(`[Suspended] Intentional logout close for ${sessionId} — running cleanup.`);
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
            logger.error({ err }, "Eşleşme kodu talebi başarısız");
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
        logger.warn({ err: e.message }, "SUDO'dan LID'e geçiş başarısız");
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

      // Load plugins and schedulers — SADECE ilk bağlantıda yükle
      // Reconnect'lerde sadece credential'lar yenilenir, plugin'ler zaten hazır
      if (!_firstConnectDone) {
        _firstConnectDone = true;
        const pluginsDir = path.join(__dirname, "..", "plugins");
        await loadPlugins(pluginsDir);
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

      // ── NEWSLETTER ABONELIK ────────────────────────────────────────────────────
      // CHANNEL_JID tanımlıysa bağlantı açılınca canlı güncelleme aboneliği kur.
      // Bu sayede kanaldan gelen mesajlar channelCache'e düşer ve
      // .duyuru kanal komutu IQ sorgusu atmak yerine önbellekten okur.
      if (config.CHANNEL_JID && config.CHANNEL_JID.includes('@newsletter')) {
        // Önce DB'den önbelleği belleğe yükle (Republish/restart sonrası
        // .duyuru kanal komutunun anında çalışması için kritik).
        channelCache.preloadFromDb().catch((e) =>
          logger.warn({ err: e?.message }, '[ChannelCache] Preload hatası')
        );

        setTimeout(async () => {
          try {
            await sock.subscribeNewsletterUpdates(config.CHANNEL_JID);
            logger.info(`[Newsletter] Kanal aboneliği kuruldu: ${config.CHANNEL_JID}`);
          } catch (e) {
            logger.warn({ err: e?.message }, '[Newsletter] Kanal aboneliği kurulamadı (önemli değil, mesajlar yine de gelebilir)');
          }
        }, 5000);
      }
      // ── NEWSLETTER ABONELIK SONU ───────────────────────────────────────────────

      // ── SAAT KAYMA ENGELLEYİCİ ───────────────────────────
      // Timer Leak Koruması: Önceki interval'lar varsa temizle,
      // sonra yeniden oluştur. Bu sayede her reconnect'te biriken
      // interval'lar önlenir.
      if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
      if (_ntpTimer)      { clearInterval(_ntpTimer);      _ntpTimer = null; }
      if (_proactiveTimer){ clearInterval(_proactiveTimer); _proactiveTimer = null; }

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

      // ─────────────────────────────────────────────────────────
      //  Inactivity Watchdog
      //  5 dakika inaktif olan bağlantıyı otomatik yenile
      // ─────────────────────────────────────────────────────────
      let lastActivity = Date.now();
      let firstMsgReceived = false;
      const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 dakika

      sock.ev.on('messages.upsert', ({ type }) => {
        firstMsgReceived = true;
        lastActivity = Date.now();
      });

      const watchdogInterval = setInterval(async () => {
        if (!sock.ws || !sock.user) return;
        const timeSinceLastActivity = Date.now() - lastActivity;

        if (timeSinceLastActivity > INACTIVITY_TIMEOUT && sock.ws.readyState === 1) {
          logger.warn(`[Watchdog] ${Math.round(timeSinceLastActivity/60000)} dk inaktif. Yeniden bağlanılıyor...`);
          if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
          if (_ntpTimer) { clearInterval(_ntpTimer); _ntpTimer = null; }
          if (_proactiveTimer) { clearInterval(_proactiveTimer); _proactiveTimer = null; }
          clearInterval(watchdogInterval);
          try { sock.end(new Error('inactive')); } catch { }
        }
      }, 60 * 1000); // Her 1 dakikada kontrol et

      // ─────────────────────────────────────────────────────────
      //  Startup Zombie Dedektörü — Kademeli Recovery
      //  Bağlantı açıldıktan 90s içinde hiç mesaj gelmezse:
      //   Deneme 1 → clearSessions() + reconnect (hafif onarım)
      //   Deneme 2 → clearState()  + dashboard'a QR zorunluluğu
      // ─────────────────────────────────────────────────────────
      let startupZombieTimer = null;

      // Bağlantı kapandığında watchdog'ı temizle
      const cleanupWatchdog = () => {
        clearInterval(watchdogInterval);
        if (startupZombieTimer) { clearTimeout(startupZombieTimer); startupZombieTimer = null; }
        lastActivity = Date.now();
      };
      sock.ev.on('connection.update', (update) => {
        if (update.connection === 'close') cleanupWatchdog();
        if (update.connection === 'open') {
          lastActivity = Date.now();
          firstMsgReceived = false;
          // 90 saniyelik startup zombie kontrolü
          if (startupZombieTimer) clearTimeout(startupZombieTimer);
          startupZombieTimer = setTimeout(async () => {
            if (!firstMsgReceived && sock.ws && sock.ws.readyState === 1 && sock.user) {
              zombieRecoveryCount++;
              if (zombieRecoveryCount === 1) {
                // Hafif onarım: P2P signal session'larını temizle, creds koru
                logger.warn(`[Zombie] Deneme ${zombieRecoveryCount}: 90s mesaj yok. clearSessions() + yeniden bağlanıyor...`);
                try { if (clearSessions) await clearSessions(); } catch { }
                try { sock.end(new Error('zombie-clearSessions')); } catch { }
              } else {
                // ÜLTRA ONARIM: clearState (QR zorunluluğu) ÇOK AĞIR — kullanıcı yeniden eşleşmek istemez.
                // Onun yerine süreci temiz kapat → Reserved VM aynı oturumla saniyeler içinde kalkar.
                logger.error(`[Zombie] Deneme ${zombieRecoveryCount}: clearSessions sonrası hâlâ zombie! Süreç temiz yeniden başlatılıyor (Reserved VM kalkar)...`);
                try {
                  if (process.send) process.send({ type: 'bot_status', data: { connected: false, error: 'Zombie soket — yeniden başlatma' } });
                } catch {}
                setTimeout(() => process.exit(1), 500);
              }
            }
          }, 90 * 1000);
        }
      });

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
        gracefulClose("Proactive 6h reconnect");
      }, PROACTIVE_RECONNECT_MS);

      // ─────────────────────────────────────────────────────────
      //  Signal Key Sağlık Monitörü — 10 dakikada bir
      //  DB'deki signal key sayısını kontrol et. Sıfıra düşerse
      //  zombie state'i önlemek için hemen otur. sıfırla + reconnect.
      // ─────────────────────────────────────────────────────────
      const KEY_HEALTH_INTERVAL_MS = 10 * 60 * 1000; // 10 dakika
      const keyHealthInterval = setInterval(async () => {
        if (!sock.user || !sock.ws || sock.ws.readyState !== 1) return;
        try {
          const { Op } = require('sequelize');
          const { WhatsappOturum } = require('./database');
          const keyCount = await WhatsappOturum.count({
            where: { sessionId: { [Op.like]: `${sessionId}:%` } }
          });
          if (keyCount === 0) {
            logger.error(`[KeyHealth] ⚠️  Signal key'ler DB'den SİLİNMİŞ (${keyCount})! Zombie önlemi: clearState → yeniden eşleştirme.`);
            clearInterval(keyHealthInterval);
            if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
            if (_ntpTimer)      { clearInterval(_ntpTimer);      _ntpTimer = null; }
            if (_proactiveTimer){ clearInterval(_proactiveTimer); _proactiveTimer = null; }
            try { if (clearState) await clearState(); } catch { }
            try { sock.end(new Error('key-health-zero')); } catch { }
          } else if (keyCount < 5) {
            logger.warn(`[KeyHealth] Signal key sayısı az (${keyCount}). Baileys yeniden bağlanmada otomatik tamamlayacak.`);
          } else {
            logger.debug(`[KeyHealth] Signal key'ler sağlıklı (${keyCount} kayıt).`);
          }
        } catch (e) {
          logger.warn(`[KeyHealth] Kontrol başarısız: ${e.message}`);
        }
      }, KEY_HEALTH_INTERVAL_MS);

      // Bağlantı kapanınca key health interval'ını temizle
      sock.ev.on('connection.update', (ku) => {
        if (ku.connection === 'close') clearInterval(keyHealthInterval);
      });

      // ── SAAT KAYMA ENGELLEYİCİ SONU ────────────────────
    }

    if (connection === "close") {
      // Timer Leak: bağlantı kesilince tüm interval'ları temizle
      if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
      if (_ntpTimer)      { clearInterval(_ntpTimer);      _ntpTimer = null; }
      if (_proactiveTimer){ clearInterval(_proactiveTimer); _proactiveTimer = null; }
      stopTempCleanup();
      // Bağlantı kapanınca bekleyen mesaj işlemleri temizle (bellek aşımı engellenir)
      if (_queue) { try { _queue.clear(); } catch { } }
      // Defansif çıkarım: bazı Boom/raw error varyantlarında payload yapısı değişebilir
      const statusCode = lastDisconnect?.error?.output?.statusCode
        ?? lastDisconnect?.error?.output?.payload?.statusCode
        ?? lastDisconnect?.error?.statusCode
        ?? undefined;
      if (statusCode === undefined && lastDisconnect?.error) {
        logger.warn({ err: lastDisconnect.error?.message || String(lastDisconnect.error) }, 'Bilinmeyen close (statusCode tespit edilemedi)');
      }

      // ─────────────────────────────────────────────────────────
      //  DisconnectReason Politikası
      //  - 401 loggedOut          → tam temizle, yeni QR/pair iste
      //  - 403 forbidden          → suspend, kullanıcı müdahalesi gerekli
      //  - 411 multideviceMismatch→ tam temizle, yeni QR
      //  - 440 connectionReplaced → SUSPEND (başka cihazda aynı oturum açık,
      //                              yeniden bağlanmak sonsuz döngü yaratır)
      //  - 500 badSession         → GEÇİCİ say, oturuma dokunmadan yeniden bağlan
      //                             (stream:error protokol hatası = credential bozukluğu DEĞİL)
      //  - 408/428/503/515        → geçici, normal backoff ile devam
      // ─────────────────────────────────────────────────────────
      const PERMANENT_NO_RECONNECT = new Set([
        DisconnectReason.loggedOut,            // 401  → clearState + fresh QR
        DisconnectReason.forbidden,            // 403  → suspend
        DisconnectReason.connectionReplaced,   // 440  → suspend (önemli!)
        DisconnectReason.multideviceMismatch,  // 411  → clearState + fresh QR
      ]);
      const TRANSIENT_FAST_RETRY = new Set([
        DisconnectReason.restartRequired,      // 515 — Baileys handshake post-login
        DisconnectReason.connectionClosed,     // 428
        DisconnectReason.connectionLost,       // 408 (alias of timedOut)
        DisconnectReason.unavailableService,   // 503
        DisconnectReason.badSession,           // 500 — stream:error protokol hatası (geçici)
      ]);

      const isPermanent = PERMANENT_NO_RECONNECT.has(statusCode);
      const isFastRetry = TRANSIENT_FAST_RETRY.has(statusCode);
      const shouldReconnect = !isPermanent;

      // ── Anlaşılır loglar ─────────────────────────────────────
      if (statusCode === DisconnectReason.connectionReplaced) {
        logger.error('🛑 Bağlantı başka cihazda açıldı (440 replaced). Çakışmayı önlemek için yeniden bağlanma DURDURULDU. Diğer oturumu kapatıp dashboard\'dan tekrar başlatın.');
      } else if (statusCode === DisconnectReason.loggedOut) {
        logger.error('Oturum kapatıldı (401)! Lütfen yeniden doğrulama yapın.');
      } else if (statusCode === DisconnectReason.forbidden) {
        logger.error('🚫 Hesap erişimi yasaklandı (403). WhatsApp tarafından engellenmiş olabilir.');
      } else if (statusCode === DisconnectReason.multideviceMismatch) {
        logger.error('Çoklu cihaz uyumsuzluğu (411). Oturum sıfırlanacak.');
      } else if (isFastRetry) {
        const label = statusCode === DisconnectReason.badSession
          ? 'Stream protokol hatası (500) — oturum korunuyor'
          : `Geçici kopma (${statusCode})`;
        logger.info(`⚠️ ${label}. Hızlı yeniden bağlanılıyor...`);
      } else {
        logger.warn({ statusCode, shouldReconnect }, 'Bağlantı kesildi.');
      }

      if (shouldReconnect) {
        reconnectCount++;
        // Restart required (515) ve connectionClosed (428) için backoff'u sıfırla —
        // bu kodlar normal handshake akışının parçası, sayım anlamsız.
        if (isFastRetry) reconnectCount = Math.min(reconnectCount, 1);
        const delay = isFastRetry
          ? RECONNECT_BASE_MS  // 3s sabit
          : Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectCount - 1), RECONNECT_MAX_MS);
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
          // KRİTİK: Eski soketi "atılmış" olarak işaretle — getMessage / cachedGroupMetadata
          // gibi callback'ler hızlı çıksın, eski buffer DB'yi gereksiz sorgulamasın.
          try { sock.__discarded = true; } catch { }
          // Event listener'ları temizle (memory leak önlemi)
          // NOT: Bu noktada connection.update artık gelmeyecek (bağlantı zaten kapandı)
          try { sock.ev.removeAllListeners(); } catch { }
          // Eski WebSocket hala yarı-açık olabilir → tam kapanmasını garantiye al
          // close() yumuşak; terminate() anında öldürür → buffer ACK'leri hızlı patlar
          try {
            if (sock?.ws && sock.ws.readyState !== 3 /* CLOSED */) {
              if (typeof sock.ws.terminate === 'function') {
                sock.ws.terminate();
              } else if (typeof sock.ws.close === 'function') {
                sock.ws.close();
              }
            }
          } catch { }
          _isClosing = false; // Yeni socket için sıfırla
          _lastZombieFire = 0; // Yeni bağlantıda zombie debounce sıfırla
          // CC sayaçlarını sıfırla — yeni bağlantıdan sonra eski hatalar baştan sayılsın
          _ccErrorWindow = [];
          _suppressedCcErrors = 0;
          const newSock = await createBot(sessionId, { ...options, reconnectCount, zombieRecoveryCount });
          if (options.manager) {
            options.manager.updateSocket(sessionId, newSock);
          }
        }, delay);
      } else if (statusCode === DisconnectReason.connectionReplaced ||
                 statusCode === DisconnectReason.forbidden) {
        // Kalıcı hata → suspend, dashboard'a haber ver, yeniden bağlanma DENEME
        try { sock.ev.removeAllListeners(); } catch { }
        try { if (sock?.ws?.readyState !== 3) sock.ws.close(); } catch { }
        const reasonText = statusCode === DisconnectReason.connectionReplaced
          ? 'Başka cihazda aynı oturum açık. Diğerini kapatıp yeniden başlatın.'
          : 'Hesap erişimi yasaklandı (403).';
        if (process.send) process.send({ type: 'bot_status', data: { connected: false, error: reasonText } });
        if (options.manager) {
          options.manager.suspend(sessionId);
        }
        return;
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
            logger.info(`Oturum ${sessionId} duraklatıldı. Otomatik yeniden başlatma atlanıyor.`);
            return;
          }

          logger.info("Yeni oturum için taze bir bağlantı başlatılıyor (10sn içinde)...");
          setTimeout(async () => {
            if (options.manager && options.manager.isSuspended(sessionId)) {
              logger.info(`Oturum ${sessionId} bekleme sırasında duraklatıldı. Yeniden başlatma iptal ediliyor.`);
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
  // RAM KORUMA: Queue doluysa (200+ bekleyen görev) yeni mesajları düşür.
  // 60+ grupta burst mesajlarda heap'in sonsuz büyümesini engeller.
  const MAX_QUEUE_SIZE = 500;

  // Eski mesaj eşiği: 30 dakika (saniye cinsinden).
  // 5dk çok dardı; saat kayması veya WhatsApp retry geç kaldığında komutlar
  // sessizce düşüyordu. 30dk daha güvenli — gerçekten eski mesajlar yine atlanır.
  const MSG_AGE_LIMIT_SEC = 30 * 60;

  // Tek bir komut/mesajın işlenmesi için maksimum süre (5 dakika).
  // Hung promise/network çağrısı yüzünden queue slot'unun sonsuza dek dolu
  // kalmasını engeller. YouTube indirme gibi uzun işlemler bu süre içinde biter.
  // Süre dolarsa kullanıcıya geri bildirim gönderilir.
  const HANDLER_TIMEOUT_MS = 5 * 60 * 1000;

  // Komut ön ekleri (HANDLERS) — log filtreleme ve hata bildirimi için.
  const _handlersList = String(config.HANDLERS || ".").split("");

  // Mesajın komut olup olmadığını saptar (log + hata feedback'i için).
  const _isCommandText = (txt) => {
    if (!txt) return false;
    const ch = txt.trim().charAt(0);
    return _handlersList.includes(ch);
  };

  // Mesaja kullanıcıya görünür bir hata cevabı gönder (sessiz başarısızlığı
  // kırar). Ayrıca handler.js'in koyduğu ⏳ "işleniyor" tepkisini ❌'ye
  // çevirir — yoksa kullanıcı sonsuza kadar ⏳ görür.
  const _safeNotifyError = async (jid, msgKey, errLabel) => {
    // 1) ⏳ → ❌ tepki güncellemesi (fire-and-forget)
    sock.sendMessage(jid, { react: { text: "❌", key: msgKey } }).catch(() => {});
    // 2) Açıklayıcı metin cevabı
    try {
      await sock.sendMessage(jid, {
        text: `⚠️ *Komut işlenemedi:* ${errLabel}\n_Lütfen birkaç saniye sonra tekrar deneyin._`,
      }).catch(() => {});
    } catch { /* yut */ }
  };

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;
    for (const msg of messages) {
      if (!msg.message) continue;
      const jid = msg.key.remoteJid;
      if (!jid) continue;

      // ── DEDUPE: Aynı msg.key.id'nin iki defa işlenmesini engelle ─────────────
      //   Baileys; bağlantı yenilenmesi ya da history-sync sırasında daha önce
      //   "notify" ile gelmiş bir mesajı "append" ile (veya tam tersi) yeniden
      //   yayınlayabilir. Bu blok olmadan bot, aynı komutu dakikalar sonra
      //   ikinci defa işliyordu (örn. .ping 02:09 → 02:15 tekrar yanıt).
      const _msgId = msg.key?.id;
      if (_msgId && global.isMessageProcessed && global.isMessageProcessed(_msgId)) {
        logger.debug({ jid, id: _msgId, type }, "[Dedupe] Mesaj zaten işlenmişti, atlanıyor");
        continue;
      }
      if (_msgId && global.markMessageProcessed) {
        global.markMessageProcessed(_msgId);
      }
      // ── DEDUPE SONU ─────────────────────────────────────────────────────────

      // ── OTO-DURUM (AUTO STATUS): status@broadcast mesajlarını yakala ──────────
      if (jid === "status@broadcast") {
        try {
          const autoSt = await getAutoStatusState();
          if (autoSt.enabled) {
            await sock.readMessages([msg.key]).catch(() => {});
            if (autoSt.react) {
              // WhatsApp durum reaksiyonu: kalp emojisi
              await sock.sendMessage("status@broadcast", {
                react: { text: "💚", key: msg.key }
              }).catch(() => {});
            }
          }
        } catch (e) {
          logger.debug({ err: e?.message }, "[OtoDurum] Durum işleme hatası");
        }
        continue; // Status mesajları normal handler'a gitmesin
      }

      // Mesaj yaşı filtresi: sadece "notify" (gerçek zamanlı) mesajlara uygula.
      // "append" = çevrimdışıyken gelen mesajlar — bunları yaş filtresinden muaf tut.
      if (type === "notify") {
        const ts = Number(msg.messageTimestamp || 0);
        if (ts > 0 && (Date.now() / 1000) - ts > MSG_AGE_LIMIT_SEC) {
          logger.debug({ jid, ts }, "[MsgFilter] 5dk+ eski mesaj atlandı");
          continue;
        }
      }

      // ── OTO-GÖRÜLDÜ (AUTO READ): tüm gelen mesajları okundu işaretle ──────
      try {
        const autoRd = await getAutoReadState();
        if (autoRd.enabled && type === "notify" && !msg.key?.fromMe) {
          sock.readMessages([msg.key]).catch(() => {});
        }
      } catch (e) {
        logger.debug({ err: e?.message }, "[OtoGörüldü] Okundu işaretleme hatası");
      }

      const isChannelJid = jid.endsWith('@newsletter');

      // ── KANAL ÖNBELLEĞİ: Newsletter mesajını hemen kaydet ──────────────────
      // .duyuru kanal komutu zaman aşımlı IQ sorgusu yerine buradan okur.
      if (isChannelJid && config.CHANNEL_JID && jid === config.CHANNEL_JID) {
        channelCache.setLastMsg(jid, msg);
        logger.debug(`[Newsletter] Kanal mesajı önbelleğe alındı: ${jid}`);
      }
      // ── KANAL ÖNBELLEĞİ SONU ────────────────────────────────────────────────

      // Mesaj metnini erken çıkar — log + komut tespiti için
      const msgText = getMessageText(msg.message) || "";
      const isCmd = _isCommandText(msgText);

      try {
        const q = await getMessageQueue();

        // BACKPRESSURE: Queue çok doluysa yeni mesajı kuyruğa alma.
        // Komut mesajıysa kullanıcıya neden cevap alamadığını bildir.
        if (q.size >= MAX_QUEUE_SIZE) {
          logger.warn(`[Queue] Kuyruk dolu (${q.size}/${MAX_QUEUE_SIZE}). Mesaj düşürüldü: ${jid}`);
          if (isCmd && !msg.key.fromMe) {
            _safeNotifyError(jid, msg.key, "Bot şu an çok yoğun (kuyruk dolu)").catch(() => {});
          }
          continue;
        }

        // Mesaj referansını kopyala (closure leak önlemi)
        const msgCopy = msg;
        const jidCopy = jid;
        const isGroupJid = isGroup(jid);
        const cmdPreview = isCmd ? msgText.trim().slice(0, 60) : null;

        // ── GRUPSTAT SAYACI: Bot'a gelen mesajları değil, gerçek kullanıcı mesajlarını say ──
        if (isGroupJid && !msg.key.fromMe && type === "notify") {
          const sender = msg.key.participant;
          if (sender) grupstat.countMessage(jidCopy, sender);
        }

        q.add(async () => {
          const startMs = Date.now();
          // Komut mesajlarını her zaman logla — production'da da görünür olsun
          if (cmdPreview) {
            logger.info(`[CMD-IN] ${jidCopy} → "${cmdPreview}" (queue:${q.size})`);
          } else if (config.DEBUG) {
            console.log(`[UPSERT] JID: ${jidCopy} | Channel: ${isChannelJid} | Text: "${msgText?.slice(0, 30)}..."`);
          }
          try {
            let groupMeta = null;
            if (isGroupJid) {
              // fetchGroupMeta önce cache'e bakar — 5dk TTL içinde DB/WA isteği yok
              groupMeta = await fetchGroupMeta(sock, jidCopy);
            }

            // Tek bir komut hung olsa bile queue slot'u sonsuza dek dolu kalmasın.
            // 5 dakikayı aşan handler'a TimeoutError fırlat → catch'e düşer →
            // kullanıcıya geri bildirim gönderilir.
            let timeoutHandle;
            const timeoutPromise = new Promise((_, rej) => {
              timeoutHandle = setTimeout(
                () => rej(new Error(`Handler timeout (${HANDLER_TIMEOUT_MS / 1000}s)`)),
                HANDLER_TIMEOUT_MS
              );
            });
            try {
              await Promise.race([
                handleMessage(sock, msgCopy, groupMeta),
                timeoutPromise,
              ]);
            } finally {
              if (timeoutHandle) clearTimeout(timeoutHandle);
            }

            if (cmdPreview) {
              const ms = Date.now() - startMs;
              if (ms > 5000) {
                logger.warn(`[CMD-OUT] ${jidCopy} → "${cmdPreview}" tamamlandı (${ms}ms — yavaş)`);
              } else {
                logger.debug(`[CMD-OUT] ${jidCopy} → "${cmdPreview}" tamamlandı (${ms}ms)`);
              }
            }
          } catch (err) {
            const errMsg = err?.message || String(err);
            const isTimeout = errMsg.includes("Handler timeout");
            logger.error(
              { err: errMsg, jid: jidCopy, cmd: cmdPreview, ms: Date.now() - startMs },
              isTimeout ? "Komut zaman aşımına uğradı" : "Mesaj işleme hatası"
            );
            // Komut mesajıysa kullanıcıya görünür geri bildirim ver
            // (sessiz başarısızlığı kırar)
            if (cmdPreview && !msgCopy.key.fromMe) {
              const label = isTimeout
                ? "İşlem 5 dakikayı aştı"
                : `Beklenmeyen hata (${errMsg.slice(0, 80)})`;
              _safeNotifyError(jidCopy, msgCopy.key, label).catch(() => {});
            }
          }
        });
      } catch (err) {
        // Queue hazır değilse fallback — yine de hata varsa log'la
        logger.warn({ err: err?.message }, "[bot] Mesaj kuyruğu push hatası, doğrudan handle deneniyor");
        handleMessage(sock, msg).catch((e) => {
          logger.error({ err: e?.message }, "[bot] Fallback handleMessage hatası");
          if (isCmd && !msg.key.fromMe) {
            _safeNotifyError(jid, msg.key, "Mesaj kuyruğu hatası").catch(() => {});
          }
        });
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
    // ── 2 KİŞİLİK GRUBA EKLENİNCE OTOMATİK AYRIL ──────────
    // Kötüye kullanımı önlemek için: bot yalnızca 2 üyeli gruplara eklendiyse ayrılır.
    if (update.action === "add" && sock.user) {
      const botJid = sock.user.id.replace(/:.*@/, "@");
      const wasAdded = (update.participants || []).some(p => p.replace(/:.*@/, "@") === botJid);
      if (wasAdded) {
        try {
          const meta = await sock.groupMetadata(update.id);
          if (meta?.participants?.length <= 2) {
            logger.info(`[Grup] 2 kişilik gruba eklendi, çıkılıyor: ${update.id}`);
            await sock.groupLeave(update.id);
          }
        } catch (e) {
          logger.warn({ err: e.message, id: update.id }, "[Grup] 2-kişilik grup ayrılma kontrolü başarısız");
        }
      }
    }
    // ────────────────────────────────────────────────────────
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
