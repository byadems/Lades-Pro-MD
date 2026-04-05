const { Module } = require("../main");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const {
  bass,
  sticker,
  addExif,
  attp,
  gtts,
  gis,
  aiTTS,
  getBuffer,
} = require("./utils");
const config = require("../config");
const axios = require("axios");
const fileType = require("file-type");
const { getTempPath, getTempSubdir } = require("../core/helpers");
const { badWords } = require("./utils/censor");

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
const { getString } = require("./utils/lang");
const Lang = getString("converters");

Module(
  {
    pattern: "görselara ?(.*)",
    fromMe: false,
    desc: "Google Görseller üzerinden resim arar ve indirir.",
    use: "search",
  },
  async (message, match) => {
    if (!match[1]) return await message.send("*_💬 Arama terimi gerekli!_*");
    let splitInput = match[1].split(",");
    let count = parseInt(splitInput[1] || 5);
    await message.send(`*_🔍 ${count} görsel aranıyor..._*`);

    const buffer = Math.ceil(count * 0.5);
    let results = await gis(splitInput[0], count + buffer);
    if (results.length < 1) return await message.send("*_📭 Sonuç bulunamadı!_*");

    // buffer and send with success tracking since many URLs have access issues
    let successCount = 0;
    let i = 0;
    const imagesToSend = [];

    while (successCount < count && i < results.length) {
      try {
        const imageBuffer = await getBuffer(results[i]);
        imagesToSend.push({ image: imageBuffer });
        successCount++;
      } catch (e) {
        console.log(`${i + 1}. görsel tampona alınamadı:`, e.message);
        if (i === results.length - 1 && successCount < count) {
          let moreResults = await gis(splitInput[0], buffer, {
            page: Math.floor(i / 10) + 1,
          });
          if (moreResults.length > 0) {
            results = results.concat(moreResults);
          }
        }
      }
      i++;
    }

    if (imagesToSend.length === 0) {
      return await message.send("*_❌ Hiçbir görsel indirilemedi_*");
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
        `*_⚠️ Sadece ${successCount}/${count} görsel indirilebildi. Bazı URL'lerde erişim sorunu vardı._*`
      );
    }
  }
);

Module(
  {
    pattern: "çıkartma ?(.*)",
    fromMe: false,
    desc: Lang.STICKER_DESC,
    use: "media",
  },
  async (message, match) => {
    if (match[1] && match[1].trim() !== "") {
      try {
        const result = await attp(match[1].trim());
        const exif = {
          author: STICKER_DATA.split(";")[1] || "",
          packname: message.senderName,
          categories: STICKER_DATA.split(";")[2] || "😂",
          android: "https://github.com/byadems/Lades-MD/",
          ios: "https://github.com/byadems/Lades-MD/",
        };
        return await message.sendMessage(
          fs.readFileSync(await addExif(result, exif)),
          "sticker"
        );
      } catch (e) {
        console.error("Çıkartma (metin) hatası:", e);
        return await message.sendReply("_❌ Çıkartma oluşturulamadı. Lütfen tekrar deneyin._");
      }
    }

    if (message.reply_message === false)
      return await message.send(Lang.STICKER_NEED_REPLY);

    const exif = {
      author: STICKER_DATA.split(";")[1] || "",
      packname: message.senderName,
      categories: STICKER_DATA.split(";")[2] || "😂",
      android: "https://github.com/byadems/Lades-MD/",
      ios: "https://github.com/byadems/Lades-MD/",
    };

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const allFiles = [...(albumData.images || []), ...(albumData.videos || [])];
      if (allFiles.length === 0) return await message.send("_💭 Albümde medya yok_");

      await message.send(`_⏳ ${allFiles.length} çıkartma dönüştürülüyor..._`);
      for (const file of allFiles) {
        try {
          const stickerFile = await fs.promises.readFile(
            await addExif(
              await sticker(file, isVideo ? "video" : "image"),
              exif
            )
          );
          await message.sendMessage(stickerFile, "sticker", {
            quoted: message.quoted,
          });
        } catch (err) {
          console.error("Albüm çıkartmaya dönüştürülemedi:", err);
        }
      }
      return;
    }

    try {
      var savedFile = await message.reply_message.download();
      const { getTempPath } = require("../core/helpers");
      const outWebp = getTempPath("out_sticker.webp");
      const ffmpeg = require("fluent-ffmpeg");

      // Bypassing obfuscated sticker() for direct transparent ffmpeg processing
      await new Promise((resolve, reject) => {
        ffmpeg(savedFile)
          .outputOptions([
            "-vcodec", "libwebp",
            "-vf", "scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000",
            "-loop", "0",
            "-preset", "superfast", // Optimized for cloud CPU
            "-qscale", "60",       // Balanced quality/size
            "-an"
          ])
          .save(outWebp)
          .on("end", resolve)
          .on("error", reject);
      });

      const stickerPath = await addExif(outWebp, exif);
      const stickerBuf = await fs.promises.readFile(stickerPath);
      await message.sendMessage(stickerBuf, "sticker", { quoted: message.quoted });

      // Silme işlemi: Kullanıcının ilettiği görsel mesajını sil
      if (message.reply_message) {
        try {
          await message.client.sendMessage(message.jid, { delete: message.reply_message.key });
        } catch (e) {
          console.error("Mesaj silinemedi:", e);
        }
      }
      return;
    } catch (e) {
      console.error("Çıkartma hatası:", e);
      return await message.sendReply(`_❌ Çıkartma oluşturulamadı. Hata: ${e.message}_`);
    }
  }
);
Module(
  {
    pattern: "mp3 ?(.*)",
    fromMe: false,
    desc: Lang.MP3_DESC,
    use: "media",
  },
  async (message) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video &&
        !message.reply_message.audio &&
        !message.reply_message.document &&
        !message.reply_message.album)
    )
      return await message.sendReply(Lang.MP3_NEED_REPLY);

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const videoFiles = albumData.videos || [];

      if (videoFiles.length === 0) {
        return await message.send("_💭 Albümde video dosyası yok. MP3 için video/ses dosyası gerekir._");
      }

      await message.send(`_⏳ ${videoFiles.length} dosya mp3'e dönüştürülüyor..._`);
      for (let i = 0; i < videoFiles.length; i++) {
        try {
          const file = videoFiles[i];
          const outputPath = getTempPath(`album_${i}.mp3`);
          await new Promise((resolve, reject) => {
            ffmpeg(file)
              .save(outputPath)
              .on("end", resolve)
              .on("error", reject);
          });
          await message.sendMessage(
            fs.readFileSync(outputPath),
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
      await new Promise((resolve, reject) => {
        ffmpeg(savedFile)
          .save(outPath)
          .on("end", resolve)
          .on("error", reject);
      });
      await message.sendMessage(
        await fs.promises.readFile(outPath),
        "audio",
        { quoted: message.quoted }
      );
    } catch (e) {
      console.error("MP3 dönüştürme hatası:", e);
      await message.sendReply("_❌ Ses dönüştürülemedi. Dosya desteklenmiyor olabilir._");
    }
  }
);
Module(
  {
    pattern: "slow",
    fromMe: false,
    desc: "Müziği yavaşlatır ve ses tonunu düşürür. Slowed+reverb sesleri yapmak için",
    use: "media",
  },
  async (message, match) => {
    if (message.reply_message === false)
      return await message.sendReply(Lang.MP3_NEED_REPLY);

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const videoFiles = albumData.videos || [];

      if (videoFiles.length === 0) {
        return await message.send("_📭 Albümde video dosyası yok. Yavaşlatma için video/ses dosyası gerekir._");
      }

      await message.send(`_⏳ ${videoFiles.length} dosya yavaşlatılıyor..._`);
      for (let i = 0; i < videoFiles.length; i++) {
        try {
          const file = videoFiles[i];
          const outputPath = getTempPath(`album_slow_${i}.mp3`);
          await new Promise((resolve, reject) => {
            ffmpeg(file)
              .audioFilter("atempo=0.8,asetrate=44100*0.9")
              .format("mp3")
              .outputOptions("-y")
              .save(outputPath)
              .on("end", resolve)
              .on("error", reject);
          });
          await message.sendMessage(
            fs.readFileSync(outputPath),
            "audio",
            { quoted: message.quoted }
          );
          try { fs.unlinkSync(outputPath); } catch (e) { }
        } catch (err) {
          console.error("Albüm sesi yavaşlatılamadı:", err);
          await message.sendReply(`_❌ Albümdeki bir dosya yavaşlatılamadı: ${err.message}_`);
        }
      }
      return;
    }

    try {
      const waitMsg = await message.sendReply("_⏳ Ses yavaşlatılıyor..._");
      const savedPath = await message.reply_message.download();
      const quotedSeconds = message.quoted?.message
        ? (message.quoted.message[Object.keys(message.quoted.message)[0]]?.seconds || 0)
        : 0;
      if (quotedSeconds > 120)
        await message.sendReply(`_⚠️ Süre 2 dakikadan uzun, işlem yavaş sürebilir..._`);

      const outPath = getTempPath("slow.mp3");
      await new Promise((resolve, reject) => {
        ffmpeg(savedPath)
          .audioFilter("atempo=0.8,asetrate=44100*0.9")
          .format("mp3")
          .save(outPath)
          .on("end", resolve)
          .on("error", reject);
      });
      await message.sendMessage(fs.readFileSync(outPath), "audio", { quoted: message.data });
      await message.edit("_✅ Başarılı!_", message.jid, waitMsg.key);
      try { fs.unlinkSync(savedPath); fs.unlinkSync(outPath); } catch (e) { }
    } catch (e) {
      console.error("Slow komutu hatası:", e);
      await message.sendReply(`_❌ Hata oluştu: ${e.message}_`);
    }
  }
);
Module(
  {
    pattern: "sped ?(.*)",
    fromMe: false,
    desc: "Müziği hızlandırır ve ses tonunu yükseltir. Sped-up+reverb sesleri yapmak için",
    use: "media",
  },
  async (message, match) => {
    if (message.reply_message === false)
      return await message.sendReply(Lang.MP3_NEED_REPLY);

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const videoFiles = albumData.videos || [];

      if (videoFiles.length === 0) {
        return await message.send("_📭 Albümde video dosyası yok. Hızlandırma için video/ses dosyası gerekir._");
      }

      await message.send(`_⏳ ${videoFiles.length} dosya hızlandırılıyor..._`);
      for (let i = 0; i < videoFiles.length; i++) {
        try {
          const file = videoFiles[i];
          const outputPath = getTempPath(`album_sped_${i}.mp3`);
          await new Promise((resolve, reject) => {
            ffmpeg(file)
              .audioFilter("atempo=1.2,asetrate=44100*1.15")
              .format("mp3")
              .outputOptions("-y")
              .save(outputPath)
              .on("end", resolve)
              .on("error", reject);
          });
          await message.sendMessage(
            fs.readFileSync(outputPath),
            "audio",
            { quoted: message.quoted }
          );
          try { fs.unlinkSync(outputPath); } catch (e) { }
        } catch (err) {
          console.error("Albüm sesi hızlandırılamadı:", err);
          await message.sendReply(`_❌ Albümdeki bir dosya hızlandırılamadı: ${err.message}_`);
        }
      }
      return;
    }

    try {
      const waitMsg = await message.sendReply("_⏳ Ses hızlandırılıyor..._");
      const savedPath = await message.reply_message.download();
      const quotedSeconds = message.quoted?.message
        ? (message.quoted.message[Object.keys(message.quoted.message)[0]]?.seconds || 0)
        : 0;
      if (quotedSeconds > 120)
        await message.sendReply(`_⚠️ Süre 2 dakikadan uzun, işlem yavaş sürebilir..._`);

      const outPath = getTempPath("sped.mp3");
      await new Promise((resolve, reject) => {
        ffmpeg(savedPath)
          .audioFilter("atempo=1.2,asetrate=44100*1.15")
          .format("mp3")
          .save(outPath)
          .on("end", resolve)
          .on("error", reject);
      });
      await message.sendMessage(fs.readFileSync(outPath), "audio", { quoted: message.data });
      await message.edit("_✅ Başarılı!_", message.jid, waitMsg.key);
      try { fs.unlinkSync(savedPath); fs.unlinkSync(outPath); } catch (e) { }
    } catch (e) {
      console.error("Sped komutu hatası:", e);
      await message.sendReply(`_❌ Hata oluştu: ${e.message}_`);
    }
  }
);
Module(
  {
    pattern: "basartır ?(.*)",
    fromMe: false,
    desc: Lang.BASS_DESC,
    use: "media",
  },
  async (message, match) => {
    if (message.reply_message === false)
      return await message.sendReply(Lang.BASS_NEED_REPLY);

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const videoFiles = albumData.videos || [];

      if (videoFiles.length === 0) {
        return await message.send("_📭 Albümde video dosyası yok. Bas için video/ses dosyası gerekir._");
      }

      await message.send(`_⏳ ${videoFiles.length} dosyaya bas ekleniyor..._`);
      for (const file of videoFiles) {
        try {
          const buf = await fs.promises.readFile(file);
          const audioResult = await bass(buf, match[1] ? parseInt(match[1]) : 20);
          await message.sendMessage(audioResult, "audio", { quoted: message.data });
        } catch (err) {
          console.error("Albüm sesine bas eklenemedi:", err);
          await message.sendReply(`_❌ Albümdeki bir dosyaya bas eklenemedi: ${err.message}_`);
        }
      }
      return;
    }

    try {
      const waitMsg = await message.sendReply("_⏳ Ses bası artırılıyor..._");
      const buf = await message.reply_message.download("buffer");
      const gain = match[1] ? parseInt(match[1]) : 20;

      const audioResult = await bass(buf, gain);
      await message.sendMessage(audioResult, "audio", { quoted: message.data });
      await message.edit("_✅ Başarılı!_", message.jid, waitMsg.key);
    } catch (e) {
      console.error("Basartır komutu hatası:", e);
      await message.sendReply(`_❌ Hata oluştu: ${e.message}_`);
    }
  }
);
Module(
  {
    pattern: "foto ?(.*)",
    fromMe: false,
    desc: Lang.PHOTO_DESC,
    use: "media",
  },
  async (message, match) => {
    if (message.reply_message === false)
      return await message.send(Lang.PHOTO_NEED_REPLY);

    try {
      const savedFile = await message.reply_message.download();

      // If it's already an image (jpg/png/etc), send it directly as image
      if (message.reply_message.image) {
        return await message.sendMessage(await fs.promises.readFile(savedFile), "image", { quoted: message.quoted });
      }

      // Otherwise (sticker, webp) - convert via ffmpeg
      const outPng = getTempPath(`foto_${Date.now()}.png`);
      await new Promise((resolve, reject) => {
        ffmpeg(savedFile)
          .save(outPng)
          .on("end", resolve)
          .on("error", reject);
      });
      await message.sendMessage(await fs.promises.readFile(outPng), "image", { quoted: message.quoted });
    } catch (e) {
      console.error("Foto dönüştürme hatası:", e);
      await message.sendReply(`_❌ Görsel dönüştürülemedi. Hata: ${e.message}_`);
    }
  }
);
Module(
  {
    pattern: "yazı1 ?(.*)",
    fromMe: false,
    desc: "Metinden hareketli çıkartmaya",
    use: "media",
  },
  async (message, match) => {
    if (match[1] == "") return await message.send("*_💬 Metin gerekli!_*");
    const result = await attp(match[1]);
    const exif = {
      author: STICKER_DATA.split(";")[1] || "",
      packname: message.senderName,
      categories: STICKER_DATA.split(";")[2] || "😂",
      android: "https://github.com/byadems/Lades-MD/",
      ios: "https://github.com/byadems/Lades-MD/",
    };
    await message.sendMessage(
      fs.readFileSync(await addExif(result, exif)),
      "sticker"
    );
  }
);
Module(
  {
    pattern: "ses ?(.*)",
    fromMe: false,
    desc: Lang.TTS_DESC,
    use: "media",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);

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
      return await message.sendReply("❌ Seslendirilecek metin bulunamadı.");
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
      return await message.sendReply("🚫 OPS! Seslendirme hatası.");
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
        mimetype: "audio/mpeg",
        ptt: true,
      });
    } catch (error) {
      console.error("TTS Hatası:", error);
      await message.sendReply("_" + Lang.TTS_ERROR + "_");
    }
  }
);

Module(
  {
    pattern: "belge ?(.*)",
    fromMe: false,
    desc: "Yanıtlanan medyayı belge (document) formatına dönüştürür",
    use: "media",
  },
  async (message, match) => {
    if (message.reply_message === false)
      return await message.send(
        "_💬 Bir medya dosyasına (görsel, video, ses, çıkartma veya belge) yanıt verin_"
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
        "_💬 Bir medya dosyasına (görsel, video, ses, çıkartma veya belge) yanıt verin_"
      );
    }

    // handle album
    if (message.reply_message.album) {
      const albumData = await message.reply_message.download();
      const allFiles = [...(albumData.images || []), ...(albumData.videos || [])];
      if (allFiles.length === 0) return await message.send("_📭 Albümde medya yok_");

      await message.send(`_⏳ ${allFiles.length} dosya belgeye dönüştürülüyor..._`);
      for (let i = 0; i < allFiles.length; i++) {
        try {
          const filePath = allFiles[i];
          const stream = fs.createReadStream(filePath);
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
            caption: "_✅ Belgeye dönüştürüldü_",
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
        return await message.send("_⚠️ Dosya çok büyük! Maksimum boyut 50MB_");
      }
      const processingMsg = await message.send("_⏳ Belgeye dönüştürülüyor..._");

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
      await message.sendMessage({ stream: stream }, "document", {
        quoted: message.quoted,
        fileName: fileName,
        mimetype: mimetype,
        caption: match[1] ? "" : "_✅ Belgeye dönüştürüldü_",
      });

      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.log("Geçici dosya silinemedi:", filePath);
      }

      await message.edit(
        "_✅ Belge dönüşümü tamamlandı!_",
        message.jid,
        processingMsg.key
      );
    } catch (error) {
      console.error("Belge dönüşüm hatası:", error);
      if (error.message && error.message.includes("download")) {
        await message.send(
          "_❌ Medya indirilemedi. Dosya bozuk veya süresi dolmuş olabilir_"
        );
      } else if (
        error.message &&
        (error.message.includes("large") ||
          error.message.includes("memory"))
      ) {
        await message.send("_⚠️ Dosya işlemek için çok büyük_");
      } else {
        await message.send("_❌ Medya belgeye dönüştürülemedi_");
      }
    }
  }
);
Module(
  {
    pattern: "indir ?(.*)",
    fromMe: false,
    desc: "URL üzerindeki dosyayı indirir ve sohbete yükler.",
    use: "media",
  },
  async (message, match) => {
    let url =
      match[1] || (message.reply_message ? message.reply_message.text : "");

    const urlMatch = url.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      url = urlMatch[0];
    }

    if (!url || !url.startsWith("http")) {
      return await message.send(
        "_💬 Geçerli bir URL girin veya URL içeren bir mesaja yanıt verin_"
      );
    }

    try {
      await message.send("_⏳ Dosya indiriliyor..._");

      const response = await axios.get(url, {
        responseType: "stream",
        timeout: 60000,
      });

      const randomHash = Math.random().toString(36).substring(2, 8);
      let fileName = `downloaded_file_${randomHash}`;
      let mimetype =
        response.headers["content-type"] || "application/octet-stream";

      const contentDisposition = response.headers["content-disposition"];
      if (contentDisposition && contentDisposition.includes("filename=")) {
        const filenameMatch = contentDisposition.match(
          /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/
        );
        if (filenameMatch) {
          fileName = filenameMatch[1].replace(/['"]/g, "");
        }
      } else {
        const urlPath = new URL(url).pathname;
        const urlFileName = urlPath.split("/").pop();
        if (urlFileName && urlFileName.includes(".")) {
          fileName = urlFileName;
        }
      }

      if (!fileName.includes(".") && response.headers["content-type"]) {
        const ext = response.headers["content-type"].split("/")[1];
        if (ext && ext !== "octet-stream") {
          fileName += `.${ext}`;
        }
      }
      await message.sendMessage({ stream: response.data }, "document", {
        quoted: message.quoted,
        fileName: fileName,
        mimetype: mimetype,
        caption: `_✅ İndirildi: ${url}_`,
      });
    } catch (error) {
      console.error("Yükleme hatası:", error);
      if (error.code === "ECONNABORTED") {
        await message.send(
          "_⏱️ İndirme zaman aşımı. Dosya çok büyük veya sunucu yavaş olabilir_"
        );
      } else if (error.response && error.response.status === 404) {
        await message.send("_❌ Dosya bulunamadı (404). Lütfen URL'yi kontrol edin_");
      } else if (error.response && error.response.status >= 400) {
        await message.send(
          `_❌ İndirme başarısız (durum: ${error.response.status})_`
        );
      } else {
        await message.send(
          "_❌ Dosya indirilemedi. Lütfen URL'yi kontrol edip tekrar deneyin_"
        );
      }
    }
  }
);

Module(
  {
    pattern: "square ?(.*)",
    fromMe: false,
    desc: "Video/resmi 1:1 oranında (kare formatında) kırpar",
    use: "media",
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
            const fs = require("fs").promises;
            if (isVideo) {
              await message.sendMessage(await fs.readFile(outputPath), "video", {
                quoted: message.quoted,
                caption: "_✅ Kare formata kırpıldı_",
              });
            } else {
              await message.sendMessage(await fs.readFile(outputPath), "image", {
                quoted: message.quoted,
                caption: "_✅ Kare formata kırpıldı_",
              });
            }

            await fs.unlink(savedFile).catch(() => { });
            await fs.unlink(outputPath).catch(() => { });

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

Module(
  {
    pattern: "boyut ?(.*)",
    fromMe: false,
    desc: "Video/resim en-boy oranını değiştirin. Kullanım: .boyut 16:9, .boyut 9:16",
    use: "media",
  },
  async (message, match) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video && !message.reply_message.image)
    ) {
      return await message.sendReply("_🎬 Boyutunu değiştirmek için bir videoyu veya görseli yanıtlayın!_"
      );
    }

    if (!match[1]) {
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
            const fs = require("fs").promises;
            if (isVideo) {
              await message.sendMessage(await fs.readFile(outputPath), "video", {
                quoted: message.quoted,
                caption: `_✅ ${input} en-boy oranına boyutlandırıldı (${targetWidth}x${targetHeight})_`,
              });
            } else {
              await message.sendMessage(await fs.readFile(outputPath), "image", {
                quoted: message.quoted,
                caption: `_✅ ${input} en-boy oranına boyutlandırıldı (${targetWidth}x${targetHeight})_`,
              });
            }

            await fs.unlink(savedFile).catch(() => { });
            await fs.unlink(outputPath).catch(() => { });

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
Module(
  {
    pattern: "sıkıştır ?(.*)",
    fromMe: false,
    desc: "Video/resmi yüzdeyle sıkıştırın. Kullanım: .sıkıştır 50 (%50 sıkıştırma)",
    use: "media",
  },
  async (message, match) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video && !message.reply_message.image)
    ) {
      return await message.sendReply("_🎬 Sıkıştırmak için bir videoyu veya resmi yanıtlayın_"
      );
    }

    if (!match[1]) {
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
            const fs = require("fs").promises;
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

            const fs = require("fs").promises;
            if (isVideo) {
              await message.sendMessage(await fs.readFile(outputPath), "video", {
                quoted: message.quoted,
                caption: `_✅ %${actualReduction} sıkıştırıldı_\n_${formatSize(
                  originalSize
                )} → ${formatSize(compressedSize)}_`,
              });
            } else {
              await message.sendMessage(await fs.readFile(outputPath), "image", {
                quoted: message.quoted,
                caption: `_✅ %${actualReduction} sıkıştırıldı_\n_${formatSize(
                  originalSize
                )} → ${formatSize(compressedSize)}_`,
              });
            }

            await fs.unlink(savedFile).catch(() => { });
            await fs.unlink(outputPath).catch(() => { });

            await message.edit(
              `_✅ Sıkıştırma tamamlandı (%${actualReduction} azalma)_`,
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
