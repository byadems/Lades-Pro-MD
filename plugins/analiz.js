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
        await message.sendReply("❌ *IP bilgisi bulunamadı!*");
      }
    } catch (e) {
      await message.sendReply(`❌ *IP takibi başarısız:* \n\n${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// INSTAGRAM — Instagram kullanıcı sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "igara ?(.*)",
  fromMe: false,
  desc: "Instagram kullanıcısının profil detaylarını ve istatistiklerini gösterir.",
  usage: ".igara [kullanıcı adı]",
  use: "araçlar",
},
  async (message, match) => {
    const username = (match[1] || "").trim().replace(/^@/, "");
    if (!username) return await message.sendReply("📸 _Instagram kullanıcı adı girin:_ `.igara zuck`");

    try {
      const result = await nexGet(`/stalker/instagram?username=${encodeURIComponent(username)}`);
      if (!result) return await message.sendReply("❌ *Kullanıcı bulunamadı!*");

      const name = result.full_name || result.fullname || result.name || username;
      const bio = result.biography || result.bio || "-";
      const followers = result.follower_count ?? result.followers ?? "-";
      const following = result.following_count ?? result.following ?? "-";
      const posts = result.media_count ?? result.posts ?? "-";
      const isPrivate = result.is_private ? "🔒 Gizli" : "✅ Açık";
      const isVerified = result.is_verified ? "✅" : "❌";

      const caption =
        `📸 *Instagram Profili*\n\n` +
        `📛 *İsim:* ${name}\n` +
        `👤 *Kullanıcı:* @${result.username || username}\n` +
        `📝 *Bio:* ${bio}\n` +
        `👥 *Takipçi:* ${followers}\n` +
        `📥 *Takip:* ${following}\n` +
        `📤 *Gönderi:* ${posts}\n` +
        `🔓 *Hesap:* ${isPrivate}\n` +
        `✅ *Doğrulanmış:* ${isVerified}`;

      const avatar = result.profile_pic_url || result.hd_profile_picture || result.profile_pic || result.avatar || result.profile?.avatar || result.profilePic || result.profile_image || result.profile_image_url || result.image_url || result.image || result.thumbnail;
      if (avatar) {
        await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
      } else {
        await message.sendReply(caption);
      }
    } catch (e) {
      const msg = e.message.includes("429") ? "⏳ *Instagram yoğunluk nedeniyle cevap vermiyor!* _Lütfen biraz sonra tekrar deneyin._" : `❌ *Sorgu başarısız:* \n\n${e.message}`;
      await message.sendReply(msg);
    }
  }
);

// ══════════════════════════════════════════════════════════
// TWITTER — Twitter/X kullanıcı sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "(?:twara|xara) ?(.*)",
  fromMe: false,
  desc: "Twitter/X kullanıcısının profil detaylarını ve istatistiklerini gösterir.",
  usage: ".twara [kullanıcı adı]",
  use: "araçlar",
},
  async (message, match) => {
    const username = (match[1] || "").trim().replace(/^@/, "");
    if (!username) return await message.sendReply("𝕏 _Twitter kullanıcı adı girin:_ `.twara elonmusk`");

    let result = null;
    try {
      result = await nexGet(`/stalker/twitter?username=${encodeURIComponent(username)}`);
    } catch (_) { }

    if (!result) {
      try {
        const data = await siputGet("/api/stalk/twitter", { user: username });
        result = data.data || data.result;
      } catch (_) { }
    }

    if (!result) return await message.sendReply("❌ *Kullanıcı bulunamadı!*");

    const name = result.name || result.full_name || username;
    const bio = result.description || result.bio || result.biography || "-";
    const stats = result.stats || result;
    const followers = stats.followers ?? stats.followers_count ?? result.follower_count ?? "-";
    const following = stats.following ?? stats.friends_count ?? result.following_count ?? "-";
    const tweets = stats.tweets ?? stats.statuses_count ?? result.media_count ?? "-";
    const likes = stats.likes ?? result.favourites_count ?? "-";
    const isVerified = (result.verified === true || result.is_verified === true) ? "✅" : "❌";

    const caption =
      `𝕏 *X/Twitter Profili*\n\n` +
      `📛 *İsim:* ${name}\n` +
      `👤 *Kullanıcı:* @${result.username || result.screen_name || username}\n` +
      `📝 *Bio:* ${bio}\n` +
      `👥 *Takipçi:* ${followers}\n` +
      `📥 *Takip:* ${following}\n` +
      `📤 *Tweet:* ${tweets}\n` +
      `❤️ *Beğeni:* ${likes}\n` +
      `✅ *Doğrulanmış:* ${isVerified}`;

    const avatar = result.profile?.avatar || result.avatar || result.profile_image_url_https || result.profile_image_url || result.profile_image || result.profile_pic_url || result.profile_pic || result.profilePic || result.image_url || result.image || result.thumbnail;
    if (avatar) {
      await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
    } else {
      await message.sendReply(caption);
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
  usage: ".freefire [oyuncu numarası]",
  use: "oyun",
},
  async (message, match) => {
    const uid = (match[1] || "").trim();
    if (!uid) return await message.sendReply("🎮 _Free Fire oyuncu numarası girin:_ `.freefire 1234567890`");

    try {
      const result = await nexGet(`/stalker/freefire?uid=${encodeURIComponent(uid)}`);
      if (!result) return await message.sendReply("❌ *Oyuncu bulunamadı!*");

      const caption =
        `🎮 *Free Fire Bilgileri*\n\n` +
        (result.nickname ? `📛 *Nick:* ${result.nickname}\n` : "") +
        (result.level ? `⭐ *Seviye:* ${result.level}\n` : "") +
        (result.rank ? `🏆 *Rank:* ${result.rank}\n` : "") +
        (result.clan ? `👥 *Clan:* ${result.clan}\n` : "") +
        (result.uid ? `🆔 *UID:* ${result.uid}\n` : "");

      const avatar = result.avatar || result.profile_pic || result.profilePic || result.profile_pic_url || result.image || result.thumbnail || result.avatar_url || result.profile_image || result.profile_image_url || result.image_url;
      if (avatar) {
        await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
      } else {
        await message.sendReply(caption || JSON.stringify(result));
      }
    } catch (e) {
      await message.sendReply(`❌ *Sorgu başarısız:* \n\n${e.message}`);
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

    if (!result) return await message.sendReply("❌ *Kullanıcı bulunamadı!*");

    const caption = [
      `🐙 *GitHub Profili*`,
      `*Ad:* ${result.name || result.nickname || result.login || username}`,
      result.bio ? `*Bio:* ${result.bio}` : null,
      `*Kullanıcı:* ${result.login || result.username || username}`,
      `*Tip:* ${result.type || "Bilinmiyor"} ${result.admin ? "(Admin)" : ""}`,
      `*Repo:* ${result.public_repos ?? result.public_repo ?? "?"} | *Gist:* ${result.public_gists ?? "?"}`,
      `*Takipçi:* ${result.followers ?? "?"}`,
      `*Takip:* ${result.following ?? "?"}`,
      result.company ? `*Şirket:* ${result.company}` : null,
      result.location ? `*Konum:* ${result.location}` : null,
      result.blog ? `*Web:* ${result.blog}` : null,
      result.email ? `*E-Posta:* ${result.email}` : null,
      result.twitter_username ? `*Twitter:* @${result.twitter_username}` : null,
      result.created_at ? `*Katılma:* ${new Date(result.created_at).toLocaleDateString("tr-TR")}` : null,
    ].filter(Boolean).join("\n");

    const avatar = result.avatar_url || result.avatar || result.profile_pic_url || result.profile_pic || result.profilePic || result.profile_image || result.profile_image_url || result.image_url || result.image || result.thumbnail;
    if (avatar) {
      await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
    } else {
      await message.sendReply(caption);
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
  usage: ".mlbb [oyuncu ID] [zone ID]",
  use: "oyun",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const parts = input.split(/\s+/);
    const id = parts[0];
    const zone = parts[1] || "12230";

    if (!id) return await message.sendReply("🎮 _Mobile Legends ID ve zone girin:_\n`.mlbb 807663005 12230`");

    try {
      const result = await nexGet(`/stalker/mlbb?id=${encodeURIComponent(id)}&zone=${encodeURIComponent(zone)}`);
      if (!result) return await message.sendReply("❌ *Oyuncu bulunamadı!*");

      const caption =
        `🎮 *Mobile Legends Bilgileri*\n\n` +
        (result.nickname ? `📛 *Nick:* ${result.nickname}\n` : "") +
        (result.level ? `⭐ *Seviye:* ${result.level}\n` : "") +
        (result.rank ? `🏆 *Rank:* ${result.rank}\n` : "") +
        (result.hero ? `🦸 *Ana Hero:* ${result.hero}\n` : "") +
        (result.id ? `🆔 *ID:* ${result.id}\n` : "");

      const avatar = result.avatar || result.profile_pic || result.profile_pic_url || result.headshot || result.profilePic || result.profile_image || result.profile_image_url || result.image_url || result.image || result.thumbnail;
      if (avatar) {
        await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
      } else {
        await message.sendReply(caption || JSON.stringify(result));
      }
    } catch (e) {
      await message.sendReply(`❌ *Sorgu başarısız:* \n\n${e.message}`);
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
      if (!result) return await message.sendReply("❌ *Kullanıcı bulunamadı!*");

      let username_str = result.basic?.name || result.username;
      let displayname_str = result.basic?.displayName || result.displayname;
      let bio_str = result.basic?.description || result.description || result.bio;
      let created_str = result.basic?.created ? new Date(result.basic.created).toLocaleDateString('tr-TR') : result.created;
      let banned_str = result.basic?.isBanned ?? result.isBanned;
      let follower_str = result.social?.followers?.count ?? result.followerCount;
      let following_str = result.social?.following?.count ?? result.followingCount;
      let location_str = result.presence?.userPresences?.[0]?.lastLocation;
      let verified_str = result.basic?.hasVerifiedBadge ? "✅" : "❌";

      const caption =
        `🧸 *Roblox Profili*\n\n` +
        `👤 *Kullanıcı:* ${username_str || "-"}\n` +
        `📛 *Görünen İsim:* ${displayname_str || "-"}\n` +
        `📝 *Açıklama:* ${bio_str || "-"}\n` +
        `📅 *Oluşturulma:* ${created_str || "-"}\n` +
        (location_str ? `📍 *Durum:* ${location_str}\n` : "") +
        `⚠️ *Banlı:* ${banned_str ? "Evet" : "Hayır"}\n` +
        `👥 *Takipçi:* ${follower_str ?? "-"}\n` +
        `📥 *Takip:* ${following_str ?? "-"}\n` +
        `✅ *Doğrulanmış:* ${verified_str}`;

      const avatar = result.avatar?.headshotUrl || result.avatar?.imageUrl || result.avatar || result.profile_pic_url || result.thumbnail || result.headshot || result.profile_pic || result.profilePic || result.profile_image || result.profile_image_url || result.image_url || result.image;
      if (avatar) {
        await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
      } else {
        await message.sendReply(caption);
      }
    } catch (e) {
      await message.sendReply(`❌ *Sorgu başarısız:* \n\n${e.message}`);
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
      if (!result) return await message.sendReply("❌ *Kullanıcı bulunamadı!*");

      const name = result.name || result.username || username;
      const bio = result.bio || result.biography || "-";
      const followers = result.followers ?? result.follower_count ?? "-";
      const following = result.following ?? result.following_count ?? "-";
      const posts = result.posts ?? result.threads_count ?? result.media_count ?? "-";

      const isVerified = result.is_verified ? "✅ Evet" : "❌ Hayır";

      const caption =
        `🧵 *Threads Profili*\n\n` +
        `📛 *İsim:* ${name}\n` +
        `👤 *Kullanıcı:* @${result.username || username}\n` +
        `📝 *Bio:* ${bio}\n` +
        `👥 *Takipçi:* ${followers}\n` +
        `🆔 *Hesap ID:* ${result.id || "Bilinmiyor"}\n` +
        `✅ *Onaylı Hesap:* ${isVerified}`;

      const avatar = result.hd_profile_picture || result.profile_pic_url || result.profile_pic || result.profile_picture || result.avatar || result.profile?.avatar || result.profilePic || result.profile_image || result.profile_image_url || result.image_url || result.image || result.thumbnail;
      if (avatar) {
        await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
      } else {
        await message.sendReply(caption);
      }
    } catch (e) {
      await message.sendReply(`❌ *Sorgu başarısız:* \n\n${e.message}`);
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

    if (!result) return await message.sendReply("❌ *Kanal bulunamadı!*");

    const channel = result.channel || result;
    const caption = [
      `📺 *YouTube Kanalı*`,
      `*Kanal:* ${channel.name || channel.title || channel.username || username}`,
      channel.description ? `*Açıklama:* ${channel.description.substring(0, 200)}...` : null,
      `*Abone:* ${channel.subscribers ?? channel.subscriberCount ?? "?"}`,
      `*Video:* ${channel.videos ?? channel.videoCount ?? "?"}`,
      `*İzlenme:* ${channel.views ?? channel.viewCount ?? "?"}`,
      channel.country ? `*Ülke:* ${channel.country}` : null,
      channel.customUrl ? `*@Handle:* @${channel.customUrl}` : null,

    ].filter(Boolean).join("\n");

    const avatar = result.channel?.avatarUrl || result.avatar || result.thumbnail || result.profile_picture || result.profile_pic_url || result.profile_pic || result.profilePic || result.profile_image || result.profile_image_url || result.image_url || result.image;
    if (avatar) {
      await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
    } else {
      await message.sendReply(caption);
    }
  }
);

// ══════════════════════════════════════════════════════════
// TIKTOK — TikTok kullanıcı sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: 'ttara ?(.*)',
  fromMe: false,
  desc: 'TikTok kullanıcı bilgilerini getirir.',
  usage: '.ttara [kullanıcıadı]',
  use: 'araçlar',
},
  async (message, match) => {
    const extractUsername = (input) => {
      const urlMatch = input.match(/tiktok\.com\/@?([A-Za-z0-9_.]+)/i);
      if (urlMatch) return urlMatch[1];
      const atMatch = input.match(/^@?([A-Za-z0-9_.]{2,24})$/);
      return atMatch ? atMatch[1] : null;
    };
    const formatNumber = (n) => {
      if (n == null) return 'Bilinmiyor';
      n = Number(n);
      if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace('.0', '') + 'B';
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + 'M';
      if (n >= 1_000) return (n / 1_000).toFixed(1).replace('.0', '') + 'K';
      return n.toLocaleString('tr-TR');
    };
    const normalizeUser = (data, i) => {
      try {
        if (i === 0) {
          if (data?.status !== true || !data?.result?.username) return null;
          const u = data.result;
          return { username: u.username, id: u.id || 'Bilinmiyor', name: u.name || 'Bilinmiyor', followers: u.stats?.raw_followers ?? null, following: u.stats?.raw_following ?? null, likes: u.stats?.raw_likes ?? null, bio: u.bio || null, verified: u.verified === 'Verified', private: u.private === 'Yes', avatar: u.avatar || null };
        }
        if (i === 1) {
          if (data?.status !== 200 || !data?.result) return null;
          const u = data.result;
          return { username: u.username, id: u.id || 'Bilinmiyor', name: u.name || 'Bilinmiyor', followers: u.followers ?? null, following: u.following ?? null, likes: u.likes ?? null, bio: u.bio || null, verified: u.verified === true, private: u.private === true, avatar: u.avatar || null };
        }
        if (i === 2) {
          if (data?.status !== true || !data?.data?.user?.uniqueId) return null;
          const u = data.data.user;
          const s = data.data.stats;
          return { username: u.uniqueId, id: u.id || 'Bilinmiyor', name: u.nickname || 'Bilinmiyor', followers: s?.followerCount ?? null, following: s?.followingCount ?? null, likes: s?.heartCount ?? null, bio: u.signature || null, verified: u.verified === true, private: u.privateAccount === true, avatar: u.avatarLarger || null };
        }
        return null;
      } catch { return null; }
    };
    try {
      let input = (match?.[1] || '').trim() || (message.reply_message?.text || message.reply_message?.caption || '').trim();
      if (!input) return await message.sendReply('⚠️ *Lütfen bir TikTok @kullanıcı adı veya profil bağlantısı girin!* \n\n*💡 Örnek:* \`.ttara mrbeast\`');
      const username = extractUsername(input);
      if (!username) return await message.sendReply('❌ *Geçersiz TikTok kullanıcı adı!*');
      const apis = [
        `https://api.nexray.web.id/stalker/tiktok?username=${encodeURIComponent(username)}`,
        `https://api.princetechn.com/api/stalk/tiktokstalk?apikey=prince&username=${encodeURIComponent(username)}`,
        `https://api.siputzx.my.id/api/stalk/tiktok?username=${encodeURIComponent(username)}`,
      ];
      let user = null;
      for (let i = 0; i < apis.length; i++) {
        try {
          const { data } = await axios.get(apis[i], { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
          user = normalizeUser(data, i);
          if (user) break;
        } catch { continue; }
      }
      if (!user) return await message.sendReply('⚠️ *Kullanıcı bulunamadı veya tüm API\'ler şu an erişilemiyor. Lütfen daha sonra tekrar deneyin.*');
      let caption = `👤 *Kullanıcı Adı:* @${user.username}\n🆔 *Kullanıcı ID:* ${user.id}\n📝 *İsim:* ${user.name}\n👥 *Takipçi:* ${formatNumber(user.followers)}\n➕ *Takip:* ${formatNumber(user.following)}\n❤️ *Beğeni:* ${formatNumber(user.likes)}\nℹ️ *BİYOGRAFİ*\n_${user.bio || 'Biyografi yok'}_\n` + (user.verified ? '✅ *Doğrulanmış Hesap*\n' : '') + (user.private ? '🔒 *Gizli Hesap*\n' : '');
      if (user.avatar) await message.sendMessage({ url: user.avatar }, 'image', { caption, quoted: message.data });
      else await message.sendReply(caption);
    } catch (error) {
      console.error('[TikTok] Kritik Hata:', error);
      return await message.sendReply('❌ *Bilgiler getirilirken bir hata oluştu! Lütfen daha sonra tekrar deneyin.*');
    }
  }
);
