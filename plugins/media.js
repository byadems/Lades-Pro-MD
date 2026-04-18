"use strict";

/**
 * Merged Module: media.js
 * Components: media.js, editor.js, pdf.js, removebg.js, fancy.js, take.js
 */

// ==========================================
// FILE: media.js
// ==========================================
(function() {
const { Module } = require("../main");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegStatic);
const https = require("https");
const { getTempPath, getTempSubdir, ffmpegLimit } = require("../core/helpers");

const config = require("../config"),
  MODE = config.MODE;
const { avMix, circle, rotate, trim, uploadToImgbb, nx, nxTry, uploadToCatbox } = require("./utils");
const nexray = require("./utils/nexray");
const { censorBadWords } = require("./utils/censor");
const handler = config.HANDLER_PREFIX;

// ── API key varlığını modül başında bir kez kontrol et (her mesajda tekrar hesaplama)
const _hasGroqKey   = !!config.GROQ_API_KEY   && config.GROQ_API_KEY   !== '';
const _hasOpenAIKey = !!config.OPENAI_API_KEY  && config.OPENAI_API_KEY !== '';
const _hasTranscribeApi = _hasGroqKey || _hasOpenAIKey;

async function findMusic(file) {
  const acrcloud = require("acrcloud");
  const acr = new acrcloud({
    host: "identify-eu-west-1.acrcloud.com",
    access_key: config.ACR_A,
    access_secret: config.ACR_S,
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Müzik tanıma zaman aşımına uğradı")), 15000);
    acr.identify(file).then((result) => {
      clearTimeout(timeout);
      resolve(result.metadata?.music?.[0] ?? null);
    }).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
function safeParseErrorBody(data) {
  if (!data) return null;
  if (typeof data === "object") return data;
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch (_err) {
      return data;
    }
  }
  return null;
}

function resolveApiErrorMessage(errorData, fallbackError) {
  const parsed = safeParseErrorBody(errorData);
  const apiMessage = parsed && typeof parsed === "object"
    ? parsed.error?.message || parsed.message || parsed.error
    : null;
  if (apiMessage) return apiMessage;
  if (typeof parsed === "string") {
    return parsed.slice(0, 160);
  }
  return fallbackError?.message || "Bilinmeyen hata";
}

async function transcribeVoiceMessage(message, targetMessage) {
  let processingMsg;
  try {
    const voiceMsg = targetMessage || message;
    const isVoice = voiceMsg.audio ||
      voiceMsg.ptt ||
      voiceMsg.data?.message?.audioMessage ||
      voiceMsg.reply_message?.audio ||
      voiceMsg.reply_message?.ptt;
    if (!isVoice) {
      return;
    }
    if ((!config.GROQ_API_KEY || config.GROQ_API_KEY === '') &&
      (!config.OPENAI_API_KEY || config.OPENAI_API_KEY === '')) {
      return await message.sendReply("⚠️ _API Anahtarı bulunamadı! (Groq veya OpenAI)_");
    }
    processingMsg = await message.send("🎙️ _Ses analiz ediliyor..._");
    const audioBuffer = await voiceMsg.download("buffer");
    const boundary = `----WebKitFormBoundary${Date.now()}`;
    const buildBody = (modelName) => {
      const c = [];
      c.push(Buffer.from(`--${boundary}\r\n`));
      c.push(Buffer.from(`Content-Disposition: form-data; name="model"\r\n\r\n`));
      c.push(Buffer.from(`${modelName}\r\n`));
      c.push(Buffer.from(`--${boundary}\r\n`));
      c.push(Buffer.from(`Content-Disposition: form-data; name="language"\r\n\r\n`));
      c.push(Buffer.from(`tr\r\n`));
      c.push(Buffer.from(`--${boundary}\r\n`));
      c.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="audio.ogg"\r\n`));
      c.push(Buffer.from(`Content-Type: audio/ogg; codecs=opus\r\n\r\n`));
      c.push(audioBuffer);
      c.push(Buffer.from(`\r\n`));
      c.push(Buffer.from(`--${boundary}--\r\n`));
      return Buffer.concat(c);
    };
    const useGroq = config.GROQ_API_KEY && config.GROQ_API_KEY !== '';
    const makeRequest = (useOpenAI = false) => {
      const body = buildBody(useOpenAI ? "gpt-4o-mini-transcribe" : "whisper-large-v3");
      return new Promise((resolve, reject) => {
        const options = useOpenAI ? {
          hostname: 'api.openai.com',
          port: 443,
          path: '/v1/audio/transcriptions',
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
            'Content-Length': body.length
          }
        } : {
          hostname: 'api.groq.com',
          port: 443,
          path: '/openai/v1/audio/transcriptions',
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Authorization': `Bearer ${config.GROQ_API_KEY}`,
            'Content-Length': body.length
          }
        };
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject({ statusCode: res.statusCode, data, useOpenAI });
            } else {
              resolve({ data, useOpenAI });
            }
          });
        });
        req.on('error', (err) => {
          reject({ error: err, useOpenAI });
        });
        req.write(body);
        req.end();
      });
    };

    let response;
    try {
      if (useGroq) {
        response = await makeRequest(false);
      } else {
        response = await makeRequest(true);
      }
    } catch (groqError) {
      if (!groqError.useOpenAI && config.OPENAI_API_KEY && config.OPENAI_API_KEY !== '') {
        console.log("⚠️ Groq başarısız, OpenAI API'ye geçiliyor...");
        try {
          response = await makeRequest(true);
          console.log("✅ OpenAI API başarılı!");
        } catch (openaiError) {
          console.error("❌ Her iki API de başarısız:", openaiError);
          const errorText = resolveApiErrorMessage(openaiError.data, openaiError.error);
          return await message.edit(
            `⚠️ _API hatası: ${openaiError.statusCode || 'Bağlantı hatası'}_\n_${errorText}_`,
            message.jid, processingMsg.key
          );
        }
      } else {
        console.error("❌ Groq API hatası ve OpenAI anahtarı yok:", groqError);
        const errorText = resolveApiErrorMessage(groqError.data, groqError.error);
        return await message.edit(
          `⚠️ _API hatası: ${groqError.statusCode || 'Bağlantı hatası'}_\n_${errorText}_`,
          message.jid, processingMsg.key
        );
      }
    }
    try {
      const result = JSON.parse(response.data);
      let transcription = result.text;
      if (!transcription || transcription.trim() === '') {
        return await message.edit(
          "❌ _Maalesef, sesi analiz edemedim veya sessizlik tespit ettim._",
          message.jid, processingMsg.key
        );
      }
      transcription = censorBadWords(transcription);
      const apiUsed = response.useOpenAI ? "OpenAI" : "Groq";
      return await message.edit(
        `🎙️ *Seste şunları duydum:*\n\n_"${transcription}"_`,
        message.jid, processingMsg.key
      );
    } catch (parseErr) {
      console.error("Yanıt hatası:", parseErr, response.data);
      return await message.edit("⚠️ _API yanıtı işlenirken hata oluştu. .dinle komutu ile deneyin._", message.jid, processingMsg.key);
    }
  } catch (err) {
    console.error("dinle modülünde hata:", err);
    if (processingMsg) {
      return await message.edit("⚠️ Ses çevrilirken bir hata oluştu.", message.jid, processingMsg.key);
    } else {
      return await message.send("⚠️ Ses çevrilirken bir hata oluştu.");
    }
  }
}

Module({
  pattern: "dinle",
  fromMe: false,
  desc: "Sesli mesajı metne dönüştürür. (Tek seferlik sesler de dahil)",
  usage: ".dinle (bir ses mesajına yanıtlayarak)",
  use: "araçlar",
},
  async (message, match) => {
    const replied = message.reply_message;
    if (!replied || (!replied.audio && !replied.ptt)) {
      return await message.sendReply("❌ Lütfen bir ses mesajına yanıtlayarak yazın!");
    }
    return await transcribeVoiceMessage(message, replied);
  });

Module({
  on: 'message',
  fromMe: false,
  desc: "Ses mesajını otomatik olarak metne dönüştürür.",
  use: "araçlar",
},
  async (message, match) => {
    try {
      const audioMsg = message.data?.message?.audioMessage;
      if (!audioMsg) return;
      // Modül başında hesaplanan flag kullanılıyor (her mesajda config kontrole yok)
      if (!_hasTranscribeApi) return;
      return await transcribeVoiceMessage(message, message);
    } catch (err) {
      console.error("Otomatik dinle hatası:", err);
    }
  });

Module({
  pattern: "kes ?(.*)",
  fromMe: false,
  desc: "Video veya ses dosyalarını belirlediğiniz sürelere göre keser.",
  usage: ".kes [başlangıç,bitiş]",
  use: "medya",
},
  async (message, match) => {
    if (
      !message.reply_message ||
      (!message.reply_message.video && !message.reply_message.audio)
    )
      return await message.sendReply("❗️ *Geçersiz format!:*.\n*.trim 10,30*");
    if (!match[1] || !match[1].includes(","))
      return await message.sendReply(
        message.reply_message.audio ? "❗️ *Geçersiz format!:*.\n*.trim 10,30*" : "❗️ *Geçersiz format!*\n*.trim 5,10*\n*.trim 1:05,1:20*"
      );
    const parts = match[1].split(",");
    const start = parts[0]?.trim();
    const end = parts[1]?.trim();
    const savedFile = await message.reply_message.download();
    await message.sendMessage("_⏳ Kesme işlemi yapılıyor..._");
    if (message.reply_message.audio) {
      const out = getTempPath("trim.ogg");
      await trim(savedFile, start, end, out);
      await message.sendReply({ stream: fs.createReadStream(out) }, "audio");
    } else if (message.reply_message.video) {
      const out = getTempPath("trim.mp4");
      await trim(savedFile, start, end, out);
      await message.send({ stream: fs.createReadStream(out) }, "video");
    }
  }
);
Module({
  pattern: "renklendir",
  fromMe: false,
  desc: "Siyah-beyaz olan fotoğrafı renklendirir.",
  usage: ".renklendir (görsele yanıt verin)",
  use: "medya",
},
  async (message) => {
    if (!message.reply_message || !message.reply_message.image)
      return await message.sendReply("_🖼️ Renklendirmek için siyah-beyaz olan bir görsele yanıt verin._");

    try {
      const processingMsg = await message.sendReply("_🎨 Görsel renklendiriliyor..._");
      const imgPath = await message.reply_message.download();
      const uploadRes = await uploadToImgbb(imgPath);
      const imageUrl = uploadRes?.url || uploadRes?.image?.url;
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);

      if (!imageUrl) {
        await message.edit("_❌ Görsel yüklenemedi. Lütfen tekrar deneyin._", message.jid, processingMsg.key);
        return;
      }

      const resultBuffer = await nexray.colorize(imageUrl);
      if (resultBuffer && resultBuffer.length) {
        await message.sendReply(resultBuffer, "image");
        await message.edit("_✅ Renklendirme tamamlandı!_", message.jid, processingMsg.key);
      } else {
        await message.edit("_❌ Renklendirme başarısız. Lütfen tekrar deneyin._", message.jid, processingMsg.key);
      }
    } catch (error) {
      console.error("Renklendir hatası:", error);
      await message.sendReply("_❌ Bir hata oluştu. Lütfen tekrar deneyin._");
    }
  }
);

Module({
  pattern: "siyahvideo",
  fromMe: false,
  desc: "Bir ses dosyasını siyah ekranlı video formatına dönüştürür.",
  usage: ".siyahvideo [yanıtla]",
  use: "medya",
},
  async (message, match) => {
    if (!message.reply_message || !message.reply_message.audio)
      return await message.send("_🎵 Ses dosyası gerekli!_");

    try {
      const processingMsg = await message.sendReply("_🎬 Ses siyah ekrana sahip videoya dönüştürülüyor..._");
      const audioFile = await message.reply_message.download();
      const outputPath = getTempPath(`black_${Date.now()}.mp4`);

      // ffmpegLimit: eş zamanlı en fazla 3 FFmpeg işlemi çalışır (CPU koruma)
      await ffmpegLimit(() => new Promise((resolve, reject) => {
        ffmpeg()
          .input(audioFile)
          .input("color=c=black:s=320x240:r=30")
          .inputFormat("lavfi")
          .outputOptions([
            "-shortest", "-c:v", "libx264", "-preset", "ultrafast",
            "-crf", "51", "-c:a", "copy", "-pix_fmt", "yuv420p",
          ])
          .format("mp4")
          .save(outputPath)
          .on("end", resolve)
          .on("error", reject);
      }));

      const videoBuffer = await fs.promises.readFile(outputPath);
      await message.send(videoBuffer, "video");
      await message.edit("_✅ Siyah video başarıyla oluşturuldu!_", message.jid, processingMsg.key);
      await fs.promises.unlink(audioFile).catch(() => {});
      await fs.promises.unlink(outputPath).catch(() => {});
    } catch (error) {
      console.error("Siyah video oluşturma hatası:", error);
      await message.send("_❌ Siyah video oluşturulamadı. Lütfen tekrar deneyin._");
    }
  }
);
Module({
  pattern: "birleştir",
  fromMe: false,
  desc: "Ayrı olan ses ve video dosyalarını tek bir videoda birleştirir.",
  usage: ".birleştir [yanıtla]",
  use: "medya",
},
  async (message, match) => {
    const avmixDir = getTempSubdir("avmix");
    const files = await fs.promises.readdir(avmixDir);
    if (
      (!message.reply_message && files.length < 2) ||
      (message.reply_message &&
        !message.reply_message.audio &&
        !message.reply_message.video)
    )
      return await message.send("❗️ *Birleştirebilmek için bir sese ve videoya yanıt verin!*");
    if (message.reply_message.audio) {
      const savedFile = await message.reply_message.download();
      await fs.promises.writeFile(
        getTempPath("avmix/audio.mp3"),
        await fs.promises.readFile(savedFile)
      );
      return await message.sendReply("✅ *Birleştirilecek ses başarıyla veritabanına eklendi.*");
    }
    if (message.reply_message.video) {
      const savedFile = await message.reply_message.download();
      await fs.promises.writeFile(
        getTempPath("avmix/video.mp4"),
        await fs.promises.readFile(savedFile)
      );
      return await message.sendReply("✅ *Birleştirilecek video başarıyla veritabanına eklendi.*");
    }
    if (files.length >= 2 || !message.reply_message) {
      let video = await avMix(
        getTempPath("avmix/video.mp4"),
        getTempPath("avmix/audio.mp3")
      );
      await message.sendReply(video, "video");
      await fs.promises.unlink(getTempPath("avmix/video.mp4")).catch(() => { });
      await fs.promises.unlink(getTempPath("avmix/audio.mp3")).catch(() => { });
      await fs.promises.unlink("./merged.mp4").catch(() => { });
      return;
    }
  }
);
Module({
  pattern: "vbirleştir ?(.*)",
  fromMe: false,
  desc: "İki farklı video dosyasını tek bir video haline getirir.",
  usage: ".vbirleştir [yanıtla]",
  use: "medya",
},
  async (message, match) => {
    const vmixDir = getTempSubdir("vmix");
    const files = await fs.promises.readdir(vmixDir);
    if (
      (!message.reply_message && files.length < 2) ||
      (message.reply_message && !message.reply_message.video)
    )
      return await message.send("_🎬 Bana videolar verin!_");
    if (message.reply_message.video && files.length == 1) {
      const savedFile = await message.reply_message.download();
      await fs.promises.writeFile(
        getTempPath("vmix/video1.mp4"),
        await fs.promises.readFile(savedFile)
      );
      return await message.sendReply("*🎬 2. Video Eklendi. Çıktı için tekrar .vbirleştir yazın!*"
      );
    }
    if (message.reply_message.video && files.length == 0) {
      const savedFile = await message.reply_message.download();
      await fs.promises.writeFile(
        getTempPath("vmix/video2.mp4"),
        await fs.promises.readFile(savedFile)
      );
      return await message.sendReply("*🎬 1. Video Eklendi*");
    }
    async function merge(files, folder, filename) {
      return new Promise((resolve, reject) => {
        const cmd = ffmpeg({ priority: 20 })
          .fps(29.7)
          .on("error", function (err) {
            resolve();
          })
          .on("end", function () {
            resolve(fs.readFileSync(folder + "/" + filename));
          });

        for (let i = 0; i < files.length; i++) {
          cmd.input(files[i]);
        }

        cmd.mergeToFile(folder + "/" + filename, folder);
      });
    }
    if (files.length === 2) {
      await message.sendReply("*🎬 Videolar birleştiriliyor..*");
      const mergedFile = await merge(
        [getTempPath("vmix/video1.mp4"), getTempPath("vmix/video2.mp4")],
        getTempSubdir(""),
        "merged.mp4"
      );
      await message.send(mergedFile, "video");
      await fs.promises.unlink(getTempPath("vmix/video1.mp4")).catch(() => { });
      await fs.promises.unlink(getTempPath("vmix/video2.mp4")).catch(() => { });
      return;
    }
  }
);
Module({
  pattern: "ağırçekim",
  fromMe: false,
  desc: "Videoya pürüzsüz bir ağır çekim efekti uygular.",
  usage: ".ağırçekim [yanıtla]",
  use: "medya",
},
  async (message, match) => {
    if (!message.reply_message || !message.reply_message.video)
      return await message.sendReply("*🎬 Bir videoyu yanıtla*");
    const savedFile = await message.reply_message.download();
    await message.sendReply("*✨ Hareket enterpolasyonu ve işleniyor..*");
    // ffmpegLimit: CPU aşımını önler
    const outPath = getTempPath("slowmo.mp4");
    await ffmpegLimit(() => new Promise((resolve, reject) => {
      ffmpeg(savedFile)
        .videoFilters("minterpolate=fps=120")
        .videoFilters("setpts=4*PTS")
        .noAudio()
        .format("mp4")
        .save(outPath)
        .on("end", resolve)
        .on("error", reject);
    }));
    const buf = await fs.promises.readFile(outPath);
    await message.send(buf, "video");
    await fs.promises.unlink(outPath).catch(() => {});
    await fs.promises.unlink(savedFile).catch(() => {});
  }
);
Module({
  pattern: "oval",
  fromMe: false,
  desc: "Görselleri veya çıkartmaları oval (yuvarlak) şekilde kırpar.",
  usage: ".oval [yanıtla]",
  use: "medya",
},
  async (message, match) => {
    if (!message.reply_message || (!message.reply_message.image && !message.reply_message.sticker)) {
      return await message.sendReply("*🖼️ Bir görsel veya çıkartmayı yanıtla*");
    }
    try {
      const buffer = await message.reply_message.download();
      const result = await circle(buffer);
      await message.send(result, "image", { caption: "_✅ Oval kırpma tamamlandı!_" });
    } catch (err) {
      await message.sendReply(`_❌ Hata: ${err.message}_`);
    }
  }
);
Module({
  pattern: "gif",
  fromMe: false,
  use: "medya",
  desc: "Videoyu sesli bir GIF (hareketli resim) formatına dönüştürür.",
  usage: ".gif [yanıtla]",
},
  async (message, match) => {
    if (!message.reply_message || !message.reply_message.video)
      return await message.sendReply("*🎬 Bir videoyu yanıtla*");
    const savedFile = await message.reply_message.download();
    await message.sendReply("*⏳ İşleniyor..*");
    const outPath = getTempPath("agif.mp4");
    // ffmpegLimit: eş zamanlı CPU aşımını önler
    await ffmpegLimit(() => new Promise((resolve, reject) => {
      ffmpeg(savedFile)
        .fps(13)
        .videoBitrate(500)
        .save(outPath)
        .on("end", resolve)
        .on("error", reject);
    }));
    const buf = await fs.promises.readFile(outPath);
    await message.client.sendMessage(message.jid, { video: buf, gifPlayback: true });
    await fs.promises.unlink(outPath).catch(() => {});
    await fs.promises.unlink(savedFile).catch(() => {});
  }
);
Module({
  pattern: "fps ?(.*)",
  fromMe: false,
  desc: "Videonun kare hızını (FPS) arttırarak daha akıcı görünmesini sağlar.",
  usage: ".fps [değer]",
  use: "medya",
},
  async (message, match) => {
    if (!message.reply_message || !message.reply_message.video)
      return await message.sendReply("*🎬 Bir videoyu yanıtla*");
    if (match[1] <= 10)
      return await message.send("*⚠️ FPS değeri düşük*\n*Minimum = 10*");
    if (match[1] >= 500)
      return await message.send("*⚠️ FPS değeri yüksek*\n*Maksimum = 500*");
    const savedFile = await message.reply_message.download();
    await message.sendReply("*✨ FPS işleniyor..*");
    const outPath = getTempPath("interp.mp4");
    // ffmpegLimit: eş zamanlı CPU aşımını önler
    await ffmpegLimit(() => new Promise((resolve, reject) => {
      ffmpeg(savedFile)
        .videoFilters(`minterpolate=fps=${match[1]}:mi_mode=mci:me_mode=bidir`)
        .format("mp4")
        .save(outPath)
        .on("end", resolve)
        .on("error", reject);
    }));
    const buf = await fs.promises.readFile(outPath);
    await message.send(buf, "video");
    await fs.promises.unlink(outPath).catch(() => {});
    await fs.promises.unlink(savedFile).catch(() => {});
  }
);
Module({
  pattern: "bul ?(.*)",
  fromMe: false,
  desc: "Arka planda çalan müziği dinleyerek şarkıyı bulur.",
  usage: ".bul [yanıtla]",
  use: "araçlar",
},
  async (message, match) => {
    if (!message.reply_message?.audio)
      return await message.sendReply("⚠️ Bir ses dosyasına etiketleyerek yazın!");

    const { seconds } = message.quoted.message[Object.keys(message.quoted.message)[0]];
    if (seconds > 60)
      return await message.sendReply(
        "⚠️ *Ses çok uzun! .trim komutunu kullanıp sesi 60 saniyeye düşürmenizi öneririm.*"
      );

    await message.send("🧐 Şarkıyı dinliyorum...");
    const audio = await message.reply_message.download("buffer");
    const data = await findMusic(audio);
    if (!data)
      return await message.sendReply(
        "🤯 Eşleşen bir sonuç bulunamadı! 👩🏻‍🔧 Dilerseniz daha iyi bir analiz için 15 saniyenin üzerinde kaydederek tekrar deneyin."
      );

    function getDuration(millis) {
      const minutes = Math.floor(millis / 60000);
      const seconds = ((millis % 60000) / 1000).toFixed(0);
      return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
    }

    const Message = {
      text: `🎶 Başlık: *${data.title}*
🎤 Sanatçılar: ${data.artists?.map((e) => e.name + " ")}
📆 Çıkış Tarihi: ${data.release_date}
⏱️ Süre: ${getDuration(data.duration_ms)}
💿 Albüm: ${data.album?.name}
🕺🏻 Tür: ${data.genres?.map((e) => e.name + " ")}
🏢 Yapım Şirketi: ${data.label}
🤔 Spotify: ${"spotify" in data.external_metadata ? "Mevcut" : "Mevcut Değil"}
▶️ YouTube: *${"youtube" in data.external_metadata ? "https://youtu.be/" + data.external_metadata.youtube.vid : "Mevcut Değil"}*\n
ℹ️ İndirmek isterseniz *".şarkı Şarkı İsmi"* şeklinde yazabilirsiniz.`,
    };

    await message.client.sendMessage(message.jid, Message);
  }
);
Module({
  pattern: "döndür ?(.*)",
  fromMe: false,
  use: "medya",
  desc: "Videonun yönünü sola, sağa veya ters şekilde döndürmenizi sağlar.",
  usage: ".döndür [sol/sağ/ters]",
},
  async (message, match) => {
    if (!match[1] || !message.reply_message || !message.reply_message.video)
      return await message.sendReply("*🎬 Bir videoyu yanıtla*\n*.döndür sol|sağ|ters*"
      );
    const file = await message.reply_message.download();
    let angle = "1";
    const dir = (match[1] || "").toLowerCase();
    if (dir === "sol") angle = "2";
    if (dir === "ters") angle = "3";
    const rotatedFilePath = await rotate(file, angle);
    await message.sendReply(
      await fs.promises.readFile(rotatedFilePath),
      "video"
    );
    await fs.promises.unlink(file).catch(() => { });
    await fs.promises.unlink(rotatedFilePath).catch(() => { });
  }
);
Module({
  pattern: "flip ?(.*)",
  fromMe: false,
  use: "medya",
  desc: "Videoyu yatay veya dikey eksende aynalayarak ters çevirir.",
  usage: ".flip [yanıtla]",
},
  async (message, match) => {
    if (!message.reply_message || !message.reply_message.video)
      return await message.sendReply("*🎬 Bir videoyu yanıtla*");
    const file = await message.reply_message.download();
    const angle = "3";
    const flippedFilePath = await rotate(file, angle);
    await message.sendReply(
      await fs.promises.readFile(flippedFilePath),
      "video"
    );
    await fs.promises.unlink(file).catch(() => { });
    await fs.promises.unlink(flippedFilePath).catch(() => { });
  }
);

Module({
  pattern: "ss ?(.*)",
  fromMe: false,
  desc: "Belirlediğiniz bir internet sitesinin anlık ekran görüntüsünü alır.",
  usage: ".ss [link]",
  use: "araçlar",
},
  async (message, match) => {
    let url = (match[1] || "").trim();
    if (message.reply_message?.text && !url) {
      const m = message.reply_message.text.match(/https?:\/\/\S+/);
      if (m) url = m[0];
    }
    if (!url) return await message.sendReply("🌐 _Web sitesi URL'si girin:_ `.ss fenomensen.net`");
    if (!url.startsWith("http")) url = "https://" + url;
    try {
      const res = await nxTry([
        `/tools/ssweb?url=${encodeURIComponent(url)}`,
      ], { buffer: true, timeout: 60000 });

      const imgData = res.url ? { url: res.url } : res;
      await message.client.sendMessage(message.jid, {
        image: imgData,
      }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Ekran görüntüsünü alamadım:_ ${e.message}`);
    }
  }
);

Module({
  pattern: "metin ?(.*)",
  fromMe: false,
  desc: "Görsel içerisindeki metinleri tarayarak yazıya dönüştürür (OCR).",
  usage: ".metin [yanıtla]",
  use: "araçlar",
},
  async (message, match) => {
    const replyMime = message.reply_message?.mimetype || "";
    const isImg = replyMime.startsWith("image/");
    let imgUrl = (match[1] || "").trim();
    if (!isImg && !imgUrl.startsWith("http")) return await message.sendReply("🖼️ _Bir görseli yanıtlayın:_ `.metin`");
    try {
      if (!imgUrl && isImg) {
        const wait = await message.send("🔍 _İnceliyorum..._");
        const path = await message.reply_message.download();
        const { url } = await uploadToCatbox(path);
        imgUrl = url;
        await message.edit("✍🏻 _Metni okuyorum..._", message.jid, wait.key);
      }
      if (!imgUrl || imgUrl.includes("hata")) throw new Error("Görsel URL alınamadı!");

      const result = await nxTry([
        `/tools/ocr?url=${encodeURIComponent(imgUrl)}`,
        `/tools/ocr?image=${encodeURIComponent(imgUrl)}`,
      ]);
      const text = typeof result === "string" ? result : result?.text || result?.result || JSON.stringify(result);
      if (!text || text === "null") throw new Error("Metin bulunamadı");
      await message.sendReply(`📝 *Görselde şunlar yazıyor:*\n\n${text}`);
    } catch (e) {
      await message.sendReply(`❌ _Metni okuyamadım:_ ${e.message}`);
    }
  }
);

Module({
  pattern: "hd ?(.*)",
  fromMe: false,
  desc: "Düşük çözünürlüklü görselleri netleştirir ve HD kaliteye yükseltir.",
  usage: ".hd [yanıtla]",
  use: "medya",
},
  async (message, match) => {
    const replyMime = message.reply_message?.mimetype || "";
    const isImg = replyMime.startsWith("image/");
    let imgUrl = (match[1] || "").trim();
    if (!isImg && !imgUrl.startsWith("http")) return await message.sendReply("🖼️ _Bir görseli yanıtlayın:_ `.hd`");
    try {
      if (!imgUrl && isImg) {
        const wait = await message.send("⬆️ _İşliyorum..._");
        const path = await message.reply_message.download();
        const { url } = await uploadToCatbox(path);
        imgUrl = url;
        await message.edit("😎 _Görseli yükseltiyorum..._", message.jid, wait.key);
      }
      if (!imgUrl || imgUrl.includes("hata")) throw new Error("Görsel URL alınamadı");

      const buf = await nxTry([
        `/tools/upscale?url=${encodeURIComponent(imgUrl)}&resolusi=2`,
        `/tools/upscale?url=${encodeURIComponent(imgUrl)}&resolution=2`,
        `/tools/upscale?image=${encodeURIComponent(imgUrl)}&resolusi=2`,
      ], { buffer: true, timeout: 90000 });
      await message.client.sendMessage(message.jid, { image: buf, caption: "✨ *İşte bu kadar, HD kaliteye yükselttim!*" }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Tüh! Yükseltme başarısız:_ ${e.message}`);
    }
  }
);

Module({
  pattern: "meme ?(.*)",
  fromMe: false,
  desc: "Görsellere üst ve alt metin ekleyerek meme (caps) oluşturur.",
  usage: ".meme ÜSTMETIN|ALTMETIN (görsel yanıtla)",
  use: "medya",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const replyMime = message.reply_message?.mimetype || "";
    const isImg = replyMime.startsWith("image/");
    if (!input || !input.includes("|")) return await message.sendReply("😂 _Kullanım:_ `.meme ÜSTMETİN|ALTMETİN` _(görsel yanıtlayarak)_");
    if (!isImg) return await message.sendReply("🖼️ _Bir görseli yanıtlayın:_ `.meme ÜSTMETİN|ALTMETİN`");
    const [top, bottom] = input.split("|").map(s => s.trim());
    try {
      const wait = await message.send("⌛ _Meme oluşturuyorum..._");
      const path = await message.reply_message.download();
      const { url } = await uploadToCatbox(path);
      if (!url || url.includes("hata")) throw new Error("Görsel yüklenemedi");

      const result = await nx(
        `/maker/smeme?background=${encodeURIComponent(url)}&text_atas=${encodeURIComponent(top)}&text_bawah=${encodeURIComponent(bottom || "")}`,
        { buffer: true }
      );
      await message.edit("😂", message.jid, wait.key);
      await message.client.sendMessage(message.jid, { image: result, caption: `😂 *${top}* — *${bottom}*` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Meme oluşturamadım:_ ${e.message}`);
    }
  }
);

Module({
  pattern: "kodgörsel ?(.*)",
  fromMe: false,
  desc: "Yazdığınız programlama kodlarını şık ve okunabilir bir görsele dönüştürür.",
  usage: ".kodgörsel [metin]",
  use: "medya",
},
  async (message, match) => {
    let code = (match[1] || "").trim();
    if (!code && message.reply_message?.text) code = message.reply_message.text.trim();
    if (!code) return await message.sendReply("💻 _Metin girin:_ `.kodgörsel const x = 1`");
    try {
      const buf = await nx(`/maker/codesnap?code=${encodeURIComponent(code)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Kod görselini oluşturamadım:_ ${e.message}`);
    }
  }
);
})();

// ==========================================
// FILE: editor.js
// ==========================================
(function() {
const { Module } = require("../main");
const { getBuffer, nx, uploadToCatbox, uploadToImgbb } = require("./utils");

const EFFECTS = [
  { command: "blur", desc: "Fotoğrafı profesyonelce bulanıklaştırır.", route: "filter/blur" },
  { command: "pixelate", desc: "Fotoğrafı pikselli sanat eserine dönüştürür.", route: "filter/pixelate" },
  { command: "blue", desc: "Fotoğrafa mavi renk filtresi uygular.", route: "filter/blue" },
  { command: "blurple", desc: "Fotoğrafa blurple renk filtresi uygular.", route: "filter/blurple" },
  { command: "blurple2", desc: "Fotoğrafa alternatif blurple filtresi uygular.", route: "filter/blurple2" },
  { command: "brightness", desc: "Fotoğrafın parlaklık seviyesini artırır.", route: "filter/brightness" },
  { command: "color", desc: "Fotoğrafın renk doygunluğunu ayarlar.", route: "filter/color" },
  { command: "green", desc: "Fotoğrafa yeşil renk filtresi uygular.", route: "filter/green" },
  { command: "bw", desc: "Fotoğrafı siyah-beyaz (nostaljik) hale getirir.", route: "filter/greyscale" },
  { command: "invert", desc: "Fotoğrafın renklerini tersine çevirir (negatif).", route: "filter/invert" },
  { command: "2invert", desc: "Fotoğrafa ters ve gri tonlama efekti uygular.", route: "filter/invertgreyscale" },
  { command: "red", desc: "Fotoğrafa kırmızı renk filtresi uygular.", route: "filter/red" },
  { command: "golden", desc: "Fotoğrafa sıcak altın (sepia) tonları ekler.", route: "filter/sepia" },
  { command: "threshold", desc: "Fotoğrafa siyah-beyaz eşik filtresi uygular.", route: "filter/threshold" },
  { command: "rainbow", desc: "Fotoğrafa gökkuşağı renkleri ekler.", route: "misc/lgbt" },
  { command: "gay", desc: "Fotoğrafa gay bayrağı kaplaması ekler.", route: "overlay/gay" },
  { command: "horny", desc: "Eğlenceli ateşli kart tasarımı oluşturur.", route: "misc/horny" },
  { command: "simpcard", desc: "Kişiye özel simp kartı tasarımı oluşturur.", route: "misc/simpcard" },
  { command: "circle", desc: "Fotoğrafı dairesel bir profil resmine dönüştürür.", route: "misc/circle" },
  { command: "heart", desc: "Fotoğrafı kalp çerçevesi içine alır.", route: "misc/heart" },
  { command: "glass", desc: "Fotoğrafa şık bir cam kırığı kaplaması ekler.", route: "overlay/glass" },
  { command: "wasted", desc: "GTA tarzı öldün (wasted) efekti ekler.", route: "overlay/wasted" },
  { command: "passed", desc: "GTA tarzı görev tamamlandı efekti ekler.", route: "overlay/passed" },
  { command: "jail", desc: "Kişiyi hapishane parmaklıkları ardına koyar.", route: "overlay/jail" },
  { command: "comrade", desc: "Fotoğrafa yoldaş (comrade) kaplaması ekler.", route: "overlay/comrade" },
  { command: "triggered", desc: "Fotoğrafa sinirli (triggered) efekti ekler.", route: "overlay/triggered" },
];

function buildCategoryLines(prefix, items) {
  const lines = [`🔹 *${prefix}*`];
  items.forEach((item) => {
    lines.push(`• .${item.command} → ${item.desc}`);
  });
  return lines;
}

const filterEffects = EFFECTS.filter((item) => item.route.startsWith("filter/"));
const miscEffects = EFFECTS.filter((item) => item.route.startsWith("misc/"));
const overlayEffects = EFFECTS.filter((item) => item.route.startsWith("overlay/"));

const list =
  "```" +
  [
    "╔══════════════════════════════════════╗",
    "║   📸 FOTOĞRAF DÜZENLEME KOMUTLARI   ║",
    "╚══════════════════════════════════════╝",
    "Herhangi bir fotoğrafa yanıt vererek kullanabilirsiniz.",
    "",
    ...buildCategoryLines("Filtreler", filterEffects),
    "",
    ...buildCategoryLines("Misc Efektler", miscEffects),
    "",
    ...buildCategoryLines("Overlay Efektler", overlayEffects),
  ].join("\n") +
  "\n```";

function buildCandidateUrls(route, imageUrl) {
  const encoded = encodeURIComponent(imageUrl);
  const base = `https://api.some-random-api.com/canvas/${route}`;
  if (route.startsWith("overlay/")) {
    return [`${base}?avatar=${encoded}`, `${base}?image=${encoded}`];
  }
  return [`${base}?avatar=${encoded}`, `${base}?image=${encoded}`];
}

async function applyEffect(message, route) {
  if (!message.reply_message || !message.reply_message.image) {
    return await message.sendReply("❗️ *Bir fotoğrafa yanıt vererek yazınız.*");
  }

  const imagePath = await message.reply_message.download();
  const upload = await uploadToImgbb(imagePath);
  const link = upload?.url || upload?.display_url || (upload?.image && (upload.image.url || upload.image.display_url)) || (typeof upload === "string" ? upload : null);

  if (!link) {
    return await message.sendReply("❌ *Görsel yüklenemedi. Tekrar deneyin.*");
  }

  const urls = buildCandidateUrls(route, link);
  let buffer;
  let lastError;

  for (const url of urls) {
    try {
      buffer = await getBuffer(url);
      if (buffer?.length) break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!buffer) {
    console.error("Editör efekti başarısız:", route, lastError?.message || lastError);
    return await message.sendReply(
      "❌ *Efekt uygulanamadı. API şu an yanıt vermiyor olabilir.*"
    );
  }

  return await message.sendMessage(buffer, "image");
}

Module({
  pattern: "editör",
  fromMe: false,
  desc: "Tüm görsel düzenleme ve efekt komutlarını içeren menüyü görüntüler.",
  usage: ".editör",
  use: "düzenleme",
},
  async (message) => {
    await message.sendReply(list);
  }
);

function registerEffect(command, desc, route) {
  Module({
    pattern: `${command} ?(.*)`,
    fromMe: false,
    desc,
    dontAddCommandList: true,
    use: "düzenleme",
  },
    async (message) => {
      await applyEffect(message, route);
    }
  );
}

for (const effect of EFFECTS) {
  registerEffect(effect.command, effect.desc, effect.route);
}

Module({
  pattern: "wasted ?(.*)",
  fromMe: false,
  desc: "Fotoğrafa GTA tarzı öldün (wasted) efekti uygular.",
  usage: ".wasted [yanıtla]",
  use: "düzenleme",
},
  async (message, match) => {
    const mime = message.reply_message?.mimetype || message.mimetype || "";
    const isImg = mime.startsWith("image/");
    if (!isImg) return await message.sendReply("🖼️ _Bir görseli yanıtlayın:_ `.wasted`");
    try {
      const wait = await message.send("🎨 _İşliyorum..._");
      const path = await message.reply_message.download();
      const upload = await uploadToImgbb(path);
      const url = upload?.url || upload?.display_url || (upload?.image && (upload.image.url || upload.image.display_url)) || (typeof upload === "string" ? upload : null);
      if (!url || url.includes("hata")) throw new Error("Görsel yüklenemedi");

      const buf = await getBuffer(`https://api.some-random-api.com/canvas/overlay/wasted?avatar=${encodeURIComponent(url)}`);
      if (!buf || buf.length < 1000) throw new Error("Görsel APİ'den alınamadı.");
      await message.edit("💀 *Hakkı Rahmetine Kavuştu!*", message.jid, wait.key);
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Wasted efektini uygulayamadım:_ ${e.message}`);
      throw e;
    }
  }
);

Module({
  pattern: "wanted ?(.*)",
  fromMe: false,
  desc: "Fotoğrafa aranıyor (wanted) poster efekti uygular.",
  usage: ".wanted [yanıtla]",
  use: "düzenleme",
},
  async (message, match) => {
    const replyMime = message.reply_message?.mimetype || "";
    const isImg = replyMime.startsWith("image/");
    let imgUrl = (match[1] || "").trim();

    if (!isImg && !imgUrl.startsWith("http")) {
      return await message.sendReply("🖼️ _Bir görseli yanıtlayın veya URL girin:_ `.wanted`");
    }
    try {
      if (!imgUrl && isImg) {
        const wait = await message.send("🎨 _İşliyorum..._");
        const path = await message.reply_message.download();
        const upload = await uploadToImgbb(path);
        const url = upload?.url || upload?.display_url || (upload?.image && (upload.image.url || upload.image.display_url)) || (typeof upload === "string" ? upload : null);
        imgUrl = url;
        await message.edit("✅ _Görsel hazır, poster basılıyor..._", message.jid, wait.key);
      }
      if (!imgUrl || imgUrl.includes("hata")) throw new Error("Görsel URL alınamadı");

      const buf = await getBuffer(`https://api.popcat.xyz/wanted?image=${encodeURIComponent(imgUrl)}`);
      if (!buf || buf.length < 1000) throw new Error("Wanted posteri basılamadı.");
      await message.client.sendMessage(message.jid, { image: buf, caption: "🔫 *ARANIYOR!*" }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Wanted efektini uygulayamadım:_ ${e.message}`);
      throw e;
    }
  }
);

// Yardımcı: URL olan resimli mesaja ephoto efekti uygula
async function applyEphoto(message, endpoint, caption) {
  const replyMime = message.reply_message?.mimetype || "";
  const isImg = replyMime.startsWith("image/");
  if (!isImg) return await message.sendReply(`🖼️ _Bir görseli yanıtlayın:_ \`${endpoint}\``);
  try {
    const wait = await message.send("⌛ _İşliyorum, lütfen bekleyin..._");
    const path = await message.reply_message.download();
    const upload = await uploadToImgbb(path);
    const url = upload?.url || upload?.display_url || (upload?.image && (upload.image.url || upload.image.display_url)) || (typeof upload === "string" ? upload : null);
    if (!url || url.includes("hata")) throw new Error("Görsel yüklenemedi");

    await message.edit("✅ _Efekti uyguluyorum..._", message.jid, wait.key);

    // Ephoto endpoint'leri Nexray tarafında kapalı veya arızalı olduğu için hata fırlatıyoruz 
    // veya alternatif Popcat benzeri sistem kullanabiliriz. Şimdilik geçici iptal.
    throw new Error("Ephoto sistemi geçici olarak çevrimdışıdır.");

    // const result = await nx(`${endpoint}?url=${encodeURIComponent(url)}`, { buffer: true, timeout: 90000 });
    // await message.edit(caption, message.jid, wait.key);
    // await message.client.sendMessage(message.jid, { image: result }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`❌ _Tüh! Efekti uygulayamadım:_ ${e.message}`);
    throw e;
  }
}

Module({
  pattern: "anime ?(.*)",
  fromMe: false,
  desc: "Seçtiğiniz fotoğrafı profesyonel anime çizgifilm karakterine dönüştürür.",
  usage: ".anime [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/anime", "🎌 *Anime dönüşümü tamamlandı!*")
);

Module({
  pattern: "ghiblistil ?(.*)",
  fromMe: false,
  desc: "Fotoğrafı Studio Ghibli animasyonlarının büyüleyici sanat stiline uyarlar.",
  usage: ".ghiblistil [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/ghibli", "🌿 *Studio Ghibli dönüşümü tamamlandı!*")
);

Module({
  pattern: "chibi ?(.*)",
  fromMe: false,
  desc: "Fotoğrafı sevimli ve küçük chibi karakter stiline dönüştürür.",
  usage: ".chibi [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/chibi", "🧸 *Chibi dönüşümü tamamlandı!*")
);

Module({
  pattern: "efektsinema ?(.*)",
  fromMe: false,
  desc: "Fotoğrafa profesyonel bir film karesi havası katan sinematik efekt uygular.",
  usage: ".efektsinema [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/cinematic", "🎬 *Sinematik efekt uygulandı!*")
);

Module({
  pattern: "grafitisokak ?(.*)",
  fromMe: false,
  desc: "Fotoğrafı bir sokak duvarındaki etkileyici grafiti sanatına dönüştürür.",
  usage: ".grafitisokak [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/street", "🎨 *Grafiti dönüşümü tamamlandı!*")
);

Module({
  pattern: "pikselart ?(.*)",
  fromMe: false,
  desc: "Fotoğrafı nostaljik bir piksel sanat eseri NFT stiline dönüştürür.",
  usage: ".pikselart [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/nft", "👾 *Piksel sanat dönüşümü tamamlandı!*")
);

Module({
  pattern: "çizgiroman ?(.*)",
  fromMe: false,
  desc: "Fotoğrafı aksiyon dolu bir çizgi roman karesine dönüştürür.",
  usage: ".çizgiroman [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/comic", "💥 *Çizgi roman dönüşümü tamamlandı!*")
);

Module({
  pattern: "mafia ?(.*)",
  fromMe: false,
  desc: "Fotoğrafa şık ve gizemli bir mafia atmosferi kazandırır.",
  usage: ".mafia [yanıtla]",
  use: "düzenleme",
},
  async (message) => applyEphoto(message, "/ephoto/mafia", "🕴️ *Mafia dönüşümü tamamlandı!*")
);
})();

// ==========================================
// FILE: pdf.js
// ==========================================
(function() {
const { Module } = require("../main");
const fileSystem = require("node:fs/promises");
const fileType = require("file-type");
const path = require("path");
const fs = require("fs");
const { getTempSubdir, getTempPath } = require("../core/helpers");

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

const imageInputDirectory = getTempSubdir("pdf");
const finalPdfOutputPath = getTempPath("converted.pdf");

Module({
    pattern: "pdf ?(.*)",
    fromMe: false,
    desc: "Seçtiğiniz veya yanıtladığınız görselleri tek bir PDF belgesi haline getirir.",
    usage: ".pdf | .pdf getir | .pdf sil",
  },
  async (message, commandArguments) => {
    const subCommand = commandArguments[1]?.toLowerCase();

    if (subCommand === "yardım") {
      await message.sendReply(`_🗑️ 1. .pdf ile resimleri ekleyin_\n_2. .pdf getir ile PDF çıktısını alın_\n_3. Yanlışlıkla resim mi eklediniz? .pdf sil ile geri alın._\n_Çıktı alındıktan sonra tüm dosyalar otomatik silinir_`
      );
    } else if (subCommand === "sil") {
      const currentFiles = await fileSystem.readdir(imageInputDirectory);
      const filesToDelete = currentFiles.map((fileName) =>
        path.join(imageInputDirectory, fileName)
      );

      await Promise.all(
        filesToDelete.map((filePath) => fileSystem.unlink(filePath))
      );

      try {
        await fileSystem.unlink(finalPdfOutputPath);
      } catch (error) { }
      await message.sendReply(`_✅ Tüm dosyalar başarıyla temizlendi!_`);
    } else if (subCommand === "getir") {
      const allStoredFiles = await fileSystem.readdir(imageInputDirectory);
      const imageFilePaths = allStoredFiles
        .filter((fileName) => fileName.includes("topdf"))
        .map((fileName) => path.join(imageInputDirectory, fileName));

      if (!imageFilePaths.length) {
        return await message.sendReply("_💬 Dosya girişi yapılmadı!_");
      }

      try {
        const { PDFDocument } = require('pdf-lib');
        let sharp;
        try { sharp = require('sharp'); } catch (_) { sharp = null; }

        const pdfDoc = await PDFDocument.create();

        for (const imgPath of imageFilePaths) {
          try {
            let imgBytes = await fileSystem.readFile(imgPath);

            // Gerçek dosya tipini tespit et
            const detected = await getFileType(imgBytes);
            const mime = detected?.mime || '';

            let image;
            if (mime === 'image/png') {
              image = await pdfDoc.embedPng(imgBytes);
            } else if (mime === 'image/jpeg' || mime === 'image/jpg') {
              image = await pdfDoc.embedJpg(imgBytes);
            } else if (mime === 'image/webp' || mime === 'image/gif' || mime === 'image/bmp' || !mime.startsWith('image/')) {
              // Desteklenmeyen format — sharp ile JPEG'e çevir
              if (sharp) {
                imgBytes = await sharp(imgBytes).jpeg({ quality: 90 }).toBuffer();
                image = await pdfDoc.embedJpg(imgBytes);
              } else {
                // sharp yoksa JPEG olarak dene
                image = await pdfDoc.embedJpg(imgBytes);
              }
            } else {
              // Bilinmeyen format — JPEG olarak dene
              image = await pdfDoc.embedJpg(imgBytes);
            }

            if (image) {
              const { width, height } = image.scale(1);
              const page = pdfDoc.addPage([width, height]);
              page.drawImage(image, { x: 0, y: 0, width, height });
            }
          } catch (imgErr) {
            console.error(`Görsel PDF'e eklenemedi (${imgPath}):`, imgErr.message);
            // Bu görseli atla, devam et
          }
        }

        if (pdfDoc.getPageCount() === 0) {
          throw new Error('Hiçbir görsel PDF\'e eklenemedi. Lütfen geçerli görseller gönderin.');
        }

        const pdfBytes = await pdfDoc.save();
        await fileSystem.writeFile(finalPdfOutputPath, pdfBytes);

        await message.client.sendMessage(
          message.jid,
          {
            document: { url: finalPdfOutputPath },
            mimetype: "application/pdf",
            fileName: "converted.pdf",
          },
          { quoted: message.data }
        );

        const filesToCleanUp = await fileSystem.readdir(imageInputDirectory);
        const tempFilesForDeletion = filesToCleanUp.map((fileName) =>
          path.join(imageInputDirectory, fileName)
        );
        await Promise.all(
          tempFilesForDeletion.map((filePath) => fileSystem.unlink(filePath))
        );
        await fileSystem.unlink(finalPdfOutputPath);
      } catch (error) {
        await message.sendReply(`_PDF dönüşümü başarısız: ${error.message}_`);
      }
    } else if (message.reply_message && message.reply_message.album) {
      // handle album
      const albumData = await message.reply_message.download();
      const allImages = albumData.images || [];

      if (allImages.length === 0)
        return await message.sendReply("_🎬 Albümde resim yok! (videolar PDF'ye dönüştürülemez)_");

      await message.send(
        `_${allImages.length} albüm görseli PDF'e ekleniyor..._`
      );

      for (let i = 0; i < allImages.length; i++) {
        try {
          const file = allImages[i];
          const detectedFileType = await getFileType(
            await fileSystem.readFile(file)
          );

          if (detectedFileType && detectedFileType.mime.startsWith("image")) {
            const newImagePath = path.join(
              imageInputDirectory,
              `topdf_album_${i}.jpg`
            );
            await fileSystem.copyFile(file, newImagePath);
          }
        } catch (err) {
          console.error("Albüm görseli PDF'e eklenemedi:", err);
        }
      }

      await message.sendReply(
        `_*✅ ${allImages.length} albüm görseli kaydedildi*_\n_*Tüm görseller hazır. PDF oluşturmak için '.pdf getir' yazın!*_`
      );
    } else if (message.reply_message) {
      let repliedMessageBuffer = await message.reply_message.download("buffer");
      const detectedFileType = await getFileType(repliedMessageBuffer);

      if (detectedFileType && detectedFileType.mime.startsWith("image")) {
        // Dosya uzantısını gerçek tip'e göre belirle
        const mimeToExt = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png' };
        let fileExt = mimeToExt[detectedFileType.mime] || null;

        if (!fileExt) {
          // WebP, GIF, BMP, HEIC vs. — sharp ile JPEG'e dönüştür
          let sharp;
          try { sharp = require('sharp'); } catch (_) { sharp = null; }
          if (sharp) {
            try {
              repliedMessageBuffer = await sharp(repliedMessageBuffer).jpeg({ quality: 90 }).toBuffer();
              fileExt = 'jpg';
            } catch (convertErr) {
              console.error('Görsel JPEG\'e çevrilemedi:', convertErr.message);
              return await message.sendReply('_❌ Görsel formatı desteklenmiyor. Lütfen JPEG veya PNG gönderin._');
            }
          } else {
            // sharp yoksa ham buffer'a güven, JPEG dene
            fileExt = 'jpg';
          }
        }

        const existingImageFiles = (
          await fileSystem.readdir(imageInputDirectory)
        ).filter((fileName) => fileName.includes("topdf"));
        const nextImageIndex = existingImageFiles.length;
        const newImagePath = path.join(
          imageInputDirectory,
          `topdf_${nextImageIndex}.${fileExt}`
        );

        await fileSystem.writeFile(newImagePath, repliedMessageBuffer);
        return await message.sendReply(
          `*_Görsel başarıyla kaydedildi_*\n_*Toplam kaydedilen görsel: ${nextImageIndex + 1}*_\n*_Tüm görselleri kaydettikten sonra sonucu almak için '.pdf getir' yazın. Dönüştürmeden sonra görseller silinecektir!_*`
        );
      } else {
        return await message.sendReply("_💬 PDF dönüşümüne eklemek için bir resme yanıtlayın!_");
      }
    } else {
      return await message.sendReply('_💬 Bir resme yanıtlayın veya daha fazla bilgi için ".pdf yardım" yazın._'
      );
    }
  }
);
})();

// ==========================================
// FILE: removebg.js
// ==========================================
(function() {
const { Module } = require("../main");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const fsPromises = fs.promises;
const Path = require("path");
const config = require("../config");

const RBG_KEYS = ["VwXQes36L5fpTjmMiFpwsy3W", "mkxdVteyNZZhx7fb6y6yqQ6o"];

function getFileNameFromUrl(url, defaultName = "arkaplan") {
  try {
    const parsed = new URL(url);
    let filename = Path.basename(parsed.pathname);
    if (!Path.extname(filename)) filename += ".jpg";
    return filename;
  } catch {
    return `${defaultName}.jpg`;
  }
}

function getDateBasedName(prefix = "Arkaplan") {
  const date = new Date();
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const HH = String(date.getHours()).padStart(2, "0");
  const MM = String(date.getMinutes()).padStart(2, "0");
  const SS = String(date.getSeconds()).padStart(2, "0");
  return `${prefix}-${yyyy}${mm}${dd}_${HH}${MM}${SS}`;
}

Module({
    pattern: "apsil ?(.*)",
    fromMe: false,
    desc: "Fotoğrafın arka planını yapay zeka ile siler veya farklı bir renkle/resimle değiştirir.",
    usage: ".apsil | .apsil mavi | .apsil #ff0000 | .apsil <resim_url>",
    use: "yapay-zeka",
  },
  async (message, match) => {
    if (!message.reply_message?.image && !message.reply_message?.document) {
      return await message.send(
        "❗ _Bir fotoğrafa veya belgeye yanıtlayarak yazınız._\n💬 Örnek: `.apsil`\n`.apsil kırmızı`\n`.apsil #00ff00`\n`.apsil https://...`"
      );
    }

    const colorMap = {
      kırmızı: "ff0000",
      red: "ff0000",
      mavi: "0000ff",
      blue: "0000ff",
      yeşil: "00ff00",
      green: "00ff00",
      sarı: "ffff00",
      yellow: "ffff00",
      mor: "800080",
      purple: "800080",
      pembe: "ff69b4",
      pink: "ff69b4",
      turuncu: "ffa500",
      orange: "ffa500",
      siyah: "000000",
      black: "000000",
      beyaz: "ffffff",
      white: "ffffff",
      gri: "808080",
      gray: "808080",
      grey: "808080",
    };

    let userInput = "";
    if (typeof match === "string") userInput = match.trim().toLowerCase();
    else if (Array.isArray(match) && match[1]) userInput = match[1].trim().toLowerCase();

    let bgColor = null;
    let bgImageUrl = null;
    let processingMsg;
    let okMsg;

    if (!userInput) {
      processingMsg = "🧹 _Arka plan kaldırılıyor..._";
      okMsg = "✨ _Arka plan temizlendi!_";
    } else if (userInput.startsWith("#")) {
      bgColor = userInput.replace("#", "");
      processingMsg = `🎨 _Arka plan ${userInput} olarak ayarlanıyor..._`;
      okMsg = `✨ _Arka plan ${userInput} yapıldı!_`;
    } else if (colorMap[userInput]) {
      bgColor = colorMap[userInput];
      processingMsg = `🎨 _Arka plan *${userInput}* olarak ayarlanıyor..._`;
      okMsg = `✨ _Arka plan ${userInput} yapıldı!_`;
    } else if (userInput.startsWith("http")) {
      bgImageUrl = userInput;
      processingMsg = "🖼️ _Belirtilen fotoğraf arka plan olarak uygulanıyor..._";
      okMsg = "✨ _Arka plan olarak özel bir resim uygulandı!_";
    } else {
      return await message.send(
        "❗ _Sadece renk yazabilir, hex kodu gönderebilir ya da resim URL'i belirtebilirsiniz._"
      );
    }

    const processing = await message.send(processingMsg);

    let imagePath;
    let outputPath;

    try {
      imagePath = await message.reply_message.download();
      const imageBuffer = await fsPromises.readFile(imagePath);

      let response = null;
      let lastError = null;

      for (let i = 0; i < RBG_KEYS.length; i++) {
        try {
          const formData = new FormData();
          formData.append("image_file", imageBuffer, { filename: "image.jpg" });
          formData.append("type", "auto");
          formData.append("size", "auto");
          if (bgColor) formData.append("bg_color", bgColor);
          if (bgImageUrl) formData.append("bg_image_url", bgImageUrl);

          response = await axios({
            method: "post",
            url: "https://api.remove.bg/v1.0/removebg",
            data: formData,
            headers: { ...formData.getHeaders(), "X-Api-Key": RBG_KEYS[i] },
            responseType: "arraybuffer",
          });

          console.log(`✅ Remove.bg API başarılı - Anahtar #${i + 1} kullanıldı`);
          break;
        } catch (error) {
          lastError = error;
          console.log(`❌ Anahtar #${i + 1} başarısız:`, error.response?.status || error.message);

          if (error.response && [402, 403, 429].includes(error.response.status)) {
            continue;
          }
          break;
        }
      }

      if (!response) {
        let errorMessage = "❌ _İşlem başarısız oldu!_";

        if (lastError?.response?.status === 400) {
          errorMessage =
            "❌ _Geçersiz parametre veya fotoğraf! Lütfen düz renk, hex kodu veya geçerli bir görsel URL girin._";
        } else if (lastError?.response?.status === 402) {
          errorMessage = "❌ _API limiti aşıldı! Lütfen daha sonra tekrar deneyin._";
        } else if (lastError?.response?.status === 403) {
          errorMessage = "❌ _API anahtarı geçersiz! Lütfen API key ayarlarını kontrol edin._";
        } else if (lastError?.response?.status === 413) {
          errorMessage = "❌ _Dosya çok büyük! Maksimum 22MB olmalı._";
        } else if (lastError?.response?.status === 415) {
          errorMessage = "❌ _Desteklenmeyen medya türü! Uygun bir dosya formatı kullanın._";
        } else if (lastError?.response?.status === 429) {
          errorMessage = "❌ _İstek limiti aşıldı! Lütfen biraz bekleyin ve tekrar deneyin._";
        }

        await message.edit(errorMessage, message.jid, processing.key);
        return;
      }

      const mimeType = response.headers["content-type"] || "image/png";
      const extension = (mimeType.split("/")[1] || "png").split(";")[0];
      outputPath = `rbg_${Date.now()}.${extension}`;
      await fsPromises.writeFile(outputPath, response.data);

      let originalFileName = "";
      try {
        const docName = message.reply_message.data?.message?.documentMessage?.fileName;
        if (docName) {
          const base = Path.parse(docName).name;
          originalFileName = `${base}.${extension}`;
        }
      } catch (e) { /* dosya adı çıkarma hatası, varsayılan kullanılacak */ }

      if (!originalFileName && bgImageUrl) {
        originalFileName = getFileNameFromUrl(bgImageUrl, "arkaplan");
      }

      if (!originalFileName) {
        originalFileName = `${getDateBasedName("Arkaplan")}.${extension}`;
      }

      await message.edit(okMsg, message.jid, processing.key);
      await message.client.sendMessage(
        message.jid,
        {
          document: await fsPromises.readFile(outputPath),
          fileName: originalFileName,
          mimetype: mimeType,
        },
        { quoted: message.quoted }
      );
    } catch (error) {
      console.error("APSil komutu hatası:", error);
      await message.edit("❌ _Dosya gönderilirken bir hata oluştu!_", message.jid, processing.key);
    } finally {
      if (imagePath) await fsPromises.unlink(imagePath).catch(() => {});
      if (outputPath) await fsPromises.unlink(outputPath).catch(() => {});
    }
  }
);
})();

// ==========================================
// FILE: fancy.js
// ==========================================
(function() {
const { Module } = require('../main');
const { fancy } = require('./utils');

Module({
  pattern: 'fancy ?(.*)',
  fromMe: false,
  use: 'düzenleme',
  desc: "Girdiğiniz metni farklı ve şık yazı tiplerine dönüştürerek daha dikkat çekici görünmesini sağlar.",
  usage: ".fancy [sayı] [metin]"
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const replyText = message.reply_message?.text;

    // Eğer girdi yoksa ve yanıtlanan mesaj da yoksa liste gönder
    if (!input && !replyText) {
      return await message.sendReply(
        "_*💬 Bir metni yanıtlayıp sayısal kodu belirtin veya direkt yazın.* Örnek:_\n\n" +
        "- `.fancy 10 Merhaba`\n" +
        "- `.fancy Merhaba dünya`\n" +
        String.fromCharCode(8206).repeat(4001) +
        fancy.list('Örnek metin', fancy)
      );
    }

    // Sayısal kodu ayıkla
    const idMatch = input.match(/^(\d+)\s*/);
    const id = idMatch ? parseInt(idMatch[1]) : null;
    const text = idMatch ? input.replace(idMatch[0], "") : input;
    const finalContent = replyText || text;

    try {
      if (!id || id > 33 || id < 1) {
        // ID yoksa veya geçersizse tüm listeyi göster
        return await message.sendReply(fancy.list(finalContent || "Lades-Pro", fancy));
      }
      // Seçili stili uygula
      const style = fancy[id - 1];
      if (!style) throw new Error();
      return await message.sendReply(fancy.apply(style, finalContent));
    } catch (e) {
      return await message.sendReply('_❌ Belirtilen stil uygulanamadı veya bulunamadı!_');
    }
  });
})();

// ==========================================
// FILE: take.js
// ==========================================
(function() {
const {
  addExif,
  webp2mp4,
  addID3,
  getBuffer,
  uploadToImgbb,
  uploadToCatbox,
} = require("./utils");
const { Module } = require("../main");
let config = require("../config");
const isFromMe = true;
let fs = require("fs");
Module({
  pattern: "take ?(.*)",
  fromMe: false,
  desc: "Yanıtladığınız çıkartma veya ses dosyasının paket adını ve yazar bilgilerini günceller.",
  usage: ".take [paket];[yazar]",
  use: "medya",
},
  async (m, match) => {
    if (!m.reply_message)
      return await m.sendMessage("_🎵 Bir sesi veya çıkartmayı yanıtlayın_");
    var audiomsg = m.reply_message.audio;
    var stickermsg = m.reply_message.sticker;
    var q = await m.reply_message.download();
    if (stickermsg) {
      if (match[1] !== "") {
        var exif = {
          author: match[1].includes(";") ? match[1].split(";")[1] : "",
          packname: match[1].includes(";") ? match[1].split(";")[0] : match[1],
          categories: config.STICKER_DATA.split(";")[2] || "😂",
          android: "",
          ios: "",
        };
      } else {
        var exif = {
          author: config.STICKER_DATA.split(";")[1] || "",
          packname: config.STICKER_DATA.split(";")[0] || "",
          categories: config.STICKER_DATA.split(";")[2] || "😂",
          android: "",
          ios: "",
        };
      }
      return await m.client.sendMessage(
        m.jid,
        { sticker: await addExif(q, exif) },
        { quoted: m.quoted }
      );
    }
    if (!stickermsg && audiomsg) {
      let inf =
        match[1] !== ""
          ? match[1]
          : config.AUDIO_DATA === "default"
            ? "Lades Ses Başlığı;Lades Sanatçı;https://i.ibb.co/s98DyMMq/NL-1.png"
            : config.AUDIO_DATA;
      if (config.AUDIO_DATA == "default") {
        await m.sendReply(`_🎵 Varsayılan ses verisi kullanılıyor, değiştirmek için .setvar AUDIO_DATA=baslık;sanatcı;kapak_url kullanın_`
        );
      }
      const botInfoParts = config.BOT_INFO.split(";");
      const botImgPart =
        botInfoParts.find((p) => (p || "").trim().startsWith("http")) ||
        botInfoParts[3] ||
        botInfoParts[2] ||
        "";
      const botImgUrl = ["default", "varsayılan"].includes(botImgPart?.trim())
        ? "https://i.ibb.co/s98DyMMq/NL-1.png"
        : botImgPart;
      let spl = inf.split(";"),
        image = spl[2]
          ? await getBuffer(spl[2])
          : await getBuffer(botImgUrl),
        res = await addID3(
          q,
          spl[0],
          spl[1] ? spl[1] : config.AUDIO_DATA.split(";")[1],
          "Lades Engine",
          image
        );
      await m.client.sendMessage(
        m.jid,
        {
          audio: res,
          mimetype: "audio/mp4",
        },
        {
          quoted: m.quoted,
          ptt: false,
        }
      );
    }
    if (!audiomsg && !stickermsg)
      return await m.client.sendMessage(
        m.jid,
        {
          text: "_🎵 Bir sesi veya çıkartmayı yanıtlayın_",
        },
        {
          quoted: m.data,
        }
      );
  }
);
Module({
  pattern: "mp4 ?(.*)",
  fromMe: false,
  desc: "Hareketli çıkartmaları MP4 video formatına dönüştürür.",
  usage: ".mp4 [yanıtla]",
  use: "medya",
},
  async (m, t) => {
    if (m.reply_message.sticker) {
      const q = await m.reply_message.download("buffer");
      const { getTempPath } = require("../core/helpers");
      const outPath = getTempPath("converted.mp4");
      try {
        await webp2mp4(q, outPath);
      } catch (e) {
        console.log("Take hatası (.mp4):", e);
        return await m.sendReply(`*❌ Hareketli çıkartma videoya dönüştürülemedi. Hata:* ${e.message}`);
      }
      await m.client.sendMessage(
        m.jid,
        {
          document: await fs.promises.readFile(outPath),
          mimetype: "video/mp4",
        },
        { quoted: m.quoted }
      );
    } else return await m.sendReply("_💬 Hareketli bir çıkartmayı yanıtlayın!_");
  }
);

Module({
  pattern: "url ?(.*)",
  fromMe: false,
  desc: "Medya dosyalarını bulut sunuculara yükleyerek paylaşılabilir bir bağlantı oluşturur.",
  usage: ".url (bir görsele, videoya veya sese yanıt vererek)",
  use: "medya",
},
  async (m, match) => {
    let result;
    if (m.reply_message?.image || m.reply_message?.sticker) {
      let q = await m.reply_message.download();
      result = await uploadToImgbb(q);
      return await m.sendReply(result.url);
    } else if (
      m.reply_message?.video ||
      m.reply_message?.document ||
      m.reply_message?.audio
    ) {
      let q = await m.reply_message.download();
      result = await uploadToCatbox(q);
      return await m.sendReply(result.url);
    }
  }
);
})();

