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
const { isGroup, getGroupAdmins, getMessageText, getMentioned, getQuotedMsg, loadBaileys } = require("./yardimcilar");
const { getMessageByKey, fetchGroupMeta } = require("./store");
const { LRUCache } = require("lru-cache");
const { BotMetrik, KomutIstatistik, KomutKayit, KullaniciVeri, GrupAyar, MesajIstatistik: MsgStats, Op, sequelize } = require("./database");
const { antidelete } = require("../plugins/utils/db/fonksiyonlar");
const { resolveLidToPn, isBotIdentifier } = require("./yardimcilar"); // Moved to top-level

// ── PERFORMANS: ownerNum bir kez hesaplanır, her mesajda regex yok
const _cachedOwnerNum = (config.OWNER_NUMBER || '').replace(/[^0-9]/g, '');

// ─────────────────────────────────────────────────────────
//  Antidelete JID Cache — DB'yi her silmede çarpmamak için
//  60 saniyede bir yenilenen in-memory Set
// ─────────────────────────────────────────────────────────
const _antideleteCache = new Set();
async function _refreshAntideleteCache() {
  try {
    const rows = await antidelete.get();
    _antideleteCache.clear();
    if (Array.isArray(rows)) rows.forEach(r => r.jid && _antideleteCache.add(r.jid));
  } catch (e) { /* DB henüz hazır değil, sessizce atla */ }
}

// Dışarıya açık getter — yonetim_araclari.js getStatus() bunu kullanır
// (her .ayarlar çağrısında antidelete.get() DB sorgusu yerine)
function getAntideleteCache() { return _antideleteCache; }
// Cache'i zorla yenile — antisilme aç/kapat sonrası anında efektif
async function invalidateAntideleteCache() { await _refreshAntideleteCache(); }

// Point 5 & 17: Redundant commandQueue removed. Concurrency is handled in bot.js.


// ─────────────────────────────────────────────────────────
//  Atomic Statistics Tracker (SQL Backed)
// ─────────────────────────────────────────────────────────

/**
 * One-time migration from JSON stats to SQL
 */
async function migrateJsonToSql() {
  const STATS_FILE = path.join(__dirname, '../sessions/cmd-stats.json');
  const RUNTIME_STATS_FILE = path.join(__dirname, '../sessions/runtime-stats.json');

  // Skip if already migrated or files don't exist
  if (!fs.existsSync(STATS_FILE) && !fs.existsSync(RUNTIME_STATS_FILE)) return;

  logger.info("İstatistikler JSON'dan SQL Veritabanına taşınıyor...");

  try {
    // 1. Migrate Runtime Stats
    if (fs.existsSync(RUNTIME_STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(RUNTIME_STATS_FILE, 'utf8'));
      if (data.totalMessages) {
        await BotMetrik.upsert({ key: 'total_messages', value: data.totalMessages });
      }
      if (data.totalCommands) {
        await BotMetrik.upsert({ key: 'total_commands', value: data.totalCommands });
      }
      fs.renameSync(RUNTIME_STATS_FILE, RUNTIME_STATS_FILE + '.bak');
    }

    // 2. Migrate Command Stats
    if (fs.existsSync(STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      for (const [pattern, stat] of Object.entries(data)) {
        await KomutIstatistik.upsert({
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
    logger.info("İstatistik taşıma başarıyla tamamlandı.");
  } catch (err) {
    logger.error("İstatistik taşıma hatası: " + err.message);
  }
}

// ─────────────────────────────────────────────────────────
//  Metrics Batching
// ─────────────────────────────────────────────────────────
const metricsBatch = { total_messages: 0, total_commands: 0 };

const scheduler = require("./zamanlayici").scheduler;

// Antidelete cache: başlangıçta ve 60s'de bir yenile
scheduler.register('antidelete_cache_refresh', _refreshAntideleteCache, 60000, { runImmediately: true });

// ─────────────────────────────────────────────────────────
//  StickerCmd LRU Cache — handler hot-path'te her sticker
//  mesajında DB'ye gitmemek için 2 dakikalık önbellek.
//  Tablo küçüktür (<100 satır), tamamını belleğe alıyoruz.
// ─────────────────────────────────────────────────────────
let _stickcmdCache = null;
let _stickcmdCacheAt = 0;
const STICKCMD_CACHE_MS = 2 * 60 * 1000; // 2 dakika

async function getStickcmdCached() {
  const now = Date.now();
  if (_stickcmdCache && (now - _stickcmdCacheAt) < STICKCMD_CACHE_MS) return _stickcmdCache;
  try {
    const { stickcmd } = require('../plugins/utils/db/zamanlayicilar');
    const rows = await stickcmd.get();
    _stickcmdCache = rows || [];
    _stickcmdCacheAt = now;
  } catch (_) {
    if (!_stickcmdCache) _stickcmdCache = [];
  }
  return _stickcmdCache;
}

function invalidateStickcmdCache() { _stickcmdCache = null; _stickcmdCacheAt = 0; }

scheduler.register('metrics_batch_flush', async () => {
  if (metricsBatch.total_messages === 0 && metricsBatch.total_commands === 0) return;
  const currentBatch = { ...metricsBatch };
  metricsBatch.total_messages = 0;
  metricsBatch.total_commands = 0;

  try {
    // OPT: findOrCreate + increment = 2 sorgu → tek increment (upsert garantisi
    // başlangıçta yapılır, sayaç sıfır altına düşemez).
    // İlk kez sıfır değerle insert; sonraki çağrılarda sadece increment.
    if (currentBatch.total_messages > 0) {
      await BotMetrik.upsert({ key: 'total_messages', value: currentBatch.total_messages })
        .catch(async () => {
          // upsert desteklenmiyorsa (SQLite eski sürüm) güvenli fallback
          await BotMetrik.findOrCreate({ where: { key: 'total_messages' }, defaults: { value: 0 } });
          await BotMetrik.increment('value', { by: currentBatch.total_messages, where: { key: 'total_messages' } });
        });
    }
    if (currentBatch.total_commands > 0) {
      await BotMetrik.upsert({ key: 'total_commands', value: currentBatch.total_commands })
        .catch(async () => {
          await BotMetrik.findOrCreate({ where: { key: 'total_commands' }, defaults: { value: 0 } });
          await BotMetrik.increment('value', { by: currentBatch.total_commands, where: { key: 'total_commands' } });
        });
    }
  } catch (e) {
    logger.debug({ err: e.message }, "Metric batch flush failed");
  }
}, 30000);

// Sync: sadece sayaç arttırıyor, async overhead gereksizdi
function recordMessage() {
  metricsBatch.total_messages++;
}

function recordCommand() {
  metricsBatch.total_commands++;
}

// getRuntimeStats — 24/7 OPT: 60 saniye cache (45s→60s: daha az DB sorgusu)
let _runtimeStatsCache = null;
let _runtimeStatsCacheAt = 0;
const RUNTIME_STATS_CACHE_MS = 60000; // 45s→60s

async function getRuntimeStats() {
  const now = Date.now();
  if (_runtimeStatsCache && (now - _runtimeStatsCacheAt) < RUNTIME_STATS_CACHE_MS) {
    return _runtimeStatsCache;
  }
  try {
    const [msgMetric, cmdMetric, userCount, groupCount] = await Promise.all([
      BotMetrik.findByPk('total_messages'),
      BotMetrik.findByPk('total_commands'),
      require('./store').getTotalUserCount(),
      GrupAyar.count()
    ]);

    _runtimeStatsCache = {
      totalMessages: msgMetric ? parseInt(msgMetric.value) : 0,
      totalCommands: cmdMetric ? parseInt(cmdMetric.value) : 0,
      activeUsers: userCount,
      modules: commands.length,
      uptime: Math.floor((Date.now() - runtime.startTime) / 1000)
    };
    _runtimeStatsCacheAt = now;
    return _runtimeStatsCache;
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
  // commandStatsBatch sınırsız büyümeyi önle (max 300 komut) — 24/7 OPT: 500→300
  if (runtime.commandStatsBatch.size > 300) {
    const firstKey = runtime.commandStatsBatch.keys().next().value;
    runtime.commandStatsBatch.delete(firstKey);
  }
  if (!isTest) recordCommand();
}

// ── Command metrics batch flush (30s) ────────────────────────
// PERFORMANS: N+1 sorgu yerine tek bulkCreate+updateOnDuplicate
scheduler.register('command_metrics_flush', async () => {
  if (runtime.commandStatsBatch.size === 0) return;
  const currentBatch = new Map();
  runtime.commandStatsBatch.forEach((v, k) => currentBatch.set(k, v));
  runtime.commandStatsBatch.clear();

  try {
    const records = Array.from(currentBatch.entries()).map(([key, stat]) => ({
      pattern: key,
      runs: stat.runs,
      avgMs: stat.avgMs,
      status: stat.status || 'ok',
      lastRun: new Date(),
      lastError: stat.lastError || null,
    }));
    await KomutIstatistik.bulkCreate(records, {
      updateOnDuplicate: ['runs', 'avgMs', 'status', 'lastRun', 'lastError', 'updatedAt'],
    });
  } catch (e) {
    // Fallback: SQLite eski sürümde updateOnDuplicate yoksa N+1 yöntemi
    try {
      for (const [key, stat] of currentBatch.entries()) {
        const [record, created] = await KomutIstatistik.findOrCreate({
          where: { pattern: key },
          defaults: { runs: stat.runs, avgMs: stat.avgMs, status: stat.status, lastError: stat.lastError, lastRun: new Date() }
        });
        if (!created) {
          const nr = record.runs + stat.runs;
          await record.update({
            runs: nr,
            avgMs: nr > 0 ? Math.round((record.avgMs * record.runs + stat.avgMs * stat.runs) / nr) : 0,
            status: stat.status || record.status,
            lastRun: new Date(),
            lastError: stat.lastError || record.lastError
          });
        }
      }
    } catch (e2) { logger.debug({ err: e2.message }, "metrics flush fallback failed"); }
  }
}, 30000);

/**
 * Function factory to build the handler objects consistently.
 */
async function getStats() {
  const rows = await KomutIstatistik.findAll();
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
 * Extracts and standardizes numerical ID for universal comparison (phone or LID).
 */
function getNumericalId(jid) {
  if (!jid) return '';
  // Strip domain: "12345:1@s.whatsapp.net" -> "12345:1"
  // Strip device: "12345:1" -> "12345"
  // Strip leading non-digits (like +)
  return jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
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

    // Media flags (Lades-Pro style)
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
      const { getTempPath } = require("./yardimcilar");
      const ext = this._guessExt();
      const outPath = getTempPath(ext);
      const fs = require("fs").promises;
      await fs.writeFile(outPath, buf);
      if (type === "buffer") return buf;
      return outPath;
    } catch (e) {
      // Eski/silinmiş mesajlarda Baileys medya anahtarı boş olabilir
      if (
        e.message?.includes("empty media key") ||
        e.message?.includes("Cannot derive") ||
        e.message?.includes("media key") ||
        e.message?.includes("decrypt")
      ) {
        const err = new Error("MEDIA_KEY_EXPIRED: Medya çok eski veya silinmiş, tekrar gönderilmesi gerekiyor.");
        err.code = "MEDIA_KEY_EXPIRED";
        throw err;
      }
      logger.debug({ err: e.message }, "YanıtMesajı.indirme hatası");
      throw e;
    }
  }

  _guessExt() {
    const mime = this.mimetype || "";
    if (this.type === "stickerMessage" || mime.includes("webp")) return ".webp";
    if (mime.includes("image")) return ".jpg";
    if (mime.includes("video")) return ".mp4";
    if (mime.includes("audio")) {
      if (mime.includes("ogg")) return ".ogg";
      if (mime.includes("mp4") || mime.includes("aac")) return ".m4a";
      return ".mp3";
    }
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
    this.isChannel = this.jid.endsWith("@newsletter");
    this.isDashboard = this.id && this.id.startsWith("DASHBOARD_");

    if (this.isGroup) {
      // Grup: participant bilgisini kullan
      this.sender = rawMsg.key.participant || rawMsg.participant || "";
    } else if (this.isChannel) {
      // ─────────────────────────────────────────────────────────
      //  KANAL (WhatsApp Newsletter) DESTEĞI
      //  Kanalda yalnızca admin mesaj gönderebilir.
      //  key.participant = gerçek gönderen (diğer yönetici) VEYA undefined (bot kendi yayınladı)
      //  Her iki durum da bot sahibi/admin → fromMe = true olarak işle
      // ─────────────────────────────────────────────────────────
      const channelPoster = rawMsg.key.participant || rawMsg.participant;
      if (channelPoster && !channelPoster.endsWith('@newsletter')) {
        // Belirli bir gönderen var (örn. başka bir kanal yöneticisi)
        this.sender = channelPoster;
      } else {
        // Bot kendi kanalına post attı veya gönderen bilinmiyor
        // Her durumda kanal adminiyiz → bot sahibi olarak işle
        this.sender = client.user?.id || this.jid;
        this.fromMe = true; // Kanal postları bot/admin tarafından → fromMe
      }
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
    if (typeof text === "string" && (!options || !options.edit)) {
      return this.client.sendMessage(this.jid, { text, ...options });
    }
    // Route to sendMessage to handle (content, type, options) signature
    return this.sendMessage(text, options);
  }

  /**
   * Reply to the current message (quotes the sender's message if not in a channel)
   */
  async reply(text, options = {}) {
    const content = typeof text === "string" ? { text } : text;
    const sendOpts = (this.isChannel || this.isDashboard) ? {} : { quoted: this.data };
    return this.client.sendMessage(this.jid, { ...content, ...options }, sendOpts);
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

    const sendOpts = (this.isChannel || this.isDashboard) ? {} : { quoted: this.data };
    return this.client.sendMessage(this.jid, finalContent, sendOpts);
  }

  /**
   * Generic send message (Lades-Pro style compatibility)
   */
  async sendMessage(arg1, arg2, arg3, arg4) {
    let jid = this.jid;

    // 1. Direct Baileys generic signature: sendMessage(jid, content, options)
    const isJid = typeof arg1 === "string" && !arg1.includes(" ") && (
      arg1.endsWith("@s.whatsapp.net") ||
      arg1.endsWith("@g.us") ||
      arg1.endsWith("@lid") ||
      arg1.endsWith("@newsletter") ||
      arg1 === "status@broadcast"
    );
    if (isJid) {
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
    if (r_options.mentions) content.mentions = r_options.mentions;
    if (r_options.gifPlayback) content.gifPlayback = r_options.gifPlayback;

    // Audio/voice note (PTT) handling
    if (r_type === "audio" && r_options.ptt) {
      try {
        const { toOpus, toMp4Audio } = require("./media-utils");
        let audioBuffer = r_content;
        if (Buffer.isBuffer(r_content)) {
          audioBuffer = r_content;
        } else if (r_content && r_content.url) {
          const { getBuffer } = require("../plugins/utils");
          audioBuffer = await getBuffer(r_content.url);
        }
        if (audioBuffer) {
          const opusBuffer = await toOpus(audioBuffer);
          content.audio = opusBuffer;
          content.mimetype = "audio/ogg; codecs=opus";
          content.ptt = true;
        } else {
          content.mimetype = r_options.mimetype || "audio/ogg";
          content.ptt = r_options.ptt;
        }
      } catch (err) {
        console.error("Sesli mesaj dönüşümü başarısız:", err);
        content.mimetype = r_options.mimetype || "audio/ogg";
        content.ptt = r_options.ptt;
      }
    } else if (r_type === "audio") {
      // audio/mp4 (AAC container) = iOS + Android uyumlu oynatma çubuklu ses
      // audio/mpeg (MP3) iOS'ta açılmaz; bot.js interceptor da bu dönüşümü yapar
      content.mimetype = r_options.mimetype || "audio/mpeg";
    }

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
      const { getTempPath } = require("./yardimcilar");
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
const commandMap = new Map(); // Store handlers organized by prefix / trigger.

// Store legacy plugins correctly
const eventHandlers = new Map();
// ── Command Matching Loop (Removed from global scope) ──────────────────
// on: event handler'lar — text/message/group/groupParticipants tiplerine göre
const onHandlers = { text: [], message: [], group: [], groupParticipants: [] };

// ─────────────────────────────────────────────────────────
//  PERFORMANS: textHandlers cache — her mesajda yeni dizi
//  oluşturulmaması için plugin reload'da yenilenir.
// ─────────────────────────────────────────────────────────
let _cachedTextHandlers = null;
function getTextHandlers() {
  if (!_cachedTextHandlers) {
    _cachedTextHandlers = [...(onHandlers.text || []), ...(onHandlers.message || [])];
  }
  return _cachedTextHandlers;
}

// ─────────────────────────────────────────────────────────
//  PERFORMANS: SUDO nums cache — config.SUDO string her
//  komut çağrısında parse edilmemesi için bir kez cache'lenir.
// ─────────────────────────────────────────────────────────
let _sudoNumsCache = null;
let _sudoNums_configSnapshot = null;
function getCachedSudoNums() {
  const currentSudo = config.SUDO || '';
  if (_sudoNums_configSnapshot !== currentSudo) {
    _sudoNums_configSnapshot = currentSudo;
    _sudoNumsCache = new Set(
      currentSudo.split(',').map(s => s.trim().replace(/[^0-9]/g, '')).filter(Boolean)
    );
  }
  return _sudoNumsCache;
}

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
    // O(1) index — Türkçe dahil Unicode harfleri koru
    const firstWord = cmd.pattern.split(/\s|\\s|\[/)[0].replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    if (firstWord) {
      if (!commandMap.has(firstWord)) commandMap.set(firstWord, []);
      commandMap.get(firstWord).push(cmd);
    }
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
//  Plugin loader (Optimized for Lifecycle)
// ─────────────────────────────────────────────────────────
let _pluginsLoaded = false;
let _lastPluginHash = "";

async function loadPlugins(pluginsDir, force = false) {
  const pluginFiles = [];

  // Point 4: Async FS scan for performance
  async function scan(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) await scan(fullPath);
      else if (e.name.endsWith(".js")) pluginFiles.push(fullPath);
    }
  }

  await scan(pluginsDir);

  // Point 5: Hash-based cold-start optimization
  // Only reload if file list changed OR first load OR force = true
  const currentHash = pluginFiles.sort().join("|");
  if (!force && _pluginsLoaded && currentHash === _lastPluginHash) {
    logger.debug("Eklentiler zaten yüklü ve değişmemiş. Yeniden yükleme atlanıyor.");
    return;
  }
  _lastPluginHash = currentHash;
  _pluginsLoaded = true;

  // Clear current commands to reload
  commands.length = 0;
  commandMap.clear(); // Important for the O(1) optimization
  eventHandlers.clear();
  // on: handler'ları da temizle
  for (const key of Object.keys(onHandlers)) onHandlers[key] = [];
  // textHandlers cache'i geçersiz kıl (plugin reload sonrası yeniden oluşturulacak)
  _cachedTextHandlers = null;

  let loaded = 0, failed = 0;
  for (const file of pluginFiles) {
    try {
      if (file.includes("dashboard")) continue;

      delete require.cache[require.resolve(file)];
      require(file);
      loaded++;
    } catch (err) {
      failed++;
      logger.error({ file, err: err.message }, "Eklenti yüklenemedi");
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
    await KomutKayit.destroy({ where: {} });
    if (uniqueCmds.length > 0) {
      await KomutKayit.bulkCreate(uniqueCmds, { ignoreDuplicates: true });
    }

    // Eski JSON dosyasını temizle (istenirse silinebilir)
    const activeCommandsPath = path.join(__dirname, "../sessions", "active-commands.json");
    if (fs.existsSync(activeCommandsPath)) fs.unlinkSync(activeCommandsPath);

  } catch (err) {
    logger.error("Komut kayıt güncelleme hatası", err.message);
  }

  logger.info(`Plugins loaded: ${loaded} files, ${commands.length} commands, ${onCount} event handlers`);
  return { loaded, failed };
}

//  Rate limiting (Memory leak prevention with LRUCache)
// ─────────────────────────────────────────────────────────
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "8", 10);
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || "10000", 10);
// 24/7 OPT: Rate limit cache 150 kullanıcı (200→150), TTL aynı
const rateLimit = new LRUCache({ max: 150, ttl: RATE_LIMIT_WINDOW * 3 });

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
  //  1. CONFIG OWNER_NUMBER KONTROLÜ (_cachedOwnerNum: modül seviyesinde hesaplandı)
  // ─────────────────────────────────────────────────────────
  const ownerNum = _cachedOwnerNum; // Her çağrıda regex yapma
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

  // 2. Numerical check against all SUDO entries (cached Set — string parse sadece 1x yapılır)
  const sudoNums = getCachedSudoNums();
  if (sudoNums.has(senderNum) || sudoNums.has(originalSenderNum)) return true;

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
    let { jid, text, isGroup, isChannel, fromMe } = message;

    // ── OTO-ÇIKARTMA (STICKER CMD) INTERCEPTOR ──
    // OPT: stickcmd.get() her stickerde DB'ye gitmek yerine 2dk LRU cache kullanır
    const stickerMsg = rawMsg.message?.stickerMessage || rawMsg.message?.documentWithCaptionMessage?.message?.stickerMessage;
    if (stickerMsg?.fileSha256) {
      try {
        const cmds = await getStickcmdCached();
        if (cmds && cmds.length > 0) {
          // BUG FIX: fileSha256 bir Uint8Array/Buffer — .toString() latın1/decimal çıkar
          // DB'ye base64 olarak kaydedildiğinden aynı format kullanılmalı
          const sha = Buffer.isBuffer(stickerMsg.fileSha256)
            ? stickerMsg.fileSha256.toString('base64')
            : Buffer.from(stickerMsg.fileSha256).toString('base64');
          const match = cmds.find(c => c.file === sha);
          if (match && match.command) {
            text = match.command;
            message.text = text; // Match command handler needs text
            logger.info(`[AutoSticker] Sticker intercepted and translated to: ${text}`);
          }
        }
      } catch (e) {
        logger.error(`[AutoSticker] Intercept error: ${e.message}`);
      }
    }

    // ── ANTISILME (ANTI-DELETE) LOGIC ──
    // antidelete.get() her silmede DB çarpmayı önlemek için in-memory Set cache kullanılır
    if (isGroup && rawMsg.message?.protocolMessage?.type === 0) {
      const deletedKey = rawMsg.message.protocolMessage.key;

      // Bot'un kendi silme işlemlerini yoksay (bot tarafından yapılan revoke)
      if (rawMsg.key.fromMe) return;

      if (_antideleteCache.has(jid)) {
        // rawMsg.key.participant = mesajı kim sildi (revoke isteğini gönderen)
        // deletedKey.participant = silinen mesajın orijinal sahibi
        const deleterJid = rawMsg.key.participant || rawMsg.key.remoteJid || jid;
        const originalSenderJid = deletedKey.participant || deletedKey.remoteJid || jid;
        const deleterNum = deleterJid.split("@")[0];
        const originalSenderNum = originalSenderJid.split("@")[0];
        const isSelfDelete = deleterJid === originalSenderJid;

        // Mesaj türü etiketi
        const MSG_TYPE_LABELS = {
          conversation: "💬 Metin",
          extendedTextMessage: "💬 Metin",
          imageMessage: "🖼️ Fotoğraf",
          videoMessage: "🎥 Video",
          audioMessage: "🎵 Ses",
          documentMessage: "📄 Döküman",
          stickerMessage: "🎭 Çıkartma",
          contactMessage: "👤 Kişi",
          locationMessage: "📍 Konum",
          pollCreationMessage: "📊 Anket",
          reactionMessage: "❤️ Tepki",
        };

        const targetJid = jid;

        const originalMsg = getMessageByKey(deletedKey);

        if (originalMsg) {
          // ── Mesaj önbellekte bulundu → içeriğiyle birlikte ilet ──
          const detectedType = Object.keys(originalMsg.message || {}).find(t => MSG_TYPE_LABELS[t]);
          const typeLabel = MSG_TYPE_LABELS[detectedType] || "❓ Mesaj";

          let headerText, mentions;
          if (isSelfDelete) {
            headerText = `🚨 *Silinmiş Mesaj Kurtarıldı!*\n\n🗑️ *Silen:* @${deleterNum} _(kendi mesajını sildi)_\n📁 *Tür:* ${typeLabel}\n\n👇 *Silinen mesaj:*`;
            mentions = [deleterJid];
          } else {
            headerText = `🚨 *Silinmiş Mesaj Kurtarıldı!*\n\n🗑️ *Silen:* @${deleterNum}\n👤 *Mesaj Sahibi:* @${originalSenderNum}\n📁 *Tür:* ${typeLabel}\n\n👇 *Silinen mesaj:*`;
            mentions = [deleterJid, originalSenderJid];
          }

          await client.sendMessage(targetJid, { text: headerText, mentions });
          await client.sendMessage(targetJid, { forward: originalMsg }, { quoted: originalMsg });
        } else {
          // ── Mesaj önbellekte yok → yine de bildir ──
          let fallbackText, mentions;
          if (isSelfDelete) {
            fallbackText = `🚨 *Mesaj Silindi!*\n\n🗑️ *Silen:* @${deleterNum} _(kendi mesajını sildi)_\n\n⚠️ _Mesaj içeriği kaydedilemedi (bot yeni başlatılmış veya grup önbellekten düşmüş olabilir)._`;
            mentions = [deleterJid];
          } else {
            fallbackText = `🚨 *Mesaj Silindi!*\n\n🗑️ *Silen:* @${deleterNum}\n👤 *Mesaj Sahibi:* @${originalSenderNum}\n\n⚠️ _Mesaj içeriği kaydedilemedi (bot yeni başlatılmış veya grup önbellekten düşmüş olabilir)._`;
            mentions = [deleterJid, originalSenderJid];
          }
          await client.sendMessage(targetJid, { text: fallbackText, mentions });
        }
        return;
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

    // ── PM_BLOCK (Özel Mesajları Engelleme) ──
    if (config.PM_BLOCK && !isGroup && !isChannel && !fromMe && !isOwnerOrSudo(resolvedSenderJid, senderJid, client)) {
      return; // Özel mesajlar (DM) kapalıysa atla
    }

    // Rate limit kontrolü (Grup için sender+jid, DM için jid)
    // Kanallar (isChannel) için rate limit atla — kanal adminleri engellenemez
    const rateLimitKey = isGroup ? `${jid}:${resolvedSenderJid}` : jid;
    if (!isChannel && !fromMe && !isOwnerOrSudo(resolvedSenderJid, senderJid, client) && !checkRateLimit(rateLimitKey)) {
      return; // Limite takıldı, sessizce dur
    }

    // Runtime stats için mesajı kaydet (sync) — yalnızca metinli mesajlar sayılır
    if (text) {
      recordMessage();
    }


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
      logger.debug({ text: text.slice(0, 50), from: resolvedSenderJid, orig: senderJid, pn: rawMsg?.key?.participantPn, owner: ownerCheck, sudo: sudoCheck }, '[MSG]');
    }


    logger.debug({ jid, sender: resolvedSenderJid, text: text.slice(0, 50) }, "Mesaj işleniyor");

    // Auto-read / Auto-typing
    if (!fromMe) {
      // Global AUTO_READ config VEYA grup bazlı .otogörüldü komutuyla açılmışsa işaretle
      const groupAutoRead = global._autoReadGroups?.has(jid);
      if (config.AUTO_READ || groupAutoRead) {
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

      // ── KULLANICI İSTATİSTİKLERİ — DB'ye batch olarak yaz (60s flush) ──
      // incrementStats() eksikliği nedeniyle getTotalUserCount() her zaman 0 dönüyordu.
      // Artık her mesajı MesajIstatistik tablosuna yazıyoruz.
      try {
        const msgType = rawMsg.message
          ? (rawMsg.message.imageMessage ? 'image'
            : rawMsg.message.videoMessage ? 'video'
              : rawMsg.message.audioMessage ? 'audio'
                : rawMsg.message.stickerMessage ? 'sticker'
                  : 'text')
          : 'text';
        const { incrementStats } = require('./store');
        incrementStats(jid, resolvedSenderJid || senderJid, msgType);
      } catch (_) { /* İstatistik hatası asıl akışı engellememeli */ }
    }

    // ── OTO-TEPKİ (AUTO-REACT) — Grup bazlı izolasyon ──────────────────────
    // .ototepki ac/kapat komutuyla açılmış gruplarda tepki ver
    if (!fromMe && global._autoReactGroups?.has(jid)) {
      const emojis = ["👍", "❤️", "😂", "🔥", "🎉", "✅", "💯", "👏"];
      const emoji = emojis[Math.floor(Math.random() * emojis.length)];
      client.sendMessage(jid, { react: { text: emoji, key: rawMsg.key } }).catch(() => { });
    }

    // ── Native Permission Checks Ön Yükleme ──
    let isAdmin = false;
    let isBotAdmin = false;
    let groupMetadataFetched = null;

    if (isGroup) {
      try {
        groupMetadataFetched = await fetchGroupMeta(client, jid);
        if (groupMetadataFetched) {
          const admins = getGroupAdmins(groupMetadataFetched);
          message.groupAdmins = admins;
          isAdmin = admins.some(a => a.split("@")[0].split(":")[0] === senderJid.split("@")[0].split(":")[0] ||
            a.split("@")[0].split(":")[0] === resolvedSenderJid.split("@")[0].split(":")[0]);
          // isBotIdentifier is globally scoped here
          isBotAdmin = admins.some(a => isBotIdentifier(a, client));
        }
      } catch (e) {
        logger.debug({ err: e.message }, "Admin kontrolü hatası");
      }
    } else if (isChannel) {
      message.groupAdmins = [senderJid, resolvedSenderJid];
      isAdmin = true;
      isBotAdmin = true;
    } else {
      message.groupAdmins = [];
    }

    message.isAdmin = isAdmin;
    message.isBotAdmin = isBotAdmin;

    // ── on:"text" / on:"message" event handler'ları — prefix gerekmez ──────
    // Cache kullan: her mesajda spread/concat yapma (O(1) lookup)
    const textHandlers = getTextHandlers();
    if (textHandlers.length > 0) {
      for (const h of textHandlers) {
        // fromMe filtresi: sadece bot sahibi/sudo değilse VE admin erişimi kapalıysa atla
        if (h.fromMe && !fromMe && !isOwnerOrSudo(resolvedSenderJid, senderJid)) {
          // ADMIN_ACCESS açıksa ve grup admini ise geç
          if (!(config.ADMIN_ACCESS && message.isAdmin)) {
            continue;
          }
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



    // HANDLERS (Multiple Prefix) Support
    const prefixes = (process.env.HANDLERS || config.PREFIX || ".").split("");
    let prefix = null;
    for (const p of prefixes) {
      if (text.startsWith(p)) { prefix = p; break; }
    }

    // Prefix yoksa komut aramayı bırak (event handler'lar zaten çalıştı)
    if (!prefix) return;

    const input = text.slice(prefix.length).trim();
    logger.debug({ prefix, input }, "Komut tespit edildi");

    // Permission checks
    const ownerOrSudo = ownerCheck || sudoCheck;

    // Point 2 & 10: O(1) Optimized Command Lookup
    const firstWord = input.split(/\s/)[0].toLowerCase();
    const candidateCommands = commandMap.get(firstWord) || commands;

    for (const cmd of candidateCommands) {
      // Use pre-compiled regex for maximum speed
      const match = cmd._regex ? input.match(cmd._regex) : null;

      if (match) {
        // ── Native Permission Checks Removed To Top ──

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
        if (cmd.onlyGroup && !isGroup && !isChannel) {
          await message.reply("❌ Bu komut yalnızca gruplarda kullanılabilir.");
          return;
        }
        if (cmd.onlyDm && isGroup) {
          await message.reply("❌ Bu komut yalnızca özel mesajda kullanılabilir.");
          return;
        }

        // Group Admin check
        if (cmd.onlyAdmin) {
          if (!isGroup && !isChannel) {
            await message.reply("❌ Bu komut grup içinde kullanılabilir.");
            return;
          }
          if (!isAdmin && !ownerOrSudo) {
            await message.reply("❌ Bu komut yalnızca grup yöneticilerine aittir.");
            return;
          }
        }

        // Public Mode check — private modda yalnızca owner/sudo/admin geçer
        if (config.isPrivate) {
          if (!ownerOrSudo && !(config.ADMIN_ACCESS && isAdmin)) return;
        }

        // Execute command (Callback style: message, match)
        try {
          if (!fromMe) runtime.metrics.commands++;

          // Command Start Reaction (⏳ Processing)
          if (config.SEND_REACTIONS) await message.react("⏳");

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
          if (config.SEND_REACTIONS) await message.react("✅");

          // PUSH SUCCESSFUL COMMAND TO ACTIVITY BOARD
          if (!fromMe) {
            const actSender = (resolvedSenderJid || senderJid || '').split('@')[0] || message.pushName || 'Bilinmiyor';
            const actGroup = (message.isGroup && groupMetadata) ? groupMetadata.subject : null;
            process.emit('dashboard_activity', {
              isGroup: !!message.isGroup,
              sender: actSender,
              groupName: actGroup || 'Özel',
              type: 'Komut',
              content: text.slice(0, 60),
              command: cmd.pattern,
              time: new Date().toLocaleTimeString('tr-TR', { hour12: false })
            });
          }

        } catch (err) {
          logger.error({ err, cmd: cmd.pattern }, "Komut çalıştırma hatası");
          recordStat(cmd.pattern, 'error', 0, err.message);

          // PUSH FAILED COMMAND TO ACTIVITY BOARD
          const actSender = (resolvedSenderJid || senderJid || '').split('@')[0] || message.pushName || 'Bilinmiyor';
          const actGroup = (message.isGroup && groupMetadata) ? groupMetadata.subject : null;
          process.emit('dashboard_activity', {
            isGroup: !!message.isGroup,
            sender: actSender,
            groupName: actGroup || 'Özel',
            type: 'Error',
            content: String(err.message).slice(0, 60),
            command: cmd.pattern,
            time: new Date().toLocaleTimeString('tr-TR', { hour12: false })
          });

          // Error Reaction
          if (config.SEND_REACTIONS) await message.react("❌");

          if (config.DEBUG) {
            await message.reply(`❌ Hata: \`${err.message}\``);
          }
        }

        // Match found, break loop
        return;
      }
    }

  } catch (err) {
    // ─────────────────────────────────────────────────────────
    //  Rate Limit Handling (Referans: KB-Mini:828-831)
    //  rate-overlimit hatalarında sessizce geç, kullanıcıya hata gönderme
    // ─────────────────────────────────────────────────────────
    if (err.message && err.message.includes('rate-overlimit')) {
      logger.warn('⚠️ Rate limit reached. Mesaj atlandı.');
      return;
    }

    logger.error({ err }, "Mesaj işleme hatası");
  }
}

async function handleGroupUpdate(client, update) {
  // traditional eventHandlers (Map)
  const handlers = eventHandlers.get("group") || [];
  for (const h of handlers) {
    try { await h(client, update); } catch (e) {
      logger.debug({ err: e?.message || String(e), type: "group" }, "Klasik grup işleyici hatası");
    }
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
        logger.debug({ err: e.message, type: "group" }, "Grup işleyici hatası");
      }
    }
  }
}

async function handleGroupParticipantsUpdate(client, update) {
  // Admin değişikliklerinin anında algılanması için cache'i temizle
  const { invalidateGroupMeta } = require('./store');
  if (update.id) invalidateGroupMeta(update.id);

  // traditional eventHandlers (Map)
  const handlers = eventHandlers.get("groupParticipants") || [];
  for (const h of handlers) {
    try { await h(client, update); } catch (e) {
      logger.debug({ err: e?.message || String(e), type: "groupParticipants" }, "Klasik grup katılımcıları işleyici hatası");
    }
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
        logger.debug({ err: e.message, type: "groupParticipants" }, "Grup katılımcıları işleyici hatası");
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
  logger.warn({ err: e.message, pattern: h.on, count: h._errorCount }, "Olay işleyici hatası");

  if (h._errorCount >= 3) {
    if (!h._disabled) {
      h._disabled = true;
      logger.error({ pattern: h.on }, "Önek devredışı bırakıldı (3 ardışık hata) - 2 Dakika sonra kendi kendine onarılacak.");

      // Auto-heal özelliği: Veritabanı gecikmeleri yüzünden botun işlevlerini tamamen kaybetmesini önler
      setTimeout(() => {
        h._disabled = false;
        h._errorCount = 0;
        logger.info({ pattern: h.on }, "Zaman aşımı doldu, önek tekrardan devreye alındı!");
      }, 120000); // 2 dakika

      const ownerNum = (config.OWNER_NUMBER || "").replace(/[^0-9]/g, "");
      if (ownerNum && message.client) {
        try {
          message.client.sendMessage(ownerNum + "@s.whatsapp.net", {
            text: `🚨 *Geçici Sistem Uyarısı*\n\nBir \`on:\` event handler (örn. grup yönetimi) 3 ardışık hata nedeniyle koruma moduna alındı. Sistem *2 dakika içinde* kendi kendini onaracaktır.\n\n*Type:* ${h.on || "Bilinmiyor"}\n*Son Hata:* ${e.message}`
          });
        } catch (_) { }
      }
    }
  }
}

module.exports = {
  Module, bot, BaseMessage,
  loadPlugins, handleMessage,
  handleGroupUpdate, handleGroupParticipantsUpdate,
  isOwner, isSudo, isOwnerOrSudo,
  getStats, recordStat, getRuntimeStats,
  getAntideleteCache,
  invalidateStickcmdCache,
  invalidateAntideleteCache,
  onHandlers,
  commands,
};
