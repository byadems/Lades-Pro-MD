"use strict";

/**
 * core/auth.js
 * WhatsApp authentication - QR code and Pair Code support.
 * Uses @whiskeysockets/baileys useMultiFileAuthState for local
 * or stores session in DB for cloud deployments.
 */

const path = require("path");
const fs = require("fs");
const { Browsers, fetchLatestBaileysVersion, useMultiFileAuthState, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const qrcodeTerminal = require("qrcode-terminal");
const { WhatsappSession } = require("./database");
const { logger } = require("../config");

// ─────────────────────────────────────────────────────────
//  DB-backed auth state (for cloud / PostgreSQL deployments)
// ─────────────────────────────────────────────────────────
async function useDbAuthState(sessionId) {
  let sessionRow = await WhatsappSession.findByPk(sessionId);

  const reviveBuffer = (key, value) => {
    if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
      return Buffer.from(value.data);
    }
    return value;
  };

  function getState() {
    if (!sessionRow || !sessionRow.sessionData) return {};
    // Hack to recursively revive buffers from JSONB plain objects
    return JSON.parse(JSON.stringify(sessionRow.sessionData), reviveBuffer);
  }

  const state = {
    creds: getState().creds || {},
    keys: getState().keys || {},
  };

  const saveCreds = async () => {
    if (!sessionRow) {
      sessionRow = await WhatsappSession.create({ sessionId, sessionData: { creds: state.creds, keys: state.keys } });
    } else {
      await sessionRow.update({ sessionData: { creds: state.creds, keys: state.keys } });
    }
  };

  const keys = makeCacheableSignalKeyStore({
    get: async (type, ids) => {
      const data = {};
      const stored = getState().keys || {};
      for (const id of ids) {
        const val = stored[type] && stored[type][id];
        if (val) data[id] = val;
      }
      return data;
    },
    set: async (data) => {
      const stored = getState().keys || {};
      for (const category in data) {
        stored[category] = stored[category] || {};
        for (const id in data[category]) {
          if (data[category][id]) stored[category][id] = data[category][id];
          else delete stored[category][id];
        }
      }
      state.keys = stored;
      await saveCreds();
    },
  }, logger.child({ module: "signal" }));

  return { state: { creds: state.creds, keys }, saveCreds };
}

// ─────────────────────────────────────────────────────────
//  Session string (base64) auth state - for cloud deploy
// ─────────────────────────────────────────────────────────
async function useSessionStringAuthState(sessionString) {
  let state;
  const reviveBuffer = (key, value) => {
    if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
      return Buffer.from(value.data);
    }
    return value;
  };

  try {
    const decoded = Buffer.from(sessionString, "base64").toString("utf-8");
    state = JSON.parse(decoded, reviveBuffer);
  } catch {
    state = {};
  }

  const saveCreds = async () => { /* no-op for session string mode */ };

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
  }, logger.child({ module: "signal" }));

  return { state: { creds: state.creds || {}, keys }, saveCreds };
}

// ─────────────────────────────────────────────────────────
//  Get auth state - pick method based on config
// ─────────────────────────────────────────────────────────
async function getAuthState(config, sessionId = "nexbot-session") {
  const sessionsDir = path.join(__dirname, "..", "sessions", sessionId);

  // 1. If SESSION env contains a base64 string
  if (config.SESSION && config.SESSION.length > 20 && !config.SESSION.startsWith("path:")) {
    logger.info("Oturum metni (session string) kimlik doğrulaması kullanılıyor.");
    try {
      return await useSessionStringAuthState(config.SESSION);
    } catch (e) {
      logger.warn("Oturum metni ayrıştırma hatası, veri tabanına veya yerel dosyaya dönülüyor.");
    }
  }

  // 2. If DATABASE_URL is set, use DB
  if (config.DATABASE_URL) {
    logger.info(`Veri tabanı kimlik doğrulaması kullanılıyor (Oturum: ${sessionId})`);
    return await useDbAuthState(sessionId);
  }

  // 3. Local file auth state
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
  logger.info(`Yerel dosya kimlik doğrulaması kullanılıyor (${sessionsDir})`);
  return await useMultiFileAuthState(sessionsDir);
}

// ─────────────────────────────────────────────────────────
//  QR Code display
// ─────────────────────────────────────────────────────────
function displayQR(qr) {
  qrcodeTerminal.generate(qr, { small: true });
  logger.info("Bağlanmak için yukarıdaki QR kodu okutun!");
}

// ─────────────────────────────────────────────────────────
//  Baileys version helper
// ─────────────────────────────────────────────────────────
async function getBaileysVersion() {
  try {
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
