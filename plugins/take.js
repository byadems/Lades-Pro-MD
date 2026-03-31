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
let fs = require("fs");
Module(
  {
    pattern: "take ?(.*)",
    use: "edit",
    desc: "Çıkartma/ses paketi ve yazar adını değiştirir.",
    usage: ".take paket;yazar\n(bir çıkartmaya veya sese yanıt vererek)",
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
          android: "https://github.com/byadems/Lades-MD/",
          ios: "https://github.com/byadems/Lades-MD/",
        };
      } else {
        var exif = {
          author: config.STICKER_DATA.split(";")[1] || "",
          packname: config.STICKER_DATA.split(";")[0] || "",
          categories: config.STICKER_DATA.split(";")[2] || "😂",
          android: "https://github.com/byadems/Lades-MD/",
          ios: "https://github.com/byadems/Lades-MD/",
        };
      }
      return await m.client.sendMessage(
        m.jid,
        { sticker: fs.readFileSync(await addExif(q, exif)) },
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
Module(
  {
    pattern: "mp4 ?(.*)",
    use: "edit",
    desc: "Hareketli çıkartmayı videoya dönüştürür",
    usage: ".mp4 (bir hareketli çıkartmaya yanıt vererek)",
  },
  async (m, t) => {
    if (m.reply_message.sticker) {
      var q = await m.reply_message.download();
      try {
        var result = await webp2mp4(q, __dirname + "/temp/output.mp4");
      } catch (e) {
        console.log("Take hatası:", e);
        return await m.sendReply("*❌ Başarısız*");
      }
      await m.client.sendMessage(
        m.jid,
        {
          video: {
            url: __dirname + "/temp/output.mp4",
          },
        },
        { quoted: m.quoted }
      );
    } else return await m.sendReply("_💬 Hareketli bir çıkartmayı yanıtlayın!_");
  }
);

Module(
  {
    pattern: "url ?(.*)",
    desc: "Resmi imgbb'ye yükler ve resim URL gönderir",
    usage: ".url (bir görsele, videoya veya sese yanıt vererek)",
    use: "edit",
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
