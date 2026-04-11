/**
 * plugins/siputzx-dl.js
 * Siputzx API - Medya İndirme Komutları (Downloaders)
 * Tüm çıktılar %100 Türkçe
 */
const { Module } = require("../main");
const axios = require("axios");
const { extractUrls } = require("../core/helpers");

const SIPUTZX_BASE = "https://api.siputzx.my.id";
const TIMEOUT = 30000;

async function siputGet(path, params = {}) {
  const url = `${SIPUTZX_BASE}${path}`;
  const res = await axios.get(url, { params, timeout: TIMEOUT, validateStatus: () => true });
  if (res.data && res.data.status) return res.data;
  throw new Error(res.data?.error || "API yanıt vermedi");
}

function getUrlFromInput(match, replyText) {
  const input = (match || replyText || "").trim();
  const urls = extractUrls ? extractUrls(input) : input.match(/https?:\/\/[^\s]+/g);
  return urls && urls.length > 0 ? urls[0] : null;
}

// ══════════════════════════════════════════════════════
// SaveFrom İndirme (Genel - Tüm Platformlar)
// ══════════════════════════════════════════════════════
Module({
  pattern: "savefrom ?(.*)",
  fromMe: false,
  desc: "Çeşitli platformlardan medya indirir (TikTok, Instagram, Facebook, Twitter, YouTube, Pinterest, SoundCloud vb.).",
  usage: ".savefrom [bağlantı]",
  use: "indirme",
}, async (message, match) => {
  const url = getUrlFromInput(match[1], message.reply_message?.text);
  if (!url) return await message.sendReply("_Bağlantı girin:_ `.savefrom [URL]`");

  try {
    await message.sendReply("_Medya indiriliyor..._");
    const data = await siputGet("/api/d/savefrom", { url });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Medya bulunamadı._");

    const items = Array.isArray(r) ? r : [r];
    for (const item of items.slice(0, 3)) {
      const mediaUrl = item.url || item.download || item;
      if (typeof mediaUrl === "string" && mediaUrl.startsWith("http")) {
        const isVideo = mediaUrl.includes(".mp4") || item.type === "video";
        await message.client.sendMessage(message.jid, {
          [isVideo ? "video" : "image"]: { url: mediaUrl }
        }, { quoted: message.data });
      }
    }
  } catch (e) {
    await message.sendReply(`_İndirme başarısız:_ ${e.message}`);
  }
});