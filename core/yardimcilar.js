"use strict";

/**
 * core/helpers.js
 * Shared utility functions used across the bot.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const pLimit = require("p-limit");
const { getCachedAdmins, setCachedAdmins } = require("./db-cache");
const axios = require("axios");
const config = require("../config");
const { logger } = config;

const ffmpegLimit = pLimit(3); // Global FFmpeg concurrency limit
const fsp = fs.promises;

// ─────────────────────────────────────────────────────────
//  Temp directory
// ─────────────────────────────────────────────────────────
const TEMP_DIR = path.join(os.tmpdir(), "lades-pro-temp");

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function getTempPath(ext = "") {
  ensureTempDir();
  return path.join(TEMP_DIR, `nex_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
}

function getTempSubdir(name) {
  ensureTempDir();
  const subdir = path.join(TEMP_DIR, name);
  if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true });
  return subdir;
}

function cleanTempFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    logger.debug({ err: e }, "cleanTempFile error");
  }
}

// Auto-cleanup temp dir every 30 min
const scheduler = require("./zamanlayici").scheduler;
let _tempCleanupTask = null;

function startTempCleanup(intervalMs = 30 * 60 * 1000) {
  if (_tempCleanupTask) return;
  
  _tempCleanupTask = scheduler.register('temp_cleanup', async () => {
    try {
      if (!fs.existsSync(TEMP_DIR)) return;
      
      const files = await fsp.readdir(TEMP_DIR);
      const now = Date.now();
      let count = 0;
      for (const f of files) {
        const p = path.join(TEMP_DIR, f);
        try {
          const stat = await fsp.stat(p);
          if (now - stat.mtimeMs > intervalMs) {
            await fsp.rm(p, { recursive: true, force: true });
            count++;
          }
        } catch {}
      }
      if (count > 0) logger.debug(`[Cleanup] ${count} temp file cleaned.`);
    } catch (e) {
      logger.debug({ err: e.message }, "Temp cleanup failed");
    }
  }, intervalMs);
}

function stopTempCleanup() {
  if (_tempCleanupTask) {
    _tempCleanupTask(); // Unregister
    _tempCleanupTask = null;
  }
}

// ─────────────────────────────────────────────────────────
//  JID utilities
// ─────────────────────────────────────────────────────────
function toUserJid(jidOrPhone) {
  if (!jidOrPhone) return null;
  const cleaned = String(jidOrPhone).replace(/[^0-9]/g, "");
  return `${cleaned}@s.whatsapp.net`;
}

function toGroupJid(groupId) {
  if (!groupId) return null;
  if (groupId.includes("@g.us")) return groupId;
  return `${groupId}@g.us`;
}

function parseJid(jid) {
  if (!jid) return null;
  return jid.split("@")[0];
}

function isGroup(jid) {
  return jid && jid.endsWith("@g.us");
}

function isBroadcast(jid) {
  return jid && jid.endsWith("@broadcast");
}

// ─────────────────────────────────────────────────────────
//  Group admin helpers
// ─────────────────────────────────────────────────────────
function getGroupAdmins(groupMetadata) {
  if (!groupMetadata || !groupMetadata.participants || !groupMetadata.id) return [];
  
  const cached = getCachedAdmins(groupMetadata.id);
  if (cached) return cached;

  const admins = groupMetadata.participants
    .filter(p => p.admin === "admin" || p.admin === "superadmin")
    .map(p => {
      const id = p.id.split(":")[0];
      if (id.includes("@")) return id;
      return id + (p.id.includes("@lid") ? "@lid" : "@s.whatsapp.net");
    });
    
  setCachedAdmins(groupMetadata.id, admins);
  return admins;
}

function isSuperAdmin(jid, groupMetadata) {
  if (!groupMetadata || !groupMetadata.participants) return false;
  const p = groupMetadata.participants.find(m => m.id === jid);
  return p && p.admin === "superadmin";
}

// ─────────────────────────────────────────────────────────
//  Text / formatting utilities
// ─────────────────────────────────────────────────────────
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (h > 0) parts.push(`${h}s`);
  if (m > 0) parts.push(`${m}d`);
  parts.push(`${s}sn`);
  return parts.join(" ");
}

function runtime(seconds) {
  return formatDuration(Math.floor(seconds));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function chunk(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ─────────────────────────────────────────────────────────
//  URL & Security Utilities
// ─────────────────────────────────────────────────────────
const URL_PATTERNS = {
  instagram: /^https?:\/\/(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/(?:p\/([A-Za-z0-9_-]+)|reel\/([A-Za-z0-9_-]+)|reels\/([A-Za-z0-9_-]+)|tv\/([A-Za-z0-9_-]+)|stories\/([A-Za-z0-9._]+)\/([0-9]+)|stories\/highlights\/([0-9]+)|([A-Za-z0-9._]+)\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)|([A-Za-z0-9._]+)\/?)\/?(?:\?.*)?$/i,
  youtube: /^https?:\/\/(?:www\.youtube\.com|youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com)\/(?:watch\?v=|shorts\/|v\/|embed\/)?[A-Za-z0-9_-]{11}(?:[\&\?].*)?$/,
  spotify: /^https?:\/\/(?:open\.)?spotify\.com\/(intl-[a-z]{2}\/)?(track|album|playlist|episode)\/[a-zA-Z0-9]+(?:\?.*)?$/,
  facebook: /^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/\S+|^https?:\/\/fb\.watch\/\S+/i,
  tiktok: /^https?:\/\/(?:www\.)?(?:tiktok\.com\/@?[A-Za-z0-9_.-]+\/video\/\d+|vm\.tiktok\.com\/[A-Za-z0-9_-]+\/?|vt\.tiktok\.com\/[A-Za-z0-9_-]+\/?|v\.tiktok\.com\/[A-Za-z0-9_-]+\/?)(?:\?.*)?$/i,
  pinterest: /^https?:\/\/(?:www\.)?(?:pinterest\.com\/(?:pin\/\d+\/?[A-Za-z0-9_-]*)\/?|pin\.it\/[A-Za-z0-9_-]+\/?)(?:\?.*)?$/i,
  twitter: /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com|mobile\.twitter\.com)\/[A-Za-z0-9_]{1,15}\/status\/\d+(?:\?.*)?$/i,
  github_gist: /^https?:\/\/(?:gist\.github\.com|gist\.githubusercontent\.com|raw\.githubusercontent\.com)\/\S+/i
};

function extractUrls(text) {
  if (!text || typeof text !== 'string') return [];
  const urls = text.match(/\bhttps?:\/\/\S+/gi);
  return urls ? urls.map(url => url.replace(/[)\].,!?>]*$/, "")) : [];
}

function validateUrl(url, platform) {
  if (!url || !platform || !URL_PATTERNS[platform]) return false;
  return URL_PATTERNS[platform].test(url);
}

// ─────────────────────────────────────────────────────────
//  Suppress noisy logs
// ─────────────────────────────────────────────────────────
function suppressLibsignalLogs() {
  // İdempotensi koruıcusu: Birden fazla çağrıda process.stderr.write iki kez sarmalanır.
  // Flag'i process üzerinde tut — modül sınırlarını aşar.
  if (process.__ladesLibsignalSuppressed) return;
  process.__ladesLibsignalSuppressed = true;

  // ── console.* filtreleri ────────────────────────────────────────
  // Baileys'in kendi logger'ı console'dan geçebilecek bazı mesajları filtreler.
  const origWarn = console.warn.bind(console);
  const origLog  = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origError = console.error.bind(console);

  const CONSOLE_FILTER = ["signalstore", "libsignal", "Closing session:", "SessionEntry", "Bad MAC", "Session error"];

  const filterArgs = (args) => {
    if (!args || args.length === 0) return false;
    try {
      for (const arg of args) {
        if (typeof arg === 'string') {
          for (const s of CONSOLE_FILTER) { if (arg.includes(s)) return true; }
          continue;
        }
        if (arg && typeof arg === 'object' && arg.constructor?.name === 'SessionEntry') return true;
      }
      return false;
    } catch { return false; }
  };

  console.warn  = (...args) => { if (filterArgs(args)) return; origWarn(...args);  };
  console.log   = (...args) => { if (filterArgs(args)) return; origLog(...args);   };
  console.info  = (...args) => { if (filterArgs(args)) return; origInfo(...args);  };
  console.error = (...args) => { if (filterArgs(args)) return; origError(...args); };

  // ── process.stderr intercept ────────────────────────────────────
  // libsignal (session_cipher.js, crypto.js) "Session error:Error: Bad MAC" gibi
  // kritik hataları doğrudan process.stderr.write() ile yazar.
  // console.* override'ları bunları yakalamaz — bu yüzden stream katmanında filtrele.
  const STDERR_FILTER_STRINGS = [
    "Bad MAC",
    "Session error:",
    "Closing open session in favor of",
    "Decrypted message with closed session",
    "Failed to decrypt message with any known session",
    "at Object.verifyMAC",
    "at SessionCipher.",
    "at async _asyncQueueExecutor",
    "libsignal/src/",
  ];

  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = function(chunk, encoding, callback) {
    if (chunk) {
      const str = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      for (const token of STDERR_FILTER_STRINGS) {
        if (str.includes(token)) {
          // Tamamen sessizce yut; callback'i yine çağır ki caller bloklanmasın
          if (typeof encoding === 'function') encoding();
          else if (typeof callback === 'function') callback();
          return true;
        }
      }
    }
    return origStderrWrite(chunk, encoding, callback);
  };
}


// ─────────────────────────────────────────────────────────
//  Message utilities
// ─────────────────────────────────────────────────────────
let _baileysCache = null;
async function loadBaileys() {
  if (!_baileysCache) _baileysCache = await import("@whiskeysockets/baileys");
  return _baileysCache;
}

function getMessageText(message) {
  if (!message) return "";
  
  let msg = message;
  if (msg.ephemeralMessage) msg = msg.ephemeralMessage.message;
  if (msg.viewOnceMessage) msg = msg.viewOnceMessage.message;
  if (msg.viewOnceMessageV2) msg = msg.viewOnceMessageV2.message;
  if (msg.documentWithCaptionMessage) msg = msg.documentWithCaptionMessage.message;
  if (msg.deviceSentMessage) msg = msg.deviceSentMessage.message;
  
  if (!msg) return "";

  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    ""
  );
}

function getQuotedMsg(message) {
  return (
    message.extendedTextMessage?.contextInfo?.quotedMessage ||
    message.imageMessage?.contextInfo?.quotedMessage ||
    message.videoMessage?.contextInfo?.quotedMessage ||
    null
  );
}

function getMentioned(message) {
  return (
    message.extendedTextMessage?.contextInfo?.mentionedJid ||
    message.imageMessage?.contextInfo?.mentionedJid ||
    []
  );
}

/**
 * Downloads a file from a URL and saves it directly to a disk path as a stream.
 * Highly memory efficient as it bypasses the Node.js heap.
 * @param {string} url 
 * @param {string} destPath 
 * @returns {Promise<string>} The path to the saved file.
 */
async function saveToDisk(url, destPath) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    throw new Error("Invalid URL: " + url);
  }
  const writer = fs.createWriteStream(destPath);

  // URL'den hostname'e göre Referer ekle (TikTok CDN gibi kısıtlı CDN'ler için)
  const urlHostname = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const referer = urlHostname.includes("tiktok") ? "https://www.tiktok.com/" : undefined;

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 60000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "*/*",
      ...(referer ? { "Referer": referer } : {}),
    }
  });

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    let error = null;
    writer.on("error", (err) => {
      error = err;
      writer.close();
      reject(err);
    });
    writer.on("close", () => {
      if (!error) resolve(destPath);
    });
  });
}

/**
 * MP4 dosyasından video boyutlarını okur (saf Node.js - ffprobe gerektirmez).
 * moov > trak > tkhd kutusundaki width/height alanlarını parse eder.
 * @param {string} filePath - MP4 dosyasının yolu
 * @returns {{ width: number, height: number } | null}
 */
function readMp4Dimensions(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const fileSize = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(fileSize, 2 * 1024 * 1024)); // İlk 2MB
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);

    for (let i = 0; i < buf.length - 92; i++) {
      // "tkhd" ASCII = 0x74 0x6B 0x68 0x64
      if (buf[i] === 0x74 && buf[i + 1] === 0x6B && buf[i + 2] === 0x68 && buf[i + 3] === 0x64) {
        const version = buf[i + 4];
        const widthOffset  = i + 4 + (version === 1 ? 84 : 76);
        const heightOffset = i + 4 + (version === 1 ? 88 : 80);
        if (heightOffset + 4 <= buf.length) {
          // Fixed-point 16.16 — ilk 2 byte integer kısım
          const width  = buf.readUInt16BE(widthOffset);
          const height = buf.readUInt16BE(heightOffset);
          if (width > 0 && height > 0) return { width, height };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}



function isMediaImage(url) {
  if (!url) return false;
  if (/\.(jpg|jpeg|png|webp|heic)(\?|&|$)/i.test(url)) return true;
  if (url.includes('token=')) {
    try {
      const parts = url.split('token=')[1].split('.');
      if (parts.length > 1) {
        const payload = Buffer.from(parts[1], 'base64').toString('utf8');
        return /\.(jpg|jpeg|png|webp|heic)/i.test(payload);
      }
    } catch(e) {}
  }
  return false;
}


/**
 * Extracts and standardizes numerical ID for universal comparison (phone or LID).
 */
function getNumericalId(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}




// --- LID HELPER EKLENTİLERİ ---






// ─────────────────────────────────────────────────────────
//  Bot identity helpers (shared with handler.js)
// ─────────────────────────────────────────────────────────
function getBotJid(client) {
  if (client.user && client.user.id) {
    return client.user.id.split(":")[0] + "@s.whatsapp.net";
  }
  return null;
}

function getBotLid(client) {
  if (client.user && client.user.lid) {
    return client.user.lid.split(":")[0] + "@lid";
  }
  return null;
}

function getBotNumericIds(client) {
  if (!client || !client.user) return [];
  const jidNum = getBotJid(client) ? getBotJid(client).split('@')[0] : null;
  const lidNum = getBotLid(client) ? getBotLid(client).split('@')[0] : null;
  return [...new Set([jidNum, lidNum].filter(Boolean))];
}

/**
 * Checks if the given identifier belongs to this bot instance.
 * Compares numeric IDs from both JID and LID.
 */
function isBotIdentifier(identifier, client) {
  if (!identifier) return false;
  const targetNumeric = (identifier || '').split('@')[0].split(':')[0];
  if (!targetNumeric) return false;
  return getBotNumericIds(client).includes(targetNumeric);
}

/**
 * Rakamları ayrıştırır
 */
function getNumericalIdLocal(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

/**
 * 1. Lades-Pro Yöntemi: Bot başlarken SUDO numaralarını LID'ye çevirip SUDO_MAP'e kaydetme.
 * Baileys signalRepository'i kullanarak JID'den LID bulur.
 */
async function migrateSudoToLID(client) {
  const sudoNumbers = (config.SUDO || "").split(',').map(n => getNumericalIdLocal(n)).filter(n => n);
  const ownerNumber = getNumericalIdLocal(config.OWNER_NUMBER);
  
  const allNumbers = [...new Set([...sudoNumbers, ownerNumber])].filter(n => n && n !== "905XXXXXXXXX");
  
  if (allNumbers.length > 0) {
    try {
      let sudoMap = [];
      if (config.SUDO_MAP) {
        try {
          sudoMap = JSON.parse(config.SUDO_MAP);
          if (!Array.isArray(sudoMap)) sudoMap = [];
        } catch (e) {
          sudoMap = [];
        }
      }

      let updated = false;
      logger.info(`[LID Helper] ${allNumbers.length} adet yetkili numara LID kontrolünden geçiriliyor...`);
      
      for (const phone of allNumbers) {
        try {
          const jid = `${phone}@s.whatsapp.net`;
          
          // 1. Try Baileys mapping
          if (client.signalRepository && client.signalRepository.lidMapping) {
             const lid = await client.signalRepository.lidMapping.getLIDForPN(jid);
             if (lid && !sudoMap.includes(lid)) {
               sudoMap.push(lid);
               logger.info(`[LID Helper] Eşleşme bulundu (Mapping): ${phone} -> ${lid}`);
               updated = true;
             }
          }
          
          // 2. Try contact store if mapping fails
          if (!updated && client.store && client.store.contacts) {
            const contact = client.store.contacts[jid];
            if (contact && contact.lid && !sudoMap.includes(contact.lid)) {
              sudoMap.push(contact.lid);
              logger.info(`[LID Helper] Eşleşme bulundu (Contact): ${phone} -> ${contact.lid}`);
              updated = true;
            }
          }
        } catch (e) {
          logger.debug({ err: e.message }, `[LID Helper] ${phone} için LID çözümlenemedi.`);
        }
      }
      
      if (updated) {
        config.SUDO_MAP = JSON.stringify(sudoMap);
        process.env.SUDO_MAP = config.SUDO_MAP;
        
        // Veritabanına kaydet
        try {
          const { BotVariable } = require("./database");
          if (BotVariable) {
            await BotVariable.upsert({
              key: 'SUDO_MAP',
              value: config.SUDO_MAP
            });
          }
        } catch (dbErr) {
          logger.warn("[LID Helper] SUDO_MAP veritabanına kaydedilemedi.");
        }
        logger.info(`[LID Helper] SUDO_MAP başarıyla güncellendi. Toplam yetkili LID: ${sudoMap.length}`);
      }
    } catch (error) {
      logger.error({ err: error.message }, '[LID Yardımcı] SUDO to LID geçiş hatası');
    }
  }
}

/**
 * 2. Lades-Pro Yöntemi: Gelen LID mesajını anlık olarak AuthState üzerinden Telefon Numarasına (PN) çevirme.
 */
async function resolveLidToPn(client, lidJid) {
  if (!lidJid || !lidJid.includes('@lid')) return lidJid;
  
  try {
    if (client.signalRepository && client.signalRepository.lidMapping) {
      // Sonsuz beklemeyi (deadlock) önlemek için 2 saniyelik zaman aşımı
      const pnJid = await Promise.race([
        client.signalRepository.lidMapping.getPNForLID(lidJid),
        new Promise((_, reject) => setTimeout(() => reject(new Error('LID timeout')), 2000))
      ]);
      if (pnJid) {
        return pnJid;
      }
    }
  } catch (e) {
    // Sessizce geç — LID çözümlenemezse orijinal JID ile devam et
  }
  return lidJid;
}


module.exports = {
  TEMP_DIR, ensureTempDir, getTempPath, cleanTempFile,
  startTempCleanup, stopTempCleanup,
  toUserJid, toGroupJid, parseJid, isGroup, isBroadcast,
  getGroupAdmins, isSuperAdmin,
  formatBytes, formatDuration, runtime, sleep, chunk,
  extractUrls, validateUrl,
  suppressLibsignalLogs,
  getMessageText, getQuotedMsg, getMentioned,
  loadBaileys, getTempSubdir, saveToDisk, isMediaImage, readMp4Dimensions,
  ffmpegLimit, getNumericalId,
  migrateSudoToLID,
  resolveLidToPn,
  getNumericalIdLocal,
  isBotIdentifier,
  getBotJid,
  getBotLid,
  getBotNumericIds,
};
