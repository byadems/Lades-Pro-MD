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

  const deepRevive = (obj) => {
    if (obj && typeof obj === 'object') {
      if (obj.type === 'Buffer' && (typeof obj.data === 'string' || Array.isArray(obj.data))) {
        return Buffer.from(obj.data, typeof obj.data === 'string' ? "base64" : undefined);
      }
      for (const k in obj) obj[k] = deepRevive(obj[k]);
    }
    return obj;
  };

  let sessionRow = await WhatsappOturum.findByPk(sessionId);

  function getState() {
    if (!sessionRow || !sessionRow.sessionData) return {};
    try {
      const data = typeof sessionRow.sessionData === 'string'
        ? JSON.parse(sessionRow.sessionData)
        : sessionRow.sessionData;
      return deepRevive(data) || {};
    } catch (e) {
      logger.error({ err: e.message, sessionId }, "Failed to parse session data from DB");
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
  // sessions ise WhatsApp'a bağlı cihaz oturumlarıdır; stale olanları sil.
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

  let writePromise = Promise.resolve();
  const saveCreds = async (force = false) => {
    if (!force) {
      if (saveThrottle) return;
      saveThrottle = setTimeout(() => {
        saveThrottle = null;
        saveCreds(true);
      }, 2000); // 2s throttle (reduced from 10s for better session sync)
      return;
    }

    // Chain writes to avoid race conditions (Write Queue)
    writePromise = writePromise.then(async () => {
      const { sequelize } = require("./database");
      try {
        await sequelize.transaction(async (t) => {
          // Serialize current state
          const sessionData = JSON.stringify({ creds, keys: storedKeys }, BufferJSON.replacer);
          if (!sessionRow) {
            sessionRow = await WhatsappOturum.create({ sessionId, sessionData }, { transaction: t });
          } else {
            await sessionRow.update({ sessionData }, { transaction: t });
          }
          modifiedKeys.clear();
        });
      } catch (err) {
        logger.error({ err: err.message, sessionId }, "Failed to save session data to DB");
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
        pruneOldKeys(); // Birikmiş preKey/session key'leri periyodik temizle
        await saveCreds();
      }
    },
  }, logger.child({ module: "signal", level: "error" }));

  const clearState = async () => {
    if (sessionRow) {
      await sessionRow.update({ sessionData: null });
      // NEW: Clear local memory to prevent accidental re-save of corrupted data
      for (const k in creds) delete creds[k];
      for (const k in storedKeys) delete storedKeys[k];
      logger.info(`Session ${sessionId} data cleared from database and memory.`);
    }
  };

  return { state: { creds, keys }, saveCreds, clearState };
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

  return { state: { creds: state.creds || {}, keys }, saveCreds, clearState: async () => { } };
}

// ─────────────────────────────────────────────────────────
//  Get auth state - pick method based on config
// ─────────────────────────────────────────────────────────
async function getAuthState(config, sessionId = "lades-session") {
  // 1. If SESSION env contains a base64 string
  if (config.SESSION && config.SESSION.length > 20 && !config.SESSION.startsWith("path:")) {
    logger.info("Oturum metni (session string) kimlik doğrulaması kullanılıyor.");
    try {
      return await useSessionStringAuthState(config.SESSION);
    } catch (e) {
      logger.warn("Oturum metni ayrıştırma hatası, yerel dosyaya dönülüyor.");
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
      return auth;
    }
  }

  // 3. Fallback to DB auth state (SQLite or Postgres)
  logger.info(`[${sessionId}] Geçerli oturum bulunamadı. Dashboard üzerinden giriş yapılması bekleniyor...`);
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
