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
const TEMP_DIR = path.join(os.tmpdir(), "nexbot-temp");

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
    .map(p => p.id);
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
 * Asynchronously load Baileys module (compatibility helper)
 */
async function loadBaileys() {
  return require("@whiskeysockets/baileys");
}

module.exports = {
  TEMP_DIR, ensureTempDir, getTempPath, cleanTempFile,
  startTempCleanup, stopTempCleanup,
  toUserJid, toGroupJid, parseJid, isGroup, isBroadcast,
  getGroupAdmins, isSuperAdmin,
  formatBytes, formatDuration, runtime, sleep, chunk,
  suppressLibsignalLogs,
  getMessageText, getQuotedMsg, getMentioned,
  loadBaileys, getTempSubdir
};
