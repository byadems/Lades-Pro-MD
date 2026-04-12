"use strict";

/**
 * core/handler.js
 * Lades-Pro Style Command Handler
 * Standard: Module({ pattern, fromMe, desc, type }, callback)
 * Callback: async (message, match) => { ... }
 */

const path = require("path");
const fs = require("fs");
const { logger, ...config } = require("../config");
const runtime = require("./runtime");
const { getGroupSettings } = require("./db-cache");
const { isGroup, getGroupAdmins, getMessageText, getMentioned, getQuotedMsg, loadBaileys } = require("./helpers");
const { getMessageByKey, fetchGroupMeta } = require("./store");
const { LRUCache } = require("lru-cache");
const { BotMetric, CommandStat, CommandRegistry, UserData, GroupSettings, MessageStats: MsgStats, Op, sequelize } = require("./database");
const { antidelete } = require("../plugins/utils/db/functions");
const { resolveLidToPn, isBotIdentifier } = require("./lid-helper"); // Moved to top-level

// Point 5 & 17: Redundant commandQueue removed. Concurrency is handled in bot.js.

// ─────────────────────────────────────────────────────────
//  Atomic Statistics Tracker (SQL Backed)
// ─────────────────────────────────────────────────────────
let _runtimeStartTime = Date.now();

/**
 * One-time migration from JSON stats to SQL
 */
async function migrateJsonToSql() {
  const STATS_FILE = path.join(__dirname, '../sessions/cmd-stats.json');
  const RUNTIME_STATS_FILE = path.join(__dirname, '../sessions/runtime-stats.json');

  // Skip if already migrated or files don't exist
  if (!fs.existsSync(STATS_FILE) && !fs.existsSync(RUNTIME_STATS_FILE)) return;

  logger.info("Starting stats migration from JSON to SQL Database...");

  try {
    // 1. Migrate Runtime Stats
    if (fs.existsSync(RUNTIME_STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(RUNTIME_STATS_FILE, 'utf8'));
      if (data.totalMessages) {
        await BotMetric.upsert({ key: 'total_messages', value: data.totalMessages });
      }
      if (data.totalCommands) {
        await BotMetric.upsert({ key: 'total_commands', value: data.totalCommands });
      }
      fs.renameSync(RUNTIME_STATS_FILE, RUNTIME_STATS_FILE + '.bak');
    }

    // 2. Migrate Command Stats
    if (fs.existsSync(STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      for (const [pattern, stat] of Object.entries(data)) {
        await CommandStat.upsert({
          pattern: pattern,
          status: stat.status || 'success',
          runs: stat.runs || 0,
          avgMs: stat.ms || 0,
          lastRun: stat.lastRun ? new Date(stat.lastRun) : new Date(),
          lastError: stat.error || null
        });
      }
      fs.renameSync(STATS_FILE, STATS_FILE + '.bak');
    }
    logger.info("Stats migration completed successfully.");
  } catch (err) {
    logger.error("Stats migration failed: " + err.message);
  }
}

// Run migration on load
migrateJsonToSql();

// ─────────────────────────────────────────────────────────
//  Metrics Batching
// ─────────────────────────────────────────────────────────
const metricsBatch = { total_messages: 0, total_commands: 0 };

setInterval(async () => {
  if (metricsBatch.total_messages === 0 && metricsBatch.total_commands === 0) return;
  const currentBatch = { ...metricsBatch };
  metricsBatch.total_messages = 0;
  metricsBatch.total_commands = 0;

  try {
    if (currentBatch.total_messages > 0) {
      const [metric] = await BotMetric.findOrCreate({ where: { key: 'total_messages' }, defaults: { value: 0 } });
      await metric.increment('value', { by: currentBatch.total_messages });
    }
    if (currentBatch.total_commands > 0) {
      const [metric] = await BotMetric.findOrCreate({ where: { key: 'total_commands' }, defaults: { value: 0 } });
      await metric.increment('value', { by: currentBatch.total_commands });
    }
  } catch (e) {
    logger.debug({ err: e.message }, "Metric batch flush failed");
  }
}, 30000);

async function recordMessage(senderJid, isGroup, groupJid) {
  metricsBatch.total_messages++;
}

async function recordCommand() {
  metricsBatch.total_commands++;
}

async function getRuntimeStats() {
  try {
    const [msgMetric, cmdMetric, userCount, groupCount] = await Promise.all([
      BotMetric.findByPk('total_messages'),
      BotMetric.findByPk('total_commands'),
      UserData.count(),
      GroupSettings.count()
    ]);

    return {
      totalMessages: msgMetric ? parseInt(msgMetric.value) : 0,
      totalCommands: cmdMetric ? parseInt(cmdMetric.value) : 0,
      activeUsers: userCount,
      managedGroups: groupCount,
      uptime: Math.floor((Date.now() - _runtimeStartTime) / 1000)
    };
  } catch (e) {
    return { totalMessages: 0, totalCommands: 0, activeUsers: 0, managedGroups: 0, uptime: 0 };
  }
}

/**
 * Record command execution statistics (Batch optimized)
 */
async function recordStat(pattern, status, durationMs, error = null, isTest = false) {
  const key = String(pattern).replace(/^\(\?:\s*|\)$/g, '').split('|')[0].split('?')[0].split(' ')[0].replace(/[^\wçğıöşüÇĞİÖŞÜ]/gi, '');
  if (!key) return;

  const currentBatch = runtime.commandStatsBatch;
  const entry = currentBatch.get(key) || { runs: 0, avgMs: 0, status: 'ok', lastError: null };
  
  entry.runs++;
  // Moving average calculation
  entry.avgMs = Math.round((entry.avgMs * (entry.runs - 1) + durationMs) / entry.runs);
  if (status === 'error') {
    entry.status = 'error';
    if (error) entry.lastError = String(error).slice(0, 120);
  }
  
  currentBatch.set(key, entry);
  if (!isTest) await recordCommand();
}

// ── Command metrics batch flush (30s) ───────────────────
setInterval(async () => {
  if (runtime.commandStatsBatch.size === 0) return;
  const currentBatch = new Map();
  runtime.commandStatsBatch.forEach((v, k) => currentBatch.set(k, v));
  runtime.commandStatsBatch.clear();

  try {
    for (const [key, stat] of currentBatch.entries()) {
      const [existing] = await CommandStat.findOrCreate({ where: { pattern: key }, defaults: { runs: 0, avgMs: 0 } });
      const newRuns = (existing.runs || 0) + stat.runs;
      const newAvgMs = Math.round(((existing.avgMs || 0) * (existing.runs || 0) + stat.avgMs * stat.runs) / newRuns);
      
      await existing.update({
        runs: newRuns,
        avgMs: newAvgMs,
        status: stat.status,
        lastRun: new Date(),
        lastError: stat.lastError || existing.lastError
      });
    }
  } catch (e) {
    logger.debug({ err: e.message }, "Command metric batch flush failed");
  }
}, 30000);

async function getStats() {
  const rows = await CommandStat.findAll();
  const stats = {};
  rows.forEach(r => {
    stats[r.pattern] = {
      status: r.status,
      ms: r.avgMs,
      lastRun: r.lastRun,
      error: r.lastError,
      runs: r.runs
    };
  });
  return stats;
}

/**
 * Extracts the pure phone number from a Baileys JID.
 * e.g. "121590692456:80@s.whatsapp.net" -> "+121590692456"
 *      "905391234567@s.whatsapp.net"      -> "+905391234567"
 */
function jidToPhone(jid) {
  if (!jid) return 'Bilinmiyor';
  const num = jid.split('@')[0].split(':')[0]; // strip domain and device
  return '+' + num;
}

/**
 * Extracts and standardizes numerical ID for universal comparison (phone or LID).
 */
function getNumericalId(jid) {
  if (!jid) return '';
  // Strip domain: "12345:1@s.whatsapp.net" -> "12345:1"
  // Strip device: "12345:1" -> "12345"
  // Strip leading non-digits (like +)
  return jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

/**
 * Standardizes a JID for comparison (legacy support)
 */
function cleanJid(jid) {
  return getNumericalId(jid);
}

// ─────────────────────────────────────────────────────────
//  BaseMessage Class (Lades-Pro Style)
// ─────────────────────────────────────────────────────────

class ReplyMessage {
  constructor(client, contextInfo, parentMsg) {
    this.client = client;
    this.id = contextInfo.stanzaId;
    this.jid = contextInfo.participant || contextInfo.remoteJid || parentMsg.jid;
    this.remoteJid = contextInfo.remoteJid || parentMsg.jid;
    this.message = contextInfo.quotedMessage;

    // Robust fromMe detection for replies
    const myId = client.user?.id ? getNumericalId(client.user.id) : null;
    const myLid = (client.user && client.user.lid) ? getNumericalId(client.user.lid) : null;
    const senderId = getNumericalId(this.jid);

    this.fromMe = (
      (this.jid?.split("@")[0] === client.user?.id?.split(":")[0]) ||
      (myId && senderId === myId) ||
      (myLid && senderId === myLid)
    );

    // sender alias (group.js, manage.js kullanır)
    this.sender = this.jid;
    // participant alias  
    this.participant = this.jid;

    const msg = this.message || {};
    this.text = getMessageText(msg);
    this.caption = msg.imageMessage?.caption || msg.videoMessage?.caption || msg.documentMessage?.caption || msg.documentWithCaptionMessage?.message?.documentMessage?.caption || "";

    // Media flags (Lades-MD style)
    this.image = !!msg.imageMessage;
    this.video = !!msg.videoMessage;
    this.audio = !!msg.audioMessage || !!msg.audioMessage?.ptt;
    this.ptt = !!(msg.audioMessage?.ptt);
    this.sticker = !!msg.stickerMessage;
    this.document = !!msg.documentMessage;
    this.viewOnce = !!(msg.viewOnceMessage || msg.viewOnceMessageV2);
    this.mimetype = msg.imageMessage?.mimetype || msg.videoMessage?.mimetype ||
      msg.audioMessage?.mimetype || msg.documentMessage?.mimetype || "";

    // Compatibility keys
    this.key = {
      remoteJid: this.remoteJid,
      fromMe: this.fromMe,
      id: this.id,
      participant: this.jid
    };

    // Auto-fix for group quoted keys
    if (parentMsg.isGroup && !this.key.participant) {
      this.key.participant = this.jid || parentMsg.sender;
    }

    // data alias (bazı pluginler message.reply_message.data kullanır)
    this.data = {
      key: this.key,
      message: this.message,
      messageTimestamp: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Median mesajı (alıntılanan) indir.
   * Varsayılan: dosya yolu döndürür (ffmpeg, sticker, createReadStream uyumlu).
   * download("buffer") çağrılırsa buffer döner.
   * Lades-Pro altyapısıyla birebir uyumlu.
   */
  async download(type = "path") {
    try {
      const rawMsg = { key: this.key, message: this.message };
      const { downloadMediaMessage } = await loadBaileys();
      const buf = await downloadMediaMessage(rawMsg, "buffer", {});
      const { getTempPath } = require("./helpers");
      const ext = this._guessExt();
      const outPath = getTempPath(ext);
      const fs = require("fs").promises;
      await fs.writeFile(outPath, buf);
      if (type === "buffer") return buf;
      return outPath;
    } catch (e) {
      logger.debug({ err: e.message }, "ReplyMessage.download error");
      throw e;
    }
  }

  _guessExt() {
    const mime = this.mimetype || "";
    if (this.type === "stickerMessage" || mime.includes("webp")) return ".webp";
    if (mime.includes("image")) return ".jpg";
    if (mime.includes("video")) return ".mp4";
    if (mime.includes("audio")) return ".mp3";
    if (mime.includes("pdf")) return ".pdf";
    return "";
  }
}

class BaseMessage {
  constructor(client, rawMsg, groupMetadata = null) {
    this.client = client;
    this.data = rawMsg;
    this.key = rawMsg.key;
    this.message = rawMsg.message;
    this.jid = rawMsg.key.remoteJid;
    this.id = rawMsg.key.id;
    this.fromMe = rawMsg.key.fromMe;
    this.isGroup = this.jid.endsWith("@g.us");

    if (this.isGroup) {
      this.sender = rawMsg.key.participant || rawMsg.participant || "";
    } else {
      // 100% Robust Numerical fromMe detection
      // Comparing strictly by numerical ID part to bypass @lid vs @s.whatsapp.net mismatch
      const myId = client.user?.id ? getNumericalId(client.user.id) : null;
      const myLid = (client.user && client.user.lid) ? getNumericalId(client.user.lid) : null;
      const senderId = getNumericalId(this.jid);

      const isActuallyMe = this.fromMe || (myId && senderId === myId) || (myLid && senderId === myLid);

      if (isActuallyMe) {
        this.sender = client.user.id;
        this.fromMe = true;
      } else {
        this.sender = this.jid;
      }
    }
    this.timestamp = rawMsg.messageTimestamp;
    this.pushName = rawMsg.pushName || "";
    // senderName: birçok plugin bu alana direkt erişir
    this.senderName = rawMsg.pushName || this.sender?.split("@")[0] || "Kullanıcı";
    this.text = getMessageText(rawMsg.message);
    this.mentions = getMentioned(rawMsg.message);
    // mention: alias for mentions (group.js, manage.js vb. kullanır)
    this.mention = this.mentions;
    this.groupMetadata = groupMetadata;

    // fromOwner: bot sahibi mi gönderiyor kontrol et
    const ownerNum = (config.OWNER_NUMBER || "").replace(/[^0-9]/g, "");
    const senderNum = (this.sender || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "");

    // Çoklu kontrol: Sıkı (strict) JID numarası doğrulama
    this.fromOwner = this.fromMe ||
      (ownerNum && ownerNum !== "905XXXXXXXXX" && senderNum === ownerNum);

    const msg = rawMsg.message || {};
    this.image = !!msg.imageMessage;
    this.video = !!msg.videoMessage;
    this.audio = !!msg.audioMessage;
    this.ptt = !!(msg.audioMessage?.ptt);
    this.sticker = !!msg.stickerMessage;
    this.document = !!msg.documentMessage;
    this.mimetype = msg.imageMessage?.mimetype || msg.videoMessage?.mimetype ||
      msg.audioMessage?.mimetype || msg.documentMessage?.mimetype || "";

    // fromBot flag: bazı pluginler bunu kontrol eder
    const botId = client.user?.id?.split(":")[0];
    this.fromBot = !!(this.sender && botId && this.sender.split("@")[0].split(":")[0] === botId);

    const contextInfo = msg.extendedTextMessage?.contextInfo ||
      msg.imageMessage?.contextInfo ||
      msg.videoMessage?.contextInfo ||
      msg.audioMessage?.contextInfo ||
      msg.stickerMessage?.contextInfo ||
      msg.documentMessage?.contextInfo;

    if (contextInfo?.quotedMessage) {
      this.quoted = new ReplyMessage(client, contextInfo, this);
      this.reply_message = this.quoted; // Lades-Pro uyumluluk alias'ı
    } else {
      this.quoted = null;
      this.reply_message = false;
    }
  }

  /**
   * Send a text message to the current chat (without force-quoting self)
   */
  async send(text, options = {}) {
    if (typeof text === "string") {
      return this.client.sendMessage(this.jid, { text, ...options });
    }
    // sendMessage(content_obj, type, opts) signature
    return this.client.sendMessage(this.jid, text, options);
  }

  /**
   * Reply to the current message (quotes the sender's message)
   */
  async reply(text, options = {}) {
    const content = typeof text === "string" ? { text } : text;
    return this.client.sendMessage(this.jid, { ...content, ...options }, { quoted: this.data });
  }

  /**
   * Delete a message
   */
  async delete(msg = this.data) {
    return this.client.sendMessage(this.jid, { delete: msg.key });
  }

  /**
   * Send a text or media reply with automatic quoting
   */
  async sendReply(text, options = {}, arg3 = {}) {
    // If used as sendReply(content, type, options)
    if (typeof options === "string") {
      return this.sendMessage(text, options, arg3);
    }

    const content = typeof text === "string" ? { text } : text;
    // mentions passthrough
    const mentionsArr = options.mentions || content.mentions || [];
    const finalContent = { ...content };
    if (mentionsArr.length) finalContent.mentions = mentionsArr;
    return this.client.sendMessage(this.jid, finalContent, { quoted: this.data });
  }

  /**
   * Generic send message (Lades-Pro style compatibility)
   */
  async sendMessage(arg1, arg2, arg3, arg4) {
    let jid = this.jid;

    // 1. Direct Baileys generic signature: sendMessage(jid, content, options)
    if (typeof arg1 === "string" && arg1.includes("@")) {
      return this.client.sendMessage(arg1, arg2, arg3 || {});
    }

    // 2. Lades-Pro signature: sendMessage(content, type, options, jid?)
    let r_content = arg1;
    let r_type = arg2;
    let r_options = arg3 || {};
    if (arg4) jid = arg4;

    if (!r_type || typeof r_type === "object") {
      r_options = r_type || {};
      r_type = "text";
    }

    let content = {};
    if (r_type === "text") content = { text: r_content };
    else if (r_type === "image") content = { image: r_content };
    else if (r_type === "video") content = { video: r_content };
    else if (r_type === "audio") content = { audio: r_content };
    else if (r_type === "document") content = { document: r_content };
    else if (r_type === "sticker") content = { sticker: r_content };
    else content = { [r_type]: r_content };

    if (r_options.caption) content.caption = r_options.caption;
    if (r_options.fileName) content.fileName = r_options.fileName;
    if (r_options.mimetype) content.mimetype = r_options.mimetype;
    if (r_options.mentions) content.mentions = r_options.mentions;
    if (r_options.ptt) content.ptt = r_options.ptt;
    if (r_options.gifPlayback) content.gifPlayback = r_options.gifPlayback;

    const baileysOpts = { ...r_options };
    delete baileysOpts.caption;
    delete baileysOpts.fileName;
    delete baileysOpts.mimetype;
    delete baileysOpts.mentions;
    delete baileysOpts.ptt;
    delete baileysOpts.gifPlayback;

    return this.client.sendMessage(jid, content, baileysOpts);
  }

  /**
   * Edit a message (supports original (text, jid, key) signature)
   */
  async edit(text, jid = this.jid, key = this.key) {
    return this.client.sendMessage(jid, { text, edit: key });
  }

  /**
   * React to a message
   */
  async react(emoji) {
    return this.client.sendMessage(this.jid, { react: { text: emoji, key: this.key } });
  }

  /**
   * Forward a message to a JID
   */
  async forward(jid, message = this.data, options = {}) {
    return this.client.sendMessage(jid, { forward: message, ...options });
  }

  /**
   * forwardMessage alias (group.js kullanır)
   */
  async forwardMessage(jid, message = this.data, options = {}) {
    return this.forward(jid, message, options);
  }

  /**
   * Bir medyayı indir (BaseMessage üzerinden)
   */
  async download(type = "path") {
    try {
      const { downloadMediaMessage } = await loadBaileys();
      const buf = await downloadMediaMessage(this.data, "buffer", {});
      const { getTempPath } = require("./helpers");
      const ext = this.mimetype.split("/")[1]?.split(";")[0] || "bin";
      const tmpPath = getTempPath(`media_${Date.now()}.${ext}`);

      if (type === "buffer") return buf;
      await fs.promises.writeFile(tmpPath, buf);
      return tmpPath;
    } catch (e) {
      console.error("BaseMessage.download hatası:", e);
      return null;
    }
  }
}

// ─────────────────────────────────────────────────────────
//  Command registry
const commands = [];
const eventHandlers = new Map();
// ── Command Matching Loop (Removed from global scope) ──────────────────
// on: event handler'lar — text/message/group/groupParticipants tiplerine göre
const onHandlers = { text: [], message: [], group: [], groupParticipants: [] };

/**
 * Module (Lades-Pro standard registration)
 * Pattern ve on: alanlarını destekler.
 */
function Module(options, callback) {
  const cmd = {
    ...options,
    run: callback
  };

  // on: event tipli handler (autodl.js, media.js vb.)
  if (cmd.on && !cmd.pattern && typeof cmd.run === "function") {
    const evType = cmd.on; // "text", "message", "group", "groupParticipants"
    if (!onHandlers[evType]) onHandlers[evType] = [];
    onHandlers[evType].push(cmd);
    return;
  }

  // Pre-compile regex for performance
  if (cmd.pattern) {
    cmd._regex = new RegExp("^" + cmd.pattern, 'iu');
  }

  commands.push(cmd);
}

// Alias for common variants
const bot = Module;

function addEventHandler(event, handler) {
  if (!eventHandlers.has(event)) eventHandlers.set(event, []);
  eventHandlers.get(event).push(handler);
}

function getCommands() { return commands; }

// ─────────────────────────────────────────────────────────
//  Plugin loader
// ─────────────────────────────────────────────────────────
async function loadPlugins(pluginsDir) {
  const pluginFiles = [];

  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) scan(fullPath);
      else if (e.name.endsWith(".js")) pluginFiles.push(fullPath);
    }
  }

  scan(pluginsDir);

  // Clear current commands to reload
  commands.length = 0;
  eventHandlers.clear();
  // on: handler'ları da temizle
  for (const key of Object.keys(onHandlers)) onHandlers[key] = [];

  let loaded = 0, failed = 0;
  for (const file of pluginFiles) {
    try {
      if (file.includes("dashboard")) continue;

      delete require.cache[require.resolve(file)];
      require(file);
      loaded++;
    } catch (err) {
      failed++;
      logger.error({ file, err: err.message }, "Failed to load plugin");
    }
  }

  const onCount = Object.values(onHandlers).reduce((a, b) => a + b.length, 0);

  try {
    const activeCmds = commands.filter(c => c.pattern).map(cmd => {
      let cleanPattern = String(cmd.pattern).trim()
        .replace(/^\/([^\/]+)\/[gimuy]*$/, '$1') // remove regex slashes if any
        .replace(/^\^?(\(\?:\s*)?/, '')
        .replace(/\)?\s*\$?$/, '')
        .replace(/\|/g, " / ")
        .split(" ?")[0]
        .split("?")[0]
        .replace(/^\(\?:\s*|\)$/g, '')
        .trim();

      const statKey = String(cmd.pattern).replace(/^\(\?:\s*|\)$/g, '').split('|')[0].split('?')[0].split(' ')[0].replace(/[^\wçğıöşüÇĞİÖŞÜ]/gi, '');
      return {
        pattern: cleanPattern,
        statKey: statKey,
        description: cmd.desc || '',
        usage: cmd.use || cmd.type || 'genel'
      };
    });

    // SQL tabanlı registry güncelleme - duplikatları temizle
    const seen = new Set();
    const uniqueCmds = activeCmds.filter(c => {
      if (seen.has(c.pattern)) return false;
      seen.add(c.pattern);
      return true;
    });
    await CommandRegistry.destroy({ where: {} });
    if (uniqueCmds.length > 0) {
      await CommandRegistry.bulkCreate(uniqueCmds, { ignoreDuplicates: true });
    }

    // Eski JSON dosyasını temizle (istenirse silinebilir)
    const activeCommandsPath = path.join(__dirname, "../sessions", "active-commands.json");
    if (fs.existsSync(activeCommandsPath)) fs.unlinkSync(activeCommandsPath);

  } catch (err) {
    logger.error("Failed to update CommandRegistry", err.message);
  }

  logger.info(`Plugins loaded: ${loaded} files, ${commands.length} commands, ${onCount} event handlers`);
  return { loaded, failed };
}

//  Rate limiting (Memory leak prevention with LRUCache)
// ─────────────────────────────────────────────────────────
const rateLimit = new LRUCache({ max: 1000 }); // En son aktif 1000 kullanıcıyı tutar
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "8", 10);
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || "10000", 10);

function checkRateLimit(jid) {
  const now = Date.now();
  const entry = rateLimit.get(jid);
  if (!entry || now > entry.resetAt) {
    rateLimit.set(jid, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return false;
  return true;
}

// ─────────────────────────────────────────────────────────
//  Permission helpers (getNumericalId zaten yukarıda tanımlı)
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
//  GLOBAL OWNER LID STORAGE - Runtime'da öğrenilen LID'ler
// ─────────────────────────────────────────────────────────
const OWNER_LIDS = new Set();

function isOwner(senderJid, originalSenderJid, client = null) {
  if (!senderJid) return false;

  const sNum = getNumericalId(senderJid);
  const oNum = getNumericalId(originalSenderJid);

  // ─────────────────────────────────────────────────────────
  //  1. CONFIG OWNER_NUMBER KONTROLÜ
  // ─────────────────────────────────────────────────────────
  const ownerNum = (config.OWNER_NUMBER || "").replace(/[^0-9]/g, "");
  if (ownerNum && ownerNum !== "905XXXXXXXXX") {
    // Numerical ID match
    if (sNum === ownerNum || oNum === ownerNum) {
      if (senderJid && senderJid.includes('@lid')) OWNER_LIDS.add(senderJid);
      if (originalSenderJid && originalSenderJid.includes('@lid')) OWNER_LIDS.add(originalSenderJid);
      return true;
    }
    // Substring match (JID içinde numara var mı?)
    if (senderJid.includes(ownerNum)) {
      if (senderJid.includes('@lid')) OWNER_LIDS.add(senderJid);
      return true;
    }
    if (originalSenderJid && originalSenderJid.includes(ownerNum)) {
      if (originalSenderJid.includes('@lid')) OWNER_LIDS.add(originalSenderJid);
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────
  //  2. ÖĞRENİLMİŞ LID KONTROLÜ
  // ─────────────────────────────────────────────────────────
  if (OWNER_LIDS.has(senderJid) || OWNER_LIDS.has(originalSenderJid)) {
    return true;
  }

  // ─────────────────────────────────────────────────────────
  //  3. SUDO_MAP KONTROLÜ (BELLEK CACHE KULLANILIR)
  // ─────────────────────────────────────────────────────────
  if (config.SUDO_MAP && typeof config.SUDO_MAP === "string") {
    // Sync sudoSet once if empty
    if (runtime.sudoSet.size === 0) {
      try {
        const sudoMap = JSON.parse(config.SUDO_MAP);
        if (Array.isArray(sudoMap)) {
          sudoMap.forEach(v => runtime.sudoSet.add(v));
        }
      } catch (e) { }
    }

    if (senderJid && runtime.sudoSet.has(senderJid)) return true;
    if (originalSenderJid && runtime.sudoSet.has(originalSenderJid)) return true;

    // Numerical check against all LID's numbers in sudoSet
    for (const lid of runtime.sudoSet) {
      const lidNum = getNumericalId(lid);
      if (lidNum === sNum || lidNum === oNum) return true;
    }
  }

  // ─────────────────────────────────────────────────────────
  //  4. BOT'UN KENDİSİ Mİ KONTROLÜ (client varsa)
  // ─────────────────────────────────────────────────────────
  if (client && client.user) {
    const botId = getNumericalId(client.user.id);
    const botLid = client.user.lid ? getNumericalId(client.user.lid) : null;
    if (sNum === botId || oNum === botId) return true;
    if (botLid && (sNum === botLid || oNum === botLid)) return true;
  }

  return false;
}

function isSudo(senderJid, originalSenderJid) {
  // Owner zaten sudo'dur
  if (isOwner(senderJid, originalSenderJid)) return true;

  const senderNum = getNumericalId(senderJid);
  const originalSenderNum = getNumericalId(originalSenderJid);

  // 1. Check runtime.sudoSet (LID or PN) - Point 3 & 10
  if (senderJid && runtime.sudoSet.has(senderJid)) return true;
  if (originalSenderJid && runtime.sudoSet.has(originalSenderJid)) return true;

  // 2. Numerical check against all SUDO entries
  const sudos = config.SUDO ? config.SUDO.split(",").map(s => s.trim().replace(/[^0-9]/g, "")).filter(s => s) : [];
  if (sudos.some(s => s === senderNum || s === originalSenderNum)) return true;

  // 3. Fallback to SUDO_MAP parsing only if sudoSet is empty (unlikely but safe)
  if (runtime.sudoSet.size === 0 && config.SUDO_MAP && typeof config.SUDO_MAP === "string") {
    try {
      const sudoMap = JSON.parse(config.SUDO_MAP);
      if (Array.isArray(sudoMap)) {
        if (senderJid && sudoMap.includes(senderJid)) return true;
        if (originalSenderJid && sudoMap.includes(originalSenderJid)) return true;
      }
    } catch (e) { }
  }

  return false;
}

function isOwnerOrSudo(senderJid, originalSenderJid, client = null) {
  return isOwner(senderJid, originalSenderJid, client) || isSudo(senderJid, originalSenderJid);
}

// Main message handler
// ─────────────────────────────────────────────────────────
async function handleMessage(client, rawMsg, groupMetadata = null) {
  try {
    const message = new BaseMessage(client, rawMsg, groupMetadata);
    const { jid, text, isGroup, fromMe } = message;

    // ── ANTISILME (ANTI-DELETE) LOGIC ──
    if (isGroup && rawMsg.message?.protocolMessage?.type === 0) {
      const deletedKey = rawMsg.message.protocolMessage.key;
      const db = await antidelete.get();
      if (db.some(d => d.jid === jid)) {
        const originalMsg = getMessageByKey(deletedKey);
        if (originalMsg) {
          const participant = deletedKey.participant || deletedKey.remoteJid;
          const senderName = participant.split("@")[0];
          await client.sendMessage(jid, {
            text: `🚨 *Mesaj Silme Engellendi!* 🚨\n\n👤 *Gönderen:* @${senderName}\n\n👇 *Silinen Mesaj:*`,
            mentions: [participant]
          });
          await client.sendMessage(jid, { forward: originalMsg }, { quoted: originalMsg });
          return; // Silme işlemi işlendi, devam etmeye gerek yok
        }
      }
    }

    let senderJid = message.sender; // Alias for legacy checks
    let resolvedSenderJid = senderJid;

    // ─────────────────────────────────────────────────────────
    //  PARTICIPANTPN KONTROLÜ: WhatsApp'ın sağladığı telefon numarasını kullan
    // ─────────────────────────────────────────────────────────
    const participantPn = rawMsg?.key?.participantPn || rawMsg?.participant_pn || null;
    if (participantPn) {
      resolvedSenderJid = participantPn;
      logger.debug(`[ParticipantPN] LID ${senderJid} -> PN ${participantPn}`);
    }

    // ─────────────────────────────────────────────────────────
    //  BOT NUMARASI KONTROLÜ: Bot'un bağlı olduğu numara OWNER'dır
    // ─────────────────────────────────────────────────────────
    const botNumber = client.user?.id ? getNumericalId(client.user.id) : null;
    const botLidNumber = client.user?.lid ? getNumericalId(client.user.lid) : null;
    const senderNumber = getNumericalId(resolvedSenderJid);

    let isBotOwnerNumber = false;
    // Alternatif: Bot bağlı numarayı config'den kontrol et
    const configOwner = (config.OWNER_NUMBER || "").replace(/[^0-9]/g, "");
    if (botNumber === configOwner || botLidNumber === configOwner) {
      isBotOwnerNumber = true;
    }

    // participantPn yoksa veya hala LID ise dene (LRU CACHE ENTEGRASYONU)
    if (resolvedSenderJid && resolvedSenderJid.includes('@lid')) {
      const cachedPn = runtime.lidCache.get(senderJid);
      if (cachedPn) {
        resolvedSenderJid = cachedPn;
      } else {
        try {
          const pn = await resolveLidToPn(client, senderJid);
          if (pn && pn !== senderJid) {
            resolvedSenderJid = pn;
            runtime.lidCache.set(senderJid, pn);
          }
        } catch (e) { }
      }
    }

    // --- DYNAMİC OWNER/SUDO LEARNING ---
    // Eğer PN üzerinden sahibi bulduysak ama LID henüz SUDO_MAP'te yoksa, ekleyelim.
    const ownerNum = (config.OWNER_NUMBER || "").replace(/[^0-9]/g, "");
    if (ownerNum && ownerNum !== "905XXXXXXXXX") {
      const senderNum = getNumericalId(resolvedSenderJid);
      if (senderNum === ownerNum && senderJid.includes("@lid")) {
        if (!runtime.sudoSet.has(senderJid)) {
          runtime.sudoSet.add(senderJid);
          const sudoList = Array.from(runtime.sudoSet);
          config.SUDO_MAP = JSON.stringify(sudoList);
          logger.info(`[Dynamic Auth] Sahip LID öğrenildi: ${senderJid}`);
        }
      }
    }

    // Rate limit kontrolü (Grup için sender+jid, DM için jid)
    const rateLimitKey = isGroup ? `${jid}:${resolvedSenderJid}` : jid;
    if (!fromMe && !isOwnerOrSudo(resolvedSenderJid, senderJid, client) && !checkRateLimit(rateLimitKey)) {
      return; // Limite takıldı, sessizce dur
    }

    // Runtime stats için mesajı kaydet
    recordMessage(resolvedSenderJid, isGroup, jid);

    if (!text) return;

    // ─────────────────────────────────────────────────────────
    //  OWNER/SUDO CHECK - Client ile birlikte kontrol et
    //  fromMe = true ise bot sahibidir (çünkü bot o numaraya bağlı)
    // ─────────────────────────────────────────────────────────
    const ownerCheck = fromMe || isBotOwnerNumber || isOwner(resolvedSenderJid, senderJid, client);
    const sudoCheck = isSudo(resolvedSenderJid, senderJid);
    const publicMode = !config.isPrivate;

    // ─────────────────────────────────────────────────────────
    //  LID ÖĞRENME: Eğer owner ise ve LID ile geliyorsa, kaydet
    // ─────────────────────────────────────────────────────────
    if (ownerCheck && senderJid && senderJid.includes('@lid')) {
      OWNER_LIDS.add(senderJid);
      logger.debug(`[LID Learning] Owner LID kaydedildi: ${senderJid}`);
    }

    // Mesaj nesnesine yetki bilgilerini ekle (Plugin uyumluluğu için)
    message.fromOwner = ownerCheck;
    message.fromSudo = sudoCheck;

    if (config.DEBUG) {
      console.log(`\n--- [NEW MESSAGE] ---`);
      console.log(`| Text: "${text.slice(0, 50)}"`);
      console.log(`| From (resolved): ${resolvedSenderJid}`);
      console.log(`| From (original): ${senderJid}`);
      console.log(`| participantPn: ${rawMsg?.key?.participantPn || 'N/A'}`);
      console.log(`| Auth: Owner=${ownerCheck}, Sudo=${sudoCheck}, Public=${publicMode}`);
      console.log(`--------------------\n`);
    }

    logger.debug({ jid, sender: resolvedSenderJid, text: text.slice(0, 50) }, "Processing message");

    // Auto-read / Auto-typing
    if (!fromMe) {
      if (config.AUTO_READ) {
        setTimeout(() => client.readMessages([rawMsg.key]).catch(() => { }), 50);
      }
    }

    // Metrics tracking with memory safety
    if (!fromMe) {
      // Point 16: Remove 1M reset, use safe increments
      runtime.metrics.messages++;

      // Bellek güvenliği için otomatik budanan LRUCache kullanılır
      runtime.metrics.users.set(resolvedSenderJid, true);

      if (isGroup) {
        runtime.metrics.groups.set(jid, true);
      }
    }

    // ── on:"text" / on:"message" event handler'ları — prefix gerekmez ──────
    const textHandlers = [...(onHandlers.text || []), ...(onHandlers.message || [])];
    if (textHandlers.length > 0) {
      for (const h of textHandlers) {
        // fromMe filtresi - sessizce atla
        if (h.fromMe && !fromMe && !isOwnerOrSudo(resolvedSenderJid, senderJid)) {
          continue;
        }
        try {
          if (h._disabled) continue;
          await h.run(message, [text]);
          h._errorCount = 0;
        } catch (e) {
          notifyHandlerError(h, e, message);
        }
      }
    }

    // Input Validation (Sanitizasyon) katmanı
    const sanitizeInput = (str) => {
      if (typeof str !== 'string') return str;
      // SQL/NoSQL Injection ve temel XSS koruması için tehlikeli karakterleri escape et
      return str.replace(/['";\\]/g, '\\$&').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    if (message.text) {
      // Metni temizle ama komut parametrelerini bozma (komut prefixleri vs için)
      // Ancak loglama ve veritabanı sorgularında bu sanitizeInput kullanılmalıdır.
      // message.text = sanitizeInput(message.text);
    }

    // HANDLERS (Multiple Prefix) Support
    const prefixes = (process.env.HANDLERS || config.PREFIX || ".").split("");
    let prefix = null;
    for (const p of prefixes) {
      if (text.startsWith(p)) { prefix = p; break; }
    }

    // Prefix yoksa komut aramayı bırak (event handler'lar zaten çalıştı)
    if (!prefix) return;

    const input = text.slice(prefix.length).trim();
    logger.debug({ prefix, input }, "Command detected");

    // Permission checks
    const ownerOrSudo = ownerCheck || sudoCheck;

    for (const cmd of commands) {
      // Use pre-compiled regex for maximum speed
      const match = cmd._regex ? input.match(cmd._regex) : null;

      if (match) {
        // ── Native Permission Checks ──
        let isAdmin = false;
        let isBotAdmin = false;

        if (isGroup) {
          try {
            // metadata yoksa çekmeye çalış
            if (!groupMetadata) {
              groupMetadata = await fetchGroupMeta(client, jid);
            }
            if (groupMetadata) {
              const admins = getGroupAdmins(groupMetadata);
              message.groupAdmins = admins; // Tüm liste (eklentiler için)
              isAdmin = admins.some(a => a.split("@")[0].split(":")[0] === senderJid.split("@")[0].split(":")[0] ||
                a.split("@")[0].split(":")[0] === resolvedSenderJid.split("@")[0].split(":")[0]);
              isBotAdmin = admins.some(a => isBotIdentifier(a, client));
            }
          } catch (e) {
            logger.debug({ err: e.message }, "Admin check error");
          }
        } else {
          message.groupAdmins = [];
        }

        // Mesaj nesnesine ekle (pluginler için)
        message.isAdmin = isAdmin;
        message.isBotAdmin = isBotAdmin;
        message.fromOwner = ownerCheck;
        message.fromSudo = sudoCheck;

        // Core Logic Filters - fromMe: true komutlar için hata mesajı
        if (cmd.fromMe && !fromMe && !ownerOrSudo) {
          if (!(cmd.onlyAdmin && isAdmin)) {
            await message.reply("_🔒 OPS! Komut *yalnızca Yazılım Geliştiricim* tarafından kullanılabilir._");
            return;
          }
        }

        if (cmd.onlyOwner && !ownerCheck) {
          await message.reply("❌ Bu komut yalnızca bot sahibi tarafından kullanılabilir.");
          return;
        }
        if (cmd.onlySudo && !ownerOrSudo) {
          await message.reply("❌ Bu komut yalnızca yetkililere aittir.");
          return;
        }
        if (cmd.onlyGroup && !isGroup) {
          await message.reply("❌ Bu komut yalnızca gruplarda kullanılabilir.");
          return;
        }
        if (cmd.onlyDm && isGroup) {
          await message.reply("❌ Bu komut yalnızca özel mesajda kullanılabilir.");
          return;
        }

        // Group Admin check
        if (cmd.onlyAdmin) {
          if (!isGroup) {
            await message.reply("❌ Bu komut grup içinde kullanılabilir.");
            return;
          }
          if (!isAdmin && !ownerOrSudo) {
            await message.reply("❌ Bu komut yalnızca grup yöneticilerine aittir.");
            return;
          }
        }

        // Public Mode check
        if (config.isPrivate) {
          if (!ownerOrSudo) return;
        }

        // Execute command (Callback style: message, match)
        try {
          if (!fromMe) runtime.metrics.commands++;

          // Command Start Reaction (⏳ Processing)
          await message.react("⏳");

          // Non-blocking Auto-Typing when command starts
          if (config.AUTO_TYPING && !fromMe) {
            setTimeout(() => {
              client.sendPresenceUpdate('composing', jid).catch(() => { });
            }, 10);
          }

          // Performance measurement start
          const _t0 = Date.now();

          // Point 5: Removed commandQueue. pLimit(5) in bot.js is sufficient.
          await cmd.run(message, match);

          const _dur = Date.now() - _t0;
          logger.debug({ cmd: cmd.pattern, jid, senderJid, ms: _dur }, "Command executed");
          recordStat(cmd.pattern, 'ok', _dur);

          // Success Reaction
          await message.react("✅");

        } catch (err) {
          logger.error({ err, cmd: cmd.pattern }, "Command execution error");
          recordStat(cmd.pattern, 'error', 0, err.message);

          // PUSH FAILED COMMAND TO ACTIVITY BOARD
          const actSender = (senderJid || '').split('@')[0] || (message.sender || '').split('@')[0];
          const actGroup = (message.isGroup && groupMetadata) ? groupMetadata.subject : 'Grup';
          process.emit('dashboard_activity', {
            isGroup: !!message.isGroup,
            sender: actSender,
            groupName: actGroup,
            type: 'Error', // Plain text for UI handling
            text: String(err.message).slice(0, 80),
            cmd: cmd.pattern,
            time: new Date().toLocaleTimeString('tr-TR', { hour12: false })
          });

          // Error Reaction
          await message.react("❌");

          if (config.DEBUG) {
            await message.reply(`❌ Hata: \`${err.message}\``);
          }
        }

        // Match found, break loop
        return;
      }
    }

  } catch (err) {
    logger.error({ err }, "handleMessage error");
  }
}

async function handleGroupUpdate(client, update) {
  // traditional eventHandlers (Map)
  const handlers = eventHandlers.get("group") || [];
  for (const h of handlers) {
    try { await h(client, update); } catch { }
  }
  // Module({ on: "group", ... }) handlers
  const onH = [...(onHandlers.group || []), ...(onHandlers["group-update"] || [])];
  if (onH.length > 0) {
    const message = {
      client,
      jid: update.id,
      from: update.author || update.id,
      action: update.action || "update",
      participants: update.participants || [],
      ...update
    };
    for (const h of onH) {
      try { await h.run(message, []); } catch (e) {
        logger.debug({ err: e.message, type: "group" }, "on-group handler error");
      }
    }
  }
}

async function handleGroupParticipantsUpdate(client, update) {
  // traditional eventHandlers (Map)
  const handlers = eventHandlers.get("groupParticipants") || [];
  for (const h of handlers) {
    try { await h(client, update); } catch { }
  }
  // Module({ on: "groupParticipants", ... }) handlers
  const onH = onHandlers.groupParticipants || [];
  if (onH.length > 0) {
    const message = {
      client,
      jid: update.id,
      sender: update.author || update.id,
      from: update.author || update.id,
      participant: update.participants || [],
      action: update.action,
      isGroup: true, // Her zaman true çünkü groupParticipantsUpdate
      ...update
    };
    for (const h of onH) {
      try {
        await h.run(message, []);
      } catch (e) {
        logger.debug({ err: e.message, type: "groupParticipants" }, "on-groupParticipants handler error");
      }
    }
  }
}

/**
 * Centrally handles event handler errors and notifies owner
 * @param {object} h - The handler object
 * @param {Error} e - Encountered error
 * @param {object} message - Message context
 */
function notifyHandlerError(h, e, message) {
  h._errorCount = (h._errorCount || 0) + 1;
  logger.warn({ err: e.message, pattern: h.on, count: h._errorCount }, "on-event handler error");

  if (h._errorCount >= 3) {
    h._disabled = true;
    logger.error({ pattern: h.on }, "Handler devredışı bırakıldı (3 ardışık hata)");
    const ownerNum = (config.OWNER_NUMBER || "").replace(/[^0-9]/g, "");
    if (ownerNum && message.client) {
      try {
        message.client.sendMessage(ownerNum + "@s.whatsapp.net", {
          text: `🚨 *Kritik Hata Uyarısı*\nBir \`on:\` event handler 3 ardışık hata nedeniyle devredışı bırakıldı.\n\n*Type:* ${h.on || "Bilinmiyor"}\n*Son Hata:* ${e.message}`
        });
      } catch (_) { }
    }
  }
}

module.exports = {
  Module, bot, BaseMessage,
  loadPlugins, handleMessage,
  handleGroupUpdate, handleGroupParticipantsUpdate,
  isOwner, isSudo, isOwnerOrSudo,
  getStats, recordStat, getRuntimeStats,
  onHandlers,
  commands: (() => commands),
};
