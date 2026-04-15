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