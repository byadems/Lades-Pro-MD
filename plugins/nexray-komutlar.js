const { Module } = require("../main");
const axios = require("axios");
const config = require("../config");
const { CircuitBreaker } = require("./utils/resilience");
const nexray = require("./utils/nexray");
const { saveToDisk, getTempPath, cleanTempFile, isMediaImage } = require("../core/helpers");

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
      await message.client.sendMessage(message.jid, { sticker: buf }, { quoted: message.data });
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
      await message.client.sendMessage(message.jid, { image: buf, caption: `✨ *${text}*` }, { quoted: message.data });
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
      await message.client.sendMessage(message.jid, { image: buf, caption: `🍥 *${text}*` }, { quoted: message.data });
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
      await message.client.sendMessage(message.jid, { image: buf, caption: `🦸 *${input}*` }, { quoted: message.data });
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
      await message.client.sendMessage(message.jid, { image: buf, caption: `💗 *${text}*` }, { quoted: message.data });
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
  usage: ".brat Lades Bot",
  use: "düzenleme",
},
  async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("💚 _Metin girin:_ `.brat lades bot`");
    try {
const buf = await nexGet(`/maker/brat?text=${encodeURIComponent(text)}`, { buffer: true });
      await message.client.sendMessage(message.jid, { sticker: buf }, { quoted: message.data });
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
      if (!imgUrl) throw new Error("Görsel URL bulunamadı");
      await message.client.sendMessage(message.jid, {
        image: { url: imgUrl },
        caption: `🖼️ *${pick.description || pick.author || query}*`,
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
      await message.client.sendMessage(message.jid, { sticker: buf }, { quoted: message.reply_message || message.data });
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
        caption: `🎨 *AI Görsel*\n\n💭 _${prompt}_`,
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
      return await message.sendReply("🧵 _Threads bağlantısı girin:_ `.threads <url>`");
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
      return await message.sendReply("🎧 _SoundCloud bağlantısı girin:_ `.soundcloud <url>`");
    }
    let statusMsg;
    try {
      statusMsg = await message.sendReply("_⬇️ SoundCloud'dan indiriliyor..._");
      // Yeni nexray modülü ile (Nexray + Siputzx + nxTry fallback zinciri)
      const result = await nexray.downloadSoundCloud(url);
      if (!result?.url) throw new Error("Ses URL bulunamadı");

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

