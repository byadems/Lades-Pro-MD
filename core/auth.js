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
    } catch { }
  }

  // ── Write Queue: Race condition engelleyici zincir ──
  let writePromise = Promise.resolve();
  let _lastSaveData = null; // Duplicate save önleyici

  const saveCreds = async (force = false) => {
    if (!force) {
      // Throttle: 500ms (2s'den kısa — deploy sonrası hızlı DB senkronizasyonu için)
      if (saveThrottle) return;
      saveThrottle = setTimeout(() => {
        saveThrottle = null;
        saveCreds(true);
      }, 500);
      return;
    }

    writePromise = writePromise.then(async () => {
      const { sequelize } = require("./database");
      try {
        const sessionData = JSON.stringify({ creds, keys: storedKeys }, BufferJSON.replacer);
        
        // Duplicate save önleyici: veri değişmediyse DB'ye yazma
        if (sessionData === _lastSaveData) return;
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
        // Throttle'ı sıfırla ki bir sonraki değişiklikte tekrar denensin
        _lastSaveData = null;
      }
    });
    return writePromise;
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

  // 1. If SESSION env contains a base64 string (Northflank/Heroku ephemeral storage workaround)
  if (config.SESSION && config.SESSION.length > 20 && !config.SESSION.startsWith("path:")) {
    logger.info("Oturum kimliği (SESSION) algılandı, yerel dosyaya aktarılıyor...");
    try {
      // Sadece creds.json yoksa (yeni başlatma veya ephemeral restart)
      if (!fs.existsSync(credsFile)) {
        if (!fs.existsSync(sessionPath)) {
          fs.mkdirSync(sessionPath, { recursive: true });
        }
        
        let b64 = config.SESSION;
        // Prefix destekleri (KnightBot, Hermit, Lades vb.)
        if (b64.includes("!")) {
          b64 = b64.split("!")[1]; 
        } else if (b64.includes("~")) {
          b64 = b64.split("~")[1];
        }
        
        let decoded = "";
        try {
           // Gzip sıkıştırması kullanılmış olabilir (KnightBot stili)
           const compressedData = Buffer.from(b64.replace(/\.\.\.$/, ''), 'base64');
           const zlib = require('zlib');
           decoded = zlib.gunzipSync(compressedData).toString('utf-8');
        } catch(e) {
           // Gzip değilse düz base64
           decoded = Buffer.from(b64, "base64").toString("utf-8");
        }

        const parsed = JSON.parse(decoded);
        let credsData = parsed;
        // Eğer veride { creds: {...}, keys: {...} } varsa sadece creds kısmını al
        if (parsed.creds) credsData = parsed.creds;
        
        fs.writeFileSync(credsFile, JSON.stringify(credsData, null, 2), "utf-8");
        logger.info(`✅ SESSION başarıyla yerel dosya sistemine aktarıldı. Bot kesintisiz başlayacak!`);
      } else {
         logger.info(`ℹ️ Yerel creds.json zaten mevcut, SESSION değişkeni atlandı.`);
      }
    } catch (e) {
      logger.warn({ err: e.message }, "SESSION ayrıştırma hatası, standart oturuma dönülüyor.");
    }
  }

  // 2. Check for local session files first (dashboard-auth or lades-session)
  const possiblePaths = [
    path.join(__dirname, "..", "sessions", "dashboard-auth"),
    path.join(__dirname, "..", "sessions", "lades-session"),
    path.join(__dirname, "..", "sessions", sessionId),
  ];

  for (const sessionPath of possiblePaths) {
    const credsFile = path.join(sessionPath, "creds.json");
    if (fs.existsSync(credsFile)) {
      logger.info(`Yerel oturum dosyası bulundu: ${sessionPath}`);
      const { useMultiFileAuthState } = await loadBaileys();
      const auth = await useMultiFileAuthState(sessionPath);
      if (!auth.clearState) {
        auth.clearState = async () => {
          try {
            if (fs.existsSync(sessionPath)) {
              fs.rmSync(sessionPath, { recursive: true, force: true });
              logger.info(`Lokal oturum dizini temizlendi: ${sessionPath}`);
            }
          } catch (e) {
            logger.error({ err: e.message }, "Lokal oturum temizleme hatası");
          }
        };
      }
      if (!auth.clearSessions) {
        auth.clearSessions = async () => {
          try {
             // For multi-file auth, we can delete the relevant files
             const files = fs.readdirSync(sessionPath);
             for (const file of files) {
               if (file.startsWith("session-") || file.startsWith("sender-key-") || file.startsWith("sender-key-memory-")) {
                 fs.unlinkSync(path.join(sessionPath, file));
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
  }

  // 3. Fallback to DB auth state (SQLite or Postgres)
  logger.info(`[${sessionId}] Yerel oturum dosyası bulunamadı, veritabanına bakılıyor...`);
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
