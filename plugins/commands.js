const { commands, Module } = require("../main");
const { MODE, HANDLERS, ALIVE, VERSION } = require("../config");
const config = require("../config");
const os = require("os");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { uploadToImgbb } = require("./utils/upload");
const { setVar } = require("./manage");
const { getTotalUserCount } = require("../core/store");
const { parseAliveMessage, sendAliveMessage } = require("./utils/alive-parser");
const { badWords, censorBadWords } = require("./utils/censor");
const { nxTry } = require("./utils");

const CATEGORY_TR = {
  owner: "👑 Kurucu & Geliştirici",
  system: "⚙️ Sistem & Analiz",
  group: "👥 Grup Yönetimi",
  ai: "🤖 Yapay Zeka",
  download: "⬇️ İndirme Merkezi",
  search: "🔍 Arama & Bilgi",
  tools: "🛠️ Araçlar & Çeviri",
  edit: "🎨 Görsel Düzenleme",
  media: "🎬 Medya İşlemleri",
  fun: "🎉 Eğlence & Efekt",
  game: "🎮 Oyunlar & Testler",
  dini: "🕌 Dini Bilgiler",
  chat: "💬 Sohbet & Mesaj",
  genel: "📦 Genel Komutlar",
};

const extractCommandName = (pattern) => {
  const raw = pattern instanceof RegExp ? pattern.source : String(pattern || "");
  const start = raw.search(/[\p{L}\p{N}]/u);
  if (start === -1) return "";
  const cmdPart = raw.slice(start);
  const match = cmdPart.match(/^[\p{L}\p{N}]+/u);
  return match && match[0] ? match[0].trim() : "";
};

const retrieveCommandDetails = (commandName) => {
  const cmds = typeof commands === 'function' ? commands() : commands;
  const foundCommand = cmds.find(
    (cmd) => extractCommandName(cmd.pattern) === commandName
  );
  if (!foundCommand) return null;
  return {
    name: commandName,
    ...foundCommand,
  };
};


Module({
  pattern: "liste ?(.*)",
  fromMe: false,
  desc: "Tüm komutları kategorilere ayrılmış detaylı bir liste halinde sunar.",
  usage: ".liste",
  excludeFromCommands: true,
},
  async (message, args) => {
    const cmds = typeof commands === 'function' ? commands() : commands;
    const availableCommands = cmds.filter(
      (cmd) => !cmd.excludeFromCommands && !cmd.dontAddCommandList && cmd.pattern
    );
    const totalCommandCount = availableCommands.length;

    const categorizedCommands = {};
    availableCommands.forEach((cmd) => {
      const category = cmd.use || "Genel";
      if (!categorizedCommands[category]) {
        categorizedCommands[category] = [];
      }
      const commandName = extractCommandName(cmd.pattern);
      if (commandName) {
        categorizedCommands[category].push({
          name: commandName,
          desc: cmd.desc,
          usage: cmd.usage,
          warn: cmd.warn,
        });
      }
    });

    let responseMessage = `*📋 Toplam Mevcut Komut: ${totalCommandCount}*\n\n`;
    const safeHandlers = typeof HANDLERS === 'string' ? HANDLERS : String(HANDLERS);
    const handlerPrefix = safeHandlers.match(/\[(\W*)\]/)?.[1]?.[0] || ".";

    const categoryOrder = [
      "sahip", "owner",
      "sistem", "system",
      "grup", "group",
      "yapay zeka", "ai", "yapay-zeka",
      "indirme", "download",
      "arama", "search",
      "araçlar", "tools",
      "medya", "media", "edit",
      "eğlence", "fun", "game",
      "dini",
      "sohbet", "chat",
      "genel"
    ];

    const processedCategories = new Set();
    const sortedCategories = [];

    // Order existing categories based on categoryOrder
    categoryOrder.forEach(orderKey => {
      for (const cat in categorizedCommands) {
        if (cat.toLowerCase() === orderKey.toLowerCase() && !processedCategories.has(cat)) {
          sortedCategories.push(cat);
          processedCategories.add(cat);
        }
      }
    });

    // Add any remaining categories
    for (const cat in categorizedCommands) {
      if (!processedCategories.has(cat)) {
        sortedCategories.push(cat);
      }
    }

    const emojiMap = {
      'sahip': '👑', 'owner': '👑',
      'sistem': '⚙️', 'system': '⚙️',
      'grup': '👥', 'group': '👥',
      'yapay-zeka': '🤖', 'ai': '🤖', 'yapay zeka': '🤖',
      'indirme': '⬇️', 'download': '⬇️',
      'medya': '🎬', 'media': '🎬', 'edit': '🎨',
      'araçlar': '🛠️', 'tools': '🛠️', 'search': '🔍', 'arama': '🔍',
      'eğlence': '🎉', 'fun': '🎉', 'game': '🎮',
      'dini': '🕌',
      'sohbet': '💬', 'chat': '💬',
      'genel': '📦'
    };

    const labelMap = {
      'sahip': 'Kurucu & Geliştirici', 'owner': 'Kurucu & Geliştirici',
      'sistem': 'Sistem & Durum', 'system': 'Sistem & Durum',
      'grup': 'Grup Yönetimi', 'group': 'Grup Yönetimi',
      'yapay-zeka': 'Yapay Zeka', 'ai': 'Yapay Zeka', 'yapay zeka': 'Yapay Zeka',
      'indirme': 'İndirme Merkezi', 'download': 'İndirme Merkezi',
      'medya': 'Medya İşlemleri', 'media': 'Medya İşlemleri', 'edit': 'Görsel Düzenleme',
      'araçlar': 'Araçlar & Çeviri', 'tools': 'Araçlar & Çeviri', 'search': 'Arama & Bilgi', 'arama': 'Arama & Bilgi',
      'eğlence': 'Eğlence & Oyunlar', 'fun': 'Eğlence', 'game': 'Oyunlar',
      'dini': 'Dini Bilgiler',
      'sohbet': 'Sohbet & Mesaj', 'chat': 'Sohbet',
      'genel': 'Genel Komutlar'
    };

    sortedCategories.forEach((category) => {
      const lowerCat = category.toLowerCase();
      const emoji = emojiMap[lowerCat] || "📌";
      const label = labelMap[lowerCat] || category.charAt(0).toUpperCase() + category.slice(1);
      
      responseMessage += `${emoji} *${label.toUpperCase()}*\n`;
      categorizedCommands[category].forEach((cmd) => {
        responseMessage += `• \`${handlerPrefix}${cmd.name}\`\n`;
        responseMessage += "\n";
      });
    }
    await message.sendReply(responseMessage);
  }
);

function bytesToSize(bytes) {
  const sizes = ["Bayt", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 Bayt";
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round(bytes / Math.pow(1024, i), 2) + " " + sizes[i];
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function parseAlive(message, aliveMessage) {
  if (!aliveMessage) {
    const defaultAliveMessage = "🟢 Çevrimiçiyim!";
    return await message.sendReply(defaultAliveMessage);
  }

  if (aliveMessage.includes("$")) {
    const parsedMessage = await parseAliveMessage(aliveMessage, message);
    if (parsedMessage) {
      await sendAliveMessage(message, parsedMessage);
    } else {
      await message.sendReply(aliveMessage);
    }
  } else {
    await message.sendReply(aliveMessage);
  }
}

const manage = {
  setVar: async (key, value, message) => {
    await message.sendReply(
      `_ℹ️ ${key} değeri ${value} olarak ayarlanmaya çalışıldı. (Not: Bu bir demo ve değişiklikler kalıcı değildir)_`
    );
  },
};

Module({
  pattern: "kontrol",
  fromMe: false,
  desc: "Sistemin çalışma durumunu kontrol eder.",
  usage: ".kontrol",
},
  async (message, match) => {
    await parseAlive(message, ALIVE);
  }
);

Module({
  pattern: "setalive ?(.*)",
  fromMe: true,
  desc: "Botun çevrimiçi olduğunu gösteren (alive) mesajını kişiselleştirmenizi sağlar.",
  usage: ".setalive [mesaj] | .setalive yardım | .setalive getir",
  dontAddCommandList: true,
},
  async (message, match) => {
    if (!match[1]) {
      return await message.sendReply(`*📝 Çevrimiçi Mesaj Ayarları*

*Kullanım:*
• \`.setalive <mesaj>\` - Çevrimiçi mesajı ayarla
• \`.setalive help\` - Biçimlendirme yardımını göster
• \`.setalive get\` - Mevcut çevrimiçi mesajı görüntüle
• \`.setalive del\` - Özel çevrimiçi mesajı sil
• \`.testalive\` - Mevcut çevrimiçi mesajı test et

*Hızlı Örnek:*
\`.setalive Merhaba $user! $botname çevrimiçi!
_Sürüm: $version_
_Çalışma süresi: $uptime_
_Kullanıcılar: $users_ $pp\`

*Tüm yer tutucular için \`.setalive help\` kullanın.*`);
    }

    const input = match[1].toLowerCase();

    if (input === "yardım") {
      const helpText = `*📖 Çevrimiçi Mesaj Biçimlendirme Yardımı*

*Kullanılabilir Yer Tutucular:*

*Bot Bilgileri:*
• \`$botname\` - Botun görünen adı
• \`$owner\` - Bot sahibi adı
• \`$version\` - Bot sürümü
• \`$mode\` - Bot modu (özel/genel)
• \`$server\` - Sunucu işletim sistemi
• \`$uptime\` - Bot çalışma süresi

*Sistem Bilgileri:*
• \`$ram\` - Kullanılabilir RAM
• \`$totalram\` - Toplam RAM
• \`$users\` - Veritabanındaki toplam kullanıcı

*Kullanıcı Bilgileri:*
• \`$user\` - Gönderenin adı
• \`$number\` - Gönderenin numarası
• \`$date\` - Güncel tarih
• \`$time\` - Güncel saat

*Medya Seçenekleri:*
• \`$pp\` - Gönderenin profil fotoğrafı
• \`$media:url\` - Özel görsel/video URL'si

*Örnek Mesajlar:*

*Basit:*
\`Merhaba $user! $botname çevrimiçi!\`

*Detaylı:*
\`*$botname Durumu*
_Merhaba $user!_
*İstatistikler:*
• _Sürüm: $version_
• _Mod: $mode_
• _Çalışma süresi: $uptime_
• _Kullanıcılar: $users_
• _RAM: $ram/$totalram_
*Tarih:* _$date saat $time_ $pp\`

*Özel Medya ile:*
\`$botname çevrimiçi! $media:https://example.com/image.jpg\`

*Video ile (otomatik gif oynatma):*
\`Bot durumu: Aktif! $media:https://example.com/video.mp4\`

*Notlar:*
• Mesajlar 2000 karakterle sınırlıdır
• Videolar otomatik GIF olarak oynar
• \`$pp\` gönderenin profil fotoğrafını içerir
• \`$media:\` içindeki URL'ler doğrudan bağlantı olmalıdır
• Çok kelimeli mesajlar için tırnak kullanın`;

      return await message.sendReply(helpText);
    }

    if (input === "getir") {
      const current = ALIVE;
      if (!current) {
        return await message.sendReply("_⚙️ Özel çevrimiçi mesajı ayarlanmadı! Varsayılan mesaj kullanılıyor._"
        );
      }
      return await message.sendReply(
        `*📄 Mevcut Çevrimiçi Mesaj:*\n\n${current}\n\n_💡 İpucu: Mesajınızı test etmek için_ \`.testalive\` _kullanın!_`
      );
    }

    if (input === "sil") {
      await setVar("ALIVE", "");
      return await message.sendReply("_🗑️ Özel çevrimiçi mesaj silindi! Bot varsayılan mesajı kullanacak._"
      );
    }

    const aliveMessage = censorBadWords(match[1]);
    if (aliveMessage.length > 2000) {
      return await message.sendReply("_⚠️ Çevrimiçi mesajı çok uzun! Lütfen 2000 karakterin altında tutun._"
      );
    }

    await setVar("ALIVE", aliveMessage);
    return await message.sendReply(
      `_✅ Çevrimiçi mesaj başarıyla ayarlandı!_\n\n*📋 Önizleme:*\n${aliveMessage}\n\n_💡 İpucu: Mesajınızı test etmek için_ \`.testalive\` _kullanın!_`
    );
  }
);

Module({
  pattern: "menü",
  fromMe: false,
  desc: "Botun ana komut menüsünü ve temel istatistiklerini gösteren şık bir arayüz açar.",
  usage: ".menü",
  use: "genel",
},
  async (message, match) => {
    const stars = ["✦", "✯", "✯", "✰", "◬"];
    const star = stars[Math.floor(Math.random() * stars.length)];

    const cmds = typeof commands === 'function' ? commands() : commands;
    const visibleCommands = cmds.filter(
      (cmd) =>
        cmd.pattern &&
        !cmd.excludeFromCommands &&
        !cmd.dontAddCommandList
    );
    let use_ = visibleCommands.map((e) => e.use);
    const others = (use) => {
      return use === "" ? "diğer" : use;
    };
    let types = [
      ...new Set(
        visibleCommands.map((e) => e.use || "Genel")
      ),
    ];

    let cmd_obj = {};
    for (const command of visibleCommands) {
      let type_det = command.use || "Genel";
      if (!cmd_obj[type_det]?.length) cmd_obj[type_det] = [];
      let cmd_name = extractCommandName(command.pattern);
      if (cmd_name) cmd_obj[type_det].push(cmd_name);
    }

    let final = "";
    let i = 0;
    const safeHandlers = typeof HANDLERS === 'string' ? HANDLERS : String(HANDLERS);
    const handlerPrefix = safeHandlers !== "false" ? safeHandlers.split("")[0] : "";
    for (const n of types) {
      for (const x of cmd_obj[n]) {
        i = i + 1;
        const newn = CATEGORY_TR[n] || n.charAt(0).toUpperCase() + n.slice(1);
        final += `${final.includes(newn) ? "" : "\n\n╭════〘 *_`" + newn + "`_* 〙════⊷❍"
          }\n┃${star}│ _\`${i}.\` ${handlerPrefix}${x.trim()}_${cmd_obj[n]?.indexOf(x) === cmd_obj[n]?.length - 1
            ? `\n┃${star}╰─────────────────❍\n╰══════════════════⊷❍`
            : ""
          }`;
      }
    }

    let cmdmenu = final.trim();
    const used = bytesToSize(os.freemem());
    const total = bytesToSize(os.totalmem());
    const totalUsers = await getTotalUserCount();
    const botInfo = config.BOT_INFO || "Lades-Pro;Lades-Pro;";
    const infoParts = botInfo.split(";");
    const botName = infoParts[0] || "Lades-Pro";
    const botOwner = infoParts[1] || "Lades-Pro";
    const botVersion = VERSION;
    // Görsel: Sadece Northflank/env'de HTTP URL ayarlıysa dış kaynak kullanılır. Aksi halde repo içi varsayılan dosya.
    const imagePart = infoParts.find((p) => (p || "").trim().startsWith("http"));
    const botImageUrl = (imagePart || "").trim();
    const imagesDir = path.join(__dirname, "utils", "images");
    const localCandidates = ["varsayılan.jpg", "varsayılan.png"];
    let imagePayload;
    if (botImageUrl && botImageUrl.startsWith("http")) {
      imagePayload = { url: botImageUrl };
    } else {
      const localPath = localCandidates.find((f) =>
        fs.existsSync(path.join(imagesDir, f))
      );
      imagePayload = localPath
        ? { url: path.join(imagesDir, localPath) }
        : null;
    }

    const senderName = (message.pushName || message.senderName || message.sender || "Kullanıcı").replace(/[\r\n]+/gm, "");
    const menu = `╭═══〘 \`${botName}\` 〙═══⊷❍
┃${star}╭──────────────
┃${star}│
┃${star}│ _*\`Geliştiricim\`*_ : ${botOwner}
┃${star}│ _*\`Üye\`*_ : ${senderName}
┃${star}│ _*\`Mod\`*_ : ${MODE === "private" ? "Sadece Yönetici" : "Herkese Açık"}
┃${star}│ _*\`Sunucu\`*_ : ${{ "win32": "Windows", "linux": "Linux", "darwin": "MacOS", "android": "Android" }[os.platform()] || os.platform()}
┃${star}│ _*\`Kullanılabilir RAM\`*_ : ${used} / ${total}
┃${star}│ _*\`Toplam Kullanıcı\`*_ : ${totalUsers}
┃${star}│ _*\`Versiyon\`*_ : ${botVersion}
┃${star}│
┃${star}│
┃${star}│  ▎▍▌▌▉▏▎▌▉▐▏▌▎
┃${star}│  ▎▍▌▌▉▏▎▌▉▐▏▌▎
┃${star}│   ${botName}
┃${star}│
┃${star}╰───────────────
╰═════════════════⊷

${cmdmenu}`;
    try {
      if (imagePayload) {
        await message.client.sendMessage(message.jid, {
          image: imagePayload,
          caption: menu,
        });
      } else {
        await message.client.sendMessage(message.jid, { text: menu });
      }
    } catch (error) {
      console.error("Menü görseli gönderilirken hata:", error);
      await message.client.sendMessage(message.jid, { text: menu });
    }
  }
);
Module({
  pattern: "oyunlar ?(.*)",
  fromMe: false,
  desc: "Bot üzerinde oynanabilecek tüm eğlenceli oyunları ve kurallarını listeler.",
  usage: ".oyunlar",
},
  async (message, args) => {
    const cmds = typeof commands === 'function' ? commands() : commands;
    const gameCommands = cmds.filter(
      (cmd) => cmd.use === "game" && cmd.pattern
    );
    if (!gameCommands.length) {
      return await message.sendReply("_🎮 Yüklü oyun yok ki._");
    }
    const handlerPrefix = HANDLERS.match(/\[(\W*)\]/)?.[1]?.[0] || ".";
    let response = `*🎮 ───「 Mevcut Oyunlar 」───*\n\n`;
    response += `*🤖 Bot Oyunları:*\n`;
    response += `• \`${handlerPrefix}bilmece\` - Bilmece sorar\n`;
    response += `• \`${handlerPrefix}kimyasoru\` - Kimya sorusu\n`;
    response += `• \`${handlerPrefix}beyin\` - IQ/Beyin sorusu\n`;
    response += `• \`${handlerPrefix}aşkölç\` - Aşk ölçer\n\n`;

    response += `*🏰 Özel Oyunlar:*\n`;
    response += `• \`${handlerPrefix}bilgiyarismasi\` - Family 100 tarzı yarışma\n`;
    response += `• \`${handlerPrefix}matoyun\` - Matematik sorusu\n`;
    response += `• \`${handlerPrefix}gorseltahmin\` - Görsel tahmin\n`;
    response += `• \`${handlerPrefix}logotahmin\` - Logo tahmin\n`;
    response += `• \`${handlerPrefix}bayraktahmin\` - Bayrak hangi ülkenin?\n`;
    response += `• \`${handlerPrefix}bulmaca\` - Genel bulmaca\n`;
    response += `• \`${handlerPrefix}kelemediz\` - Harf dizmece\n`;

    await message.sendReply(response);
  }
);

Module({
  pattern: "setname ?(.*)",
  fromMe: true,
  desc: "Grup üzerinde görünen üye etiketini belirlediğiniz yeni isimle günceller.",
  usage: ".setname [yeni_isim]",
  use: "sahip",
},
  async (message, match) => {
    const name = match[1]?.trim();
    if (!name)
      return await message.sendReply("_💬 İsim verin: .setname Lades_");
    const parts = config.BOT_INFO.split(";");
    parts[0] = name;
    await setVar("BOT_INFO", parts.join(";"));
    return await message.sendReply(
      `_✅ Bot adı başarıyla güncellendi!_\n\n*📋 Yeni Ad:* ${name}`
    );
  }
);

Module({
  pattern: "setimage",
  fromMe: true,
  desc: "Botun profil görselini yanıtladığınız görselle değiştirir.",
  usage: ".setimage [yanıtla]",
  use: "sahip",
},
  async (message, match) => {
    if (!message.reply_message || !message.reply_message.image) {
      return await message.sendReply("_🖼️ Bir resmi .setimage ile yanıtlayın_");
    }

    try {
      const downloadedFile = await message.reply_message.download();

      const uploadRes = await uploadToImgbb(downloadedFile);

      try {
        await fs.promises.unlink(downloadedFile);
      } catch (e) {
        console.log("Geçici dosya silinemedi:", downloadedFile);
      }

      const url = uploadRes.url || uploadRes.display_url;
      if (!url) {
        return await message.sendReply("_❌ Görsel yüklemesi başarısız oldu._");
      }

      const parts = config.BOT_INFO.split(";");
      while (parts.length < 3) parts.push("");
      parts[parts.length - 1] = url;
      await setVar("BOT_INFO", parts.join(";"));
      return await message.sendReply(
        `_✅ Bot görseli başarıyla güncellendi!_\n\n*🖼️ Yeni Görsel URL:* ${url}`
      );
    } catch (error) {
      console.error("Görsel ayarlanırken hata:", error);
      return await message.sendReply("_⚠️ Görsel ayarlanamadı. Lütfen tekrar deneyin._"
      );
    }
  }
);
Module({
  pattern: "testalive",
  fromMe: true,
  desc: "Belirlediğiniz çevrimiçi mesajının bot üzerinde nasıl göründüğünü test etmenizi sağlar.",
  usage: ".testalive",
  use: "sahip",
},
  async (message, match) => {
    const aliveMessage = ALIVE;

    if (!aliveMessage) {
      return await message.sendReply("*💬 Varsayılan Çevrimiçi Mesaj Test Ediliyor:*\nÇevrimiçiyim!"
      );
    }

    await message.sendReply("*💬 Çevrimiçi Mesajı Test Ediliyor:*");
    await parseAlive(message, aliveMessage);
  }
);


const BILDIRIM_JID = "120363258254647790@g.us";
const getBildirimJid = () => BILDIRIM_JID || null;

const KATEGORILER = {
  istek: { emoji: "🙏", label: "İstek" },
  sikayet: { emoji: "😤", label: "Şikayet" },
  hata: { emoji: "🐛", label: "Hata" },
  oneri: { emoji: "💡", label: "Öneri" },
  talep: { emoji: "📋", label: "Talep" },
};

const normalizeKategori = (raw) => {
  const map = {
    istek: "istek",
    şikayet: "sikayet",
    sikayet: "sikayet",
    hata: "hata",
    öneri: "oneri",
    oneri: "oneri",
    talep: "talep",
  };
  return map[raw.toLowerCase()] || null;
};

Module({
  pattern: "bildir ?(.*)",
  fromMe: false,
  desc: "Bot hakkında istek, şikayet, hata, öneri veya talebinizi iletir.",
  use: "araçlar",
  usage:
    ".bildir istek <mesaj>\n" +
    ".bildir şikayet <mesaj>\n" +
    ".bildir hata <mesaj>\n" +
    ".bildir öneri <mesaj>\n" +
    ".bildir talep <mesaj>",
},
  async (message, match) => {
    const input = match[1]?.trim() || "";
    if (!input) {
      return message.sendReply(
        `📣 *Bot Bildirim Merkezi*\n\n` +
        `_Bot hakkındaki her türlü görüşünü bize iletebilirsin!_\n\n` +
        `*Kategoriler:*\n` +
        `🙏🏻 \.bildir istek <mesaj>\` — Özellik isteği\n` +
        `😤 \.bildir şikayet <mesaj>\` — Şikayet\n` +
        `🐛 \.bildir hata <mesaj>\` — Hata bildirimi\n` +
        `💡 \.bildir öneri <mesaj>\` — Fikir/Öneri\n` +
        `📋 \.bildir talep <mesaj>\` — Özel talep\n\n` +
        `💬 _Örnek: \.bildir hata Şarkı komutu çalışmıyor\`_`
      );
    }

    const parts = input.split(" ");
    const kategoriKey = normalizeKategori(parts[0]);
    if (!kategoriKey) {
      return message.sendReply(
        `❓ *Geçersiz kategori:* \`${parts[0]}\`\n\n` +
        `🔻 _Geçerli kategoriler:_\n` +
        `🙏 istek · 😤 şikayet · 🐛 hata · 💡 öneri · 📋 talep`
      );
    }

    const metin = parts.slice(1).join(" ").trim();
    if (!metin) {
      const { emoji, label } = KATEGORILER[kategoriKey];
      return message.sendReply(
        `${emoji} *${label}* için bir mesaj yazmalısın.\n\n` +
        `_Örnek: \.bildir ${parts[0]} Mesajınız buraya...\`_`
      );
    }

    const kufurIceriyor = badWords.some((word) =>
      metin.toLowerCase().includes(word.toLowerCase())
    );
    const iletilecekMetin = kufurIceriyor ? censorBadWords(metin) : metin;

    const hedefJid = getBildirimJid();
    if (!hedefJid) {
      return message.sendReply(
        `⚙️ _Bildirim sistemi henüz yapılandırılmamış!_\n` +
        `_Lütfen geliştiricimi bilgilendirin._`
      );
    }

    const { emoji, label } = KATEGORILER[kategoriKey];
    const gonderenJid = message.sender || message.jid;
    const tarih = new Date().toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    let grupBilgisi = "💬 *DM üzerinden iletildi*";
    if (message.isGroup) {
      try {
        const meta = await message.client.groupMetadata(message.jid);
        grupBilgisi = `👥 *Grup:* ${meta.subject}\n🆔 *Grup JID:* ${message.jid}`;
      } catch {
        grupBilgisi = `👥 *Grup JID:* ${message.jid}`;
      }
    }

    const bildirimMesaji =
      `${emoji} *Yeni ${label} Bildirimi!*\n` +
      `${"─".repeat(30)}\n` +
      `👤 *Gönderen:* @${gonderenJid.split("@")[0]}\n` +
      `${grupBilgisi}\n` +
      `🕐 *Tarih:* ${tarih}\n` +
      `${"─".repeat(30)}\n` +
      `${emoji} *Mesaj:*\n${iletilecekMetin}`;

    try {
      await message.client.sendMessage(hedefJid, {
        text: bildirimMesaji,
        mentions: [gonderenJid],
      });
      return message.sendReply(
        `✅ *Bildiriminizi gönderdim, teşekkürler!*\n\n` +
        `${emoji} *Kategori:* ${label}\n` +
        `📝 *Mesajınız:* _${iletilecekMetin}_\n` +
        (kufurIceriyor
          ? `🚫➡️✅ *Not:* Uygunsuz ifade varsa sansürlenerek iletildi.\n\n`
          : `\n`) +
        `_En kısa sürede değerlendirilecektir._ 🙌🏻`
      );
    } catch (err) {
      console.error("[Bildir] Mesaj gönderilemedi:", err?.message || err);
      return message.sendReply(
        "❌ _Bildirim gönderilirken bir hata oluştu. Lütfen daha sonra tekrar deneyin._"
      );
    }
  }
);


const cityCodes = {
  "01": "Adana", "02": "Adıyaman", "03": "Afyonkarahisar", "04": "Ağrı", "05": "Amasya",
  "06": "Ankara", "07": "Antalya", "08": "Artvin", "09": "Aydın", "10": "Balıkesir",
  "11": "Bilecik", "12": "Bingöl", "13": "Bitlis", "14": "Bolu", "15": "Burdur",
  "16": "Bursa", "17": "Çanakkale", "18": "Çankırı", "19": "Çorum", "20": "Denizli",
  "21": "Diyarbakır", "22": "Edirne", "23": "Elazığ", "24": "Erzincan", "25": "Erzurum",
  "26": "Eskişehir", "27": "Gaziantep", "28": "Giresun", "29": "Gümüşhane", "30": "Hakkari",
  "31": "Hatay", "32": "Isparta", "33": "Mersin", "34": "İstanbul", "35": "İzmir",
  "36": "Kars", "37": "Kastamonu", "38": "Kayseri", "39": "Kırklareli", "40": "Kırşehir",
  "41": "Kocaeli", "42": "Konya", "43": "Kütahya", "44": "Malatya", "45": "Manisa",
  "46": "Kahramanmaraş", "47": "Mardin", "48": "Muğla", "49": "Muş", "50": "Nevşehir",
  "51": "Niğde", "52": "Ordu", "53": "Rize", "54": "Sakarya", "55": "Samsun", "56": "Siirt",
  "57": "Sinop", "58": "Sivas", "59": "Tekirdağ", "60": "Tokat", "61": "Trabzon",
  "62": "Tunceli", "63": "Şanlıurfa", "64": "Uşak", "65": "Van", "66": "Yozgat",
  "67": "Zonguldak", "68": "Aksaray", "69": "Bayburt", "70": "Karaman", "71": "Kırıkkale",
  "72": "Batman", "73": "Şırnak", "74": "Bartın", "75": "Ardahan", "76": "Iğdır",
  "77": "Yalova", "78": "Karabük", "79": "Kilis", "80": "Osmaniye", "81": "Düzce",
};

const turkishCities = Object.values(cityCodes).map((city) => city.toLowerCase());

async function sendWeatherMessage(m, message) {
  try {
    await m.sendReply(message);
  } catch (error) {
    console.error("Mesaj gönderme hatası:", error);
  }
}

function isTurkishCity(cityName) {
  return turkishCities.includes(cityName.toLowerCase());
}

function normalizeTurkishCharacters(text) {
  return text
    .replace(/ö/g, "o")
    .replace(/Ö/g, "O")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "U")
    .replace(/ş/g, "s")
    .replace(/Ş/g, "S")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "C")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "G");
}

function getTimeBasedEmoji(temp) {
  const turkeyTime = new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" });
  const turkeyDate = new Date(turkeyTime);
  const hour = turkeyDate.getHours();

  if (hour >= 22 || hour < 5) {
    if (temp <= 0) return { start: "🌙", end: "❄️" };
    if (temp <= 10) return { start: "🌙", end: "🥶" };
    if (temp <= 20) return { start: "🌙", end: "😴" };
    return { start: "🌙", end: "🔥" };
  }
  if (hour >= 5 && hour < 12) {
    if (temp <= 0) return { start: "🌅", end: "❄️" };
    if (temp <= 10) return { start: "🌅", end: "🥶" };
    if (temp <= 20) return { start: "🌅", end: "☕" };
    return { start: "🌅", end: "☀️" };
  }
  if (hour >= 12 && hour < 19) {
    if (temp <= 0) return { start: "☀️", end: "❄️" };
    if (temp <= 10) return { start: "🌤️", end: "🧥" };
    if (temp <= 20) return { start: "☀️", end: "😊" };
    if (temp <= 30) return { start: "☀️", end: "🔥" };
    return { start: "🔥", end: "🥵" };
  }
  if (hour >= 19 && hour < 22) {
    if (temp <= 0) return { start: "🌆", end: "❄️" };
    if (temp <= 10) return { start: "🌆", end: "🧥" };
    if (temp <= 20) return { start: "🌆", end: "😌" };
    return { start: "🌆", end: "🔥" };
  }
  return { start: "🌡️", end: "📍" };
}

Module({
  pattern: "hava ?(.*)",
  fromMe: false,
  desc: "Belirlediğiniz konuma ait güncel hava durumu verilerini, sıcaklık ve nem bilgilerini getirir.",
  usage: ".hava [şehir/ilçe]",
  use: "arama",
},
  async (m, match) => {
    const restrictedGroupId = "905396978235-1601666238@g.us";
    if (m.jid === restrictedGroupId) {
      await sendWeatherMessage(m, "❗ *Bu komut sadece sohbet grubunda kullanılabilir!*");
      return;
    }

    const queriedCity = match[1]?.trim();
    if (!queriedCity) {
      await sendWeatherMessage(m, "❗ Lütfen bir şehir adı belirtiniz.");
      return;
    }

    const normalizedCity = normalizeTurkishCharacters(queriedCity);
    const city = cityCodes[normalizedCity] || normalizedCity;

    try {
      const API_KEY = "3df525a18b9fc5c3a689ac0456be979c";
      const encodedCity = encodeURIComponent(city);
      const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodedCity}&appid=${API_KEY}&units=metric&lang=tr`;
      const response = await axios.get(apiUrl);
      const data = response.data;

      if (data.cod === "404" || data.cod === 404) {
        await sendWeatherMessage(
          m,
          `❌ Konum bulunamadı: ${queriedCity}\n💬 *Örnek: _.hava şehir veya ilçe veya mahalle_*`
        );
        return;
      }

      const { main, wind, weather } = data;
      const temp = Math.round(main.temp);
      const humidity = main.humidity;
      const windSpeed = wind.speed;
      const description = weather[0].description;
      const cityName = data.name;
      const emojiPair = getTimeBasedEmoji(temp);
      const cityBadge = isTurkishCity(cityName) ? " 🇹🇷" : "";

      await sendWeatherMessage(
        m,
        `📍 *${cityName}${cityBadge}* için hava durumu:\n` +
        `${emojiPair.start} Sıcaklık: *${temp}°C* - ${description} ${emojiPair.end}\n` +
        `💧 Nem: *%${humidity}*\n` +
        `💨 Rüzgar: *${windSpeed} m/s*`
      );
    } catch (error) {
      if (error.response?.status === 404) {
        await sendWeatherMessage(
          m,
          "❌ Belirtilen konum bulunamadı!\n💬 *Örnek: _.hava şehir veya ilçe veya mahalle_*"
        );
      } else {
        await sendWeatherMessage(
          m,
          "⚠️ Hava durumu bilgisi alınırken bir hata oluştu. Tekrar deneyiniz."
        );
      }
    }
  }
);


const currencyMap = {
  'dolar': 'USD', 'tl': 'TRY', 'euro': 'EUR', 'sterlin': 'GBP', 'frank': 'CHF',
  'yen': 'JPY', 'yuan': 'CNY', 'rupi': 'INR', 'ruble': 'RUB', 'real': 'BRL',
  'kanada doları': 'CAD', 'avustralya doları': 'AUD', 'yeni zelanda doları': 'NZD',
  'hong kong doları': 'HKD', 'singapur doları': 'SGD', 'güney afrika randı': 'ZAR',
  'isviçre frangı': 'CHF', 'çin yuanı': 'CNY', 'japon yeni': 'JPY',
  'hindistan rupisi': 'INR', 'güney kore wonu': 'KRW', 'meksika pezosu': 'MXN',
  'norveç kronu': 'NOK', 'pakistan rupisi': 'PKR', 'rus rublesi': 'RUB',
  'suudi arabistan riyali': 'SAR', 'türk lirası': 'TRY', 'amerikan doları': 'USD',
};

function parseAmount(input) {
  let s = input.replace(/\s+/g, '');
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    if (s.lastIndexOf('.') > s.lastIndexOf(',')) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(/\./g, '').replace(/,/g, '.');
    }
  } else if (hasComma) {
    s = s.replace(/,/g, '.');
  }
  const num = parseFloat(s);
  return isNaN(num) ? null : num;
}

const createApiUrl = (fromCurrency, toCurrency, amount) =>
  `https://v6.exchangerate-api.com/v6/9f2e3e44d65670cb05593bd9/pair/${fromCurrency}/${toCurrency}/${amount}`;

Module({
  pattern: 'kur ?(.*)',
  fromMe: false,
  desc: 'Belirli bir miktarın iki para birimi arasındaki döviz kuru dönüşümünü hesaplar.',
  usage: '.kur 2,375.99 dolar tl',
  use: 'araçlar',
},
  async (message, match) => {
    if (message.jid === "905396978235-1601666238@g.us") {
      return message.client.sendMessage(message.jid,
        { text: "❗ *Bu komut sadece sohbet grubunda kullanılabilir!*" }
      );
    }
    const userInput = (match[1] || '').trim();
    if (!userInput) {
      return message.sendReply('❗️ Lütfen geçerli bir giriş yapınız. Örnek: *.kur 1 dolar tl*');
    }
    const parts = userInput.split(/\s+/);
    if (parts.length < 3) {
      return message.sendReply('❗️ Lütfen geçerli bir giriş yapınız. Örnek: *.kur 1 dolar tl*');
    }
    const rawAmount = parts.shift();
    const rawToCurrency = parts.pop();
    const rawFromCurrency = parts.join(' ');
    const amount = parseAmount(rawAmount);
    const fromCurrency = currencyMap[rawFromCurrency.toLowerCase()] || rawFromCurrency.toUpperCase();
    const toCurrency = currencyMap[rawToCurrency.toLowerCase()] || rawToCurrency.toUpperCase();
    if (amount === null || !isFinite(amount) || !fromCurrency || !toCurrency) {
      return message.sendReply('❗️ Lütfen geçerli bir giriş yapınız. Örneğin: *.kur 1 dolar tl*');
    }
    try {
      const apiUrl = createApiUrl(fromCurrency, toCurrency, amount);
      const response = await axios.get(apiUrl);
      if (response.data.result === 'success') {
        const converted = Number(response.data.conversion_result).toFixed(2);
        const today = new Date();
        const dateStr = `${today.getDate()}.${today.getMonth() + 1}.${today.getFullYear()}`;
        return message.sendReply(
          `📆 ${dateStr} itibariyle
💱 *${amount} ${fromCurrency} = ${converted} ${toCurrency}*`
        );
      } else {
        throw new Error('API dönüş hatası');
      }
    } catch (err) {
      console.error('Döviz kuru dönüşümü yapılamadı:', err.message);
      return message.sendReply(
        '⚠️ Döviz kuru dönüşümü yapılamadı! Lütfen para birimlerini kontrol ediniz.'
      );
    }
  });

Module({
  pattern: "resim ?(.*)",
  fromMe: false,
  desc: "İnternet üzerinden belirlediğiniz anahtar kelimeye uygun görseller bulur ve gönderir.",
  usage: ".resim [sorgu]",
  use: "arama",
},
  async (message, match) => {
    const query = (match[1] || "").trim();
    if (!query) return await message.sendReply("🔍 _Konu girin:_ `.resim kedi`");
    try {
      const results = await nxTry([
        `/search/googleimage?q=${encodeURIComponent(query)}`,
        `/search/bingimage?q=${encodeURIComponent(query)}`,
      ]);
      if (!results?.length) throw new Error("Sonuç bulamadım");
      const pick = results[Math.floor(Math.random() * Math.min(results.length, 5))];
      const imgUrl = pick.url || pick.image || pick.link || pick.original || pick.thumbnail;
      if (!imgUrl) throw new Error("Görsel URL bulamadım");
      await message.client.sendMessage(message.jid, {
        image: { url: imgUrl },
        caption: `🔍 *${query}*`,
      }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ _Görsel bulamadım:_ ${e.message}`);
    }
  }
);

Module({
  pattern: "yemekt ?(.*)",
  fromMe: false,
  desc: "Geniş bir yemek tarifi kütüphanesinden istediğiniz yemeğin hazırlanışını ve malzemelerini getirir.",
  usage: ".yemekt [yemek_adı]",
  use: "arama",
},
  async (message, match) => {
    const query = (match[1] || "").trim();
    if (!query) return await message.sendReply("🍳 _Yemek adı girin:_ `.yemekt pilav`");
    try {
      const wait = await message.send("🍳 _Tarif aranıyor..._");
      const r = await nxTry([
        `/search/resep?q=${encodeURIComponent(query)}`,
      ]);
      const title = r.title || r.judul || query;
      const desc = r.desc || r.description || "";
      const time = r.waktu || r.time || r.duration || "-";
      const portions = r.porsi || r.portions || "-";
      const diff = r.kesulitan || r.difficulty || "-";
      const thumb = r.thumb || r.thumbnail || r.image;

      let caption = `🍳 *${title}*\n\n`;
      if (desc) caption += `📝 ${desc}\n\n`;
      caption += `⏱️ *Süre:* ${time}\n`;
      caption += `🍽️ *Porsiyon:* ${portions}\n`;
      caption += `📊 *Zorluk:* ${diff}\n\n`;

      if (r.bahan || r.ingredients) caption += `🛒 *Malzemeler:*\n${r.bahan || r.ingredients}\n\n`;
      if (r.cara || r.instructions || r.steps) caption += `👨‍🍳 *Hazırlanışı:*\n${r.cara || r.instructions || r.steps}`;

      await message.edit("✅ _Bulundu!_", message.jid, wait.key);
      if (thumb) {
        await message.client.sendMessage(message.jid, { image: { url: thumb }, caption }, { quoted: message.data });
      } else {
        await message.client.sendMessage(message.jid, { text: caption }, { quoted: message.data });
      }
    } catch (e) {
      await message.sendReply(`❌ _Tarif bulunamadı:_ ${e.message}`);
    }
  }
);

