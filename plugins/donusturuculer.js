const { Module } = require("../main");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegStatic);

const {
  bass,
  sticker,
  addExif,
  attp,
  gtts,
  gis,
  aiTTS,
  getBuffer,
  trToEn,
  nx,
} = require("./utils");
const config = require("../config");
const axios = require("axios");
const fileType = require("file-type");
const { getTempPath, getTempSubdir, ffmpegLimit } = require("../core/yardimcilar");
const { badWords } = require("./utils/sansur");

/** TTS için metni google-tts-api limitine (200 karakter) uygun hale getirir. */
function prepareTtsText(text) {
  const maxLen = 200;
  const trimmed = (text || "").trim();
  if (!trimmed || trimmed.length <= maxLen) return trimmed;
  const parts = trimmed.split(/([.,;:!?\s\n\u060C\u061B\u3002\uff01\uff1f]+)/);
  let out = "";
  for (const p of parts) {
    if (/[.,;:!?\s\n]/.test(p)) {
      out += p;
    } else {
      let rest = p;
      while (rest.length > maxLen) {
        out += rest.slice(0, maxLen) + " ";
        rest = rest.slice(maxLen);
      }
      out += rest;
    }
  }
  return out.trim() || trimmed.slice(0, maxLen);
}

const getFileType = async (buffer) => {
  try {
    if (fileType.fileTypeFromBuffer) {
      return await fileType.fileTypeFromBuffer(buffer);
    }

    if (fileType.fromBuffer) {
      return await fileType.fromBuffer(buffer);
    }

    return await fileType(buffer);
  } catch (error) {
    console.log("Dosya türü algılanamadı:", error);
    return null;
  }
};
let MODE = config.MODE,
  STICKER_DATA = config.STICKER_DATA;

Module({
  pattern: "görselara ?(.*)",
  fromMe: false,
  desc: "Google Görseller üzerinden belirlediğiniz anahtar kelimeye uygun resimler bulur ve albüm olarak gönderir.",
  usage: ".görselara [sorgu]",
  use: "arama",
},
  async (message, match) => {
    if (!match[1]?.trim()) return await message.send("⚠️ *Arama terimi gerekli!*");
    let splitInput = (match[1] || "").split(",");
    let count = parseInt(splitInput[1]) || 5;
    const searchTerm = splitInput[0].trim();

    await message.send(`*🔍 _${count} görsel aranıyor..._*`);

    // Türkçe karakterleri en iyi sonuç için hem orijinal hem İngilizce'de dene
    const enTerm = trToEn(searchTerm);
    const buffer = Math.ceil(count * 0.6);

    let results = await gis(searchTerm, count + buffer);

    // Sonuç bulunamazsa İngilizce versiyonla dene
    if (results.length < 1 && enTerm !== searchTerm) {
      results = await gis(enTerm, count + buffer);
    }

    // GIS de başarısız olursa Nexray görsel API'si ile dene
    if (results.length < 1) {
      try {
        const nexQuery = enTerm || searchTerm;
        const nexRes = await nx(`/search/images?q=${encodeURIComponent(nexQuery)}`);
        if (Array.isArray(nexRes) && nexRes.length > 0) {
          results = nexRes.map(r => r.url || r.image || r.thumbnail).filter(Boolean);
        }
      } catch (_) { }
    }

    if (results.length < 1) return await message.send("❌ *Sonuç bulunamadı!*");

    // Buffer al ve başarı sayısını takip et
    let successCount = 0;
    let i = 0;
    const imagesToSend = [];

    while (successCount < count && i < results.length) {
      try {
        const imageBuffer = await getBuffer(results[i]);
        if (imageBuffer && imageBuffer.length > 100) {
          imagesToSend.push({ image: imageBuffer });
          successCount++;
        }
      } catch (e) {
        console.log(`${i + 1}. görsel tampona alınamadı:`, e.message);
      }
      i++;
    }

    if (imagesToSend.length === 0) {
      return await message.send("❌ *Görseller indirilemedi!*");
    }

    try {
      await message.client.albumMessage(
        message.jid,
        imagesToSend,
        message.data
      );
    } catch (e) {
      console.log("Albüm gönderilemedi:", e.message);
      for (const img of imagesToSend) {
        try {
          await message.sendMessage(img, "image", { quoted: message.data });
        } catch (sendErr) {
          console.log("Tekil görsel gönderilemedi:", sendErr.message);
        }
      }
    }

    if (successCount < count) {
      await message.send(
        `⚠️ *Sadece* \`${successCount}/${count}\` *görsel indirilebildi!*`
      );
    }
  }
);

Module({
  pattern: "çıkartma",
  fromMe: false,
  desc: "Görsel, video veya GIF dosyalarını WhatsApp çıkartmasına (sticker) dönüştürür.",
  usage: ".çıkartma",
  use: "medya",
},
  async (message, match) => {
    if (message.reply_message === false)
      return await message.send("⚠️ *Bir fotoğraf veya videoya yanıt veriniz!*");

    const exif = {
      packname: message.pushName || message.senderName || "Lades-Pro",
      author: STICKER_DATA.split(";")[1] || "Lades-Pro",
      categories: STICKER_DATA.split(";")[2] || "😂",
      android: "",
      ios: "",
    };

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const images = albumData.images || [];
      const videos = albumData.videos || [];
      const allFiles = [
        ...images.map(f => ({ file: f, isVideo: false })),
        ...videos.map(f => ({ file: f, isVideo: true }))
      ];

      if (allFiles.length === 0) return await message.send("❌ *Albümde medya bulunamadı!*");

      await message.send(`⏳ _${allFiles.length} çıkartma dönüştürülüyor..._`);
      for (const item of allFiles) {
        try {
          const stickerBuf = await addExif(
            await sticker(item.file, item.isVideo),
            exif
          );
          await message.sendMessage(stickerBuf, "sticker", {
            quoted: message.quoted,
          });
        } catch (err) {
          console.error("Albüm çıkartmaya dönüştürülemedi:", err);
        }
      }
      return;
    }

    try {
      const mediaBuf = await message.reply_message.download();
      const isMediaVideo = message.reply_message.video ? true : false;

      const rawSticker = await sticker(mediaBuf, isMediaVideo);
      const stickerBuf = await addExif(rawSticker, exif);

      await message.sendMessage(stickerBuf, "sticker", { quoted: message.quoted });

      try {
        if (typeof mediaBuf === "string" && require("fs").existsSync(mediaBuf)) {
          require("fs").unlinkSync(mediaBuf);
        }
      } catch (err) { }

      return;
    } catch (e) {
      console.error("Çıkartma hatası:", e);
      // Baileys medya anahtarı hataları — genellikle çok eski mesajlarda olur
      if (
        e.code === "MEDIA_KEY_EXPIRED" ||
        e.message?.includes("empty media key") ||
        e.message?.includes("Cannot derive") ||
        e.message?.includes("MEDIA_KEY_EXPIRED") ||
        e.message?.includes("media key") ||
        e.message?.includes("decrypt")
      ) {
        return await message.sendReply(
          "❌ *Medya indirilemedi!*\n\n" +
          "⚠️ _Bu mesaj çok eski veya sunucudan kaldırılmış. " +
          "Lütfen medyayı tekrar gönderin ve komutu o mesaja yanıtlayın._"
        );
      }
      return await message.sendReply("❌ *Çıkartma oluşturulamadı!*\n⚠️ *Hata:* " + (e.message || e));
    }
  }
);

Module({
  pattern: "mp3 ?(.*)",
  fromMe: false,
  desc: "Videoların sesini ayrıştırarak yüksek kaliteli bir MP3 (ses) dosyasına dönüştürür.",
  usage: ".mp3 [yanıtla]",
  use: "medya",
},
  async (message) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video &&
        !message.reply_message.audio &&
        !message.reply_message.document &&
        !message.reply_message.album)
    )
      return await message.sendReply("⚠️ *Bir videoya veya şarkıya yanıt vermelisiniz!*");

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const videoFiles = albumData.videos || [];

      if (videoFiles.length === 0) {
        return await message.send("❌ *Albümde video bulunamadı! MP3 için video/ses dosyası gerekir.*");
      }

      await message.send(`⏳ _${videoFiles.length} dosya MP3'e dönüştürülüyor..._`);
      for (let i = 0; i < videoFiles.length; i++) {
        try {
          const file = videoFiles[i];
          const outputPath = getTempPath(`album_${i}.mp3`);
          await ffmpegLimit(() => new Promise((resolve, reject) => {
            ffmpeg(file)
              .save(outputPath)
              .on("end", resolve)
              .on("error", reject);
          }));
          await message.sendMessage(
            { url: outputPath },
            "audio",
            { quoted: message.quoted }
          );
        } catch (err) {
          console.error("Albüm MP3'e dönüştürülemedi:", err);
        }
      }
      return;
    }

    try {
      const savedFile = await message.reply_message.download();
      const outPath = getTempPath(`tomp3_${Date.now()}.mp3`);
      await ffmpegLimit(() => new Promise((resolve, reject) => {
        ffmpeg(savedFile)
          .save(outPath)
          .on("end", resolve)
          .on("error", reject);
      }));
      await message.sendMessage(
        { url: outPath },
        "audio",
        { quoted: message.quoted }
      );
    } catch (e) {
      console.error("MP3 dönüştürme hatası:", e);
      await message.sendReply("❌ *Ses dönüştürülemedi!* \n\nℹ️ _Dosya formatı desteklenmiyor olabilir._");
    }
  }
);
Module({
  pattern: "yavaşlat",
  fromMe: false,
  desc: "Ses tonunu düşürerek müziğe yavaşlatma efekti verir.",
  usage: ".yavaşlat [yanıtla]",
  use: "medya",
},
  async (message, match) => {
    if (message.reply_message === false)
      return await message.sendReply("⚠️ *Bir videoya veya şarkıya yanıt vermelisiniz!*");

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const videoFiles = albumData.videos || [];

      if (videoFiles.length === 0) {
        return await message.send("📭 _Albümde video dosyası yok. Yavaşlatma için video/ses dosyası gerekir._");
      }

      await message.send(`⏳ _${videoFiles.length} dosya yavaşlatılıyor..._`);
      for (let i = 0; i < videoFiles.length; i++) {
        try {
          const file = videoFiles[i];
          const outputPath = getTempPath(`album_slow_${i}.mp3`);
          await ffmpegLimit(() => new Promise((resolve, reject) => {
            ffmpeg(file)
              .audioFilter("atempo=0.8,asetrate=44100*0.9")
              .format("mp3")
              .outputOptions("-y")
              .save(outputPath)
              .on("end", resolve)
              .on("error", reject);
          }));
          await message.sendMessage(
            { url: outputPath },
            "audio",
            { quoted: message.quoted }
          );
          try { fs.unlinkSync(outputPath); } catch (e) { }
        } catch (err) {
          console.error("Albüm sesi yavaşlatılamadı:", err);
          await message.sendReply(`❌ *Hata oluştu!* \n\n*Detay:* ${err.message}`);
        }
      }
      return;
    }

    try {
      const waitMsg = await message.sendReply("⏳ _Ses yavaşlatılıyor..._");
      const savedPath = await message.reply_message.download();
      const quotedSeconds = message.quoted?.message
        ? (message.quoted.message[Object.keys(message.quoted.message)[0]]?.seconds || 0)
        : 0;
      if (quotedSeconds > 120)
        await message.sendReply("⚠️ *Dikkat:* _Süre 2 dakikadan uzun, işlem biraz yavaş sürebilir._");

      const outPath = getTempPath("slow.mp3");
      await ffmpegLimit(() => new Promise((resolve, reject) => {
        ffmpeg(savedPath)
          .audioFilter("atempo=0.8,asetrate=44100*0.9")
          .format("mp3")
          .save(outPath)
          .on("end", resolve)
          .on("error", reject);
      }));
      await message.sendMessage({ url: outPath }, "audio", { quoted: message.data });
      await message.edit("✅ *Başarıyla yavaşlatıldı!*", message.jid, waitMsg.key);
      try { fs.unlinkSync(savedPath); fs.unlinkSync(outPath); } catch (e) { }
    } catch (e) {
      console.error("Slow komutu hatası:", e);
      await message.sendReply("❌ *Hata oluştu!*\n⚠️ *Detay:* " + e.message);
    }
  }
);
Module({
  pattern: "hızlandır ?(.*)",
  fromMe: false,
  desc: "Müziği hızlandırırak ses tonunu yükseltir.",
  usage: ".hızlandır [yanıtla]",
  use: "medya",
},
  async (message, match) => {
    if (message.reply_message === false)
      return await message.sendReply("⚠️ *Bir videoya veya şarkıya yanıt vermelisiniz!*");

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const videoFiles = albumData.videos || [];

      if (videoFiles.length === 0) {
        return await message.send("📭 _Albümde video dosyası yok. Hızlandırma için video/ses dosyası gerekir._");
      }

      await message.send(`⏳ _${videoFiles.length} dosya hızlandırılıyor..._`);
      for (let i = 0; i < videoFiles.length; i++) {
        try {
          const file = videoFiles[i];
          const outputPath = getTempPath(`album_sped_${i}.mp3`);
          await ffmpegLimit(() => new Promise((resolve, reject) => {
            ffmpeg(file)
              .audioFilter("atempo=1.2,asetrate=44100*1.15")
              .format("mp3")
              .outputOptions("-y")
              .save(outputPath)
              .on("end", resolve)
              .on("error", reject);
          }));
          await message.sendMessage(
            { url: outputPath },
            "audio",
            { quoted: message.quoted }
          );
          try { fs.unlinkSync(outputPath); } catch (e) { }
        } catch (err) {
          console.error("Albüm sesi hızlandırılamadı:", err);
          await message.sendReply(`❌ *Hata oluştu!* \n\n*Detay:* ${err.message}`);
        }
      }
      return;
    }

    try {
      const waitMsg = await message.sendReply("⏳ _Ses hızlandırılıyor..._");
      const savedPath = await message.reply_message.download();
      const quotedSeconds = message.quoted?.message
        ? (message.quoted.message[Object.keys(message.quoted.message)[0]]?.seconds || 0)
        : 0;
      if (quotedSeconds > 120)
        await message.sendReply("⚠️ *Dikkat:* _Süre 2 dakikadan uzun, işlem biraz yavaş sürebilir._");

      const outPath = getTempPath("sped.mp3");
      await ffmpegLimit(() => new Promise((resolve, reject) => {
        ffmpeg(savedPath)
          .audioFilter("atempo=1.2,asetrate=44100*1.15")
          .format("mp3")
          .save(outPath)
          .on("end", resolve)
          .on("error", reject);
      }));
      await message.sendMessage({ url: outPath }, "audio", { quoted: message.data });
      await message.edit("✅ *Başarıyla hızlandırıldı!*", message.jid, waitMsg.key);
      try { fs.unlinkSync(savedPath); fs.unlinkSync(outPath); } catch (e) { }
    } catch (e) {
      console.error("Sped komutu hatası:", e);
      await message.sendReply("❌ *Hata oluştu!*\n\n⚠️ *Detay:* " + e.message);
    }
  }
);
Module({
  pattern: "bass ?(.*)",
  fromMe: false,
  desc: "Sesteki bass gücünü belirlediğiniz seviyeye göre artırır.",
  usage: ".bass [miktar]",
  use: "medya",
},
  async (message, match) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video && !message.reply_message.audio)
    ) {
      return await message.sendReply("⚠️ *Bir ses dosyasına yanıt vermelisiniz!*"
      );
    }

    try {
      const processingMsg = await message.send("⏳ _Bas ekleniyor..._");
      const buf = await message.reply_message.download("buffer");
      const gain = match[1] ? parseInt(match[1]) : 20;

      const audioResult = await bass(buf, gain);
      await message.sendMessage(audioResult, "audio", { quoted: message.data });
      await message.edit("✅ *Bass başarıyla artırıldı!*", message.jid, processingMsg.key);
    } catch (e) {
      console.error("Basartır komutu hatası:", e);
      await message.sendReply("❌ *Hata oluştu!*\n\n⚠️ *Detay:* " + e.message);
    }
  }
);
Module({
  pattern: "foto ?(.*)",
  fromMe: false,
  desc: "WhatsApp çıkartmalarını standart fotoğraf formatına dönüştürür.",
  usage: ".foto [yanıtla]",
  use: "medya",
},
  async (message, match) => {
    if (message.reply_message === false)
      return await message.send("⚠️ *Bir Çıkartmaya yanıt vermelisiniz!*");

    try {
      const savedFile = await message.reply_message.download();

      // If it's already an image (jpg/png/etc), send it directly as image
      if (message.reply_message.image) {
        return await message.sendMessage({ url: savedFile }, "image", { quoted: message.quoted });
      }

      // Otherwise (sticker, webp) - convert via ffmpeg
      const outPng = getTempPath(`foto_${Date.now()}.png`);
      await ffmpegLimit(() => new Promise((resolve, reject) => {
        ffmpeg(savedFile)
          .save(outPng)
          .on("end", resolve)
          .on("error", reject);
      }));
      await message.sendMessage({ url: outPng }, "image", { quoted: message.quoted });
    } catch (e) {
      console.error("Foto dönüştürme hatası:", e);
      await message.sendReply("❌ *Görsel dönüştürülemedi!*\n\n⚠️ *Hata:* " + e.message);
    }
  }
);
Module({
  pattern: "yazı1 ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni şık, renkli ve hareketli bir çıkartma haline getirir.",
  usage: ".yazı1 [metin]",
  use: "medya",
},
  async (message, match) => {
    if (match[1] == "") return await message.send("⚠️ *Bir metin girin!*");
    const result = await attp(match[1]);
    const exif = {
      author: STICKER_DATA.split(";")[1] || "",
      packname: message.senderName,
      categories: STICKER_DATA.split(";")[2] || "😂",
      android: "",
      ios: "",
    };
    const stickerBuf = await addExif(result, exif);
    await message.sendMessage(stickerBuf, "sticker");
  }
);
Module({
  pattern: "ses ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni farklı dil ve ses tonu seçenekleriyle sesli mesaja dönüştürür.",
  usage: ".ses [metin]",
  use: "medya",
},
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply("❌ *Bu komut yalnızca gruplarda çalışır!*");

    const query = match[1] || message.reply_message?.text;
    if (!query) {
      const usageText = `🎙️ *Sesli Mesaj Aracı*
📝 *Kullanım:*
.ses <metin>
.ses /cinsiyet <metin>
.ses /dil <metin>
.ses /hız <metin>
🔧 *Seçenekler:*
- */sage* - Ses tonu seçimi
- */erkek* veya */e* - Erkek sesi
- */kadın* veya */k* - Kadın sesi
- */tr, /en, /es* - Dil seçimi
- */1.5, /2.0* - Hız ayarı (0.5-2.0)
🎤 *Ses Tonları:*
/nova, /alloy, /ash, /coral, /echo, /fable, /onyx, /sage, /shimmer
📌 *Örnekler:*
.ses Naber canım
.ses /sage Nasıl gidiyor?
.ses /erkek Nasılsın?
.ses /k Hava çok güzel
.ses /en /1.2 How are you
.ses /e /1.5 Hızlı konuş
💡 *Not:* Bir mesajı yanıtlayarak da kullanabilirsiniz.`;
      return await message.sendReply(usageText);
    }

    let ttsMessage = query;
    let LANG = "tr";
    let SPEED = 0.9;
    let VOICE = "coral";

    if (/\/erkek\b|\/e\b/i.test(ttsMessage)) {
      VOICE = "ash";
      ttsMessage = ttsMessage.replace(/\/erkek\b|\/e\b/gi, "").trim();
    } else if (/\/kadın\b|\/k\b/i.test(ttsMessage)) {
      VOICE = "nova";
      ttsMessage = ttsMessage.replace(/\/kadın\b|\/k\b/gi, "").trim();
    }

    const langMatch = ttsMessage.match(/\/(tr|en|es|fr|de|it|pt|ru|ja|ko|zh)\b/i);
    if (langMatch) {
      LANG = langMatch[1].toLowerCase();
      ttsMessage = ttsMessage.replace(langMatch[0], "").trim();
    }

    const speedMatch = ttsMessage.match(/\/([0-9]+\.?[0-9]*)\b/);
    if (speedMatch) {
      const speed = parseFloat(speedMatch[1]);
      if (speed >= 0.5 && speed <= 2.0) {
        SPEED = speed;
        ttsMessage = ttsMessage.replace(speedMatch[0], "").trim();
      }
    }

    const voiceMatch = ttsMessage.match(/\/(nova|alloy|ash|coral|echo|fable|onyx|sage|shimmer)\b/i);
    if (voiceMatch) {
      VOICE = voiceMatch[1].toLowerCase();
      ttsMessage = ttsMessage.replace(voiceMatch[0], "").trim();
    }

    ttsMessage = prepareTtsText(ttsMessage);
    if (!ttsMessage) {
      return await message.sendReply("❌ *Seslendirilecek metin bulunamadı!*");
    }

    function makeBadWordRegex(word) {
      const pattern = word
        .replace(/a/g, "[a4@]")
        .replace(/i/g, "[i1!İî]")
        .replace(/o/g, "[o0ö]")
        .replace(/u/g, "[uü]")
        .replace(/s/g, "[s5$ş]")
        .replace(/c/g, "[cç]")
        .replace(/g/g, "[gğ9]")
        .replace(/e/g, "[e3]")
        .replace(/\s+|\./g, "(\\s|\\.|-|_)*");
      return new RegExp(`\\b${pattern}\\b`, "iu");
    }

    const filterRegexes = badWords.map(makeBadWordRegex);
    const containsBadWord = filterRegexes.some((rx) => rx.test(ttsMessage));
    if (containsBadWord) {
      return await message.sendReply("🚫 *OPS! Bunu seslendiremem.*");
    }

    try {
      let audio;
      try {
        const ttsResult = await aiTTS(ttsMessage, VOICE, SPEED.toFixed(2));
        if (ttsResult.url) {
          audio = { url: ttsResult.url };
        } else {
          throw new Error(ttsResult.error || "YZ Ses Sunucu Hatası!");
        }
      } catch (e) {
        console.log("YZ TTS hatası, Google TTS'e geçiliyor:", e.message);
        audio = await gtts(ttsMessage, LANG);
      }

      await message.client.sendMessage(message.jid, {
        audio,
        mimetype: "audio/mp4",
        ptt: true,
      });
    } catch (error) {
      console.error("TTS Hatası:", error);
      await message.sendReply("_" + "⚠️ ```Hata! Cümlenin konuşma sentezi yapılamadı!```" + "_");
    }
  }
);

Module({
  pattern: "belge ?(.*)",
  fromMe: false,
  desc: "Medya dosyalarını kalite kaybı yaşanmaması için belge (dosya) formatında gönderir.",
  usage: ".belge [mesaja yanıtla]",
  use: "medya",
},
  async (message, match) => {
    if (message.reply_message === false)
      return await message.send(
        "⚠️ *Lütfen bir medyaya yanıtlayın!* \n\nℹ️ _Görsel, video, ses veya çıkartma olabilir._"
      );

    if (
      !message.reply_message.image &&
      !message.reply_message.video &&
      !message.reply_message.audio &&
      !message.reply_message.sticker &&
      !message.reply_message.document &&
      !message.reply_message.album
    ) {
      return await message.send(
        "⚠️ *Lütfen bir medyaya yanıtlayın!* \n\nℹ️ _Görsel, video, ses veya çıkartma olabilir._"
      );
    }

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const allFiles = [...(albumData.images || []), ...(albumData.videos || [])];
      if (allFiles.length === 0) return await message.send("❌ *Albümde medya bulunamadı!*");

      await message.send(`⏳ _${allFiles.length} dosya belgeye dönüştürülüyor..._`);
      for (let i = 0; i < allFiles.length; i++) {
        try {
          const filePath = allFiles[i];
          const stream = fs.createReadStream(filePath);
          stream.on("error", () => { }); // Prevent stream crash
          const randomHash = Math.random().toString(36).substring(2, 8);
          let fileName = match[1] || `album_${i}_${randomHash}`;
          const mimetype = "application/octet-stream";

          if (!fileName.includes(".")) {
            const ext = filePath.split(".").pop();
            if (ext) fileName += `.${ext}`;
          }

          await message.sendMessage({ stream: stream }, "document", {
            quoted: message.quoted,
            fileName: fileName,
            mimetype: mimetype,
            caption: "✅ *Belgeye dönüştürüldü!*",
          });
        } catch (err) {
          console.error("Albüm dosyası belgeye dönüştürülemedi:", err);
        }
      }
      return;
    }

    try {
      const mediaMessage = message.reply_message.data.message;
      const mediaType = Object.keys(mediaMessage)[0];
      const mediaInfo = mediaMessage[mediaType];

      if (mediaInfo.fileLength && mediaInfo.fileLength > 50 * 1024 * 1024) {
        return await message.send("⚠️ *Dosya çok büyük!* \n\nℹ️ _Maksimum boyut 50MB._");
      }
      const processingMsg = await message.send("⏳ _Belgeye dönüştürülüyor..._");

      const filePath = await message.reply_message.download();
      const randomHash = Math.random().toString(36).substring(2, 8);
      let fileName = match[1];
      const mimetype = mediaInfo.mimetype || "application/octet-stream";

      if (message.reply_message.document && mediaInfo.fileName && !match[1]) {
        fileName = mediaInfo.fileName;
      } else if (!fileName) {
        fileName = `converted_file_${randomHash}`;
      }

      if (!fileName.includes(".") && mimetype) {
        const ext = mimetype.split("/")[1];
        if (ext && ext !== "octet-stream") {
          fileName += `.${ext}`;
        }
      }

      const stream = fs.createReadStream(filePath);
      stream.on("error", () => { }); // Prevent Uncaught Exception
      await message.sendMessage({ stream: stream }, "document", {
        quoted: message.quoted,
        fileName: fileName,
        mimetype: mimetype,
        caption: match[1] ? "" : "✅ *Belgeye dönüştürüldü!*",
      });

      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.log("Geçici dosya silinemedi:", filePath);
      }

      await message.edit(
        "✅ *Belge dönüşümü tamamlandı!*",
        message.jid,
        processingMsg.key
      );
    } catch (error) {
      console.error("Belge dönüşüm hatası:", error);
      if (error.message && error.message.includes("download")) {
        await message.send(
          "❌ *Medya indirilemedi!* \n\nℹ️ _Dosya bozuk veya süresi dolmuş olabilir._"
        );
      } else if (
        error.message &&
        (error.message.includes("large") ||
          error.message.includes("memory"))
      ) {
        await message.send("❌ *Dosya işlemek için çok büyük!*");
      } else {
        await message.send("❌ *Medya belgeye dönüştürülemedi!*");
      }
    }
  }
);

Module({
  pattern: "indir ?(.*)",
  fromMe: false,
  desc: "Verilen bir dosya bağlantısındaki (URL) içeriği indirip sohbete belge olarak yükler.",
  usage: ".indir [url]",
  use: "medya",
},
  async (message, match) => {
    console.log("[indir] match[1]:", match[1], "reply_message:", !!message.reply_message);

    let url = match[1] || (message.reply_message ? message.reply_message.text : "");

    console.log("[indir] URL after check:", url);

    const urlMatch = url.match(/https?:\/\/[^\s]+/);
    if (urlMatch) url = urlMatch[0];

    console.log("[indir] Final URL:", url);

    if (!url || !url.startsWith("http")) {
      return await message.send(
        "_📥 Kullanım: .indir <URL>\n\nÖrnek: .indir https://ornek.com/dosya.pdf"
      );
    }

    try {
      const downloadMsg = await message.send("⏳ _Dosya indiriliyor..._");

      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 60000,
        maxRedirects: 5,
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });

      let fileName = "downloaded_file";
      let mimetype = response.headers["content-type"] || "application/octet-stream";

      const contentDisposition = response.headers["content-disposition"];
      if (contentDisposition && contentDisposition.includes("filename=")) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch) fileName = filenameMatch[1].replace(/['"]/g, "");
      } else {
        const urlPath = new URL(url).pathname;
        const urlFileName = urlPath.split("/").pop();
        if (urlFileName && urlFileName.includes(".")) fileName = urlFileName;
      }

      await message.sendMessage(Buffer.from(response.data), "document", {
        quoted: message.data,
        fileName,
        mimetype,
        // caption removed
      });

      await message.edit("✅ *Dosya yüklendi!*", message.jid, downloadMsg.key);
    } catch (error) {
      console.error("İndir komutu hatası:", error);
      await message.send(`❌ *İndirme başarısız!* \n\n*Hata:* ${error.message}`);
    }
  }
);

Module({
  pattern: "square ?(.*)",
  fromMe: false,
  desc: "Videoları veya görselleri en-boy oranını koruyarak 1:1 kare formatında kırpar.",
  usage: ".square [yanıtla]",
  use: "medya",
},
  async (message, match) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video && !message.reply_message.image)
    ) {
      return await message.sendReply("_🎬 Kare formatında kırpmak için bir videoyu veya resmi yanıtlayın_"
      );
    }

    try {
      const processingMsg = await message.send(
        "_⏳ Medya kare formatına işleniyor..._"
      );

      const savedFile = await message.reply_message.download();
      const isVideo = message.reply_message.video;
      const outputPath = getTempPath(
        `square_${Date.now()}.${isVideo ? "mp4" : "jpg"}`
      );

      const command = ffmpeg(savedFile)
        .outputOptions(["-y"])
        .videoFilters([
          "scale='min(iw,ih)':'min(iw,ih)':force_original_aspect_ratio=increase",
          "crop='min(iw,ih)':'min(iw,ih)'",
        ]);

      if (isVideo) {
        command
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions(["-preset", "fast", "-crf", "23"])
          .format("mp4");
      } else {
        command.format("mjpeg").outputOptions(["-q:v", "2"]);
      }

      command
        .save(outputPath)
        .on("end", async () => {
          try {
            const fsp = require("fs").promises;
            if (isVideo) {
              await message.sendMessage(await fsp.readFile(outputPath), "video", {
                quoted: message.quoted,
                caption: "_✅ Kare formata kırpıldı_",
              });
            } else {
              await message.sendMessage(await fsp.readFile(outputPath), "image", {
                quoted: message.quoted,
                caption: "_✅ Kare formata kırpıldı_",
              });
            }

            await fsp.unlink(savedFile).catch(() => { });
            await fsp.unlink(outputPath).catch(() => { });

            await message.edit(
              "_✅ Kare kırpma tamamlandı_",
              message.jid,
              processingMsg.key
            );
          } catch (e) {
            console.error("Gönderim hatası:", e);
            await message.send("_⚠️ İşlendi ancak gönderilemedi_");
          }
        })
        .on("error", (err) => {
          console.error("FFmpeg hatası:", err);
          message.send("_❌ Medya işlenemedi. Lütfen tekrar deneyin_");
          try {
            fs.unlinkSync(savedFile);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch (e) { }
        });
    } catch (error) {
      console.error("Kare kırpma hatası:", error);
      await message.send("_❌ Medya kare kırpma için işlenemedi_");
    }
  }
);

Module({
  pattern: "boyut ?(.*)",
  fromMe: false,
  desc: "Medya dosyalarını istediğiniz en-boy oranına (16:9, 9:16 vb.) göre yeniden şekillendirir.",
  usage: ".boyut [oran]",
  use: "medya",
},
  async (message, match) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video && !message.reply_message.image)
    ) {
      return await message.sendReply("_🎬 Boyutunu değiştirmek için bir videoyu veya görseli yanıtlayın!_"
      );
    }

    if (!match[1]?.trim()) {
      return await message.send(
        "_💬 En-boy oranı belirtin. Örnekler:_\n• `.boyut 16:9` - Geniş ekran\n• `.boyut 9:16` - Dikey/Hikaye\n• `.boyut 4:3` - Klasik\n• `.boyut 21:9` - Ultra geniş\n• `.boyut 1:1` - Kare"
      );
    }

    const input = match[1].trim();

    if (!input.includes(":")) {
      return await message.send(
        "_⚠️ Geçersiz format! 16:9, 9:16, 4:3 gibi en-boy oranları kullanın._"
      );
    }

    const [widthRatio, heightRatio] = input
      .split(":")
      .map((x) => parseInt(x.trim()));

    if (
      isNaN(widthRatio) ||
      isNaN(heightRatio) ||
      widthRatio <= 0 ||
      heightRatio <= 0
    ) {
      return await message.send(
        "_⚠️ Geçersiz en-boy oranı! 16:9, 9:16 gibi pozitif sayılar kullanın._"
      );
    }

    try {
      const processingMsg = await message.send(
        `_⏳ ${input} en-boy oranına yeniden boyutlandırılıyor..._`
      );

      const savedFile = await message.reply_message.download();
      const isVideo = message.reply_message.video;
      const outputPath = getTempPath(
        `resized_${Date.now()}.${isVideo ? "mp4" : "jpg"}`
      );

      let targetWidth, targetHeight;

      if (widthRatio >= heightRatio) {
        targetWidth = 1280;
        targetHeight = Math.round((targetWidth * heightRatio) / widthRatio);
      } else {
        targetHeight = 1280;
        targetWidth = Math.round((targetHeight * widthRatio) / heightRatio);
      }

      targetWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
      targetHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

      const command = ffmpeg(savedFile)
        .outputOptions(["-y"])
        .videoFilters([
          `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase`,
          `crop=${targetWidth}:${targetHeight}`,
        ]);

      if (isVideo) {
        command
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions(["-preset", "fast", "-crf", "23"])
          .format("mp4");
      } else {
        command.format("mjpeg").outputOptions(["-q:v", "2"]);
      }

      command
        .save(outputPath)
        .on("end", async () => {
          try {
            const fsp = require("fs").promises;
            if (isVideo) {
              await message.sendMessage(await fsp.readFile(outputPath), "video", {
                quoted: message.quoted,
                caption: `_✅ ${input} en-boy oranına boyutlandırıldı (${targetWidth}x${targetHeight})_`,
              });
            } else {
              await message.sendMessage(await fsp.readFile(outputPath), "image", {
                quoted: message.quoted,
                caption: `_✅ ${input} en-boy oranına boyutlandırıldı (${targetWidth}x${targetHeight})_`,
              });
            }

            await fsp.unlink(savedFile).catch(() => { });
            await fsp.unlink(outputPath).catch(() => { });

            await message.edit(
              `_✅ ${input} en-boy oranı değişikliği tamamlandı_`,
              message.jid,
              processingMsg.key
            );
          } catch (e) {
            console.error("Gönderim hatası:", e);
            await message.send("_⚠️ İşlendi ancak gönderilemedi_");
          }
        })
        .on("error", (err) => {
          console.error("FFmpeg boyutlandırma hatası:", err);
          message.send(
            "_❌ Medya boyutu değiştirilemedi. En-boy oranını kontrol edip tekrar deneyin_"
          );
          try {
            fs.unlinkSync(savedFile);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch (e) { }
        });
    } catch (error) {
      console.error("Boyutlandırma hatası:", error);
      await message.send("_❌ Medya boyutlandırma için işlenemedi_");
    }
  }
);
Module({
  pattern: "sıkıştır ?(.*)",
  fromMe: false,
  desc: "Video veya görsellerin dosya boyutunu kaliteden ödün vererek belirlediğiniz oranda küçültür.",
  usage: ".sıkıştır [yüzde]",
  use: "medya",
},
  async (message, match) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video && !message.reply_message.image)
    ) {
      return await message.sendReply("_🎬 Sıkıştırmak için bir videoyu veya resmi yanıtlayın_"
      );
    }

    if (!match[1]?.trim()) {
      return await message.send(
        "_💬 Sıkıştırma yüzdesi belirtin. Örnekler:_\n• `.sıkıştır 50` - %50 sıkıştırma (orta)\n• `.sıkıştır 70` - %70 sıkıştırma (yüksek)\n• `.sıkıştır 80` - %80 sıkıştırma (çok yüksek)\n• `.sıkıştır 30` - %30 sıkıştırma (hafif)"
      );
    }

    const compressionPercent = parseInt(match[1].trim());

    if (
      isNaN(compressionPercent) ||
      compressionPercent < 10 ||
      compressionPercent > 95
    ) {
      return await message.send(
        "_⚠️ Geçersiz sıkıştırma yüzdesi! 10-95 arası değer kullanın._"
      );
    }

    try {
      const processingMsg = await message.send(
        `_⏳ %${compressionPercent} sıkıştırılıyor..._`
      );

      const savedFile = await message.reply_message.download();
      const isVideo = message.reply_message.video;
      const outputPath = getTempPath(
        `compressed_${Date.now()}.${isVideo ? "mp4" : "jpg"}`
      );

      const command = ffmpeg(savedFile).outputOptions(["-y"]);

      if (isVideo) {
        const crf = Math.round(
          18 + ((compressionPercent - 10) * (45 - 18)) / (95 - 10)
        );

        command
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions([
            "-preset",
            "superfast",
            "-crf",
            crf.toString(),
            "-profile:v",
            "main",
            "-level",
            "3.1",
          ])
          .format("mp4");
      } else {
        const quality = Math.round(
          2 + ((compressionPercent - 10) * (28 - 2)) / (95 - 10)
        );

        command.format("mjpeg").outputOptions(["-q:v", quality.toString()]);
      }

      command
        .save(outputPath)
        .on("end", async () => {
          try {
            const fsPromises = require("fs").promises;
            const stats = await Promise.all([
              require("fs").promises.stat(savedFile),
              require("fs").promises.stat(outputPath)
            ]);
            const originalSize = stats[0].size;
            const compressedSize = stats[1].size;
            const actualReduction = Math.round(
              (1 - compressedSize / originalSize) * 100
            );

            const formatSize = (bytes) => {
              const mb = bytes / (1024 * 1024);
              return mb > 1
                ? `${mb.toFixed(1)}MB`
                : `${(bytes / 1024).toFixed(1)}KB`;
            };

            if (isVideo) {
              await message.sendMessage(await fsPromises.readFile(outputPath), "video", {
                quoted: message.quoted,
                caption: `_✅ %${actualReduction} sıkıştırıldı_\n_${formatSize(
                  originalSize
                )} → ${formatSize(compressedSize)}_`,
              });
            } else {
              await message.sendMessage(await fsPromises.readFile(outputPath), "image", {
                quoted: message.quoted,
                caption: `✅ *%${actualReduction} sıkıştırıldı!* \n\n_${formatSize(originalSize)} → ${formatSize(compressedSize)}_`,
              });
            }

            await fsPromises.unlink(savedFile).catch(() => { });
            await fsPromises.unlink(outputPath).catch(() => { });

            await message.edit(
              `✅ *Sıkıştırma tamamlandı!* \n\n*(%${actualReduction} azalma)*`,
              message.jid,
              processingMsg.key
            );
          } catch (e) {
            console.error("Gönderim hatası:", e);
            await message.send("_⚠️ İşlendi ancak gönderilemedi_");
          }
        })
        .on("error", (err) => {
          console.error("FFmpeg sıkıştırma hatası:", err);
          message.send("_❌ Medya sıkıştırılamadı. Lütfen tekrar deneyin_");
          try {
            fs.unlinkSync(savedFile);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch (e) { }
        });
    } catch (error) {
      console.error("Sıkıştırma hatası:", error);
      await message.send("_❌ Medya sıkıştırma için işlenemedi_");
    }
  }
);

