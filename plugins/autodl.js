const { Module } = require("../main");
const config = require("../config");
const { setVar } = require("./manage");
const { downloadGram, pinterestDl, tiktok, fb } = require("./utils");
const { getVideoInfo, downloadAudio, convertM4aToMp3, searchYoutube } = require("./utils/yt");
const nexray = require("./utils/nexray");
const fs = require("fs");
const fromMe = config.isPrivate;

const HANDLER_PREFIX = config.HANDLER_PREFIX;

const URL_PATTERNS = {
  instagram:
    /^https?:\/\/(?:www\.)?instagram\.com\/(?:p\/[A-Za-z0-9_-]+\/?|reel\/[A-Za-z0-9_-]+\/?|tv\/[A-Za-z0-9_-]+\/?|stories\/[A-Za-z0-9_.-]+\/\d+\/?)(?:\?.*)?$/i,
  youtube:
    /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/[A-Za-z0-9_-]+\/?)|youtu\.be\/)([A-Za-z0-9_-]{11})?(?:[\?&].*)?$/i,
  spotify:
    /^https?:\/\/(?:open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]+(?:\?.*)?$/i,
  tiktok:
    /^https?:\/\/(?:www\.)?(?:tiktok\.com\/@?[A-Za-z0-9_.-]+\/video\/\d+|vm\.tiktok\.com\/[A-Za-z0-9_-]+\/?|vt\.tiktok\.com\/[A-Za-z0-9_-]+\/?|v\.tiktok\.com\/[A-Za-z0-9_-]+\/?)(?:\?.*)?$/i,
  pinterest:
    /^https?:\/\/(?:www\.)?(?:pinterest\.com\/(?:pin\/\d+\/?[A-Za-z0-9_-]*)\/?|pin\.it\/[A-Za-z0-9_-]+\/?)(?:\?.*)?$/i,
  twitter:
    /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com|mobile\.twitter\.com)\/[A-Za-z0-9_]{1,15}\/status\/\d+(?:\?.*)?$/i,
  facebook:
    /^https?:\/\/(?:www\.)?(?:fb\.watch\/[A-Za-z0-9_-]+\/?|(?:facebook\.com|m\.facebook\.com)\/(?:(?:watch(?:\/?|\?v=))|(?:.*\/videos?\/\d+)|(?:video\.php\?v=\d+)|(?:.*\/posts\/\d+))(?:[\s\S]*)?)$/i,
};

function getFirstUrl(text) {
  if (!text) return null;
  const urlMatch = text.match(/https?:\/\/\S+/i);
  if (!urlMatch) return null;
  return urlMatch[0].replace(/[)\]\.,!?>]*$/, "");
}

function getAllUrls(text) {
  if (!text) return [];
  const urlMatches = text.match(/https?:\/\/\S+/gi);
  if (!urlMatches) return [];
  return urlMatches.map((url) => url.replace(/[)\]\.,!?>]*$/, ""));
}

function detectPlatform(url) {
  for (const [platform, re] of Object.entries(URL_PATTERNS)) {
    if (re.test(url)) return platform;
  }
  return null;
}

function isAlreadyCommand(text) {
  text = text?.toLowerCase()?.trim();
  if (!text) return false;
  const regex =
    /(insta\s|instah|story\s|storyh|tiktok\s|tiktokh|pinterest\s|pinteresth|twitter\s|twitterh|fb\s|fbh|play\s|playh|ytv\s|ytvh|yta\s|ytah|spotify\s|spotifyh)/;
  return regex.test(text);
}

const { bytesToSize: formatBytes } = require("./utils");

Module({ on: "text", fromMe }, async (message) => {
  try {
    if (message.fromBot) return;
    const chatJid = message.jid;
    const isGroup = chatJid.includes("@g.us");
    const autodlEnabledForChat = (() => {
      try {
        const enabledList = config.AUTODL || "";
        const enabled = enabledList
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (enabled.includes(chatJid)) return true;
        if (isGroup && config.AUTODL_ALL_GROUPS === "true") return true;
        if (!isGroup && config.AUTODL_ALL_DMS === "true") return true;
        return false;
      } catch (e) {
        return false;
      }
    })();
    if (!autodlEnabledForChat) return;
    let text = message.text || "";
    if (isAlreadyCommand(text)) return;

    const urls = getAllUrls(text);
    if (!urls.length) return;

    // group urls by platform
    const platformGroups = {};
    const unsupportedUrls = [];

    for (const url of urls) {
      const platform = detectPlatform(url);
      if (!platform) {
        unsupportedUrls.push(url);
      } else {
        if (!platformGroups[platform]) platformGroups[platform] = [];
        platformGroups[platform].push(url);
      }
    }

    if (!Object.keys(platformGroups).length) return;

    await message.react("⬇️");

    try {
      // handle youtube separately (only process first url for yt)
      if (platformGroups["youtube"]) {
        let url = platformGroups["youtube"][0];

        // Convert YouTube Shorts URL to regular watch URL if needed
        if (url.includes("youtube.com/shorts/")) {
          const shortId = url.match(
            /youtube\.com\/shorts\/([A-Za-z0-9_-]+)/
          )?.[1];
          if (shortId) {
            url = `https://www.youtube.com/watch?v=${shortId}`;
          }
        }

        const lowerText = text.toLowerCase();
        const isAudioMode =
          /\baudio\b|\bmp3\b/.test(lowerText) && !isAlreadyCommand(text);

        try {
          // if message contains "audio" or "mp3", download as audio
          if (isAudioMode) {
            let downloadMsg;
            let audioPath;

            try {
              downloadMsg = await message.sendReply("_⬇️ Ses indiriliyor..._");
              const result = await downloadAudio(url);
              audioPath = result.path;

              const mp3Path = await convertM4aToMp3(audioPath);
              audioPath = mp3Path;

              await message.edit(
                "_Ses gönderiliyor..._",
                message.jid,
                downloadMsg.key
              );

              const stream = fs.createReadStream(audioPath);
              await message.sendMessage({ stream }, "document", {
                fileName: `${result.title}.m4a`,
                mimetype: "audio/mp4",
                caption: `_*${result.title}*_`,
              });
              stream.destroy();

              await message.edit(
                "_İndirme tamamlandı!_",
                message.jid,
                downloadMsg.key
              );

              await new Promise((resolve) => setTimeout(resolve, 100));
              if (fs.existsSync(audioPath)) {
                fs.unlinkSync(audioPath);
              }
            } catch (error) {
              if (config.DEBUG)
                console.error("[Otomatik İndirme YT Ses]", error?.message || error);
              if (downloadMsg) {
                await message.edit(
                  "_❌ İndirme başarısız!_",
                  message.jid,
                  downloadMsg.key
                );
              } else {
                await message.sendReply("_❌ İndirme başarısız oldu. Lütfen tekrar deneyin._");
              }

              if (audioPath && fs.existsSync(audioPath)) {
                fs.unlinkSync(audioPath);
              }
            }
            return;
          }

          // else download video with quality selection
          const info = await getVideoInfo(url);
          const videoFormats = info.formats
            .filter((f) => f.type === "video" && f.quality)
            .sort((a, b) => {
              const getRes = (q) => {
                const match = q.match(/(\d+)/);
                return match ? parseInt(match[1]) : 0;
              };
              return getRes(b.quality) - getRes(a.quality);
            });

          const uniqueQualities = [
            ...new Set(videoFormats.map((f) => f.quality)),
          ];

          const videoIdMatch = url.match(
            /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([^&\s/?]+)/
          );
          const videoId = videoIdMatch ? videoIdMatch[1] : info.videoId || "";

          let qualityText = "_*Video Kalitesini Seçin*_\n\n";
          qualityText += `_*${info.title}*_\n\n(${videoId})\n\n`;

          if (uniqueQualities.length === 0) {
            await message.react("❌");
            return;
          }

          uniqueQualities.forEach((quality, index) => {
            const format = videoFormats.find((f) => f.quality === quality);
            const audioFormat = info.formats.find((f) => f.type === "audio");

            let sizeInfo = "";
            if (format.size && audioFormat?.size) {
              const parseSize = (sizeStr) => {
                const match = sizeStr.match(/([\d.]+)\s*(KB|MB|GB)/i);
                if (!match) return 0;
                const value = parseFloat(match[1]);
                const unit = match[2].toUpperCase();
                if (unit === "KB") return value * 1024;
                if (unit === "MB") return value * 1024 * 1024;
                if (unit === "GB") return value * 1024 * 1024 * 1024;
                return value;
              };

              const videoSize = parseSize(format.size);
              const audioSize = parseSize(audioFormat.size);
              const totalSize = videoSize + audioSize;

              if (totalSize > 0) {
                sizeInfo = ` ~ _${formatBytes(totalSize)}_`;
              }
            }

            qualityText += `*${index + 1}.* _*${quality}*_${sizeInfo}\n`;
          });

          const audioFormat = info.formats.find((f) => f.type === "audio");
          if (audioFormat) {
            let audioSizeInfo = "";
            if (audioFormat.size) {
              const parseSize = (sizeStr) => {
                const match = sizeStr.match(/([\d.]+)\s*(KB|MB|GB)/i);
                if (!match) return 0;
                const value = parseFloat(match[1]);
                const unit = match[2].toUpperCase();
                if (unit === "KB") return value * 1024;
                if (unit === "MB") return value * 1024 * 1024;
                if (unit === "GB") return value * 1024 * 1024 * 1024;
                return value;
              };
              const audioSize = parseSize(audioFormat.size);
              if (audioSize > 0) {
                audioSizeInfo = ` ~ _${formatBytes(audioSize)}_`;
              }
            }
            qualityText += `*${uniqueQualities.length + 1}.* 🎵 _*Sadece Ses*_${audioSizeInfo}\n`;
          }

          qualityText += "\n_İndirmek için bir numara ile yanıtlayın_";
          await message.sendReply(qualityText);
        } catch (err) {
          if (config.DEBUG) console.error("[Otomatik İndirme YT]", err?.message || err);
          await message.react("❌");
        }
        return;
      }

      // handle instagram (multiple urls support)
      if (platformGroups["instagram"]) {
        const allMediaUrls = [];
        const quotedMessage = message.reply_message
          ? message.quoted
          : message.data;

        for (const url of platformGroups["instagram"]) {
          try {
            let downloadResult = await downloadGram(url);
            if (!downloadResult || !downloadResult.length) {
              downloadResult = await nexray.downloadInstagram(url);
            }
            if (downloadResult && downloadResult.length) {
              allMediaUrls.push(...downloadResult);
            }
          } catch (err) {
            if (config.DEBUG) console.error("[Otomatik İndirme IG]", err?.message || err);
            try {
              const fallback = await nexray.downloadInstagram(url);
              if (fallback?.length) allMediaUrls.push(...fallback);
            } catch (_) {}
          }
        }

        if (!allMediaUrls.length) {
          await message.react("❌");
          return;
        }

        if (allMediaUrls.length === 1) {
          await message.sendMessage(
            { url: allMediaUrls[0] },
            /\.(jpg|jpeg|png|webp|heic)(\?|$)/i.test(allMediaUrls[0])
              ? "image"
              : "video",
            { quoted: quotedMessage }
          );
        } else {
          const albumObject = allMediaUrls.map((mediaUrl) => {
            return /\.(jpg|jpeg|png|webp|heic)(\?|$)/i.test(mediaUrl)
              ? { image: mediaUrl }
              : { video: mediaUrl };
          });
          await message.client.albumMessage(
            message.jid,
            albumObject,
            message.data
          );
        }
        return;
      }

      // handle tiktok (only process first url for now - api limitation)
      if (platformGroups["tiktok"]) {
        try {
          let downloadResult = await tiktok(platformGroups["tiktok"][0]);
          if (!downloadResult) {
            const fallback = await nexray.downloadTiktok(platformGroups["tiktok"][0]);
            downloadResult = fallback?.url ? { url: fallback.url } : null;
          }
          if (downloadResult) {
            await message.sendReply(downloadResult, "video");
          } else {
            await message.react("❌");
          }
        } catch (err) {
          if (config.DEBUG)
            console.error("[Otomatik İndirme TikTok]", err?.message || err);
          try {
            const fallback = await nexray.downloadTiktok(platformGroups["tiktok"][0]);
            if (fallback?.url) {
              await message.sendReply({ url: fallback.url }, "video");
            } else {
              await message.react("❌");
            }
          } catch (_) {
            await message.react("❌");
          }
        }
        return;
      }

      // handle pinterest (multiple urls support)
      if (platformGroups["pinterest"]) {
        const allMediaUrls = [];
        const quotedMessage = message.reply_message
          ? message.quoted
          : message.data;

        for (const url of platformGroups["pinterest"]) {
          try {
            let pinterestResult = await pinterestDl(url);
            let mediaUrl = pinterestResult?.status && pinterestResult?.result ? pinterestResult.result : null;
            if (!mediaUrl) {
              mediaUrl = await nexray.downloadPinterest(url);
            }
            if (mediaUrl) allMediaUrls.push(mediaUrl);
          } catch (err) {
            if (config.DEBUG)
              console.error("[Otomatik İndirme Pinterest]", err?.message || err);
            try {
              const fallback = await nexray.downloadPinterest(url);
              if (fallback) allMediaUrls.push(fallback);
            } catch (_) {}
          }
        }

        if (!allMediaUrls.length) {
          await message.react("❌");
          return;
        }

        if (allMediaUrls.length === 1) {
          await message.sendMessage({ url: allMediaUrls[0] }, "video", {
            quoted: quotedMessage,
          });
        } else {
          const albumObject = allMediaUrls.map((mediaUrl) => {
            return { video: mediaUrl };
          });
          await message.client.albumMessage(
            message.jid,
            albumObject,
            message.data
          );
        }
        return;
      }

      // handle facebook (only process first url for now)
      if (platformGroups["facebook"]) {
        try {
          let result = await fb(platformGroups["facebook"][0]);
          if (!result?.url) {
            result = await nexray.downloadFacebook(platformGroups["facebook"][0]);
          }
          if (result?.url) {
            await message.sendReply({ url: result.url }, "video");
          } else {
            await message.react("❌");
          }
        } catch (err) {
          if (config.DEBUG) console.error("[Otomatik İndirme FB]", err?.message || err);
          try {
            const fallback = await nexray.downloadFacebook(platformGroups["facebook"][0]);
            if (fallback?.url) {
              await message.sendReply({ url: fallback.url }, "video");
            } else {
              await message.react("❌");
            }
          } catch (_) {
            await message.react("❌");
          }
        }
        return;
      }

      // handle spotify (only process first url for now)
      if (platformGroups["spotify"]) {
        let downloadMsg;
        let audioPath;

        try {
          downloadMsg = await message.sendReply("_⏳ Spotify bilgileri alınıyor..._");
          // nexray.downloadSpotify ile doğrudan ses URL'si al
          const spotifyInfo = await nexray.downloadSpotify(platformGroups["spotify"][0]);
          if (!spotifyInfo?.url) throw new Error("Spotify indirme başarısız");

          const { title = "Spotify", artist = "", url: audioUrl } = spotifyInfo;
          await message.edit(
            `_*${title}* - *${artist}* indiriliyor..._`,
            message.jid,
            downloadMsg.key
          );

          await message.edit("_📤 Ses gönderiliyor..._", message.jid, downloadMsg.key);
          await message.sendReply({ url: audioUrl }, "audio", { mimetype: "audio/mpeg" });
          await message.edit("_✅ İndirme tamamlandı!_", message.jid, downloadMsg.key);
          return;
        } catch (err) {
          if (config.DEBUG)
            console.error("[Otomatik İndirme Spotify]", err?.message || err);
          try {
            const fallback = await nexray.downloadSpotify(platformGroups["spotify"][0]);
            if (fallback?.url) {
              if (!downloadMsg) downloadMsg = await message.sendReply("_⬇️ Yedek yöntemle indiriliyor..._");
              await message.edit("_📤 Ses gönderiliyor..._", message.jid, downloadMsg.key);
              await message.sendReply({ url: fallback.url }, "audio");
              await message.edit("_✅ İndirme tamamlandı!_", message.jid, downloadMsg.key);
              return;
            }
          } catch (_) {}
          if (downloadMsg) {
            await message.edit("_❌ İndirme başarısız!_", message.jid, downloadMsg.key);
          } else {
            await message.sendReply("_❌ İndirme başarısız oldu. Lütfen tekrar deneyin._");
          }

          if (audioPath && fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
          }
        }
        return;
      }

      // handle twitter
      if (platformGroups["twitter"]) {
        try {
          const result = await nexray.downloadTwitter(platformGroups["twitter"][0]);
          if (result?.url) {
            await message.sendReply({ url: result.url }, "video");
          } else {
            await message.react("❌");
          }
        } catch (err) {
          if (config.DEBUG) console.error("[Otomatik İndirme Twitter]", err?.message || err);
          await message.react("❌");
        }
        return;
      }
    } catch (err) {
      if (config.DEBUG) console.error("[Otomatik İndirme]", err?.message || err);
      await message.react("❌");
    }
  } catch (err) {
    if (config.DEBUG) console.error("[Otomatik İndirme]", err?.message || err);
  }
});

Module(
  {
    pattern: "otodl ?(.*)",
    fromMe: true,
    desc: "URL izleyici otomatik indirme - sohbetlerde veya küresel olarak etkinleştirin",
    usage:
      ".otodl - menüyü göster\n.otodl aç/kapat - Mevcut sohbette etkinleştir/devre dışı bırak\n.otodl aç/kapat gruplar - Tüm gruplarda etkinleştir/devre dışı bırak\n.otodl aç/kapat dms - Tüm DM'lerde etkinleştir/devre dışı bırak\n.otodl durum - Mevcut durumu göster",
  },
  async (message, match) => {
    const input = match[1]?.trim();
    const chatJid = message.jid;

    const readList = () => {
      try {
        const list = config.AUTODL || "";
        return list
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } catch (e) {
        return [];
      }
    };

    if (!input) {
      const enabledList = readList();
      const enabled = enabledList.includes(chatJid);
      const globalGroups = config.AUTODL_ALL_GROUPS === "true";
      const globalDMs = config.AUTODL_ALL_DMS === "true";

      return await message.sendReply(`*_✨ ⬇️ Otomatik İndirme Yöneticisi_*\n\n` +
          `- _Mevcut sohbet:_ ${chatJid.includes("@g.us") ? "Grup" : "DM"}\n` +
          `- _Durum:_ ${enabled ? "Açık ✅" : "Kapalı ❌"}\n` +
          `- _Genel Gruplar:_ ${
            globalGroups ? "Açık ✅" : "Kapalı ❌"
          }\n` +
          `- _Genel DM'ler:_ ${globalDMs ? "Açık ✅" : "Kapalı ❌"}\n\n` +
          `_Komutlar:_\n` +
          `- \`${HANDLER_PREFIX}otodl aç/kapat\` - Mevcut sohbette ayarla\n` +
          `- \`${HANDLER_PREFIX}otodl aç/kapat gruplar\` - Tüm gruplarda ayarla\n` +
          `- \`${HANDLER_PREFIX}otodl aç dm\` - Tüm DM'lerde ayarla\n` +
          `- \`${HANDLER_PREFIX}otodl kapat dm\` - Tüm DM'lerde kapat\n` +
          `- \`${HANDLER_PREFIX}otodl durum\` - Detaylı durumu göster`
      );
    }

    const parts = input.split(" ");
    const cmd = parts[0].toLowerCase();
    const target = parts[1]?.toLowerCase();

    if (cmd === "aç" || cmd === "on") {
      if (target === "gruplar") {
        await setVar("AUTODL_ALL_GROUPS", "true");
        return await message.sendReply("_✅ Tüm gruplarda AutoDL aktif_\n_Kapatmak için .otodl kapat gruplar kullanın_"
        );
      } else if (target === "dm") {
        await setVar("AUTODL_ALL_DMS", "true");
        return await message.sendReply("_✅ Tüm DM'lerde AutoDL aktif_\n_Kapatmak için .otodl kapat dms kullanın_"
        );
      } else {
        const enabledList = readList();
        if (!enabledList.includes(chatJid)) enabledList.push(chatJid);
        await setVar("AUTODL", enabledList.join(","));
        return await message.sendReply("_✅ Bu sohbette AutoDL aktif ✅_\n_Otomatik indirme için desteklenen bir URL gönderin_"
        );
      }
    }

    if (cmd === "kapat" || cmd === "off") {
      if (target === "gruplar") {
        await setVar("AUTODL_ALL_GROUPS", "false");
        return await message.sendReply("_✨ Tüm gruplarda AutoDL devre dışı ❌_\n_Açmak için .otodl aç gruplar kullanın_"
        );
      } else if (target === "dm") {
        await setVar("AUTODL_ALL_DMS", "false");
        return await message.sendReply("_✨ Tüm DM'lerde AutoDL devre dışı ❌_\n_Açmak için .otodl aç dms kullanın_"
        );
      } else {
        const enabledList = readList().filter((x) => x !== chatJid);
        await setVar("AUTODL", enabledList.join(","));
        return await message.sendReply("_✨ Bu sohbette AutoDL devre dışı ❌_\n_Tekrar açmak için .otodl aç kullanın_"
        );
      }
    }

    if (cmd === "durum" || cmd === "status") {
      const enabledList = readList();
      const globalGroups = config.AUTODL_ALL_GROUPS === "true";
      const globalDMs = config.AUTODL_ALL_DMS === "true";
      return await message.sendReply(`*_✨ Otomatik İndirme Durumu_*\n\n` +
          `• _Aktif sohbetler:_ ${
            enabledList.length > 0 ? enabledList.join(", ") : "Yok"
          }\n` +
          `• _Genel Gruplar:_ ${
            globalGroups ? "Açık ✅" : "Kapalı ❌"
          }\n` +
          `• _Genel DM'ler:_ ${globalDMs ? "Açık ✅" : "Kapalı ❌"}`
      );
    }

    return await message.sendReply(`_Bilinmeyen seçenek: ${cmd}_`);
  }
);
