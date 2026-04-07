"use strict";

/**
 * core/handler.js
 * Lades-Pro Style Command Handler
 * Standard: Module({ pattern, fromMe, desc, type }, callback)
 * Callback: async (message, match) => { ... }
 */

const path = require("path");
const fs = require("fs");
const config = require("../config");
const { logger } = require("../config");
const { getGroupSettings } = require("./db-cache");
const { isGroup, getGroupAdmins, getMessageText, getMentioned, getQuotedMsg, loadBaileys } = require("./helpers");
const { LRUCache } = require("lru-cache");

// ─────────────────────────────────────────────────────────
//  Command Stats Tracker
// ─────────────────────────────────────────────────────────
const STATS_FILE = path.join(__dirname, '../sessions/cmd-stats.json');
let cmdStats = {};

try {
  if (fs.existsSync(STATS_FILE)) cmdStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
} catch { cmdStats = {}; }

let _statsSaveTimer = null;
function recordStat(pattern, status, durationMs, error = null) {
  const key = String(pattern).split('?')[0].split(' ')[0].replace(/[^\wçğıöşüÇĞİÖŞÜ]/gi, '');
  if (!key) return;
  
  cmdStats[key] = {
    status,
    ms: durationMs,
    lastRun: new Date().toISOString(),
    error: error ? String(error).slice(0, 120) : null,
    runs: (cmdStats[key]?.runs || 0) + 1
  };

  if (!_statsSaveTimer) {
    _statsSaveTimer = setTimeout(async () => {
       try {
         await fs.promises.writeFile(STATS_FILE, JSON.stringify(cmdStats));
       } catch (e) { }
       _statsSaveTimer = null;
    }, 2 * 60 * 1000);
  }
}

// Process çıkarken son halini kaydet
process.on('exit', () => {
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(cmdStats)); } catch {}
});

function getStats() { return cmdStats; }

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
    this.fromMe = this.jid?.split("@")[0] === client.user?.id?.split(":")[0];
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
    this.fromOwner = !!(ownerNum && senderNum && senderNum === ownerNum) || this.fromMe;

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
   * Send a text message with reply alias — always quotes the triggering message
   */
  async sendReply(text, options = {}) {
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
// ─────────────────────────────────────────────────────────
const commands = [];
const eventHandlers = new Map();
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
function loadPlugins(pluginsDir) {
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
//  Permission helpers
// ─────────────────────────────────────────────────────────
function isOwner(senderJid) {
  if (!senderJid) return false;
  
  // 1. Numerical comparison (most robust)
  const senderNum = getNumericalId(senderJid);
  const ownerNum = (config.OWNER_NUMBER || "").replace(/[^0-9]/g, "");
  
  if (ownerNum && senderNum === ownerNum) return true;
  
  return false;
}

function isSudo(senderJid) {
  if (!config.SUDO) return false;
  // Use getNumericalId for sudo check as well
  const sudos = config.SUDO.split(",").map(s => s.trim().replace(/[^0-9]/g, ""));
  const senderNum = getNumericalId(senderJid);
  return sudos.includes(senderNum);
}

function isOwnerOrSudo(senderJid) {
  return isOwner(senderJid) || isSudo(senderJid);
}

// ─────────────────────────────────────────────────────────
//  Main message handler
// ─────────────────────────────────────────────────────────
// Initialize globals for dashboard metrics
global.metrics_messages = global.metrics_messages || 0;
global.metrics_commands = global.metrics_commands || 0;
global.metrics_users_set = global.metrics_users_set || new LRUCache({ max: 2000 });
global.metrics_groups_set = global.metrics_groups_set || new LRUCache({ max: 500 });

async function handleMessage(client, rawMsg, groupMetadata = null) {
  try {
    const message = new BaseMessage(client, rawMsg, groupMetadata);
    const { jid, sender, text, isGroup, fromMe } = message;
    const senderJid = sender; // Alias for legacy checks

    // Rate limit kontrolü (Grup için sender+jid, DM için jid)
    const rateLimitKey = isGroup ? `${jid}:${senderJid}` : jid;
    if (!fromMe && !isOwnerOrSudo(senderJid) && !checkRateLimit(rateLimitKey)) {
      return; // Limite takıldı, sessizce dur
    }

    if (!text) return;

    const ownerCheck = isOwner(senderJid) || fromMe;
    const sudoCheck = isSudo(senderJid);
    const publicMode = (process.env.PUBLIC_MODE === "true" || config.PUBLIC_MODE);

    if (config.DEBUG) {
        console.log(`\n--- [NEW MESSAGE] ---`);
        console.log(`| Text: "${text}"`);
        console.log(`| From: ${senderJid} (Me: ${fromMe}, Group: ${isGroup})`);
        console.log(`| Auth: Owner=${ownerCheck}, Sudo=${sudoCheck}, Public=${publicMode}`);
        console.log(`--------------------\n`);
    }

    logger.debug({ jid, sender, text: text.slice(0, 50) }, "Processing message");

    // Auto-read / Auto-typing
    if (!fromMe) {
      if (config.AUTO_READ) {
        setTimeout(() => client.readMessages([rawMsg.key]).catch(() => { }), 50);
      }
    }

    // Metrics tracking with memory safety (capped size & auto-clear)
    if (!fromMe) {
      if (global.metrics_messages > 1000000) global.metrics_messages = 0; // Prevent overflow
      global.metrics_messages++;
      
      // Bellek güvenliği için otomatik budanan LRUCache kullanılır
      global.metrics_users_set.set(senderJid, true);
      
      if (isGroup) {
        global.metrics_groups_set.set(jid, true);
      }
    }

    // ── on:"text" / on:"message" event handler'ları — prefix gerekmez ──────
    const textHandlers = [...(onHandlers.text || []), ...(onHandlers.message || [])];
    if (textHandlers.length > 0) {
      for (const h of textHandlers) {
        // fromMe filtresi - sessizce atla
        if (h.fromMe && !fromMe && !isOwnerOrSudo(senderJid)) {
          continue;
        }
        try {
          if (h._disabled) continue; await h.run(message, [text]); h._errorCount = 0;
        } catch (e) {
          h._errorCount = (h._errorCount || 0) + 1; logger.warn({ err: e.message, pattern: h.on, count: h._errorCount }, "on-event handler error"); if (h._errorCount >= 3) { h._disabled = true; logger.error({ pattern: h.on }, "Handler devredışı bırakıldı (3 ardışık hata)"); const ownerNum = (config.OWNER_NUMBER || "").replace(/[^0-9]/g, ""); if (ownerNum && message.client) { try { message.client.sendMessage(ownerNum + "@s.whatsapp.net", { text: "🚨 *Kritik Hata Uyarısı*\nBir `on:` event handler 3 ardışık hata nedeniyle devredışı bırakıldı.\n\n*Type:* " + (h.on || "Bilinmiyor") + "\n*Son Hata:* " + e.message }); } catch (_) {} } }
        }
      }
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
                groupMetadata = await client.groupMetadata(jid).catch(() => null);
            }
            if (groupMetadata) {
              const admins = getGroupAdmins(groupMetadata);
              message.groupAdmins = admins; // Tüm liste (eklentiler için)
              isAdmin = admins.includes(senderJid);
              isBotAdmin = admins.includes(client.user?.id?.split(":")[0] + "@s.whatsapp.net") || 
                           admins.includes(client.user?.id?.split(":")[0] + "@c.us");
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
 
        // Core Logic Filters - fromMe: true komutlar için hata mesajı
        if (cmd.fromMe && !fromMe && !ownerOrSudo) {
          await message.reply("_🔒 OPS! Komut *yalnızca Yazılım Geliştiricim* tarafından kullanılabilir._");
          return;
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
        if (!(process.env.PUBLIC_MODE === "true" || config.PUBLIC_MODE)) {
          if (!ownerOrSudo) return;
        }

        // Execute command (Callback style: message, match)
        try {
          if (!fromMe) global.metrics_commands++;

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

          // Komut çalıştırılırken (hata yakalama bloğu içindeyiz)
          await cmd.run(message, match);

          const _dur = Date.now() - _t0;
          logger.debug({ cmd: cmd.pattern, jid, senderJid, ms: _dur }, "Command executed");
          recordStat(cmd.pattern, 'ok', _dur);

          // Success Reaction
          await message.react("✅");

        } catch (err) {
          logger.error({ err, cmd: cmd.pattern }, "Command execution error");
          recordStat(cmd.pattern, 'error', 0, err.message);

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
      from: update.author || update.id,
      participant: update.participants || [],
      action: update.action,
      ...update
    };
    for (const h of onH) {
      try { await h.run(message, []); } catch (e) {
        logger.debug({ err: e.message, type: "groupParticipants" }, "on-groupParticipants handler error");
      }
    }
  }
}

module.exports = {
  Module, bot, BaseMessage,
  loadPlugins, handleMessage,
  handleGroupUpdate, handleGroupParticipantsUpdate,
  isOwner, isSudo, isOwnerOrSudo,
  getStats, recordStat,
  onHandlers,
  commands: (() => commands),
};
