"use strict";

/**
 * core/auth.js
 * WhatsApp authentication - QR code and Pair Code support.
 * Uses @whiskeysockets/baileys useMultiFileAuthState for local
 * or stores session in DB for cloud deployments.
 */

const path = require("path");
const fs = require("fs");
const qrcodeTerminal = require("qrcode-terminal");
const { loadBaileys } = require("./yardimcilar");
const { WhatsappOturum } = require("./database");
const { logger } = require("../config");

// ─────────────────────────────────────────────────────────
//  DB-backed auth state (for cloud / PostgreSQL deployments)
// ─────────────────────────────────────────────────────────
async function useDbAuthState(sessionId) {
  const { makeCacheableSignalKeyStore, BufferJSON } = await loadBaileys();

  // ── Deep Buffer Reviver: DB'den JSON olarak okunan Buffer'ları geri çevir ──
  const deepRevive = (obj) => {
    if (obj && typeof obj === 'object') {
      if (obj.type === 'Buffer' && (typeof obj.data === 'string' || Array.isArray(obj.data))) {
        return Buffer.from(obj.data, typeof obj.data === 'string' ? "base64" : undefined);
      }
      for (const k in obj) obj[k] = deepRevive(obj[k]);
    }
    return obj;
  };

  // ── Session yükleme: DB bağlantısı geçici kopuksa retry yap ──
  let sessionRow = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      sessionRow = await WhatsappOturum.findByPk(sessionId);
      break;
    } catch (e) {
      logger.warn(`[Auth] DB session yükleme denemesi ${attempt}/3: ${e.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }

  function getState() {
    if (!sessionRow || !sessionRow.sessionData) return {};
    try {
      const data = typeof sessionRow.sessionData === 'string'
        ? JSON.parse(sessionRow.sessionData)
        : sessionRow.sessionData;
      return deepRevive(data) || {};
    } catch (e) {
      logger.error({ err: e.message, sessionId }, "[Auth] DB session parse hatası — temiz state döndürülüyor");
      return {};
    }
  }

  const state = getState();
  const creds = state.creds || {};
  const storedKeys = state.keys || {};
  const modifiedKeys = new Set();
  let saveThrottle = null;

  // ── Signal Key Store Bellek Koruyucu ──
  // preKey'ler tek kullanımlık el sıkışma anahtarlarıdır. Üretildikten sonra birikebilirler.
  const MAX_PREKEYS = 200;   // ~200 preKey ÷ ~0.5 KB = ~100 KB RAM
  const MAX_SESSIONS = 100;  // WhatsApp MultiDevice'ta tipik build ~20-50 oturum
  const MAX_SENDER_KEYS = 50; // Grup senderKey'leri zamanla devasa boyutlara ulaşır

  function pruneOldKeys() {
    try {
      const prekeys = storedKeys.preKey;
      if (prekeys && Object.keys(prekeys).length > MAX_PREKEYS) {
        const keys = Object.keys(prekeys).map(Number).sort((a, b) => a - b);
        const toDelete = keys.slice(0, keys.length - MAX_PREKEYS);
        for (const k of toDelete) delete prekeys[k];
        logger.debug(`[Auth] ${toDelete.length} eski preKey temizlendi.`);
      }
      const sessions = storedKeys.session;
      if (sessions && Object.keys(sessions).length > MAX_SESSIONS) {
        const skeys = Object.keys(sessions);
        const toDelete = skeys.slice(0, skeys.length - MAX_SESSIONS);
        for (const k of toDelete) delete sessions[k];
        logger.debug(`[Auth] ${toDelete.length} eski session key temizlendi.`);
      }
      const senderKeys = storedKeys.senderKey;
      if (senderKeys && Object.keys(senderKeys).length > MAX_SENDER_KEYS) {
        const skeys = Object.keys(senderKeys);
        const toDelete = skeys.slice(0, skeys.length - MAX_SENDER_KEYS);
        for (const k of toDelete) delete senderKeys[k];
      }
      const senderKeyMem = storedKeys.senderKeyMemory;
      if (senderKeyMem && Object.keys(senderKeyMem).length > MAX_SENDER_KEYS) {
        const skeys = Object.keys(senderKeyMem);
        const toDelete = skeys.slice(0, skeys.length - MAX_SENDER_KEYS);
        for (const k of toDelete) delete senderKeyMem[k];
      }
    } catch { }
  }

  // ── Write Queue: Race condition engelleyici zincir ──
  let isSaving = false;
  let saveRequested = false;
  let _lastSaveData = null; // Duplicate save önleyici

  const saveCreds = async () => {
    saveRequested = true;
    if (isSaving) return; // Zaten kayıt yapılıyorsa veya sırada varsa dön

    // Throttle: 2000ms (Aşırı sık kayıt yapılmasını engelle)
    if (saveThrottle) return;
    saveThrottle = setTimeout(async () => {
      saveThrottle = null;
      if (!saveRequested || isSaving) return;
      isSaving = true;

      while (saveRequested) {
        saveRequested = false;
        try {
          const { sequelize } = require("./database");
          const sessionData = JSON.stringify({ creds, keys: storedKeys }, BufferJSON.replacer);

          // Duplicate save önleyici: veri değişmediyse DB'ye yazma
          if (sessionData === _lastSaveData) continue;
          _lastSaveData = sessionData;

          await sequelize.transaction(async (t) => {
            if (!sessionRow) {
              sessionRow = await WhatsappOturum.create({ sessionId, sessionData }, { transaction: t });
            } else {
              await sessionRow.update({ sessionData }, { transaction: t });
            }
            modifiedKeys.clear();
          });
          logger.debug(`[Auth] Session ${sessionId} DB'ye kaydedildi.`);
        } catch (err) {
          logger.error({ err: err.message, sessionId }, "[Auth] Session DB kayıt hatası");
          _lastSaveData = null; // Hata durumunda tekrar dene
        }
      }
      isSaving = false;
    }, 2000);
  };

  const keys = makeCacheableSignalKeyStore({
    get: async (type, ids) => {
      const data = {};
      for (const id of ids) {
        const val = storedKeys[type] && storedKeys[type][id];
        if (val) data[id] = val;
      }
      return data;
    },
    set: async (data) => {
      let changed = false;
      for (const category in data) {
        storedKeys[category] = storedKeys[category] || {};
        for (const id in data[category]) {
          const val = data[category][id];
          if (val) {
            storedKeys[category][id] = val;
            modifiedKeys.add(`${category}:${id}`);
          } else {
            delete storedKeys[category][id];
            modifiedKeys.add(`${category}:${id}`);
          }
          changed = true;
        }
      }
      if (changed) {
        pruneOldKeys();
        await saveCreds();
      }
    },
  }, logger.child({ module: "signal", level: "error" }));

  const clearState = async () => {
    _lastSaveData = null; // Duplicate önleyiciyi sıfırla
    if (sessionRow) {
      try {
        await sessionRow.update({ sessionData: null });
      } catch (e) {
        logger.warn({ err: e.message }, "[Auth] clearState DB güncellemesi başarısız");
      }
      // Bellekteki creds ve keys'i temizle
      for (const k in creds) delete creds[k];
      for (const k in storedKeys) delete storedKeys[k];
      logger.info(`[Auth] Session ${sessionId} DB ve bellekten temizlendi.`);
    }
  };

  const clearSessions = async () => {
    try {
      if (storedKeys.session) delete storedKeys.session;
      if (storedKeys.senderKey) delete storedKeys.senderKey;
      if (storedKeys.senderKeyMemory) delete storedKeys.senderKeyMemory;
      logger.info(`[Auth] Oturum onarımı: session ve senderKey verileri temizlendi.`);
      await saveCreds(true);
    } catch (e) {
      logger.warn({ err: e.message }, "[Auth] clearSessions başarısız");
    }
  };

  return { state: { creds, keys }, saveCreds, clearState, clearSessions };
}

// ─────────────────────────────────────────────────────────
//  Session string (base64) auth state - for cloud deploy
// ─────────────────────────────────────────────────────────
async function useSessionStringAuthState(sessionString) {
  const { makeCacheableSignalKeyStore, BufferJSON } = await loadBaileys();

  let state;
  try {
    const decoded = Buffer.from(sessionString, "base64").toString("utf-8");
    state = JSON.parse(decoded, BufferJSON.revive);
  } catch {
    state = {};
  }

  const saveCreds = async () => {
    try {
      const b64 = Buffer.from(JSON.stringify({ creds: state.creds, keys: state.keys }, BufferJSON.replacer)).toString("base64");
      process.env.SESSION = b64;
    } catch { }
  };

  const keys = makeCacheableSignalKeyStore({
    get: async (type, ids) => {
      const data = {};
      const stored = state.keys || {};
      for (const id of ids) {
        const val = stored[type] && stored[type][id];
        if (val) data[id] = val;
      }
      return data;
    },
    set: async (data) => {
      const stored = state.keys || {};
      for (const category in data) {
        stored[category] = stored[category] || {};
        for (const id in data[category]) {
          if (data[category][id]) stored[category][id] = data[category][id];
          else delete stored[category][id];
        }
      }
      state.keys = stored;
    },
  }, logger.child({ module: "signal", level: "error" }));

  const clearSessions = async () => {
    try {
      if (state.keys.session) delete state.keys.session;
      if (state.keys.senderKey) delete state.keys.senderKey;
      if (state.keys.senderKeyMemory) delete state.keys.senderKeyMemory;
      logger.info(`[Auth] Oturum onarımı: session ve senderKey verileri temizlendi.`);
      await saveCreds();
    } catch (e) { }
  };

  return { state: { creds: state.creds || {}, keys }, saveCreds, clearState: async () => { }, clearSessions };
}

// ─────────────────────────────────────────────────────────
//  Get auth state - pick method based on config
// ─────────────────────────────────────────────────────────
async function getAuthState(config, sessionId = "lades-session") {
  const sessionPath = path.join(__dirname, "..", "sessions", sessionId);
  const credsFile = path.join(sessionPath, "creds.json");

  // ════════════════════════════════════════════════════════
  //  ADIM 1: SESSION env varsa bootstrap yap + DB üzerinden çalış
  // ════════════════════════════════════════════════════════
  //  SORUN: SESSION env'den creds.json oluşturup useMultiFileAuthState
  //  kullansaydık, saveCreds() sadece DOSYAYA yazardı. Northflank
  //  restart sonrası dosya silinince SESSION env'deki STALE veri yeniden
  //  yüklenir → WA handshake'ten alınan güncel keyler KAYBOLUR → bot bağlanmaz.
  //
  //  ÇÖZÜM: SESSION env varsa bootstrap sonrası DOĞRUDAN useDbAuthState kullan.
  //  Bu sayede saveCreds() her zaman DB'yi günceller. Bir sonraki restart'ta
  //  DB'deki güncel oturum kullanılır — SESSION env artık sadece ilk kurulum içindir.
  // ════════════════════════════════════════════════════════
  const hasSessionEnv = !!(
    config.SESSION &&
    config.SESSION.length > 20 &&
    !config.SESSION.startsWith("path:")
  );

  if (hasSessionEnv) {
    logger.info("[SESSION] Ortam değişkeni algılandı → DB önyükleme başlatılıyor...");
    try {
      let b64 = config.SESSION;
      // Prefix destekleri: KnightBot!, Hermit~, Lades~ vb.
      if (b64.includes("!"))      b64 = b64.split("!").slice(1).join("!");
      else if (b64.includes("~")) b64 = b64.split("~").slice(1).join("~");

      let decoded = "";
      try {
        // Gzip sıkıştırması dene (KnightBot stili)
        const compressed = Buffer.from(b64.replace(/\.\.\.$/g, ""), "base64");
        decoded = require("zlib").gunzipSync(compressed).toString("utf-8");
      } catch {
        // Düz base64
        decoded = Buffer.from(b64, "base64").toString("utf-8");
      }

      const parsed    = JSON.parse(decoded);
      const credsData = parsed.creds || parsed;
      const keysData  = parsed.keys  || {};

      // ── DB'de güncel kayıt var mı? ─────────────────────────────────────
      // Varsa → DB'deki veri SESSION env'den DAHA GÜNCELDİR (WA handshake
      // sırasında güncellendi). SESSION env'i atla, DB'yi kullan.
      // Yoksa → İlk kurulum: SESSION env'den DB'ye aktar.
      const { WhatsappOturum } = require("./database");
      const existing = await WhatsappOturum.findByPk(sessionId).catch(() => null);

      if (!existing || !existing.sessionData) {
        // İlk kurulum: SESSION env → DB
        const sessionData = JSON.stringify({ creds: credsData, keys: keysData });
        await WhatsappOturum.upsert({ sessionId, sessionData });
        logger.info("[SESSION] ✅ İlk kurulum: Oturum DB'ye aktarıldı.");
      } else {
        // DB zaten güncel — SESSION env'i yoksay
        logger.info("[SESSION] ✅ DB'de güncel oturum mevcut, SESSION env atlandı.");
      }

      // Her iki durumda da DB auth state döndür (saveCreds → DB)
      logger.info("[SESSION] DB auth state etkinleştiriliyor (ephemeral-safe mod)...");
      return await useDbAuthState(sessionId);

    } catch (e) {
      logger.warn({ err: e.message }, "[SESSION] Önyükleme hatası, dosya tabanlı auth deneniyor...");
      // Hata durumunda aşağıdaki dosya kontrolüne düş
    }
  }

  // ════════════════════════════════════════════════════════
  //  ADIM 2: SESSION env yoksa yerel dosyaları kontrol et
  //           (Dashboard QR girişi veya yerel geliştirme)
  // ════════════════════════════════════════════════════════
  const possiblePaths = [
    path.join(__dirname, "..", "sessions", "dashboard-auth"),
    path.join(__dirname, "..", "sessions", "lades-session"),
  ];
  if (sessionId !== "lades-session") {
    possiblePaths.push(path.join(__dirname, "..", "sessions", sessionId));
  }

  for (const sp of possiblePaths) {
    const cf = path.join(sp, "creds.json");
    if (!fs.existsSync(cf)) continue;

    logger.info(`Yerel oturum dosyası bulundu: ${sp}`);
    const { useMultiFileAuthState } = await loadBaileys();
    const auth = await useMultiFileAuthState(sp);

    if (!auth.clearState) {
      auth.clearState = async () => {
        try {
          if (fs.existsSync(sp)) {
            fs.rmSync(sp, { recursive: true, force: true });
            logger.info(`Lokal oturum dizini temizlendi: ${sp}`);
          }
        } catch (e) {
          logger.error({ err: e.message }, "Lokal oturum temizleme hatası");
        }
      };
    }

    if (!auth.clearSessions) {
      auth.clearSessions = async () => {
        try {
          const files = fs.readdirSync(sp);
          for (const file of files) {
            if (
              file.startsWith("session-") ||
              file.startsWith("sender-key-") ||
              file.startsWith("sender-key-memory-")
            ) {
              fs.unlinkSync(path.join(sp, file));
            }
          }
          logger.info(`[Auth] Oturum onarımı: session ve senderKey dosyaları temizlendi.`);
        } catch (e) {
          logger.warn({ err: e.message }, "[Auth] clearSessions başarısız");
        }
      };
    }

    return auth;
  }

  // ════════════════════════════════════════════════════════
  //  ADIM 3: Dosya da yoksa DB'ye bak (SQLite / Postgres)
  // ════════════════════════════════════════════════════════
  logger.info(`[${sessionId}] Yerel oturum dosyası bulunamadı → veritabanına bakılıyor...`);
  return await useDbAuthState(sessionId);
}

// ─────────────────────────────────────────────────────────
//  QR Code display
// ─────────────────────────────────────────────────────────
function displayQR(qr) {
  // If we are a child process, notify parent (dashboard)
  if (process.send) {
    process.send({ type: 'qr', qr });
  }
  qrcodeTerminal.generate(qr, { small: true });
  logger.info("Bağlanmak için yukarıdaki QR kodu okutun!");
}

// ─────────────────────────────────────────────────────────
//  Baileys version helper
// ─────────────────────────────────────────────────────────
async function getBaileysVersion() {
  try {
    const { fetchLatestBaileysVersion } = await loadBaileys();
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`Baileys v${version.join(".")}${isLatest ? " (güncel)" : " (güncel değil)"}`);
    return version;
  } catch {
    return [2, 3000, 1017531287];
  }
}

module.exports = {
  getAuthState, useDbAuthState, useSessionStringAuthState,
  displayQR, getBaileysVersion,
};
