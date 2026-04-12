const { Module } = require("../main");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegStatic);
const https = require("https");
const { getTempPath, getTempSubdir } = require("../core/helpers");

const config = require("../config"),
  MODE = config.MODE;
const { getString } = require("./utils/lang");
const { avMix, circle, rotate, trim, uploadToImgbb, nx, nxTry, uploadToCatbox } = require("./utils");
const nexray = require("./utils/nexray");
const { censorBadWords } = require("./utils/censor");
const handler = config.HANDLER_PREFIX;

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
const Lang = getString("media");

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
      if (!audioMsg) {
        return;
      }
      if ((!config.GROQ_API_KEY || config.GROQ_API_KEY === '') &&
        (!config.OPENAI_API_KEY || config.OPENAI_API_KEY === '')) {
        return;
      }
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
      return await message.sendReply(Lang.TRIM_NEED_REPLY);
    if (!match[1] || !match[1].includes(","))
      return await message.sendReply(
        message.reply_message.audio ? Lang.TRIM_NEED : Lang.TRIM_VIDEO_NEED
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
      const processingMsg = await message.sendReply("_🎬 Ses siyah ekrana sahip videoya dönüştürülüyor..._"
      );
      const audioFile = await message.reply_message.download();
      const outputPath = getTempPath(`black_${Date.now()}.mp4`);

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(audioFile)
          .input("color=c=black:s=320x240:r=30")
          .inputFormat("lavfi")
          .outputOptions([
            "-shortest",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "51",
            "-c:a",
            "copy",
            "-pix_fmt",
            "yuv420p",
          ])
          .format("mp4")
          .save(outputPath)
          .on("end", resolve)
          .on("error", reject);
      });

      const videoBuffer = await fs.promises.readFile(outputPath);
      await message.send(videoBuffer, "video");
      await message.edit(
        "_✅ Siyah video başarıyla oluşturuldu!_",
        message.jid,
        processingMsg.key
      );
      await fs.promises.unlink(audioFile).catch(() => { });
      await fs.promises.unlink(outputPath).catch(() => { });
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
      return await message.send(Lang.AVMIX_NEED_FILES);
    if (message.reply_message.audio) {
      const savedFile = await message.reply_message.download();
      await fs.promises.writeFile(
        getTempPath("avmix/audio.mp3"),
        await fs.promises.readFile(savedFile)
      );
      return await message.sendReply(Lang.AVMIX_AUDIO_ADDED);
    }
    if (message.reply_message.video) {
      const savedFile = await message.reply_message.download();
      await fs.promises.writeFile(
        getTempPath("avmix/video.mp4"),
        await fs.promises.readFile(savedFile)
      );
      return await message.sendReply(Lang.AVMIX_VIDEO_ADDED);
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
    ffmpeg(savedFile)
      .videoFilters("minterpolate=fps=120")
      .videoFilters("setpts=4*PTS")
      .noAudio()
      .format("mp4")
      .save(getTempPath("slowmo.mp4"))
      .on("end", async () => {
        const buf = await fs.promises.readFile(getTempPath("slowmo.mp4"));
        await message.send(buf, "video");
        await fs.promises.unlink(getTempPath("slowmo.mp4")).catch(() => { });
        await fs.promises.unlink(savedFile).catch(() => { });
      });
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
    ffmpeg(savedFile)
      .fps(13)
      .videoBitrate(500)
      .save(getTempPath("agif.mp4"))
      .on("end", async () => {
        const buf = await fs.promises.readFile(getTempPath("agif.mp4"));
        await message.client.sendMessage(message.jid, {
          video: buf,
          gifPlayback: true,
        });
        await fs.promises.unlink(getTempPath("agif.mp4")).catch(() => { });
        await fs.promises.unlink(savedFile).catch(() => { });
      });
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
    ffmpeg(savedFile)
      .videoFilters(`minterpolate=fps=${match[1]}:mi_mode=mci:me_mode=bidir`)
      .format("mp4")
      .save(getTempPath("interp.mp4"))
      .on("end", async () => {
        const buf = await fs.promises.readFile(getTempPath("interp.mp4"));
        await message.send(buf, "video");
        await fs.promises.unlink(getTempPath("interp.mp4")).catch(() => { });
        await fs.promises.unlink(savedFile).catch(() => { });
      });
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

