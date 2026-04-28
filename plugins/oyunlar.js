"use strict";

/**
 * Merged Module: games.js
 * Components: siputzx-games.js, fun-tests.js
 */

// ==========================================
// FILE: siputzx-games.js
// ==========================================
(function () {
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
  // Yanıtla-cevapla altyapısı (Matematik & Bayrak)
  // Gönderdiğimiz oyun mesajının ID'sine göre cevabı saklarız.
  // ══════════════════════════════════════════════════════
  if (!global._oyunYanitla) global._oyunYanitla = new Map();
  const OYUN_TTL = 5 * 60 * 1000; // 5 dakika
  const OYUN_MAX = 500;

  function oyunHatirla(msgId, payload) {
    if (!msgId || !payload) return;
    global._oyunYanitla.set(msgId, { ...payload, expires: Date.now() + OYUN_TTL });
    if (global._oyunYanitla.size > OYUN_MAX) {
      const now = Date.now();
      for (const [k, v] of global._oyunYanitla) {
        if (v.expires < now) global._oyunYanitla.delete(k);
      }
      if (global._oyunYanitla.size > OYUN_MAX) {
        const firstKey = global._oyunYanitla.keys().next().value;
        if (firstKey) global._oyunYanitla.delete(firstKey);
      }
    }
  }

  function oyunGetir(msgId) {
    if (!msgId) return null;
    const e = global._oyunYanitla.get(msgId);
    if (!e) return null;
    if (e.expires < Date.now()) {
      global._oyunYanitla.delete(msgId);
      return null;
    }
    return e;
  }

  function oyunSil(msgId) {
    if (msgId) global._oyunYanitla.delete(msgId);
  }

  // Türkçe sayı kelimelerini sayıya çevirir (basit)
  const TR_NUM_WORDS = {
    "sıfır": 0, "sifir": 0,
    "bir": 1, "iki": 2, "üç": 3, "uc": 3, "dört": 4, "dort": 4,
    "beş": 5, "bes": 5, "altı": 6, "alti": 6, "yedi": 7, "sekiz": 8,
    "dokuz": 9, "on": 10, "yirmi": 20, "otuz": 30, "kırk": 40, "kirk": 40,
    "elli": 50, "altmış": 60, "altmis": 60, "yetmiş": 70, "yetmis": 70,
    "seksen": 80, "doksan": 90, "yüz": 100, "yuz": 100, "bin": 1000
  };

  function trSozcuktenSayi(s) {
    const k = String(s || "").trim().toLowerCase();
    return TR_NUM_WORDS.hasOwnProperty(k) ? TR_NUM_WORDS[k] : null;
  }

  // ══════════════════════════════════════════════════════
  // Matematik Oyunu (yerel üretim — siputzx maths bozuk)
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "matoyun",
    fromMe: false,
    desc: "Türkçe matematik sorusu sorar. Soruyu yanıtlayarak cevap verin.",
    usage: ".matoyun",
    use: "oyun",
  }, async (message) => {
    try {
      // Rastgele zorlukta soru üret
      const ops = [
        { sym: "+", fn: (a, b) => a + b },
        { sym: "−", fn: (a, b) => a - b },
        { sym: "×", fn: (a, b) => a * b },
        { sym: "÷", fn: (a, b) => a / b },
      ];
      const op = ops[Math.floor(Math.random() * ops.length)];
      let a, b, soru, dogru;
      if (op.sym === "÷") {
        b = Math.floor(Math.random() * 9) + 2;     // 2..10
        dogru = Math.floor(Math.random() * 12) + 2; // 2..13
        a = b * dogru;
      } else if (op.sym === "×") {
        a = Math.floor(Math.random() * 12) + 2;    // 2..13
        b = Math.floor(Math.random() * 12) + 2;
        dogru = a * b;
      } else if (op.sym === "−") {
        a = Math.floor(Math.random() * 90) + 10;   // 10..99
        b = Math.floor(Math.random() * a);          // 0..a
        dogru = a - b;
      } else {
        a = Math.floor(Math.random() * 90) + 10;
        b = Math.floor(Math.random() * 90) + 10;
        dogru = a + b;
      }
      soru = `${a} ${op.sym} ${b}`;

      const sent = await message.client.sendMessage(message.jid, {
        text:
          `🧮 *Matematik Oyunu*\n\n` +
          `*Soru:* ${soru} = ?\n\n` +
          `↩️ _Bu mesajı yanıtlayarak cevabınızı yazın._`
      }, { quoted: message.data });

      const sentId = sent?.key?.id;
      if (sentId) {
        oyunHatirla(sentId, {
          tip: "math",
          soru,
          dogru: String(dogru),
          dogruSayi: dogru,
        });
      }
    } catch (e) {
      await message.sendReply(`❌ *Oyun başlatılamadı!* \n\n*Hata:* ${e.message}`);
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
      if (!r) return await message.sendReply("❌ *Soru alınamadı!*");

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
          caption: `🧩 *Görsel Tahmin Oyunu*\n\n_Bu görseldeki nesneyi tahmin edin!_\n⏳ _60 saniye içinde "tahmin [yanıt]" yazın._`
        }, { quoted: message.data });
      } else {
        const desc = r.deskripsi || r.description || r.soal;
        await message.sendReply(`🧩 *Görsel Tahmin*\n\n_İpucu:_ ${desc}\n\n⏳ _"tahmin [yanıt]" yazın._`);
      }
    } catch (e) {
      await message.sendReply(`❌ *Oyun başlatılamadı!* \n\n*Hata:* ${e.message}`);
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
      return await message.sendReply(`⏳ *Süre doldu!* \n\n*Doğru cevap:* \`${game.answer}\``);
    }

    const answer = (match[1] || "").trim().toLowerCase();
    if (answer === game.answer || game.answer.includes(answer)) {
      global._guessAnswers.delete(message.jid);
      await message.sendReply("✅ *Doğru cevap! Tebrikler!*");
    } else {
      await message.sendReply("❌ *Yanlış cevap!* _Tekrar deneyin._");
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
      if (!r) return await message.sendReply("❌ *Soru alınamadı!*");

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
          caption: `🏢 *Logo Tahmin Oyunu*\n\n_Bu logoyu tahmin edin!_\n⏳ _60 saniye içinde "tahmin [yanıt]" yazın._`
        }, { quoted: message.data });
      }
    } catch (e) {
      await message.sendReply(`❌ *Oyun başlatılamadı!* \n\n*Hata:* ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════
  // Bayrak Tahmin (yanıtla-cevapla, Türkçe ülke adları)
  // ══════════════════════════════════════════════════════
  let ULKELER_TR = {};
  try { ULKELER_TR = require("./data/ulkeler_tr.json"); } catch (_) { ULKELER_TR = {}; }

  // Türkçe karakterleri sadeleştirip lowercase'e çevirir
  function normalizeTR(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/i̇/g, "i")
      .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i")
      .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  Module({
    pattern: "bayraktahmin",
    fromMe: false,
    desc: "Bayrak tahmin oyunu. Bayrağı yanıtlayarak cevap verin.",
    usage: ".bayraktahmin",
    use: "oyun",
  }, async (message) => {
    try {
      const data = await siputGet("/api/games/tebakbendera");
      const r = data.data || data.result;
      if (!r) return await message.sendReply("❌ *Soru alınamadı!*");

      const imageUrl = r.img || r.image || r.url;
      const enName = r.name || r.country || r.jawaban || r.answer || "";
      // Bayrak URL'sinden ülke kodunu çıkar (örn. .../mk.png → mk)
      const codeMatch = String(imageUrl || "").match(/\/([a-z]{2})\.(png|svg|jpg|jpeg|webp)$/i);
      const code = codeMatch ? codeMatch[1].toLowerCase() : null;
      const trNames = (code && ULKELER_TR[code]) ? ULKELER_TR[code] : [];

      // Kabul edilen tüm cevap formları
      const acceptable = new Set();
      if (enName) acceptable.add(normalizeTR(enName));
      for (const n of trNames) acceptable.add(normalizeTR(n));

      if (!imageUrl) return await message.sendReply("❌ *Bayrak görseli alınamadı!*");

      const trDisplay = trNames[0] || enName || "?";
      const sent = await message.client.sendMessage(message.jid, {
        image: { url: imageUrl },
        caption:
          `🚩 *Bayrak Tahmin Oyunu*\n\n` +
          `_Bu bayrak hangi ülkeye ait?_\n\n` +
          `↩️ _Bu mesajı yanıtlayarak cevabınızı yazın._`
      }, { quoted: message.data });

      const sentId = sent?.key?.id;
      if (sentId) {
        oyunHatirla(sentId, {
          tip: "flag",
          dogru: trDisplay,
          enName,
          kabul: Array.from(acceptable),
        });
      }
    } catch (e) {
      await message.sendReply(`❌ *Oyun başlatılamadı!* \n\n*Hata:* ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════
  // Yanıt yakalayıcı: Matematik & Bayrak oyunlarına yanıt
  // ══════════════════════════════════════════════════════
  Module({
    on: "text",
    fromMe: false,
  }, async (message) => {
    try {
      if (!message.reply_message || !message.reply_message.fromMe) return;
      const repliedId =
        message.reply_message?.data?.key?.id ||
        message.reply_message?.key?.id;
      if (!repliedId) return;
      const game = oyunGetir(repliedId);
      if (!game) return;

      const userAnswer = (message.text || "").trim();
      if (!userAnswer) return;

      if (game.tip === "math") {
        // Sayıyı ya da kelimeyi parse et
        const cleaned = userAnswer.replace(/[^\-0-9.,]/g, "").replace(",", ".");
        let userNum = cleaned ? Number(cleaned) : NaN;
        if (Number.isNaN(userNum)) {
          const w = trSozcuktenSayi(userAnswer);
          if (w !== null) userNum = w;
        }
        if (Number.isNaN(userNum)) {
          return await message.sendReply("⚠️ _Sadece sayısal bir cevap yazın._");
        }
        if (userNum === game.dogruSayi) {
          oyunSil(repliedId);
          await message.sendReply(`✅ *Doğru cevap!* \`${game.soru} = ${game.dogru}\` 🎉`);
        } else {
          await message.sendReply("❌ *Yanlış cevap!* _Tekrar deneyin (yanıtlayarak)._");
        }
        return;
      }

      if (game.tip === "flag") {
        const u = normalizeTR(userAnswer);
        if (!u) return;
        const ok = (game.kabul || []).some((k) => k && (k === u || k.includes(u) || u.includes(k)));
        if (ok) {
          oyunSil(repliedId);
          await message.sendReply(`✅ *Doğru!* Bu bayrak *${game.dogru}* ülkesine ait. 🎉`);
        } else {
          await message.sendReply("❌ *Yanlış cevap!* _Tekrar deneyin (yanıtlayarak)._");
        }
        return;
      }
    } catch (e) {
      // sessizce yut, normal mesaj akışını bozma
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
      if (!r) return await message.sendReply("❌ *Soru alınamadı!*");

      const scrambled = r.soal || r.question;
      const answer = r.jawaban || r.answer;

      if (!global._wordAnswers) global._wordAnswers = new Map();
      global._wordAnswers.set(message.jid, {
        answer: String(answer).toLowerCase(),
        expires: Date.now() + 45000
      });

      await message.sendReply(
        `🔤 *Kelime Dizme*\n\n` +
        `Harfler: *${scrambled}*\n\n` +
        `⏳ _45 saniye içinde "kelime [cevap]" yazın!_`
      );
    } catch (e) {
      await message.sendReply(`❌ *Oyun başlatılamadı!* \n\n*Hata:* ${e.message}`);
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
      return await message.sendReply(`⏳ *Süre doldu!* \n\n*Doğru cevap:* \`${game.answer}\``);
    }

    const answer = (match[1] || "").trim().toLowerCase();
    if (answer === game.answer) {
      global._wordAnswers.delete(message.jid);
      await message.sendReply("✅ *Doğru cevap! Tebrikler!*");
    } else {
      await message.sendReply("❌ *Yanlış cevap!* _Tekrar deneyin._");
    }
  });

  // ══════════════════════════════════════════════════════
  // Canvas: Profil Kartı
  // ══════════════════════════════════════════════════════
  /*
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

      if (!avatarUrl) avatarUrl = "https://i.imgur.com/Y3KqMfn.jpg";

      // Siputzx API requires more params for this endpoint
      const buf = await siputGetBuffer("/api/canvas/profile", {
        avatarURL: avatarUrl,
        username: name,
        backgroundURL: "https://i.imgur.com/Y3KqMfn.jpg", // Default background
        rankName: "Üye",
        rankId: "1",
        exp: "100",
        requireExp: "1000",
        level: "1",
        name: name
      });

      }
    } catch (e) {
      await message.sendReply(`❌ *Profil kartı oluşturulamadı!* \n\n*Hata:* ${e.message}`);
    }
  });
*/
})();

  // ==========================================
  // FILE: fun-tests.js
  // ==========================================
  (function () {
    const { Module } = require("../main");
    const { mentionjid, nx, trToEn, uploadToCatbox } = require("./utils");
    const config = require("../config");

    const getTargetUser = (message) => message.mention?.[0] || message.reply_message?.jid;
    const randomPercent = () => Math.floor(Math.random() * 100) + 1;

    async function runSingleRateCommand(message, { introText, resultText }) {
      if (!message.isGroup) return await message.sendReply("❌ *Bu komut yalnızca gruplarda çalışır!*");

      const user = getTargetUser(message);
      if (!user) return await message.sendReply("⚠️ *Bir üyeyi etiketleyin veya yanıtlayın!*");

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
        if (!message.isGroup) return await message.sendReply("❌ *Bu komut yalnızca gruplarda çalışır!*");

        const percentage = Math.floor(Math.random() * 101);
        const mentioned = message.mention || [];

        if (mentioned.length > 0) {
          if (mentioned.length < 2) {
            return await message.sendReply("⚠️ *2 kişiyi etiketleyin veya isimlerini yazın!*");
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
          return await message.sendReply("⚠️ *2 kişiyi etiketleyin veya isimlerini yazın!*");
        }

        const [name1, name2] = parts;
        return await message.send(
          `🔥 *${name1}* ve *${name2}* arasındaki aşk yüzdesi: *%${percentage}!* ❤️‍🔥`
        );
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
          await message.sendReply(`❌ *Görsel oluşturulamadı:* \n\n${e.message}`);
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
          await message.sendReply(`❌ *Görsel oluşturulamadı:* \n\n${e.message}`);
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
          await message.sendReply(`❌ *Görsel oluşturulamadı:* \n\n${e.message}`);
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
          await message.sendReply(`❌ *Görsel oluşturulamadı:* \n\n${e.message}`);
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
          await message.sendReply(`❌ *Müzik kartı oluşturulamadı:* \n\n${e.message}`);
        }
      }
    );
  })();

// ==========================================
// FILE: sihirlikure.js + adamasmaca.js
// ==========================================
(function () {
  const { Module } = require("../main");

  // ══════════════════════════════════════════════════════
  // Sihirli Küre (Magic 8-Ball)
  // ══════════════════════════════════════════════════════
  const SEKIZLI_CEVAPLAR = [
    // Olumlu
    "🔮 Kesinlikle evet!",
    "🔮 Evet, bundan emin olabilirsin.",
    "🔮 İşaretler bunu gösteriyor.",
    "🔮 Görünüşe göre evet.",
    "🔮 Benim görüşüm: evet.",
    "🔮 Çok olası.",
    "🔮 Evet, kesinlikle.",
    "🔮 Tabii ki!",
    // Tarafsız
    "🔮 Şimdilik cevap belirsiz, tekrar sor.",
    "🔮 Şimdi tahmin etmek zor.",
    "🔮 Şu an konsantre olamıyorum, tekrar sor.",
    "🔮 Daha sonra tekrar sor.",
    "🔮 Bunu şu an tahmin edemiyorum.",
    "🔮 Daha iyi odaklan ve tekrar sor.",
    // Olumsuz
    "🔮 Çok da iyi değil.",
    "🔮 Hayır diyebilirim.",
    "🔮 Görünüşe göre hayır.",
    "🔮 Çok şüpheliyim.",
    "🔮 Hayır.",
    "🔮 İşaretler hayır diyor.",
  ];

  Module({
    pattern: "sihirlikure ?(.*)",
    fromMe: false,
    desc: "Sihirli küreye bir soru sorun, mistik cevabını alın! (8-Ball)",
    usage: ".sihirlikure [sorunuz]",
    use: "oyun",
  },
    async (message, match) => {
      const soru = (match[1] || "").trim();
      if (!soru) {
        return await message.sendReply(
          "🔮 *Sihirli Küre*\n\n_Bana bir soru sormalısın!_\n\n💬 _Örnek:_ `.sihirlikure Bu ay şansım açık olacak mı?`"
        );
      }
      const cevap = SEKIZLI_CEVAPLAR[Math.floor(Math.random() * SEKIZLI_CEVAPLAR.length)];
      return await message.sendReply(`🔮 *Soru:* _${soru}_\n\n${cevap}`);
    }
  );

  // ══════════════════════════════════════════════════════
  // Adam Asmaca (Hangman)
  // ══════════════════════════════════════════════════════
  const KELIME_LISTESI = [
    "araba", "bilgisayar", "telefon", "müzik", "sinema", "tatil",
    "yazılım", "internet", "uçak", "deniz", "dağ", "şehir",
    "kitap", "spor", "yemek", "çiçek", "hayvan", "gezegen",
    "oyun", "dans", "şarkı", "sanat", "fotoğraf", "kamera",
    "güneş", "yıldız", "nehir", "orman", "köprü", "müze",
    "bisiklet", "tren", "gemi", "roket", "kalem", "defter",
    "elma", "portakal", "çilek", "muz", "karpuz", "kavun",
    "aslan", "kaplan", "fil", "penguen", "yunus", "kartal",
    "futbol", "basketbol", "tenis", "yüzme", "koşu", "satranç",
  ];

  // Aktif oyunlar: chatJid -> oyun durumu
  const adamAsmacaOyunlari = new Map();

  const DARAGINLAR = [
    "```\n  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========```",
    "```\n  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========```",
    "```\n  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========```",
    "```\n  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========```",
    "```\n  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========```",
    "```\n  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========```",
    "```\n  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========```",
  ];

  function maskele(kelime, tahminler) {
    return kelime.split("").map(h => tahminler.includes(h) ? h : "_").join(" ");
  }

  function oyunDurumu(oyun) {
    const daraginStr = DARAGINLAR[oyun.yanlislar] || DARAGINLAR[DARAGINLAR.length - 1];
    const maskStr = maskele(oyun.kelime, oyun.tahminler);
    const harf = oyun.tahminler.length ? oyun.tahminler.join(", ") : "-";
    return (
      `${daraginStr}\n\n` +
      `📝 *Kelime:* \`${maskStr}\`\n` +
      `❌ *Yanlış hak:* ${oyun.yanlislar}/${oyun.maxYanlis}\n` +
      `🔤 *Denenen harfler:* ${harf}`
    );
  }

  Module({
    pattern: "adamasmaca ?(.*)",
    fromMe: false,
    desc: "Adam asmaca oyunu başlatır. `.adamasmaca` ile yeni oyun, `.harf X` ile harf tahmini.",
    usage: ".adamasmaca",
    use: "oyun",
  },
    async (message) => {
      const jid = message.jid;

      if (adamAsmacaOyunlari.has(jid)) {
        const oyun = adamAsmacaOyunlari.get(jid);
        return await message.sendReply(
          `⚠️ *Bu sohbette zaten devam eden bir oyun var!*\n\n` +
          `${oyunDurumu(oyun)}\n\n` +
          `💬 _Harf tahmin etmek için_ \`.harf [harf]\` _yazın._\n` +
          `💬 _Oyunu bitirmek için_ \`.adamasmacabitti\` _yazın._`
        );
      }

      const kelime = KELIME_LISTESI[Math.floor(Math.random() * KELIME_LISTESI.length)];
      const oyun = { kelime, tahminler: [], yanlislar: 0, maxYanlis: 6 };
      adamAsmacaOyunlari.set(jid, oyun);

      // Timeout: 10 dakika sonra oyunu otomatik bitir
      setTimeout(() => {
        if (adamAsmacaOyunlari.has(jid)) {
          adamAsmacaOyunlari.delete(jid);
        }
      }, 10 * 60 * 1000);

      return await message.sendReply(
        `🎮 *Adam Asmaca Başladı!*\n\n` +
        `${oyunDurumu(oyun)}\n\n` +
        `💬 _Harf tahmin etmek için_ \`.harf [harf]\` _yazın._\n` +
        `💬 _Kelimeyi direkt tahmin etmek için_ \`.tahmin [kelime]\` _yazın._`
      );
    }
  );

  Module({
    pattern: "harf ?(.*)",
    fromMe: false,
    desc: "Adam asmaca oyununda harf tahmini yapar.",
    usage: ".harf [harf]",
    use: "oyun",
    dontAddCommandList: true,
  },
    async (message, match) => {
      const jid = message.jid;
      if (!adamAsmacaOyunlari.has(jid)) {
        return await message.sendReply("🎮 _Aktif bir oyun yok. Yeni oyun için_ `.adamasmaca` _yazın._");
      }

      const harf = (match[1] || "").trim().toLowerCase().replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c");
      if (!harf || harf.length !== 1 || !/[a-z]/.test(harf)) {
        return await message.sendReply("❌ _Lütfen tek bir harf girin._ Örnek: `.harf a`");
      }

      const oyun = adamAsmacaOyunlari.get(jid);
      const kelimeNorm = oyun.kelime.replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c");

      if (oyun.tahminler.includes(harf)) {
        return await message.sendReply(`⚠️ *"${harf}"* harfini zaten denediniz!\n\n${oyunDurumu(oyun)}`);
      }

      oyun.tahminler.push(harf);

      if (kelimeNorm.includes(harf)) {
        // Doğru harf — kazandı mı kontrol et
        const kazandi = kelimeNorm.split("").every(h => oyun.tahminler.includes(h));
        if (kazandi) {
          adamAsmacaOyunlari.delete(jid);
          return await message.sendReply(
            `🎉 *Tebrikler! Kelimeyi buldunuz!*\n\n` +
            `✅ *Kelime:* \`${oyun.kelime}\`\n\n` +
            `💬 _Yeni oyun için_ \`.adamasmaca\` _yazın._`
          );
        }
        return await message.sendReply(`✅ *"${harf}"* doğru!\n\n${oyunDurumu(oyun)}`);
      } else {
        // Yanlış harf
        oyun.yanlislar++;
        if (oyun.yanlislar >= oyun.maxYanlis) {
          adamAsmacaOyunlari.delete(jid);
          return await message.sendReply(
            `${DARAGINLAR[DARAGINLAR.length - 1]}\n\n` +
            `💀 *Oyun Bitti!* Kelimeyi bulamadınız.\n\n` +
            `✅ *Doğru kelime:* \`${oyun.kelime}\`\n\n` +
            `💬 _Tekrar oynamak için_ \`.adamasmaca\` _yazın._`
          );
        }
        return await message.sendReply(`❌ *"${harf}"* yanlış!\n\n${oyunDurumu(oyun)}`);
      }
    }
  );

  Module({
    pattern: "adamasmacabitti",
    fromMe: false,
    desc: "Devam eden adam asmaca oyununu iptal eder.",
    usage: ".adamasmacabitti",
    use: "oyun",
    dontAddCommandList: true,
  },
    async (message) => {
      const jid = message.jid;
      if (!adamAsmacaOyunlari.has(jid)) {
        return await message.sendReply("🎮 _Bu sohbette aktif bir oyun yok._");
      }
      const oyun = adamAsmacaOyunlari.get(jid);
      adamAsmacaOyunlari.delete(jid);
      return await message.sendReply(
        `🛑 *Oyun iptal edildi.*\n\n✅ *Doğru kelime:* \`${oyun.kelime}\``
      );
    }
  );
}());
