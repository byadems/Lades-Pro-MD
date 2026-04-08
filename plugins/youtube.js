const { Module } = require("../main");
const fs = require("fs");
const path = require("path");
const {
  downloadVideo,
  downloadAudio,
  searchYoutube,
  getVideoInfo,
  convertM4aToMp3,
} = require("./utils/yt");
const { censorBadWords } = require("./utils");
const nexray = require("./utils/nexray");

const config = require("../config");
const { bytesToSize: formatBytes } = require("./utils");
const { extractUrls, validateUrl } = require("../core/helpers");

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
  use: "download",
},
  async (message, match) => {
    const input = match[1] || message.reply_message?.text;
    if (!input) {
      return await message.sendReply(
        "_⚠️ Lütfen bir şarkı adı veya Spotify bağlantısı girin!_\n_Örnek: .spotify despacito veya .spotify https://open.spotify.com/track/xxxx_"
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
           return await message.sendReply("_❌ Lütfen geçerli bir Spotify bağlantısı girin._");
        }
        
        downloadMsg = await message.sendReply("_⏳ Spotify'dan indiriliyor..._");
        const result = await nexray.downloadSpotify(url);

        if (!result || !result.url) {
          return await message.edit("_❌ Şarkı indirilemedi veya geçersiz bağlantı!_", message.jid, downloadMsg.key);
        }

        const safeTitle = censorBadWords(result.title || "Spotify Track");
        const safeArtist = censorBadWords(result.artist || "Bilinmiyor");

        await message.edit(`_📤 *${safeArtist}* - *${safeTitle}* yükleniyor..._`, message.jid, downloadMsg.key);

        await message.client.sendMessage(message.jid, {
          audio: { url: result.url },
          mimetype: "audio/mpeg",
          fileName: `${safeArtist} - ${safeTitle}.mp3`,
        }, { quoted: message.data });

        return await message.edit("_✅ İndirme tamamlandı!_", message.jid, downloadMsg.key);
      } else {
        downloadMsg = await message.sendReply("_🔍 Spotify'da aranıyor..._");
        const result = await nexray.spotifyPlay(input);

        if (!result || !result.url) {
          return await message.edit("_❌ Şarkı bulunamadı!_", message.jid, downloadMsg.key);
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

        return await message.edit("_✅ İndirme tamamlandı!_", message.jid, downloadMsg.key);
      }
    } catch (error) {
      console.error("Spotify indirme hatası:", error);
      if (downloadMsg) {
        await message.edit("_❌ Spotify işlemi başarısız oldu!_", message.jid, downloadMsg.key);
      } else {
        await message.sendReply("_❌ Spotify işlemi başarısız oldu._");
      }
    }
  }
);

Module({
  pattern: "ytara ?(.*)",
  fromMe: false,
  desc: "YouTube üzerinde detaylı arama yaparak video ve kanal bilgilerini listeler.",
  usage: ".ytara [sorgu]",
  use: "download",
},
  async (message, match) => {
    const query = match[1];
    if (!query) {
      return await message.sendReply("_⚠️ Lütfen aranacak kelimeyi girin!_\n_Örnek: .ytara Eşref Rüya_"
      );
    }

    try {
      const searchMsg = await message.sendReply("_🔍 YouTube'da aranıyor..._");
      const results = await nexray.searchYoutube(query);

      if (!results || results.length === 0) {
        return await message.edit(
          "_❌ Sonuç bulunamadı!_",
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
      await message.sendReply("_❌ Arama başarısız oldu. Lütfen daha sonra tekrar deneyin._");
    }
  }
);

Module({
  pattern: "ytvideo ?(.*)",
  fromMe: false,
  desc: "YouTube videolarını kalite seçeneği sunarak (360p, 1080p vb.) indirmenizi sağlar.",
  usage: ".ytvideo [sorgu/bağlantı]",
  use: "download",
},
  async (message, match) => {
    let input = (match[1] || message.reply_message?.text || "").trim();
    if (!input) {
      return await message.sendReply("_⚠️ Lütfen video adını veya bağlantısını yazın!_\n_Örnek: .ytvideo kedi videoları_");
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
        const searchMsg = await message.sendReply("_🔍 YouTube'da aranıyor..._");
        const results = await nexray.searchYoutube(input);

        if (!results || results.length === 0) {
          return await message.edit("_❌ Sonuç bulunamadı!_", message.jid, searchMsg.key);
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
        return await message.sendReply("_❌ Arama başarısız oldu, farklı şekilde deneyin._");
      }
    }

    let downloadMsg;
    let videoPath;

    try {
      downloadMsg = await message.sendReply("_🔻 Video bilgileri alınıyor..._");
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
          "_❌ Bu video için uygun format bulunamadı._",
          message.jid,
          downloadMsg.key
        );
      }

      const uniqueQualities = [...new Set(videoFormats.map((f) => f.quality))];

      const videoIdMatch = url.match(
        /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([^&\s/?]+)/
      );
      const videoId = videoIdMatch ? videoIdMatch[1] : info.videoId || "";

      let qualityText = "✨ _Video Kalitesini Seçiniz_\n\n";
      qualityText += `✍🏻 _*${censorBadWords(info.title)}*_\n\n(${videoId})\n\n`;

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
      console.error("YouTube ytvideo indirme hatası:", error);
      if (downloadMsg) {
        await message.edit("_❌ İndirme başarısız! Lütfen tekrar deneyin._", message.jid, downloadMsg.key);
      } else {
        await message.sendReply("_❌ İndirme başarısız oldu. Lütfen tekrar deneyin._");
      }

      if (videoPath && fs.existsSync(videoPath)) {
        try { fs.unlinkSync(videoPath); } catch (_) { }
      }
    }
  }
);

Module({
  pattern: "video ?(.*)",
  fromMe: false,
  desc: "YouTube videolarını en hızlı ve en yüksek kalitede doğrudan indirir.",
  usage: ".video [sorgu/bağlantı]",
  use: "download",
},
  async (message, match) => {
    let input = (match[1] || message.reply_message?.text || "").trim();
    if (!input) {
      return await message.sendReply("_⚠️ Lütfen video adını veya bağlantısını yazın!_\n_Örnek: .video kedi videoları_");
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

    try {
      if (normalizedUrl) {
        downloadMsg = await message.sendReply("_🔻 Video bilgileri alınıyor..._");

        let highestQuality = "360p";
        try {
          const info = await getVideoInfo(normalizedUrl);
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
        const result = await downloadVideo(normalizedUrl, highestQuality);
        videoPath = result.path;

        await message.edit("_📤 Video yükleniyor..._", message.jid, downloadMsg.key);

        const stats = fs.statSync(videoPath);
        const safeTitle = censorBadWords(result.title);

        let metadataStr = "";
        try {
          metadataStr = `_Kanal:_ ${info.channel || "Bilinmiyor"}\n_Süre:_ \`${info.duration || "Bilinmiyor"}\` | _Görüntülenme:_ \`${info.views || "Bilinmiyor"}\`\n\n`;
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

        await message.edit("_✅ İstek tamamlandı!_", message.jid, downloadMsg.key);

        await new Promise((resolve) => setTimeout(resolve, 100));
        if (fs.existsSync(videoPath)) {
          fs.unlinkSync(videoPath);
        }
      } else {
        downloadMsg = await message.sendReply("_🔍 Video aranıyor..._");
        const result = await nexray.ytPlayVid(input);

        if (!result || !result.url) {
          return await message.edit("_❌ Sonuç bulunamadı!_", message.jid, downloadMsg.key);
        }

        const safeTitle = censorBadWords(result.title || input);
        await message.edit(`_🔻 İndirilip yükleniyor..._ *${safeTitle}*`, message.jid, downloadMsg.key);

        await message.sendReply({ url: result.url }, "video", {
          caption: `_*${safeTitle}*_`,
        });

        await message.edit(`_✅ Hazır!_ *${safeTitle}*`, message.jid, downloadMsg.key);
      }
    } catch (error) {
      if (normalizedUrl) {
        try {
          const fallback = await nexray.downloadYtMp4(normalizedUrl);
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
            await message.edit(`_✅ Hazır!_ *${safeTitle}*`, message.jid, downloadMsg.key);
            return;
          }
        } catch (_) { }
      }

      console.error("Video indirme hatası:", error);
      if (downloadMsg) {
        await message.edit("_❌ İndirme başarısız!_", message.jid, downloadMsg.key);
      } else {
        await message.sendReply("_❌ İndirme başarısız oldu. Lütfen tekrar deneyin._");
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
  use: "download",
},
  async (message, match) => {
    let url = match[1] || message.reply_message?.text;

    if (url && /\bhttps?:\/\/\S+/gi.test(url)) {
      url = url.match(/\bhttps?:\/\/\S+/gi)[0];
    }

    if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
      return await message.sendReply("_⚠️ Lütfen geçerli bir YouTube bağlantısı verin!_\n_Örnek: .ytsesb https://youtube.com/watch?v=xxxxx_"
      );
    }

    // Convert YouTube Shorts URL to regular watch URL if needed
    if (url.includes("youtube.com/shorts/")) {
      const shortId = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/)?.[1];
      if (shortId) {
        url = `https://www.youtube.com/watch?v=${shortId}`;
      }
    }

    let downloadMsg;
    let audioPath;

    try {
      downloadMsg = await message.sendReply("_⬇️ Ses indiriliyor..._");
      const result = await downloadAudio(url);
      audioPath = result.path;

      const mp3Path = await convertM4aToMp3(audioPath);
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

      await message.edit("_✅ İndirme tamamlandı!_", message.jid, downloadMsg.key);

      await new Promise((resolve) => setTimeout(resolve, 100));
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
    } catch (error) {
      console.error("YouTube ses indirme hatası:", error);
      if (downloadMsg) {
        await message.edit("_❌ İndirme başarısız!_", message.jid, downloadMsg.key);
      } else {
        await message.sendReply("_❌ İndirme başarısız oldu. Lütfen tekrar deneyin._");
      }

      if (audioPath && fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
    }
  }
);

Module({
  pattern: "şarkı ?(.*)",
  fromMe: false,
  desc: "YouTube üzerinden ses/şarkı indirir. (anahtar kelime veya bağlantı ile)",
  usage: ".şarkı <sorgu/bağlantı> | .şarkıara <sorgu>",
  use: "download",
},
  async (message, match) => {
    let input = (match[1] || message.reply_message?.text || "").trim();
    if (!input) {
      return await message.sendReply("_⚠️ Lütfen şarkı adı veya bağlantısı yazın!_\n🎶 _Örnek: .şarkı Duman - Bu Akşam_");
    }

    // Handle "ara" subcommand
    if (input.toLowerCase().startsWith("ara")) {
      const query = input.slice(4).trim();
      if (!query) return await message.sendReply("_⚠️ Lütfen aranacak kelimeyi girin!_");

      try {
        const searchMsg = await message.sendReply("_🔍 YouTube'da aranıyor..._");
        const results = await nexray.searchYoutube(query);

        if (!results || results.length === 0) {
          return await message.edit("_❌ Sonuç bulunamadı!_", message.jid, searchMsg.key);
        }

        let resultText = "🎵 YouTube Arama Sonuçları\n\n";
        resultText += `🔎 _${results.length} sonuç bulundu:_ *${query}*\n\n`;

        results.slice(0, 10).forEach((video, index) => {
          resultText += `*${index + 1}.* ${censorBadWords(video.title)}\n`;
          resultText += `   _Süre:_ \`${video.duration}\` | _Görüntülenme:_ \`${video.views}\`\n`;
          resultText += `   _Kanal:_ ${video.channel}\n\n`;
        });

        resultText += "▶️ _Ses indirmek için bir numara (1-10) ile yanıtlayın._";
        return await message.edit(resultText, message.jid, searchMsg.key);
      } catch (error) {
        console.error("Şarkı arama hatası:", error);
        return await message.sendReply("_❌ Arama başarısız oldu._");
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

    try {
      if (normalizedUrl) {
        downloadMsg = await message.sendReply("_🔻 İndirilip yükleniyor..._");
        const result = await nexray.downloadYtMp3(normalizedUrl);
        if (!result || !result.url) throw new Error("Nexray failed");

        const safeTitle = censorBadWords(result.title);
        await message.client.sendMessage(message.jid, {
          audio: { url: result.url },
          mimetype: "audio/mpeg",
          fileName: `${safeTitle}.mp3`,
        }, { quoted: message.data });

        return await message.edit(`_✅ Hazır!_ *${safeTitle}*`, message.jid, downloadMsg.key);
      } else {
        downloadMsg = await message.sendReply("_🔍 Aranıyor..._");
        const result = await nexray.ytPlayAud(input);
        if (!result || !result.url) {
          return await message.edit("_❌ Sonuç bulunamadı!_", message.jid, downloadMsg.key);
        }

        const safeTitle = censorBadWords(result.title || input);

        await message.edit(`_🔻 İndirilip yükleniyor..._ *${safeTitle}*`, message.jid, downloadMsg.key);

        await message.client.sendMessage(message.jid, {
          audio: { url: result.url },
          mimetype: "audio/mpeg",
          fileName: `${safeTitle}.mp3`,
        }, { quoted: message.data });

        return await message.edit(`_✅ Hazır!_ *${safeTitle}*`, message.jid, downloadMsg.key);
      }
    } catch (error) {
      if (config.DEBUG) console.error("Çalma hatası, yedek yöntem deneniyor:", error.message);

      try {
        if (!downloadMsg) {
          downloadMsg = await message.sendReply("_🔎 Alternatif yöntemle aranıyor..._");
        } else {
          await message.edit("_🔎 Alternatif yöntemle aranıyor..._", message.jid, downloadMsg.key);
        }

        let result;
        if (normalizedUrl) {
          result = await nexray.downloadYtMp3(normalizedUrl);
        } else {
          result = await nexray.ytPlayAud(input);
        }

        if (!result || !result.url) throw new Error("Nexray failed");

        const safeTitle = censorBadWords(result.title);
        await message.edit(`_🔻 İndirilip yükleniyor..._ *${safeTitle}*`, message.jid, downloadMsg.key);

        await message.client.sendMessage(message.jid, {
          audio: { url: result.url },
          mimetype: "audio/mpeg",
          fileName: `${safeTitle}.mp3`,
        }, { quoted: message.data });

        return await message.edit(`_✅ Hazır!_ *${safeTitle}*`, message.jid, downloadMsg.key);
      } catch (fallbackError) {
        console.error("Yedek yöntem hatası:", fallbackError.message);
        if (downloadMsg) {
          await message.edit("_⚠️ İndirme başarısız! Lütfen tekrar deneyin._", message.jid, downloadMsg.key);
        } else {
          await message.sendReply("_⚠️ İndirme başarısız! Lütfen tekrar deneyin._");
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
    const numberMatch = message.text?.match(/^\d+$/);
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
        return await message.sendReply("_⚠️ Lütfen 1-10 arasında bir sayı seçin_");
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
          return await message.sendReply("_❌ Geçersiz seçim!_");
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
              `_✅ Hazır!_ *${safeTitle}*`,
              message.jid,
              quotedListKey
            );
          } else {
            await message.sendReply(`_✅ Hazır!_ *${safeTitle}*`);
          }
        } catch (error) {
          console.error("Şarkı indirme hatası:", error);
          const quotedListKey =
            message.reply_message?.data?.key || message.reply_message?.key;
          if (quotedListKey) {
            await message.edit(
              "_⚠️ İndirme başarısız! Lütfen tekrar deneyin._",
              message.jid,
              quotedListKey
            );
          } else {
            await message.sendReply("_⚠️ İndirme başarısız! Lütfen tekrar deneyin._");
          }
        }
      } catch (error) {
        console.error("Şarkı seçim hatası:", error);
        await message.sendReply("_❌ Seçiminiz işlenemedi._");
      }
    } else if (
      repliedText.toLowerCase().includes("youtube arama sonuçları") &&
      repliedText.toLowerCase().includes("video detaylarını görüntüle")
    ) {
      if (selectedNumber < 1 || selectedNumber > 10) {
        return await message.sendReply("_⚠️ Lütfen 1-10 arasında bir sayı seçin_");
      }

      try {
        const queryMatch = repliedText.match(
          /_?(\d+) sonuç bulundu:_?\s*\*(.+?)\*/
        );
        if (!queryMatch) return;

        const query = queryMatch[2];
        const results = await nexray.searchYoutube(query);

        if (!results || !results[selectedNumber - 1]) {
          return await message.sendReply("_❌ Geçersiz seçim!_");
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
        await message.sendReply("_🎬 Video bilgisi alınamadı._");
      }
    } else if (
      repliedText.includes("Yanıtlayın:") &&
      repliedText.includes("* Ses")
    ) {
      if (selectedNumber !== 1 && selectedNumber !== 2) {
        return await message.sendReply("_🎬 Ses için 1'i Video için 2'yi seçin_"
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
            downloadMsg = await message.sendReply(`_⬇️ Ses indiriliyor..._`);

            const result = await nexray.downloadYtMp3(url);
            if (!result || !result.url) throw new Error("Nexray failed");

            await message.edit(
              `_🔻 İndirilip yükleniyor..._ *${censorBadWords(result.title)}*`,
              message.jid,
              downloadMsg.key
            );

            await message.client.sendMessage(message.jid, {
              audio: { url: result.url },
              mimetype: "audio/mpeg",
              fileName: `${censorBadWords(result.title)}.mp3`,
            }, { quoted: message.data });

            await message.edit(
              `_✅ Hazır!_`,
              message.jid,
              downloadMsg.key
            );
          } catch (error) {
            console.error("YouTube ses indirme hatası:", error);
            if (downloadMsg) {
              await message.edit(
                "_❌ İndirme başarısız!_",
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
              `_🔻 İndirilip yükleniyor..._ *${safeTitle}*`,
              message.jid,
              downloadMsg.key
            );

            await message.client.sendMessage(message.jid, {
              video: { url: result.url },
              mimetype: "video/mp4",
              caption: `_*${safeTitle}*_\n\n_Nexray Downloader_`,
            }, { quoted: message.data });

            await message.edit(
              `_✅ Hazır!_`,
              message.jid,
              downloadMsg.key
            );
          } catch (error) {
            console.error("YouTube video indirme hatası:", error);
            if (downloadMsg) {
              await message.edit(
                "_❌ İndirme başarısız!_",
                message.jid,
                downloadMsg.key
              );
            }
          }
        }
      } catch (error) {
        console.error("YouTube indirme seçim hatası:", error);
        await message.sendReply("_❌ İndirme işlemi başarısız oldu._");
      }
    } else if (
      repliedText.toLowerCase().includes("youtube arama sonuçları") &&
      repliedText.toLowerCase().includes("videoyu indirmek için")
    ) {
      if (selectedNumber < 1 || selectedNumber > 10) {
        return await message.sendReply("_⚠️ Lütfen 1-10 arasında bir sayı seçin_");
      }

      try {
        const queryMatch = repliedText.match(
          /_?(\d+) sonuç bulundu:_?\s*\*(.+?)\*/
        );
        if (!queryMatch) return;

        const query = queryMatch[2];
        const results = await nexray.searchYoutube(query);

        if (!results || !results[selectedNumber - 1]) {
          return await message.sendReply("_❌ Geçersiz seçim!_");
        }

        const selectedVideo = results[selectedNumber - 1];
        let downloadMsg;

        try {
          const safeTitle = censorBadWords(selectedVideo.title);
          downloadMsg = await message.sendReply(
            `_📊 Video bilgileri alınıyor..._ *${safeTitle}*`
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
            return await message.edit("_❌ Bu video için uygun format bulunamadı._", message.jid, downloadMsg.key);
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
              "_⚠️ İndirme başarısız! Lütfen tekrar deneyin._",
              message.jid,
              downloadMsg.key
            );
          }
        }
      } catch (error) {
        console.error("Video seçim hatası:", error);
        await message.sendReply("_❌ Seçiminiz işlenemedi._");
      }
    } else if (
      repliedText.includes("Video Kalitesini Seçin") &&
      repliedText.includes("İndirmek için seçiminizi bir numara ile yanıtlayın")
    ) {
      try {
        const lines = repliedText.split("\n");
        let videoId = "";

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();

          if (
            line.startsWith("(") &&
            line.endsWith(")") &&
            line.length >= 13 &&
            !line.match(/^\*\d+\./)
          ) {
            videoId = line.replace(/[()]/g, "").trim();
            if (videoId.length >= 10) break;
          }
        }

        if (!videoId || videoId.length < 10) {
          return await message.sendReply("_🎬 Video kimliği alınamadı._");
        }

        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const titleMatch = repliedText.match(/_\*([^*]+)\*_/);
        if (!titleMatch) return;

        const qualityLines = lines.filter((line) => line.match(/^\*\d+\./));

        if (!qualityLines[selectedNumber - 1]) {
          return await message.sendReply("_❌ Geçersiz kalite seçimi!_");
        }

        const selectedLine = qualityLines[selectedNumber - 1];
        const isAudioOnly = selectedLine.includes("Sadece Ses");

        if (isAudioOnly) {
          let downloadMsg;
          let audioPath;

          try {
            downloadMsg = await message.sendReply("_⬇️ Yüksek kaliteli ses indiriliyor..._");

            const result = await downloadAudio(url);
            audioPath = result.path;

            const mp3Path = await convertM4aToMp3(audioPath);
            audioPath = mp3Path;

            await message.edit("_🔻 İndirilip yükleniyor..._", message.jid, downloadMsg.key);

            const safeTitle = censorBadWords(result.title);
            const stream = fs.createReadStream(audioPath);
            await message.sendMessage({ stream }, "document", {
              fileName: `${safeTitle}.mp3`,
              mimetype: "audio/mpeg",
              caption: `_*${safeTitle}*_`,
            });
            stream.destroy();

            await message.edit("_✅ Hazır!_", message.jid, downloadMsg.key);

            await new Promise((resolve) => setTimeout(resolve, 100));
            if (fs.existsSync(audioPath)) {
              try { fs.unlinkSync(audioPath); } catch (_) { }
            }
          } catch (error) {
            console.error("YouTube video ses indirme hatası:", error);
            try {
              if (downloadMsg) await message.edit("_🔎 Alternatif yöntemle deneniyor..._", message.jid, downloadMsg.key);
              else downloadMsg = await message.sendReply("_🔎 Alternatif yöntemle deneniyor..._");

              const fallback = await nexray.downloadYtMp3(url);
              if (fallback?.url) {
                const safeTitle = censorBadWords(fallback.title || "Ses");
                await message.edit(`_🔻 İndirilip yükleniyor..._ *${safeTitle}*`, message.jid, downloadMsg.key);
                await message.client.sendMessage(message.jid, {
                  audio: { url: fallback.url },
                  mimetype: "audio/mpeg",
                  fileName: `${safeTitle}.mp3`,
                }, { quoted: message.data });

                await message.edit("_✅ Hazır!_", message.jid, downloadMsg.key);
              } else {
                throw new Error("Fallback failed");
              }
            } catch (fallbackError) {
              console.error("Fallback error:", fallbackError);
              if (downloadMsg) await message.edit("_İndirme başarısız!_", message.jid, downloadMsg.key);
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
            downloadMsg = await message.sendReply(`_⬇️ *\`${selectedQuality}\`* kalitesinde video indiriliyor..._`);

            const result = await downloadVideo(url, selectedQuality);
            videoPath = result.path;

            await message.edit("_🔻 İndirilip yükleniyor..._", message.jid, downloadMsg.key);

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

            await message.edit("_✅ Hazır!_", message.jid, downloadMsg.key);

            await new Promise((resolve) => setTimeout(resolve, 100));
            if (fs.existsSync(videoPath)) {
              try { fs.unlinkSync(videoPath); } catch (_) { }
            }
          } catch (error) {
            console.error("YouTube video kalite indirme hatası:", error);
            try {
              if (downloadMsg) await message.edit("_🔎 Alternatif yöntemle deneniyor..._", message.jid, downloadMsg.key);
              else downloadMsg = await message.sendReply("_🔎 Alternatif yöntemle deneniyor..._");

              const fallback = await nexray.downloadYtMp4(url);
              if (fallback?.url) {
                const safeTitle = censorBadWords(fallback.title || "Video");
                await message.edit(`_🔻 İndirilip yükleniyor..._ *${safeTitle}*`, message.jid, downloadMsg.key);
                await message.sendReply({ url: fallback.url }, "video", {
                  caption: `_*${safeTitle}*_\n\n✨ _Kalite: ${selectedQuality}_`,
                });
                await message.edit("_✅ Hazır!_", message.jid, downloadMsg.key);
              } else {
                throw new Error("Fallback failed");
              }
            } catch (fallbackError) {
              console.error("Fallback video error:", fallbackError);
              if (downloadMsg) await message.edit("_İndirme başarısız!_", message.jid, downloadMsg.key);
            }

            if (videoPath && fs.existsSync(videoPath)) {
              try { fs.unlinkSync(videoPath); } catch (_) { }
            }
          }
        }
      } catch (error) {
        console.error("YouTube kalite seçim hatası:", error);
        await message.sendReply("_❌ Kalite seçimi işlenemedi._");
      }
    }
  }
);
