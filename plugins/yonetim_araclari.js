const { badWords: globalBadWords, containsBadWord, BAD_WORD_REGEX, containsDisallowedWords } = require("./utils/index");

/**
 * Metindeki yasaklı kelimeyi bulur ve döndürür.
 * @param {string} str - Kontrol edilecek metin
 * @param {string[]} disallowedWords - Özel yasaklı kelimeler listesi (isteğe bağlı)
 * @returns {string|null} Bulunan kelime veya null
 */
function findDisallowedWord(str, disallowedWords) {
  if (!str) return null;

  // Eğer özel bir liste verilmişse onu kullan, yoksa global listeyi/regex'i kullan
  if (disallowedWords && Array.isArray(disallowedWords) && disallowedWords.length > 0) {
    const escaped = disallowedWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const customRegex = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
    const match = str.match(customRegex);
    return match ? match[0] : null;
  }

  const match = str.match(BAD_WORD_REGEX);
  return match ? match[0] : null;
}

function checkLinks(links, allowedWords) {
  let testArray = [];
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    let isAllowed = true;
    for (let j = 0; j < allowedWords.length; j++) {
      const allowedWord = allowedWords[j];
      if (link.includes(allowedWord)) {
        isAllowed = true;
        break;
      }
      isAllowed = false;
    }
    testArray.push(isAllowed);
  }
  return testArray.includes(false);
}
const { Module } = require("../main");
const {
  antilinkConfig,
  antiword,
  antifake,
  antibot,
  antispam,
  antipromote,
  antidemote,
  antipdm,
  antidelete,
  uyariEkle,
  uyariGetir,
  linkDetector,
  censorBadWords,
  isAdmin,
} = require("./utils");
const config = require("../config");
const { settingsMenu, ADMIN_ACCESS } = config;
const fs = require("fs");
const { BotVariable } = require("../core/database");

const handler = config.HANDLER_PREFIX;

let _antiwordJidsCache = null;
let _antiwordCacheTime = 0;
let _antilinkCache = new Map();
let _antilinkCacheTime = 0;
const MANAGE_CACHE_TTL = 60000;

async function getCachedAntiwordJids() {
  if (_antiwordJidsCache && Date.now() - _antiwordCacheTime < MANAGE_CACHE_TTL) {
    return _antiwordJidsCache;
  }
  const db = await antiword.get();
  _antiwordJidsCache = new Set(db.map((d) => d.jid));
  _antiwordCacheTime = Date.now();
  return _antiwordJidsCache;
}

async function getCachedAntilinkConfig(jid) {
  if (_antilinkCache.has(jid) && Date.now() - _antilinkCacheTime < MANAGE_CACHE_TTL) {
    return _antilinkCache.get(jid);
  }
  const conf = await antilinkConfig.get(jid);
  _antilinkCache.set(jid, conf);
  _antilinkCacheTime = Date.now();
  return conf;
}

function invalidateManageCache() {
  _antiwordJidsCache = null;
  _antilinkCache.clear();
}

async function setVar(key, value, message = false) {
  await BotVariable.upsert({
    key: key.trim(),
    value: value,
  });
  config[key.trim()] = value;
  if (message) {
    await message.sendReply(`✅ *${key.trim()} başarıyla '${value}' olarak ayarlandı!*`);
  }
  return true;
}

async function delVar(key, message = false) {
  await BotVariable.destroy({ where: { key: key.trim() } });
  delete config[key.trim()];
  if (message) {
    await message.sendReply(`✅ *${key.trim()} başarıyla silindi!*`);
  }
  return true;
}
Module({
  pattern: "setvar ?(.*)",
  fromMe: true,
  desc: "Botun çalışma dinamiklerini değiştiren teknik değişkenleri (Database) uzaktan tanımlar.",
  usage: ".setvar [key=value]",
  dontAddCommandList: true,
},
  async (message, args) => {
    const input = args[1];
    if (!input || !input.includes("=")) {
      return await message.sendReply("❌ *Geçersiz format. Kullanım: .setvar ANAHTAR=DEGER*"
      );
    }

    const [key, ...valueParts] = input.split("=");
    const value = censorBadWords(valueParts.join("=").trim());

    if (key.trim().toUpperCase() === "SUDO") {
      return await message.sendReply("ℹ️ _Artık setvar ile yetki verilmemektedir, .setsudo komutunu kullanın_"
      );
    }

    try {
      await setVar(key.trim(), value, message);
    } catch (error) {
      await message.sendReply(
        `❌ *'${key.trim()}' değişkeni ayarlanamadı.*\n⚠️ *Hata:* \`${error.message}\``
      );
    }
  }
);

Module({
  pattern: "değişkengetir ?(.*)",
  fromMe: true,
  desc: "Veritabanında kayıtlı olan belirli bir değişkenin güncel değerini sorgular.",
  usage: ".değişkengetir [key]",
  use: "sistem",
},
  async (message, args) => {
    const key = args[1]?.trim();
    if (!key) {
      return await message.sendReply("⚠️ *Lütfen değişken adını girin. Kullanım: .getvar DEGISKEN*"
      );
    }

    const variable = config[key];
    if (variable) {
      await message.sendReply(`ℹ️ _Değişken '${key}':_ *${variable}*`);
    } else {
      await message.sendReply(`❌ *Değişken '${key}' bulunamadı!*`);
    }
  }
);

Module({
  pattern: "değişkensil ?(.*)",
  fromMe: true,
  desc: "Veritabanında kayıtlı olan bir değişkeni sistemden kalıcı olarak temizler.",
  usage: ".değişkensil [key]",
  use: "sistem",
},
  async (message, args) => {
    const key = args[1]?.trim();
    if (!key) {
      return await message.sendReply("⚠️ *Lütfen değişken adını girin. Kullanım: .delvar DEGISKEN*"
      );
    }
    try {
      if (config[key] === undefined) {
        return await message.sendReply(`❌ *Değişken '${key}' bulunamadı!*`);
      }
      await delVar(key.trim(), message);
    } catch (error) {
      await message.sendReply(
        `❌ *'${key.trim()}' değişkeni silinemedi.*\n⚠️ *Hata:* \`${error.message}\``
      );
    }
  }
);

Module({
  pattern: "setenv ?(.*)",
  fromMe: true,
  desc: "Ana yapılandırma dosyasındaki (config.env) ortam değişkenlerini doğrudan günceller.",
  usage: ".setenv [key=value]",
  dontAddCommandList: true,
},
  async (message, args) => {
    const input = args[1];
    if (!input || !input.includes("=")) {
      return await message.sendReply("❌ *Geçersiz format. Kullanım: .setenv ANAHTAR=DEGER*"
      );
    }

    const [key, ...valueParts] = input.split("=");
    const value = censorBadWords(valueParts.join("=").trim());
    const trimmedKey = key.trim();

    try {
      if (!fs.existsSync("./config.env")) {
        return await message.sendReply("⚙️ *Değişken ayarları konteynerlerde desteklenmiyor. .setvar komutunu kullanın.*"
        );
      }

      let envContent = fs.readFileSync("./config.env", "utf8");
      const lines = envContent.split("\n");

      let found = false;
      const updatedLines = lines.map((line) => {
        if (line.trim().startsWith(`${trimmedKey}=`)) {
          found = true;
          return `${trimmedKey}=${value}`;
        }
        return line;
      });

      if (!found) {
        updatedLines.push(`${trimmedKey}=${value}`);
      }

      fs.writeFileSync("./config.env", updatedLines.join("\n"));

      await message.sendReply(
        `✅ *Ortam değişkeni '${trimmedKey}' config.env'de '${value}' olarak ayarlandı!*\n\nℹ️ _Not: Değişikliklerin geçerli olması için yeniden başlatma gereklidir._`
      );
    } catch (error) {
      await message.sendReply(
        `_'${trimmedKey}' ortam değişkeni ayarlanamadı. Hata: ${error.message}_`
      );
    }
  }
);

Module({
  pattern: "değişkenler",
  fromMe: true,
  desc: "Veritabanında kayıtlı olan tüm özel değişkenleri ve değerleri liste halinde sunar.",
  usage: ".değişkenler",
  use: "sistem",
},
  async (message, match) => {
    try {
      const variables = await BotVariable.findAll();
      let msg = "📋 *Tüm Bot Değişkenleri:*\n\n";
      for (const v of variables) {
        msg += `*${v.key}*: ${v.value}\n`;
      }
      if (!variables.length) {
        msg += "ℹ️ _Henüz bir değişken ayarlanmamış._";
      }

      await message.sendReply(msg);
    } catch (error) {
      await message.sendReply(
        `_Değişkenler alınamadı. Hata: ${error.message}_`
      );
    }
  }
);

Module({
  pattern: "platform",
  fromMe: true,
  desc: "Botun üzerinde çalıştığı sunucu altyapısı, işletim sistemi ve sürüm bilgilerini görüntüler.",
  usage: ".platform",
  use: "sistem",
},
  async (message, match) => {
    return await message.sendReply(`🤖 _Bot *${config.PLATFORM}* üzerinde çalışıyor_`);
  }
);

Module({
  pattern: "dil ?(.*)",
  fromMe: true,
  desc: "Botun belirli komutlarda kullandığı varsayılan dil seçeneğini değiştirir.",
  usage: ".dil [tr]",
  use: "sistem",
},
  async (message, match) => {
    if (!match[1]?.trim() || !["türkçe", "tr"].includes(match[1].toLowerCase()))
      return await message.sendReply("❌ *Geçersiz dil! Mevcut diller: Türkçe, TR*"
      );
    return await setVar("LANGUAGE", match[1].toLowerCase(), message);
  }
);

// Ayarlar menüsündeki özellikler — sıra ve anahtar isimleri sabit kalmalı
const GRUP_AYARLARI = [
  {
    key: "antispam",
    title: "Anti-Spam",
    desc: "Hızlı mesaj atanları otomatik gruptan atar",
    icon: "🚨",
    getStatus: async (jid) => {
      const db = await antispam.get();
      return db.some(d => d.jid === jid);
    },
    toggle: async (jid, enable, message) => {
      if (enable) {
        if (!message.isBotAdmin) return message.sendReply("🙁 *Botu önce yönetici yapın!*");
        await antispam.set(jid);
        return message.sendReply("✅ *Anti-Spam açıldı!*");
      }
      await antispam.delete(jid);
      return message.sendReply("❌ *Anti-Spam kapatıldı!*");
    }
  },
  {
    key: "antisilme",
    title: "Anti-Silme",
    desc: "Silinen mesajları yakalar ve iletir",
    icon: "🗑️",
    getStatus: async (jid) => {
      const db = await antidelete.get();
      return db.some(d => d.jid === jid);
    },
    toggle: async (jid, enable, message) => {
      if (enable) {
        await antidelete.set(jid);
        await setVar(`ANTI_DELETE_MODE_${jid}`, "chat");
        return message.sendReply("✅ *Anti-Silme açıldı!*\n\nℹ️ _Kurtarılan mesajlar bu sohbete gönderilecek._");
      }
      await antidelete.delete(jid);
      await setVar(`ANTI_DELETE_MODE_${jid}`, "off");
      return message.sendReply("❌ *Anti-Silme kapatıldı!*");
    }
  },
  {
    key: "antibaglantilink",
    title: "Anti-Bağlantı",
    desc: "Grup içi link paylaşımını engeller",
    icon: "🔗",
    getStatus: async (jid) => {
      const conf = await antilinkConfig.get(jid);
      return !!(conf && conf.enabled);
    },
    toggle: async (jid, enable, message) => {
      if (enable) {
        if (!message.isBotAdmin) return message.sendReply("🙁 *Botu önce yönetici yapın!*");
        const existing = await antilinkConfig.get(jid);
        if (!existing || !existing.jid) {
          await antilinkConfig.set(jid, { mode: "delete", enabled: true, updatedBy: message.sender });
        } else {
          await antilinkConfig.update(jid, { enabled: true, updatedBy: message.sender });
        }
        return message.sendReply("✅ *Anti-Bağlantı açıldı!* (Mod: SİL)\n\n💡 _Detaylı ayar için_ `.antibağlantı yardım` _kullanın._");
      }
      const existing = await antilinkConfig.get(jid);
      if (existing && existing.jid) {
        await antilinkConfig.update(jid, { enabled: false, updatedBy: message.sender });
      }
      invalidateManageCache();
      return message.sendReply("❌ *Anti-Bağlantı kapatıldı!*");
    }
  },
  {
    key: "antikelime",
    title: "Anti-Kelime",
    desc: "Yasaklı kelime kullanımını engeller",
    icon: "🤬",
    getStatus: async (jid) => {
      const db = await antiword.get();
      const antiwordWarn = config.ANTIWORD_WARN?.split(",") || [];
      const kickMode = db.some(d => d.jid === jid);
      const warnMode = antiwordWarn.includes(jid);
      if (kickMode) return "at";
      if (warnMode) return "uyar";
      return false;
    },
    toggle: async (jid, enable, message) => {
      if (enable) {
        if (!message.isBotAdmin) return message.sendReply("🙁 *Botu önce yönetici yapın!*");
        // Uyarı modunda aç
        const antiwordWarn = config.ANTIWORD_WARN?.split(",").filter(Boolean) || [];
        if (!antiwordWarn.includes(jid)) antiwordWarn.push(jid);
        await setVar("ANTIWORD_WARN", antiwordWarn.join(","), false);
        return message.sendReply("✅ *Anti-Kelime açıldı!* (Mod: UYAR)\n\n💡 _At moduna geçmek için_ `.antikelime at` _kullanın._");
      }
      await antiword.delete(jid);
      const antiwordWarn = config.ANTIWORD_WARN?.split(",").filter(x => x && x !== jid) || [];
      await setVar("ANTIWORD_WARN", antiwordWarn.join(",") || "null", false);
      invalidateManageCache();
      return message.sendReply("❌ *Anti-Kelime kapatıldı!*");
    }
  },
  {
    key: "antinumara",
    title: "Anti-Numara",
    desc: "Yabancı ülke numaralarını gruptan engeller",
    icon: "🌍",
    getStatus: async (jid) => {
      const db = await antifake.get();
      return db.some(d => d.jid === jid);
    },
    toggle: async (jid, enable, message) => {
      if (enable) {
        if (!message.isBotAdmin) return message.sendReply("🙁 *Botu önce yönetici yapın!*");
        await antifake.set(jid);
        return message.sendReply("✅ *Anti-Numara açıldı!*\n\nℹ️ _Varsayılan: sadece +90 kabul edilir._\n💡 _Özelleştirmek için_ `.antinumara izin 90,1` _kullanın._");
      }
      await antifake.delete(jid);
      return message.sendReply("❌ *Anti-Numara kapatıldı!*");
    }
  },
  {
    key: "otogörüldü",
    cmd: "otogoruldu",
    title: "Oto-Görüldü",
    desc: "Gelen mesajları otomatik okundu işaretler (mavi tik)",
    icon: "👁️",
    getStatus: async () => {
      const v = await BotVariable.get("AUTO_READ_ENABLED", "false");
      return v === "true";
    },
    toggle: async (jid, enable, message) => {
      await BotVariable.set("AUTO_READ_ENABLED", enable ? "true" : "false");
      return message.sendReply(
        enable
          ? "✅ *Oto-Görüldü açıldı!*\n\nℹ️ _Bottaki tüm gelen mesajlar otomatik okundu olarak işaretlenecek._"
          : "❌ *Oto-Görüldü kapatıldı!*"
      );
    }
  },
];

// Yardımcı: Durum metni üret
function statusText(val) {
  if (val === "at") return "Açık ✅ (At Modu)";
  if (val === "uyar") return "Açık ✅ (Uyarı Modu)";
  return val ? "Açık ✅" : "Kapalı ❌";
}

Module({
  pattern: "ayarlar ?(.*)",
  fromMe: false,
  desc: "Grup koruma özelliklerini yönetebileceğiniz interaktif menüyü açar.",
  usage: ".ayarlar",
  use: "grup",
},
  async (message, match) => {
    if (!message.isGroup) return message.sendReply("⚠️ *Bu komut yalnızca gruplarda kullanılabilir!*");
    const adminOk = await isAdmin(message);
    if (!message.fromOwner && !adminOk) return message.sendReply("🔒 *Bu komut yalnızca yöneticilere aittir!*");

    const jid = message.jid;

    // Ana menüyü göster — komut adları ile
    const statuses = await Promise.all(GRUP_AYARLARI.map(f => f.getStatus(jid)));
    let msg = `⚙️ *Grup Koruma Ayarları*\n\n`;
    msg += `_Aşağıdaki komutları yazarak ilgili ayarı yönetin:_\n\n`;
    GRUP_AYARLARI.forEach((feat, i) => {
      const cmdName = feat.cmd || feat.key;
      msg += `${feat.icon} \`.${cmdName}\` *${feat.title}* — ${statusText(statuses[i])}\n`;
    });
    msg += `\n💡 _Örnek: Anti-Spam'ı açmak için_ \`.antispam aç\` _yazın._`;
    return message.sendReply(msg);
  }
);

Module({
  pattern: "mod ?(.*)",
  fromMe: true,
  desc: "Botun çalışma modunu genel (public) veya özel (private) olarak değiştirir.",
  usage: ".mod [genel/özel]",
  use: "sistem",
  dontAddCommandList: true,
},
  async (message, match) => {
    const input = match[1]?.toLowerCase();
    if (input === "genel") {
      return await setVar("MODE", "public", message);
    } else if (input === "özel") {
      return await setVar("MODE", "private", message);
    } else {
      const mode = config.MODE === "public" ? "Genel" : "Özel";
      return await message.sendReply(
        `⚙️ *Mod Yöneticisi*\n\nℹ️ _Mevcut mod:_ *${mode}*\n💬 _Kullanım: \`.mod genel/özel\`_`
      );
    }
  }
);

Module({
  pattern: "antisilme ?(.*)",
  fromMe: false,
  desc: "Sohbetlerde silinen mesajları otomatik olarak yakalar ve belirlediğiniz hedefe iletir.",
  usage: ".antisilme [aç/kapat/sudo/jid]",
  use: "grup",
},
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply("⚠️ *Bu komut sadece gruplarda kullanılabilir!*");
    let adminAccesValidated = await isAdmin(message);
    if (!message.fromOwner && !adminAccesValidated) return await message.sendReply("🔒 *Bu komut yalnızca yöneticilere aittir!*");

    let target = match[1]?.trim().toLowerCase();
    if (!target) {
      const db = await antidelete.get();
      const status = db.some(d => d.jid === message.jid) ? "Açık ✅" : "Kapalı ❌";
      return await message.sendReply(
        `🚨 *Anti-Mesaj Silme Koruma*\n\n` +
        `ℹ️ *Mevcut Durum:* ${status}\n\n` +
        `📋 *Özellikler:*\n` +
        `• Silinen mesajın içeriğini kurtarır ve iletir\n` +
        `• Kimin sildiğini ve mesajın sahibini gösterir\n` +
        `• İçerik bulunamazsa yine de kim sildi bilgisini verir\n` +
        `• Mesaj türünü (fotoğraf, video, metin vb.) gösterir\n\n` +
        `💬 *Kullanım:*\n` +
        `\`.antisilme aç\` — sohbette göster\n` +
        `\`.antisilme sudo\` — ilk yöneticiye gönder\n` +
        `\`.antisilme kapat\` — kapat`
      );
    }

    target = target.toLowerCase();

    if (target === "kapat") {
      await antidelete.delete(message.jid);
      await setVar(`ANTI_DELETE_MODE_${message.jid}`, "off");
      return await message.sendReply("❌ *Mesaj silme engeli kapatıldı!*");
    } else if (target === "sohbet" || target === "aç") {
      await antidelete.set(message.jid);
      await setVar(`ANTI_DELETE_MODE_${message.jid}`, "chat");
      return await message.sendReply("✅ *Mesaj silme koruması açıldı!*\n\nℹ️ _Kurtarılan mesajlar orijinal sohbete gönderilecek_"
      );
    } else if (target === "sudo") {
      await antidelete.set(message.jid);
      await setVar(`ANTI_DELETE_MODE_${message.jid}`, "sudo");
      return await message.sendReply("✅ *Mesaj silme koruması açıldı!*\n\nℹ️ _Kurtarılan mesajlar ilk yöneticiye gönderilecek_"
      );
    } else if (target.includes("@")) {
      if (!target.match(/^\d+@(s\.whatsapp\.net|g\.us)$/)) {
        return await message.sendReply("❌ *Geçersiz JID formatı!*\n\nℹ️ _Kabul edilen formatlar:_\n- `123020340234@s.whatsapp.net` (kişisel)\n- `123020340234@g.us` (grup)"
        );
      }
      await antidelete.set(message.jid);
      await setVar(`ANTI_DELETE_MODE_${message.jid}`, "custom");
      await setVar(`ANTI_DELETE_JID_${message.jid}`, target);
      return await message.sendReply(
        `✅ *Mesaj silme engeli etkinleştirildi!*\n\nℹ️ _Kurtarılan mesajlar ${target} adresine gönderilecek_`
      );
    } else {
      return await message.sendReply(`❌ *Geçersiz seçenek!*\n\nℹ️ _Kullanım:_\n\`.antisilme aç\` - *orijinal sohbete gönderir*\n\`.antisilme sudo\` - *ilk yöneticiye gönderir*\n\`.antisilme <jid>\` - *belirtilen JID'e gönderir*\n\`.antisilme kapat\` - *mesaj silme engelini kapatır*`
      );
    }
  }
);

Module({
  pattern: "setsudo ?(.*)",
  fromMe: true,
  desc: "Belirlediğiniz bir kullanıcıya bot üzerinde tam yetkili (SUDO) yönetim izni tanımlar.",
  usage: ".setsudo [etiket/yanıt]",
  use: "sistem",
  dontAddCommandList: true,
},
  async (message, mm) => {
    const m = message;
    let targetLid;

    // determine target based on context
    if (m.isGroup) {
      // in gruplar: check mention first, then reply
      if (m.mention && m.mention.length > 0) {
        targetLid = m.mention[0];
      } else if (m.reply_message) {
        targetLid = m.reply_message.jid;
      } else {
        return await m.sendReply("⚠️ *Gruplarda yanıtlamak veya bahsetmek gerekli!*");
      }
    } else {
      // in DM: use sender
      targetLid = m.sender;
    }

    if (!targetLid) return await m.sendReply("❌ *Hedef belirlenemedi!*");

    try {
      // get current SUDO_MAP
      let sudoMap = [];
      if (config.SUDO_MAP) {
        try {
          sudoMap = JSON.parse(config.SUDO_MAP);
          if (!Array.isArray(sudoMap)) sudoMap = [];
        } catch (e) {
          sudoMap = [];
        }
      }

      // check if already sudo
      if (sudoMap.includes(targetLid)) {
        return await m.sendReply("👤 _Üye zaten bir yetkili._");
      }

      // add to sudo map
      sudoMap.push(targetLid);
      await setVar("SUDO_MAP", JSON.stringify(sudoMap));

      // format for display
      const displayId = targetLid.split("@")[0];

      await m.sendMessage(`✅ *@${displayId} yetkili olarak eklendi!*`, "text", {
        mentions: [targetLid],
      });
    } catch (error) {
      console.error("Yetkili ekleme hatası:", error);
      await m.sendReply(`❌ *Yetkili ayarlama hatası: ${error.message}*`);
    }
  }
);

Module({
  pattern: "sudolar ?(.*)",
  fromMe: true,
  desc: "Bot üzerinde en üst düzey yönetim yetkisine (SUDO) sahip olan numaraları listeler.",
  usage: ".sudolar",
  use: "sistem",
},
  async (message, match) => {
    let sudoMap = [];
    if (config.SUDO_MAP) {
      try {
        sudoMap = JSON.parse(config.SUDO_MAP);
        if (!Array.isArray(sudoMap)) sudoMap = [];
      } catch (e) {
        sudoMap = [];
      }
    }

    if (sudoMap.length === 0) {
      return await message.sendReply("⚙️ _Ayarlanmış yönetici (sudo) yok._");
    }

    const sudoList = sudoMap
      .map((lid, index) => {
        const displayId = lid.split("@")[0];
        return `${index + 1}. @${displayId}`;
      })
      .join("\n");

    await message.sendMessage(`*Yetkili Kullanıcılar:*\n\n${sudoList}`, "text", {
      mentions: sudoMap,
    });
  }
);

Module({
  pattern: "sudosil ?(.*)",
  fromMe: true,
  desc: "Belirlediğiniz bir kullanıcının bot üzerindeki en üst düzey (SUDO) yönetim yetkisini iptal eder.",
  usage: ".sudosil [etiket/yanıt]",
  use: "sistem",
  dontAddCommandList: true,
},
  async (m, mm) => {
    let targetLid;

    // determine target based on context
    if (m.isGroup) {
      // in gruplar: check mention first, then reply
      if (m.mention && m.mention.length > 0) {
        targetLid = m.mention[0];
      } else if (m.reply_message) {
        targetLid = m.reply_message.jid;
      } else {
        return await m.sendReply("⚠️ *Gruplarda yanıtlamak veya bahsetmek gerekli!*");
      }
    } else {
      // in DM: use sender
      targetLid = m.sender;
    }

    if (!targetLid) return await m.sendReply("❌ *Hedef belirlenemedi!*");

    try {
      // get current SUDO_MAP
      let sudoMap = [];
      if (config.SUDO_MAP) {
        try {
          sudoMap = JSON.parse(config.SUDO_MAP);
          if (!Array.isArray(sudoMap)) sudoMap = [];
        } catch (e) {
          sudoMap = [];
        }
      }

      // check if user is sudo
      if (!sudoMap.includes(targetLid)) {
        return await m.sendReply("❌ *Kullanıcı bir yetkili değil!*");
      }

      // remove from sudo map
      sudoMap = sudoMap.filter((lid) => lid !== targetLid);
      await setVar("SUDO_MAP", JSON.stringify(sudoMap));

      // format for display
      const displayId = targetLid.split("@")[0];

      await m.sendMessage(`✅ *@${displayId} yetkililerden çıkarıldı!*`, "text", {
        mentions: [targetLid],
      });
    } catch (error) {
      console.error("Yetkili kaldırma hatası:", error);
      await m.sendReply(`❌ *Yetkili kaldırma hatası: ${error.message}*`);
    }
  }
);

Module({
  pattern: "toggle ?(.*)",
  fromMe: true,
  desc: "Botun belirli komutlarını tüm kullanıcılar için geçici olarak devre dışı bırakır veya tekrar açar.",
  usage: ".toggle [komut_adı]",
  use: "grup",
},
  async (message, match) => {
    if (match[0].includes("filter")) return;
    match = match[1];
    if (match) {
      const { commands } = require("../main");
      const extractCommandName = (pattern) => {
        const raw = pattern instanceof RegExp ? pattern.source : String(pattern || "");
        const start = raw.search(/[\p{L}\p{N}]/u);
        if (start === -1) return "";
        const cmdPart = raw.slice(start);
        const match = cmdPart.match(/^[\p{L}\p{N}]+/u);
        return match && match[0] ? match[0].trim() : "";
      };
      const availableCommands = commands
        .filter((x) => x.pattern)
        .map((cmd) => extractCommandName(cmd.pattern));
      let disabled =
        typeof config.DISABLED_COMMANDS === "string"
          ? config.DISABLED_COMMANDS.split(",")
          : [];
      if (!availableCommands.includes(match.trim()))
        return await message.sendReply(
          `❌ *${handler}${match.trim()} geçerli bir komut değil!*`
        );
      if (match == "toggle" || match == "setvar" || match == "getvar")
        return await message.sendReply(
          `❌ *${handler}${match.trim()} komutunu devre dışı bırakamazsınız!*`
        );
      if (!disabled.includes(match)) {
        disabled.push(match.trim());
        await message.sendReply(`❌ *'${handler}${match}' komutu başarıyla kapatıldı!*\nℹ️ _Tekrar açmak için \`${handler}toggle ${match}\` kullanın._`
        );
        return await setVar("DISABLED_COMMANDS", disabled.join(","), false);
      } else {
        await message.sendReply(`✅ *'${handler}${match}' komutu başarıyla açıldı!*`
        );
        return await setVar(
          "DISABLED_COMMANDS",
          disabled.filter((x) => x != match).join(",") || "null",
          false
        );
      }
    } else
      return await message.sendReply(
        `💡 _Örnek:_ *${handler}toggle img*\n\nℹ️ _Bu .img komutunu devre dışı bırakacaktır._`
      );
  }
);

Module({
  pattern: "antibot ?(.*)",
  fromMe: false,
  desc: "Sohbete katılan diğer botları otomatik olarak tespit eder ve gruptan uzaklaştırır.",
  usage: ".antibot [aç/kapat]",
  use: "grup",
},
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);
    if (message.fromOwner || adminAccesValidated) {
      match[1] = match[1] ? match[1].toLowerCase() : "";
      const db = await antibot.get();
      const jids = [];
      db.map((data) => {
        jids.push(data.jid);
      });
      if (match[1] === "aç") {
        if (!message.isBotAdmin)
          return await message.sendReply("🙁 _Üzgünüm! Öncelikle yönetici olmalısınız._");
        await antibot.set(message.jid);
      }
      if (match[1] === "kapat") {
        await antibot.delete(message.jid);
      }
      if (match[1] !== "aç" && match[1] !== "kapat") {
        const status = jids.includes(message.jid) ? "Açık" : "Kapalı";
        const { subject } = await message.client.groupMetadata(message.jid);
        return await message.sendReply(
          `🚨 *Bot Engelleme Sistemi (Anti-Bot)*\n\n` +
          `ℹ️ *Mevcut Durum:* ${status} ${jids.includes(message.jid) ? "✅" : "❌"}\n` +
          `💬 *Kullanım:* \`.antibot aç / kapat\``
        );
      }
      await message.sendReply(
        match[1] === "aç" ? "✅ *Antibot etkinleştirildi!*" : "❌ *Antibot kapatıldı!*"
      );
    }
  }
);

Module({
  pattern: "antispam ?(.*)",
  fromMe: false,
  desc: "Grupta hızlı ve tekrarlayan (spam) mesaj atan kullanıcıları otomatik olarak tespit eder ve atar.",
  usage: ".antispam [aç/kapat/limit <sayı>]",
  use: "grup",
},
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);
    if (message.fromOwner || adminAccesValidated) {
      const input = match[1] ? match[1].toLowerCase().trim() : "";
      const args = input.split(" ");
      const command = args[0] || "";
      const value = args.slice(1).join(" ");

      const db = await antispam.get();
      const jids = [];
      db.map((data) => {
        jids.push(data.jid);
      });

      const { BotVariable } = require("../core/database");
      const currentLimit = await BotVariable.get(`SPAMLIMIT_${message.jid}`, "10");

      if (command === "aç") {
        if (!message.isBotAdmin)
          return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
        await antispam.set(message.jid);
        return await message.sendReply("✅ *Anti-Spam etkinleştirildi!*");
      }

      if (command === "kapat") {
        await antispam.delete(message.jid);
        return await message.sendReply("❌ *Anti-Spam kapatıldı!*");
      }

      if (command === "limit") {
        if (!value || value.trim() === "") {
          return await message.sendReply(
            `🔢 *Anti-Spam Limit Menüsü*\n\n⚡ *Mevcut Limit:* \`${currentLimit} mesaj / 10 saniye\`\n\n💬 *Kullanım:* \`.antispam limit [sayı]\`\n📏 *Aralık:* 5 - 50 mesaj`
          );
        }

        const limit = parseInt(value);
        if (isNaN(limit) || limit < 5 || limit > 50) {
          return await message.sendReply(`⚠ *Geçersiz Spam Limiti!*\n\n- Lütfen 5 ile 50 arasında bir miktar girin.\n- Mevcut limit: \`${currentLimit} mesaj / 10 saniye\`\n\n💬 *Kullanım:* \`.antispam limit 15\``);
        }

        await setVar(`SPAMLIMIT_${message.jid}`, limit.toString());
        return await message.sendReply(`✅ *Spam Limiti Güncellendi!*\n\n- Yeni limit: \`${limit} mesaj / 10 saniye\`\n\nℹ _Üyeler 10 saniye içinde ${limit} mesaj atarsa otomatikman gruptan atılacak._`);
      }

      if (command !== "aç" && command !== "kapat" && command !== "limit") {
        const status = jids.includes(message.jid) ? "Açık" : "Kapalı";
        return await message.sendReply(
          `🚨 *Anti-Spam Kontrol Menüsü*` +
          "\n\nℹ️ *Mevcut Durum:* " + status + " " + (jids.includes(message.jid) ? "✅" : "❌") +
          `\n⚡ *Mevcut Spam Limiti:* \`${currentLimit} mesaj / 10 saniye\`` +
          "\n💬 *Kullanım:* `.antispam aç/kapat`" +
          "\n🔢 *Limit Ayarla:* `.antispam limit [5-50]`"
        );
      }
    }
  }
);

Module({
  pattern: "antipdm ?(.*)",
  fromMe: false,
  desc: "Gruptaki yetki verme veya yetki alma durumlarını takip eder ve anlık bilgilendirme yapar.",
  usage: ".antipdm [aç/kapat]",
  use: "grup",
},
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);
    if (message.fromOwner || adminAccesValidated) {
      match[1] = match[1] ? match[1].toLowerCase() : "";
      const db = await antipdm.get();
      const jids = [];
      db.map((data) => {
        jids.push(data.jid);
      });
      if (match[1] === "aç") {
        await antipdm.set(message.jid);
      }
      if (match[1] === "kapat") {
        await antipdm.delete(message.jid);
      }
      if (match[1] !== "aç" && match[1] !== "kapat") {
        const status = jids.includes(message.jid) ? "Açık" : "Kapalı";
        const { subject } = await message.client.groupMetadata(message.jid);
        return await message.sendReply(
          `🚨 *Yetki Değişikliği Uyarısı (Anti-PDM)*` +
          "\n\nℹ️ *Mevcut Durum:* " + status + " " + (jids.includes(message.jid) ? "✅" : "❌") +
          "\n💬 *Kullanım:* `.antipdm aç/kapat`"
        );
      }
      await message.sendReply(
        (match[1] === "aç") ? "✅ *Anti-PDM etkinleştirildi!*" : "❌ *Anti-PDM kapatıldı!*"
      );
    }
  }
);

Module({
  pattern: "antiyetkidüşürme ?(.*)",
  fromMe: false,
  desc: "Yöneticilerin yetkisinin alınmasını engeller; yapanın yetkisini alır ve mağdura iade eder.",
  usage: ".antiyetkidüşürme [aç/kapat]",
  use: "grup",
},
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply("⚠️ *Bu komut sadece gruplarda kullanılabilir!*");
    let adminAccesValidated = await isAdmin(message);
    if (!message.fromOwner && !adminAccesValidated) return;
    match[1] = match[1] ? match[1].toLowerCase() : "";
    const db = await antidemote.get();
    const jids = [];
    db.map((data) => {
      jids.push(data.jid);
    });
    if (match[1] === "aç") {
      await antidemote.set(message.jid);
    }
    if (match[1] === "kapat") {
      await antidemote.delete(message.jid);
    }
    if (match[1] !== "aç" && match[1] !== "kapat") {
      const status = jids.includes(message.jid) ? "Açık" : "Kapalı";
      const { subject } = await message.client.groupMetadata(message.jid);
      return await message.sendReply(
        `🚨 *Anti Yetki Düşürme Tespit Menüsü*` +
        "\n\nℹ️ *Mevcut Durum:* " + status + " " + (jids.includes(message.jid) ? "✅" : "❌") +
        "\n💬 *Kullanım:* `.antiyetkidüşürme aç/kapat`"
      );
    }
    await message.sendReply(
      (match[1] === "aç") ? "✅ *Anti Yetki Düşürme Tespit etkinleştirildi!*" : "❌ *Anti Yetki Düşürme Tespit kapatıldı!*"
    );
  }
);

Module({
  pattern: "antiyetkiverme ?(.*)",
  fromMe: false,
  desc: "Onaysız yetki verilmesini engeller; hem yetki verenin hem de yeni yetkilinin yetkilerini alır.",
  usage: ".antiyetkiverme [aç/kapat]",
  use: "grup",
},
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply("⚠️ *Bu komut sadece gruplarda kullanılabilir!*");
    let adminAccesValidated = await isAdmin(message);
    if (!message.fromOwner && !adminAccesValidated) return;
    match[1] = match[1] ? match[1].toLowerCase() : "";
    const db = await antipromote.get();
    const jids = [];
    db.map((data) => {
      jids.push(data.jid);
    });
    if (match[1] === "aç") {
      await antipromote.set(message.jid);
    }
    if (match[1] === "kapat") {
      await antipromote.delete(message.jid);
    }
    if (match[1] !== "aç" && match[1] !== "kapat") {
      const status = jids.includes(message.jid) ? "Açık" : "Kapalı";
      const { subject } = await message.client.groupMetadata(message.jid);
      return await message.sendReply(
        `🚨 *Anti Yetki Verme Tespit Menüsü*` +
        "\n\nℹ️ *Mevcut Durum:* " + status + " " + (jids.includes(message.jid) ? "✅" : "❌") +
        "\n💬 *Kullanım:* `.antiyetkiverme aç/kapat`"
      );
    }
    await message.sendReply(
      (match[1] === "aç")
        ? "✅ *Anti Yetki Verme Tespit etkinleştirildi!*"
        : "❌ *Anti Yetki Verme Tespit kapatıldı!*"
    );
  }
);

Module({
  pattern: "antibağlantı ?(.*)",
  fromMe: false,
  desc: "Grupta link paylaşımını engeller. Uyarı, silme veya atma gibi farklı modlarda çalışır.",
  usage: ".antibağlantı [yardım/aç/kapat]",
  use: "grup",
},
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);

    if (!(message.fromOwner || adminAccesValidated)) return;

    const input = match[1] ? match[1].toLowerCase().trim() : "";
    const args = input.split(" ");
    const command = args[0] || "";
    const value = args.slice(1).join(" ");

    let config = await antilinkConfig.get(message.jid);

    try {
      switch (command) {
        case "aç":
          if (!message.isBotAdmin) {
            return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
          }

          if (!config) {
            config = await antilinkConfig.set(message.jid, {
              mode: "delete",
              enabled: true,
              updatedBy: message.sender,
            });
          } else {
            config = await antilinkConfig.update(message.jid, {
              enabled: true,
              updatedBy: message.sender,
            });
          }

          return await message.sendReply(`✅ *Anti-Bağlantı Engelleme Etkin!*\n\n` +
            `• Mod: *${config.mode.toUpperCase()}*\n` +
            `• Tür: *${config.isWhitelist ? "BEYAZ LİSTE" : "KARA LİSTE"}*\n` +
            `• Daha fazla seçenek için \`${handler}antibağlantı yardım\` kullanın`
          );
        case "kapat":
          if (config) {
            await antilinkConfig.update(message.jid, {
              enabled: false,
              updatedBy: message.sender,
            });
          }

          return await message.sendReply("❌ *Anti-Bağlantı Engelleme Kapatıldı!*");

        case "mod":
          if (!value || !["uyar", "çıkar", "sil"].includes(value)) {
            return await message.sendReply(`❌ *Geçersiz mod! Mevcut modlar:*\n\n` +
              `• \`uyar\` - Bağlantı gönderenleri uyar\n` +
              `• \`çıkar\` - Bağlantı gönderenleri at\n` +
              `• \`sil\` - Sadece mesajını sil\n\n` +
              `💡 _Örnek:_ *${handler}antibağlantı mod sil*`
            );
          }

          if (!message.isBotAdmin) {
            return await message.sendReply("🙁 _Üzgünüm! Öncelikle yönetici olmalısınız._");
          }

          if (!config) {
            config = await antilinkConfig.set(message.jid, {
              mode: value,
              enabled: true,
              updatedBy: message.sender,
            });
          } else {
            config = await antilinkConfig.update(message.jid, {
              mode: value,
              updatedBy: message.sender,
            });
          }

          return await message.sendReply(
            `✅ *Anti-Bağlantı Engelleme modu ${value.toUpperCase()} olarak ayarlandı!*\n\n` +
            `${value === "uyar"
              ? "⚠️ _Bağlantı gönderen kullanıcılar uyarılacak._"
              : value === "çıkar"
                ? "👢 _Bağlantı gönderen kullanıcılar atılacak._"
                : "🗑️ _Bağlantılar işlem yapılmadan silinecek._"
            }`
          );

        case "istisna":
          if (!value) {
            return await message.sendReply(`💡 _Alan adlarını beyaz listeye ekleyin:_\n\n` +
              `💬 _Kullanım:_ *${handler}antibağlantı istisna google.com,youtube.com*\n` +
              `ℹ️ _Mevcut:_ *${config?.allowedLinks || "gist,instagram,youtu"}*`
            );
          }

          const allowedDomains = value
            .split(",")
            .map((d) => d.trim())
            .filter((d) => d);

          if (!config) {
            config = await antilinkConfig.set(message.jid, {
              allowedLinks: allowedDomains.join(","),
              isWhitelist: true,
              enabled: true,
              updatedBy: message.sender,
            });
          } else {
            config = await antilinkConfig.update(message.jid, {
              allowedLinks: allowedDomains.join(","),
              isWhitelist: true,
              updatedBy: message.sender,
            });
          }

          return await message.sendReply(`✅ *İzin verilen bağlantılar güncellendi!*\n\n` +
            `*Beyaz liste modu:* Sadece bu alan adlarına izin verilir\n` +
            `*Alan adları:* ${allowedDomains.join(", ")}`
          );

        case "engelle":
          if (!value) {
            return await message.sendReply(`💡 _Alan adlarını kara listeye ekleyin:_\n\n` +
              `💬 _Kullanım:_ *${handler}antibağlantı engelle facebook.com,twitter.com*\n` +
              `ℹ️ _Mevcut:_ *${config?.blockedLinks || "Yok"}*`
            );
          }

          const blockedDomains = value
            .split(",")
            .map((d) => d.trim())
            .filter((d) => d);

          if (!config) {
            config = await antilinkConfig.set(message.jid, {
              blockedLinks: blockedDomains.join(","),
              isWhitelist: false,
              enabled: true,
              updatedBy: message.sender,
            });
          } else {
            config = await antilinkConfig.update(message.jid, {
              blockedLinks: blockedDomains.join(","),
              isWhitelist: false,
              updatedBy: message.sender,
            });
          }

          return await message.sendReply(`✅ *Engellenen bağlantılar güncellendi!*\n\n` +
            `*Kara liste modu:* Bu alan adları engellendi\n` +
            `*Alan adları:* ${blockedDomains.join(", ")}`
          );

        case "mesaj":
        case "msj":
          if (!value) {
            return await message.sendReply(`⚠️ *Özel uyarı mesajı ayarlayın:*\n\n` +
              `💬 _Kullanım:_ *${handler}antibağlantı mesaj Bağlantılara izin verilmiyor!*\n` +
              `ℹ️ _Mevcut:_ *${config?.customMessage || "Varsayılan mesaj"}*`
            );
          }

          if (!config) {
            config = await antilinkConfig.set(message.jid, {
              customMessage: value,
              enabled: true,
              updatedBy: message.sender,
            });
          } else {
            config = await antilinkConfig.update(message.jid, {
              customMessage: value,
              updatedBy: message.sender,
            });
          }

          return await message.sendReply(`✅ *Özel mesaj ayarlandı!*\n\n` + `*Mesaj:* ${value}`
          );

        case "sıfırla":
          if (config) {
            await antilinkConfig.delete(message.jid);
          }
          return await message.sendReply("🔄 *Anti-Bağlantı Engelleme ayarları sıfırlandı!*"
          );

        case "yardım":
          return await message.sendReply(`🛡️ *Anti-Bağlantı Engelleme Sistemi Yardımı*\n\n` +
            `*Temel Komutlar:*\n` +
            `• \`${handler}antibağlantı aç/kapat\` - Aç/Kapat\n` +
            `• \`${handler}antibağlantı mod uyar/çıkar/sil\` - İşlemi ayarla\n\n` +
            `*Bağlantı Kontrolü:*\n` +
            `• \`${handler}antibağlantı istisna alan1,alan2\` - Beyaz liste modu\n` +
            `• \`${handler}antibağlantı engelle alan1,alan2\` - Kara liste modu\n\n` +
            `*Özelleştirme:*\n` +
            `• \`${handler}antibağlantı mesaj Metniniz\` - Özel uyarı\n` +
            `• \`${handler}antibağlantı sıfırla\` - Varsayılana sıfırla\n` +
            `• \`${handler}antibağlantı durum\` - Mevcut ayarları görüntüle\n\n` +
            `*Algılama:*\n` +
            `• \`https://ornek.com\` yakalar\n` +
            `• \`www.ornek.com\` yakalar\n` +
            `• \`ornek.com\` yakalar\n` +
            `• \`ornek.com/yol\` yakalar\n\n` +
            `*Modlar:*\n` +
            `• *UYAR* - Uyarı verir, sınıra ulaşınca atar\n` +
            `• *ÇIKAR* - Hemen atar\n` +
            `• *SİL* - Sadece mesajı siler`
          );

        case "durum":
        default:
          if (!config) {
            config = {
              enabled: false,
              mode: "delete",
              allowedLinks: "gist,instagram,youtu",
              blockedLinks: null,
              isWhitelist: true,
              customMessage: null,
            };
          }

          const { subject } = await message.client.groupMetadata(message.jid);

          return await message.sendReply(
            `🚨 *Anti-Bağlantı Engelleme Sistemi - ${subject}*\n\n` +
            `ℹ️ *Mevcut Durum:* ${config.enabled ? "Açık ✅" : "Kapalı ❌"}\n` +
            `⚙️ *Mod:* ${config.mode?.toUpperCase() || "DELETE"}\n` +
            `🏷️ *Tür:* ${config.isWhitelist ? "⚪ BEYAZ LİSTE" : "⚫ KARA LİSTE"
            }\n\n` +
            `*${config.isWhitelist ? "İzin Verilen" : "Engellenen"} Alan Adları:*\n` +
            `${config.isWhitelist
              ? config.allowedLinks || "gist,instagram,youtu"
              : config.blockedLinks || "Yok"
            }\n\n` +
            `💬 *Kullanım:* \`${handler}antibağlantı yardım\``
          );
      }
    } catch (error) {
      console.error("Antibağlantı hatası:", error);
      return await message.sendReply("❌ *Antibağlantı ayarları güncellenirken bir hata oluştu.*"
      );
    }
  }
);

Module({
  pattern: "antikelime ?(.*)",
  fromMe: false,
  desc: "Yasaklı kelime kullanımını engeller (normal: uyarır, at modu: atar).",
  usage: ".antikelime [aç/kapat/at]",
  use: "grup",
},
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);
    if (message.fromOwner || adminAccesValidated) {
      match[1] = match[1] ? match[1].toLowerCase() : "";
      const db = await antiword.get();
      const jids = [];
      db.map((data) => {
        jids.push(data.jid);
      });
      const antiwordWarn = config.ANTIWORD_WARN?.split(",") || [];
      if (match[1].includes("warn") || match[1] === "aç" || match[1] === "on") {
        if (match[1].endsWith("aç") || match[1].endsWith("on") || match[1] === "aç") {
          if (!(await isAdmin(message)))
            return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
          if (!antiwordWarn.includes(message.jid)) {
            antiwordWarn.push(message.jid);
            await setVar("ANTIWORD_WARN", antiwordWarn.join(","), false);
          }
          return await message.sendReply("✅ *Bu grupta kelime uyarı sistemi aktif edildi!*\n_Uyarı verir, gerekirse atar._"
          );
        }
        if (match[1].endsWith("kapat") || match[1].endsWith("off") || match[1] === "kapat") {
          if (!(await isAdmin(message)))
            return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
          if (antiwordWarn.includes(message.jid)) {
            await message.sendReply("❌ *Kelime uyarı sistemi kapatıldı!*");
            return await setVar(
              "ANTIWORD_WARN",
              antiwordWarn.filter((x) => x != message.jid).join(",") || "null",
              false
            );
          }
        }
      }
      if (match[1] === "at") {
        if (!await isAdmin(message))
          return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
        await antiword.set(message.jid);
        if (antiwordWarn.includes(message.jid)) {
          await setVar(
            "ANTIWORD_WARN",
            antiwordWarn.filter((x) => x != message.jid).join(",") || "null",
            false
          );
        }
        return await message.sendReply("✅ *Bu grupta kelime atma sistemi aktif edildi!*\n_Kullanıcıları diret atar._");
      }
      if (match[1] === "kapat" || match[1] === "off") {
        await antiword.delete(message.jid);
      }
      if (match[1] !== "at" && match[1] !== "aç" && match[1] !== "kapat") {
        const status =
          jids.includes(message.jid) ? "At Modu" : antiwordWarn.includes(message.jid) ? "Açık (Uyarır)" : "Kapalı";
        const { subject } = await message.client.groupMetadata(message.jid);
        return await message.sendReply(
          `🤬 *${subject} Yasaklı Kelime Menüsü*` +
          "\n\nℹ️ _Kelime engeli şu anda_ *" +
          status +
          "*\n\n💬 _Ör: .antikelime aç_ → Sadece uyarır\n💬 _Ör: .antikelime at_ → Direkt atar\n💬 _Ör: .antikelime kapat_ → Kapatır"
        );
      }
      await message.sendReply(
        match[1] === "aç" ? "✅ *Yasaklı kelime engeli etkinleştirildi!*" : "❌ *Yasaklı kelime engeli kapatıldı!*"
      );
    }
  }
);

Module({
  pattern: "aramaengel ?(.*)",
  fromMe: true,
  desc: "Gelen sesli ve görüntülü aramaları otomatik olarak reddeder. (uyarı mesajı gönderebilir)",
  usage:
    ".aramaengel aç/kapat\n.aramaengel beyazlisteyeekle <numara>\n.aramaengel beyazlistelerisil <numara>\n.aramaengel beyazlistelerigöster\n.aramaengel beyazlistelerisil\n.aramaengel mesaj <mesaj>\n.aramaengel mesaj kapat",
  use: "sistem",
},
  async (message, match) => {
    const input = match[1]?.trim();

    if (!input) {
      return await message.sendReply("🚨 *Arama Reddetme Yönetimi*\n\n" +
        "ℹ️ *Mevcut Durum:*\n" +
        `• Arama Reddetme: ${config.REJECT_CALLS ? "Açık ✅" : "Kapalı ❌"}\n` +
        `• Reddetme Mesajı: ${config.CALL_REJECT_MESSAGE ? "Ayarlı ✅" : "Ayarlanmamış ❌"}\n` +
        `• Beyaz Listedeki Numaralar: ${config.ALLOWED_CALLS ? config.ALLOWED_CALLS.split(",").length : 0}\n\n` +
        "💬 *Kullanım:*\n" +
        "• `.aramaengel aç/kapat` - Sistemi aç/kapat\n" +
        "• `.aramaengel beyazlisteyeekle <numara>` - Beyaz listeye ekle\n" +
        "• `.aramaengel beyazlistelerigöster` - Beyaz listeyi göster\n" +
        "• `.aramaengel mesaj <metin>` - Mesaj ayarla"
      );
    }

    const [action, ...restParts] = input.split(" ");
    const rest = restParts.join(" ");

    switch (action?.toLowerCase()) {
      case "aç":
        await setVar("REJECT_CALLS", "true", false);
        await message.sendReply("*✅ Arama reddetme etkin*\n\nBeyaz listedekiler dışındaki tüm gelen aramalar reddedilecektir."
        );
        break;

      case "kapat":
        await setVar("REJECT_CALLS", "false", false);
        await message.sendReply("*❌ Arama reddetme kapalı*\n\nTüm gelen aramalar kabul edilecektir."
        );
        break;

      case "beyazliste":
        if (!rest) {
          if (!message.jid.includes("@g.us")) {
            const chatNumber = message.jid.split("@")[0];
            const myNumber = message.client.user.id.split(":")[0];

            if (chatNumber === myNumber) {
              return await message.sendReply("*❌ Kendi numaranızı beyaz listeye alamazsınız*"
              );
            }

            let allowedNumbers = config.ALLOWED_CALLS
              ? config.ALLOWED_CALLS.split(",")
                .map((n) => n.trim())
                .filter((n) => n)
              : [];

            if (allowedNumbers.includes(chatNumber)) {
              return await message.sendReply(
                `*📞 +${chatNumber} numarası zaten beyaz listede*`
              );
            }

            allowedNumbers.push(chatNumber);
            await setVar("ALLOWED_CALLS", allowedNumbers.join(","), false);
            await message.sendReply(
              `*✅ +${chatNumber} beyaz listeye eklendi*\n\nBu numara arama reddetme etkin olsa bile sizi arayabilir.`
            );
          } else {
            return await message.sendReply("*❌ Lütfen bir telefon numarası girin*\n\n*Kullanım:* `.aramaengel beyazliste 905554443322`\n\n*Not:* DM sohbetlerinde, numarayı eklemeden kişiyi beyaz listeye almak için `.aramaengel beyazliste` kullanabilirsiniz."
            );
          }
        } else {
          const number = rest.replace(/[^0-9]/g, "");
          if (!number) {
            return await message.sendReply("*❌ Lütfen geçerli bir telefon numarası girin*\n\n*Kullanım:* `.aramaengel beyazliste 905554443322`"
            );
          }

          let allowedNumbers = config.ALLOWED_CALLS
            ? config.ALLOWED_CALLS.split(",")
              .map((n) => n.trim())
              .filter((n) => n)
            : [];

          if (allowedNumbers.includes(number)) {
            return await message.sendReply(
              `*📞 +${number} numarası zaten beyaz listede*`
            );
          }

          allowedNumbers.push(number);
          await setVar("ALLOWED_CALLS", allowedNumbers.join(","), false);
          await message.sendReply(
            `*✅ +${number} beyaz listeye eklendi*\n\nBu numara arama reddetme etkin olsa bile sizi arayabilir.`
          );
        }
        break;

      case "beyazlistesil":
        if (!rest) {
          if (!message.jid.includes("@g.us")) {
            const chatNumber = message.jid.split("@")[0];
            let allowedNumbers = config.ALLOWED_CALLS
              ? config.ALLOWED_CALLS.split(",")
                .map((n) => n.trim())
                .filter((n) => n)
              : [];

            if (!allowedNumbers.includes(chatNumber)) {
              return await message.sendReply(
                `*📞 +${chatNumber} numarası beyaz listede değil*`
              );
            }

            allowedNumbers = allowedNumbers.filter((n) => n !== chatNumber);
            await setVar("ALLOWED_CALLS", allowedNumbers.join(","), false);
            await message.sendReply(
              `*🚫 +${chatNumber} beyaz listeden kaldırıldı*\n\nArama reddetme etkin olduğunda bu numara engellenecektir.`
            );
          } else {
            return await message.sendReply("*❌ Lütfen bir telefon numarası girin*\n\n*Kullanım:* `.aramaengel beyazlistesil 905554443322`\n\n*Not:* DM'de o kişiyi beyaz listeden çıkarmak için numara olmadan `.aramaengel beyazliste` kullanabilirsiniz."
            );
          }
        } else {
          const number = rest.replace(/[^0-9]/g, "");
          if (!number) {
            return await message.sendReply("*❌ Lütfen geçerli bir telefon numarası girin*\n\n*Kullanım:* `.aramaengel beyazlistesil 905554443322`"
            );
          }

          let allowedNumbers = config.ALLOWED_CALLS
            ? config.ALLOWED_CALLS.split(",")
              .map((n) => n.trim())
              .filter((n) => n)
            : [];

          if (!allowedNumbers.includes(number)) {
            return await message.sendReply(
              `*📞 +${number} numarası beyaz listede değil*`
            );
          }

          allowedNumbers = allowedNumbers.filter((n) => n !== number);
          await setVar("ALLOWED_CALLS", allowedNumbers.join(","), false);
          await message.sendReply(
            `*🚫 +${number} beyaz listeden kaldırıldı*\n\nArama reddetme etkin olduğunda bu numara engellenecektir.`
          );
        }
        break;

      case "beyazlistegöster":
        const allowedNumbers = config.ALLOWED_CALLS
          ? config.ALLOWED_CALLS.split(",")
            .map((n) => n.trim())
            .filter((n) => n)
          : [];

        if (allowedNumbers.length === 0) {
          return await message.sendReply("*📞 Beyaz listede numara yok*\n\nArama reddetme etkin olduğunda tüm aramalar reddedilecektir."
          );
        }

        const numbersText = allowedNumbers
          .map((num, index) => `${index + 1}. +${num}`)
          .join("\n");
        await message.sendReply(
          `*📞 Beyaz Listedeki Numaralar*\n\n${numbersText}\n\n*Toplam:* ${allowedNumbers.length} numara`
        );
        break;

      case "temizle":
        const currentAllowed = config.ALLOWED_CALLS
          ? config.ALLOWED_CALLS.split(",")
            .map((n) => n.trim())
            .filter((n) => n)
          : [];

        if (currentAllowed.length === 0) {
          return await message.sendReply("*📞 Beyaz liste zaten boş*");
        }

        await setVar("ALLOWED_CALLS", "", false);
        await message.sendReply(
          `*🗑️ Beyaz liste temizlendi*\n\n${currentAllowed.length} numara beyaz listeden kaldırıldı. Arama reddetme etkin olduğunda tüm aramalar reddedilecektir.`
        );
        break;

      case "msj":
      case "mesaj":
        if (!rest) {
          const currentMsg = config.CALL_REJECT_MESSAGE;
          return await message.sendReply("*📞 Arama Reddetme Mesajı*\n\n" +
            `*Mevcut Mesaj:* ${currentMsg || "Ayarlanmamış"}\n\n` +
            "*Komutlar:*\n" +
            "• `.aramaengel mesaj <mesajınız>` - Reddetme mesajı ayarla\n" +
            "• `.aramaengel mesaj kapat` - Reddetme mesajını kapat\n\n" +
            "*Örnek:* `.aramaengel mesaj Üzgünüm, şu an meşgulüm. Sizi daha sonra ararım.`"
          );
        }

        if (rest.toLowerCase() === "kapat") {
          await setVar("CALL_REJECT_MESSAGE", "", false);
          await message.sendReply("*🔇 Arama reddetme mesajı kapatıldı*\n\nReddedilen arayanlara hiçbir mesaj gönderilmeyecek."
          );
        } else {
          await setVar("CALL_REJECT_MESSAGE", rest, false);
          await message.sendReply(
            `*✅ Arama reddetme mesajı ayarlandı*\n\n*Mesaj:* "${rest}"\n\nBu mesaj reddedilen arayanlara gönderilecektir.`
          );
        }
        break;

      default:
        await message.sendReply("*❌ Geçersiz komut*\n\n" +
          "*Geçerli komutlar:* aç, kapat, beyazliste, beyazlistesil, beyazlistegöster, temizle, mesaj\n\n" +
          "*Örnekler:*\n" +
          "• `.aramaengel aç` - Arama reddetmeyi aç\n" +
          "• `.aramaengel beyazliste 905554443322` - Numara beyaz listeye ekle\n" +
          "• `.aramaengel mesaj Meşgulüm` - Reddetme mesajı ayarla\n\n" +
          "Tam yardım menüsü için `.aramaengel` yazın."
        );
        break;
    }
  }
);

Module({
  on: "text",
  fromMe: false,
},
  async (message, match) => {
    try {
      // --- 1. LİNK/REKLAM KORUMASI (ÖNCELİKLİ VE DB BEKLEMEDEN) ---
      const foundLinks = linkDetector.detectLinks(message.text);

      if (foundLinks.length > 0) {
        const isAutoDelActive = !process.env.AUTO_DEL
          ? true
          : process.env.AUTO_DEL.split(",").includes(message.jid);

        if (isAutoDelActive) {
          let currentGroupCode = null;
          if (message.isGroup) {
            try {
              currentGroupCode = await message.client.groupInviteCode(message.jid);
            } catch (_) { }
          }

          for (const link of foundLinks) {
            const inviteMatch = (link || "").match(
              /^(https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)(\?.*)?$/i
            );
            if (!inviteMatch) continue;

            const botIsAdmin = message.isBotAdmin;
            const senderIsAdmin = message.isAdmin;
            if (!botIsAdmin || senderIsAdmin) return;

            if (currentGroupCode && inviteMatch[2] === currentGroupCode) continue;

            const groupMetadata = await message.client.groupMetadata(message.jid).catch(() => ({ subject: "Grup" }));

            let senderNumber = message.sender.split("@")[0];
            let senderName = senderNumber;
            try {
              const contact = await message.client.getContact(message.sender);
              senderName = contact.name || contact.notify || senderNumber;
              if (contact.number) senderNumber = contact.number;
            } catch {
              senderName = message.senderName || senderNumber;
            }

            if (!global.antilink_warned_senders) global.antilink_warned_senders = new Set();
            const senderKey = message.jid + "_" + message.sender;
            const shouldWarn = !global.antilink_warned_senders.has(senderKey);

            // Kritik mesaj işlemleri (Ban / Uyarı / Silme) try/catch içerisine alındı ve hatalar loglanarak bloke edildi
            if (shouldWarn) {
              global.antilink_warned_senders.add(senderKey);
              // Spamları ve patlamaları önlemek için 60 saniye beklet
              setTimeout(() => global.antilink_warned_senders.delete(senderKey), 60000);

              const infoMessage =
                `*${groupMetadata.subject}* grubunda ` +
                `şu şahsı *${senderName}* (+${senderNumber}) suçüstü yakaladım. 😈\n\n🔗 ${message.text}`;

              const adminGroupJid = config.ADMIN_GROUP_JID;
              if (adminGroupJid) {
                try {
                  await message.client.sendMessage(adminGroupJid, { text: infoMessage });
                } catch (_) { }
              }
              try { await message.send("🚨 *Hey! Grup reklamı yapmamalısın.* 🤐"); } catch (_) { }
            }

            try {
              await message.client.sendMessage(message.jid, { delete: message.data.key });
            } catch (e) {
              const em = e?.message || String(e);
              // rate-overlimit ve forbidden gibi tekrarlayan / sessiz tolere edilebilir hataları log spam'ı yapma
              if (em.includes('rate-overlimit') || em.includes('forbidden')) { /* ignore */ }
              else console.error("Link Silme Hatası:", em);
            }

            if (shouldWarn) {
              try {
                await message.client.groupParticipantsUpdate(message.jid, [message.sender], "remove");
              } catch (e) {
                const em = e?.message || String(e);
                if (em.includes('rate-overlimit') || em.includes('forbidden')) { /* ignore */ }
                else console.error("Kullanıcı Çıkarma Hatası:", em);
              }
            }
            return; // AUTO_DEL tespit edildi, kelime kontrolü yapmaya gerek yok
          }
        }

        // --- 2. GRUBA ÖZEL ANTİLİNK (DB GEREKTİRİR) ---
        try {
          const antilinkConf = await getCachedAntilinkConfig(message.jid);

          if (antilinkConf && antilinkConf.enabled) {
            let linkBlocked = false;
            const whatsappInviteMatch = /chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)/i;
            let currentGroupCode = null;
            if (message.isGroup) {
              try {
                currentGroupCode = await message.client.groupInviteCode(message.jid);
              } catch (_) { }
            }

            for (const link of foundLinks) {
              const inviteMatch = (link || "").match(whatsappInviteMatch);
              if (inviteMatch && currentGroupCode && inviteMatch[1] === currentGroupCode) continue;
              if (!antilinkConfig.checkAllowed(link, antilinkConf)) {
                linkBlocked = true;
                break;
              }
            }

            if (linkBlocked && !message.isAdmin) {
              const usr = message.sender;

              try { await message.client.sendMessage(message.jid, { delete: message.data.key }); } catch (_) { }
              const customMessage = antilinkConf.customMessage || `⚠️ *Bağlantı Algılandı!*\n\n_Bu grupta bağlantılara izin verilmiyor._`;

              if (antilinkConf.mode === "delete") {
                await message.sendMessage(customMessage, "text", { mentions: [usr] });
              } else if (antilinkConf.mode === "warn") {
                const { WARN } = require("../config");
                const warnLimit = parseInt(WARN || "4");

                try {
                  await uyariEkle(message.jid, usr, "İzinsiz bağlantı gönderdi", message.client.user.id);
                  const warnData = await uyariGetir(message.jid, usr, warnLimit);

                  if (warnData.exceeded) {
                    try {
                      await message.client.groupParticipantsUpdate(message.jid, [usr], "remove");
                      await message.sendMessage(`${customMessage}\n\n*İşlem:* Uyarı sınırını aştığı için kullanıcı atıldı\n*Uyarılar:* ${warnData.current}/${warnLimit}`, "text", { mentions: [usr] });
                    } catch (kickError) {
                      await message.sendMessage(`${customMessage}\n\n*Uyarılar:* ${warnData.current}/${warnLimit}\n*Hata:* Kullanıcı atılamadı`, "text", { mentions: [usr] });
                    }
                  } else {
                    await message.sendMessage(`${customMessage}\n\n*Uyarılar:* ${warnData.current}/${warnLimit}\n*Kalan:* ${warnData.kalan}\n\n${warnData.kalan === 1 ? "⚠️ *Sonraki ihlal atılmayla sonuçlanacak!*" : `⚠️ *${warnData.kalan} uyarı daha kaldı.*`}`, "text", { mentions: [usr] });
                  }
                } catch (error) {
                  console.error("Antilink uyarı hatası:", error);
                  await message.sendMessage(customMessage, "text", { mentions: [usr] });
                }
              } else if (antilinkConf.mode === "kick") {
                try {
                  await message.client.groupParticipantsUpdate(message.jid, [usr], "remove");
                  await message.sendMessage(`${customMessage}\n\n🧹 *İşlem:* İzinsiz bağlantı gönderdiği için kullanıcı atıldı!`, "text", { mentions: [usr] });
                } catch (kickError) {
                  await message.sendMessage(`${customMessage}\n\n❌ *Hata:* Kullanıcı atılamadı!`, "text", { mentions: [usr] });
                }
              }
              return; // Gruba özel antilink tespit edildi, çık.
            }
          }
        } catch (linkDbErr) {
          console.error("Antilink özel logiğinde DB Hatası (Geçici):", linkDbErr.message);
        }
      }

      // --- 3. YASAKLI KELİME KORUMASI (DB GEREKTİRİR) ---
      if (!message.isAdmin) {
        try {
          const antiwordjids = await getCachedAntiwordJids();
          const antiwordWarn = config.ANTIWORD_WARN?.split(",") || [];

          let disallowedWords = null;
          if (config.ANTI_WORDS && config.ANTI_WORDS !== "auto") {
            disallowedWords = config.ANTI_WORDS.split(",").map(w => w.trim()).filter(Boolean);
          }

          let thatWord = findDisallowedWord(message.text, disallowedWords);

          if (thatWord) {
            const isKickMode = antiwordjids.has(message.jid);
            const isWarnMode = antiwordWarn.includes(message.jid);

            if (isKickMode) {
              await message.sendReply(`🤬 *'${thatWord}' kelimesi bu grupta yasaklanmıştır!* @${message.sender.split("@")[0]} uzaklaştırılıyor...`, { mentions: [message.sender] });

              try { await message.client.groupParticipantsUpdate(message.jid, [message.sender], "remove"); } catch (e) { }
              try { return await message.client.sendMessage(message.jid, { delete: message.data.key }); } catch (_) { }
            } else if (isWarnMode) {
              const { WARN } = require("../config");
              const warnLimit = parseInt(WARN || "3");

              await uyariEkle(message.jid, message.sender, `Yasaklı kelime kullanımı: ${thatWord}`, message.client.user.id);
              const warnData = await uyariGetir(message.jid, message.sender, warnLimit);

              if (warnData.exceeded) {
                await message.sendReply(`🤬 *Yasaklı kelime kullanımı nedeniyle sınır aşıldı!* @${message.sender.split("@")[0]} gruptan uzaklaştırılıyor.`, { mentions: [message.sender] });
                try { await message.client.groupParticipantsUpdate(message.jid, [message.sender], "remove"); } catch (e) { }
              } else {
                await message.sendReply(`⚠️ @${message.sender.split("@")[0]}, *bu grupta yasaklı kelime kullanmamalısınız!*\n\n*Kelime:* ${thatWord}\n*Uyarı:* ${warnData.current}/${warnLimit}`, { mentions: [message.sender] });
              }
              try { return await message.client.sendMessage(message.jid, { delete: message.data.key }); } catch (e) { }
            }
          }
        } catch (antiWordErr) {
          console.error("Antiword veritabanı logunda Geçici Hata:", antiWordErr.message);
        }
      }

    } catch (criticalErr) {
      // En dış sönümleyici: Bot eventinin devredışı (disabled) kalmasını ve çökmesini engeller.
      console.error("[TEXT EVENT] Bastırılan Kritik Hata:", criticalErr.message);
    }
  }
);
Module({
  pattern: "uptime",
  fromMe: false,
  use: "sistem",
  desc: "Botun ve üzerinde çalıştığı sunucunun ne kadar süredir kesintisiz aktif olduğunu gösterir.",
  usage: ".uptime",
},
  async (message, match) => {
    const os = require("os");
    const formatTime = (seconds) => {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      const parts = [];
      if (days > 0) parts.push(`${days} gün`);
      if (hours > 0) parts.push(`${hours} sa`);
      if (mins > 0) parts.push(`${mins} dk`);
      parts.push(`${secs} sn`);
      return parts.join(", ");
    };

    const bytesToSize = (bytes) => {
      const sizes = ["B", "KB", "MB", "GB"];
      if (bytes === 0) return "0 B";
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[i];
    };

    const osUptime = formatTime(Math.floor(os.uptime()));
    const processUptime = formatTime(Math.floor(process.uptime()));
    const mem = process.memoryUsage();
    const heapUsed = bytesToSize(mem.heapUsed);
    const heapTotal = bytesToSize(mem.heapTotal);
    const rss = bytesToSize(mem.rss);
    const freeMem = bytesToSize(os.freemem());
    const totalMem = bytesToSize(os.totalmem());
    const cpuModel = os.cpus()?.[0]?.model || "Bilinmiyor";
    const cpuCount = os.cpus()?.length || 0;
    const platform = `${os.type()} ${os.release()}`;
    const nodeVer = process.version;
    const loadAvg = os.loadavg().map((l) => l.toFixed(2)).join(" / ");

    return await message.sendReply(
      `⏱️ *───「 ÇALIŞMA SÜRESİ 」───*\n\n` +
      `🖥️ _Sistem:_ *${osUptime}*\n` +
      `🤖 _Bot:_ *${processUptime}*\n\n` +
      `💾 *───「 BELLEK 」───*\n\n` +
      `📊 _Heap:_ ${heapUsed} / ${heapTotal}\n` +
      `📈 _RSS:_ ${rss}\n` +
      `🧮 _Sistem RAM:_ ${freeMem} boş / ${totalMem} toplam\n\n` +
      `⚙️ *───「 SİSTEM 」───*\n\n` +
      `🔧 _Platform:_ ${platform}\n` +
      `🧠 _CPU:_ ${cpuModel} (${cpuCount} çekirdek)\n` +
      `📉 _Yük Ort:_ ${loadAvg}\n` +
      `🟢 _Node.js:_ ${nodeVer}`
    );
  }
);
Module({
  on: "text",
  fromMe: !0,
},
  async (message) => {
    if (message.text?.startsWith(">")) {
      const m = message;
      const util = require("util");
      const js = (x) => JSON.stringify(x, null, 2);
      try {
        let return_val = await eval(
          `(async () => { ${message.text.replace(">", "")} })()`
        );
        if (return_val && typeof return_val !== "string")
          return_val = util.inspect(return_val);
        if (return_val) {
          await message.sendMessage(return_val, "text");
        } else {
          const reactionMessage = {
            react: {
              text: "✅",
              key: m.data.key,
            },
          };

          await m.client.sendMessage(m.jid, reactionMessage);
        }
      } catch (e) {
        const readMore = String.fromCharCode(8206).repeat(4001);
        if (e)
          await message.sendMessage(
            `❌ *Hata:*\n${readMore}` + util.format(e),
            "text"
          );
      }
    }
  }
);
Module({
  on: "message",
  fromMe: false,
},
  async (message) => {
    if (!message.isGroup) return;
    try {
      // Önce veritabanından grupların aktif olup olmadığını kontrol et
      const dbAntibot = await antibot.get();
      const antibotJids = dbAntibot.map((data) => data.jid);
      const isAntibotActive = antibotJids.includes(message.jid);

      const dbAntispam = await antispam.get();
      const antispamJids = dbAntispam.map((data) => data.jid);
      const isAntispamActive = antispamJids.includes(message.jid);

      if (!isAntibotActive && !isAntispamActive) return;

      // Dinamik admin hesaplamaları
      const senderIsAdmin = await isAdmin(message);

      // Yetkili kişileri atla
      if (message.fromOwner || message.fromSudo || senderIsAdmin) return;

      let botIsAdmin = false;
      try {
        const metadata = await message.client.groupMetadata(message.jid).catch(() => null);
        if (metadata && metadata.participants && message.client.user) {
          const botPn = message.client.user.id ? message.client.user.id.split(":")[0] : "";
          const botLid = message.client.user.lid ? message.client.user.lid.split(":")[0] : "";

          const groupAdmins = metadata.participants.filter(p => p.admin === "admin" || p.admin === "superadmin");
          const foundAdmin = groupAdmins.find(p =>
            (botPn && p.id.startsWith(botPn)) ||
            (botLid && p.id.startsWith(botLid))
          );
          if (foundAdmin) botIsAdmin = true;
        }
      } catch (e) {
        console.error("[ADMIN-CHECK] Error:", e);
      }

      // ---------------- ANTI-SPAM SISTEMI ----------------
      if (isAntispamActive) {
        if (!global.spamMonitor) global.spamMonitor = new Map();
        const spamKey = message.jid + "_" + message.sender;
        let userData = global.spamMonitor.get(spamKey) || { count: 0, firstMessageAt: Date.now() };

        const now = Date.now();
        // 10 saniyelik pencere
        if (now - userData.firstMessageAt > 10000) {
          userData.count = 1;
          userData.firstMessageAt = now;
        } else {
          userData.count += 1;
        }
        global.spamMonitor.set(spamKey, userData);

        const { BotVariable } = require("../core/database");
        const limitStr = await BotVariable.get(`SPAMLIMIT_${message.jid}`, "10");
        const limit = parseInt(limitStr) || 10;

        if (userData.count >= limit) {
          // Atma işleminden sonra sayacı sıfırla ki peş peşe tetiklenmesin
          global.spamMonitor.delete(spamKey);

          if (botIsAdmin) {
            await message.client.sendMessage(message.jid, {
              text: `🚨 *Anti-Spam Sistemi Devrede!*\n\n🚫 @${message.sender.split("@")[0]} kısa sürede çok fazla mesaj gönderdiği için gruptan uzaklaştırıldı.\n_(Limit: 10 saniyede ${limit} mesaj)_`,
              mentions: [message.sender]
            });
            await message.client.groupParticipantsUpdate(message.jid, [message.sender], "remove");
          } else {
            await message.client.sendMessage(message.jid, {
              text: `🚨 *Anti-Spam Tespit Edildi!*\n\n🚫 @${message.sender.split("@")[0]} spam yapıyor ancak yönetici olmadığım için gruptan atamıyorum!`,
              mentions: [message.sender]
            });
          }
        }
      }

      // ---------------- ANTI-BOT SISTEMI ----------------
      if (isAntibotActive) {
        const id = message.id || (message.data && message.data.key && message.data.key.id) || "";
        const rawText = message.text || "";

        const textNoSpace = rawText.toLowerCase().replace(/\s+/g, '');
        const botSignatures = /(statusdetails|uptime:|ram:|cpu:|ping:|bot:|owner:|╭─|╰─|welcometo.+(md|bot)|├|└|menu.*(\[|\())/i;
        const hasBotSignature = botSignatures.test(textNoSpace);

        let isBotMessage = (id.length === 16) ||
          (id.length === 12 && id.startsWith("3EB0")) ||
          ((id.length === 22 || id.length === 20) && (id.startsWith("BAE") || id.startsWith("B24E")));

        if (hasBotSignature) {
          isBotMessage = true;
        }

        if (!global.antibot_handled_ids) global.antibot_handled_ids = new Set();
        if (global.antibot_handled_ids.has(id)) return; // Daha önce işlenmişse atla

        if (!global.antibot_warned_senders) global.antibot_warned_senders = new Set();
        const senderKey = message.jid + "_" + message.sender;

        if (isBotMessage) {
          global.antibot_handled_ids.add(id);

          // Bellek sızıntısını önlemek için bu id'yi 1 dakika sonra bellekten sil
          setTimeout(() => {
            global.antibot_handled_ids.delete(id);
          }, 60000);

          // Uyarı mesajının gönderilip gönderilmeyeceğini belirle
          const shouldWarn = !global.antibot_warned_senders.has(senderKey);
          if (shouldWarn) {
            global.antibot_warned_senders.add(senderKey);
            setTimeout(() => global.antibot_warned_senders.delete(senderKey), 60000);
          }

          if (!botIsAdmin) {
            if (shouldWarn) {
              await message.client.sendMessage(message.jid, {
                text: `🚨 *Antibot Tespit Edildi* 🚨\n\n🤖 _Sohbete sızan bir bot tespit edildi ancak yönetici (Admin) olmadığım için uzaklaştıramıyorum! Lütfen bana yetki verin._`
              });
            }
            return;
          }

          // 1. ÖNCE bilgilendirme mesajı gönder (SADECE bu bot için ilk defaysa)
          if (shouldWarn) {
            await message.client.sendMessage(message.jid, {
              text: `🚨 *Anti-Bot Sistemi Devrede!* 😈\n\n🤖 _Sohbete sızan bir bot tespit ettim ve anında uzaklaştırdım._ 🧹`,
            });
          }

          // 2. Attığı sinsi mesajı herkesten sil
          await message.client.sendMessage(message.jid, {
            delete: {
              remoteJid: message.jid,
              fromMe: false,
              id: id,
              participant: message.sender
            }
          });

          // 3. EN SON İlgili botu gruptan uzaklaştır (SADECE ilk defaysa)
          if (shouldWarn) {
            await message.client.groupParticipantsUpdate(
              message.jid,
              [message.sender],
              "remove"
            );
          }
        }
      }
    } catch (e) {
      console.error("Antibot tespit hatası:", e);
    }
  }
);

Module({
  pattern: "antinumara ?(.*)",
  fromMe: false,
  desc: "Belirli ülke koduna sahip numaraların gruba girişini engeller/izin verir.",
  usage: ".antinumara [aç/kapat/izin 90, 1]",
  use: "grup",
},
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);
    if (message.fromOwner || adminAccesValidated) {
      if (!message.isGroup) return await message.sendReply("⚠️ *Bu komut sadece gruplarda kullanılabilir!*");

      if (!adminAccesValidated) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısın.*");

      const input = match[1] ? match[1].toLowerCase().trim() : "";

      const db = await antifake.get();
      const fakeRecord = db.find(d => d.jid === message.jid);
      const isEnabled = !!fakeRecord;

      if (input === "aç") {
        await antifake.set(message.jid);
        return await message.sendReply("✅ *Anti-Numara açıldı!*\n\nℹ️ _Varsayılan izin verilen alan kodları:_ *+90*\n💡 _Özelleştirmek için:_ `.antinumara izin 90, 1`"
        );
      } if (input === "kapat") {
        await antifake.delete(message.jid);
        return await message.sendReply("❌ *Anti-Numara tamamen kapatıldı!*");
      }

      if (input.startsWith("izin")) {
        const allowedParam = input.replace("izin", "").trim();
        if (!allowedParam) {
          return await message.sendReply("❌ *Lütfen izin verilen ülke kodlarını virgülle ayırarak yazın. (Örnek: .antinumara izin 90, 1)*");
        }
        await antifake.set(message.jid, allowedParam);
        return await message.sendReply(`✅ *İzin verilen ülke numara önekleri başarıyla güncellendi!*\n\n👉🏻 _Artık sadece şu numara önekine sahip üyeler girebilir:_ *${allowedParam}*`);
      }

      // Default menu
      const status = isEnabled ? "Açık ✅" : "Kapalı ❌";
      const groupAllowed = (fakeRecord && fakeRecord.allowed) ? fakeRecord.allowed : (config.ALLOWED || "90");

      const buttons = [
        {
          buttonId: handler + "antinumara aç",
          buttonText: { displayText: "Açık" },
          type: 1,
        },
        {
          buttonId: handler + "antinumara kapat",
          buttonText: { displayText: "Kapalı" },
          type: 1,
        },
      ];

      const buttonMessage = {
        text: `🚨 *Anti-Numara Kontrol Menüsü*\n\nℹ️ *Mevcut Durum:* ${status}\n🌍 *İzinli Numara Önekleri:* ${groupAllowed}\n\n💬 *Kullanım:* \`.antinumara aç\` / \`.antinumara kapat\` / \`.antinumara izin 90, 1\``,
        footer: "",
        buttons: buttons,
        headerType: 1,
      };
      await message.client.sendMessage(message.jid, buttonMessage, {
        quoted: message.data,
      });
    }
  }
);

// ─────────────────────────────────────────────────────────
//  OTO-DURUM (Auto Status View)
// ─────────────────────────────────────────────────────────
Module({
  pattern: "otodurum ?(.*)",
  fromMe: true,
  desc: "Kişilerin durumlarını (status) otomatik olarak görür ve isteğe bağlı tepki verir.",
  usage: ".otodurum [aç/kapat/tepki aç/tepki kapat]",
  use: "sistem",
},
  async (message, match) => {
    const sub = (match[1] || "").trim().toLowerCase();

    const enabled = await BotVariable.get("AUTO_STATUS_ENABLED", "false") === "true";
    const react   = await BotVariable.get("AUTO_STATUS_REACT",    "false") === "true";

    if (!sub) {
      return await message.sendReply(
        `👁️ *Oto-Durum Ayarları*\n\n` +
        `📱 *Otomatik Görüntüleme:* ${enabled ? "Açık ✅" : "Kapalı ❌"}\n` +
        `💚 *Otomatik Tepki:* ${react ? "Açık ✅" : "Kapalı ❌"}\n\n` +
        `💬 *Kullanım:*\n` +
        `• \`.otodurum aç\` — durumları otomatik görüntüle\n` +
        `• \`.otodurum kapat\` — otomatik görüntülemeyi kapat\n` +
        `• \`.otodurum tepki aç\` — görüntülenen durumlara 💚 tepki ver\n` +
        `• \`.otodurum tepki kapat\` — tepkiyi kapat`
      );
    }

    if (sub === "aç") {
      await BotVariable.set("AUTO_STATUS_ENABLED", "true");
      return await message.sendReply("✅ *Oto-Durum açıldı!*\n\nℹ️ _Bot artık kişilerin durumlarını otomatik olarak görüntüleyecek._");
    }

    if (sub === "kapat") {
      await BotVariable.set("AUTO_STATUS_ENABLED", "false");
      return await message.sendReply("❌ *Oto-Durum kapatıldı!*");
    }

    if (sub === "tepki aç") {
      await BotVariable.set("AUTO_STATUS_REACT", "true");
      return await message.sendReply("💚 *Oto-Durum tepkisi açıldı!*\n\nℹ️ _Görüntülenen durumlara 💚 emojisiyle tepki verilecek._");
    }

    if (sub === "tepki kapat") {
      await BotVariable.set("AUTO_STATUS_REACT", "false");
      return await message.sendReply("❌ *Oto-Durum tepkisi kapatıldı!*");
    }

    return await message.sendReply(
      `❌ *Geçersiz seçenek!*\n\n` +
      `ℹ️ _Kullanım:_ \`.otodurum aç/kapat\` veya \`.otodurum tepki aç/kapat\``
    );
  }
);

Module({
  pattern: "otogoruldu ?(.*)",
  fromMe: true,
  desc: "Gelen mesajları otomatik olarak okundu (mavi tik) işaretlemeyi yönetir.",
  usage: ".otogörüldü [aç/kapat]",
  use: "yonetim",
},
  async (message, match) => {
    const sub = (match[1] || "").trim().toLowerCase();
    const enabled = await BotVariable.get("AUTO_READ_ENABLED", "false") === "true";

    if (!sub) {
      return await message.sendReply(
        `👁️ *Oto-Görüldü Durumu*\n\n` +
        `• *Otomatik okundu:* ${enabled ? "Açık ✅" : "Kapalı ❌"}\n\n` +
        `_Kullanım:_\n` +
        `• \`.otogörüldü aç\` — gelen mesajları otomatik okundu işaretle\n` +
        `• \`.otogörüldü kapat\` — otomatik okunduyu kapat`
      );
    }

    if (sub === "aç" || sub === "ac") {
      await BotVariable.set("AUTO_READ_ENABLED", "true");
      return await message.sendReply("✅ *Oto-Görüldü açıldı!*\n\nℹ️ _Bot artık tüm gelen mesajları otomatik okundu olarak işaretleyecek._");
    }

    if (sub === "kapat") {
      await BotVariable.set("AUTO_READ_ENABLED", "false");
      return await message.sendReply("❌ *Oto-Görüldü kapatıldı!*");
    }

    return await message.sendReply(
      `❌ *Geçersiz seçenek!*\n\n` +
      `ℹ️ _Kullanım:_ \`.otogörüldü aç/kapat\``
    );
  }
);

module.exports = {
  containsDisallowedWords,
  setVar,
  delVar,
};

