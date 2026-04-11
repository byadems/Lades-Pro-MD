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

    // extract all urls from the text
    const allUrls = extractUrls(mediaLinks);
    if (!allUrls.length)
      return await message.sendReply("_*⚠️ Instagram bağlantı(lar)ı gerekli*_");

    // filter and validate instagram urls
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
        if (mediaId && mediaId.length > 20) continue; // skip private accounts

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

      // download from all urls
      for (const url of instagramUrls) {
        let found = false;

        // 1. Nexray v2
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

        // 2. Nexray v1
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

        // 3. Siputzx - sssinstagram
        if (!found) {
          try {
            const fallback = await siputGet("/api/d/sssinstagram", { url });
            const r = fallback.result || fallback.data;
            
            // POST/PHOTO: data: [{ url: [...] }]
            // REEL/VIDEO: data: { url: [...] }
            
            // Check object format first (for reel/video)
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
            
            // Check array format (for post/photo)
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

        // 4. Siputzx - igram
        if (!found) {
          try {
            const fallback = await siputGet("/api/d/igram", { url });
            const r = fallback.result || fallback.data;
            // Format: data[{ node: { media: { edges: [{ node: { display_url } }] } } }]
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

        // 5. Siputzx - fastdl
        if (!found) {
          try {
            const fallback = await siputGet("/api/d/fastdl", { url });
            const r = fallback.result || fallback.data;
            
            // POST/PHOTO: data: [{ url: [...] }]
            // REEL/VIDEO: data: { url: [...] }
            
            // Check object format first (for reel/video)
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
            
            // Check array format (for post/photo)
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

      // Check if total album size or count is too large to prevent crashes
      if (allMediaUrls.length > 10) {
        return await message.sendReply("_⚠️ Albüm çok fazla medya içeriyor (Maksimum 10)._");
      }

      const tempFiles = [];
      try {
        // Download all media to temp files
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

        // Send as album
        const albumObject = tempFiles.map((file, index) => {
          const item = { [file.isImage ? "image" : "video"]: { url: file.path } };
          // Albüm başlığı (Caption) genellikle ilk veya son öğeye eklenir
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
        // CLEANUP
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
      return await message.sendReply("_❌ Lütfen geçerli bir Facebook bağlantısı girin._");
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
      // Fallback: Siputzx API
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
  pattern: "igara ?(.*)",
  fromMe: false,
  desc: "Bir Instagram kullanıcısının profil detaylarını ve istatistiklerini gösterir.",
  usage: ".igara [kullanıcıadı]",
  use: "araçlar",
},
  async (message, match) => {
    const user = (match[1] || "").trim().replace(/^@/, "");
    if (!user) return await message.sendReply("📸 _Kullanıcı adı girin:_ `.igara kullanıcıadı`");
    try {
      const r = await nxTry([
        `/stalker/instagram?username=${encodeURIComponent(user)}`,
      ]);
      const full = r.full_name || r.fullname || r.name || user;
      const bio = r.biography || r.bio || "-";
      const followers = r.follower_count ?? r.followers ?? "-";
      const following = r.following_count ?? r.following ?? "-";
      const posts = r.media_count ?? r.posts ?? "-";
      const priv = r.is_private ? "🔒 Gizli" : "🌐 Açık";
      const verified = r.is_verified ? "✅" : "❌";
      const avatar = r.profile_pic_url || r.profile_pic || r.avatar || r.profile?.avatar;

      const caption =
        `📸 *Instagram Profili*\n\n` +
        `👤 *Ad:* ${full}\n` +
        `🔑 *Kullanıcı:* @${user}\n` +
        `📝 *Bio:* ${bio}\n` +
        `👥 *Takipçi:* ${fmtCount(followers)}\n` +
        `➡️ *Takip:* ${fmtCount(following)}\n` +
        `📷 *Gönderi:* ${posts}\n` +
        `🔐 *Hesap:* ${priv}\n` +
        `✅ *Doğrulanmış:* ${verified}`;

      if (avatar) {
        await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
      } else {
        await message.sendReply(caption);
      }
    } catch (e) {
      const msg = e.message.includes("429") ? "⚠️ _Instagram yoğunluk nedeniyle cevap vermiyor, lütfen biraz sonra tekrar deneyin._" : `❌ _Instagram profili alınamadı:_ ${e.message}`;
      await message.sendReply(msg);
    }
  }
);

Module({
  pattern: "twara ?(.*)",
  fromMe: false,
  desc: "Bir Twitter/X kullanıcısının profil detaylarını ve istatistiklerini gösterir.",
  usage: ".twara [kullanıcıadı]",
  use: "araçlar",
},
  async (message, match) => {
    const user = (match[1] || "").trim().replace(/^@/, "");
    if (!user) return await message.sendReply("🐦 _Kullanıcı adı giriniz:_ `.twara kullanıcı adı`");
    try {
      const r = await nxTry([
        `/stalker/twitter?username=${encodeURIComponent(user)}`,
      ]);
      const name = r.name || user;
      const bio = r.description || r.bio || r.signature || "-";
      const stats = r.stats || {};
      const followers = stats.followers ?? r.followers_count ?? r.followers ?? "-";
      const following = stats.following ?? r.friends_count ?? r.following ?? "-";
      const tweets = stats.tweets ?? r.statuses_count ?? r.tweets ?? "-";
      const likes = stats.likes ?? r.favourites_count ?? "-";
      const verified = r.verified ? "✅" : "❌";
      const avatar = r.profile?.avatar || r.avatar || r.profile_image_url;

      const caption =
        `🐦 *X/Twitter Profili*\n\n` +
        `👤 *Ad:* ${name}\n` +
        `🔑 *Kullanıcı:* @${user}\n` +
        `📝 *Biyografi:* ${bio}\n` +
        `👥 *Takipçi:* ${fmtCount(followers)}\n` +
        `➡️ *Takip:* ${fmtCount(following)}\n` +
        `🐦 *Tweet:* ${fmtCount(tweets)}\n` +
        `❤️ *Beğeni:* ${fmtCount(likes)}\n` +
        `✅ *Doğrulanmış mı?:* ${verified}`;

      if (avatar) {
        await message.client.sendMessage(message.jid, { image: { url: avatar }, caption }, { quoted: message.data });
      } else {
        await message.sendReply(caption);
      }
    } catch (e) {
      await message.sendReply(`❌ _X profiline ulaşamadım:_ ${e.message}`);
    }
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
      return await message.sendReply("*_❌ Üzgünüm, sunucu hatası_*");
    }
    if (!storyData || !storyData.length)
      return await message.sendReply("*_❌ Bulunamadı!_*");

    // Mükerrer URL'leri temizle
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
  desc: "Pinterest üzerindeki resim veya videoları arar ve indirir.",
  usage: ".pinterest [sorgu/bağlantı]",
  use: "indirme",
},
  async (message, match) => {
    let userQuery = (match[1] || message.reply_message?.text || "").trim();
    if (userQuery === "g") return;
    if (!userQuery)
      return await message.sendReply("_⚠️ Arama terimi veya video bağlantısı gerekli_");

    const urls = extractUrls(userQuery);
    if (urls.length > 0) {
      userQuery = urls[0];
      try {
        const url = await nexray.downloadPinterest(userQuery);
        if (!url) {
          // Fallback: Siputzx API
          try {
            const fallback = await siputGet("/api/d/pinterest", { url: userQuery });
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
          return await message.sendReply("_❌ Bu bağlantı için indirilebilir medya bulunamadı veya sunucu cevap vermiyor_");
        }

        const isImage = isMediaImage(url);

        const quotedMessage = message.reply_message ? message.quoted : message.data;
        const tempPath = getTempPath(isImage ? ".jpg" : ".mp4");

        try {
          await saveToDisk(url, tempPath);
          const sendContent = { [isImage ? "image" : "video"]: { url: tempPath } };
          if (!isImage) {
            const dims = readMp4Dimensions(tempPath);
            if (dims) Object.assign(sendContent, dims);
          }
          await message.sendReply(
            sendContent,
            { quoted: quotedMessage }
          );
        } finally {
          cleanTempFile(tempPath);
        }
      } catch (e) {
        console.error("Pinterest İşlem Hatası:", e.message);
        await message.sendReply(`_❌ Pinterest medyası işlenirken bir hata oluştu._\n_Hata: ${e.message}_`);
      }


    } else {

      let desiredCount = parseInt(userQuery.split(",")[1]) || 5;
      let searchQuery = userQuery.split(",")[0] || userQuery;
      let searchResults;
      try {
        const res = await pinterestSearch(searchQuery, desiredCount);
        if (!res || !res.status || !Array.isArray(res.result)) {
          return await message.sendReply("_❌ Bu sorgu için sonuç bulunamadı_");
        }
        searchResults = res.result;
      } catch (err) {
        console.error("Pinterest arama hatası:", err?.message || err);
        return await message.sendReply("_❌ Pinterest'te arama yaparken sunucu hatası_"
        );
      }

      const toDownload = Math.min(desiredCount, searchResults.length);
      await message.sendReply(
        `_Pinterest'ten ${searchQuery} için ${toDownload} sonuç indiriliyor_`
      );

      const toDownloadUrls = searchResults.slice(0, toDownload);
      for (const url of toDownloadUrls) {
        const tempPath = getTempPath(".jpg");
        try {
          await saveToDisk(url, tempPath);
          await message.sendReply({ image: { url: tempPath } });
          await new Promise(r => setTimeout(r, 1000));
        } catch (error) {
          console.error("Pinterest öğesi indirilemedi:", error?.message || error);
        } finally {
          cleanTempFile(tempPath);
        }
      }
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
  desc: "TikTok videolarını filigransız (yazısız) bir şekilde indirir.",
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
      return await message.sendReply("_❌ Lütfen geçerli bir TikTok bağlantısı girin._");
    }
    try {
      const downloadResult = await nexray.downloadTiktok(videoLink);
      if (downloadResult?.url) {
        const tempPath = getTempPath(".mp4");
        try {
          await saveToDisk(downloadResult.url, tempPath);
          const sendContent = { video: { url: tempPath } };
          if (downloadResult.title) {
            sendContent.caption = `🎵 ${downloadResult.title}`;
          }
          await message.sendReply(sendContent);
        } finally {
          cleanTempFile(tempPath);
        }
      } else {
        await message.sendReply("_⚠️ Video bulunamadı, Lütfen tekrar deneyin!_");
      }
    } catch (error) {
      console.error("TikTok indirme hatası:", error?.message);
      await message.sendReply("_⚠️ Bir şeyler ters gitti, Lütfen tekrar deneyin!_");
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
      if (usage !== "-") caption += `📈 *Kullanım:* ${fmtCount(usage)}`;

      const tempPath = getTempPath(".mp4");
      try {
        await saveToDisk(video, tempPath);
        await message.client.sendMessage(message.jid, { video: { url: tempPath }, caption }, { quoted: message.data });
      } finally {
        cleanTempFile(tempPath);
      }
    } catch (e) {
      // Fallback: Siputzx API
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
      await message.sendReply(`❌ _CapCut videosu indirilemedi:_ ${e.message}`);
    }
  }
);

function extractTikTokUsername(input) {
  if (!input) return null;
  input = input.trim();
  if (input.startsWith('@')) {
    return input.slice(1).toLowerCase();
  }
  if (/^[a-zA-Z0-9._]{2,24}$/.test(input)) {
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
  pattern: 'ttara ?(.*)',
  fromMe: false,
  desc: 'Gizli hesap olmayan bir TikTok kullanıcısının profil detaylarını ve istatistiklerini gösterir.',
  usage: '.ttara [kullanıcıadı]',
  use: "araçlar",
},
  async (message, match) => {
    try {
      let input = (match?.[1] || '').trim();
      if (!input) {
        input = message.reply_message?.text || message.reply_message?.caption || '';
        input = input.trim();
      }
      if (!input) {
        return await message.sendReply(
          '⚠ _Lütfen bir TikTok @kullanıcı adı veya profil bağlantısı girin! (Gizli hesaplar hariç)_\n' +
          '*Örnekler:*\n' +
          '.ttara lades\n' +
          '.ttara @lades\n' +
          '.ttara https://www.tiktok.com/@lades'
        );
      }
      const username = extractTikTokUsername(input);
      if (!username) {
        return await message.sendReply('❌ _Geçersiz TikTok kullanıcı adı!_');
      }
      const response = await axios.get(
        `https://api.princetechn.com/api/stalk/tiktokstalk?apikey=prince&username=${encodeURIComponent(username)}`
      );
      const data = response.data;
      if (!data || data.status !== 200 || !data.result) {
        return await message.sendReply('⚠ _Kullanıcı bulunamadı!_');
      }
      const user = data.result;
      let caption = `👤 Kullanıcı Adı: *@${user.username || 'Bilinmiyor'}*\n`;
      caption += `🆔 Kullanıcı ID: *${user.id || 'Bilinmiyor'}*\n`;
      caption += `📝 İsim: *${user.name || 'Bilinmiyor'}*\n`;
      caption += `👥 Takipçi: *${user.followers}*\n`;
      caption += `➕ Takip: *${user.following}*\n`;
      caption += `❤️ Beğeni: *${user.likes}*\n\n`;
      caption += 'ℹ️ BİYOGRAFİ\n';
      caption += `*${user.bio || 'Biyografi yok'}*\n\n`;
      if (user.verified) caption += '✅ *Doğrulanmış Hesap*\n';
      if (user.private) caption += '🔒 *Gizli Hesap*\n';
      if (user.verified || user.private) caption += '\n';
      caption += `🔗 *Profil:* https://www.tiktok.com/@${user.username}`;
      if (user.avatar) {
        await message.sendMessage({ url: user.avatar }, 'image', { caption, quoted: message.data });
      } else {
        await message.sendReply(caption);
      }
    } catch (error) {
      console.error('TikTok Arama Hatası:', error);
      return await message.sendReply('❌ _Bilgiler getirilirken bir hata oluştu!_');
    }
  }
);


