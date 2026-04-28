"use strict";

/**
 * Merged Module: media.js
 * Components: media.js, editor.js, pdf.js, removebg.js, fancy.js, take.js
 */

// ==========================================
// FILE: media.js
// ==========================================
(function () {
  const { Module } = require("../main");
  const fs = require("fs");
  const ffmpeg = require("fluent-ffmpeg");
  const ffmpegStatic = require("ffmpeg-static");
  ffmpeg.setFfmpegPath(ffmpegStatic);
  const https = require("https");
  const { getTempPath, getTempSubdir, ffmpegLimit } = require("../core/yardimcilar");

  const config = require("../config"),
    MODE = config.MODE;
  const { avMix, circle, rotate, trim, uploadToImgbb, nx, nxTry, uploadToCatbox } = require("./utils");
  const nexray = require('./utils/nexray_api');
  const { censorBadWords } = require("./utils/sansur");
  const handler = config.HANDLER_PREFIX;

  // ── API key varlığını modül başında bir kez kontrol et (her mesajda tekrar hesaplama)
  const _hasGroqKey = !!config.GROQ_API_KEY && config.GROQ_API_KEY !== '';
  const _hasOpenAIKey = !!config.OPENAI_API_KEY && config.OPENAI_API_KEY !== '';
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
      // Sadece mikrofonla kaydedilmiş (ptt) sesleri kabul et
      const isVoice = voiceMsg.ptt || voiceMsg.data?.message?.audioMessage?.ptt === true;

      if (!isVoice) {
        return;
      }
      // Hot-reload denemesi: Dashboard üzerinden kaydedilip tam yeniden başlatılmamış olabilir
      if ((!config.GROQ_API_KEY || config.GROQ_API_KEY === '') &&
        (!config.OPENAI_API_KEY || config.OPENAI_API_KEY === '')) {
        const envPath = require("path").join(__dirname, "../config.env");
        if (require("fs").existsSync(envPath)) {
          require("dotenv").config({ path: envPath, override: true });
          config.GROQ_API_KEY = process.env.GROQ_API_KEY || "";
          config.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
        }
      }

      if ((!config.GROQ_API_KEY || config.GROQ_API_KEY === '') &&
        (!config.OPENAI_API_KEY || config.OPENAI_API_KEY === '')) {
        return await message.sendReply("⚠️ *API Anahtarı bulunamadı! (Groq veya OpenAI)*\n\nℹ️ _Panelden kaydettikten sonra botu tamamen yeniden başlatmadığınız için eski haline takılmış olabilir. Lütfen Sistemi Yeniden Başlatın._");
      }
      processingMsg = await message.send("🎙️ _Ses analiz ediliyor..._");
      const audioBuffer = await voiceMsg.download("buffer");
      const mime = voiceMsg.mimetype || voiceMsg.data?.message?.audioMessage?.mimetype || "audio/ogg";
      let ext = "ogg";
      if (mime.includes("mp4")) ext = "m4a";
      else if (mime.includes("mpeg")) ext = "mp3";
      else if (mime.includes("webm")) ext = "webm";
      else if (mime.includes("wav")) ext = "wav";

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
        c.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="audio.${ext}"\r\n`));
        c.push(Buffer.from(`Content-Type: ${mime.split(';')[0]}\r\n\r\n`));
        c.push(audioBuffer);
        c.push(Buffer.from(`\r\n`));
        c.push(Buffer.from(`--${boundary}--\r\n`));
        return Buffer.concat(c);
      };
      const useGroq = config.GROQ_API_KEY && config.GROQ_API_KEY !== '';
      const makeRequest = (useOpenAI = false) => {
        const body = buildBody(useOpenAI ? "whisper-1" : "whisper-large-v3");
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

      const tryRequestWithRetry = async (useOpenAI) => {
        try {
          return await makeRequest(useOpenAI);
        } catch (error) {
          console.log(`⚠️ ${useOpenAI ? 'OpenAI' : 'Groq'} API isteği başarısız oldu, tekrar deneniyor...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return await makeRequest(useOpenAI);
        }
      };

      let response;
      try {
        if (useGroq) {
          response = await tryRequestWithRetry(false);
        } else {
          response = await tryRequestWithRetry(true);
        }
      } catch (groqError) {
        if (!groqError.useOpenAI && config.OPENAI_API_KEY && config.OPENAI_API_KEY !== '') {
          console.log("⚠️ Groq başarısız, OpenAI API'ye geçiliyor...");
          try {
            response = await tryRequestWithRetry(true);
            console.log("✅ OpenAI API başarılı!");
          } catch (openaiError) {
            console.error("❌ Her iki API de başarısız:", openaiError);
            const errorText = resolveApiErrorMessage(openaiError.data, openaiError.error);
            return await message.edit(
              `❌ *API hatası:* \`${openaiError.statusCode || 'Bağlantı hatası'}\` \n\n*Detay:* ${errorText}`,
              message.jid, processingMsg.key
            );
          }
        } else {
          console.error("❌ Groq API hatası ve OpenAI anahtarı yok:", groqError);
          const errorText = resolveApiErrorMessage(groqError.data, groqError.error);
          return await message.edit(
            `❌ *API hatası:* \`${groqError.statusCode || 'Bağlantı hatası'}\` \n\n*Detay:* ${errorText}`,
            message.jid, processingMsg.key
          );
        }
      }
      try {
        const result = JSON.parse(response.data);
        let transcription = result.text;
        if (!transcription || transcription.trim() === '') {
          return await message.edit(
            "❌ *Maalesef, sesi analiz edemedim veya sessizlik tespit ettim.*",
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
        return await message.edit("❌ *API yanıtı işlenirken hata oluştu!*\nℹ️ _`dinle` komutu ile tekrar deneyin._", message.jid, processingMsg.key);
      }
    } catch (err) {
      console.error("dinle modülünde hata:", err);
      if (processingMsg) {
        return await message.edit("❌ *Ses çevrilirken bir hata oluştu!*", message.jid, processingMsg.key);
      } else {
        return await message.send("❌ *Ses çevrilirken bir hata oluştu!*");
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
      if (!replied || !replied.ptt) {
        return await message.sendReply("❌ *Lütfen sadece mikrofonla kaydedilmiş bir sesli mesaja (ses kaydına) yanıt verin! (Şarkı veya müzik desteklenmez)*");
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
        if (message.fromMe) return;
        const audioMsg = message.data?.message?.audioMessage;
        let hasApi = (config.GROQ_API_KEY && config.GROQ_API_KEY !== '') || (config.OPENAI_API_KEY && config.OPENAI_API_KEY !== '');

        // Hot-reload
        if (!hasApi) {
          const envPath = require("path").join(__dirname, "../config.env");
          if (require("fs").existsSync(envPath)) {
            require("dotenv").config({ path: envPath, override: true });
            config.GROQ_API_KEY = process.env.GROQ_API_KEY || "";
            config.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
            hasApi = (config.GROQ_API_KEY && config.GROQ_API_KEY !== '') || (config.OPENAI_API_KEY && config.OPENAI_API_KEY !== '');
          }
        }

        if (!hasApi) return;

        // Yalnızca mikrofon ile kaydedilmiş sesli mesajlarda (PTT) otomatik çeviri yap.
        // Paylaşılan şarkı / müzik / ses dosyası (ptt: false) otomatik analize dahil değil.
        const isPtt = message.ptt || audioMsg?.ptt === true;
        if (!isPtt) return;

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
        return await message.sendReply("❌ *Lütfen bir ses veya video dosyasına yanıtlayın!*");
      if (!match[1] || !match[1].includes(","))
        return await message.sendReply(
          "❌ *Geçersiz format!* \n*Kullanım:* \`.kes 10:30\`"
        );
      const parts = match[1].split(",");
      const start = parts[0]?.trim();
      const end = parts[1]?.trim();
      const savedFile = await message.reply_message.download();
      await message.sendMessage("⏳ _Kesme işlemi yapılıyor..._");
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
        return await message.sendReply("⚠️ *Kullanım:* _Renklendirmek için siyah-beyaz bir görsele yanıt verin._");

      try {
        const processingMsg = await message.sendReply("🎨 _Görsel renklendiriliyor..._");
        const imgPath = await message.reply_message.download();
        const uploadRes = await uploadToImgbb(imgPath);
        const imageUrl = uploadRes?.url || uploadRes?.image?.url;
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);

        if (!imageUrl) {
          await message.edit("❌ *Görsel yüklenemedi! Lütfen tekrar deneyin.*", message.jid, processingMsg.key);
          return;
        }

        const resultBuffer = await nexray.colorize(imageUrl);
        if (resultBuffer && resultBuffer.length) {
          await message.sendReply(resultBuffer, "image");
          await message.edit("✅ *Renklendirme tamamlandı!*", message.jid, processingMsg.key);
        } else {
          await message.edit("❌ *Renklendirme başarısız! Lütfen tekrar deneyin.*", message.jid, processingMsg.key);
        }
      } catch (error) {
        console.error("Renklendir hatası:", error);
        await message.sendReply("❌ *Bir hata oluştu! Lütfen tekrar deneyin.*");
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
        return await message.send("⚠️ *Lütfen bir ses dosyasına yanıtlayın!*");

      try {
        const processingMsg = await message.sendReply("⏳ _Video oluşturuluyor..._");
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
        await message.edit("✅ *Siyah video başarıyla oluşturuldu!*", message.jid, processingMsg.key);
        await fs.promises.unlink(audioFile).catch(() => { });
        await fs.promises.unlink(outputPath).catch(() => { });
      } catch (error) {
        console.error("Siyah video oluşturma hatası:", error);
        await message.send("❌ *Siyah video oluşturulamadı! Lütfen tekrar deneyin.*");
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
        return await message.send("⚠️ *Lütfen bir ses ve videoya yanıt verin!*");
      if (message.reply_message.audio) {
        const savedFile = await message.reply_message.download();
        await fs.promises.writeFile(
          getTempPath("avmix/audio.mp3"),
          await fs.promises.readFile(savedFile)
        );
        return await message.sendReply("✅ *Birleştirilecek ses veritabanına eklendi. Video bekleniyor...*");
      }
      if (message.reply_message.video) {
        const savedFile = await message.reply_message.download();
        await fs.promises.writeFile(
          getTempPath("avmix/video.mp4"),
          await fs.promises.readFile(savedFile)
        );
        return await message.sendReply("✅ *Birleştirilecek video veritabanına eklendi. Ses bekleniyor...*");
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
        return await message.sendReply("✅ *2. Video eklendi!* \n\nℹ️ _Çıktı için tekrar `.vbirleştir` yazın._");
      }
      if (message.reply_message.video && files.length == 0) {
        const savedFile = await message.reply_message.download();
        await fs.promises.writeFile(
          getTempPath("vmix/video2.mp4"),
          await fs.promises.readFile(savedFile)
        );
        return await message.sendReply("✅ *1. Video eklendi!*");
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
        await message.sendReply("⏳ _Videolar birleştiriliyor..._");
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
        return await message.sendReply("⚠️ *Lütfen bir videoya yanıtlayın!*");
      const savedFile = await message.reply_message.download();
      await message.sendReply("⏳ _Hareket enterpolasyonu işleniyor..._");
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
      await fs.promises.unlink(outPath).catch(() => { });
      await fs.promises.unlink(savedFile).catch(() => { });
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
        return await message.sendReply("⚠️ *Lütfen bir görsel veya çıkartmaya yanıtlayın!*");
      }
      try {
        const buffer = await message.reply_message.download();
        const result = await circle(buffer);
        await message.send(result, "image", { caption: "✅ *Oval kırpma tamamlandı!*" });
      } catch (err) {
        await message.sendReply(`❌ *Hata oluştu!* \n\n*Detay:* ${err.message}`);
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
        return await message.sendReply("⚠️ *Lütfen bir videoya yanıtlayın!*");
      const savedFile = await message.reply_message.download();
      await message.sendReply("⏳ _İşleniyor..._");
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
      await fs.promises.unlink(outPath).catch(() => { });
      await fs.promises.unlink(savedFile).catch(() => { });
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
        return await message.sendReply("⚠️ *Lütfen bir videoya yanıtlayın!*");
      if (match[1] <= 10)
        return await message.send("❌ *FPS değeri çok düşük!* \n\nℹ️ _Minimum: 10_");
      if (match[1] >= 500)
        return await message.send("❌ *FPS değeri çok yüksek!* \n\nℹ️ _Maksimum: 500_");
      const savedFile = await message.reply_message.download();
      await message.sendReply("⏳ _FPS işleniyor..._");
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
      await fs.promises.unlink(outPath).catch(() => { });
      await fs.promises.unlink(savedFile).catch(() => { });
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
        return await message.sendReply("⚠️ *Lütfen bir ses dosyasına yanıtlayın!*");

      const { seconds } = message.quoted.message[Object.keys(message.quoted.message)[0]];
      if (seconds > 60)
        return await message.sendReply(
          "❌ *Ses çok uzun!* \n\nℹ️ _Müzik tanıma için sesi 60 saniyenin altına düşürün._"
        );

      await message.send("🙂‍↔️ _Şarkıyı dinliyorum..._");
      const audio = await message.reply_message.download("buffer");
      const data = await findMusic(audio);
      if (!data)
        return await message.sendReply(
          "❌ *Eşleşen bir sonuç bulunamadı!* \nℹ️ _Daha iyi analiz için sesi 15 saniyeden uzun gönderin._"
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
💡 *İpucu:* _İndirmek için_ \`.şarkı ${data.title}\` _yazabilirsiniz._`,
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
        return await message.sendReply("⚠️ *Kullanım:* \`.döndür sol|sağ|ters\` _(bir videoya yanıtlayarak)_"
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
      if (!url) return await message.sendReply("⚠️ _Web sitesi URL'si girin!_\n*Kullanım:* `.ss fenomensen.net`");
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
        await message.sendReply(`❌ *Ekran görüntüsü alınamadı!* \n\n*Hata:* ${e.message}`);
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
      if (!isImg && !imgUrl.startsWith("http")) return await message.sendReply("⚠️ *Kullanım:* `.metin` _(bir görsele yanıtlayarak)_");
      try {
        if (!imgUrl && isImg) {
          const wait = await message.send("⏳ _İnceliyorum..._");
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
        await message.sendReply(`❌ *Metni okuyamadım!* \n\n*Hata:* ${e.message}`);
      }
    }
  );

  Module({
    pattern: "hd ?(.*)",
    fromMe: false,
    desc: "Düşük çözünürlüklü görselleri netleştirir ve HD kaliteye yükseltir.",
    usage: ".hd [yanıtla]",
    use: "araçlar",
  },
    async (message, match) => {
      const replyMime = message.reply_message?.mimetype || "";
      const isImg = replyMime.startsWith("image/");
      let imgUrl = (match[1] || "").trim();
      if (!isImg && !imgUrl.startsWith("http")) return await message.sendReply("⚠️ *Kullanım:* `.hd` _(bir görsele yanıtlayarak)_");
      try {
        if (!imgUrl && isImg) {
          const wait = await message.send("⬆️ _İşliyorum..._");
          const path = await message.reply_message.download();
          const { url } = await uploadToCatbox(path);
          imgUrl = url;
          await message.edit("⏳ _Görseli yükseltiyorum..._", message.jid, wait.key);
        }
        if (!imgUrl || imgUrl.includes("hata")) throw new Error("Görsel URL alınamadı");

        const buf = await nxTry([
          `/tools/upscale?url=${encodeURIComponent(imgUrl)}&resolusi=2`,
          `/tools/upscale?url=${encodeURIComponent(imgUrl)}&resolution=2`,
          `/tools/upscale?image=${encodeURIComponent(imgUrl)}&resolusi=2`,
        ], { buffer: true, timeout: 90000 });
        await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
      } catch (e) {
        await message.sendReply(`❌ *Tüh! Yükseltme başarısız:* ${e.message}`);
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
      if (!input || !input.includes("|")) return await message.sendReply("⚠️ *Kullanım:* \`.meme ÜSTMETİN|ALTMETİN\` _(bir görsele yanıtlayarak)_");
      if (!isImg) return await message.sendReply("⚠️ *Bir görsele yanıtlayın!* \n\n*Kullanım:* \`.meme ÜSTMETİN|ALTMETİN\`");
      const [top, bottom] = input.split("|").map(s => s.trim());
      try {
        const wait = await message.send("⏳ _Meme oluşturuyorum..._");
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
        await message.sendReply(`❌ *Tüh! Meme oluşturamadım:* ${e.message}`);
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
      if (!code) return await message.sendReply("⚠️ *Kullanım:* \`.kodgörsel [kod]\` _(veya bir mesaja yanıtlayarak)_");
      try {
        const wait = await message.send("⏳ _Görselleştiriliyor..._");
        const buf = await nx(`/maker/codesnap?code=${encodeURIComponent(code)}`, { buffer: true });
        await message.edit("✅ *Kod görseli hazır!*", message.jid, wait.key);
        await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
      } catch (e) {
        await message.sendReply(`❌ *Tüh! Kod görselini oluşturamadım:* ${e.message}`);
      }
    }
  );
})();

// ==========================================
// FILE: editor.js
// ==========================================
(function () {
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
      return await message.sendReply("⚠️ *Lütfen bir fotoğrafa yanıtlayın!*");
    }

    const imagePath = await message.reply_message.download();
    const upload = await uploadToImgbb(imagePath);
    const link = upload?.url || upload?.display_url || (upload?.image && (upload.image.url || upload.image.display_url)) || (typeof upload === "string" ? upload : null);

    if (!link) {
      return await message.sendReply("❌ *Görsel yüklenemedi! Tekrar deneyin.*");
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
        "❌ *Efekt uygulanamadı!* \n\nℹ️ _API şu an erişilemiyor olabilir._"
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
      if (!isImg) return await message.sendReply("⚠️ *Kullanım:* `.wasted` _(bir görsele yanıtlayarak)_");
      try {
        const wait = await message.send("⏳ _İşliyorum..._");
        const path = await message.reply_message.download();
        const upload = await uploadToImgbb(path);
        const url = upload?.url || upload?.display_url || (upload?.image && (upload.image.url || upload.image.display_url)) || (typeof upload === "string" ? upload : null);
        if (!url || url.includes("hata")) throw new Error("Görsel yüklenemedi");

        const buf = await getBuffer(`https://api.some-random-api.com/canvas/overlay/wasted?avatar=${encodeURIComponent(url)}`);
        if (!buf || buf.length < 1000) throw new Error("Görsel APİ'den alınamadı.");
        await message.edit("💀 *Hakkı Rahmetine Kavuştu!*", message.jid, wait.key);
        await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
      } catch (e) {
        await message.sendReply(`❌ *Efekt uygulanamadı!* \n\n*Hata:* ${e.message}`);
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
        return await message.sendReply("⚠️ *Kullanım:* `.wanted` _(bir görsele yanıtlayarak)_");
      }
      try {
        if (!imgUrl && isImg) {
          const wait = await message.send("⏳ _İşliyorum..._");
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
        await message.sendReply(`❌ *Efekt uygulanamadı!* \n\n*Hata:* ${e.message}`);
      }
    }
  );

  // Yardımcı: URL olan resimli mesaja ephoto efekti uygula
  async function applyEphoto(message, endpoint, caption) {
    const replyMime = message.reply_message?.mimetype || "";
    const isImg = replyMime.startsWith("image/");
    if (!isImg) return await message.sendReply("⚠️ *Lütfen bir görsele yanıtlayın!*");
    let wait;
    try {
      wait = await message.send("⏳ _İşliyorum..._");
      const imgPath = await message.reply_message.download();
      const catResult = await uploadToCatbox(imgPath);
      const url = catResult?.url;
      if (!url || url.includes("hata") || url.includes("_Dosya")) throw new Error("Görsel yüklenemedi");

      await message.edit("🎨 _Efekti uyguluyorum..._", message.jid, wait.key);

      // 1. Nexray ephoto endpoint
      try {
        const result = await nx(`${endpoint}?url=${encodeURIComponent(url)}`, { buffer: true, timeout: 90000 });
        if (result && result.length > 500) {
          await message.client.sendMessage(message.jid, { image: result }, { quoted: message.data });
          await message.edit(caption, message.jid, wait.key);
          return;
        }
      } catch (_nexrayErr) {
        // Nexray başarısız, yedek API dene
      }

      // 2. Siputzx cartoon efekti (genel fallback)
      try {
        const axios = require("axios");
        const siputRes = await axios.get("https://api.siputzx.my.id/api/tools/cartoonize", {
          params: { url },
          responseType: "arraybuffer",
          timeout: 60000,
        });
        if (siputRes.status === 200 && siputRes.data?.byteLength > 500) {
          const buf = Buffer.from(siputRes.data);
          await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
          await message.edit(caption, message.jid, wait.key);
          return;
        }
      } catch (_siputErr) {
        // İkinci yedek de başarısız
      }

      // Her iki API de yanıt vermedi
      await message.edit("❌ *Efekt şu anda uygulanamıyor. API sunucuları geçici olarak yanıt vermiyor.*", message.jid, wait.key);
    } catch (e) {
      if (wait) {
        await message.edit(`❌ *Efekt uygulanamadı!* \n\n*Hata:* ${e.message}`, message.jid, wait.key).catch(() => { });
      } else {
        await message.sendReply(`❌ *Efekt uygulanamadı!* \n\n*Hata:* ${e.message}`);
      }
    }
  }

  Module({
    pattern: "anime ?(.*)",
    fromMe: false,
    desc: "Seçtiğiniz fotoğrafı profesyonel anime çizgifilm karakterine dönüştürür.",
    usage: ".anime [yanıtla]",
    use: "düzenleme",
  },
    async (message) => applyEphoto(message, "/ephoto/anime", "✅ *Anime dönüşümü tamamlandı!*")
  );

  Module({
    pattern: "ghiblistil ?(.*)",
    fromMe: false,
    desc: "Fotoğrafı Studio Ghibli animasyonlarının büyüleyici sanat stiline uyarlar.",
    usage: ".ghiblistil [yanıtla]",
    use: "düzenleme",
  },
    async (message) => applyEphoto(message, "/ephoto/ghibli", "✅ *Studio Ghibli dönüşümü tamamlandı!*")
  );

  Module({
    pattern: "chibi ?(.*)",
    fromMe: false,
    desc: "Fotoğrafı sevimli ve küçük chibi karakter stiline dönüştürür.",
    usage: ".chibi [yanıtla]",
    use: "düzenleme",
  },
    async (message) => applyEphoto(message, "/ephoto/chibi", "✅ *Chibi dönüşümü tamamlandı!*")
  );

  Module({
    pattern: "efektsinema ?(.*)",
    fromMe: false,
    desc: "Fotoğrafa profesyonel bir film karesi havası katan sinematik efekt uygular.",
    usage: ".efektsinema [yanıtla]",
    use: "düzenleme",
  },
    async (message) => applyEphoto(message, "/ephoto/cinematic", "✅ *Sinematik efekt uygulandı!*")
  );

  Module({
    pattern: "grafitisokak ?(.*)",
    fromMe: false,
    desc: "Fotoğrafı bir sokak duvarındaki etkileyici grafiti sanatına dönüştürür.",
    usage: ".grafitisokak [yanıtla]",
    use: "düzenleme",
  },
    async (message) => applyEphoto(message, "/ephoto/street", "✅ *Grafiti dönüşümü tamamlandı!*")
  );

  Module({
    pattern: "pikselart ?(.*)",
    fromMe: false,
    desc: "Fotoğrafı nostaljik bir piksel sanat eseri NFT stiline dönüştürür.",
    usage: ".pikselart [yanıtla]",
    use: "düzenleme",
  },
    async (message) => applyEphoto(message, "/ephoto/nft", "✅ *Piksel sanat dönüşümü tamamlandı!*")
  );

  Module({
    pattern: "çizgiroman ?(.*)",
    fromMe: false,
    desc: "Fotoğrafı aksiyon dolu bir çizgi roman karesine dönüştürür.",
    usage: ".çizgiroman [yanıtla]",
    use: "düzenleme",
  },
    async (message) => applyEphoto(message, "/ephoto/comic", "✅ *Çizgi roman dönüşümü tamamlandı!*")
  );

  Module({
    pattern: "mafia ?(.*)",
    fromMe: false,
    desc: "Fotoğrafa şık ve gizemli bir mafia atmosferi kazandırır.",
    usage: ".mafia [yanıtla]",
    use: "düzenleme",
  },
    async (message) => applyEphoto(message, "/ephoto/mafia", "✅ *Mafia dönüşümü tamamlandı!*")
  );
})();

// ==========================================
// FILE: pdf.js
// ==========================================
(function () {
  const { Module } = require("../main");
  const fileSystem = require("node:fs/promises");
  const fileType = require("file-type");
  const path = require("path");
  const fs = require("fs");
  const { getTempSubdir, getTempPath } = require("../core/yardimcilar");

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
        await message.sendReply(`✅ *Tüm dosyalar başarıyla temizlendi!*`);
      } else if (subCommand === "getir") {
        const allStoredFiles = await fileSystem.readdir(imageInputDirectory);
        const imageFilePaths = allStoredFiles
          .filter((fileName) => fileName.includes("topdf"))
          .map((fileName) => path.join(imageInputDirectory, fileName));

        if (!imageFilePaths.length) {
          return await message.sendReply("❌ *Henüz dosya eklemediniz!*");
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
          await message.sendReply(`❌ *PDF dönüşümü başarısız!* \n\n*Hata:* ${error.message}`);
        }
      } else if (message.reply_message && message.reply_message.album) {
        // handle album
        const albumData = await message.reply_message.download();
        const allImages = albumData.images || [];

        if (allImages.length === 0)
          return await message.sendReply("❌ _Albümde resim yok! (videolar PDF'ye dönüştürülemez)_");

        await message.send(
          `⏳ _${allImages.length} görsel PDF'e ekleniyor..._`
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
          `✅ *${allImages.length} görsel başarıyla kaydedildi!* \n\nℹ️ _PDF oluşturmak için_ \`.pdf getir\` _yazın._`
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
            `✅ *_Görsel başarıyla kaydedildi_*\n_*Toplam kaydedilen görsel: ${nextImageIndex + 1}*_\nℹ️ *_Tüm görselleri kaydettikten sonra sonucu almak için '.pdf getir' yazın. 🗑️ Dönüştürmeden sonra görseller silinecektir!_*`
          );
        } else {
          return await message.sendReply("⚠️ *PDF dönüşümüne eklemek için bir görsele yanıtlayın!*");
        }
      } else {
        return await message.sendReply('⚠️ *Lütfen bir görsele yanıtlayın!* \n\nℹ️ _Yardım için:_ \`.pdf yardım\`'
        );
      }
    }
  );
})();

// ==========================================
// FILE: removebg.js
// ==========================================
(function () {
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
          "⚠️ *Bir fotoğrafa veya belgeye yanıtlayarak yazınız.*\n💬 *Örnek:* `.apsil`\n`.apsil kırmızı`\n`.apsil #00ff00`\n`.apsil https://...`"
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
        processingMsg = `⏳ _Arka plan ${userInput} olarak ayarlanıyor..._`;
        okMsg = `✅ *Arka plan ${userInput} yapıldı!*`;
      } else if (colorMap[userInput]) {
        bgColor = colorMap[userInput];
        processingMsg = `⏳ _Arka plan *${userInput}* olarak ayarlanıyor..._`;
        okMsg = `✅ *Arka plan ${userInput} yapıldı!*`;
      } else if (userInput.startsWith("http")) {
        bgImageUrl = userInput;
        processingMsg = "⏳ _Girilen fotoğraf arka plan olarak uygulanıyor..._";
        okMsg = "✅ *Arka plan olarak özel bir resim uygulandı!*";
      } else {
        return await message.send(
          "❌ _Sadece renk yazabilir, hex kodu gönderebilir ya da resim bağlantısı girebilirsiniz._"
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
          let errorMessage = "❌ *İşlem başarısız oldu!*";

          if (lastError?.response?.status === 400) {
            errorMessage =
              "❌ _Geçersiz parametre veya fotoğraf! Lütfen düz renk, hex kodu veya geçerli bir görsel bağlantısı girin._";
          } else if (lastError?.response?.status === 402) {
            errorMessage = "❌ *API limiti aşıldı! Lütfen daha sonra tekrar deneyin.*";
          } else if (lastError?.response?.status === 403) {
            errorMessage = "❌ *API anahtarı geçersiz! Lütfen API key ayarlarını kontrol edin.*";
          } else if (lastError?.response?.status === 413) {
            errorMessage = "❌ *Dosya çok büyük! Maksimum 22MB olmalı.*";
          } else if (lastError?.response?.status === 415) {
            errorMessage = "❌ *Desteklenmeyen medya türü! Uygun bir dosya formatı kullanın.*";
          } else if (lastError?.response?.status === 429) {
            errorMessage = "❌ *İstek limiti aşıldı! Lütfen tekrar deneyin.*";
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
        await message.edit("❌ *Dosya gönderilirken bir hata oluştu!*", message.jid, processing.key);
      } finally {
        if (imagePath) await fsPromises.unlink(imagePath).catch(() => { });
        if (outputPath) await fsPromises.unlink(outputPath).catch(() => { });
      }
    }
  );
})();

// ==========================================
// FILE: fancy.js
// ==========================================
(function () {
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
          "_*💬 Bir metni yanıtlayıp sayısal kodu belirtin veya direkt yazın.*\nℹ️ _Sayı belirtmezseniz tüm liste gösterilir._\n💬 *Örnek:*\n\n" +
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
        if (!id || id > 34 || id < 1) {
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
(function () {
  const {
    addExif,
    webp2mp4,
    addID3,
    getBuffer,
    nx,
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
    usage: ".take [paket];[yazar]\n📌 *Çıkartma için:* `.take PaketAdı;YazarAdı` — yanıtladığınız çıkartmanın paket ve yazar bilgisini günceller.\n📌 *Ses için:* `.take BaşlıkAdı;SanatçıAdı;kapak_url` — yanıtladığınız ses dosyasına başlık, sanatçı ve kapak ekler.\n📌 *Bilgi girilmezse* config'deki varsayılan STICKER_DATA / AUDIO_DATA kullanılır.",
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
    pattern: "gif ?(.*)",
    fromMe: false,
    desc: "Hareketli çıkartmaları GIF formatına dönüştürür.",
    usage: ".gif [yanıtla]",
    use: "medya",
  },
    async (m, t) => {
      if (!m.reply_message?.sticker) return await m.sendReply("_💬 Hareketli bir çıkartmayı yanıtlayın!_");
      const wait = await m.sendReply("⏳ _Dönüştürülüyor..._");
      try {
        const stickerPath = await m.reply_message.download();
        const catResult = await uploadToCatbox(stickerPath);
        if (!catResult?.url || catResult.url.includes("hata") || catResult.url.includes("_Dosya")) {
          throw new Error("Çıkartma yüklenemedi");
        }
        const gifBuf = await nx(`/tools/webp2mp4?url=${encodeURIComponent(catResult.url)}`, { buffer: true, timeout: 60000 });
        if (!gifBuf || gifBuf.length < 500) throw new Error("Dönüştürme başarısız oldu");
        await m.client.sendMessage(
          m.jid,
          { video: gifBuf, gifPlayback: true, mimetype: "video/mp4" },
          { quoted: m.quoted }
        );
        await m.edit("✅ *GIF oluşturuldu!*", m.jid, wait.key);
      } catch (e) {
        console.log("GIF dönüştürme hatası:", e);
        await m.edit(`❌ *GIF oluşturulamadı. Hata:* ${e.message}`, m.jid, wait.key);
      }
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
      const hasMedia = m.reply_message?.image || m.reply_message?.sticker ||
        m.reply_message?.video || m.reply_message?.document || m.reply_message?.audio;
      if (!hasMedia) return await m.sendReply("_📎 Bir görsel, video, ses veya belgeyi yanıtlayın_");
      const wait = await m.sendReply("⏳ _Yükleniyor..._");
      try {
        let url;
        const q = await m.reply_message.download();
        if (m.reply_message?.image || m.reply_message?.sticker) {
          const res = await uploadToCatbox(q);
          url = res?.url;
        } else {
          const res = await uploadToCatbox(q);
          url = res?.url;
        }
        if (!url || url.includes("hata") || url.includes("_Dosya")) throw new Error("Dosya yüklenemedi");
        await m.edit(`🔗 *Bağlantı:*\n${url}`, m.jid, wait.key);
      } catch (e) {
        await m.edit(`❌ *Yükleme başarısız!* \n\n*Hata:* ${e.message}`, m.jid, wait.key);
      }
    }
  );
})();

