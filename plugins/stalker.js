const { Module } = require("../main");
const axios = require("axios");

const NEXRAY_BASE = "https://api.nexray.web.id";
const SIPUTZX_BASE = "https://api.siputzx.my.id";
const TIMEOUT = 30000;

async function nexGet(path, opts = {}) {
  try {
    const res = await axios.get(`${NEXRAY_BASE}${path}`, {
      timeout: opts.timeout || TIMEOUT,
      validateStatus: () => true,
      responseType: opts.buffer ? "arraybuffer" : "json",
    });
    let payload = res.data;
    const contentType = (res.headers?.["content-type"] || "").toLowerCase();

    if (opts.buffer) {
      const buf = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data || []);
      if (contentType.includes("application/json") || contentType.includes("text/json")) {
        try {
          payload = JSON.parse(buf.toString("utf-8"));
        } catch {
          payload = null;
        }
      }
      if (res.status === 200 && buf.length > 0 && !contentType.includes("json")) {
        return buf;
      }
    }

    if (payload?.status && payload?.result !== undefined) {
      return payload.result;
    }

    const errorMsg =
      payload?.error?.message ||
      payload?.error ||
      payload?.message ||
      payload?.result?.message ||
      `HTTP ${res.status}`;

    throw new Error(errorMsg);
  } catch (e) {
    throw e;
  }
}

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

// ══════════════════════════════════════════════════════════
// SITELINK — IP adresi takip
// ══════════════════════════════════════════════════════════
Module({
  pattern: "siteip ?(.*)",
  fromMe: false,
  desc: "IP adresinin konum bilgilerini gösterir.",
  usage: ".siteip [IP adresi]",
  use: "araçlar",
},
  async (message, match) => {
    const target = (match[1] || "").trim();
    if (!target) return await message.sendReply("🌍 _IP adresi girin:_ `.siteip 8.8.8.8`");
    
    try {
      const result = await nexGet(`/tools/trackip?target=${encodeURIComponent(target)}`);
      if (result) {
        const info = typeof result === "string" ? result : 
          `📍 *Konum Bilgisi*\n\n` +
          (result.ip ? `🌐 IP: ${result.ip}\n` : "") +
          (result.country ? `🇹🇷 Ülke: ${result.country}\n` : "") +
          (result.region ? `📌 Bölge: ${result.region}\n` : "") +
          (result.city ? `🏙️ Şehir: ${result.city}\n` : "") +
          (result.isp ? `📡 ISP: ${result.isp}\n` : "") +
          (result.org ? `🏢 Organizasyon: ${result.org}\n` : "") +
          (result.timezone ? `🕐 Zaman Dilimi: ${result.timezone}\n` : "");
        await message.sendReply(info);
      } else {
        await message.sendReply("❌ _IP bilgisi bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _IP takibi başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// FREEFIRE — Free Fire oyuncu sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "freefire ?(.*)",
  fromMe: false,
  desc: "Free Fire oyuncusunun bilgilerini gösterir.",
  usage: ".freefire [oyuncul numarası]",
  use: "oyun",
},
  async (message, match) => {
    const uid = (match[1] || "").trim();
    if (!uid) return await message.sendReply("🎮 _Free Fire oyuncu numarası girin:_ `.freefire 1234567890`");
    
    try {
      const result = await nexGet(`/stalker/freefire?uid=${encodeURIComponent(uid)}`);
      if (result) {
        const info = typeof result === "string" ? result :
          `🎮 *Free Fire Bilgileri*\n\n` +
          (result.nickname ? `📛 Nick: ${result.nickname}\n` : "") +
          (result.level ? `⭐ Seviye: ${result.level}\n` : "") +
          (result.rank ? `🏆 Rank: ${result.rank}\n` : "") +
          (result.clan ? `👥 Clan: ${result.clan}\n` : "") +
          (result.uid ? `🆔 UID: ${result.uid}\n` : "");
        await message.sendReply(info || JSON.stringify(result));
      } else {
        await message.sendReply("❌ _Oyuncu bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Sorgu başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// GITHUB — GitHub kullanıcı sorgulama (Siputzx öncelikli + Nexray yedek)
// ══════════════════════════════════════════════════════════
Module({
  pattern: "github ?(.*)",
  fromMe: false,
  desc: "GitHub kullanıcısının profil bilgilerini gösterir.",
  usage: ".github [kullanıcı adı]",
  use: "araçlar",
},
  async (message, match) => {
    const username = (match[1] || "").trim();
    if (!username) return await message.sendReply("🐙 _GitHub kullanıcı adı girin:_ `.github mrbeast`");
    
    let result = null;
    let usedApi = "";
    
    // Önce Siputzx (avatar ile birlikte)
    try {
      const data = await siputGet("/api/stalk/github", { user: username });
      const r = data.data || data.result;
      if (r) {
        result = r;
        usedApi = "siputzx";
      }
    } catch (_) { }
    
    // Yedek: Nexray
    if (!result) {
      try {
        result = await nexGet(`/stalker/github?username=${encodeURIComponent(username)}`);
        usedApi = "nexray";
      } catch (_) { }
    }
    
    if (!result) return await message.sendReply("❌ _Kullanıcı bulunamadı_");
    
    // Siputzx'ten geldiyse avatar ile göster
    if (usedApi === "siputzx") {
      const text = [
        `*GitHub Profili*`,
        `*Ad:* ${result.name || result.login || username}`,
        result.bio ? `*Bio:* ${result.bio}` : null,
        `*Repo:* ${result.public_repos ?? "?"}`,
        `*Takipçi:* ${result.followers ?? "?"}`,
        `*Takip:* ${result.following ?? "?"}`,
        result.location ? `*Konum:* ${result.location}` : null,
        result.blog ? `*Web:* ${result.blog}` : null,
        `*Profil:* https://github.com/${result.login || username}`,
      ].filter(Boolean).join("\n");
      
      if (result.avatar_url) {
        await message.client.sendMessage(message.jid, {
          image: { url: result.avatar_url },
          caption: text
        }, { quoted: message.data });
      } else {
        await message.sendReply(text);
      }
    } else {
      // Nexray'den geldiyse sadece text
      const info = typeof result === "string" ? result :
        `🐙 *GitHub Profili*\n\n` +
        (result.login ? `👤 Kullanıcı: ${result.login}\n` : "") +
        (result.name ? `📛 İsim: ${result.name}\n` : "") +
        (result.bio ? `📝 Bio: ${result.bio}\n` : "") +
        (result.public_repos ? `📚 Repolar: ${result.public_repos}\n` : "") +
        (result.followers ? `👥 Takipçi: ${result.followers}\n` : "") +
        (result.following ? `📥 Takip: ${result.following}\n` : "") +
        (result.html_url ? `🔗 ${result.html_url}\n` : "");
      await message.sendReply(info || JSON.stringify(result));
    }
  }
);

// ══════════════════════════════════════════════════════════
// MLBB — Mobile Legends oyuncu sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "mlbb ?(.*)",
  fromMe: false,
  desc: "Mobile Legends oyuncusunun bilgilerini gösterir.",
  usage: ".mlbb [oyuncul ID] [zone ID]",
  use: "oyun",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const parts = input.split(/\s+/);
    const id = parts[0];
    const zone = parts[1] || "12230";
    
    if (!id) return await message.sendReply("🎮 _Mobile Legends ID ve zone girin:_ `.mlbb 807663005 12230`");
    
    try {
      const result = await nexGet(`/stalker/mlbb?id=${encodeURIComponent(id)}&zone=${encodeURIComponent(zone)}`);
      if (result) {
        const info = typeof result === "string" ? result :
          `🎮 *Mobile Legends Bilgileri*\n\n` +
          (result.nickname ? `📛 Nick: ${result.nickname}\n` : "") +
          (result.level ? `⭐ Seviye: ${result.level}\n` : "") +
          (result.rank ? `🏆 Rank: ${result.rank}\n` : "") +
          (result.hero ? `🦸 Ana Hero: ${result.hero}\n` : "") +
          (result.id ? `🆔 ID: ${result.id}\n` : "");
        await message.sendReply(info || JSON.stringify(result));
      } else {
        await message.sendReply("❌ _Oyuncu bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Sorgu başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// PINTEREST — Pinterest kullanıcı sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "pinterest ?(.*)",
  fromMe: false,
  desc: "Pinterest kullanıcısının profil bilgilerini gösterir.",
  usage: ".pinterest [kullanıcı adı]",
  use: "araçlar",
},
  async (message, match) => {
    const username = (match[1] || "").trim();
    if (!username) return await message.sendReply("📌 _Pinterest kullanıcı adı girin:_ `.pinterest veritasium`");
    
    try {
      const result = await nexGet(`/stalker/pinterest?username=${encodeURIComponent(username)}`);
      if (result) {
        const info = typeof result === "string" ? result :
          `📌 *Pinterest Profili*\n\n` +
          (result.username ? `👤 Kullanıcı: ${result.username}\n` : "") +
          (result.name ? `📛 İsim: ${result.name}\n` : "") +
          (result.bio ? `📝 Bio: ${result.bio}\n` : "") +
          (result.followers ? `👥 Takipçi: ${result.followers}\n` : "") +
          (result.following ? `📥 Takip: ${result.following}\n` : "") +
          (result.pins ? `📌 Pin sayısı: ${result.pins}\n` : "") +
          (result.profile_url ? `🔗 ${result.profile_url}\n` : "");
        await message.sendReply(info || JSON.stringify(result));
      } else {
        await message.sendReply("❌ _Kullanıcı bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Sorgu başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// ROBLOX — Roblox kullanıcı sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "roblox ?(.*)",
  fromMe: false,
  desc: "Roblox kullanıcısının profil bilgilerini gösterir.",
  usage: ".roblox [kullanıcı adı]",
  use: "oyun",
},
  async (message, match) => {
    const username = (match[1] || "").trim();
    if (!username) return await message.sendReply("🧸 _Roblox kullanıcı adı girin:_ `.roblox Builderman`");
    
    try {
      const result = await nexGet(`/stalker/roblox?username=${encodeURIComponent(username)}`);
      if (result) {
        const info = typeof result === "string" ? result :
          `🧸 *Roblox Profili*\n\n` +
          (result.username ? `👤 Kullanıcı: ${result.username}\n` : "") +
          (result.displayname ? `📛 Görünen İsim: ${result.displayname}\n` : "") +
          (result.description ? `📝 Açıklama: ${result.description}\n` : "") +
          (result.bio ? `📝 Bio: ${result.bio}\n` : "") +
          (result.created ? `📅 Oluşturulma: ${result.created}\n` : "") +
          (result.isBanned ? `⚠️ Banlı: ${result.isBanned}\n` : "") +
          (result.followerCount ? `👥 Takipçi: ${result.followerCount}\n` : "") +
          (result.followingCount ? `📥 Takip: ${result.followingCount}\n` : "") +
          (result.profileUrl ? `🔗 ${result.profileUrl}\n` : "");
        await message.sendReply(info || JSON.stringify(result));
      } else {
        await message.sendReply("❌ _Kullanıcı bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Sorgu başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// THARA — Threads kullanıcı sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "thara ?(.*)",
  fromMe: false,
  desc: "Threads kullanıcısının profil bilgilerini gösterir.",
  usage: ".thara [kullanıcı adı]",
  use: "araçlar",
},
  async (message, match) => {
    const username = (match[1] || "").trim();
    if (!username) return await message.sendReply("🧵 _Threads kullanıcı adı girin:_ `.thara zuck`");
    
    try {
      const result = await nexGet(`/stalker/threads?username=${encodeURIComponent(username)}`);
      if (result) {
        const info = typeof result === "string" ? result :
          `🧵 *Threads Profili*\n\n` +
          (result.username ? `👤 Kullanıcı: ${result.username}\n` : "") +
          (result.name ? `📛 İsim: ${result.name}\n` : "") +
          (result.bio ? `📝 Bio: ${result.bio}\n` : "") +
          (result.followers ? `👥 Takipçi: ${result.followers}\n` : "") +
          (result.following ? `📥 Takip: ${result.following}\n` : "") +
          (result.posts ? `📝 Gönderi: ${result.posts}\n` : "") +
          (result.profile_pic_url ? `🔗 [Profil Fotoğrafı](${result.profile_pic_url})\n` : "");
        await message.sendReply(info || JSON.stringify(result));
      } else {
        await message.sendReply("❌ _Kullanıcı bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Sorgu başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// YTKANAL — YouTube kanal sorgulama (Siputzx öncelikli + Nexray yedek)
// ══════════════════════════════════════════════════════════
Module({
  pattern: "ytkanal ?(.*)",
  fromMe: false,
  desc: "YouTube kanalının bilgilerini gösterir.",
  usage: ".ytkanal [kanal adı veya kullanıcı adı]",
  use: "araçlar",
},
  async (message, match) => {
    const username = (match[1] || "").trim();
    if (!username) return await message.sendReply("📺 _YouTube kanal adı girin:_ `.ytkanal mrbeast`");
    
    let result = null;
    let usedApi = "";
    
    // Önce Siputzx (avatar ile birlikte)
    try {
      const data = await siputGet("/api/stalk/youtube", { user: username });
      const r = data.data || data.result;
      if (r) {
        result = r;
        usedApi = "siputzx";
      }
    } catch (_) { }
    
    // Yedek: Nexray
    if (!result) {
      try {
        result = await nexGet(`/stalker/youtube?username=${encodeURIComponent(username)}`);
        usedApi = "nexray";
      } catch (_) { }
    }
    
    if (!result) return await message.sendReply("❌ _Kanal bulunamadı_");
    
    // Siputzx'ten geldiyse avatar ile göster
    if (usedApi === "siputzx") {
      const text = [
        `*YouTube Kanalı*`,
        `*Kanal:* ${result.name || result.title || username}`,
        result.description ? `*Açıklama:* ${result.description.substring(0, 200)}` : null,
        `*Abone:* ${result.subscribers ?? result.subscriberCount ?? "?"}`,
        `*Video:* ${result.videos ?? result.videoCount ?? "?"}`,
        `*Görüntülenme:* ${result.views ?? result.viewCount ?? "?"}`,
      ].filter(Boolean).join("\n");
      
      const avatar = result.avatar || result.thumbnail;
      if (avatar) {
        await message.client.sendMessage(message.jid, {
          image: { url: avatar },
          caption: text
        }, { quoted: message.data });
      } else {
        await message.sendReply(text);
      }
    } else {
      // Nexray'den geldiyse sadece text
      const info = typeof result === "string" ? result :
        `📺 *YouTube Kanalı*\n\n` +
        (result.title ? `📛 Kanal: ${result.title}\n` : "") +
        (result.description ? `📝 Açıklama: ${result.description}\n` : "") +
        (result.subscribers ? `👥 Abone: ${result.subscribers}\n` : "") +
        (result.views ? `👁️ İzlenme: ${result.views}\n` : "") +
        (result.videos ? `🎬 Video: ${result.videos}\n` : "") +
        (result.country ? `🌍 Ülke: ${result.country}\n` : "") +
        (result.channelId ? `🆔 ID: ${result.channelId}\n` : "") +
        (result.customUrl ? `🔗 @${result.customUrl}\n` : "");
      await message.sendReply(info || JSON.stringify(result));
    }
  }
);
