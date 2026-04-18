"use strict";

/**
 * Merged Module: games.js
 * Components: siputzx-games.js, fun-tests.js
 */

// ==========================================
// FILE: siputzx-games.js
// ==========================================
(function() {
/**
 * plugins/siputzx-games.js
 * Siputzx API - Oyun ve Canvas Komutları
 * Tüm çıktılar %100 Türkçe
 */
const { Module } = require("../main");
const axios = require("axios");

const SIPUTZX_BASE = "https://api.siputzx.my.id";
const TIMEOUT = 25000;

async function siputGet(path, params = {}) {
  const url = `${SIPUTZX_BASE}${path}`;
  const res = await axios.get(url, { params, timeout: TIMEOUT, validateStatus: () => true });
  if (res.data && res.data.status) return res.data;
  throw new Error(res.data?.error || "API yanıt vermedi");
}

async function siputGetBuffer(path, params = {}) {
  const url = `${SIPUTZX_BASE}${path}`;
  const res = await axios.get(url, { params, timeout: TIMEOUT, responseType: "arraybuffer", validateStatus: () => true });
  if (res.status === 200 && res.data) return Buffer.from(res.data);
  throw new Error("Veri alınamadı");
}

// ══════════════════════════════════════════════════════
// Bilgi Yarışması (Family 100 tarzı)
// ══════════════════════════════════════════════════════
Module({
  pattern: "bilgiyarismasi",
  fromMe: false,
  desc: "Bilgi yarışması sorusu sorar. (Family 100 tarzı)",
  usage: ".bilgiyarismasi",
  use: "oyun",
}, async (message) => {
  try {
    const data = await siputGet("/api/games/family100");
    const r = data.data || data.result;
    if (!r || !r.soal) return await message.sendReply("_Soru alınamadı._");

    const answers = Array.isArray(r.jawaban) ? r.jawaban : [];
    const hiddenAnswers = answers.map((a, i) => `${i + 1}. ${"*".repeat(a.length)}`).join("\n");

    await message.sendReply(
      `*Bilgi Yarışması*\n\n` +
      `*Soru:* ${r.soal}\n\n` +
      `*Cevaplar (${answers.length} adet):*\n${hiddenAnswers}\n\n` +
      `_60 saniye içinde "cevap [yanıtınız]" yazın!_`
    );

    // Store answers for later validation
    if (!global._gameAnswers) global._gameAnswers = new Map();
    global._gameAnswers.set(message.jid, {
      answers: answers.map(a => a.toLowerCase()),
      question: r.soal,
      found: [],
      expires: Date.now() + 60000
    });
  } catch (e) {
    await message.sendReply(`_Oyun başlatılamadı:_ ${e.message}`);
  }
});

// Cevap kontrolü
Module({
  pattern: "cevap ?(.*)",
  fromMe: false,
  desc: "Bilgi yarışması cevabı verir.",
  usage: "cevap [yanıt]",
  use: "oyun",
}, async (message, match) => {
  if (!global._gameAnswers) return;
  const game = global._gameAnswers.get(message.jid);
  if (!game) return await message.sendReply("_Aktif bir oyun yok. `.bilgiyarismasi` ile başlatın._");
  if (Date.now() > game.expires) {
    global._gameAnswers.delete(message.jid);
    return await message.sendReply(`_Süre doldu!_\n\n*Cevaplar:*\n${game.answers.join(", ")}`);
  }

  const answer = (match[1] || "").trim().toLowerCase();
  if (!answer) return;

  const idx = game.answers.findIndex(a => a.includes(answer) || answer.includes(a));
  if (idx !== -1 && !game.found.includes(idx)) {
    game.found.push(idx);
    if (game.found.length === game.answers.length) {
      global._gameAnswers.delete(message.jid);
      await message.sendReply(`*Tebrikler! Tüm cevapları buldunuz!*\n\n*Cevaplar:*\n${game.answers.join(", ")}`);
    } else {
      await message.sendReply(`*Doğru!* "${game.answers[idx]}" bulundu! (${game.found.length}/${game.answers.length})`);
    }
  } else if (game.found.includes(idx)) {
    await message.sendReply("_Bu cevap zaten bulundu._");
  } else {
    await message.sendReply("_Yanlış cevap. Tekrar deneyin!_");
  }
});

// ══════════════════════════════════════════════════════
// Matematik Oyunu
// ══════════════════════════════════════════════════════
Module({
  pattern: "matoyun",
  fromMe: false,
  desc: "Matematik sorusu sorar.",
  usage: ".matoyun",
  use: "oyun",
}, async (message) => {
  try {
    const data = await siputGet("/api/games/maths");
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Soru alınamadı._");

    const question = r.soal || r.question || r.problem;
    const answer = r.jawaban || r.answer;

    if (!global._mathAnswers) global._mathAnswers = new Map();
    global._mathAnswers.set(message.jid, {
      answer: String(answer).toLowerCase(),
      expires: Date.now() + 30000
    });

    await message.sendReply(
      `*Matematik Sorusu*\n\n` +
      `*${question}*\n\n` +
      `_30 saniye içinde "sonuc [yanıt]" yazın!_`
    );
  } catch (e) {
    await message.sendReply(`_Oyun başlatılamadı:_ ${e.message}`);
  }
});

Module({
  pattern: "sonuc ?(.*)",
  fromMe: false,
  desc: "Matematik sorusu cevabı.",
  usage: "sonuc [yanıt]",
  use: "oyun",
}, async (message, match) => {
  if (!global._mathAnswers) return;
  const game = global._mathAnswers.get(message.jid);
  if (!game) return;
  if (Date.now() > game.expires) {
    global._mathAnswers.delete(message.jid);
    return await message.sendReply(`_Süre doldu! Doğru cevap:_ *${game.answer}*`);
  }

  const answer = (match[1] || "").trim().toLowerCase();
  if (answer === game.answer) {
    global._mathAnswers.delete(message.jid);
    await message.sendReply("*Doğru cevap! Tebrikler!*");
  } else {
    await message.sendReply("_Yanlış cevap. Tekrar deneyin!_");
  }
});

// ══════════════════════════════════════════════════════
// Görsel Tahmin Oyunu
// ══════════════════════════════════════════════════════
Module({
  pattern: "gorseltahmin",
  fromMe: false,
  desc: "Görsel tahmin oyunu. Görseldeki nesneyi tahmin edin.",
  usage: ".gorseltahmin",
  use: "oyun",
}, async (message) => {
  try {
    const data = await siputGet("/api/games/tebakgambar");
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Soru alınamadı._");

    const imageUrl = r.img || r.image || r.url;
    const answer = r.jawaban || r.answer;

    if (!global._guessAnswers) global._guessAnswers = new Map();
    global._guessAnswers.set(message.jid, {
      answer: String(answer).toLowerCase(),
      expires: Date.now() + 60000
    });

    if (imageUrl) {
      await message.client.sendMessage(message.jid, {
        image: { url: imageUrl },
        caption: `*Görsel Tahmin Oyunu*\n\n_Bu görseldeki nesneyi tahmin edin!_\n_60 saniye içinde "tahmin [yanıt]" yazın._`
      }, { quoted: message.data });
    } else {
      const desc = r.deskripsi || r.description || r.soal;
      await message.sendReply(`*Görsel Tahmin*\n\n_İpucu:_ ${desc}\n_"tahmin [yanıt]" yazın._`);
    }
  } catch (e) {
    await message.sendReply(`_Oyun başlatılamadı:_ ${e.message}`);
  }
});

Module({
  pattern: "tahmin ?(.*)",
  fromMe: false,
  desc: "Görsel tahmin cevabı.",
  usage: "tahmin [yanıt]",
  use: "oyun",
}, async (message, match) => {
  if (!global._guessAnswers) return;
  const game = global._guessAnswers.get(message.jid);
  if (!game) return;
  if (Date.now() > game.expires) {
    global._guessAnswers.delete(message.jid);
    return await message.sendReply(`_Süre doldu! Doğru cevap:_ *${game.answer}*`);
  }

  const answer = (match[1] || "").trim().toLowerCase();
  if (answer === game.answer || game.answer.includes(answer)) {
    global._guessAnswers.delete(message.jid);
    await message.sendReply("*Doğru cevap! Tebrikler!*");
  } else {
    await message.sendReply("_Yanlış cevap. Tekrar deneyin!_");
  }
});

// ══════════════════════════════════════════════════════
// Logo Tahmin
// ══════════════════════════════════════════════════════
Module({
  pattern: "logotahmin",
  fromMe: false,
  desc: "Logo tahmin oyunu.",
  usage: ".logotahmin",
  use: "oyun",
}, async (message) => {
  try {
    const data = await siputGet("/api/games/tebaklogo");
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Soru alınamadı._");

    const imageUrl = r.img || r.image || r.url;
    const answer = r.jawaban || r.answer;

    if (!global._guessAnswers) global._guessAnswers = new Map();
    global._guessAnswers.set(message.jid, {
      answer: String(answer).toLowerCase(),
      expires: Date.now() + 60000
    });

    if (imageUrl) {
      await message.client.sendMessage(message.jid, {
        image: { url: imageUrl },
        caption: `*Logo Tahmin Oyunu*\n\n_Bu logoyu tahmin edin!_\n_60 saniye içinde "tahmin [yanıt]" yazın._`
      }, { quoted: message.data });
    }
  } catch (e) {
    await message.sendReply(`_Oyun başlatılamadı:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Bayrak Tahmin
// ══════════════════════════════════════════════════════
Module({
  pattern: "bayraktahmin",
  fromMe: false,
  desc: "Bayrak tahmin oyunu.",
  usage: ".bayraktahmin",
  use: "oyun",
}, async (message) => {
  try {
    const data = await siputGet("/api/games/tebakbendera");
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Soru alınamadı._");

    const imageUrl = r.img || r.image || r.url;
    const answer = r.jawaban || r.answer;

    if (!global._guessAnswers) global._guessAnswers = new Map();
    global._guessAnswers.set(message.jid, {
      answer: String(answer).toLowerCase(),
      expires: Date.now() + 60000
    });

    if (imageUrl) {
      await message.client.sendMessage(message.jid, {
        image: { url: imageUrl },
        caption: `*Bayrak Tahmin Oyunu*\n\n_Bu bayrak hangi ülkeye ait?_\n_60 saniye içinde "tahmin [yanıt]" yazın._`
      }, { quoted: message.data });
    }
  } catch (e) {
    await message.sendReply(`_Oyun başlatılamadı:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Bulmaca / Teka-teki
// ══════════════════════════════════════════════════════
Module({
  pattern: "bulmaca",
  fromMe: false,
  desc: "Bulmaca sorar.",
  usage: ".bulmaca",
  use: "oyun",
}, async (message) => {
  try {
    const data = await siputGet("/api/games/tekateki");
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Bulmaca alınamadı._");

    const question = r.soal || r.question;
    const answer = r.jawaban || r.answer;

    if (!global._puzzleAnswers) global._puzzleAnswers = new Map();
    global._puzzleAnswers.set(message.jid, {
      answer: String(answer).toLowerCase(),
      expires: Date.now() + 60000
    });

    await message.sendReply(
      `*Bulmaca*\n\n` +
      `${question}\n\n` +
      `_60 saniye içinde "bulmacacevap [yanıt]" yazın._`
    );
  } catch (e) {
    await message.sendReply(`_Bulmaca alınamadı:_ ${e.message}`);
  }
});

Module({
  pattern: "bulmacacevap ?(.*)",
  fromMe: false,
  desc: "Bulmaca cevabı.",
  usage: "bulmacacevap [yanıt]",
  use: "oyun",
}, async (message, match) => {
  if (!global._puzzleAnswers) return;
  const game = global._puzzleAnswers.get(message.jid);
  if (!game) return;
  if (Date.now() > game.expires) {
    global._puzzleAnswers.delete(message.jid);
    return await message.sendReply(`_Süre doldu! Doğru cevap:_ *${game.answer}*`);
  }

  const answer = (match[1] || "").trim().toLowerCase();
  if (answer === game.answer || game.answer.includes(answer)) {
    global._puzzleAnswers.delete(message.jid);
    await message.sendReply("*Doğru cevap! Tebrikler!*");
  } else {
    await message.sendReply("_Yanlış cevap. Tekrar deneyin!_");
  }
});

// ══════════════════════════════════════════════════════
// Kelime Dizme
// ══════════════════════════════════════════════════════
Module({
  pattern: "kelemediz",
  fromMe: false,
  desc: "Harfleri doğru sıraya dizin.",
  usage: ".kelemediz",
  use: "oyun",
}, async (message) => {
  try {
    const data = await siputGet("/api/games/susunkata");
    const r = data.data || data.result;
    if (!r) return await message.sendReply("_Soru alınamadı._");

    const scrambled = r.soal || r.question;
    const answer = r.jawaban || r.answer;

    if (!global._wordAnswers) global._wordAnswers = new Map();
    global._wordAnswers.set(message.jid, {
      answer: String(answer).toLowerCase(),
      expires: Date.now() + 45000
    });

    await message.sendReply(
      `*Kelime Dizme*\n\n` +
      `Harfler: *${scrambled}*\n\n` +
      `_45 saniye içinde "kelime [cevap]" yazın!_`
    );
  } catch (e) {
    await message.sendReply(`_Oyun başlatılamadı:_ ${e.message}`);
  }
});

Module({
  pattern: "kelime ?(.*)",
  fromMe: false,
  desc: "Kelime dizme cevabı.",
  usage: "kelime [yanıt]",
  use: "oyun",
}, async (message, match) => {
  if (!global._wordAnswers) return;
  const game = global._wordAnswers.get(message.jid);
  if (!game) return;
  if (Date.now() > game.expires) {
    global._wordAnswers.delete(message.jid);
    return await message.sendReply(`_Süre doldu! Doğru cevap:_ *${game.answer}*`);
  }

  const answer = (match[1] || "").trim().toLowerCase();
  if (answer === game.answer) {
    global._wordAnswers.delete(message.jid);
    await message.sendReply("*Doğru cevap! Tebrikler!*");
  } else {
    await message.sendReply("_Yanlış cevap. Tekrar deneyin!_");
  }
});

// ══════════════════════════════════════════════════════
// Canvas: Profil Kartı
// ══════════════════════════════════════════════════════
Module({
  pattern: "profilkart ?(.*)",
  fromMe: false,
  desc: "Profil kartı oluşturur.",
  usage: ".profilkart",
  use: "tasarım",
}, async (message, match) => {
  try {
    const sender = message.sender || message.participant;
    const name = message.pushName || sender?.split("@")[0] || "Kullanıcı";
    let avatarUrl = null;
    try {
      avatarUrl = await message.client.profilePictureUrl(sender, "image");
    } catch { }

    if (!avatarUrl) avatarUrl = "https://via.placeholder.com/300";

    const buf = await siputGetBuffer("/api/canvas/profile", {
      avatar: avatarUrl,
      username: name,
    });

    await message.client.sendMessage(message.jid, {
      image: buf,
      caption: `*${name} Profil Kartı*`
    }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`_Profil kartı oluşturulamadı:_ ${e.message}`);
  }
});
})();

// ==========================================
// FILE: fun-tests.js
// ==========================================
(function() {
const { Module } = require("../main");
const { mentionjid, nx, trToEn, uploadToCatbox } = require("./utils");
const config = require("../config");

const getTargetUser = (message) => message.mention?.[0] || message.reply_message?.jid;
const randomPercent = () => Math.floor(Math.random() * 100) + 1;

async function runSingleRateCommand(message, { introText, resultText }) {
  if (!message.isGroup) return await message.sendReply("❗️ *Bu komut yalnızca grup sohbetlerinde çalışır!*");

  const user = getTargetUser(message);
  if (!user) return await message.sendReply("❗️ *Bana bir kullanıcı verin!*");

  await message.client.sendMessage(message.jid, {
    text: `${mentionjid(user)} ${introText}`,
    mentions: [user],
  });

  return await message.send(resultText(randomPercent()));
}

Module({
  pattern: "testgay ?(.*)",
  fromMe: false,
  desc: "Etiketlediğiniz üyenin gaylik yüzdesini ölçer.",
  usage: ".testgay [etiket/yanıt]",
  use: "oyun",
},
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *Gay* olma ihtimalini hesaplıyorum... 🧐",
      resultText: (percent) => `🏳️‍🌈 Senin *Gaylik* yüzden: *%${percent}!*`,
    });
  }
);

Module({
  pattern: "testlez ?(.*)",
  fromMe: false,
  desc: "Etiketlediğiniz üyenin lezlik yüzdesini ölçer.",
  usage: ".testlez [etiket/yanıt]",
  use: "oyun",
},
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *Lez* olma ihtimalini hesaplıyorum... 🧐",
      resultText: (percent) => `👩🏻‍❤️‍👩🏼 Senin *Lezlik* yüzden: *%${percent}!*`,
    });
  }
);

Module({
  pattern: "testprenses ?(.*)",
  fromMe: false,
  desc: "Etiketlediğiniz üyenin prenseslik seviyesini ölçer.",
  usage: ".testprenses [etiket/yanıt]",
  use: "oyun",
},
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *Prenses* olma ihtimalini hesaplıyorum... 🧐",
      resultText: (percent) => `🤭 Senin *Prenseslik* yüzden: *%${percent}!* 👸🏻`,
    });
  }
);

Module({
  pattern: "testregl ?(.*)",
  fromMe: false,
  desc: "Etiketlediğiniz üyenin Regl olma ihtimalini ölçer.",
  usage: ".testregl [etiket/yanıt]",
  use: "oyun",
},
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *Regl* olma ihtimalini hesaplıyorum... 🧐",
      resultText: (percent) => `🩸 Senin *Regl* yüzden: *%${percent}!* 😆`,
    });
  }
);

Module({
  pattern: "testinanç ?(.*)",
  fromMe: false,
  desc: "Etiketlediğiniz üyenin inanç seviyesini ölçer.",
  usage: ".testinanç [etiket/yanıt]",
  use: "oyun",
},
  async (message) => {
    await runSingleRateCommand(message, {
      introText: "üyesinin *İnanç* seviyesini hesaplıyorum... 🧐",
      resultText: (percent) => `🛐 Senin *İnanç* yüzden: *%${percent}!*`,
    });
  }
);

Module({
  pattern: "aşkölç ?(.*)",
  fromMe: false,
  desc: "İki kişi arasındaki aşk yüzdesini ölçer.",
  usage: ".aşkölç [etiket1] [etiket2]",
  use: "oyun",
},
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply("❗️ *Bu komut yalnızca grup sohbetlerinde çalışır!*");

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

Module({
  pattern: "beyin",
  fromMe: false,
  desc: "Zeka gelişimine katkıda bulunan rastgele bir beyin jimnastiği sorusu sorar.",
  usage: ".beyin",
  use: "oyun",
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

Module({
  pattern: "bilmece",
  fromMe: false,
  desc: "Keyifli vakit geçirmeniz için rastgele ve düşündürücü bir bilmece sorar.",
  usage: ".bilmece",
  use: "oyun",
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

Module({
  pattern: "kimyasoru",
  fromMe: false,
  desc: "Kimya bilginizi tazeleyecek element sembolleri üzerine bir soru sorar.",
  usage: ".kimyasoru",
  use: "oyun",
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

Module({
  pattern: "alay ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni eğlenceli ve alaycı bir slang formatına dönüştürür.",
  usage: ".alay [metin]",
  use: "eğlence",
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

Module({
  pattern: "dragonyazı ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni Dragon Ball tarzında şık bir logoya dönüştürür.",
  usage: ".dragonyazı [metin]",
  use: "düzenleme",
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

Module({
  pattern: "neonyazı ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni neon ışıklı ve dikkat çekici bir tabela logosu haline getirir.",
  usage: ".neonyazı [metin]",
  use: "düzenleme",
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

Module({
  pattern: "grafitiyazı ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni sokak sanatı olan grafiti stiliyle bir logoya dönüştürür.",
  usage: ".grafitiyazı [metin]",
  use: "düzenleme",
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

Module({
  pattern: "devilyazı ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni şeytan kanatları temalı karanlık bir logoya dönüştürür.",
  usage: ".devilyazı [metin]",
  use: "düzenleme",
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

Module({
  pattern: "müzikkart ?(.*)",
  fromMe: false,
  desc: "Şarkı ve sanatçı ismine özel şık bir Spotify tarzı müzik kartı tasarımı oluşturur.",
  usage: ".müzikkart [şarkı|sanatçı]",
  use: "düzenleme",
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
})();

