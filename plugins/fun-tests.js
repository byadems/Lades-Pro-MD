const { Module } = require("../main");
const { mentionjid, nx, trToEn, uploadToCatbox } = require("./utils");
const { getString } = require("./utils/lang");
const config = require("../config");

const Lang = getString("group");

const getTargetUser = (message) => message.mention?.[0] || message.reply_message?.jid;
const randomPercent = () => Math.floor(Math.random() * 100) + 1;

async function runSingleRateCommand(message, { introText, resultText }) {
  if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);

  const user = getTargetUser(message);
  if (!user) return await message.sendReply(Lang.NEED_USER);

  await message.client.sendMessage(message.jid, {
    text: `${mentionjid(user)} ${introText}`,
    mentions: [user],
  });

  return await message.send(resultText(randomPercent()));
}

Module(
  {
    pattern: "testgay ?(.*)",
    fromMe: false,
    desc: "Etiketlediğiniz üyenin gaylik yüzdesini ölçer.",
    use: "game",
  },
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *Gay* olma ihtimalini hesaplıyorum... 🧐",
      resultText: (percent) => `🏳️‍🌈 Senin *Gaylik* yüzden: *%${percent}!*`,
    });
  }
);

Module(
  {
    pattern: "testlez ?(.*)",
    fromMe: false,
    desc: "Etiketlediğiniz üyenin lezlik yüzdesini ölçer.",
    use: "game",
  },
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *Lez* olma ihtimalini hesaplıyorum... 🧐",
      resultText: (percent) => `👩🏻‍❤️‍👩🏼 Senin *Lezlik* yüzden: *%${percent}!*`,
    });
  }
);

Module(
  {
    pattern: "testprenses ?(.*)",
    fromMe: false,
    desc: "Etiketlediğiniz üyenin prenseslik seviyesini ölçer.",
    use: "game",
  },
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *Prenses* olma ihtimalini hesaplıyorum... 🧐",
      resultText: (percent) => `🤭 Senin *Prenseslik* yüzden: *%${percent}!* 👸🏻`,
    });
  }
);

Module(
  {
    pattern: "testregl ?(.*)",
    fromMe: false,
    desc: "Etiketlediğiniz üyenin Regl olma ihtimalini ölçer.",
    use: "game",
  },
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *Regl* olma ihtimalini hesaplıyorum... 🧐",
      resultText: (percent) => `🩸 Senin *Regl* yüzden: *%${percent}!* 😆`,
    });
  }
);

Module(
  {
    pattern: "testinanç ?(.*)",
    fromMe: false,
    desc: "Etiketlediğiniz üyenin inanç seviyesini ölçer.",
    use: "game",
  },
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *İnanç* seviyesini hesaplıyorum... 🧐",
      resultText: (percent) => `🛐 Senin *İnanç* yüzden: *%${percent}!*`,
    });
  }
);

Module(
  {
    pattern: "aşkölç ?(.*)",
    fromMe: false,
    desc: "İki kişi arasındaki aşk yüzdesini ölçer.",
    use: "game",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);

    const percentage = Math.floor(Math.random() * 101);
    const mentioned = message.mention || [];

    if (mentioned.length > 0) {
      if (mentioned.length < 2) {
        return await message.sendReply("❗️ 2 isim yazmalısınız!");
      }

      const [u1, u2] = mentioned;
      return await message.client.sendMessage(message.jid, {
        text:
          `🔥 ${mentionjid(u1)} ve ${mentionjid(u2)} ` +
          `arasındaki aşk yüzdesi: *%${percentage}!* ❤️‍🔥`,
        mentions: [u1, u2],
      });
    }

    const parts = (match[1] || "").trim().split(/ +/).slice(0, 2);
    if (parts.length !== 2) {
      return await message.sendReply("❗️ 2 isim yazmalısınız!");
    }

    const [name1, name2] = parts;
    return await message.send(
      `🔥 *${name1}* ve *${name2}* arasındaki aşk yüzdesi: *%${percentage}!* ❤️‍🔥`
    );
  }
);

Module(
  {
    pattern: "beyin",
    fromMe: false,
    desc: "Rastgele beyin jimnastiği sorusu gönderir",
    usage: ".beyin",
    use: "game",
  },
  async (message) => {
    try {
      const r = await nx("/games/asahotak");
      const question = r.question || r.soal || r.pertanyaan || JSON.stringify(r);
      const answer = r.answer || r.jawaban || r.kunci || "?";
      await message.sendReply(
        `🧠 *Beyin Jimnastiği*\n\n` +
        `❓ ${question}\n\n` +
        `💡 _10 saniye sonra cevap..._\n\n_(Not: Sorular/Cevaplar yabancı dilde olabilir)_`
      );
      setTimeout(async () => {
        await message.sendReply(`✅ *Cevap:* ${answer}`);
      }, 10000);
    } catch (e) {
      await message.sendReply(`❌ _Soruyu alamadım:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "bilmece",
    fromMe: false,
    desc: "Rastgele bilmece sorusu gönderir",
    usage: ".bilmece",
    use: "game",
  },
  async (message) => {
    try {
      const r = await nx("/games/tebaktebakan");
      const question = r.question || r.soal || r.pertanyaan || JSON.stringify(r);
      const answer = r.answer || r.jawaban || r.kunci || "?";
      await message.sendReply(
        `🎯 *Bilmece*\n\n` +
        `❓ ${question}\n\n` +
        `⏳ _15 saniye sonra cevap..._\n\n_(Not: Sorular/Cevaplar yabancı dilde olabilir)_`
      );
      setTimeout(async () => {
        await message.sendReply(`✅ *Cevap:* ${answer}`);
      }, 15000);
    } catch (e) {
      await message.sendReply(`❌ _Bilmece alınamadı:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "kimyasoru",
    fromMe: false,
    desc: "Rastgele kimya sorusu gönderir",
    usage: ".kimyasoru",
    use: "game",
  },
  async (message) => {
    try {
      const r = await nx("/games/tebakkimia");
      const element = r.element || r.question || r.soal || JSON.stringify(r);
      const symbol = r.symbol || r.jawaban || r.answer || "?";
      const number = r.atomicNumber || r.atomic_number || r.nomor || "";

      await message.sendReply(
        `⚗️ *Kimya Sorusu*\n\n` +
        `Bu elementin sembolü nedir?\n` +
        `🧪 *${element}*${number ? ` (Atom No: ${number})` : ""}\n\n` +
        `⏳ _10 saniye sonra cevap..._`
      );
      setTimeout(async () => {
        await message.sendReply(`✅ *Cevap:* ${symbol}`);
      }, 10000);
    } catch (e) {
      await message.sendReply(`❌ _Soru alınamadı:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "alay ?(.*)",
    fromMe: false,
    desc: "Metni alay/slang formatına dönüştürür",
    usage: ".alay Merhaba nasılsın",
    use: "fun",
  },
  async (message, match) => {
    let text = (match[1] || "").trim();
    if (!text && message.reply_message?.text) text = message.reply_message.text.trim();
    if (!text) return await message.sendReply("😜 _Metin girin:_ `.alay Merhaba nasılsın`");
    try {
      const result = await nx(`/fun/alay?text=${encodeURIComponent(text)}`);
      const alay = typeof result === "string" ? result : result?.result || result?.text || JSON.stringify(result);
      await message.sendReply(`😜 ${alay}`);
    } catch (e) {
      await message.sendReply(`❌ _Dönüştürme başarısız:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "dragonyazı ?(.*)",
    fromMe: false,
    desc: "Dragon Ball stili metin logosu oluşturur",
    usage: ".dragonyazı LADES",
    use: "edit",
  },
  async (message, match) => {
    const text = trToEn((match[1] || "").trim());
    if (!text) return await message.sendReply("🐉 _Metin girin:_ `.dragonyazı LADES`");
    try {
      const buf = await nx(`/textpro/dragonball?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "neonyazı ?(.*)",
    fromMe: false,
    desc: "Neon ışıklı metin logosu oluşturur",
    usage: ".neonyazı LADES",
    use: "edit",
  },
  async (message, match) => {
    const text = trToEn((match[1] || "").trim());
    if (!text) return await message.sendReply("💡 _Metin girin:_ `.neonyazı LADES`");
    try {
      const buf = await nx(`/textpro/typography?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "grafitiyazı ?(.*)",
    fromMe: false,
    desc: "Grafiti stili metin logosu oluşturur",
    usage: ".grafitiyazı LADES",
    use: "edit",
  },
  async (message, match) => {
    const text = trToEn((match[1] || "").trim());
    if (!text) return await message.sendReply("🖊️ _Metin girin:_ `.grafitiyazı LADES`");
    try {
      const buf = await nx(`/textpro/write-graffiti?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "devilyazı ?(.*)",
    fromMe: false,
    desc: "Şeytan kanadı stili metin logosu oluşturur",
    usage: ".devilyazı LADES",
    use: "edit",
  },
  async (message, match) => {
    const text = trToEn((match[1] || "").trim());
    if (!text) return await message.sendReply("😈 _Metin girin:_ `.devilyazı LADES`");
    try {
      const buf = await nx(`/textpro/devil-wings?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

Module(
  {
    pattern: "müzikkart ?(.*)",
    fromMe: false,
    desc: "Müzik kartı görseli oluşturur",
    usage: ".müzikkart Şarkı Adı|Sanatçı|<resim_url>",
    use: "edit",
  },
  async (message, match) => {
    const parts = (match[1] || "").split("|").map(s => s.trim());
    if (parts.length < 2) return await message.sendReply("🎵 _Kullanım:_ `.müzikkart Şarkı Adı|Sanatçı` veya `Şarkı|Sanatçı|<resim_url>`");
    const [title, artist, img] = parts;
    let imageUrl = img || "https://i.imgur.com/Y3KqMfn.jpg";

    // Reply to image check
    const isImg = (message.reply_message?.mimetype || "").startsWith("image/");
    try {
      if (isImg && !img) {
        const path = await message.reply_message.download();
        const { url } = await uploadToCatbox(path);
        if (url && !url.includes("hata")) imageUrl = url;
      }
      const buf = await nx(
        `/canvas/musiccard?judul=${encodeURIComponent(title)}&nama=${encodeURIComponent(artist)}&image_url=${encodeURIComponent(imageUrl)}`,
        { buffer: true }
      );
      await message.client.sendMessage(message.jid, {
        image: buf,
        caption: `🎵 *${title}* — _${artist}_`,
      }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Müzik kartı oluşturulamadı:_ ${e.message}`);
    }
  }
);
