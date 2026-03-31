"use strict";

/**
 * core/bot.js
 * Creates a Baileys socket, manages connection state,
 * binds all event handlers, and implements reconnect logic.
 */

const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  proto,
} = require("@whiskeysockets/baileys");

const { logger, ...config } = require("../config");
const { getAuthState, displayQR } = require("./auth");
const { bindToSocket, fetchGroupMeta } = require("./store");
const { handleMessage, handleGroupUpdate, handleGroupParticipantsUpdate, loadPlugins } = require("./handler");
const { startTempCleanup, stopTempCleanup, isGroup } = require("./helpers");
const path = require("path");

// ─────────────────────────────────────────────────────────
//  Reconnect state
// ─────────────────────────────────────────────────────────
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;
let reconnectCount = 0;
let _pairCodeRequested = false;

// ─────────────────────────────────────────────────────────
//  Create bot instance
// ─────────────────────────────────────────────────────────
async function createBot(sessionId = "lades-session", options = {}) {
  const { state, saveCreds } = await getAuthState(config, sessionId);
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
    browser: ["Lades-Pro-MD", "Chrome", "2.0.0"],
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

  // Credential updates → save to DB/file
  sock.ev.on("creds.update", saveCreds);

  // ── Connection events ────────────────────────────────
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr, isNewLogin } = update;

    if (qr) {
      displayQR(qr);
      // If pair code is enabled and not yet requested
      if (options.phoneNumber && !_pairCodeRequested) {
        _pairCodeRequested = true;
        setTimeout(async () => {
          try {
            const code = await sock.requestPairingCode(options.phoneNumber);
            logger.info(`📱 Eşleşme Kodu: ${code}`);
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📱 Telefonunuzda WhatsApp > Bağlı Cihazlar > Cihaz Bağla\n   Kod: ${code}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
          } catch (err) {
            logger.error({ err }, "Pair code request failed");
          }
        }, 3000);
      }
    }

    if (connection === "open") {
      reconnectCount = 0;
      _pairCodeRequested = false;
      logger.info(`✅ Bot bağlandı! JID: ${sock.user?.id}`);
      startTempCleanup();

      // Load plugins on first connect
      const pluginsDir = path.join(__dirname, "..", "plugins");
      loadPlugins(pluginsDir);

      // Self-test: tüm komutları sessizce test et (Arka planda)
      setTimeout(async () => {
        try {
          const { runSelfTest } = require("./self-test");
          runSelfTest(sock); // Await kaldırıldı, arka planda çalışsın
        } catch (e) {
          logger.warn({ err: e.message }, "Self-test atlandı");
        }
      }, 3000);
    }

    if (connection === "close") {
      stopTempCleanup();
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn({ statusCode }, `Bağlantı kesildi, yeniden bağlanılıyor=${shouldReconnect}`);

      if (shouldReconnect) {
        reconnectCount++;
        const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectCount - 1), RECONNECT_MAX_MS);
        logger.info(`${delay}ms içinde yeniden bağlanılıyor (Deneme ${reconnectCount})...`);
        setTimeout(() => createBot(sessionId, options), delay);
      } else {
        logger.error("Oturum kapatıldı! Lütfen yeniden doğrulama yapın.");
        // Oturum geçersiz olduğunda yerel dosyayı temizleyelim ki bir sonraki restartta QR çıksın
        try {
          const sessionsDir = path.join(__dirname, "..", "sessions", sessionId);
          const credsFile = path.join(sessionsDir, "creds.json");
          if (fs.existsSync(credsFile)) {
            fs.unlinkSync(credsFile);
            logger.info("Geçersiz creds.json silindi, yeni oturum için hazır.");
          }
        } catch (e) {
          logger.warn({ err: e.message }, "Oturum dosyası temizlenemedi");
        }
        process.exit(1);
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
      
      // Her mesajı ayrı bir "non-blocking" işlem olarak ele alalım
      (async () => {
        try {
          let groupMeta = null;
          if (isGroup(jid)) {
            groupMeta = await fetchGroupMeta(sock, jid);
          }
          await handleMessage(sock, msg, groupMeta);
        } catch (err) {
          logger.error({ err, jid }, "Mesaj işleme hatası (upsert)");
        }
      })();
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
