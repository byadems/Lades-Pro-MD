const { Module } = require("../main");
const axios = require("axios");
const config = require("../config");
const { CircuitBreaker } = require("./utils/resilience");
const nexray = require("./utils/nexray");
const { saveToDisk, getTempPath, cleanTempFile, isMediaImage } = require("../core/helpers");
const { sticker, addExif } = require("./utils");
const { uploadToImgbb, uploadToCatbox } = require("./utils/upload");

async function uploadMedia(filePath, type = "image") {
  if (type === "image") {
    let res = await uploadToImgbb(filePath);
    let url = res?.url || res?.display_url || (typeof res === "string" ? res : null);
    if (!url && res?.image) url = res.image.url || res.image.display_url || (typeof res.image === "string" ? res.image : null);
    if (url && typeof url === "string" && url.startsWith("http")) return url;
  }
  let catRes = await uploadToCatbox(filePath);
  if (catRes && catRes.url && !catRes.url.includes("_Dosya")) return catRes.url;
  throw new Error("Dosya internete yüklenirken hata oluştu.");
}

const BASE = "https://api.nexray.web.id";
const TIMEOUT = 30000;

const SIPUTZX_BASE = "https://api.siputzx.my.id";

async function siputGet(path, params = {}) {
  const url = `${SIPUTZX_BASE}${path}`;
  const res = await axios.get(url, { params, timeout: 30000, validateStatus: () => true });
  if (res.data && res.data.status) return res.data;
  throw new Error(res.data?.error || "API yanıt vermedi");
}

// Nexray API için kategorize edilmiş devre kesiciler (Circuit Breaker Pool)
const breakers = new Map();

function getBreaker(category) {
  if (!breakers.has(category)) {
    const breaker = new CircuitBreaker(async (path, opts) => {
      return await axios.get(`${BASE}${path}`, {
        timeout: opts.timeout || TIMEOUT,
        validateStatus: () => true,
        responseType: opts.buffer ? "arraybuffer" : "json",
      });
    }, {
      failureThreshold: 3,
      openTimeout: 60000 // 1 dakika devre dışı kal
    });
    breakers.set(category, breaker);
  }
  return breakers.get(category);
}

async function nexGet(path, opts = {}) {
  try {
    // Path üzerinden kategori belirle (örn: /ai/dreamanalyze -> ai)
    const category = path.split("/")[1] || "default";
    const breaker = getBreaker(category);

    const res = await breaker.fire(path, opts);
    let payload = res.data;
    const contentType = (res.headers?.["content-type"] || "").toLowerCase();

    if (opts.buffer) {
      const buf = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data || []);
      if (contentType.includes("application/json") || contentType.includes("text/json")) {
        try {
          payload = JSON.parse(buf.toString("utf-8"));
        } catch {
          payload = null;
        }
      }
      if (res.status === 200 && buf.length > 0 && !contentType.includes("json")) {
        return buf;
      }
    }

    if (payload?.status && payload?.result !== undefined) {
      return payload.result;
    }

    const errorMsg =
      payload?.error?.message ||
      payload?.error ||
      payload?.message ||
      payload?.result?.message ||
      `HTTP ${res.status}`;

    throw new Error(errorMsg);
  } catch (e) {
    if (e.name === "CircuitBreakerError") {
      throw new Error("⚠️ _API servisi şu an yoğun veya kapalı. Lütfen daha sonra tekrar deneyin._");
    }
    throw e;
  }
}

// ══════════════════════════════════════════════════════════
// 1. EMOJİMİX — İki emojiyi birleştirir
// ══════════════════════════════════════════════════════════
Module({
  pattern: "emojimix ?(.*)",
  fromMe: false,
  desc: "İki farklı emojiyi birleştirerek özel bir çıkartma oluşturur.",
  usage: ".emojimix 😀 🔥",
  use: "eğlence",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const emojis = [...input].filter((c) => /\p{Emoji}/u.test(c));
    if (emojis.length < 2) {
      return await message.sendReply("😀🔥 _İki emoji girin:_ `.emojimix 😀 🔥`");
    }
    try {
      const buf = await nexGet(`/tools/emojimix?emoji1=${encodeURIComponent(emojis[0])}&emoji2=${encodeURIComponent(emojis[1])}`, { buffer: true });
      const stickerBuf = await addExif(await sticker(buf, false), { packname: message.pushName || message.senderName || "Lades-Pro", author: config.STICKER_DATA.split(";")[1] || "Lades-Pro" });
      await message.client.sendMessage(message.jid, { sticker: stickerBuf }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Emoji birleştirilemedi:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 2. YAZI — Glitch efektli metin görseli
// ══════════════════════════════════════════════════════════
Module({
  pattern: "yazı ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni glitch efektli profesyonel bir görsele dönüştürür.",
  usage: ".yazı LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("✏️ _Metin girin:_ `.yazı LADES`");
    try {
      const buf = await nexGet(`/textpro/glitch?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `✨` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 3. NARUTO — Naruto stili metin logosu
// ══════════════════════════════════════════════════════════
Module({
  pattern: "naruto ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni Naruto stili bir logoya dönüştürür.",
  usage: ".naruto LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("🍥 _Metin girin:_ `.naruto LADES`");
    try {
      const buf = await nexGet(`/textpro/naruto?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🍥` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 4. MARVEL — Marvel stili logo (2 kelime)
// ══════════════════════════════════════════════════════════
Module({
  pattern: "marvel ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni Marvel stili bir logoya dönüştürür. (2 kelime gerektirir)",
  usage: ".marvel LADES BOT",
  use: "düzenleme",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const words = input.split(/\s+/);
    if (words.length < 2) return await message.sendReply("🦸 _İki kelime girin:_ `.marvel LADES BOT`");
    try {
      const buf = await nexGet(`/textpro/marvel?text1=${encodeURIComponent(words[0])}&text2=${encodeURIComponent(words.slice(1).join(" "))}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🦸` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 5. BLACKPINK — Blackpink stili metin
// ══════════════════════════════════════════════════════════
Module({
  pattern: "blackpink ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni Blackpink stili bir görsele dönüştürür.",
  usage: ".blackpink LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("💗 _Metin girin:_ `.blackpink LADES`");
    try {
      const buf = await nexGet(`/textpro/blackpink?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `💗` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// HUB — Pornhub stili logo (2 kelime)
// ══════════════════════════════════════════════════════════
Module({
  pattern: "hub ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni P*rnhub stili bir logoya dönüştürür. (2 kelime gerektirir)",
  usage: ".hub LADES HUB",
  use: "düzenleme",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const words = input.split(/\s+/);
    if (words.length < 2) return await message.sendReply("🔞 _İki kelime girin:_ `.hub Lades Hub`");
    try {
      const buf = await nexGet(`/textpro/pornhub?text1=${encodeURIComponent(words[0])}&text2=${encodeURIComponent(words.slice(1).join(" "))}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🔞` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 6. BRAT — Charli XCX Brat stili metin
// ══════════════════════════════════════════════════════════
Module({
  pattern: "brat ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni Brat (Charli XCX) stili yeşil bir görsele dönüştürür.",
  usage: ".brat metin | .bratgif metin | .bratgif 500 metin",
  use: "düzenleme",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    if (!input) return await message.sendReply(
      "✍🏻 *Brat - Yazıdan Çıkartma Oluşturucu*\n\n" +
      "📝 _Kullanım:_\n" +
      "`.brat metin` - Standart çıkartma\n" +
      "`.bratgif metin` - Animasyonlu çıkartma (varsayılan 300ms)\n" +
      "`.bratgif 500 metin` - Animasyonlu çıkartma (500ms hızında)\n\n" +
      "_Örnek:_\n" +
      "`.brat Lades Bot`\n" +
      "`.bratgif Lades Bot`\n" +
      "`.bratgif 1000 Lades Bot`"
    );

    let text;
    let delay = 300;
    let isAnimated = false;

    const parts = input.split(" ");

    if (parts[0].toLowerCase() === "gif") {
      isAnimated = true;
      parts.shift();

      const firstPart = parts[0] ?? "";
      if (/^\d+$/.test(firstPart)) {
        delay = parseInt(firstPart, 10);
        if (delay < 50) delay = 50;
        if (delay > 2000) delay = 2000;
        parts.shift();
      }
    }

    text = parts.join(" ").trim();

    if (!text) return await message.sendReply("✍🏻 _Metin yazın:_ `.brat lades bot`");

    const encodedText = text.replace(/ /g, "+");

    try {
      const url = isAnimated
        ? `https://api.siputzx.my.id/api/m/brat?text=${encodedText}&isAnimated=true&delay=${delay}`
        : `https://api.nexray.web.id/maker/brat?text=${encodedText}`;

      const buf = (await axios.get(url, { responseType: 'arraybuffer' })).data;

      const stickerBuf = await addExif(
        await sticker(buf, isAnimated),
        {
          packname: message.pushName || message.senderName || "Lades-Pro",
          author: config.STICKER_DATA.split(";")[1] || "Lades-Pro"
        }
      );

      await message.client.sendMessage(
        message.jid,
        { sticker: stickerBuf },
        { quoted: message.data }
      );
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 7. SÖZ — Şarkı sözü bulma (lyrics.ovh + LRCLib + Nexray fallback)
// ══════════════════════════════════════════════════════════
Module({
  pattern: "şarkısözü ?(.*)",
  fromMe: false,
  desc: "İstediğiniz şarkının sözlerini farklı kaynaklardan arayarak getirir.",
  usage: ".şarkısözü [şarkı adı]",
  use: "arama",
},
  async (message, match) => {
    const query = (match[1] || "").trim();
    if (!query) return await message.sendReply("🎵 _Şarkı adı girin:_ `.şarkısözü Tarkan Şımarık`");

    let lyrics = null;
    let title = query;
    let artist = null;

    // 1. LRCLib API (en güvenilir)
    try {
      const lrcRes = await axios.get(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { timeout: 15000 });
      if (lrcRes.data?.length > 0) {
        const track = lrcRes.data[0];
        lyrics = track.plainLyrics || track.syncedLyrics;
        title = track.trackName || title;
        artist = track.artistName;
      }
    } catch (_) { }

    // 2. lyrics.ovh API (yedek)
    if (!lyrics) {
      try {
        const parts = query.split(/[-–—]/);
        if (parts.length >= 2) {
          const artistName = parts[0].trim();
          const songName = parts.slice(1).join("-").trim();
          const ovhRes = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artistName)}/${encodeURIComponent(songName)}`, { timeout: 15000 });
          if (ovhRes.data?.lyrics) {
            lyrics = ovhRes.data.lyrics;
            artist = artistName;
            title = songName;
          }
        }
      } catch (_) { }
    }

    // 3. Nexray API (son yedek)
    if (!lyrics) {
      try {
        const r = await nexGet(`/search/lyrics?q=${encodeURIComponent(query)}`, { timeout: 20000 });
        if (r?.lyrics) {
          lyrics = r.lyrics;
          title = r.title || title;
          artist = r.artist;
        }
      } catch (_) { }
    }

    if (!lyrics) {
      return await message.sendReply("❌ _Şarkı sözü bulunamadı. Şarkıcı - Şarkı adı formatında deneyin._");
    }

    lyrics = lyrics.length > 3000 ? lyrics.substring(0, 3000) + "\n..." : lyrics;
    await message.sendReply(
      `🎵 *${title}*\n` +
      (artist ? `👤 _${artist}_\n\n` : "\n") +
      lyrics
    );
  }
);

// ══════════════════════════════════════════════════════════
// 8. DUVAR — HD duvar kağıdı arama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "duvarkağıdı ?(.*)",
  fromMe: false,
  desc: "Belirlediğiniz konuya uygun HD kalitede duvar kağıtları bulur.",
  usage: ".duvarkağıdı [konu]",
  use: "arama",
},
  async (message, match) => {
    const query = (match[1] || "").trim();
    if (!query) return await message.sendReply("🖼️ _Konu girin:_ `.duvarkağıdı doğa`");
    try {
      const results = await nexGet(`/search/wallcraft?q=${encodeURIComponent(query)}`);
      if (!results?.length) throw new Error("Sonuç bulunamadı");
      const pick = results[Math.floor(Math.random() * Math.min(results.length, 10))];
      const imgUrl = pick.url || pick.image || pick.thumbnail;
      if (!imgUrl) throw new Error("Görsel bağlantısı bulunamadı");
      await message.client.sendMessage(message.jid, {
        image: { url: imgUrl },
        caption: `🖼️`,
      }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Duvar kağıdı bulunamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 9. ÇIKARTMABUL — WhatsApp sticker paketi arama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "çıkartmabul ?(.*)",
  fromMe: false,
  desc: "WhatsApp için hazır çıkartma paketleri aramanızı sağlar.",
  usage: ".çıkartmabul [konu]",
  use: "arama",
},
  async (message, match) => {
    const query = (match[1] || "").trim();
    if (!query) return await message.sendReply("🔍 _Çıkartma konusu girin:_ `.çıkartmabul kedi`");
    try {
      const results = await nexGet(`/search/stickerly?q=${encodeURIComponent(query)}`);
      if (!results?.length) throw new Error("Sonuç bulunamadı");
      let msg = `🔍 *"${query}" Çıkartma Paketleri*\n\n`;
      results.slice(0, 8).forEach((s, i) => {
        msg += `*${i + 1}.* ${s.name || "İsimsiz"}\n`;
        if (s.author) msg += `   👤 _${s.author}_\n`;
        if (s.sticker_count) msg += `   📦 _${s.sticker_count} çıkartma_\n`;
        msg += "\n";
      });
      await message.sendReply(msg);
    } catch (e) {
      await message.sendReply(`❌ _Çıkartma bulunamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 10. WİKİ — Wikipedia bilgi çekme
// ══════════════════════════════════════════════════════════
Module({
  pattern: "vikipedi ?(.*)",
  fromMe: false,
  desc: "Vikipedi üzerinden belirttiğiniz konu hakkında özet bilgi getirir.",
  usage: ".vikipedi [konu]",
  use: "arama",
},
  async (message, match) => {
    const query = (match[1] || "").trim();
    if (!query) return await message.sendReply("📚 _Konu girin:_ `.vikipedi İstanbul`");
    try {
      const results = await nexGet(`/search/wikipedia?q=${encodeURIComponent(query)}`);
      if (!results?.length) throw new Error("Sonuç bulunamadı");
      const article = results[0];
      const snippet = article.snippet?.replace(/<[^>]*>/g, "") || "";
      await message.sendReply(
        `📚 *${article.title}*\n\n` +
        `${snippet}\n\n` +
        `🔗 _https://tr.wikipedia.org/wiki/${encodeURIComponent(article.title)}_`
      );
    } catch (e) {
      await message.sendReply(`❌ _Wikipedia araması başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 11. ALINTI — WhatsApp tarzı alıntı görseli
// ══════════════════════════════════════════════════════════
Module({
  pattern: "alıntı ?(.*)",
  fromMe: false,
  desc: "Mesajı veya metni WhatsApp tarzı şık bir alıntı çıkartmasına dönüştürür.",
  usage: ".alıntı [metin]",
  use: "düzenleme",
},
  async (message, match) => {
    let text = (match[1] || "").trim();
    if (!text && message.reply_message) {
      text = message.reply_message.text || message.reply_message.caption || "";
    }
    if (!text) return await message.sendReply("💬 _Metin girin veya bir mesajı yanıtlayın:_ `.alıntı Merhaba!`");
    const name = message.reply_message?.senderName || message.senderName || "Anonim";
    const ppUrl = "https://i.imgur.com/Y3KqMfn.jpg";
    try {
      const buf = await nexGet(
        `/maker/qc?text=${encodeURIComponent(text)}&name=${encodeURIComponent(name)}&avatar=${encodeURIComponent(ppUrl)}&color=putih`,
        { buffer: true }
      );
      const stickerBuf = await addExif(await sticker(buf, false), { packname: message.pushName || message.senderName || "Lades-Pro", author: config.STICKER_DATA.split(";")[1] || "Lades-Pro" });
      await message.client.sendMessage(message.jid, { sticker: stickerBuf }, { quoted: message.reply_message || message.data });
    } catch (e) {
      await message.sendReply(`❌ _Alıntı oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 12. RÜYA — AI rüya yorumu
// ══════════════════════════════════════════════════════════
Module({
  pattern: "rüya ?(.*)",
  fromMe: false,
  desc: "Gördüğünüz rüyayı yapay zeka desteğiyle detaylıca yorumlar.",
  usage: ".rüya [anlatım]",
  use: "yapay-zeka",
},
  async (message, match) => {
    let text = (match[1] || "").trim();
    if (!text && message.reply_message) {
      text = message.reply_message.text || "";
    }
    if (!text) return await message.sendReply("🌙 _Rüyanızı anlatın:_ `.rüya Gökyüzünde uçuyordum`");
    try {
      const sent = await message.send("🌙 _Rüyanız yorumlanıyor..._");
      const result = await nexGet(`/ai/dreamanalyze?text=${encodeURIComponent(text)}`);
      if (!result) throw new Error("Yorum alınamadı");
      const interpretation = typeof result === "string" ? result : JSON.stringify(result);
      await message.edit("🌙 *Rüya Yorumu*", message.jid, sent.key);
      await message.sendReply(`🌙 *Rüya Yorumu*\n\n💭 _"${text.substring(0, 100)}${text.length > 100 ? "..." : ""}"_\n\n🔮 ${interpretation}`);
    } catch (e) {
      await message.sendReply(`❌ _Rüya yorumlanamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 13. GÖRSEL — AI ile metin→görsel oluşturma (Ideogram)
// ══════════════════════════════════════════════════════════
Module({
  pattern: "görsel ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metin açıklamasını yapay zeka ile görsel bir sanat eserine çevirir.",
  usage: ".görsel [açıklama]",
  use: "yapay-zeka",
},
  async (message, match) => {
    const prompt = (match[1] || "").trim();
    if (!prompt) return await message.sendReply("🎨 _Görsel açıklaması girin:_ `.görsel sevimli bir kedi anime stili`");
    try {
      const sent = await message.send("🎨 _Görsel oluşturuluyor..._ ⌛");
      const buf = await nexGet(`/ai/ideogram?prompt=${encodeURIComponent(prompt)}`, { buffer: true, timeout: 90000 });
      await message.edit("✅ _Görsel oluşturuldu!_", message.jid, sent.key);
      await message.client.sendMessage(message.jid, {
        image: buf,
        caption: `🎨`,
      }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 14. THREADS — Threads video/görsel indirme
// ══════════════════════════════════════════════════════════
Module({
  pattern: "threads ?(.*)",
  fromMe: false,
  desc: "Threads üzerinden video veya fotoğraf içeriklerini indirmenizi sağlar.",
  usage: ".threads [bağlantı]",
  use: "indirme",
},
  async (message, match) => {
    let url = (match[1] || "").trim();
    if (!url && message.reply_message?.text) {
      const m = message.reply_message.text.match(/https?:\/\/\S+/);
      if (m) url = m[0];
    }
    if (!url || !/threads\.net/i.test(url)) {
      return await message.sendReply("🧵 _Threads bağlantısı girin:_ `.threads <bağlantı>`");
    }
    const quotedMessage = message.reply_message ? message.quoted : message.data;
    try {
      // Yeni nexray modülü ile (Nexray + Siputzx fallback)
      const mediaUrls = await nexray.downloadThreads(url);

      if (!mediaUrls || !mediaUrls.length) {
        return await message.sendReply("_⚠️ Medya bulunamadı veya bağlantı geçersiz_");
      }

      if (mediaUrls.length === 1) {
        const isImage = isMediaImage(mediaUrls[0]);
        const tempPath = getTempPath(isImage ? ".jpg" : ".mp4");
        try {
          await saveToDisk(mediaUrls[0], tempPath);
          return await message.sendReply(
            { [isImage ? "image" : "video"]: { url: tempPath } },
            { quoted: quotedMessage }
          );
        } finally {
          cleanTempFile(tempPath);
        }
      }

      await message.sendReply(`_${mediaUrls.length} medya iletiliyor..._`, { quoted: quotedMessage });
      for (const mediaUrl of mediaUrls) {
        const isImage = isMediaImage(mediaUrl);
        const tempPath = getTempPath(isImage ? ".jpg" : ".mp4");
        try {
          await saveToDisk(mediaUrl, tempPath);
          await message.sendReply({ [isImage ? "image" : "video"]: { url: tempPath } });
          await new Promise(r => setTimeout(r, 600));
        } catch (err) {
          console.error("Threads medya indirilemedi:", err?.message);
        } finally {
          cleanTempFile(tempPath);
        }
      }
    } catch (e) {
      console.error("Threads indirme hatası:", e?.message);
      await message.sendReply(`❌ _Threads indirme başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// 15. SOUNDCLOUD — SoundCloud ses indirme
// ══════════════════════════════════════════════════════════
Module({
  pattern: "soundcloud ?(.*)",
  fromMe: false,
  desc: "SoundCloud üzerindeki şarkıları yüksek kalitede MP3 olarak indirir.",
  usage: ".soundcloud [bağlantı]",
  use: "indirme",
},
  async (message, match) => {
    let url = (match[1] || "").trim();
    if (!url && message.reply_message?.text) {
      const m = message.reply_message.text.match(/https?:\/\/\S+/);
      if (m) url = m[0];
    }
    if (!url || !url.includes("soundcloud")) {
      return await message.sendReply("🎧 _SoundCloud bağlantısı girin:_ `.soundcloud <bağlantı>`");
    }
    let statusMsg;
    try {
      statusMsg = await message.sendReply("_⬇️ SoundCloud'dan indiriliyor..._");
      // Yeni nexray modülü ile (Nexray + Siputzx + nxTry fallback zinciri)
      const result = await nexray.downloadSoundCloud(url);
      if (!result?.url) throw new Error("Ses bağlantısı bulunamadı");

      const title = result.title || "SoundCloud";
      const author = result.author || "";

      await message.edit(`_📤 *${title}* yükleniyor..._`, message.jid, statusMsg.key);

      await message.client.sendMessage(message.jid, {
        audio: { url: result.url },
        mimetype: "audio/mpeg",
        fileName: `${title}.mp3`,
        externalAdReply: {
          title,
          body: author || "SoundCloud",
          mediaType: 2,
        },
      }, { quoted: message.data });

      await message.edit("_✅ İndirme tamamlandı!_", message.jid, statusMsg.key);
    } catch (e) {
      // Fallback: Siputzx API
      try {
        const fallback = await siputGet("/api/d/soundcloud", { url });
        const r = fallback.data || fallback.result;
        if (r?.url || r?.download || r?.audio) {
          const audioUrl = r.url || r.download || r.audio;
          await message.client.sendMessage(message.jid, {
            audio: { url: audioUrl },
            mimetype: "audio/mpeg",
          }, { quoted: message.data });
          return;
        }
      } catch (_) { }
      console.error("SoundCloud indirme hatası:", e?.message);
      if (statusMsg) {
        await message.edit(`_❌ SoundCloud indirme başarısız:_ ${e.message}`, message.jid, statusMsg.key);
      } else {
        await message.sendReply(`❌ _SoundCloud indirme başarısız:_ ${e.message}`);
      }
    }
  }
);

Module({
  pattern: "çevir ?(.*)",
  fromMe: false,
  desc: "Metni belirlediğiniz diller arasında anlık olarak çevirir.",
  usage: ".çevir [dil1] [dil2]",
  use: "arama",
},
  async (message, match) => {
    try {
      const raw = (match?.[1] || "").trim();
      const parts = raw.split(/\s+/);
      if (parts.length < 2) {
        return await message.sendReply("❗ Kullanımı:\n(Bir mesaja yanıtlayarak) .çevir en tr");
      }
      const src = parts[0];
      const dst = parts[1];
      let text = parts.slice(2).join(" ").trim();
      if (!text) {
        const replied =
          message.reply_message?.text ||
          message.reply_message?.caption ||
          message.reply_message?.conversation;
        if (replied) text = replied.trim();
      }
      if (!text) {
        return await message.sendReply("❌ Çevrilecek metin bulunamadı!");
      }

      const { data } = await axios.get("https://api.mymemory.translated.net/get", {
        params: {
          q: text,
          langpair: `${src}|${dst}`,
        },
      });
      const translated = data?.responseData?.translatedText;
      if (!translated) {
        return await message.sendReply("❌ Çeviri alınamadı.");
      }
      return await message.sendReply(`🌍 *Çeviri (${src} → ${dst})*\n\n${translated}`);
    } catch (err) {
      return await message.sendReply("❌ Hata oluştu.");
    }
  }
);

// ══════════════════════════════════════════════════════════
// AVENGERS — Avengers stili logo (2 kelime)
// ══════════════════════════════════════════════════════════
Module({
  pattern: "avengers ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni Avengers stili bir logoya dönüştürür. (2 kelime gerektirir)",
  usage: ".avengers LADES BOT",
  use: "düzenleme",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const words = input.split(/\s+/);
    if (words.length < 2) return await message.sendReply("🦸 _İki kelime girin:_ `.avengers LADES BOT`");
    try {
      const buf = await nexGet(`/textpro/avengers?text1=${encodeURIComponent(words[0])}&text2=${encodeURIComponent(words.slice(1).join(" "))}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🦸` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// BEAR — Ayı efekti
// ══════════════════════════════════════════════════════════
Module({
  pattern: "bear ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni ayı efektiyle görsele dönüştürür.",
  usage: ".bear LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("🐻 _Metin girin:_ `.bear LADES`");
    try {
      const buf = await nexGet(`/textpro/bear?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🐻` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// CARTOON GRAFFITI — Cartoon graffiti efekti
// ══════════════════════════════════════════════════════════
Module({
  pattern: "cartoon ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni cartoon graffiti stili görsele dönüştürür.",
  usage: ".cartoon LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("🎨 _Metin girin:_ `.cartoon LADES`");
    try {
      const buf = await nexGet(`/textpro/cartoon-graffiti?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🎨` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// COMIC — Comic stili metin
// ══════════════════════════════════════════════════════════
Module({
  pattern: "comic ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni comic stili görsele dönüştürür.",
  usage: ".comic LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("📖 _Metin girin:_ `.comic LADES`");
    try {
      const buf = await nexGet(`/textpro/comic?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `📖` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// DEVIL WINGS — Şeytan kanadı efekti
// ══════════════════════════════════════════════════════════
Module({
  pattern: "devil ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni şeytan kanadı stili görsele dönüştürür.",
  usage: ".devil LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("😈 _Metin girin:_ `.devil LADES`");
    try {
      const buf = await nexGet(`/textpro/devil-wings?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `😈` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// DRAGON BALL — Dragon Ball stili metin
// ══════════════════════════════════════════════════════════
Module({
  pattern: "dragonball ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni Dragon Ball stili görsele dönüştürür.",
  usage: ".dragonball LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("🐉 _Metin girin:_ `.dragonball LADES`");
    try {
      const buf = await nexGet(`/textpro/dragonball?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🐉` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// FOGGY GLASS — Buğulu cam efekti
// ══════════════════════════════════════════════════════════
Module({
  pattern: "foggy ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni buğulu cam efektiyle görsele dönüştürür.",
  usage: ".foggy LADES [background] | bear, cat, flower, heart, sad, smile",
  use: "düzenleme",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const parts = input.split(/\s+/);
    const text = parts[0];
    const bg = parts.slice(1).join(" ");
    if (!text) return await message.sendReply("🌫️ _Metin girin:_ `.foggy LADES`");
    try {
      const buf = await nexGet(`/textpro/foggy-glass?text=${encodeURIComponent(text)}&background=${encodeURIComponent(bg || "flower")}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🌫️` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// GRAFFITI V1 — Graffiti v1 stili (2 kelime)
// ══════════════════════════════════════════════════════════
Module({
  pattern: "graffiti ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni graffiti stili görsele dönüştürür.",
  usage: ".graffiti LADES HUB",
  use: "düzenleme",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const words = input.split(/\s+/);
    if (words.length < 2) return await message.sendReply("🎨 _İki kelime girin:_ `.graffiti LADES BOT`");
    try {
      const buf = await nexGet(`/textpro/v1/graffiti?text1=${encodeURIComponent(words[0])}&text2=${encodeURIComponent(words.slice(1).join(" "))}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🎨` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// GRAFFITI V5 — Graffiti v5 stili
// ══════════════════════════════════════════════════════════
Module({
  pattern: "grafiti5 ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni graffiti v5 stili görsele dönüştürür.",
  usage: ".grafiti5 LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("🎨 _Metin girin:_ `.grafiti5 LADES`");
    try {
      const buf = await nexGet(`/textpro/v5/graffiti?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🎨` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// MASCOT — Maskot avatar (2 kelime + style)
// ══════════════════════════════════════════════════════════
Module({
  pattern: "mascot ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni maskot avatar stili görsele dönüştürür.",
  usage: ".mascot LADES [style] | wolf, dragon, tiger, ninja-cat, demon...",
  use: "düzenleme",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const parts = input.split(/\s+/);
    if (parts.length < 2) return await message.sendReply("🦁 _En az iki kelime girin:_ `.mascot LADES wolf`");
    const text1 = parts[0];
    const text2 = parts.slice(1, -1).join(" ") || parts[1];
    const style = parts.slice(-1)[0] || "wolf";
    try {
      const buf = await nexGet(`/textpro/mascot?text1=${encodeURIComponent(text1)}&text2=${encodeURIComponent(text2)}&style=${encodeURIComponent(style)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🦁` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// PAINTING — Painting stili (2 kelime)
// ══════════════════════════════════════════════════════════
Module({
  pattern: "painting ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni painting stili görsele dönüştürür.",
  usage: ".painting LADES BOT",
  use: "düzenleme",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const words = input.split(/\s+/);
    if (words.length < 2) return await message.sendReply("🎨 _İki kelime girin:_ `.painting LADES BOT`");
    try {
      const buf = await nexGet(`/textpro/painting?text1=${encodeURIComponent(words[0])}&text2=${encodeURIComponent(words.slice(1).join(" "))}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🎨` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// PAVEMENT — Pavement stili
// ══════════════════════════════════════════════════════════
Module({
  pattern: "pavement ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni pavement stili görsele dönüştürür.",
  usage: ".pavement LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("🛣️ _Metin girin:_ `.pavement LADES`");
    try {
      const buf = await nexGet(`/textpro/pavement?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🛣️` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// PIXEL GLITCH — Pixel glitch efekti
// ══════════════════════════════════════════════════════════
Module({
  pattern: "pixel ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni pixel glitch stili görsele dönüştürür.",
  usage: ".pixel LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("👾 _Metin girin:_ `.pixel LADES`");
    try {
      const buf = await nexGet(`/textpro/pixel-glitch?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `👾` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// TYPOGRAPHY — Typography stili
// ══════════════════════════════════════════════════════════
Module({
  pattern: "typography ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni typography stili görsele dönüştürür.",
  usage: ".typography LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("🔤 _Metin girin:_ `.typography LADES`");
    try {
      const buf = await nexGet(`/textpro/typography?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🔤` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// WET GLASS — Islak cam efekti
// ══════════════════════════════════════════════════════════
Module({
  pattern: "wetglass ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni ıslak cam stili görsele dönüştürür.",
  usage: ".wetglass LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("💧 _Metin girin:_ `.wetglass LADES`");
    try {
      const buf = await nexGet(`/textpro/wetglass?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `💧` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// WOLF GALAXY — Kurt galaksi (2 kelime)
// ══════════════════════════════════════════════════════════
Module({
  pattern: "wolf ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni kurt galaksi stili görsele dönüştürür.",
  usage: ".wolf LADES BOT",
  use: "düzenleme",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const words = input.split(/\s+/);
    if (words.length < 2) return await message.sendReply("🐺 _İki kelime girin:_ `.wolf LADES BOT`");
    try {
      const buf = await nexGet(`/textpro/wolf-galaxy?text1=${encodeURIComponent(words[0])}&text2=${encodeURIComponent(words.slice(1).join(" "))}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `🐺` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// WRITE GRAFFITI — Yazı grafiti efekti
// ══════════════════════════════════════════════════════════
Module({
  pattern: "writegraffiti ?(.*)",
  fromMe: false,
  desc: "Yazdığınız metni yazı grafiti stili görsele dönüştürür.",
  usage: ".writegraffiti LADES",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("✍️ _Metin girin:_ `.writegraffiti LADES`");
    try {
      const buf = await nexGet(`/textpro/write-graffiti?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { image: buf, caption: `✍️` }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel oluşturulamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// BLUEFACE — Mavi plan tarzı görsel
// ══════════════════════════════════════════════════════════
Module({
  pattern: "maviyüz ?(.*)",
  fromMe: false,
  desc: "Verilen fotoğrafı mavi plan tarzında işler.",
  usage: ".maviyüz [fotoğraf bağlantısı]",
  use: "düzenleme",
},
  async (message, match) => {
    let url = (match[1] || "").trim();
    if (!url && message.reply_message?.image) {
      url = "reply";
    }
    if (!url && message.reply_message?.text) {
      const m = message.reply_message.text.match(/https?:\/\/\S+/);
      if (m) url = m[0];
    }
    if (!url) return await message.sendReply("🟦 _Fotoğraf bağlantısı girin veya bir fotoğrafı yanıtlayın:_ `.maviyüz <bağlantı>`");
    if (!url) return await message.sendReply("🆙 _Fotoğraf bağlantısı girin veya bir fotoğrafı yanıtlayın:_ `.remini <bağlantı>`");
    if (!url) return await message.sendReply("🎵 _Müzik bağlantısı girin veya bir ses dosyasını yanıtlayın:_ `.vokalsil <bağlantı>`");
    if (!url) return await message.sendReply("📤 _Görsel bağlantısı girin veya bir fotoğrafı yanıtlayın:_ `.tgçıkartma <bağlantı>`");
    if (!url) return await message.sendReply("🔍 _Fotoğraf bağlantısı girin veya bir fotoğrafı yanıtlayın:_ `.netleştir <bağlantı>`");
    if (!url) return await message.sendReply("🎵 _Ses/video bağlantısı girin veya bir medyayı yanıtlayın:_ `.whatmusic <bağlantı>`");

    try {
      let mediaUrl = url;
      let sentMsg;
      if (url === "reply_audio" && message.reply_message?.audio) {
        const media = await message.client.downloadMediaMessage(message.reply_message.message);
        if (media) {
          const tempPath = getTempPath(".mp3");
          await saveToDisk(media, tempPath);
          sentMsg = await message.sendReply("📤 _Ses dosyasını indiriyorum..._");
          mediaUrl = await uploadMedia(tempPath, "audio");
          cleanTempFile(tempPath);
        }
      } else if (url === "reply_video" && message.reply_message?.video) {
        const media = await message.client.downloadMediaMessage(message.reply_message.message);
        if (media) {
          const tempPath = getTempPath(".mp4");
          await saveToDisk(media, tempPath);
          sentMsg = await message.sendReply("📤 _Video dosyasını indiriyorum..._");
          mediaUrl = await uploadMedia(tempPath, "video");
          cleanTempFile(tempPath);
        }
      }

      if (!sentMsg) sentMsg = await message.sendReply("🎵 _Müziği tanıyorum..._");
      else await message.edit("🎵 _Müziği dinliyorum..._", message.jid, sentMsg.key);
      const result = await nexGet(`/tools/whatsmusic?url=${encodeURIComponent(mediaUrl)}`, { timeout: 60000 });
      await message.edit("✅ _Müzik bulundu!_", message.jid, sentMsg.key);

      if (result) {
        const info = typeof result === "string" ? result :
          `🎵 *Müzik Bilgisi*\n\n` +
          (result.title ? `🎤 Şarkı: ${result.title}\n` : "") +
          (result.artist ? `👤 Sanatçı: ${result.artist}\n` : "") +
          (result.album ? `💿 Albüm: ${result.album}\n` : "") +
          (result.year ? `📅 Yıl: ${result.year}\n` : "");
        await message.sendReply(info);
      } else {
        await message.sendReply("❌ _Müzik bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Müzik tanınamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// YTTRANSCRIBE — YouTube video transkript
// ══════════════════════════════════════════════════════════
Module({
  pattern: "ytaltyazı ?(.*)",
  fromMe: false,
  desc: "YouTube videonun transkriptini getirir.",
  usage: ".ytaltyazı [YouTube bağlantısı]",
  use: "indirme",
},
  async (message, match) => {
    let url = (match[1] || "").trim();
    if (!url && message.reply_message?.text) {
      const m = message.reply_message.text.match(/(youtube\.com|youtu\.be)\/\S+/);
      if (m) url = m[0];
    }
    if (!url) return await message.sendReply("📝 _YouTube bağlantısı girin:_ `.ytt https://youtube.com/watch?v=...`");
    if (!url.startsWith("http")) url = "https://" + url;

    try {
      const sent = await message.sendReply("📝 _Transkript alınıyor..._");
      const result = await nexGet(`/tools/yt-transcribe?url=${encodeURIComponent(url)}`, { timeout: 90000 });
      await message.edit("✅ _Transkript alındı!_", message.jid, sent.key);

      if (result?.transcript) {
        const transcript = result.transcript.length > 3000 ?
          result.transcript.substring(0, 3000) + "\n..." :
          result.transcript;
        await message.sendReply(`📝 *Transkript*\n\n${transcript}`);
      } else if (typeof result === "string") {
        await message.sendReply(result);
      } else {
        await message.sendReply("❌ _Transkript bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Transkript alınamadı:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// FREEFIRE — Free Fire oyuncu sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "freefire ?(.*)",
  fromMe: false,
  desc: "Free Fire oyuncusunun bilgilerini gösterir.",
  usage: ".freefire [oyuncul numarası]",
  use: "oyun",
},
  async (message, match) => {
    const uid = (match[1] || "").trim();
    if (!uid) return await message.sendReply("🎮 _Free Fire oyuncu numarası girin:_ `.freefire 1234567890`");

    try {
      const result = await nexGet(`/stalker/freefire?uid=${encodeURIComponent(uid)}`);
      if (result) {
        const info = typeof result === "string" ? result :
          `🎮 *Free Fire Bilgileri*\n\n` +
          (result.nickname ? `📛 Nick: ${result.nickname}\n` : "") +
          (result.level ? `⭐ Seviye: ${result.level}\n` : "") +
          (result.rank ? `🏆 Rank: ${result.rank}\n` : "") +
          (result.clan ? `👥 Clan: ${result.clan}\n` : "") +
          (result.uid ? `🆔 UID: ${result.uid}\n` : "");
        await message.sendReply(info || JSON.stringify(result));
      } else {
        await message.sendReply("❌ _Oyuncu bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Sorgu başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// GITHUB — GitHub kullanıcı sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "github ?(.*)",
  fromMe: false,
  desc: "GitHub kullanıcısının profil bilgilerini gösterir.",
  usage: ".github [kullanıcı adı]",
  use: "araçlar",
},
  async (message, match) => {
    const username = (match[1] || "").trim();
    if (!username) return await message.sendReply("🐙 _GitHub kullanıcı adı girin:_ `.github mrbeast`");

    try {
      const result = await nexGet(`/stalker/github?username=${encodeURIComponent(username)}`);
      if (result) {
        const info = typeof result === "string" ? result :
          `🐙 *GitHub Profili*\n\n` +
          (result.login ? `👤 Kullanıcı: ${result.login}\n` : "") +
          (result.name ? `📛 İsim: ${result.name}\n` : "") +
          (result.bio ? `📝 Bio: ${result.bio}\n` : "") +
          (result.public_repos ? `📚 Repolar: ${result.public_repos}\n` : "") +
          (result.followers ? `👥 Takipçi: ${result.followers}\n` : "") +
          (result.following ? `📥 Takip: ${result.following}\n` : "") +
          (result.html_url ? `🔗 ${result.html_url}\n` : "");
        await message.sendReply(info || JSON.stringify(result));
      } else {
        await message.sendReply("❌ _Kullanıcı bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Sorgu başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// MLBB — Mobile Legends oyuncu sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "mlbb ?(.*)",
  fromMe: false,
  desc: "Mobile Legends oyuncusunun bilgilerini gösterir.",
  usage: ".mlbb [oyuncul ID] [zone ID]",
  use: "oyun",
},
  async (message, match) => {
    const input = (match[1] || "").trim();
    const parts = input.split(/\s+/);
    const id = parts[0];
    const zone = parts[1] || "12230";

    if (!id) return await message.sendReply("🎮 _Mobile Legends ID ve zone girin:_ `.mlbb 807663005 12230`");

    try {
      const result = await nexGet(`/stalker/mlbb?id=${encodeURIComponent(id)}&zone=${encodeURIComponent(zone)}`);
      if (result) {
        const info = typeof result === "string" ? result :
          `🎮 *Mobile Legends Bilgileri*\n\n` +
          (result.nickname ? `📛 Nick: ${result.nickname}\n` : "") +
          (result.level ? `⭐ Seviye: ${result.level}\n` : "") +
          (result.rank ? `🏆 Rank: ${result.rank}\n` : "") +
          (result.hero ? `🦸 Ana Hero: ${result.hero}\n` : "") +
          (result.id ? `🆔 ID: ${result.id}\n` : "");
        await message.sendReply(info || JSON.stringify(result));
      } else {
        await message.sendReply("❌ _Oyuncu bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Sorgu başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// PINTEREST — Pinterest kullanıcı sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "pinterest ?(.*)",
  fromMe: false,
  desc: "Pinterest kullanıcısının profil bilgilerini gösterir.",
  usage: ".pinterest [kullanıcı adı]",
  use: "araçlar",
},
  async (message, match) => {
    const username = (match[1] || "").trim();
    if (!username) return await message.sendReply("📌 _Pinterest kullanıcı adı girin:_ `.pinterest veritasium`");

    try {
      const result = await nexGet(`/stalker/pinterest?username=${encodeURIComponent(username)}`);
      if (result) {
        const info = typeof result === "string" ? result :
          `📌 *Pinterest Profili*\n\n` +
          (result.username ? `👤 Kullanıcı: ${result.username}\n` : "") +
          (result.name ? `📛 İsim: ${result.name}\n` : "") +
          (result.bio ? `📝 Bio: ${result.bio}\n` : "") +
          (result.followers ? `👥 Takipçi: ${result.followers}\n` : "") +
          (result.following ? `📥 Takip: ${result.following}\n` : "") +
          (result.pins ? `📌 Pin sayısı: ${result.pins}\n` : "") +
          (result.profile_url ? `🔗 ${result.profile_url}\n` : "");
        await message.sendReply(info || JSON.stringify(result));
      } else {
        await message.sendReply("❌ _Kullanıcı bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Sorgu başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// ROBLOX — Roblox kullanıcı sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "roblox ?(.*)",
  fromMe: false,
  desc: "Roblox kullanıcısının profil bilgilerini gösterir.",
  usage: ".roblox [kullanıcı adı]",
  use: "oyun",
},
  async (message, match) => {
    const username = (match[1] || "").trim();
    if (!username) return await message.sendReply("🧸 _Roblox kullanıcı adı girin:_ `.roblox Builderman`");

    try {
      const result = await nexGet(`/stalker/roblox?username=${encodeURIComponent(username)}`);
      if (result) {
        const info = typeof result === "string" ? result :
          `🧸 *Roblox Profili*\n\n` +
          (result.username ? `👤 Kullanıcı: ${result.username}\n` : "") +
          (result.displayname ? `📛 Görünen İsim: ${result.displayname}\n` : "") +
          (result.description ? `📝 Açıklama: ${result.description}\n` : "") +
          (result.bio ? `📝 Bio: ${result.bio}\n` : "") +
          (result.created ? `📅 Oluşturulma: ${result.created}\n` : "") +
          (result.isBanned ? `⚠️ Banlı: ${result.isBanned}\n` : "") +
          (result.followerCount ? `👥 Takipçi: ${result.followerCount}\n` : "") +
          (result.followingCount ? `📥 Takip: ${result.followingCount}\n` : "") +
          (result.profileUrl ? `🔗 ${result.profileUrl}\n` : "");
        await message.sendReply(info || JSON.stringify(result));
      } else {
        await message.sendReply("❌ _Kullanıcı bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Sorgu başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// THREADS — Threads kullanıcı sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "thara ?(.*)",
  fromMe: false,
  desc: "Threads kullanıcısının profil bilgilerini gösterir.",
  usage: ".thara [kullanıcı adı]",
  use: "araçlar",
},
  async (message, match) => {
    const username = (match[1] || "").trim();
    if (!username) return await message.sendReply("🧵 _Threads kullanıcı adı girin:_ `.threadsuser zuck`");

    try {
      const result = await nexGet(`/stalker/threads?username=${encodeURIComponent(username)}`);
      if (result) {
        const info = typeof result === "string" ? result :
          `🧵 *Threads Profili*\n\n` +
          (result.username ? `👤 Kullanıcı: ${result.username}\n` : "") +
          (result.name ? `📛 İsim: ${result.name}\n` : "") +
          (result.bio ? `📝 Bio: ${result.bio}\n` : "") +
          (result.followers ? `👥 Takipçi: ${result.followers}\n` : "") +
          (result.following ? `📥 Takip: ${result.following}\n` : "") +
          (result.posts ? `📝 Gönderi: ${result.posts}\n` : "") +
          (result.profile_pic_url ? `🔗 [Profil Fotoğrafı](${result.profile_pic_url})\n` : "");
        await message.sendReply(info || JSON.stringify(result));
      } else {
        await message.sendReply("❌ _Kullanıcı bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Sorgu başarısız:_ ${e.message}`);
    }
  }
);

// ══════════════════════════════════════════════════════════
// YOUTUBE — YouTube kanal sorgulama
// ══════════════════════════════════════════════════════════
Module({
  pattern: "ytkanal ?(.*)",
  fromMe: false,
  desc: "YouTube kanalının bilgilerini gösterir.",
  usage: ".ytkanal [kanal adı veya kullanıcı adı]",
  use: "araçlar",
},
  async (message, match) => {
    const username = (match[1] || "").trim();
    if (!username) return await message.sendReply("📺 _YouTube kanal adı girin:_ `.youtubekanal mrbeast`");

    try {
      const result = await nexGet(`/stalker/youtube?username=${encodeURIComponent(username)}`);
      if (result) {
        const info = typeof result === "string" ? result :
          `📺 *YouTube Kanalı*\n\n` +
          (result.title ? `📛 Kanal: ${result.title}\n` : "") +
          (result.description ? `📝 Açıklama: ${result.description}\n` : "") +
          (result.subscribers ? `👥 Abone: ${result.subscribers}\n` : "") +
          (result.views ? `👁️ İzlenme: ${result.views}\n` : "") +
          (result.videos ? `🎬 Video: ${result.videos}\n` : "") +
          (result.country ? `🌍 Ülke: ${result.country}\n` : "") +
          (result.channelId ? `🆔 ID: ${result.channelId}\n` : "") +
          (result.customUrl ? `🔗 @${result.customUrl}\n` : "") +
          (result.thumbnail ? `🖼️ [Banner](${result.thumbnail})\n` : "");
        await message.sendReply(info || JSON.stringify(result));
      } else {
        await message.sendReply("❌ _Kanal bulunamadı_");
      }
    } catch (e) {
      await message.sendReply(`❌ _Sorgu başarısız:_ ${e.message}`);
    }
  }
);

