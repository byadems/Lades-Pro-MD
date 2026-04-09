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
// TikTok İndirme
// ══════════════════════════════════════════════════════
Module({
  pattern: "tiktokdl ?(.*)",
  fromMe: false,
  desc: "TikTok videosunu indirir (filigranlı veya filigramsız).",
  usage: ".tiktokdl [bağlantı]",
  use: "indirme",
}, async (message, match) => {
  const url = getUrlFromInput(match[1], message.reply_message?.text);
  if (!url || !url.includes("tiktok")) return await message.sendReply("_TikTok bağlantısı girin:_ `.tiktokdl [URL]`");

  try {
    await message.sendReply("_TikTok videosu indiriliyor..._");
    const data = await siputGet("/api/d/tiktok", { url });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Video bulunamadı._");

    const videoUrl = r.play || r.hdplay || r.wmplay || r.video || r.url;
    if (videoUrl) {
      await message.client.sendMessage(message.jid, {
        video: { url: videoUrl },
        caption: r.title ? `*TikTok*\n${r.title}` : "*TikTok*"
      }, { quoted: message.data });
    } else {
      await message.sendReply("_İndirilebilir video bulunamadı._");
    }
  } catch (e) {
    await message.sendReply(`_TikTok indirme başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Facebook İndirme
// ══════════════════════════════════════════════════════
Module({
  pattern: "fbdl ?(.*)",
  fromMe: false,
  desc: "Facebook videosunu indirir.",
  usage: ".fbdl [bağlantı]",
  use: "indirme",
}, async (message, match) => {
  const url = getUrlFromInput(match[1], message.reply_message?.text);
  if (!url || (!url.includes("facebook") && !url.includes("fb.watch"))) return await message.sendReply("_Facebook bağlantısı girin:_ `.fbdl [URL]`");

  try {
    await message.sendReply("_Facebook videosu indiriliyor..._");
    const data = await siputGet("/api/d/facebook", { url });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Video bulunamadı._");

    const videoUrl = r.hd || r.sd || r.url || r.video;
    if (videoUrl) {
      await message.client.sendMessage(message.jid, {
        video: { url: typeof videoUrl === "object" ? videoUrl.url : videoUrl },
        caption: r.title ? `*Facebook*\n${r.title}` : "*Facebook*"
      }, { quoted: message.data });
    } else {
      await message.sendReply("_İndirilebilir video bulunamadı._");
    }
  } catch (e) {
    await message.sendReply(`_Facebook indirme başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Twitter/X İndirme
// ══════════════════════════════════════════════════════
Module({
  pattern: "(?:twitterdl|xdl) ?(.*)",
  fromMe: false,
  desc: "Twitter/X videosunu veya medyasını indirir.",
  usage: ".twitterdl [bağlantı]",
  use: "indirme",
}, async (message, match) => {
  const url = getUrlFromInput(match[1], message.reply_message?.text);
  if (!url || (!url.includes("twitter") && !url.includes("x.com"))) return await message.sendReply("_Twitter/X bağlantısı girin:_ `.twitterdl [URL]`");

  try {
    await message.sendReply("_Twitter medyası indiriliyor..._");
    const data = await siputGet("/api/d/twitter", { url });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Medya bulunamadı._");

    if (Array.isArray(r)) {
      for (const item of r.slice(0, 3)) {
        const mediaUrl = item.url || item.hd || item.sd;
        if (mediaUrl) {
          const isVideo = mediaUrl.includes(".mp4") || item.type === "video";
          await message.client.sendMessage(message.jid, {
            [isVideo ? "video" : "image"]: { url: mediaUrl }
          }, { quoted: message.data });
        }
      }
    } else {
      const mediaUrl = r.url || r.hd || r.sd || r.video;
      if (mediaUrl) {
        await message.client.sendMessage(message.jid, {
          video: { url: typeof mediaUrl === "object" ? mediaUrl.url : mediaUrl },
          caption: "*Twitter/X*"
        }, { quoted: message.data });
      }
    }
  } catch (e) {
    await message.sendReply(`_Twitter indirme başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Spotify İndirme
// ══════════════════════════════════════════════════════
Module({
  pattern: "spotifydl ?(.*)",
  fromMe: false,
  desc: "Spotify şarkısını indirir.",
  usage: ".spotifydl [bağlantı]",
  use: "indirme",
}, async (message, match) => {
  const url = getUrlFromInput(match[1], message.reply_message?.text);
  if (!url || !url.includes("spotify")) return await message.sendReply("_Spotify bağlantısı girin:_ `.spotifydl [URL]`");

  try {
    await message.sendReply("_Spotify şarkısı indiriliyor..._");
    const data = await siputGet("/api/d/spotify", { url });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Şarkı bulunamadı._");

    const audioUrl = r.url || r.download || r.audio;
    if (audioUrl) {
      await message.client.sendMessage(message.jid, {
        audio: { url: audioUrl },
        mimetype: "audio/mpeg",
        ptt: false,
      }, { quoted: message.data });
    } else {
      await message.sendReply("_İndirilebilir ses bulunamadı._");
    }
  } catch (e) {
    await message.sendReply(`_Spotify indirme başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Pinterest İndirme
// ══════════════════════════════════════════════════════
Module({
  pattern: "pindl ?(.*)",
  fromMe: false,
  desc: "Pinterest görsel/videosunu indirir.",
  usage: ".pindl [bağlantı]",
  use: "indirme",
}, async (message, match) => {
  const url = getUrlFromInput(match[1], message.reply_message?.text);
  if (!url || !url.includes("pinterest")) return await message.sendReply("_Pinterest bağlantısı girin:_ `.pindl [URL]`");

  try {
    const data = await siputGet("/api/d/pinterest", { url });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Medya bulunamadı._");

    const mediaUrl = r.url || r.image || r.video || (Array.isArray(r) ? r[0]?.url : null);
    if (mediaUrl) {
      const isVideo = mediaUrl.includes(".mp4") || r.type === "video";
      await message.client.sendMessage(message.jid, {
        [isVideo ? "video" : "image"]: { url: mediaUrl },
        caption: "*Pinterest*"
      }, { quoted: message.data });
    } else {
      await message.sendReply("_İndirilebilir medya bulunamadı._");
    }
  } catch (e) {
    await message.sendReply(`_Pinterest indirme başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// SoundCloud İndirme
// ══════════════════════════════════════════════════════
Module({
  pattern: "scdl ?(.*)",
  fromMe: false,
  desc: "SoundCloud şarkısını indirir.",
  usage: ".scdl [bağlantı]",
  use: "indirme",
}, async (message, match) => {
  const url = getUrlFromInput(match[1], message.reply_message?.text);
  if (!url || !url.includes("soundcloud")) return await message.sendReply("_SoundCloud bağlantısı girin:_ `.scdl [URL]`");

  try {
    await message.sendReply("_SoundCloud şarkısı indiriliyor..._");
    const data = await siputGet("/api/d/soundcloud", { url });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Şarkı bulunamadı._");

    const audioUrl = r.url || r.download || r.audio;
    if (audioUrl) {
      await message.client.sendMessage(message.jid, {
        audio: { url: audioUrl },
        mimetype: "audio/mpeg",
        ptt: false,
      }, { quoted: message.data });
    } else {
      await message.sendReply("_İndirilebilir ses bulunamadı._");
    }
  } catch (e) {
    await message.sendReply(`_SoundCloud indirme başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// CapCut İndirme
// ══════════════════════════════════════════════════════
Module({
  pattern: "capcutdl ?(.*)",
  fromMe: false,
  desc: "CapCut videosunu indirir.",
  usage: ".capcutdl [bağlantı]",
  use: "indirme",
}, async (message, match) => {
  const url = getUrlFromInput(match[1], message.reply_message?.text);
  if (!url || !url.includes("capcut")) return await message.sendReply("_CapCut bağlantısı girin:_ `.capcutdl [URL]`");

  try {
    await message.sendReply("_CapCut videosu indiriliyor..._");
    const data = await siputGet("/api/d/capcut", { url });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Video bulunamadı._");

    const videoUrl = r.url || r.video || r.download;
    if (videoUrl) {
      await message.client.sendMessage(message.jid, {
        video: { url: videoUrl },
        caption: r.title ? `*CapCut*\n${r.title}` : "*CapCut*"
      }, { quoted: message.data });
    } else {
      await message.sendReply("_İndirilebilir video bulunamadı._");
    }
  } catch (e) {
    await message.sendReply(`_CapCut indirme başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Instagram İndirme (Siputzx yedek)
// ══════════════════════════════════════════════════════
Module({
  pattern: "igdl ?(.*)",
  fromMe: false,
  desc: "Instagram videosunu/görselleri indirir (yedek API).",
  usage: ".igdl [bağlantı]",
  use: "indirme",
}, async (message, match) => {
  const url = getUrlFromInput(match[1], message.reply_message?.text);
  if (!url || !url.includes("instagram")) return await message.sendReply("_Instagram bağlantısı girin:_ `.igdl [URL]`");

  try {
    await message.sendReply("_Instagram medyası indiriliyor..._");
    const data = await siputGet("/api/d/igdl", { url });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Medya bulunamadı._");

    const items = Array.isArray(r) ? r : [r];
    for (const item of items.slice(0, 5)) {
      const mediaUrl = item.url || item.download || item;
      if (typeof mediaUrl === "string" && mediaUrl.startsWith("http")) {
        const isVideo = mediaUrl.includes(".mp4") || item.type === "video";
        await message.client.sendMessage(message.jid, {
          [isVideo ? "video" : "image"]: { url: mediaUrl }
        }, { quoted: message.data });
      }
    }
  } catch (e) {
    await message.sendReply(`_Instagram indirme başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// SaveFrom İndirme (Genel)
// ══════════════════════════════════════════════════════
Module({
  pattern: "savefrom ?(.*)",
  fromMe: false,
  desc: "Çeşitli platformlardan medya indirir (SaveFrom).",
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
