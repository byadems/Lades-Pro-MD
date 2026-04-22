"use strict";

/**
 * plugins/utils/misc.js
 * Clean, transparent utility functions (De-obfuscated version).
 */

const axios = require("axios");
const { runtime, formatBytes, toUserJid, getGroupAdmins } = require("../../core/yardimcilar");
const nx = require('./nexray_api');

/**
 * Checks if a user is an admin in the group.
 * Leverages pre-calculated status from handler.js for speed.
 */
async function isAdmin(message, userJid = message.sender) {
  if (!message.isGroup) return false;
  const { isBotIdentifier } = require("./lid_yardimcisi");
  // Eğer kontrol edilen kişi bizzat komutu gönderen (owner) ise true döndür.
  if (message.fromOwner && userJid === message.sender) return true;

  // Use pre-calculated data from handler if checking the sender
  if (message.groupAdmins && userJid === message.sender) {
    return message.isAdmin;
  }

  // Fallback: Fetch metadata if pre-calculated data is missing or checking another user
  try {
    const { fetchGroupMeta } = require("../../core/store");
    const metadata = await fetchGroupMeta(message.client, message.jid);
    if (!metadata) return false;
    const admins = getGroupAdmins(metadata);

    // Eğer botun yöneticiliğini kontrol ediyorsak lid-helper'daki isBotIdentifier'ı kullanalım.
    // Çünkü botun hem PN hem de LID'si olabilir.
    if (isBotIdentifier(userJid, message.client)) {
      return admins.some(a => isBotIdentifier(a, message.client));
    }

    const checkedJidNumeric = userJid.split("@")[0].split(":")[0];
    return admins.some(a => a.split("@")[0].split(":")[0] === checkedJidNumeric);
  } catch (e) {
    return false;
  }
}

function isNumeric(v) {
  return !isNaN(parseFloat(v)) && isFinite(v);
}

async function getJson(url, options = {}) {
  try {
    const res = await axios.get(url, {
      timeout: 10000,
      ...options
    });
    return res.data;
  } catch (e) {
    return { status: false, error: e.message };
  }
}

function mentionjid(jid) {
  if (!jid) return "";
  const num = jid.split("@")[0].split(":")[0]; // domain ve cihaz ID'sini (iz varsa) temizle
  return "@" + num;
}

// Map existing functions to clean implementations
const parseUptime = (seconds) => runtime(seconds);
const bytesToSize = (bytes) => formatBytes(bytes);

// Link social media downloaders to nexray.js implementations
const fb = (url) => nx.downloadFacebook(url);
const tiktok = (url) => nx.downloadTiktok(url);
const igStalk = (username) => nx.nx(`/stalk/instagram?username=${username}`);
const pinterestDl = (url) => nx.downloadPinterest(url);
const searchYT = (query) => nx.searchYoutube(query);
const downloadGram = (url) => nx.downloadInstagram(url);
const pinterestSearch = (query) => nx.nx(`/search/pinterest?q=${query}`);

// Media & Tools
const getBuffer = (url) => nx.getBuffer(url);
const story = (url) => nx.nx(`/downloader/story?url=${url}`);
const lyrics = (query) => nx.nx(`/tools/lyrics?q=${query}`);

async function gtts(text, lang = "tr") {
  return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
}

// Fallback / legacy utility checks
function isFake(jid) {
  const phone = jid.split("@")[0];
  return phone.startsWith("1") || phone.startsWith("44"); // Example fake numbers
}

async function processOnwa(client, jids) {
  const onwa = [];
  for (const jid of jids) {
    const [res] = await client.onWhatsApp(jid);
    if (res && res.exists) onwa.push(res.jid);
  }
  return onwa;
}

module.exports = {
  isAdmin,
  isNumeric,
  getJson,
  mentionjid,
  parseUptime,
  bytesToSize,
  isFake,
  processOnwa,
  findMusic: (url) => nx.nx(`/tools/acrcloud?url=${url}`),
  searchYT,
  downloadGram,
  pinterestDl,
  fb,
  igStalk,
  tiktok,
  story,
  getThumb: (url) => nx.getBuffer(url),
  gtts,
  getBuffer,
  lyrics,
  pinterestSearch,
  mentionjid,
  parseUptime,
  bytesToSize,
  isFake,
  processOnwa,
  findMusic: (url) => nx.nx(`/tools/acrcloud?url=${url}`),
  searchYT,
  downloadGram,
  pinterestDl,
  fb,
  igStalk,
  tiktok,
  story,
  getThumb: (url) => nx.getBuffer(url),
  gtts,
  getBuffer,
  lyrics,
  pinterestSearch,
};