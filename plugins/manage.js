function containsDisallowedWords(str, disallowedWords) {
  str = str.toLowerCase();
  for (let word of disallowedWords) {
    if (str.match(word)) {
      let otherWords = str.replace(word, "±").split("±");
      for (let _word of otherWords) {
        str = str.replace(_word, "");
      }
      let filteredWord = str;
      return filteredWord;
    }
  }
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
const { getString } = require("./utils/lang");
const Lang = getString("group");
const { Module } = require("../main");
const {
  antilinkConfig,
  antiword,
  antibot,
  antispam,
  antipromote,
  antidemote,
  pdm,
  setWarn,
  getWarn,
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
    await message.sendReply(`_${key.trim()} başarıyla '${value}' olarak ayarlandı!_`);
  }
  return true;
}

async function delVar(key, message = false) {
  await BotVariable.destroy({ where: { key: key.trim() } });
  delete config[key.trim()];
  if (message) {
    await message.sendReply(`_${key.trim()} başarıyla silindi!_`);
  }
  return true;
}
Module({
    pattern: "setvar ?(.*)",
    fromMe: true,
    desc: "Bot değişkenlerini (variables) uzaktan ayarla",
    usage: ".setvar MY_VAR=some_value",
    dontAddCommandList: true,
  },
  async (message, args) => {
    const input = args[1];
    if (!input || !input.includes("=")) {
      return await message.sendReply("_❌ Geçersiz format. Kullanım: .setvar ANAHTAR=DEGER_"
      );
    }

    const [key, ...valueParts] = input.split("=");
    const value = censorBadWords(valueParts.join("=").trim());

    if (key.trim().toUpperCase() === "SUDO") {
      return await message.sendReply("_ℹ️ Artık setvar ile yetki verilmemektedir, .setsudo komutunu kullanın_"
      );
    }

    try {
      await setVar(key.trim(), value, message);
    } catch (error) {
      await message.sendReply(
        `_'${key.trim()}' değişkeni ayarlanamadı. Hata: ${error.message}_`
      );
    }
  }
);

Module({
    pattern: "değişkengetir ?(.*)",
    fromMe: true,
    desc: "Bot değişkeninin değerini getir",
    usage: ".getvar MY_VAR",
    use: "system",
  },
  async (message, args) => {
    const key = args[1]?.trim();
    if (!key) {
      return await message.sendReply("_⚠️ Lütfen değişken adını girin. Kullanım: .getvar DEGISKEN_"
      );
    }

    const variable = config[key];
    if (variable) {
      await message.sendReply(`_Değişken '${key}': ${variable}_`);
    } else {
      await message.sendReply(`_Değişken '${key}' bulunamadı._`);
    }
  }
);

Module({
    pattern: "değişkensil ?(.*)",
    fromMe: true,
    desc: "Bot değişkenini sil",
    usage: ".delvar MY_VAR",
    use: "system",
  },
  async (message, args) => {
    const key = args[1]?.trim();
    if (!key) {
      return await message.sendReply("_⚠️ Lütfen değişken adını girin. Kullanım: .delvar DEGISKEN_"
      );
    }
    try {
      if (config[key] === undefined) {
        return await message.sendReply(`_Değişken '${key}' bulunamadı._`);
      }
      await delVar(key.trim(), message);
    } catch (error) {
      await message.sendReply(
        `_'${key.trim()}' değişkeni silinemedi. Hata: ${error.message}_`
      );
    }
  }
);

Module({
    pattern: "setenv ?(.*)",
    fromMe: true,
    desc: "Botun temel yapılandırma (env) değişken ayarlarını düzenler.",
    usage: ".setenv MY_VAR=some_value",
    dontAddCommandList: true,
  },
  async (message, args) => {
    const input = args[1];
    if (!input || !input.includes("=")) {
      return await message.sendReply("_❌ Geçersiz format. Kullanım: .setenv ANAHTAR=DEGER_"
      );
    }

    const [key, ...valueParts] = input.split("=");
    const value = censorBadWords(valueParts.join("=").trim());
    const trimmedKey = key.trim();

    try {
      if (!fs.existsSync("./config.env")) {
        return await message.sendReply("_⚙️ Değişken ayarları konteynerlerde desteklenmiyor. .setvar komutunu kullanın._"
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
        `_Ortam değişkeni '${trimmedKey}' config.env'de '${value}' olarak ayarlandı_\n\n_Not: Değişikliklerin geçerli olması için yeniden başlatma gereklidir._`
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
    desc: "Tüm bot değişkenlerini getir",
    use: "system",
  },
  async (message, match) => {
    try {
      const variables = await BotVariable.findAll();
      let msg = "*Tüm Bot Değişkenleri:*\n\n";
      for (const v of variables) {
        msg += `*${v.key}*: ${v.value}\n`;
      }
      if (!variables.length) {
        msg += "_Henüz bir değişken ayarlanmamış._";
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
    desc: "Sunucu, işletim sistemi ve versiyon bilgilerini gösterir.",
    use: "system",
  },
  async (message, match) => {
    return await message.sendReply(`_Bot ${config.PLATFORM} üzerinde çalışıyor_`);
  }
);

Module({
    pattern: "dil ?(.*)",
    fromMe: true,
    desc: "Bot dilini bazı komutlar için değiştir",
    use: "system",
  },
  async (message, match) => {
    if (
      !match[1] ||
      !["english", "manglish", "turkish"].includes(match[1].toLowerCase())
    )
      return await message.sendReply("_❌ Geçersiz dil! Mevcut diller: Türkçe, İngilizce, Manglish"
      );
    return await setVar("LANGUAGE", match[1].toLowerCase(), message);
  }
);

Module({
    pattern: "ayarlar ?(.*)",
    fromMe: true,
    desc: "Ek WhatsApp bot seçeneklerini aktifleştirmek için ayarlar.",
    use: "system",
  },
  async (message, match) => {
    let configs = settingsMenu || [];
    if (match[1]) {
      const selectedOption = parseInt(match[1]);
      if (
        !isNaN(selectedOption) &&
        selectedOption > 0 &&
        selectedOption <= configs.length
      ) {
        const setting = configs[selectedOption - 1];
        let msg = `_*${setting.title}*_\n\n1. Açık\n2. Kapalı`;
        return await message.sendReply(msg);
      }
    }
    let msg =
      "*_Ayarlar yapılandırma menüsü_*\n\n_Numaraya göre bir seçenek seçin:_\n\n";
    if (configs.length === 0) {
      msg += "_Şu an yapılandırılabilir ayar bulunmuyor._";
    } else {
      configs.forEach((e, index) => {
        msg += `_${index + 1}. ${e.title}_\n`;
      });
    }
    return await message.sendReply(msg);
  }
);

Module({
    pattern: "mod ?(.*)",
    fromMe: true,
    desc: "Bot modunu genel (public) ve özel (private) olarak değiştirin",
    use: "system",
    dontAddCommandList: true,
  },
  async (message, match) => {
    const input = match[1]?.toLowerCase();
    if (input === "public" || input === "genel") {
      return await setVar("MODE", "public", message);
    } else if (input === "private" || input === "özel") {
      return await setVar("MODE", "private", message);
    } else {
      const mode = config.MODE === "public" ? "Genel" : "Özel";
      return await message.sendReply(
        `⚙️ _*Mod Yöneticisi*_\n_Mevcut mod: *${mode}*_\n_Kullanım: \`.mod genel/özel\`_`
      );
    }
  }
);

Module({
    pattern: "antisilme ?(.*)",
    fromMe: true,
    desc: "Mesaj silme engelini aktifleştirir",
    use: "system",
  },
  async (message, match) => {
    let target = match[1]?.trim();
    if (!target) {
      return await message.sendReply(
        `_*Mesaj silme engeli*_\n\n_Silinen mesajları kurtarır ve otomatik gönderir_\n\n_Mevcut durum: ${config.ANTI_DELETE || "kapalı"
        }_\n\n_Kullanım:_\n\`.antidelete chat\` - _orijinal sohbete gönderir_\n\`.antidelete sudo\` - _ilk yöneticiye gönderir_\n\`.antidelete <jid>\` - _belirtilen JID'e gönderir_\n\`.antidelete off\` - _mesaj silme engelini kapatır_`
      );
    }

    target = target.toLowerCase();

    if (target === "off" || target === "kapat" || target === "disable") {
      await setVar("ANTI_DELETE", "off");
      await setVar("ANTI_DELETE_JID", "");
      return await message.sendReply(`_❌ Mesaj silme engeli kapatıldı ❌_`);
    } else if (target === "chat" || target === "aç" || target === "on" || target === "enable") {
      await setVar("ANTI_DELETE", "chat");
      await setVar("ANTI_DELETE_JID", "");
      return await message.sendReply(`_✅ Mesaj silme engellendi açıldı! ✅_\n\n_Kurtarılan mesajlar orijinal sohbete gönderilecek_`
      );
    } else if (target === "sudo") {
      await setVar("ANTI_DELETE", "sudo");
      await setVar("ANTI_DELETE_JID", "");
      return await message.sendReply(`_✅ Mesaj silme engellendi açıldı! ✅_\n\n_Kurtarılan mesajlar ilk yöneticiye gönderilecek_`
      );
    } else if (target.includes("@")) {
      if (!target.match(/^\d+@(s\.whatsapp\.net|g\.us)$/)) {
        return await message.sendReply(`_❌ Geçersiz JID formatı!_\n\n_Kabul edilen formatlar:_\n- \`123020340234@s.whatsapp.net\` (kişisel)\n- \`123020340234@g.us\` (grup)_`
        );
      }
      await setVar("ANTI_DELETE", "custom");
      await setVar("ANTI_DELETE_JID", target);
      return await message.sendReply(
        `_✅ Mesaj silme engeli etkinleştirildi ✅_\n\n_Kurtarılan mesajlar ${target} adresine gönderilecek_`
      );
    } else {
      return await message.sendReply(`_❌ Geçersiz seçenek!_\n\n_Kullanım:_\n\`.antisilme aç\` - _orijinal sohbete gönderir_\n\`.antisilme sudo\` - _ilk yöneticiye gönderir_\n\`.antisilme <jid>\` - _belirtilen JID'e gönderir_\n\`.antisilme kapat\` - _mesaj silme engelini kapatır_`
      );
    }
  }
);

Module({
    pattern: "setsudo ?(.*)",
    fromMe: true,
    desc: "Belirtilen numaraya üst düzey yönetici (SUDO) yetkisi verir.",
    use: "system",
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
        return await m.sendReply("_⚠️ Gruplarda yanıtlamak veya bahsetmek gerekli_");
      }
    } else {
      // in DM: use sender
      targetLid = m.sender;
    }

    if (!targetLid) return await m.sendReply("_❌ Hedef belirlenemedi_");

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
        return await m.sendReply("_👤 Kullanıcı zaten bir yetkili_");
      }

      // add to sudo map
      sudoMap.push(targetLid);
      await setVar("SUDO_MAP", JSON.stringify(sudoMap));

      // format for display
      const displayId = targetLid.split("@")[0];

      await m.sendMessage(`_@${displayId} yetkili olarak eklendi_`, "text", {
        mentions: [targetLid],
      });
    } catch (error) {
      console.error("Yetkili ekleme hatası:", error);
      await m.sendReply(`_Yetkili ayarlama hatası: ${error.message}_`);
    }
  }
);

Module({
    pattern: "sudolar ?(.*)",
    fromMe: true,
    desc: "Üst düzey ynetici yetkisine (SUDO) sahip numaraları listeler.",
    use: "system",
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
      return await message.sendReply("_⚙️ Ayarlanmış yönetici (sudo) yok_");
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
    desc: "Yöneticiyi (sudo) siler",
    use: "system",
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
        return await m.sendReply("_⚠️ Gruplarda yanıtlamak veya bahsetmek gerekli_");
      }
    } else {
      // in DM: use sender
      targetLid = m.sender;
    }

    if (!targetLid) return await m.sendReply("_❌ Hedef belirlenemedi_");

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
        return await m.sendReply("_❌ Kullanıcı bir yetkili değil_");
      }

      // remove from sudo map
      sudoMap = sudoMap.filter((lid) => lid !== targetLid);
      await setVar("SUDO_MAP", JSON.stringify(sudoMap));

      // format for display
      const displayId = targetLid.split("@")[0];

      await m.sendMessage(`_@${displayId} yetkililerden çıkarıldı!_`, "text", {
        mentions: [targetLid],
      });
    } catch (error) {
      console.error("Yetkili kaldırma hatası:", error);
      await m.sendReply(`_Yetkili kaldırma hatası: ${error.message}_`);
    }
  }
);

Module({
    pattern: "toggle ?(.*)",
    fromMe: true,
    desc: "Komutları açıp kapatmak için",
    usage: ".toggle img",
    use: "group",
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
          `_${handler}${match.trim()} geçerli bir komut değil!_`
        );
      if (match == "toggle" || match == "setvar" || match == "getvar")
        return await message.sendReply(
          `_${handler}${match.trim()} komutunu devre dışı bırakamazsınız!_`
        );
      if (!disabled.includes(match)) {
        disabled.push(match.trim());
        await message.sendReply(`_❌ \`${handler}${match}\` komutu başarıyla kapatıldı_\n_Tekrar açmak için \`${handler}toggle ${match}\` kullanın_`
        );
        return await setVar("DISABLED_COMMANDS", disabled.join(","), false);
      } else {
        await message.sendReply(`_✅ \`${handler}${match}\` komutu başarıyla açıldı_`
        );
        return await setVar(
          "DISABLED_COMMANDS",
          disabled.filter((x) => x != match).join(",") || "null",
          false
        );
      }
    } else
      return await message.sendReply(
        `_Örnek: ${handler}toggle img_\n\n_(Bu .img komutunu devre dışı bırakacaktır)_`
      );
  }
);

Module({
    pattern: "antibot ?(.*)",
    fromMe: true,
    desc: "Diğer botların mesajlarını tespit eder ve atar.",
    use: "group",
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
      if (match[1] === "aç" || match[1] === "on") {
        if (!message.isBotAdmin)
          return await message.sendReply(Lang.NEED_ADMIN);
        await antibot.set(message.jid);
      }
      if (match[1] === "kapat" || match[1] === "off") {
        await antibot.delete(message.jid);
      }
      if (match[1] !== "aç" && match[1] !== "kapat" && match[1] !== "on" && match[1] !== "off") {
        const status = jids.includes(message.jid) ? "Açık" : "Kapalı";
        const { subject } = await message.client.groupMetadata(message.jid);
        return await message.sendReply(
          `🚨 *Bot Engelleme Sistemi*` +
          "\n\nℹ️ *Mevcut Durum:* " + status + " " + (jids.includes(message.jid) ? "✅" : "❌") +
          "\n💬 *Kullanım:* `.antibot aç/kapat`"
        );
      }
      await message.sendReply(
        (match[1] === "aç" || match[1] === "on") ? "_Antibot etkinleştirildi!_" : "_Antibot kapatıldı!_"
      );
    }
  }
);

Module({
    pattern: "antispam ?(.*)",
    fromMe: true,
    desc: "Spam mesajları tespit eder ve kullanıcıyı çıkarır.",
    use: "group",
  },
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);
    if (message.fromOwner || adminAccesValidated) {
      match[1] = match[1] ? match[1].toLowerCase() : "";
      const db = await antispam.get();
      const jids = [];
      db.map((data) => {
        jids.push(data.jid);
      });
      if (match[1] === "aç" || match[1] === "on") {
        if (!message.isBotAdmin)
          return await message.sendReply(Lang.NEED_ADMIN);
        await antispam.set(message.jid);
      }
      if (match[1] === "kapat" || match[1] === "off") {
        await antispam.delete(message.jid);
      }
      if (match[1] !== "aç" && match[1] !== "kapat" && match[1] !== "on" && match[1] !== "off") {
        const status = jids.includes(message.jid) ? "Açık" : "Kapalı";
        const { subject } = await message.client.groupMetadata(message.jid);
        return await message.sendReply(
          `🚨 *Anti-Spam Kontrol Menüsü*` +
          "\n\nℹ️ *Mevcut Durum:* " + status + " " + (jids.includes(message.jid) ? "✅" : "❌") +
          "\n💬 *Kullanım:* `.antispam aç/kapat`"
        );
      }
      await message.sendReply(
        (match[1] === "aç" || match[1] === "on") ? "_Anti-Spam etkinleştirildi!_" : "_Anti-Spam kapatıldı!_"
      );
    }
  }
);

Module({
    pattern: "pdm ?(.*)",
    fromMe: true,
    desc: "Yetki verme/alma durumlarını tespit eder ve uyarı gönderir.",
    use: "group",
  },
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);
    if (message.fromOwner || adminAccesValidated) {
      match[1] = match[1] ? match[1].toLowerCase() : "";
      const db = await pdm.get();
      const jids = [];
      db.map((data) => {
        jids.push(data.jid);
      });
      if (match[1] === "aç" || match[1] === "on") {
        await pdm.set(message.jid);
      }
      if (match[1] === "kapat" || match[1] === "off") {
        await pdm.delete(message.jid);
      }
      if (match[1] !== "aç" && match[1] !== "kapat" && match[1] !== "on" && match[1] !== "off") {
        const status = jids.includes(message.jid) ? "Açık" : "Kapalı";
        const { subject } = await message.client.groupMetadata(message.jid);
        return await message.sendReply(
          `🚨 *Yetki Değişikliği Uyarısı (PDM)*` +
          "\n\nℹ️ *Mevcut Durum:* " + status + " " + (jids.includes(message.jid) ? "✅" : "❌") +
          "\n💬 *Kullanım:* `.pdm aç/kapat`"
        );
      }
      await message.sendReply(
        (match[1] === "aç" || match[1] === "on") ? "_PDM etkinleştirildi!_" : "_PDM kapatıldı!_"
      );
    }
  }
);

Module({
    pattern: "antiyetkidüşürme ?(.*)",
    fromMe: true,
    desc: "Yetki alınmasını tespit eder ve yapanın yetkisini alıp, mağdura yetkiyi verir.",
    use: "group",
  },
  async (message, match) => {
    match[1] = match[1] ? match[1].toLowerCase() : "";
    const db = await antidemote.get();
    const jids = [];
    db.map((data) => {
      jids.push(data.jid);
    });
    if (match[1] === "aç" || match[1] === "on") {
      await antidemote.set(message.jid);
    }
    if (match[1] === "kapat" || match[1] === "off") {
      await antidemote.delete(message.jid);
    }
    if (match[1] !== "aç" && match[1] !== "kapat" && match[1] !== "on" && match[1] !== "off") {
      const status = jids.includes(message.jid) ? "Açık" : "Kapalı";
      const { subject } = await message.client.groupMetadata(message.jid);
      return await message.sendReply(
        `🚨 *Anti Yetki Düşürme Tespit Menüsü*` +
        "\n\nℹ️ *Mevcut Durum:* " + status + " " + (jids.includes(message.jid) ? "✅" : "❌") +
        "\n💬 *Kullanım:* `.antiyetkidüşürme aç/kapat`"
      );
    }
    await message.sendReply(
      (match[1] === "aç" || match[1] === "on") ? "_✅ Anti Yetki Düşürme Tespit etkinleştirildi!_" : "_❌ Anti Yetki Düşürme Tespit kapatıldı!_"
    );
  }
);

Module({
    pattern: "antiyetkiverme ?(.*)",
    fromMe: true,
    desc: "Yetki verilmesini tespit eder ve yapanın ile yeni yetkilinin yetkilerini alır.",
    use: "group",
  },
  async (message, match) => {
    match[1] = match[1] ? match[1].toLowerCase() : "";
    const db = await antipromote.get();
    const jids = [];
    db.map((data) => {
      jids.push(data.jid);
    });
    if (match[1] === "aç" || match[1] === "on") {
      await antipromote.set(message.jid);
    }
    if (match[1] === "kapat" || match[1] === "off") {
      await antipromote.delete(message.jid);
    }
    if (match[1] !== "aç" && match[1] !== "kapat" && match[1] !== "on" && match[1] !== "off") {
      const status = jids.includes(message.jid) ? "Açık" : "Kapalı";
      const { subject } = await message.client.groupMetadata(message.jid);
      return await message.sendReply(
        `🚨 *Anti Yetki Verme Tespit Menüsü*` +
        "\n\nℹ️ *Mevcut Durum:* " + status + " " + (jids.includes(message.jid) ? "✅" : "❌") +
        "\n💬 *Kullanım:* `.antiyetkiverme aç/kapat`"
      );
    }
    await message.sendReply(
      (match[1] === "aç" || match[1] === "on")
        ? "_✅ Anti Yetki Verme Tespit etkinleştirildi!_"
        : "_❌ Anti Yetki Verme Tespit kapatıldı!_"
    );
  }
);

Module({
    pattern: "antibağlantı ?(.*)",
    fromMe: true,
    desc: "Gelişmiş antilink (link engelleme) sistemi (uyarı/at/sil modlu)",
    use: "group",
  },
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);

    if (!(message.fromOwner || adminAccesValidated)) return;

    const input = match[1] ? match[1].toLowerCase().trim() : "";
    const args = input.split(" ");
    const command = args[0];
    const value = args.slice(1).join(" ");

    let config = await antilinkConfig.get(message.jid);

    try {
      switch (command) {
        case "on":
        case "enable":
          if (!message.isBotAdmin) {
            return await message.sendReply(Lang.NEED_ADMIN);
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
            `• Daha fazla seçenek için \`${handler}antibağlantı help\` kullanın`
          );

        case "off":
        case "disable":
          if (config) {
            await antilinkConfig.update(message.jid, {
              enabled: false,
              updatedBy: message.sender,
            });
          }

          return await message.sendReply("❌ *Anti-Bağlantı Engelleme Kapatıldı!*");

        case "mode":
          if (!value || !["uyar", "kick", "delete"].includes(value)) {
            return await message.sendReply(`_❌ Geçersiz mod! Mevcut modlar:_\n\n` +
              `• \`uyar\` - Bağlantı gönderenleri uyar\n` +
              `• \`çıkar\` - Bağlantı gönderenleri at\n` +
              `• \`sil\` - Sadece mesajını sil\n\n` +
              `💬 _Örnek:_ \`${handler}antibağlantı mod sil\``
            );
          }

          if (!message.isBotAdmin) {
            return await message.sendReply(Lang.NEED_ADMIN);
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
              ? "⚠️ Bağlantı gönderen kullanıcılar uyarılacak"
              : value === "çıkar"
                ? "👢 Bağlantı gönderen kullanıcılar atılacak"
                : "🗑️ Bağlantılar işlem yapılmadan silinecek"
            }`
          );

        case "istisna":
        case "whitelist":
          if (!value) {
            return await message.sendReply(`_💬 Alan adlarını beyaz listeye ekleyin:_\n\n` +
              `_Kullanım:_ \`${handler}antibağlantı istisna google.com,youtube.com\`\n` +
              `_Mevcut:_ ${config?.allowedLinks || "gist,instagram,youtu"}`
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
        case "blacklist":
          if (!value) {
            return await message.sendReply(`_💬 Alan adlarını kara listeye ekleyin:_\n\n` +
              `_Kullanım:_ \`${handler}antibağlantı engelle facebook.com,twitter.com\`\n` +
              `_Mevcut:_ ${config?.blockedLinks || "Yok"}`
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
            return await message.sendReply(`_⚠️ Özel uyarı mesajı ayarlayın:_\n\n` +
              `_Kullanım:_ \`${handler}antibağlantı mesaj Bağlantılara izin verilmiyor!\`\n` +
              `_Mevcut:_ ${config?.customMessage || "Varsayılan mesaj"}`
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

        case "help":
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
      return await message.sendReply("_❌ Antibağlantı ayarları güncellenirken bir hata oluştu._"
      );
    }
  }
);

Module({
    pattern: "antikelime ?(.*)",
    fromMe: true,
    desc: "Yasaklı kelime (antiword) engelini aktifleştirir, gönderen atılır",
    use: "group",
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
      if (match[1].includes("warn")) {
        if (match[1].endsWith("on") || match[1].endsWith("aç")) {
          if (!(await isAdmin(message)))
            return await message.sendReply(Lang.NEED_ADMIN);
          if (!antiwordWarn.includes(message.jid)) {
            antiwordWarn.push(message.jid);
            await setVar("ANTIWORD_WARN", antiwordWarn.join(","), false);
          }
          return await message.sendReply(`_✅ Bu grupta kelime uyarı sistemi aktif edildi!_`
          );
        }
        if (match[1].endsWith("off") || match[1].endsWith("kapat")) {
          if (!(await isAdmin(message)))
            return await message.sendReply(Lang.NEED_ADMIN);
          if (antiwordWarn.includes(message.jid)) {
            await message.sendReply(`_❌ Kelime uyarı sistemi kapatıldı!_`);
            return await setVar(
              "ANTIWORD_WARN",
              antiwordWarn.filter((x) => x != message.jid).join(",") || "null",
              false
            );
          }
        }
      }
      if (match[1] === "aç" || match[1] === "on") {
        if (!await isAdmin(message))
          return await message.sendReply(Lang.NEED_ADMIN);
        await antiword.set(message.jid);
      }
      if (match[1] === "kapat" || match[1] === "off") {
        await antiword.delete(message.jid);
      }
      if (match[1] !== "aç" && match[1] !== "kapat" && match[1] !== "on" && match[1] !== "off") {
        const status =
          jids.includes(message.jid) || antiwordWarn.includes(message.jid)
            ? "Açık"
            : "Kapalı";
        const { subject } = await message.client.groupMetadata(message.jid);
        return await message.sendReply(
          `_${subject} yasaklı kelime menüsü_` +
          "\n\n_Yasaklı kelime engeli şu anda *" +
          status +
          "*_\n\n_Ör: .antikelime aç/kapat_\n_.antikelime uyar aç/kapat_\n\n_Özel kelimeler engellemek için otomatik algılama için `ANTI_WORDS:auto` ayarlayın (varsayılan olarak zaten etkin!)_"
        );
      }
      await message.sendReply(
        match[1] === "on" ? "_Yasaklı kelime engeli etkinleştirildi!_" : "_Yasaklı kelime engeli kapatıldı!_"
      );
    }
  }
);

Module({
    pattern: "aramaengel ?(.*)",
    fromMe: true,
    desc: "Kapsamlı arama reddetme yönetim sistemi",
    usage:
      ".aramaengel aç/kapat\n.aramaengel beyazlisteyeekle <numara>\n.aramaengel beyazlistelerisil <numara>\n.aramaengel beyazlistelerigöster\n.aramaengel beyazlistelerisil\n.aramaengel mesaj <mesaj>\n.aramaengel mesaj kapat",
    use: "system",
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

    switch (action.toLowerCase()) {
      case "on":
      case "enable":
      case "aç":
        await setVar("REJECT_CALLS", "true", false);
        await message.sendReply("*✅ Arama reddetme etkin*\n\nBeyaz listedekiler dışındaki tüm gelen aramalar reddedilecektir."
        );
        break;

      case "off":
      case "disable":
      case "kapat":
        await setVar("REJECT_CALLS", "false", false);
        await message.sendReply("*❌ Arama reddetme kapalı*\n\nTüm gelen aramalar kabul edilecektir."
        );
        break;

      case "allow":
      case "beyazlisteyeekle":
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
            return await message.sendReply("*❌ Lütfen bir telefon numarası girin*\n\n*Kullanım:* `.callreject allow 905554443322`\n\n*Not:* DM sohbetlerinde, numarayı eklemeden kişiyi beyaz listeye almak için `.callreject allow` kullanabilirsiniz."
            );
          }
        } else {
          const number = rest.replace(/[^0-9]/g, "");
          if (!number) {
            return await message.sendReply("*❌ Lütfen geçerli bir telefon numarası girin*\n\n*Kullanım:* `.callreject allow 905554443322`"
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

      case "remove":
      case "beyazlistelerisil":
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
            return await message.sendReply("*❌ Lütfen bir telefon numarası girin*\n\n*Kullanım:* `.callreject remove 905554443322`\n\n*Not:* DM'de o kişiyi beyaz listeden çıkarmak için numara olmadan `.callreject remove` kullanabilirsiniz."
            );
          }
        } else {
          const number = rest.replace(/[^0-9]/g, "");
          if (!number) {
            return await message.sendReply("*❌ Lütfen geçerli bir telefon numarası girin*\n\n*Kullanım:* `.callreject remove 905554443322`"
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

      case "list":
      case "beyazlistelerigöster":
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

      case "clear":
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
            "• `.aramaengel msg <mesajınız>` - Reddetme mesajı ayarla\n" +
            "• `.aramaengel msg kapat` - Reddetme mesajını kapat\n\n" +
            "*Örnek:* `.aramaengel msg Üzgünüm, şu an meşgulüm. Sizi daha sonra ararım.`"
          );
        }

        if (rest.toLowerCase() === "off" || rest.toLowerCase() === "disable") {
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
          "*Geçerli komutlar:* aç, kapat, beyazlisteyeekle, beyazlistelerisil, beyazlistelerigöster, temizle, mesaj\n\n" +
          "*Örnekler:*\n" +
          "• `.aramaengel aç` - Arama reddetmeyi aç\n" +
          "• `.aramaengel allow 905554443322` - Numara beyaz listeye ekle\n" +
          "• `.aramaengel msg Meşgulüm` - Reddetme mesajı ayarla\n\n" +
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
    const configs = settingsMenu;
    const sMatch = message.message?.match(/^\d+$/);
    const settingsMatch =
      sMatch &&
      message.reply_message?.text &&
      message.reply_message.text
        .toLowerCase()
        .includes("ayarlar yapılandırma menüsü") &&
      message.quoted.key.fromMe;
    if (settingsMatch) {
      const optionNumber = parseInt(sMatch[0]);
      if (optionNumber > 0 && optionNumber <= configs.length) {
        const setting = configs[optionNumber - 1];
        let msg = `*_${setting.title}_*\n1. Açık\n2. Kapalı`;
        return await message.sendReply(msg);
      }
    } else if (
      message.message?.match(/^(1|2)$/) &&
      message.reply_message?.text?.includes("1. Açık") &&
      message.quoted.key.fromMe
    ) {
      const quotedMsg = message.reply_message.message;
      const option = parseInt(message.message);
      for (const setting of configs) {
        if (quotedMsg.includes(setting.title)) {
          const value = option === 1 ? "true" : "false";
          await setVar(setting.env_var, value);
          await message.sendReply(`✅ ${setting.title} ${value} olarak ayarlandı`);
          return;
        }
      }
    }

    const antiwordjids = await getCachedAntiwordJids();
    if (antiwordjids.has(message.jid)) {
      const antiwordWarn = config.ANTIWORD_WARN?.split(",") || [];
      if (antiwordWarn.includes(message.jid)) return;
      let disallowedWords = (config.ANTI_WORDS || "auto").split(",");
      if (config.ANTI_WORDS == "auto")
        disallowedWords = require("badwords/array");
      let thatWord = containsDisallowedWords(message.message, disallowedWords);
      if (thatWord) {
        await message.sendReply(
          `🤬 _${thatWord} kelimesi bu sohbette yasaklıdır!_`
        );
        await message.client.groupParticipantsUpdate(
          message.jid,
          [message.sender],
          "remove"
        );
        return await message.client.sendMessage(message.jid, {
          delete: message.data.key,
        });
      }
    }

    const foundLinks = linkDetector.detectLinks(message.message);

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
            /^(https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]{22})(\?.*)?$/i
          );
          if (!inviteMatch) continue;

          const botIsAdmin = message.isBotAdmin;
          const senderIsAdmin = message.isAdmin;
          if (!botIsAdmin || senderIsAdmin) return;

          if (currentGroupCode && inviteMatch[2] === currentGroupCode) continue;

          const groupMetadata = await message.client.groupMetadata(message.jid);

          let senderNumber = message.sender.split("@")[0];
          let senderName = senderNumber;
          try {
            const contact = await message.client.getContact(message.sender);
            senderName = contact.name || contact.notify || senderNumber;
            if (contact.number) {
              senderNumber = contact.number;
            }
          } catch {
            senderName = message.senderName || senderNumber;
          }

          const infoMessage =
            `Saygıdeğer yöneticilerim; *${groupMetadata.subject}* grubunda ` +
            `şu şahsı *${senderName}* (+${senderNumber}) suçüstü yakaladım. 😈

🔗 ${message.message}`;

          const adminGroupJid = config.ADMIN_GROUP_JID;
          if (adminGroupJid) {
            try {
              await message.client.sendMessage(adminGroupJid, {
                text: infoMessage,
              });
            } catch (_) { /* admin grubuna gönderilemedi, devam et */ }
          }
          await message.send("🚨 *Hey! Grup reklamı yapmamalısın.* 🤐");
          try {
            await message.client.sendMessage(message.jid, { delete: message.data.key });
          } catch { /* mesaj silme başarısız, devam et */ }
          await message.client.groupParticipantsUpdate(
            message.jid,
            [message.sender],
            "remove"
          );
          return;
        }
      }

      const antilinkConf = await getCachedAntilinkConfig(message.jid);

      if (antilinkConf && antilinkConf.enabled) {
        let linkBlocked = false;
        const whatsappInviteMatch = /chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]{22})/i;
        let currentGroupCode = null;
        if (message.isGroup) {
          try {
            currentGroupCode = await message.client.groupInviteCode(message.jid);
          } catch (_) {
            /* Bot yönetici değilse kod alınamaz */
          }
        }

        for (const link of foundLinks) {
          const inviteMatch = (link || "").match(whatsappInviteMatch);
          if (inviteMatch && currentGroupCode && inviteMatch[1] === currentGroupCode) {
            continue;
          }
          if (!antilinkConfig.checkAllowed(link, antilinkConf)) {
            linkBlocked = true;
            break;
          }
        }

        if (linkBlocked && !message.isAdmin) {
          const usr = message.sender;

          await message.client.sendMessage(message.jid, {
            delete: message.data.key,
          });
          const customMessage =
            antilinkConf.customMessage ||
            `⚠️ *Bağlantı Algılandı!*\n\n_Bu grupta bağlantılara izin verilmiyor._`;

          if (antilinkConf.mode === "delete") {
            await message.sendMessage(customMessage, "text", {
              mentions: [usr],
            });
          } else if (antilinkConf.mode === "warn") {
            const { WARN } = require("../config");
            const warnLimit = parseInt(WARN || "4");
            const targetNumericId = usr?.split("@")[0];

            try {
              await setWarn(
                message.jid,
                usr,
                "İzinsiz bağlantı gönderme",
                message.client.user.id
              );

              const warnData = await getWarn(message.jid, usr, warnLimit);
              const currentWarns = warnData.current;
              const kalan = warnData.kalan;

              if (warnData.exceeded) {
                try {
                  await message.client.groupParticipantsUpdate(
                    message.jid,
                    [usr],
                    "remove"
                  );
                  await message.sendMessage(
                    `${customMessage}\n\n` +
                    `*İşlem:* Uyarı sınırını aştığı için kullanıcı atıldı\n` +
                    `*Uyarılar:* ${currentWarns}/${warnLimit}`,
                    "text",
                    {
                      mentions: [usr],
                    }
                  );
                } catch (kickError) {
                  await message.sendMessage(
                    `${customMessage}\n\n` +
                    `*Uyarılar:* ${currentWarns}/${warnLimit}\n` +
                    `*Hata:* Kullanıcı atılamadı`,
                    "text",
                    {
                      mentions: [usr],
                    }
                  );
                }
              } else {
                await message.sendMessage(
                  `${customMessage}\n\n` +
                  `*Uyarılar:* ${currentWarns}/${warnLimit}\n` +
                  `*Kalan:* ${kalan}\n\n` +
                  `${kalan === 1
                    ? "_Sonraki ihlal atılmayla sonuçlanacak!_"
                    : `_${kalan} uyarı daha kaldı._`
                  }`,
                  "text",
                  {
                    mentions: [usr],
                  }
                );
              }
            } catch (error) {
              console.error("Antilink uyarı hatası:", error);
              await message.sendMessage(customMessage, "text", {
                mentions: [usr],
              });
            }
          } else if (antilinkConf.mode === "kick") {
            try {
              await message.client.groupParticipantsUpdate(
                message.jid,
                [usr],
                "remove"
              );
              await message.sendMessage(
                `${customMessage}\n\n*İşlem:* İzinsiz bağlantı gönderdiği için kullanıcı atıldı`,
                "text",
                {
                  mentions: [usr],
                }
              );
            } catch (kickError) {
              await message.sendMessage(
                `${customMessage}\n\n*Hata:* Kullanıcı atılamadı`,
                "text",
                {
                  mentions: [usr],
                }
              );
            }
          }
        }
      }
    }
  }
);
Module({
    pattern: "uptime",
    fromMe: true,
    use: "system",
    desc: "Sistem (OS) / işlem çalışma süresini gösterir (uptime)",
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
    if (message.message?.startsWith(">")) {
      const m = message;
      const util = require("util");
      const js = (x) => JSON.stringify(x, null, 2);
      try {
        let return_val = await eval(
          `(async () => { ${message.message.replace(">", "")} })()`
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
            `_❌ Hata:_\n${readMore}` + util.format(e),
            "text"
          );
      }
    }
  }
);
module.exports = {
  containsDisallowedWords,
  setVar,
  delVar,
};
