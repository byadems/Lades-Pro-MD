"use strict";

/**
 * Merged Module: download.js
 * Components: autodl.js, social.js, youtube.js, siputzx-dl.js
 */

// ==========================================
// FILE: autodl.js
// ==========================================
(function () {
  const { Module } = require("../main");
  const config = require("../config");
  const { setVar } = require('./yonetim_araclari');
  const { downloadGram, pinterestDl, tiktok, fb } = require("./utils");
  const { getVideoInfo, downloadAudio, convertM4aToMp3, searchYoutube } = require('./utils/youtube_araclari');
  const { saveToDisk, getTempPath, cleanTempFile, isMediaImage, readMp4Dimensions } = require("../core/yardimcilar");
  const nexray = require('./utils/nexray_api');
  const axios = require("axios");
  const fs = require("fs");

  const SIPUTZX_BASE = "https://api.siputzx.my.id";

  async function siputGet(path, params = {}) {
    const url = `${SIPUTZX_BASE}${path}`;
    const res = await axios.get(url, { params, timeout: 30000, validateStatus: () => true });
    if (res.data && res.data.status) return res.data;
    throw new Error(res.data?.error || "API yanıt vermedi");
  }
  const fromMe = config.isPrivate;

  const HANDLER_PREFIX = config.HANDLER_PREFIX;

  const URL_PATTERNS = {
    instagram:
      /^https?:\/\/(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/(?:p\/([A-Za-z0-9_-]+)|reel\/([A-Za-z0-9_-]+)|reels\/([A-Za-z0-9_-]+)|tv\/([A-Za-z0-9_-]+)|stories\/([A-Za-z0-9._]+)\/([0-9]+)|stories\/highlights\/([0-9]+)|([A-Za-z0-9._]+)\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)|([A-Za-z0-9._]+)\/?)\/?(?:\?.*)?$/i,
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
    if (!text || typeof text !== 'string') return null;
    const urlMatch = text.match(/https?:\/\/\S+/i);
    if (!urlMatch) return null;
    return urlMatch[0].replace(/[)\]\.,!?>]*$/, "");
  }

  function getAllUrls(text) {
    if (!text || typeof text !== 'string') return [];
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

  Module({
    on: "text",
    fromMe,
  },
    async (message) => {
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
                  downloadMsg = await message.sendReply("_🔻 Ses indiriliyor..._");
                  const result = await downloadAudio(url);
                  audioPath = result.path;

                  const mp3Path = await convertM4aToMp3(audioPath);
                  audioPath = mp3Path;

                  await message.edit(
                    "🔺 _Ses gönderiliyor..._",
                    message.jid,
                    downloadMsg.key
                  );

                  const stream = fs.createReadStream(audioPath);
                  await message.sendMessage({ stream }, "document", {
                    fileName: `${result.title}.m4a`,
                    mimetype: "audio/mpeg",
                    caption: `_*${result.title}*_`,
                  });
                  stream.destroy();

                  await message.edit(
                    "✅ *İndirme tamamlandı!*",
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
                      "❌ *İndirme başarısız!*",
                      message.jid,
                      downloadMsg.key
                    );
                  } else {
                    await message.sendReply("❌ *İndirme başarısız oldu! Lütfen tekrar deneyin.*");
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

              let qualityText = "🎥 *Video Kalitesini Seçin.*\n\n";
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

              qualityText += "\n_ℹ️ İndirmek için bir sayı ile yanıtlayın._";
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
              let found = false;

              // 1. Nexray v2
              try {
                const r = await axios.get('https://api.nexray.web.id/downloader/v2/instagram?url=' + encodeURIComponent(url), { timeout: 40000 });
                const media = r.data.result?.media;
                if (media && Array.isArray(media)) {
                  for (const item of media.slice(0, 5)) {
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
                  // POST: data: [{ url: [...] }] | REEL: data: { url: [...] }
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

              // 4. Siputzx - fastdl
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
                if (config.DEBUG) console.error("[Otomatik İndirme IG] Hiçbir API çalışmadı:", url);
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
              const albumObject = allMediaUrls.map((mediaUrl, index) => {
                const isImg = /\.(jpg|jpeg|png|webp|heic)(\?|$)/i.test(mediaUrl);
                const item = { [isImg ? "image" : "video"]: { url: mediaUrl } };
                if (index === 0) {
                  item.caption = `✅ İndirme tamamlandı! (${allMediaUrls.length} medya)`;
                }
                return item;
              });
              await message.client.albumMessage(
                message.jid,
                albumObject,
                message.data
              );
            }
            return;
          }

          // handle tiktok (5'li fallback sistemi + photo album desteği)
          if (platformGroups["tiktok"]) {
            try {
              const downloadResult = await nexray.downloadTiktok(platformGroups["tiktok"][0]);

              // Photo album (slides)
              if (downloadResult?.type === "album" && downloadResult?.urls) {
                const imageUrls = downloadResult.urls;


                const tempFiles = [];
                for (const imgUrl of imageUrls) {
                  const tempPath = getTempPath(".jpg");
                  try {
                    await saveToDisk(imgUrl, tempPath);
                    tempFiles.push(tempPath);
                  } catch (e) {
                    if (config.DEBUG) console.error("[TikTok fotoğraf]", e?.message);
                  }
                }

                if (tempFiles.length === 0) {
                  await message.react("❌");
                  return;
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
                await message.react("✅");
                return;
              }

              // Video
              if (downloadResult?.url) {
                await message.sendReply(downloadResult, "video");
              } else {
                await message.react("❌");
              }
            } catch (err) {
              if (config.DEBUG) console.error("[Otomatik İndirme TikTok]", err?.message || err);
              await message.react("❌");
            }
            return;
          }

          // handle pinterest (multiple urls support)
          if (platformGroups["pinterest"]) {
            const allMediaUrls = [];
            const quotedMessage = message.reply_message ? message.quoted : message.data;

            for (const url of platformGroups["pinterest"]) {
              try {
                const mediaUrl = await nexray.downloadPinterest(url);
                if (mediaUrl) allMediaUrls.push(mediaUrl);
              } catch (err) {
                if (config.DEBUG) console.error("[Otomatik İndirme Pinterest]", err?.message);
              }
            }

            if (!allMediaUrls.length) {
              await message.react("❌");
              return;
            }

            if (allMediaUrls.length === 1) {
              const mediaUrl = allMediaUrls[0];
              const isImage = isMediaImage(mediaUrl);
              const tempPath = getTempPath(isImage ? ".jpg" : ".mp4");
              try {
                await saveToDisk(mediaUrl, tempPath);
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

            } else {
              const tempFiles = [];
              try {
                for (const mediaUrl of allMediaUrls) {
                  const isImage = isMediaImage(mediaUrl);
                  const tempPath = getTempPath(isImage ? ".jpg" : ".mp4");
                  await saveToDisk(mediaUrl, tempPath);
                  tempFiles.push({ path: tempPath, isImage });
                }

                const albumObject = tempFiles.map((file, index) => {
                  const item = { [file.isImage ? "image" : "video"]: { url: file.path } };
                  if (index === 0) {
                    item.caption = `✅ İndirme tamamlandı! (${tempFiles.length} medya)`;
                  }
                  return item;
                });

                await message.client.albumMessage(
                  message.jid,
                  albumObject,
                  message.data
                );
              } finally {
                for (const file of tempFiles) {
                  cleanTempFile(file.path);
                }
              }
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
                const tempPath = getTempPath(".mp4");
                try {
                  await saveToDisk(result.url, tempPath);
                  await message.sendReply({ video: { url: tempPath } });
                } finally {
                  cleanTempFile(tempPath);
                }

              } else {
                await message.react("❌");
              }
            } catch (err) {
              if (config.DEBUG) console.error("[Otomatik İndirme FB]", err?.message || err);
              try {
                const fallback = await nexray.downloadFacebook(platformGroups["facebook"][0]);
                if (fallback?.url) {
                  const tempPath = getTempPath(".mp4");
                  try {
                    await saveToDisk(fallback.url, tempPath);
                    await message.sendReply({ video: { url: tempPath } });
                  } finally {
                    cleanTempFile(tempPath);
                  }
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
            let tempPath = getTempPath(".mp3");

            try {
              downloadMsg = await message.sendReply("⏳ _Spotify bilgileri alınıyor..._");
              // nexray.downloadSpotify ile doğrudan ses URL'si al
              const spotifyInfo = await nexray.downloadSpotify(platformGroups["spotify"][0]);
              if (!spotifyInfo?.url) throw new Error("Spotify indirme başarısız");

              const { title = "Spotify", artist = "", url: audioUrl } = spotifyInfo;
              await message.edit(
                `_*${title}* - *${artist}* indiriliyor..._`,
                message.jid,
                downloadMsg.key
              );

              await saveToDisk(audioUrl, tempPath);
              await message.edit("🔺 _Ses gönderiliyor..._", message.jid, downloadMsg.key);
              await message.sendReply({ audio: { url: tempPath }, mimetype: "audio/mpeg" });
              await message.edit("✅ *İndirme tamamlandı!*", message.jid, downloadMsg.key);
            } catch (err) {
              if (config.DEBUG)
                console.error("[Otomatik İndirme Spotify]", err?.message || err);
              try {
                const fallback = await nexray.downloadSpotify(platformGroups["spotify"][0]);
                if (fallback?.url) {
                  if (!downloadMsg) downloadMsg = await message.sendReply("♻️ _Yedek yöntemle indiriliyor..._");
                  await saveToDisk(fallback.url, tempPath);
                  await message.edit("🔺 _Ses gönderiliyor..._", message.jid, downloadMsg.key);
                  await message.sendReply({ audio: { url: tempPath }, mimetype: "audio/mpeg" });
                  await message.edit("✅ *İndirme tamamlandı!*", message.jid, downloadMsg.key);
                  return;
                }
              } catch (_) { }
              if (downloadMsg) {
                await message.edit("❌ *İndirme başarısız!*", message.jid, downloadMsg.key);
              } else {
                await message.sendReply("❌ *İndirme başarısız oldu! Lütfen tekrar deneyin.*");
              }
            } finally {
              cleanTempFile(tempPath);
            }
            return;
          }

          // handle twitter
          if (platformGroups["twitter"]) {
            try {
              const result = await nexray.downloadTwitter(platformGroups["twitter"][0]);
              if (result?.url) {
                const tempPath = getTempPath(".mp4");
                try {
                  await saveToDisk(result.url, tempPath);
                  await message.sendReply({ video: { url: tempPath } });
                } finally {
                  cleanTempFile(tempPath);
                }
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

  Module({
    pattern: "otoindir ?(.*)",
    fromMe: true,
    onlyAdmin: true,
    desc: "Belirlediğiniz sohbetlerde veya tüm gruplarda sosyal medya bağlantılarını otomatik olarak algılar ve medyayı indirir.",
    usage: ".otoindir | .otoindir aç/kapat | .otoindir durum",
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
          `- _Genel Gruplar:_ ${globalGroups ? "Açık ✅" : "Kapalı ❌"
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

      if (cmd === "aç") {
        if (target === "gruplar") {
          if (!message.fromOwner) return await message.sendReply("❌ *Bu genel ayarı sadece bot geliştiricisi değiştirebilir!*");
          await setVar("AUTODL_ALL_GROUPS", "true");
          return await message.sendReply("✅ *Tüm gruplarda Oto-İndirme aktif!* \n\n*ℹ️ Kapatmak için:* `.otoindirme kapat gruplar`"
          );
        } else if (target === "dm") {
          if (!message.fromOwner) return await message.sendReply("❌ *Bu genel ayarı sadece bot geliştiricisi değiştirebilir!*");
          await setVar("AUTODL_ALL_DMS", "true");
          return await message.sendReply("✅ *Tüm DM'lerde Oto-İndirme aktif!* \n\n*ℹ️ Kapatmak için:* `.otoindirme kapat dm`"
          );
        } else {
          const enabledList = readList();
          if (!enabledList.includes(chatJid)) enabledList.push(chatJid);
          await setVar("AUTODL", enabledList.join(","));
          return await message.sendReply("✅ *Bu sohbette Oto-İndirme aktif!* \n\nℹ️ _Otomatik indirme için desteklenen bir bağlantı gönderin._"
          );
        }
      }

      if (cmd === "kapat") {
        if (target === "gruplar") {
          if (!message.fromOwner) return await message.sendReply("❌ *Bu genel ayarı sadece bot geliştiricisi değiştirebilir!*");
          await setVar("AUTODL_ALL_GROUPS", "false");
          return await message.sendReply("❌ *Tüm gruplarda Oto-İndirme devre dışı!* \n\n*ℹ️ Açmak için:* `.otoindirme aç gruplar`"
          );
        } else if (target === "dm") {
          if (!message.fromOwner) return await message.sendReply("❌ *Bu genel ayarı sadece bot geliştiricisi değiştirebilir!*");
          await setVar("AUTODL_ALL_DMS", "false");
          return await message.sendReply("❌ *Tüm DM'lerde Oto-İndirme devre dışı!* \n\n*ℹ️ Açmak için:* `.otoindirme aç dm`"
          );
        } else {
          const enabledList = readList().filter((x) => x !== chatJid);
          await setVar("AUTODL", enabledList.join(","));
          return await message.sendReply("❌ *Bu sohbette Oto-İndirme devre dışı!* \n\n*ℹ️ Tekrar açmak için:* `.otoindirme aç`"
          );
        }
      }

      if (cmd === "durum" || cmd === "status") {
        const enabledList = readList();
        const globalGroups = config.AUTODL_ALL_GROUPS === "true";
        const globalDMs = config.AUTODL_ALL_DMS === "true";
        return await message.sendReply(`*_✨ Otomatik İndirme Durumu_*\n\n` +
          `• _Aktif sohbetler:_ ${enabledList.length > 0 ? enabledList.join(", ") : "Yok"
          }\n` +
          `• _Genel Gruplar:_ ${globalGroups ? "Açık ✅" : "Kapalı ❌"
          }\n` +
          `• _Genel DM'ler:_ ${globalDMs ? "Açık ✅" : "Kapalı ❌"}`
        );
      }

      return await message.sendReply(`❌ *Bilinmeyen seçenek:* \`${cmd}\``);
    }
  );
})();

// ==========================================
// FILE: social.js
// ==========================================
(function () {
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
  const nexray = require('./utils/nexray_api');
  const botConfig = require("../config");
  const axios = require("axios");
  const { saveToDisk, getTempPath, cleanTempFile, extractUrls, validateUrl, isMediaImage, readMp4Dimensions } = require("../core/yardimcilar");

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
        return await message.sendReply("⚠️ *Instagram bağlantısı gerekli!*");
      if (mediaLinks.startsWith("ll")) return;

      const allUrls = extractUrls(mediaLinks);
      if (!allUrls.length)
        return await message.sendReply("⚠️ *Instagram bağlantısı gerekli!*");

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
        return await message.sendReply("⚠️ *Geçerli Instagram bağlantısı gerekli!*");

      try {
        const allMediaUrls = [];
        const quotedMessage = message.reply_message
          ? message.quoted
          : message.data;

        for (const url of instagramUrls) {
          let found = false;

          try {
            const r = await axios.get('https://api.nexray.web.id/downloader/v2/instagram?url=' + encodeURIComponent(url), { timeout: 40000 });
            const media = r.data.result?.media || r.data.result;
            if (media && Array.isArray(media)) {
              for (const item of media.slice(0, 10)) {
                if (item.url) allMediaUrls.push(item.url);
              }
              if (allMediaUrls.length > 0) found = true;
            }
          } catch (_) { }

          if (!found) {
            try {
              const r = await axios.get('https://api.nexray.web.id/downloader/instagram?url=' + encodeURIComponent(url), { timeout: 40000 });
              const nexrayData = r.data.result;
              if (nexrayData && Array.isArray(nexrayData)) {
                for (const item of nexrayData.slice(0, 10)) {
                  if (item.url) allMediaUrls.push(item.url);
                }
                if (allMediaUrls.length > 0) found = true;
              }
            } catch (_) { }
          }

          if (!found) {
            try {
              const fallback = await siputGet("/api/d/sssinstagram", { url });
              const r = fallback.result || fallback.data;
              const items = Array.isArray(r) ? r : (r?.url || r?.data);
              if (Array.isArray(items)) {
                for (const item of items.slice(0, 10)) {
                  const mUrl = typeof item === 'string' ? item : (item.url || item.download_url);
                  if (mUrl && typeof mUrl === 'string' && mUrl.startsWith("http")) {
                    allMediaUrls.push(mUrl);
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
              const items = Array.isArray(r) ? r : (r?.url || r?.data);
              if (Array.isArray(items)) {
                for (const item of items.slice(0, 10)) {
                  const mUrl = typeof item === 'string' ? item : (item.url || item.download_url);
                  if (mUrl && typeof mUrl === 'string' && mUrl.startsWith("http")) {
                    allMediaUrls.push(mUrl);
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
              const items = Array.isArray(r) ? r : (r?.url || r?.data);
              if (Array.isArray(items)) {
                for (const item of items.slice(0, 10)) {
                  const mUrl = typeof item === 'string' ? item : (item.url || item.download_url);
                  if (mUrl && typeof mUrl === 'string' && mUrl.startsWith("http")) {
                    allMediaUrls.push(mUrl);
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
          return await message.sendReply("❌ *Bir şeyler ters gitti! Lütfen tekrar deneyin.*");

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
        return await message.sendReply("❌ *Bir şeyler ters gitti! Lütfen tekrar deneyin.*");
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
        return await message.sendReply("⚠️ *Lütfen geçerli bir Facebook bağlantısı girin!*");
      }

      if (!videoLink) return await message.sendReply("⚠️ *Facebook bağlantısı gerekli!*");
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
      return await message.sendReply("❌ *Bir şeyler ters gitti! Lütfen tekrar deneyin.*"
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
        return await message.sendReply("❌ *Üzgünüm, sunucu hatası oluştu!*");
      }
      if (!storyData || !storyData.length)
        return await message.sendReply("❌ *Medya bulunamadı!*");

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
      const storyMatch = userIdentifier.match(/stories\/([A-Za-z0-9._]+)/i);
      userIdentifier = storyMatch ? storyMatch[1] : userIdentifier;
      await message.sendReply(`⏳ _${userIdentifier} kullanıcısının (${storyData.length} hikayesi iletiliyor...)_`, { quoted: message.data });
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
      if (!input || input === "g") return await message.sendReply("📌 *Arama terimi, bağlantı veya kullanıcı adı girin:* \n\n*💡 Örnek:* \`.pinterest manzara\` veya \`.pinterest @kullanici\`");

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
            return await message.sendReply("❌ *İndirilebilir medya bulunamadı veya sunucu hatası.*");
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
          await message.sendReply(`❌ *Pinterest medyası işlenemedi!* \n\n*Hata:* ${e.message}`);
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
          if (input.startsWith("@")) return await message.sendReply("❌ *Kullanıcı bulunamadı veya API hatası.*");
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
          return await message.sendReply("❌ *Arama sonucu bulunamadı!*");
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
        await message.sendReply(`❌ *Pinterest'te arama yaparken hata oluştu!* \n\n*Hata:* ${err.message}`);
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
      if (!videoLink) return await message.sendReply("⚠️ *Bir Twitter/X bağlantısı gerekli!*");
      videoLink = videoLink.match(/\bhttps?:\/\/\S+/gi)?.[0];
      if (!videoLink || !/twitter\.com|x\.com/i.test(videoLink))
        return await message.sendReply("⚠️ *Geçerli bir Twitter/X bağlantısı gerekli!*");
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
          await message.sendReply("❌ *Bu bağlantı için indirilebilir medya bulunamadı!*");
        }
      } catch (e) {
        console.error("Twitter indirme hatası:", e?.message);
        await message.sendReply("❌ *Bir şeyler ters gitti! Lütfen tekrar deneyin.*");
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
      if (!videoLink) return await message.sendReply("⚠️ *Bir TikTok bağlantısı gerekli!*");
      const urls = extractUrls(videoLink);
      if (urls.length > 0 && validateUrl(urls[0], "tiktok")) {
        videoLink = urls[0];
      } else {
        return await message.sendReply("⚠️ *Lütfen geçerli bir TikTok bağlantısı girin!*");
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
            return await message.sendReply("❌ *Bir şeyler ters gitti! Lütfen tekrar deneyin.*");
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
          await message.sendReply("❌ *Bir şeyler ters gitti! Lütfen tekrar deneyin.*");
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
            await message.sendReply("❌ *Bir şeyler ters gitti! Lütfen tekrar deneyin.*");
          }
        } catch (_) {
          await message.sendReply("❌ *Bir şeyler ters gitti! Lütfen tekrar deneyin.*");
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
      if (!url) return await message.sendReply("🎬 *CapCut video/şablon bağlantısı gönderin:* \`.capcut bağlantı\`");
      url = url.match(/\bhttps?:\/\/\S+/gi)?.[0];
      if (!url || !url.includes("capcut")) return await message.sendReply("⚠️ *Geçerli bir CapCut bağlantısı gönderin!*");

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
        await message.sendReply(`❌ *CapCut videosu indirilemedi!* \n\n*Hata:* ${e.message}`);
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
        let caption = `👤 *Kullanıcı Adı:* @${user.username}\n🆔 *Kullanıcı ID:* ${user.id}\n📝 *İsim:* ${user.name}\n👥 *Takipçi:* ${formatNumber(user.followers)}\n➕ *Takip:* ${formatNumber(user.following)}\n❤️ *Beğeni:* ${formatNumber(user.likes)}\nℹ️ *BİYOGRAFİ*\n_${user.bio || 'Biyografi yok'}_\n` + (user.verified ? '✅ *Doğrulanmış Hesap*\n' : '') + (user.private ? '🔒 *Gizli Hesap*\n' : '') + `\n🔗 *Profil:* https://www.tiktok.com/@${user.username}`;
        if (user.avatar) await message.sendMessage({ url: user.avatar }, 'image', { caption, quoted: message.data });
        else await message.sendReply(caption);
      } catch (error) {
        console.error('[TikTok] Kritik Hata:', error);
        return await message.sendReply('❌ *Bilgiler getirilirken bir hata oluştu! Lütfen daha sonra tekrar deneyin.*');
      }
    });
})();

// ==========================================
// FILE: youtube.js
// ==========================================
(function () {
  const { Module } = require("../main");
  const fs = require("fs");
  const path = require("path");
  const axios = require("axios");
  const {
    downloadVideo,
    downloadAudio,
    searchYoutube,
    getVideoInfo,
    convertM4aToMp3,
  } = require('./utils/youtube_araclari');
  const { censorBadWords } = require("./utils");
  const nexray = require('./utils/nexray_api');

  const config = require("../config");
  const { bytesToSize: formatBytes } = require("./utils");
  const { extractUrls, validateUrl } = require("../core/yardimcilar");

  const SIPUTZX_BASE = "https://api.siputzx.my.id";

  async function siputGet(path, params = {}) {
    const url = `${SIPUTZX_BASE}${path}`;
    const res = await axios.get(url, { params, timeout: 30000, validateStatus: () => true });
    if (res.data && res.data.status) return res.data;
    throw new Error(res.data?.error || "API yanıt vermedi");
  }

  const VIDEO_SIZE_LIMIT = 150 * 1024 * 1024;

  function formatViews(views) {
    if (views >= 1000000) {
      return (views / 1000000).toFixed(1) + "M";
    } else if (views >= 1000) {
      return (views / 1000).toFixed(1) + "K";
    }
    return views?.toString() || "Belirtilmedi";
  }

  Module({
    pattern: "spotify ?(.*)",
    fromMe: false,
    desc: "Spotify üzerinden şarkı araması yapar ve yüksek kalitede indirir.",
    usage: ".spotify [şarkı/bağlantı]",
    use: "indirme",
  },
    async (message, match) => {
      const input = match[1] || message.reply_message?.text;
      if (!input) {
        return await message.sendReply(
          "⚠️ *Lütfen bir şarkı adı veya Spotify bağlantısı girin!*\n*Örnek:* `.spotify despacito` veya `.spotify https://open.spotify.com/track/xxxx_`"
        );
      }

      let downloadMsg;
      try {
        const extractedUrls = extractUrls(input);
        const isUrl = extractedUrls.length > 0 && extractedUrls[0].includes("spotify.com");

        if (isUrl) {
          let url = extractedUrls[0];

          // Validate specifically for spotify track, album, playlist format
          if (!validateUrl(url, "spotify")) {
            return await message.sendReply("❌ *Lütfen geçerli bir Spotify bağlantısı girin!*");
          }

          downloadMsg = await message.sendReply("⏳ _Spotify'dan indiriliyor..._");
          const result = await nexray.downloadSpotify(url);

          if (!result || !result.url) {
            return await message.edit("❌ *Şarkı indirilemedi veya geçersiz bağlantı!*", message.jid, downloadMsg.key);
          }

          const safeTitle = censorBadWords(result.title || "Spotify Track");
          const safeArtist = censorBadWords(result.artist || "Bilinmiyor");

          await message.edit(`_📤 *${safeArtist}* - *${safeTitle}* yükleniyor..._`, message.jid, downloadMsg.key);

          await message.client.sendMessage(message.jid, {
            audio: { url: result.url },
            mimetype: "audio/mpeg",
            fileName: `${safeArtist} - ${safeTitle}.mp3`,
          }, { quoted: message.data });

          return await message.edit("✅ *İndirme tamamlandı!*", message.jid, downloadMsg.key);
        } else {
          downloadMsg = await message.sendReply("🔍 _Spotify'da aranıyor..._");
          const result = await nexray.spotifyPlay(input);

          if (!result || !result.url) {
            return await message.edit("❌ *Şarkı bulunamadı!*", message.jid, downloadMsg.key);
          }

          const { title, artist, thumbnail, duration, album, url: trackUrl } = result;
          const safeTitle = censorBadWords(title);
          const safeArtist = censorBadWords(artist);

          let caption = `🎵 *${safeTitle}*\n`;
          caption += `🎤 *Sanatçı:* ${safeArtist}\n`;
          caption += `💿 *Albüm:* ${censorBadWords(album)}\n`;
          caption += `⏳ *Süre:* ${duration}\n\n`;
          caption += `_🔻 İndirilip yükleniyor..._`;

          await message.edit(caption, message.jid, downloadMsg.key);

          await message.client.sendMessage(message.jid, {
            audio: { url: result.url },
            mimetype: "audio/mpeg",
            fileName: `${safeArtist} - ${safeTitle}.mp3`,
            externalAdReply: {
              title: safeTitle,
              body: safeArtist,
              thumbnail: thumbnail ? await nexray.getBuffer(thumbnail) : "",
              mediaType: 2,
              mediaUrl: trackUrl || "",
            },
          }, { quoted: message.data });

          return await message.edit("✅ *İndirme tamamlandı!*", message.jid, downloadMsg.key);
        }
      } catch (error) {
        // Fallback: Siputzx API
        try {
          if (isUrl) {
            const fallback = await siputGet("/api/d/spotify", { url: extractedUrls[0] });
            const r = fallback.data || fallback.result;
            if (r?.url || r?.download || r?.audio) {
              const audioUrl = r.url || r.download || r.audio;
              await message.client.sendMessage(message.jid, {
                audio: { url: audioUrl },
                mimetype: "audio/mpeg",
              }, { quoted: message.data });
              return;
            }
          }
        } catch (_) { }
        console.error("Spotify indirme hatası:", error);
        if (downloadMsg) {
          await message.edit("❌ *Spotify işlemi başarısız oldu!*", message.jid, downloadMsg.key);
        } else {
          await message.sendReply("❌ *Spotify işlemi başarısız oldu!*");
        }
      }
    }
  );

  Module({
    pattern: "ytara ?(.*)",
    fromMe: false,
    desc: "YouTube üzerinde detaylı arama yaparak video ve kanal bilgilerini listeler.",
    usage: ".ytara [sorgu]",
    use: "indirme",
  },
    async (message, match) => {
      const query = match[1];
      if (!query) {
        return await message.sendReply("⚠️ *Lütfen aranacak kelimeyi girin!* \n*💡 Örnek:* `.ytara Eşref Rüya`"
        );
      }

      try {
        const searchMsg = await message.sendReply("🔍 _YouTube'da aranıyor..._");
        const results = await nexray.searchYoutube(query);

        if (!results || results.length === 0) {
          return await message.edit(
            "❌ *Sonuç bulunamadı!*",
            message.jid,
            searchMsg.key
          );
        }

        let resultText = "🎵 YouTube Arama Sonuçları\n\n";
        resultText += `_${results.length} sonuç bulundu:_ *${query}*\n\n`;

        results.slice(0, 10).forEach((video, index) => {
          resultText += `*${index + 1}.* ${censorBadWords(video.title)}\n`;
          resultText += `   _Süre:_ \`${video.duration}\` | _Görüntülenme:_ \`${video.views}\`\n`;
          resultText += `   _Kanal:_ ${video.channel}\n\n`;
        });

        resultText += "_Video detaylarını görüntülemek için bir numara (1-10) ile yanıtlayın_";

        await message.edit(resultText, message.jid, searchMsg.key);
      } catch (error) {
        console.error("YouTube arama hatası:", error);
        await message.sendReply("❌ *Arama başarısız oldu! Lütfen daha sonra tekrar deneyin.*");
      }
    }
  );

  Module({
    pattern: "ytvideo ?(.*)",
    fromMe: false,
    desc: "YouTube videolarını kalite seçeneği sunarak (360p, 1080p vb.) indirmenizi sağlar.",
    usage: ".ytvideo [sorgu/bağlantı]",
    use: "indirme",
  },
    async (message, match) => {
      let input = (match[1] || message.reply_message?.text || "").trim();
      if (!input) {
        return await message.sendReply("⚠️ *Lütfen video adını veya bağlantısını yazın!* \n\n*💡 Örnek:* `.ytvideo köpek videoları`");
      }

      const extractedUrls = extractUrls(input);
      const extractedUrl = extractedUrls.length > 0 ? extractedUrls[0] : null;

      // Strict URL validation to prevent SSRF/injection
      const isValidYtUrl = validateUrl(extractedUrl, "youtube");

      const url = isValidYtUrl
        ? (extractedUrl.includes("/shorts/")
          ? (() => {
            const shortId = extractedUrl.match(/\/shorts\/([A-Za-z0-9_-]{11})/)?.[1];
            return shortId ? `https://www.youtube.com/watch?v=${shortId}` : extractedUrl;
          })()
          : extractedUrl)
        : null;

      if (!url) {
        try {
          const searchMsg = await message.sendReply("🔍 _YouTube'da aranıyor..._");
          const results = await nexray.searchYoutube(input);

          if (!results || results.length === 0) {
            return await message.edit("❌ *Sonuç bulunamadı!*", message.jid, searchMsg.key);
          }

          let resultText = "🎬 _YouTube Arama Sonuçları_\n\n";
          resultText += `🔎 _${results.length} sonuç bulundu:_ *${input}*\n\n`;

          results.slice(0, 10).forEach((video, index) => {
            resultText += `*${index + 1}.* ${censorBadWords(video.title)}\n`;
            resultText += `   _Süre:_ \`${video.duration}\` | _Görüntülenme:_ \`${video.views}\`\n`;
            resultText += `   _Kanal:_ ${video.channel}\n\n`;
          });

          resultText += "▶️ _Videoyu indirmek için seçiminizi bir numara (1-10) ile yanıtlayın._";
          return await message.edit(resultText, message.jid, searchMsg.key);
        } catch (error) {
          console.error("ytvideo arama hatası:", error);
          return await message.sendReply("❌ *Arama başarısız oldu! Farklı şekilde deneyin.*");
        }
      }

      let videoPath;

      try {
        downloadMsg = await message.sendReply("⏳ _Video bilgileri alınıyor..._");
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

        if (videoFormats.length === 0) {
          return await message.edit(
            "❌ *Bu video için uygun format bulunamadı!*",
            message.jid,
            downloadMsg.key
          );
        }

        const uniqueQualities = [...new Set(videoFormats.map((f) => f.quality))];
        const videoId = info.videoId || url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([^&\s/?]+)/)?.[1] || "";

        let qualityText = info.isFallback ? "⚠️ _Video bilgileri kısıtlı (Standart Mod)_\n\n" : "✨ _Video Kalitesini Seçiniz_\n\n";
        qualityText += `✍🏻 _*${censorBadWords(info.title)}*_\n\nID: \`${videoId}\`\n\n`;

        uniqueQualities.forEach((quality, index) => {
          const format = videoFormats.find((f) => f.quality === quality);
          let sizeInfo = format.size && format.size !== 'Standart' ? ` ~ _${format.size}_` : (format.size === 'Standart' ? '' : '');
          if (info.isFallback && format.size) sizeInfo = ` (${format.size})`;

          qualityText += `*${index + 1}.* _*${quality}*_${sizeInfo}\n`;
        });

        const audioFormat = info.formats.find((f) => f.type === "audio");
        if (audioFormat) {
          qualityText += `*${uniqueQualities.length + 1}.* _*Sadece Ses*_\n`;
        }

        qualityText += "\n▶️ _İndirmek için seçiminizi bir numara ile yanıtlayın._";
        if (info.isFallback) qualityText += "\n\n_Not: Sunucu yoğunluğu nedeniyle sadece temel kaliteler listelendi._";

        await message.edit(qualityText, message.jid, downloadMsg.key);
      } catch (error) {
        console.error("YouTube ytvideo indirme hatası:", error);
        if (downloadMsg) {
          await message.edit("❌ *Video bilgileri alınamadı! Lütfen bağlantıyı kontrol edin veya daha sonra tekrar deneyin.*", message.jid, downloadMsg.key);
        } else {
          await message.sendReply("❌ *İşlem başarısız oldu!*");
        }
      }
    }
  );

  Module({
    pattern: "video ?(.*)",
    fromMe: false,
    desc: "YouTube videolarını en hızlı ve en yüksek kalitede doğrudan indirir.",
    usage: ".video [sorgu/bağlantı]",
    use: "indirme",
  },
    async (message, match) => {
      let input = (match[1] || message.reply_message?.text || "").trim();
      if (!input) {
        return await message.sendReply("⚠️ *Lütfen video adını veya bağlantısını yazın!* \n\n*💡 Örnek:* `.video köpek videoları`");
      }

      const extractedUrl = /\bhttps?:\/\/\S+/gi.test(input)
        ? input.match(/\bhttps?:\/\/\S+/gi)?.[0]
        : null;

      const normalizedUrl = extractedUrl &&
        (extractedUrl.includes("youtube.com") || extractedUrl.includes("youtu.be"))
        ? (extractedUrl.includes("youtube.com/shorts/")
          ? (() => {
            const shortId = extractedUrl.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/)?.[1];
            return shortId ? `https://www.youtube.com/watch?v=${shortId}` : extractedUrl;
          })()
          : extractedUrl)
        : null;

      let downloadMsg;
      let videoPath;
      let targetUrl = normalizedUrl;

      if (!targetUrl) {
        try {
          downloadMsg = await message.sendReply("🔍 _Video aranıyor..._");
          const results = await nexray.searchYoutube(input);

          if (!results || results.length === 0) {
            return await message.edit("❌ *Sonuç bulunamadı!*", message.jid, downloadMsg.key);
          }

          targetUrl = results[0].url;
        } catch (err) {
          console.error("Video arama hatası:", err);
          return await message.sendReply("❌ *Arama başarısız oldu!*");
        }
      }

      try {
        if (targetUrl) {
          if (!downloadMsg) {
            downloadMsg = await message.sendReply("⏳ _Video bilgileri alınıyor..._");
          } else {
            await message.edit("⏳ _Video bilgileri alınıyor..._", message.jid, downloadMsg.key);
          }

          let highestQuality = "360p";
          let info;
          try {
            info = await getVideoInfo(targetUrl);
            const videoFormats = info.formats
              .filter((f) => f.type === "video" && f.quality)
              .sort((a, b) => {
                const getRes = (q) => {
                  const match = q.match(/(\d+)/);
                  return match ? parseInt(match[1]) : 0;
                };
                return getRes(b.quality) - getRes(a.quality);
              });
            if (videoFormats.length > 0) {
              highestQuality = videoFormats[0].quality;
            }
          } catch (_) { }

          await message.edit(`_⬇️ Video indiriliyor..._ (\`${highestQuality}\`)`, message.jid, downloadMsg.key);
          const result = await downloadVideo(targetUrl, highestQuality);
          videoPath = result.path;

          await message.edit("_📤 Video yükleniyor..._", message.jid, downloadMsg.key);

          const stats = fs.statSync(videoPath);
          const safeTitle = censorBadWords(result.title);

          let metadataStr = "";
          try {
            if (info) {
              metadataStr = `_Kanal:_ ${info.channel || "Bilinmiyor"}\n_Süre:_ \`${info.duration || "Bilinmiyor"}\` | _Görüntülenme:_ \`${info.views || "Bilinmiyor"}\`\n\n`;
            }
          } catch (_) { }

          if (stats.size > VIDEO_SIZE_LIMIT) {
            const stream = fs.createReadStream(videoPath);
            await message.sendMessage({ stream }, "document", {
              fileName: `${safeTitle}.mp4`,
              mimetype: "video/mp4",
              caption: `_*${safeTitle}*_\n\n${metadataStr}_Dosya boyutu: ${formatBytes(stats.size)}_\n✨ _Kalite: ${highestQuality}_`,
            });
            stream.destroy();
          } else {
            const stream = fs.createReadStream(videoPath);
            await message.sendReply({ stream }, "video", {
              caption: `_*${safeTitle}*_\n\n${metadataStr}✨ _Kalite: ${highestQuality}_`,
            });
            stream.destroy();
          }

          await message.edit("✅ _Hazır!_", message.jid, downloadMsg.key);

          await new Promise((resolve) => setTimeout(resolve, 100));
          if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
          }
        }
      } catch (error) {
        if (targetUrl) {
          try {
            const fallback = await nexray.downloadYtMp4(targetUrl);
            if (fallback?.url) {
              if (!downloadMsg) {
                downloadMsg = await message.sendReply("_🔎 Alternatif yöntemle aranıyor..._");
              } else {
                await message.edit("_🔎 Alternatif yöntemle aranıyor..._", message.jid, downloadMsg.key);
              }

              const safeTitle = censorBadWords(fallback.title || "video");
              await message.edit(`_🔻 İndirilip yükleniyor..._ *${safeTitle}*`, message.jid, downloadMsg.key);

              await message.sendReply({ url: fallback.url }, "video", {
                caption: `_*${safeTitle}*_`,
              });
              await message.edit(`✅ _Hazır!_ *${safeTitle}*`, message.jid, downloadMsg.key);
              return;
            }
          } catch (_) { }
        }

        console.error("Video indirme hatası:", error);
        if (downloadMsg) {
          await message.edit("❌ *İndirme başarısız!*", message.jid, downloadMsg.key);
        } else {
          await message.sendReply("❌ *İndirme başarısız oldu! Lütfen tekrar deneyin.*");
        }

        if (videoPath && fs.existsSync(videoPath)) {
          try { fs.unlinkSync(videoPath); } catch (_) { }
        }
      }
    }
  );

  Module({
    pattern: "ytsesb ?(.*)",
    fromMe: false,
    desc: "YouTube videolarını belge (.mp3/.m4a) formatında ses olarak indirir.",
    usage: ".ytsesb [bağlantı]",
    use: "indirme",
  },
    async (message, match) => {
      let url = match[1] || message.reply_message?.text;

      if (url && /\bhttps?:\/\/\S+/gi.test(url)) {
        url = url.match(/\bhttps?:\/\/\S+/gi)[0];
      }

      if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
        return await message.sendReply("⚠️ *Lütfen geçerli bir YouTube bağlantısı verin!* \n\n*💡 Örnek:* `.ytsesb https://youtube.com/watch?v=xxxxx`"
        );
      }

      // Convert YouTube Shorts URL to regular watch URL if needed
      if (url.includes("youtube.com/shorts/")) {
        const shortId = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/)?.[1];
        if (shortId) {
          url = `https://www.youtube.com/watch?v=${shortId}`;
        }
      }

      let audioPath;

      try {
        downloadMsg = await message.sendReply("🔻 _Ses indiriliyor..._");
        const result = await downloadAudio(url);
        audioPath = result.path;

        const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
        const thumbUrl = match ? `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg` : '';

        const mp3Path = await convertM4aToMp3(audioPath, {
          title: result.title,
          artist: "YouTube",
          imageUrl: thumbUrl
        });
        audioPath = mp3Path;

        await message.edit("_📤 Ses gönderiliyor..._", message.jid, downloadMsg.key);

        const safeTitle = censorBadWords(result.title);
        const stream = fs.createReadStream(audioPath);
        await message.sendMessage({ stream }, "document", {
          fileName: `${safeTitle}.mp3`,
          mimetype: "audio/mpeg",
          caption: `_*${safeTitle}*_`,
        });
        stream.destroy();

        await message.edit("✅ _Hazır!_", message.jid, downloadMsg.key);

        await new Promise((resolve) => setTimeout(resolve, 100));
        if (fs.existsSync(audioPath)) {
          fs.unlinkSync(audioPath);
        }
      } catch (error) {
        console.error("YouTube ses indirme hatası (yt-dlp):", error?.message);
        if (audioPath && fs.existsSync(audioPath)) {
          try { fs.unlinkSync(audioPath); } catch (_) { }
        }

        // API Fallback: yt-dlp başarısız → nexray API zinciri (EliteProTech/Yupra/Okatsu/Izumi)
        try {
          if (!downloadMsg) {
            downloadMsg = await message.sendReply("_🔎 Alternatif yöntemle indiriliyor..._");
          } else {
            await message.edit("_🔎 Alternatif yöntemle indiriliyor..._", message.jid, downloadMsg.key);
          }

          const fallback = await nexray.downloadYtMp3(url);
          if (!fallback?.url) throw new Error("Tüm API'ler başarısız");

          const safeTitle = censorBadWords(fallback.title || "Ses");
          await message.edit(`_🔻 İndirilip yükleniyor..._ *${safeTitle}*`, message.jid, downloadMsg.key);

          await message.client.sendMessage(message.jid, {
            audio: { url: fallback.url },
            mimetype: "audio/mpeg",
            fileName: `${safeTitle}.mp3`,
          }, { quoted: message.data });

          await message.edit("✅ _Hazır!_", message.jid, downloadMsg.key);
        } catch (fallbackErr) {
          console.error("YouTube ses API fallback hatası:", fallbackErr?.message);
          if (downloadMsg) {
            await message.edit("❌ *İndirme başarısız oldu! Lütfen tekrar deneyin.*", message.jid, downloadMsg.key);
          } else {
            await message.sendReply("❌ *İndirme başarısız oldu! Lütfen tekrar deneyin.*");
          }
        }
      }
    }
  );

  Module({
    pattern: "şarkı ?(.*)",
    fromMe: false,
    desc: "YouTube üzerinden ses/şarkı indirir. (anahtar kelime veya bağlantı ile)",
    usage: ".şarkı <sorgu/bağlantı> | .şarkıara <sorgu>",
    use: "indirme",
  },
    async (message, match) => {
      let input = (match[1] || message.reply_message?.text || "").trim();
      if (!input) {
        return await message.sendReply("⚠️ *Lütfen şarkı adı veya bağlantısı yazın!* \n🎶 *Örnek:* `.şarkı Duman - Bu Akşam`\n`.şarkıara Aleyna Tilki - Cevapsız Çınlama`");
      }

      // Handle "ara" subcommand
      if (input.toLowerCase().startsWith("ara")) {
        const query = input.slice(4).trim();
        if (!query) return await message.sendReply("⚠️ *Lütfen aranacak kelimeyi girin!*");

        try {
          const searchMsg = await message.client.sendMessage(message.jid, { text: "🔍 _YouTube'da aranıyor..._" });
          const results = await nexray.searchYoutube(query);

          if (!results || results.length === 0) {
            return await message.edit("❌ *Sonuç bulunamadı!*", message.jid, searchMsg.key);
          }

          let resultText = "🎵 YouTube Arama Sonuçları\n\n";
          resultText += `🔎 _${results.length} sonuç bulundu:_ *${query}*\n\n`;

          results.slice(0, 10).forEach((video, index) => {
            resultText += `*${index + 1}.* ${censorBadWords(video.title)}\n`;
            resultText += `   _Süre:_ \`${video.duration}\` | _Görüntülenme:_ \`${video.views}\`\n`;
            resultText += `   _Kanal:_ ${video.channel}\n\n`;
          });

          resultText += "▶️ _Ses indirmek için bir sayı (1-10) ile yanıtlayın._";
          return await message.edit(resultText, message.jid, searchMsg.key);
        } catch (error) {
          console.error("Şarkı arama hatası:", error);
          return await message.sendReply("❌ *Arama başarısız oldu!*");
        }
      }

      let downloadMsg;
      const extractedUrl = /\bhttps?:\/\/\S+/gi.test(input)
        ? input.match(/\bhttps?:\/\/\S+/gi)?.[0]
        : null;

      const normalizedUrl = extractedUrl &&
        (extractedUrl.includes("youtube.com") || extractedUrl.includes("youtu.be"))
        ? (extractedUrl.includes("youtube.com/shorts/")
          ? (() => {
            const shortId = extractedUrl.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/)?.[1];
            return shortId ? `https://www.youtube.com/watch?v=${shortId}` : extractedUrl;
          })()
          : extractedUrl)
        : null;

      let targetUrl = normalizedUrl;

      try {
        let videoInfo = null;
        if (!targetUrl) {
          downloadMsg = await message.client.sendMessage(message.jid, { text: "🔍 _Aranıyor..._" });
          const results = await nexray.searchYoutube(input);

          if (!results || results.length === 0) {
            return await message.edit("❌ *Sonuç bulunamadı!*", message.jid, downloadMsg.key);
          }

          targetUrl = results[0].url;
          videoInfo = results[0];
        }

        if (targetUrl) {
          if (!downloadMsg) {
            downloadMsg = await message.client.sendMessage(message.jid, { text: "🔻 _İndirilip yükleniyor..._" });
          } else {
            await message.edit("🔻 _İndirilip yükleniyor..._", message.jid, downloadMsg.key);
          }

          const result = await downloadAudio(targetUrl);
          if (!result || !result.path) throw new Error("İndirme bağlantısı alınamadı");

          const safeTitle = censorBadWords(result.title || videoInfo?.title || input);
          let thumbUrl = videoInfo?.image_url || videoInfo?.thumbnail || "";
          if (!thumbUrl) {
            const match = targetUrl.match(/[?&]v=([^&]+)/) || targetUrl.match(/youtu\.be\/([^?]+)/);
            if (match) thumbUrl = `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
          }

          const mp3Path = await convertM4aToMp3(result.path, {
            title: safeTitle,
            artist: videoInfo?.channel?.name || videoInfo?.author?.name || videoInfo?.channel || "Lades-Pro | Bot",
            imageUrl: thumbUrl
          });

          await message.client.sendMessage(message.jid, {
            audio: { url: mp3Path },
            mimetype: "audio/mpeg",
            ptt: false,
            contextInfo: {
              externalAdReply: {
                title: safeTitle,
                body: "Lades-Pro | Bot",
                mediaType: 2,
                thumbnailUrl: thumbUrl,
                sourceUrl: targetUrl
              }
            }
          }, { quoted: message.data });

          return await message.edit(`✅ _Hazır!_ *${safeTitle}*`, message.jid, downloadMsg.key);
        }
      } catch (error) {
        if (config.DEBUG) console.error("Çalma hatası, yedek yöntem deneniyor:", error.message);

        try {
          if (!downloadMsg) {
            downloadMsg = await message.client.sendMessage(message.jid, { text: "_🔎 Alternatif yöntemle aranıyor..._" });
          } else {
            await message.edit("_🔎 Alternatif yöntemle aranıyor..._", message.jid, downloadMsg.key);
          }

          if (!targetUrl) throw new Error("Geçerli bir bağlantı veya sonuç yok");

          const result = await nexray.downloadYtMp3(targetUrl);
          if (!result || !result.url) throw new Error("Yedek indirme başarısız");

          const safeTitle = censorBadWords(result.title || input);
          await message.edit(`_🔻 İndirilip yükleniyor..._ *${safeTitle}*`, message.jid, downloadMsg.key);

          let thumbUrl = "";
          const match = targetUrl.match(/[?&]v=([^&]+)/) || targetUrl.match(/youtu\.be\/([^?]+)/);
          if (match) thumbUrl = `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;

          await message.client.sendMessage(message.jid, {
            audio: { url: result.url },
            mimetype: "audio/mpeg",
            contextInfo: {
              externalAdReply: {
                title: safeTitle,
                body: "Lades-Pro|Bot",
                mediaType: 2,
                thumbnailUrl: thumbUrl,
                sourceUrl: targetUrl
              }
            }
          }, { quoted: message.data });

          return await message.edit(`✅ _Hazır!_ *${safeTitle}*`, message.jid, downloadMsg.key);
        } catch (fallbackError) {
          console.error("Yedek yöntem hatası:", fallbackError.message);
          if (downloadMsg) {
            await message.edit("❌ *İndirme başarısız! Lütfen tekrar deneyin.*", message.jid, downloadMsg.key);
          } else {
            await message.sendReply("❌ *İndirme başarısız! Lütfen tekrar deneyin.*");
          }
        }
      }
    }
  );

  Module({
    on: "text",
    fromMe: false,
  },
    async (message, match) => {
      const numberMatch = message.text?.trim().match(/^\d+$/);
      if (!numberMatch) return;
      const selectedNumber = parseInt(numberMatch[0]);
      if (
        !message.reply_message ||
        !message.reply_message.fromMe ||
        !message.reply_message.message
      ) {
        return;
      }
      const repliedText = message.reply_message.text || "";
      if (
        repliedText.toLowerCase().includes("youtube arama sonuçları") &&
        repliedText.toLowerCase().includes("ses indirmek için")
      ) {
        if (selectedNumber < 1 || selectedNumber > 10) {
          return await message.sendReply("⚠️ *Lütfen 1-10 arasında bir sayı seçin!*");
        }

        const lines = repliedText.split("\n");
        let videoTitle = null;
        let videoUrl = null;

        try {
          const queryMatch = repliedText.match(
            /_?(\d+) sonuç bulundu:_?\s*\*(.+?)\*/
          );
          if (!queryMatch) return;

          const query = queryMatch[2];
          const results = await nexray.searchYoutube(query);

          if (!results || !results[selectedNumber - 1]) {
            return await message.sendReply("❌ *Geçersiz seçim!*");
          }

          const selectedVideo = results[selectedNumber - 1];
          try {
            const safeTitle = censorBadWords(selectedVideo.title);
            const quotedListKey =
              message.reply_message?.data?.key || message.reply_message?.key;
            const canEditQuotedList = !!quotedListKey;

            if (canEditQuotedList) {
              await message.edit(
                `_🔻 İndirilip yükleniyor..._ *${safeTitle}*`,
                message.jid,
                quotedListKey
              );
            }

            const result = await nexray.downloadYtMp3(selectedVideo.url);
            if (!result || !result.url) throw new Error("Nexray failed");

            await message.client.sendMessage(message.jid, {
              audio: { url: result.url },
              mimetype: "audio/mpeg",
              fileName: `${safeTitle}.mp3`,
            }, { quoted: message.data });

            if (canEditQuotedList) {
              await message.edit(
                `✅ _Hazır!_ *${safeTitle}*`,
                message.jid,
                quotedListKey
              );
            } else {
              await message.sendReply(`✅ _Hazır!_ *${safeTitle}*`);
            }
          } catch (error) {
            console.error("Şarkı indirme hatası:", error);
            const quotedListKey =
              message.reply_message?.data?.key || message.reply_message?.key;
            if (quotedListKey) {
              await message.edit(
                "❌ *İndirme başarısız! Lütfen tekrar deneyin.*",
                message.jid,
                quotedListKey
              );
            } else {
              await message.sendReply("❌ *İndirme başarısız! Lütfen tekrar deneyin.*");
            }
          }
        } catch (error) {
          console.error("Şarkı seçim hatası:", error);
          await message.sendReply("❌ *Seçiminiz işlenemedi!*");
        }
      } else if (
        repliedText.toLowerCase().includes("youtube arama sonuçları") &&
        repliedText.toLowerCase().includes("video detaylarını görüntüle")
      ) {
        if (selectedNumber < 1 || selectedNumber > 10) {
          return await message.sendReply("⚠️ *Lütfen 1-10 arasında bir sayı seçin!*");
        }

        try {
          const queryMatch = repliedText.match(
            /_?(\d+) sonuç bulundu:_?\s*\*(.+?)\*/
          );
          if (!queryMatch) return;

          const query = queryMatch[2];
          const results = await nexray.searchYoutube(query);

          if (!results || !results[selectedNumber - 1]) {
            return await message.sendReply("❌ *Geçersiz seçim!*");
          }

          const selectedVideo = results[selectedNumber - 1];

          const safeTitle = censorBadWords(selectedVideo.title);
          let caption = `_*${safeTitle}*_\n\n`;
          caption += `*Kanal:* ${selectedVideo.channel}\n`;
          caption += `*Süre:* \`${selectedVideo.duration}\`\n`;
          caption += `*Görüntülenme:* \`${selectedVideo.views}\`\n`;
          caption += `*Yükleme:* ${selectedVideo.upload_at || "Bilinmiyor"}\n\n`;
          caption += `*URL:* ${selectedVideo.url}\n\n`;
          caption += "_Yanıtlayın:_\n";
          caption += "*1.* Ses\n";
          caption += "*2.* Video";

          await message.sendReply(selectedVideo.image_url, "image", {
            caption: caption,
          });
        } catch (error) {
          console.error("YouTube video bilgi hatası:", error);
          await message.sendReply("❌ *Video bilgisi alınamadı!*");
        }
      } else if (
        repliedText.includes("Yanıtlayın:") &&
        repliedText.includes("* Ses")
      ) {
        if (selectedNumber !== 1 && selectedNumber !== 2) {
          return await message.sendReply("🎬 _Ses için 1'i Video için 2'yi seçin_"
          );
        }

        try {
          const urlMatch = repliedText.match(/\*URL:\*\s*(https?:\/\/\S+)/m);
          if (!urlMatch) return;

          const url = urlMatch[1].trim();
          const titleMatch = repliedText.match(/_\*([^*]+)\*_/);
          const title = titleMatch ? titleMatch[1] : "Video";

          let downloadMsg;
          let filePath;

          if (selectedNumber === 1) {
            try {
              downloadMsg = await message.sendReply(`🔻 _Ses indiriliyor..._`);

              const result = await nexray.downloadYtMp3(url);
              if (!result || !result.url) throw new Error("Nexray failed");

              await message.edit(
                `🔻🔺 _İndirilip yükleniyor..._ *${censorBadWords(result.title)}*`,
                message.jid,
                downloadMsg.key
              );

              await message.client.sendMessage(message.jid, {
                audio: { url: result.url },
                mimetype: "audio/mpeg",
                fileName: `${censorBadWords(result.title)}.mp3`,
              }, { quoted: message.data });

              await message.edit(
                "✅ _Hazır!_",
                message.jid,
                downloadMsg.key
              );
            } catch (error) {
              console.error("YouTube ses indirme hatası:", error);
              if (downloadMsg) {
                await message.edit(
                  "❌ *İndirme başarısız!*",
                  message.jid,
                  downloadMsg.key
                );
              }
            }
          } else if (selectedNumber === 2) {
            try {
              downloadMsg = await message.sendReply(`_⬇️ Video indiriliyor..._`);

              const result = await nexray.downloadYtMp4(url);
              if (!result || !result.url) throw new Error("Nexray failed");

              const safeTitle = censorBadWords(result.title);
              await message.edit(
                `🔻🔺 _İndirilip yükleniyor..._ *${safeTitle}*`,
                message.jid,
                downloadMsg.key
              );

              await message.client.sendMessage(message.jid, {
                video: { url: result.url },
                mimetype: "video/mp4",
                caption: `_*${safeTitle}*_\n\n_Nexray Downloader_`,
              }, { quoted: message.data });

              await message.edit(
                "✅ _Hazır!_",
                message.jid,
                downloadMsg.key
              );
            } catch (error) {
              console.error("YouTube video indirme hatası:", error);
              if (downloadMsg) {
                await message.edit(
                  "❌ *İndirme başarısız!*",
                  message.jid,
                  downloadMsg.key
                );
              }
            }
          }
        } catch (error) {
          console.error("YouTube indirme seçim hatası:", error);
          await message.sendReply("❌ *İndirme işlemi başarısız oldu!*");
        }
      } else if (
        repliedText.toLowerCase().includes("youtube arama sonuçları") &&
        repliedText.toLowerCase().includes("videoyu indirmek için")
      ) {
        if (selectedNumber < 1 || selectedNumber > 10) {
          return await message.sendReply("⚠️ *Lütfen 1-10 arasında bir sayı seçin!*");
        }

        try {
          const queryMatch = repliedText.match(
            /_?(\d+) sonuç bulundu:_?\s*\*(.+?)\*/
          );
          if (!queryMatch) return;

          const query = queryMatch[2];
          const results = await nexray.searchYoutube(query);

          if (!results || !results[selectedNumber - 1]) {
            return await message.sendReply("❌ *Geçersiz seçim!*");
          }

          const selectedVideo = results[selectedNumber - 1];
          let downloadMsg;

          try {
            const safeTitle = censorBadWords(selectedVideo.title);
            downloadMsg = await message.sendReply(
              `⏳ _Video bilgileri alınıyor..._ *${safeTitle}*`
            );

            const info = await getVideoInfo(selectedVideo.url);
            const videoFormats = info.formats
              .filter((f) => f.type === "video" && f.quality)
              .sort((a, b) => {
                const getRes = (q) => {
                  const match = q.match(/(\d+)/);
                  return match ? parseInt(match[1]) : 0;
                };
                return getRes(b.quality) - getRes(a.quality);
              });

            if (videoFormats.length === 0) {
              return await message.edit("❌ *Bu video için uygun format bulunamadı!*", message.jid, downloadMsg.key);
            }

            const uniqueQualities = [...new Set(videoFormats.map((f) => f.quality))];

            let qualityText = "✨ _*Video Kalitesini Seçin*_\n\n";
            qualityText += `✍🏻 _*${safeTitle}*_\n\n(${selectedVideo.id})\n\n`;

            uniqueQualities.forEach((quality, index) => {
              const format = videoFormats.find((f) => f.quality === quality);
              const audioFormat = info.formats.find((f) => f.type === "audio");

              let sizeInfo = "";
              if (format.size && audioFormat?.size) {
                const parseSize = (sizeStr) => {
                  if (!sizeStr) return 0;
                  const match = sizeStr.match(/([\d.]+)\s*(KB|MB|GB)/i);
                  if (!match) return 0;
                  const value = parseFloat(match[1]);
                  const unit = match[2].toUpperCase();
                  if (unit === "KB") return value * 1024;
                  if (unit === "MB") return value * 1024 * 1024;
                  if (unit === "GB") return value * 1024 * 1024 * 1024;
                  return value;
                };
                const totalSize = parseSize(format.size) + parseSize(audioFormat.size);
                if (totalSize > 0) sizeInfo = ` ~ _${formatBytes(totalSize)}_`;
              }
              qualityText += `*${index + 1}.* _*${quality}*_${sizeInfo}\n`;
            });

            const audioFormat = info.formats.find((f) => f.type === "audio");
            if (audioFormat) {
              let audioSizeInfo = "";
              if (audioFormat.size) {
                const match = audioFormat.size.match(/([\d.]+)\s*(KB|MB|GB)/i);
                if (match) {
                  let value = parseFloat(match[1]);
                  let unit = match[2].toUpperCase();
                  if (unit === "KB") value *= 1024;
                  if (unit === "MB") value *= 1024 * 1024;
                  if (unit === "GB") value *= 1024 * 1024 * 1024;
                  if (value > 0) audioSizeInfo = ` ~ _${formatBytes(value)}_`;
                }
              }
              qualityText += `*${uniqueQualities.length + 1}.* _*Sadece Ses*_${audioSizeInfo}\n`;
            }

            qualityText += "\n▶️ _İndirmek için seçiminizi bir numara ile yanıtlayın._";

            await message.edit(qualityText, message.jid, downloadMsg.key);
          } catch (error) {
            console.error("Video bilgi alma hatası:", error);
            if (downloadMsg) {
              await message.edit(
                "❌ *İndirme başarısız! Lütfen tekrar deneyin.*",
                message.jid,
                downloadMsg.key
              );
            }
          }
        } catch (error) {
          console.error("Video seçim hatası:", error);
          await message.sendReply("❌ *Seçiminiz işlenemedi!*");
        }
      } else if (
        /(Video Kalitesini Seç|Standart Mod)/i.test(repliedText) &&
        repliedText.includes("İndirmek için seçiminizi bir numara ile yanıtlayın")
      ) {
        try {
          const lines = repliedText.split("\n");
          let videoId = "";

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Pattern 1: (videoId)
            if (line.startsWith("(") && line.endsWith(")") && line.length >= 13 && !line.match(/^\*\d+\./)) {
              videoId = line.replace(/[()]/g, "").trim();
            }
            // Pattern 2: ID: videoId or ID: `videoId`
            else if (line.startsWith("ID:") || line.includes("ID: `")) {
              const match = line.match(/ID:\s*`?([A-Za-z0-9_-]{10,15})`?/);
              if (match) videoId = match[1];
            }

            if (videoId.length >= 10) break;
          }

          if (!videoId || videoId.length < 10) {
            return await message.sendReply("❌ *Video kimliği (ID) alınamadı! Lütfen tekrar deneyin.*");
          }

          const url = `https://www.youtube.com/watch?v=${videoId}`;
          const titleMatch = repliedText.match(/_\*([^*]+)\*_/);
          if (!titleMatch) return;

          const qualityLines = lines.filter((line) => line.match(/^\*\d+\./));

          if (!qualityLines[selectedNumber - 1]) {
            return await message.sendReply("❌ *Geçersiz kalite seçimi!*");
          }

          const selectedLine = qualityLines[selectedNumber - 1];
          const isAudioOnly = selectedLine.includes("Sadece Ses");

          if (isAudioOnly) {
            let downloadMsg;
            let audioPath;

            try {
              downloadMsg = await message.sendReply("🔻✨ _Yüksek kaliteli ses indiriliyor..._");

              const result = await downloadAudio(url);
              audioPath = result.path;

              const mp3Path = await convertM4aToMp3(audioPath);
              audioPath = mp3Path;

              await message.edit("🔻🔺 _İndirilip yükleniyor..._", message.jid, downloadMsg.key);

              const safeTitle = censorBadWords(result.title);
              const stream = fs.createReadStream(audioPath);
              await message.sendMessage({ stream }, "document", {
                fileName: `${safeTitle}.mp3`,
                mimetype: "audio/mpeg",
                caption: `_*${safeTitle}*_`,
              });
              stream.destroy();

              await message.edit("✅ *Ses başarıyla indirildi!*", message.jid, downloadMsg.key);

              await new Promise((resolve) => setTimeout(resolve, 100));
              if (fs.existsSync(audioPath)) {
                try { fs.unlinkSync(audioPath); } catch (_) { }
              }
            } catch (error) {
              console.error("YouTube video ses indirme hatası:", error);
              try {
                if (downloadMsg) await message.edit("⚠️ _Beklenmedik bir sorun oluştu, 2. Yöntem deneniyor..._", message.jid, downloadMsg.key);
                else downloadMsg = await message.sendReply("⚠️ _2. Yöntem deneniyor..._");

                const fallback = await nexray.downloadYtMp3(url);
                if (fallback?.url) {
                  const safeTitle = censorBadWords(fallback.title || "Ses");
                  await message.edit(`🔻🔺 _İndirilip yükleniyor..._ *${safeTitle}*`, message.jid, downloadMsg.key);
                  await message.client.sendMessage(message.jid, {
                    audio: { url: fallback.url },
                    mimetype: "audio/mpeg",
                    fileName: `${safeTitle}.mp3`,
                    caption: `_*${safeTitle}*_`
                  }, { quoted: message.data });

                  await message.edit("✅ *Ses başarıyla indirildi!*", message.jid, downloadMsg.key);
                } else {
                  throw new Error("Fallback failed");
                }
              } catch (fallbackError) {
                console.error("Fallback error:", fallbackError);
                if (downloadMsg) await message.edit("❌ *İndirme başarısız!*", message.jid, downloadMsg.key);
              }
              if (audioPath && fs.existsSync(audioPath)) {
                try { fs.unlinkSync(audioPath); } catch (_) { }
              }
            }
          } else {
            const qualityMatch = selectedLine.match(/(\d+p)/);
            if (!qualityMatch) return;

            const selectedQuality = qualityMatch[1];
            let downloadMsg;
            let videoPath;

            try {
              downloadMsg = await message.sendReply(`🔻 _*\`${selectedQuality}\`* kalitesinde video indiriliyor..._`);

              const result = await downloadVideo(url, selectedQuality);
              videoPath = result.path;

              await message.edit("🔻🔺 _İndirilip yükleniyor..._", message.jid, downloadMsg.key);

              const stats = fs.statSync(videoPath);
              const safeTitle = censorBadWords(result.title);

              if (stats.size > VIDEO_SIZE_LIMIT) {
                const stream = fs.createReadStream(videoPath);
                await message.sendMessage({ stream }, "document", {
                  fileName: `${safeTitle}.mp4`,
                  mimetype: "video/mp4",
                  caption: `_*${safeTitle}*_\n\n ✨_Kalite: ${selectedQuality}_`,
                });
                stream.destroy();
              } else {
                const stream = fs.createReadStream(videoPath);
                await message.sendReply({ stream }, "video", {
                  caption: `_*${safeTitle}*_\n\n✨ _Kalite: ${selectedQuality}_`,
                });
                stream.destroy();
              }

              await message.edit("✅ *Video başarıyla indirildi!*", message.jid, downloadMsg.key);

              await new Promise((resolve) => setTimeout(resolve, 100));
              if (fs.existsSync(videoPath)) {
                try { fs.unlinkSync(videoPath); } catch (_) { }
              }
            } catch (error) {
              console.error("YouTube video kalite indirme hatası:", error);
              try {
                if (downloadMsg) await message.edit("⚠️ _Belirtilen kalitede sorun oluştu, 2. Yöntem deneniyor..._", message.jid, downloadMsg.key);
                else downloadMsg = await message.sendReply("♻️ _2. Yöntem deneniyor..._");

                const fallback = await nexray.downloadYtMp4(url);
                if (fallback?.url) {
                  const safeTitle = censorBadWords(fallback.title || "Video");
                  await message.edit(`♻️ _Yedek yöntemle indiriliyor..._ *${safeTitle}*`, message.jid, downloadMsg.key);
                  await message.sendReply({ url: fallback.url }, "video", {
                    caption: `_*${safeTitle}*_\n\n_✨ Otomatik kalite seçildi._`,
                  });
                  await message.edit("✅ *Video başarıyla indirildi!*", message.jid, downloadMsg.key);
                } else {
                  throw new Error("Fallback failed");
                }
              } catch (fallbackError) {
                console.error("Fallback video error:", fallbackError);
                if (downloadMsg) await message.edit("❌ *İndirme başarısız!*", message.jid, downloadMsg.key);
              }

              if (videoPath && fs.existsSync(videoPath)) {
                try { fs.unlinkSync(videoPath); } catch (_) { }
              }
            }
          }
        } catch (error) {
          console.error("YouTube kalite seçim hatası:", error);
          await message.sendReply("❌ *Kalite seçimi işlenemedi!*_");
        }
      }
    }
  );
})();

// ==========================================
// FILE: siputzx-dl.js
// ==========================================
(function () {
  /**
   * plugins/siputzx-dl.js
   * Siputzx API - Medya İndirme Komutları (Downloaders)
   * Tüm çıktılar %100 Türkçe
   */
  const { Module } = require("../main");
  const axios = require("axios");
  const { extractUrls } = require("../core/yardimcilar");

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
    if (!url) return await message.sendReply("⚠️ *Bağlantı girin:* `.savefrom [URL]`");

    try {
      await message.sendReply("⏳ _Medya indiriliyor..._");
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
      await message.sendReply(`❌ *İndirme başarısız!* \n\n*Hata:* ${e.message}`);
    }
  });
})();

