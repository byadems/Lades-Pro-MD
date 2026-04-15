const { Module } = require("../main");
const {
  pinterestSearch,
  downloadGram,
  pinterestDl,
  tiktok,
  fb,
  nx,
  nxTry,
  fmtCount,
  censorBadWords,
} = require("./utils");
const nexray = require("./utils/nexray");
const botConfig = require("../config");
const axios = require("axios");
const { saveToDisk, getTempPath, cleanTempFile, extractUrls, validateUrl, isMediaImage, readMp4Dimensions } = require("../core/helpers");

const SIPUTZX_BASE = "https://api.siputzx.my.id";

function formatNumber(num) {
  if (num === null || num === undefined) return "Bilinmiyor";
  const n = Number(num);
  if (isNaN(n)) return String(num);
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(".0", "") + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".0", "") + "M";
  return n.toLocaleString("tr-TR");
}

function normalizeUser(data, apiIndex) {
  try {
    if (apiIndex === 0) {
      if (data?.status !== 200 || !data?.result) return null;
      const u = data.result;
      if (!u.username) return null;
      return {
        username: u.username,
        id: u.id || "Bilinmiyor",
        name: u.name || "Bilinmiyor",
        followers: u.followers ?? null,
        following: u.following ?? null,
        likes: u.likes ?? null,
        bio: u.bio || null,
        verified: u.verified === true,
        private: u.private === true,
        avatar: u.avatar || null,
      };
    }
    if (apiIndex === 1) {
      if (data?.status !== true || !data?.data) return null;
      const u = data.data.user;
      const s = data.data.stats;
      if (!u?.uniqueId) return null;
      return {
        username: u.uniqueId,
        id: u.id || "Bilinmiyor",
        name: u.nickname || "Bilinmiyor",
        followers: s?.followerCount ?? null,
        following: s?.followingCount ?? null,
        likes: s?.heartCount ?? null,
        bio: u.signature || null,
        verified: u.verified === true,
        private: u.privateAccount === true,
        avatar: u.avatarLarger || null,
      };
    }
    if (apiIndex === 2) {
      if (data?.status !== true || !data?.result) return null;
      const u = data.result;
      if (!u.username) return null;
      return {
        username: u.username,
        id: u.id || "Bilinmiyor",
        name: u.name || "Bilinmiyor",
        followers: u.stats?.raw_followers ?? null,
        following: u.stats?.raw_following ?? null,
        likes: u.stats?.raw_likes ?? null,
        bio: u.bio || null,
        verified: u.verified === "Verified",
        private: u.private === true,
        avatar: u.avatar || null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function siputGet(path, params = {}) {
  const url = `${SIPUTZX_BASE}${path}`;
  const res = await axios.get(url, { params, timeout: 30000, validateStatus: () => true });
  if (res.data && res.data.status) return res.data;
  throw new Error(res.data?.error || "API yanıt vermedi");
}

async function checkRedirect(url) {
  try {
    let split_url = url.split("/");
    if (split_url.includes("share")) {
      let res = await axios.get(url, { timeout: 10000, maxRedirects: 5 });
      return res.request.res.responseUrl || url;
    }
  } catch (_) { }
  return url;
}

function extractTikTokUsername(input) {
  if (!input) return null;
  input = input.trim();
  if (input.startsWith('@')) {
    return input.slice(1).toLowerCase();
  }
  if (/^[a-zA-Z0-9._]+$/.test(input) && input.length >= 2 && input.length <= 24) {
    return input.toLowerCase();
  }
  try {
    const match = input.match(/tiktok\.com\/@([^/?]+)/i);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
  } catch (_) { }
  return null;
}

Module({
  pattern: "insta ?(.*)",
  fromMe: false,
  desc: "Instagram üzerinden Reels, Video veya Fotoğraf albümlerini indirir.",
  usage: ".insta [bağlantı]",
  use: "indirme",
},
  async (message, match) => {
    let mediaLinks = (match[1] || message.reply_message?.text || "").trim();
    if (!mediaLinks)
      return await message.sendReply("_*⚠️ Instagram bağlantı(lar)ı gerekli*_");
    if (mediaLinks.startsWith("ll")) return;

    const allUrls = extractUrls(mediaLinks);
    if (!allUrls.length)
      return await message.sendReply("_*⚠️ Instagram bağlantı(lar)ı gerekli*_");

    const instagramUrls = [];

    for (let url of allUrls) {
      if (url.includes("gist") || url.includes("youtu") || url.startsWith("ll"))
        continue;

      url = await checkRedirect(url);

      if (url.includes("stories")) continue;

      if (!url.includes("instagram.com")) continue;

      if (validateUrl(url, "instagram")) {
        const cleanUrl = url.split("?")[0].replace(/\/$/, "");
        const mediaId = cleanUrl.match(/\/([\w-]+)\/?$/)?.[1];
        if (mediaId && mediaId.length > 20) continue;

        instagramUrls.push(url);
      }
    }

    if (!instagramUrls.length)
      return await message.sendReply("_⚠️ Geçerli Instagram bağlantı(lar)ı gerekli_");

    try {
      const allMediaUrls = [];
      const quotedMessage = message.reply_message
        ? message.quoted
        : message.data;

      for (const url of instagramUrls) {
        let found = false;

        try {
          const r = await axios.get('https://api.nexray.web.id/downloader/v2/instagram?url=' + encodeURIComponent(url), { timeout: 40000 });
          const media = r.data.result?.media;
          if (media && Array.isArray(media)) {
            for (const item of media.slice(0, 3)) {
              if (item.url && (item.type === 'video' || item.type === 'mp4')) {
                allMediaUrls.push(item.url);
              }
            }
            if (allMediaUrls.length > 0) found = true;
          }
        } catch (_) { }

        if (!found) {
          try {
            const r = await axios.get('https://api.nexray.web.id/downloader/instagram?url=' + encodeURIComponent(url), { timeout: 40000 });
            const nexrayData = r.data.result;
            if (nexrayData && Array.isArray(nexrayData)) {
              for (const item of nexrayData.slice(0, 3)) {
                if (item.url && (item.type === 'video' || item.url.includes('.mp4'))) {
                  allMediaUrls.push(item.url);
                }
              }
              if (allMediaUrls.length > 0) found = true;
            }
          } catch (_) { }
        }

        if (!found) {
          try {
            const fallback = await siputGet("/api/d/sssinstagram", { url });
            const r = fallback.result || fallback.data;

            if (r?.url && !Array.isArray(r)) {
              const items = r.url;
              if (Array.isArray(items)) {
                for (const item of items.slice(0, 5)) {
                  if (item?.url && Array.isArray(item.url)) {
                    for (const u of item.url.slice(0, 3)) {
                      if (u?.url?.startsWith("http")) allMediaUrls.push(u.url);
                    }
                  }
                }
                if (allMediaUrls.length > 0) found = true;
              }
            }

            if (!found && r && Array.isArray(r)) {
              for (const item of r.slice(0, 5)) {
                if (item?.url && Array.isArray(item.url)) {
                  for (const u of item.url.slice(0, 3)) {
                    if (u?.url?.startsWith("http")) allMediaUrls.push(u.url);
                  }
                }
              }
              if (allMediaUrls.length > 0) found = true;
            }
          } catch (_) { }
        }

        if (!found) {
          try {
            const fallback = await siputGet("/api/d/igram", { url });
            const r = fallback.result || fallback.data;
            if (r && Array.isArray(r)) {
              for (const item of r.slice(0, 5)) {
                const edges = item?.node?.media?.edges;
                if (edges && Array.isArray(edges)) {
                  for (const edge of edges.slice(0, 5)) {
                    if (edge?.node?.display_url) {
                      allMediaUrls.push(edge.node.display_url);
                    }
                  }
                }
              }
              if (allMediaUrls.length > 0) found = true;
            }
          } catch (_) { }
        }

        if (!found) {
          try {
            const fallback = await siputGet("/api/d/fastdl", { url });
            const r = fallback.result || fallback.data;

            if (r?.url && !Array.isArray(r)) {
              const items = r.url;
              if (Array.isArray(items)) {
                for (const item of items.slice(0, 5)) {
                  if (item?.url && Array.isArray(item.url)) {
                    for (const u of item.url.slice(0, 3)) {
                      if (u?.url?.startsWith("http")) allMediaUrls.push(u.url);
                    }
                  }
                }
                if (allMediaUrls.length > 0) found = true;
              }
            }

            if (!found && r && Array.isArray(r)) {
              for (const item of r.slice(0, 5)) {
                if (item?.url && Array.isArray(item.url)) {
                  for (const u of item.url.slice(0, 3)) {
                    if (u?.url?.startsWith("http")) allMediaUrls.push(u.url);
                  }
                }
              }
              if (allMediaUrls.length > 0) found = true;
            }
          } catch (_) { }
        }

        if (!found) {
          console.error("İndirme hatası:", url);
        }
      }

      if (!allMediaUrls.length)
        return await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_");

      const tempFiles = [];
      try {
        for (const mediaUrl of allMediaUrls) {
          const isImage = isMediaImage(mediaUrl);
          const ext = isImage ? ".jpg" : ".mp4";
          const tempPath = getTempPath(ext);
          await saveToDisk(mediaUrl, tempPath);
          tempFiles.push({ path: tempPath, isImage });
        }

        if (tempFiles.length === 1) {
          const file = tempFiles[0];
          return await message.sendReply(
            { [file.isImage ? "image" : "video"]: { url: file.path } },
            { quoted: quotedMessage }
          );
        }

        const albumObject = tempFiles.map((file, index) => {
          const item = { [file.isImage ? "image" : "video"]: { url: file.path } };
          if (index === 0) {
            item.caption = `✅ İndirme tamamlandı! (${tempFiles.length} medya)`;
          }
          return item;
        });

        try {
          await message.client.albumMessage(
            message.jid,
            albumObject,
            quotedMessage
          );
        } catch (e) {
          console.error("Albüm gönderilemedi, tek tek gönderiliyor:", e.message);
          for (const file of tempFiles) {
            await message.sendReply(
              { [file.isImage ? "image" : "video"]: { url: file.path } }
            );
            await new Promise(r => setTimeout(r, 500));
          }
        }
        return;
      } finally {
        for (const file of tempFiles) {
          cleanTempFile(file.path);
        }
      }
    } catch (err) {
      console.error("Instagram komut hatası:", err?.message || err);
      return await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_");
    }
  }
);

Module({
  pattern: "fb ?(.*)",
  fromMe: false,
  desc: "Facebook videolarını yüksek kalitede indirir.",
  usage: ".fb [bağlantı]",
  use: "indirme",
},
  async (message, match) => {
    let videoLink = !message.reply_message?.message
      ? match[1]
      : message.reply_message.message;

    const urls = extractUrls(videoLink);
    if (urls.length > 0 && validateUrl(urls[0], "facebook")) {
      videoLink = urls[0];
    } else {
      return await message.sendReply("_⚠️ Lütfen geçerli bir Facebook bağlantısı girin._");
    }

    if (!videoLink) return await message.sendReply("_⚠️ Facebook bağlantısı gerekli_");
    try {
      let result = await fb(videoLink);
      if (!result?.url) {
        result = await nexray.downloadFacebook(videoLink);
      }
      if (result?.url) {
        const tempPath = getTempPath(".mp4");
        try {
          await saveToDisk(result.url, tempPath);
          return await message.sendReply({ video: { url: tempPath } });
        } finally {
          cleanTempFile(tempPath);
        }
      }
    } catch (e) {
      try {
        const fallback = await siputGet("/api/d/facebook", { url: videoLink });
        const r = fallback.data || fallback.result;
        if (r?.url || r?.video || r?.hd || r?.sd) {
          const videoUrl = r.hd || r.sd || r.url || r.video;
          const tempPath = getTempPath(".mp4");
          try {
            await saveToDisk(typeof videoUrl === "object" ? videoUrl.url : videoUrl, tempPath);
            return await message.sendReply({ video: { url: tempPath } });
          } finally {
            cleanTempFile(tempPath);
          }
        }
      } catch (_) { }
      try {
        const fallback = await nexray.downloadFacebook(videoLink);
        if (fallback?.url) {
          const tempPath = getTempPath(".mp4");
          try {
            await saveToDisk(fallback.url, tempPath);
            return await message.sendReply({ video: { url: tempPath } });
          } finally {
            cleanTempFile(tempPath);
          }
        }
      } catch (_) { }
      console.error("Facebook indirme hatası:", e.message);
    }
    return await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_"
    );
  }
);





Module({
  pattern: "hikaye ?(.*)",
  fromMe: false,
  desc: "Belirtilen Instagram kullanıcısının hikayelerini (story) toplu olarak indirir.",
  usage: ".hikaye [kullanıcıadı]",
  use: "indirme",
},
  async (message, match) => {
    let userIdentifier =
      match[1] !== "" ? match[1] : message.reply_message?.text;

    if (
      userIdentifier &&
      (userIdentifier.includes("/reel/") ||
        userIdentifier.includes("/tv/") ||
        userIdentifier.includes("/p/"))
    )
      return;
    if (!userIdentifier)
      return await message.sendReply("_⚠️ Bir Instagram kullanıcı adı veya bağlantısı gerekli!_");

    const urls = extractUrls(userIdentifier);
    userIdentifier = urls.length === 0
      ? `https://instagram.com/stories/${userIdentifier}/`
      : urls[0];

    try {
      var storyData = await downloadGram(userIdentifier);
    } catch {
      return await message.sendReply("*_⚠️ Üzgünüm, sunucu hatası_*");
    }
    if (!storyData || !storyData.length)
      return await message.sendReply("*_⚠️ Bulunamadı!_*");

    storyData = [...new Set(storyData)];
    if (storyData.length === 1) {
      const isImage = isMediaImage(storyData[0]);
      const tempPath = getTempPath(isImage ? ".jpg" : ".mp4");
      try {
        await saveToDisk(storyData[0], tempPath);
        return await message.sendReply(
          { [isImage ? "image" : "video"]: { url: tempPath } }
        );
      } finally {
        cleanTempFile(tempPath);
      }
    }
    userIdentifier = userIdentifier
      .replace("https://instagram.com/stories/", "")
      .split("/")[0];
    await message.sendReply(`_${userIdentifier} kullanıcısının (${storyData.length} hikayesi iletiliyor...)_`, { quoted: message.data });
    for (const storyMediaUrl of storyData) {
      const isImage = isMediaImage(storyMediaUrl);
      const tempPath = getTempPath(isImage ? ".jpg" : ".mp4");
      try {
        await saveToDisk(storyMediaUrl, tempPath);
        await message.sendReply({ [isImage ? "image" : "video"]: { url: tempPath } });
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error("Hikaye medyaları indirilemedi:", err);
      } finally {
        cleanTempFile(tempPath);
      }
    }
    return;
  }
);

Module({
  pattern: "pinterest ?(.*)",
  fromMe: false,
  desc: "Pinterest üzerindeki resim/videoları indirir veya kullanıcı profili sorgular.",
  usage: ".pinterest [sorgu/bağlantı/kullanıcı]",
  use: "araçlar",
},
  async (message, match) => {
    let input = (match[1] || message.reply_message?.text || "").trim();
    if (!input || input === "g") return await message.sendReply("📌 _Arama terimi, bağlantı veya kullanıcı adı girin:_ `.pinterest manzara` veya `.pinterest @kullanici` veya `.pinterest link` ");

    // 1. Durum: Bağlantı (İndirme)
    const urls = extractUrls(input);
    if (urls.length > 0) {
      const pinUrl = urls[0];
      try {
        const url = await nexray.downloadPinterest(pinUrl);
        if (!url) {
          try {
            const fallback = await siputGet("/api/d/pinterest", { url: pinUrl });
            const r = fallback.data || fallback.result;
            if (r?.url || r?.image || r?.video) {
              const mediaUrl = r.url || r.image || r.video;
              const isImage = !mediaUrl.includes(".mp4") && r.type !== "video";
              const tempPath = getTempPath(isImage ? ".jpg" : ".mp4");
              try {
                await saveToDisk(mediaUrl, tempPath);
                await message.sendReply({ [isImage ? "image" : "video"]: { url: tempPath } });
              } finally {
                cleanTempFile(tempPath);
              }
              return;
            }
          } catch (_) { }
          return await message.sendReply("❌ _İndirilebilir medya bulunamadı veya sunucu hatası._");
        }

        const isImage = isMediaImage(url);
        const tempPath = getTempPath(isImage ? ".jpg" : ".mp4");
        try {
          await saveToDisk(url, tempPath);
          await message.sendReply({ [isImage ? "image" : "video"]: { url: tempPath } });
        } finally {
          cleanTempFile(tempPath);
        }
      } catch (e) {
        await message.sendReply(`❌ _Pinterest medyası işlenemedi:_ ${e.message}`);
      }
      return;
    }

    // 2. Durum: Kullanıcı Sorgulama (Stalker)
    // Eğer girdi @ ile başlıyorsa veya link değilse ve tek kelimeyse (opsiyonel)
    if (input.startsWith("@") || (!input.includes(" ") && input.length < 32)) {
      const username = input.replace(/^@/, "");
      try {
        const result = await nexGet(`/stalker/pinterest?username=${encodeURIComponent(username)}`);
        if (result && (result.username || result.id)) {
          const caption = `📌 *Pinterest Profili*\n\n` +
            `📛 *İsim:* ${result.full_name || result.name || "-"}\n` +
            `👤 *Kullanıcı:* @${result.username || username}\n` +
            `📝 *Bio:* ${result.bio || "-"}\n` +
            `👥 *Takipçi:* ${result.stats?.followers || result.followers || "0"}\n` +
            `📥 *Takip:* ${result.stats?.following || result.following || "0"}\n` +
            `📌 *Pin Sayısı:* ${result.stats?.pins || result.pins || "0"}\n` +
            `✅ *Onaylı:* ${result.is_verified ? "✅" : "❌"}\n` +
            `🔗 *Profil:* https://pinterest.com/${result.username || username}`;

          const avatar = result.profile_pic_url || result.avatar || result.profile_image_url || result.image || result.thumbnail;
          if (avatar) {
            return await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
          } else {
            return await message.sendReply(caption);
          }
        }
      } catch (e) {
        // Hata durumunda veya kullanıcı bulunamazsa Arama (3. durum) kısmına geçmesi için sessiz kalabiliriz
        // Ama kullanıcı @ kullandıysa profil arıyordur:
        if (input.startsWith("@")) return await message.sendReply("❌ _Kullanıcı bulunamadı veya API hatası._");
      }
    }

    // 3. Durum: Arama (Search)
    let desiredCount = 5;
    let searchQuery = input;
    if (input.includes(",")) {
      const parts = input.split(",");
      searchQuery = parts[0].trim();
      desiredCount = parseInt(parts[1]) || 5;
    }

    try {
      const res = await pinterestSearch(searchQuery, desiredCount);
      if (!res || !res.status || !Array.isArray(res.result)) {
        return await message.sendReply("❌ _Arama sonucu bulunamadı._");
      }

      const searchResults = res.result;
      const toDownload = Math.min(desiredCount, searchResults.length);
      await message.sendReply(`🔍 _Pinterest'te "${searchQuery}" için ${toDownload} sonuç indiriliyor..._`);

      for (const url of searchResults.slice(0, toDownload)) {
        const tempPath = getTempPath(".jpg");
        try {
          await saveToDisk(url, tempPath);
          await message.sendReply({ image: { url: tempPath } });
          await new Promise(r => setTimeout(r, 1000));
        } catch (_) { } finally {
          cleanTempFile(tempPath);
        }
      }
    } catch (err) {
      await message.sendReply(`❌ _Pinterest'te arama yaparken hata oluştu:_ ${err.message}`);
    }
  }
);

Module({
  pattern: "twitter ?(.*)",
  fromMe: false,
  desc: "Twitter (X) videolarını doğrudan bağlantı üzerinden indirir.",
  usage: ".twitter [bağlantı]",
  use: "indirme",
},
  async (message, match) => {
    let videoLink = match[1] !== "" ? match[1] : message.reply_message?.text;
    if (!videoLink) return await message.sendReply("_⚠️ Bir Twitter/X URL'si gerekli_");
    videoLink = videoLink.match(/\bhttps?:\/\/\S+/gi)?.[0];
    if (!videoLink || !/twitter\.com|x\.com/i.test(videoLink))
      return await message.sendReply("_⚠️ Geçerli bir Twitter/X bağlantısı gerekli_");
    try {
      const result = await nexray.downloadTwitter(videoLink);
      if (result?.url) {
        const tempPath = getTempPath(".mp4");
        try {
          await saveToDisk(result.url, tempPath);
          await message.sendReply({ video: { url: tempPath } });
        } finally {
          cleanTempFile(tempPath);
        }
      } else {
        await message.sendReply("_⚠️ Bu bağlantı için indirilebilir medya bulunamadı_");
      }
    } catch (e) {
      console.error("Twitter indirme hatası:", e?.message);
      await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_");
    }
  }
);

Module({
  pattern: "tiktok ?(.*)",
  fromMe: false,
  desc: "TikTok videolarını ve albümlerini (kaydırmalı fotoğrafları) filigransız indirir.",
  usage: ".tiktok [bağlantı]",
  use: "indirme",
},
  async (message, match) => {
    let videoLink = match[1] !== "" ? match[1] : message.reply_message?.text;
    if (!videoLink) return await message.sendReply("_⚠️ Bir TikTok URL'si gerekli_");
    const urls = extractUrls(videoLink);
    if (urls.length > 0 && validateUrl(urls[0], "tiktok")) {
      videoLink = urls[0];
    } else {
      return await message.sendReply("_⚠️ Lütfen geçerli bir TikTok bağlantısı girin._");
    }
    let downloadResult;
    try {
      downloadResult = await tiktok(videoLink);
      if (!downloadResult) {
        const fallback = await nexray.downloadTiktok(videoLink);
        downloadResult = fallback;
      }

      if (downloadResult?.type === "album" && downloadResult?.urls) {
        const imageUrls = downloadResult.urls;

        const tempFiles = [];
        for (const imgUrl of imageUrls) {
          const tempPath = getTempPath(".jpg");
          try {
            await saveToDisk(imgUrl, tempPath);
            tempFiles.push(tempPath);
          } catch (e) {
            console.error("[TikTok fotoğraf]", e?.message);
          }
        }

        if (tempFiles.length === 0) {
          return await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_");
        }

        const quotedMessage = message.reply_message ? message.quoted : message.data;

        if (tempFiles.length === 1) {
          await message.sendReply({ image: { url: tempFiles[0] } }, { quoted: quotedMessage });
        } else {
          const albumObject = tempFiles.map((path, index) => {
            const item = { image: { url: path } };
            if (index === 0) {
              item.caption = `📸 TikTok Albümü (${tempFiles.length} fotoğraf)`;
            }
            return item;
          });
          try {
            await message.client.albumMessage(message.jid, albumObject, quotedMessage);
          } catch (e) {
            for (const path of tempFiles) {
              await message.sendReply({ image: { url: path } });
              await new Promise(r => setTimeout(r, 500));
            }
          }
        }

        for (const path of tempFiles) cleanTempFile(path);
        return;
      }

      if (downloadResult?.url) {
        const tempPath = getTempPath(".mp4");
        try {
          await saveToDisk(downloadResult.url, tempPath);
          await message.sendReply({ video: { url: tempPath } });
        } finally {
          cleanTempFile(tempPath);
        }
      } else {
        await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_");
      }
    } catch (error) {
      try {
        const fallback = await siputGet("/api/d/tiktok", { url: videoLink });
        const r = fallback.data || fallback.result;
        const mediaArr = r?.media;
        if (mediaArr && Array.isArray(mediaArr)) {
          const hdItem = mediaArr.find(m => m.quality === "HD" && m.url);
          const sdItem = mediaArr.find(m => m.quality === "SD" && m.url);
          const videoUrl = hdItem?.url || sdItem?.url;
          if (videoUrl) {
            const tempPath = getTempPath(".mp4");
            try {
              await saveToDisk(videoUrl, tempPath);
              await message.sendReply({ video: { url: tempPath } });
            } finally {
              cleanTempFile(tempPath);
            }
            return;
          }
        }
      } catch (_) { }
      try {
        const fallback = await nexray.downloadTiktok(videoLink);
        if (fallback?.url) {
          const tempPath = getTempPath(".mp4");
          try {
            await saveToDisk(fallback.url, tempPath);
            await message.sendReply({ video: { url: tempPath } });
          } finally {
            cleanTempFile(tempPath);
          }
        } else {
          await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_");
        }
      } catch (_) {
        await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_");
      }
    }
  }
);

Module({
  pattern: "capcut ?(.*)",
  fromMe: false,
  desc: "CapCut şablonlarındaki videoları doğrudan indirmenizi sağlar.",
  usage: ".capcut [bağlantı]",
  use: "indirme",
},
  async (message, match) => {
    let url = match[1] !== "" ? match[1] : message.reply_message?.text;
    if (!url) return await message.sendReply("🎬 _CapCut video/şablon bağlantısı gönderin:_ `.capcut URL`");
    url = url.match(/\bhttps?:\/\/\S+/gi)?.[0];
    if (!url || !url.includes("capcut")) return await message.sendReply("🎬 _Geçerli bir CapCut bağlantısı gönderin_");

    try {
      const r = await nxTry([
        `/downloader/capcut?url=${encodeURIComponent(url)}`,
      ]);
      const video = r.video_url || r.video || r.url || r.download_url;
      if (!video) throw new Error("Video bağlantısı alınamadı");

      const title = r.title || r.name || "CapCut Video";
      const desc = r.description || r.desc || "";
      const usage = r.usage || r.uses || "-";
      let caption = `🎬 *${title}*\n`;
      if (desc) caption += `📝 ${desc}\n`;
      if (usage !== "-") caption += `👤 *Kullanım:* ${fmtCount(usage)}`;

      const tempPath = getTempPath(".mp4");
      try {
        await saveToDisk(video, tempPath);
        await message.client.sendMessage(message.jid, { video: { url: tempPath }, caption }, { quoted: message.data });
      } finally {
        cleanTempFile(tempPath);
      }
    } catch (e) {
      try {
        const fallback = await siputGet("/api/d/capcut", { url });
        const r = fallback.data || fallback.result;
        if (r?.url || r?.video || r?.download) {
          const videoUrl = r.url || r.video || r.download;
          const tempPath = getTempPath(".mp4");
          try {
            await saveToDisk(videoUrl, tempPath);
            await message.client.sendMessage(message.jid, { video: { url: tempPath }, caption: "*CapCut*" }, { quoted: message.data });
          } finally {
            cleanTempFile(tempPath);
          }
          return;
        }
      } catch (_) { }
      await message.sendReply(`🎬 _CapCut videosu indirilemedi:_ ${e.message}`);
    }
  }
);

Module({
  pattern: 'ttara ?(.*)',
  fromMe: false,
  desc: 'TikTok kullanıcı bilgilerini getirir.',
  usage: '.ttara [kullanıcıadı]',
  use: 'search',
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
      if (!input) return await message.sendReply('⚠️ _Lütfen bir TikTok @kullanıcı adı veya profil bağlantısı girin!_\n*Örnekler:*\n.ttara mrbeast\n.ttara @mrbeast');
      const username = extractUsername(input);
      if (!username) return await message.sendReply('❌ _Geçersiz TikTok kullanıcı adı!_');
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
      if (!user) return await message.sendReply('⚠️ _Kullanıcı bulunamadı veya tüm API\'ler şu an erişilemiyor. Lütfen daha sonra tekrar deneyin._');
      let caption = `👤 *Kullanıcı Adı:* @${user.username}\n🆔 *Kullanıcı ID:* ${user.id}\n📝 *İsim:* ${user.name}\n👥 *Takipçi:* ${formatNumber(user.followers)}\n➕ *Takip:* ${formatNumber(user.following)}\n❤️ *Beğeni:* ${formatNumber(user.likes)}\nℹ️ *BİYOGRAFİ*\n_${user.bio || 'Biyografi yok'}_\n` + (user.verified ? '✅ *Doğrulanmış Hesap*\n' : '') + (user.private ? '🔒 *Gizli Hesap*\n' : '') + `\n🔗 *Profil:* https://www.tiktok.com/@${user.username}`;
      if (user.avatar) await message.sendMessage({ url: user.avatar }, 'image', { caption, quoted: message.data });
      else await message.sendReply(caption);
    } catch (error) {
      console.error('[TikTok] Kritik Hata:', error);
      return await message.sendReply('❌ _Bilgiler getirilirken bir hata oluştu. Lütfen daha sonra tekrar deneyin._');
    }
  });