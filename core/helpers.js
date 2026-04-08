"use strict";

/**
 * core/helpers.js
 * Shared utility functions used across the bot.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { logger } = require("../config");

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
let _tempCleanupTimer = null;
function startTempCleanup(intervalMs = 30 * 60 * 1000) {
  if (_tempCleanupTimer) return;
  _tempCleanupTimer = setInterval(() => {
    try {
      ensureTempDir();
      const files = fs.readdirSync(TEMP_DIR);
      const now = Date.now();
      for (const f of files) {
        const fp = path.join(TEMP_DIR, f);
        try {
          const stat = fs.statSync(fp);
          if (now - stat.mtimeMs > 60 * 60 * 1000) fs.unlinkSync(fp); // older than 1h
        } catch {}
      }
    } catch {}
  }, intervalMs);
}

function stopTempCleanup() {
  if (_tempCleanupTimer) { clearInterval(_tempCleanupTimer); _tempCleanupTimer = null; }
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
  if (!groupMetadata || !groupMetadata.participants) return [];
  return groupMetadata.participants
    .filter(p => p.admin === "admin" || p.admin === "superadmin")
    .map(p => {
      // Baileys bazen p.id içinde device ID (örn: :15) döndürebilir.
      // JID'yi temizleyip saf numara ve domain ile döndürüyoruz.
      const id = p.id.split(":")[0];
      if (id.includes("@")) return id;
      return id + (p.id.includes("@lid") ? "@lid" : "@s.whatsapp.net");
    });
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
  const origWarn = console.warn.bind(console);
  console.warn = (...args) => {
    const msg = args.join(" ");
    if (msg.includes("signalstore") || msg.includes("libsignal")) return;
    origWarn(...args);
  };
}

// ─────────────────────────────────────────────────────────
//  Message utilities
// ─────────────────────────────────────────────────────────
async function loadBaileys() {
  return await import("@whiskeysockets/baileys");
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
  const axios = require("axios");
  const writer = fs.createWriteStream(destPath);

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 30000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36"
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

module.exports = {
  TEMP_DIR, ensureTempDir, getTempPath, cleanTempFile,
  startTempCleanup, stopTempCleanup,
  toUserJid, toGroupJid, parseJid, isGroup, isBroadcast,
  getGroupAdmins, isSuperAdmin,
  formatBytes, formatDuration, runtime, sleep, chunk,
  extractUrls, validateUrl,
  suppressLibsignalLogs,
  getMessageText, getQuotedMsg, getMentioned,
  loadBaileys, getTempSubdir, saveToDisk, isMediaImage
};
