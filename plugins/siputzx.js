/**
 * plugins/siputzx.js
 * Siputzx API entegrasyonu - Arama, Stalker, Araçlar, Oyunlar
 * Tüm çıktılar %100 Türkçe
 */
const { Module } = require("../main");
const axios = require("axios");

const SIPUTZX_BASE = "https://api.siputzx.my.id";
const TIMEOUT = 25000;

async function siputGet(path, params = {}) {
  try {
    const url = `${SIPUTZX_BASE}${path}`;
    const res = await axios.get(url, { params, timeout: TIMEOUT, validateStatus: () => true });
    if (res.data && res.data.status) return res.data;
    throw new Error(res.data?.error || "API yanıt vermedi");
  } catch (e) {
    if (e.code === "ECONNABORTED") throw new Error("API zaman aşımı. Lütfen tekrar deneyin.");
    throw e;
  }
}

async function siputGetBuffer(path, params = {}) {
  const url = `${SIPUTZX_BASE}${path}`;
  const res = await axios.get(url, { params, timeout: TIMEOUT, responseType: "arraybuffer", validateStatus: () => true });
  if (res.status === 200 && res.data) return Buffer.from(res.data);
  throw new Error("Görsel alınamadı");
}

// ══════════════════════════════════════════════════════
// Pinterest Arama
// ══════════════════════════════════════════════════════
// Pinterest komutu social.js'de mevcut, burada tekrar yok

// ══════════════════════════════════════════════════════
// Ekran Görüntüsü (Website Screenshot)
// ══════════════════════════════════════════════════════
Module({
  pattern: "(?:ekranfoto|ss) ?(.*)",
  fromMe: false,
  desc: "Bir web sitesinin ekran görüntüsünü alır.",
  usage: ".ss https://google.com",
  use: "araçlar",
}, async (message, match) => {
  let url = (match[1] || "").trim();
  if (!url) return await message.sendReply("_URL girin:_ `.ss https://google.com`");
  if (!url.startsWith("http")) url = "https://" + url;

  try {
    const buf = await siputGetBuffer("/api/tools/ssweb", { url });
    await message.client.sendMessage(message.jid, {
      image: buf,
      caption: `*Ekran Görüntüsü*\n${url}`
    }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`_Ekran görüntüsü alınamadı:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// GitHub Profil Sorgulama
// ══════════════════════════════════════════════════════
Module({
  pattern: "(?:ghstalker|github) ?(.*)",
  fromMe: false,
  desc: "GitHub kullanıcı profilini sorgular.",
  usage: ".github octocat",
  use: "profil-inceleme",
}, async (message, match) => {
  const user = (match[1] || "").trim();
  if (!user) return await message.sendReply("_Kullanıcı adı girin:_ `.github octocat`");

  try {
    const data = await siputGet("/api/stalk/github", { user });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Kullanıcı bulunamadı._");

    const text = [
      `*GitHub Profili*`,
      `*Ad:* ${r.name || r.login || user}`,
      r.bio ? `*Bio:* ${r.bio}` : null,
      `*Repo:* ${r.public_repos ?? "?"}`,
      `*Takipçi:* ${r.followers ?? "?"}`,
      `*Takip:* ${r.following ?? "?"}`,
      r.location ? `*Konum:* ${r.location}` : null,
      r.blog ? `*Web:* ${r.blog}` : null,
      `*Profil:* https://github.com/${r.login || user}`,
    ].filter(Boolean).join("\n");

    if (r.avatar_url) {
      await message.client.sendMessage(message.jid, {
        image: { url: r.avatar_url },
        caption: text
      }, { quoted: message.data });
    } else {
      await message.sendReply(text);
    }
  } catch (e) {
    await message.sendReply(`_GitHub sorgusu başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// TikTok Profil Sorgulama (social.js'de mevcut)
// ══════════════════════════════════════════════════════

// Instagram Profil Sorgulama
// ══════════════════════════════════════════════════════
Module({
  pattern: "igara ?(.*)",
  fromMe: false,
  desc: "Instagram kullanıcı profilini sorgular.",
  usage: ".igara kullaniciadi",
  use: "profil-inceleme",
}, async (message, match) => {
  const user = (match[1] || "").trim();
  if (!user) return await message.sendReply("_Kullanıcı adı girin:_ `.igara kullaniciadi`");

  try {
    const data = await siputGet("/api/stalk/instagram", { user });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Kullanıcı bulunamadı._");

    const text = [
      `*Instagram Profili*`,
      `*Kullanıcı:* ${r.username || user}`,
      `*Ad:* ${r.fullName || r.full_name || "?"}`,
      r.biography || r.bio ? `*Bio:* ${r.biography || r.bio}` : null,
      `*Gönderi:* ${r.posts ?? r.mediaCount ?? "?"}`,
      `*Takipçi:* ${r.followers ?? r.followerCount ?? "?"}`,
      `*Takip:* ${r.following ?? r.followingCount ?? "?"}`,
      r.isPrivate ? `*Gizli Hesap:* Evet` : null,
      r.isVerified ? `*Onaylı Hesap:* Evet` : null,
    ].filter(Boolean).join("\n");

    const avatar = r.profilePicUrl || r.profile_pic_url || r.avatar;
    if (avatar) {
      await message.client.sendMessage(message.jid, {
        image: { url: avatar },
        caption: text
      }, { quoted: message.data });
    } else {
      await message.sendReply(text);
    }
  } catch (e) {
    await message.sendReply(`_Instagram sorgusu başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Twitter/X Profil Sorgulama
// ══════════════════════════════════════════════════════
Module({
  pattern: "(?:xara|twitterara) ?(.*)",
  fromMe: false,
  desc: "Twitter/X kullanıcı profilini sorgular.",
  usage: ".xara kullaniciadi",
  use: "profil-inceleme",
}, async (message, match) => {
  const user = (match[1] || "").trim();
  if (!user) return await message.sendReply("_Kullanıcı adı girin:_ `.xara kullaniciadi`");

  try {
    const data = await siputGet("/api/stalk/twitter", { user });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Kullanıcı bulunamadı._");

    const text = [
      `*Twitter/X Profili*`,
      `*Kullanıcı:* @${r.username || r.screen_name || user}`,
      `*Ad:* ${r.name || "?"}`,
      r.bio || r.description ? `*Bio:* ${r.bio || r.description}` : null,
      `*Takipçi:* ${r.followers ?? r.followers_count ?? "?"}`,
      `*Takip:* ${r.following ?? r.friends_count ?? "?"}`,
      `*Tweet:* ${r.tweets ?? r.statuses_count ?? "?"}`,
    ].filter(Boolean).join("\n");

    const avatar = r.profile_image || r.profile_image_url_https;
    if (avatar) {
      await message.client.sendMessage(message.jid, {
        image: { url: avatar },
        caption: text
      }, { quoted: message.data });
    } else {
      await message.sendReply(text);
    }
  } catch (e) {
    await message.sendReply(`_Twitter sorgusu başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// YouTube Profil Sorgulama
// ══════════════════════════════════════════════════════
Module({
  pattern: "ytara ?(.*)",
  fromMe: false,
  desc: "YouTube kanal bilgilerini sorgular.",
  usage: ".ytara kanaladi",
  use: "profil-inceleme",
}, async (message, match) => {
  const user = (match[1] || "").trim();
  if (!user) return await message.sendReply("_Kanal adı girin:_ `.ytara kanaladi`");

  try {
    const data = await siputGet("/api/stalk/youtube", { user });
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Kanal bulunamadı._");

    const text = [
      `*YouTube Kanalı*`,
      `*Kanal:* ${r.name || r.title || user}`,
      r.description ? `*Açıklama:* ${r.description.substring(0, 200)}` : null,
      `*Abone:* ${r.subscribers ?? r.subscriberCount ?? "?"}`,
      `*Video:* ${r.videos ?? r.videoCount ?? "?"}`,
      `*Görüntülenme:* ${r.views ?? r.viewCount ?? "?"}`,
    ].filter(Boolean).join("\n");

    const avatar = r.avatar || r.thumbnail;
    if (avatar) {
      await message.client.sendMessage(message.jid, {
        image: { url: avatar },
        caption: text
      }, { quoted: message.data });
    } else {
      await message.sendReply(text);
    }
  } catch (e) {
    await message.sendReply(`_YouTube sorgusu başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Google Görsel Arama
// ══════════════════════════════════════════════════════
Module({
  pattern: "(?:googlegorsel|gimg) ?(.*)",
  fromMe: false,
  desc: "Google'da görsel arar.",
  usage: ".gimg manzara",
  use: "arama",
}, async (message, match) => {
  const query = (match[1] || "").trim();
  if (!query) return await message.sendReply("_Arama terimi girin:_ `.gimg manzara`");

  try {
    const data = await siputGet("/api/s/googleimg", { query });
    const results = data.data || [];
    if (results.length === 0) return await message.sendReply("_Sonuç bulunamadı._");

    const pick = results[Math.floor(Math.random() * Math.min(results.length, 10))];
    const imgUrl = pick.url || pick.image || pick;
    if (typeof imgUrl === "string") {
      await message.client.sendMessage(message.jid, {
        image: { url: imgUrl },
        caption: `*Google Görseller* | ${query}`
      }, { quoted: message.data });
    } else {
      await message.sendReply("_Görsel alınamadı._");
    }
  } catch (e) {
    await message.sendReply(`_Google görsel araması başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Spotify Arama
// ══════════════════════════════════════════════════════
Module({
  pattern: "(?:spotifyara|sarama) ?(.*)",
  fromMe: false,
  desc: "Spotify'da şarkı arar.",
  usage: ".spotifyara tarkan",
  use: "arama",
}, async (message, match) => {
  const query = (match[1] || "").trim();
  if (!query) return await message.sendReply("_Arama terimi girin:_ `.spotifyara tarkan`");

  try {
    const data = await siputGet("/api/s/spotify", { query });
    const results = data.data || [];
    if (results.length === 0) return await message.sendReply("_Sonuç bulunamadı._");

    let text = `*Spotify Arama* | ${query}\n\n`;
    results.slice(0, 10).forEach((r, i) => {
      text += `*${i + 1}.* ${r.title || r.name || "?"}\n`;
      if (r.artist || r.artists) text += `   Sanatçı: ${r.artist || r.artists}\n`;
      if (r.url || r.link) text += `   ${r.url || r.link}\n`;
      text += "\n";
    });
    await message.sendReply(text.trim());
  } catch (e) {
    await message.sendReply(`_Spotify araması başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// SoundCloud Arama
// ══════════════════════════════════════════════════════
Module({
  pattern: "scara ?(.*)",
  fromMe: false,
  desc: "SoundCloud'da müzik arar.",
  usage: ".scara lofi beats",
  use: "arama",
}, async (message, match) => {
  const query = (match[1] || "").trim();
  if (!query) return await message.sendReply("_Arama terimi girin:_ `.scara lofi beats`");

  try {
    const data = await siputGet("/api/s/soundcloud", { query });
    const results = data.data || [];
    if (results.length === 0) return await message.sendReply("_Sonuç bulunamadı._");

    let text = `*SoundCloud Arama* | ${query}\n\n`;
    results.slice(0, 8).forEach((r, i) => {
      text += `*${i + 1}.* ${r.title || r.name || "?"}\n`;
      if (r.user || r.artist) text += `   Sanatçı: ${r.user || r.artist}\n`;
      if (r.url || r.link) text += `   ${r.url || r.link}\n`;
      text += "\n";
    });
    await message.sendReply(text.trim());
  } catch (e) {
    await message.sendReply(`_SoundCloud araması başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// DuckDuckGo Arama
// ══════════════════════════════════════════════════════
Module({
  pattern: "(?:ara|ddg) ?(.*)",
  fromMe: false,
  desc: "DuckDuckGo ile web araması yapar.",
  usage: ".ara nodejs nedir",
  use: "arama",
}, async (message, match) => {
  const query = (match[1] || "").trim();
  if (!query) return await message.sendReply("_Arama terimi girin:_ `.ara nodejs nedir`");

  try {
    const data = await siputGet("/api/s/duckduckgo", { query });
    const results = data.data || [];
    if (results.length === 0) return await message.sendReply("_Sonuç bulunamadı._");

    let text = `*Web Araması* | ${query}\n\n`;
    results.slice(0, 8).forEach((r, i) => {
      text += `*${i + 1}.* ${r.title || "?"}\n`;
      if (r.description || r.snippet) text += `   ${(r.description || r.snippet).substring(0, 150)}\n`;
      if (r.url || r.link) text += `   ${r.url || r.link}\n`;
      text += "\n";
    });
    await message.sendReply(text.trim());
  } catch (e) {
    await message.sendReply(`_Web araması başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Rastgele Kedi Fotoğrafı
// ══════════════════════════════════════════════════════
Module({
  pattern: "(?:kedi|randomkedi)",
  fromMe: false,
  desc: "Rastgele bir kedi fotoğrafı gönderir.",
  usage: ".kedi",
  use: "eglence",
}, async (message) => {
  try {
    const buf = await siputGetBuffer("/api/r/cats");
    await message.client.sendMessage(message.jid, {
      image: buf,
      caption: "*Miyav!*"
    }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`_Kedi fotoğrafı alınamadı:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Anime Sözleri
// ══════════════════════════════════════════════════════
Module({
  pattern: "animesoz",
  fromMe: false,
  desc: "Rastgele anime sözü gönderir.",
  usage: ".animesoz",
  use: "eglence",
}, async (message) => {
  try {
    const data = await siputGet("/api/r/quotesanime");
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Söz bulunamadı._");

    const quote = typeof r === "string" ? r : r.quote || r.text || JSON.stringify(r);
    const char = r.character || r.anime || "";
    await message.sendReply(`*Anime Sözü*\n\n_"${quote}"_${char ? `\n\n— ${char}` : ""}`);
  } catch (e) {
    await message.sendReply(`_Anime sözü alınamadı:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Çeviri
// ══════════════════════════════════════════════════════
Module({
  pattern: "(?:cevir|tercume) ?(.*)",
  fromMe: false,
  desc: "Metni belirtilen dile çevirir.",
  usage: ".cevir tr Hello World | .cevir en Merhaba Dünya",
  use: "araçlar",
}, async (message, match) => {
  const input = (match[1] || "").trim();
  if (!input) return await message.sendReply("_Kullanım:_ `.cevir tr Hello World`");

  const parts = input.split(" ");
  const targetLang = parts[0];
  const text = parts.slice(1).join(" ") || message.reply_message?.text;
  if (!text) return await message.sendReply("_Çevrilecek metin girin._");

  try {
    const data = await siputGet("/api/tools/translate", { text, to: targetLang });
    const result = data.data?.translatedText || data.data?.text || data.result;
    if (!result) return await message.sendReply("_Çeviri başarısız._");
    await message.sendReply(`*Çeviri (${targetLang})*\n\n${result}`);
  } catch (e) {
    await message.sendReply(`_Çeviri başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Waifu / Anime Görseli
// ══════════════════════════════════════════════════════
Module({
  pattern: "waifu",
  fromMe: false,
  desc: "Rastgele anime waifu görseli gönderir.",
  usage: ".waifu",
  use: "eglence",
}, async (message) => {
  try {
    const buf = await siputGetBuffer("/api/r/waifu");
    await message.client.sendMessage(message.jid, {
      image: buf,
      caption: "*Waifu*"
    }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`_Waifu görseli alınamadı:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Neko Görseli
// ══════════════════════════════════════════════════════
Module({
  pattern: "neko",
  fromMe: false,
  desc: "Rastgele anime neko görseli gönderir.",
  usage: ".neko",
  use: "eglence",
}, async (message) => {
  try {
    const buf = await siputGetBuffer("/api/r/neko");
    await message.client.sendMessage(message.jid, {
      image: buf,
      caption: "*Neko*"
    }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`_Neko görseli alınamadı:_ ${e.message}`);
  }
});

