"use strict";

/**
 * Merged Module: tools.js
 * Components: commands.js, komutlar.js, dc.js, utility.js
 */

// ==========================================
// FILE: commands.js
// ==========================================
(function () {
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

  const getCategoryPriority = (category) => {
    const cat = (category || "").toLowerCase();
    // 1. En düşük puan (0-10): Genel ve Herkesin kullanabildiği komutlar
    if (["genel", "download", "search", "tools", "edit", "media", "fun", "game", "dini", "chat", "ai", "araçlar", "indirme", "arama", "eğlence", "oyun", "düzenleme", "medya"].includes(cat)) return 5;

    // 2. Orta puan (50): Yönetici ve Grup komutları
    if (["grup", "group", "koruma"].includes(cat)) return 50;

    // 3. En yüksek puan (100): Kurucu ve Sistem komutları (En son görünecekler)
    if (["owner", "system", "sahip", "sistem"].includes(cat)) return 100;

    return 10; // Bilinmeyenler genelden biraz sonra
  };

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

      const sortedCategories = Object.keys(categorizedCommands).sort((a, b) => {
        return getCategoryPriority(a) - getCategoryPriority(b);
      });

      for (const category of sortedCategories) {
        const catLabels = {
          'sistem': '⚙️ Sistem & Sahip',
          'sahip': '👑 Sahip',
          'grup': '👥 Grup Yönetimi',
          'yapay-zeka': '🤖 Yapay Zeka',
          'indirme': '⬇️ İndirme Merkezi',
          'medya': '🎨 Medya & Tasarım',
          'araçlar': '🛠️ Araçlar & Bilgi',
          'eğlence': '🎮 Oyun & Eğlence',
          'dini': '🕌 Dini Bilgiler',
          'sohbet': '💬 Sohbet & Mesaj',
          'genel': '📦 Genel Komutlar',
          'arama': '🔍 Arama',
          'düzenleme': '🖌️ Düzenleme',
          'koruma': '🛡️ Koruma & Güvenlik'
        };
        const catLabel = catLabels[category] || category.charAt(0).toUpperCase() + category.slice(1);
        responseMessage += `*───「 ${catLabel} 」───*\n\n`;
        categorizedCommands[category].forEach((cmd) => {
          responseMessage += `• \`${handlerPrefix}${cmd.name}\`\n`;
          if (cmd.desc) responseMessage += `  _Açıklama:_ ${cmd.desc}\n`;
          if (cmd.usage) responseMessage += `  _Kullanım:_ ${cmd.usage}\n`;
          if (cmd.warn) responseMessage += `  _Uyarı:_ ${cmd.warn}\n`;
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
      const defaultAliveMessage = "🤭 *Hey pampa! Korkma, ben aktifim.*";
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
\`.setalive *Merhaba $user! $botname çevrimiçi!*
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
          return await message.sendReply("⚙️ *Özel çevrimiçi mesajı ayarlanmadı! Varsayılan mesaj kullanılıyor.*"
          );
        }
        return await message.sendReply(
          `*📄 Mevcut Çevrimiçi Mesaj:*\n\n${current}\n\n_💡 İpucu: Mesajınızı test etmek için_ \`.testalive\` _kullanın!_`
        );
      }

      if (input === "sil") {
        await setVar("ALIVE", "");
        return await message.sendReply("🗑️ *Özel çevrimiçi mesaj silindi! Bot varsayılan mesajı kullanacak.*"
        );
      }

      const aliveMessage = censorBadWords(match[1]);
      if (aliveMessage.length > 2000) {
        return await message.sendReply("⚠️ *Çevrimiçi mesajı çok uzun! Lütfen 2000 karakterin altında tutun.*"
        );
      }

      await setVar("ALIVE", aliveMessage);
      return await message.sendReply(
        `✅ *Çevrimiçi mesaj başarıyla ayarlandı!*\n\n*📋 Önizleme:*\n${aliveMessage}\n\n_💡 İpucu: Mesajınızı test etmek için_ \`.testalive\` _kullanın!_`
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
      const stars = ["✦", "✯", "✯", "✰"];
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
      ].sort((a, b) => getCategoryPriority(a) - getCategoryPriority(b));

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
      const used = bytesToSize(process.memoryUsage().rss); // Northflank Container RAM Usage Fix
      const total = bytesToSize(os.totalmem());
      const totalUsers = await require("../core/store").getTotalUserCount();
      const botInfo = config.BOT_INFO || "Lades-Pro;Lades-Pro;";
      const infoParts = botInfo.split(";");
      const botName = infoParts[0] || "Lades-Pro";
      const botOwner = infoParts[1] || "Lades-Pro";
      const botVersion = VERSION;
      // Görsel Yükleme Mantığı (Geliştirilmiş & Stabil)
      let imgContent = null;
      let imgMimeType = "image/jpeg";
      const imagePart = infoParts.find((p) => (p || "").trim().startsWith("http"));
      const botImageUrl = (imagePart || "").trim();

      if (botImageUrl && botImageUrl.startsWith("http")) {
        imgContent = { url: botImageUrl };
      } else {
        const imagesDir = path.join(__dirname, "utils", "images");
        const localCandidates = ["logo.jpg", "logo.png"];
        const localFile = localCandidates.find((f) => fs.existsSync(path.join(imagesDir, f)));

        if (localFile) {
          // Cloud/Container (Bulut sunucu) uyumluluğu için URL/Path Object okuma yerine kesin buffer kullanılır.
          imgContent = fs.readFileSync(path.join(imagesDir, localFile));
          if (localFile.endsWith('.png')) imgMimeType = "image/png";
        }
      }

      if (!imgContent) {
        config.logger.warn(`[Menu] Logo bulunamadı. BOT_INFO URL veya local logo.jpg/png eksik.`);
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
        const channelOpts = {
          contextInfo: {
            isForwarded: true,
            forwardingScore: 999,
            forwardedNewsletterMessageInfo: {
              newsletterJid: process.env.CHANNEL_JID || "120363427366763599@newsletter",
              newsletterName: "📢 " + (process.env.BOT_NAME || "Güncellemeler"),
              serverMessageId: -1
            }
          }
        };

        if (imgContent) {
          await message.client.sendMessage(message.jid, {
            image: imgContent,
            caption: menu,
            mimetype: imgMimeType,
            ...channelOpts
          });
        } else {
          await message.client.sendMessage(message.jid, { text: menu, ...channelOpts });
        }
      } catch (error) {
        config.logger.error(`[Menu] Mesaj gönderilemedi: ${error.message}`);
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
        return await message.sendReply("💬 _İsim verin: .setname Lades_");
      const parts = config.BOT_INFO.split(";");
      parts[0] = name;
      await setVar("BOT_INFO", parts.join(";"));
      return await message.sendReply(
        `✅ *Bot adı başarıyla güncellendi!*\n\n*📋 Yeni Ad:* ${name}`
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
        return await message.sendReply("🖼️ *Bir resmi .setimage ile yanıtlayın!*");
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
          return await message.sendReply("❌ _Görsel yüklemesi başarısız oldu._");
        }

        const parts = config.BOT_INFO.split(";");
        while (parts.length < 3) parts.push("");
        parts[parts.length - 1] = url;
        await setVar("BOT_INFO", parts.join(";"));
        return await message.sendReply(
          `✅ *Bot görseli başarıyla güncellendi!*\n\n*🖼️ Yeni Görsel URL:* ${url}`
        );
      } catch (error) {
        console.error("Görsel ayarlanırken hata:", error);
        return await message.sendReply("⚠️ *Görsel ayarlanamadı. Lütfen tekrar deneyin.*"
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
          `ℹ️ _Bot hakkındaki her türlü görüşünü bize iletebilirsin!_\n\n` +
          `*Kategoriler:*\n` +
          `🙏🏻 \`.bildir istek <mesaj>\` — Özellik isteği\n` +
          `😤 \`.bildir şikayet <mesaj>\` — Şikayet\n` +
          `🐛 \`.bildir hata <mesaj>\` — Hata bildirimi\n` +
          `💡 \`.bildir öneri <mesaj>\` — Fikir/Öneri\n` +
          `📋 \`.bildir talep <mesaj>\` — Özel talep\n\n` +
          `💬 _Örnek: \`.bildir hata Şarkı komutu çalışmıyor\`_`
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
        `🔖 *Ref ID:* ${message.jid}|${message.key.id}\n` +
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
          "❌ *Bildirim gönderilirken bir hata oluştu. Lütfen daha sonra tekrar deneyin.*"
        );
      }
    }
  );

  Module({
    on: "text",
    fromMe: false
  }, async (message) => {
    if (!message.fromOwner && !message.fromSudo) return;

    if (!message.reply_message || !message.reply_message.text) return;
    const repliedText = message.reply_message.text;

    // Yalnızca botun kendi bildirim mesajıysa
    if (message.reply_message.fromMe && repliedText.includes("Bildirimi!") && repliedText.includes("Ref ID:")) {
      const refMatch = repliedText.match(/🔖 \*Ref ID:\* (.*)/);
      if (refMatch && refMatch[1]) {
        const [targetJid, targetMsgId] = refMatch[1].split("|");

        if (targetJid && targetMsgId) {
          const yanitMetni = `📬 *MESAJINIZ VAR!*\n💬 _Geliştiriciden yanıt geldi!_\n\n${message.text}\n\nℹ️ _Bu mesaj sistem tarafından otomatik olarak iletilmiştir._`;

          try {
            // targetMsgId ile kullanıcının orijinal komutuna doğrudan yanıt ver
            await message.client.sendMessage(targetJid, {
              text: yanitMetni
            }, {
              quoted: {
                key: { remoteJid: targetJid, id: targetMsgId, participant: targetJid.includes("@g.us") ? message.reply_message?.mentions?.[0] : undefined },
                message: { conversation: "Bildiriniz" }
              }
            });
            await message.react("✅");
          } catch (err) {
            console.error("Yanıt iletilemedi:", err);
            await message.sendReply("❌ *Yanıt kullanıcıya iletilemedi!* (Kullanıcı numarası geçersiz/engelli olabilir)");
          }
        }
      }
    }
  });


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
    const turkeyTime = new Date().toLocaleString("en-US");
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
        await sendWeatherMessage(m, "⚠️ *Bu komut sadece sohbet grubunda kullanılabilir!*");
        return;
      }

      const queriedCity = match[1]?.trim();
      if (!queriedCity) {
        await sendWeatherMessage(m, "⚠️ *Lütfen bir şehir adı belirtiniz!*");
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
            "⚠️ *Hava durumu bilgisi alınırken bir hata oluştu. Tekrar deneyiniz.*"
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
          { text: "⚠️ *Bu komut sadece sohbet grubunda kullanılabilir!*" }
        );
      }
      const userInput = (match[1] || '').trim();
      if (!userInput) {
        return message.sendReply('⚠️ *Lütfen geçerli bir giriş yapınız!* \n*Örnek:* \`.kur 1 dolar tl\`');
      }
      const parts = userInput.split(/\s+/);
      if (parts.length < 3) {
        return message.sendReply('⚠️ *Lütfen geçerli bir giriş yapınız!* \n*Örnek:* \`.kur 1 dolar tl\`');
      }
      const rawAmount = parts.shift();
      const rawToCurrency = parts.pop();
      const rawFromCurrency = parts.join(' ');
      const amount = parseAmount(rawAmount);
      const fromCurrency = currencyMap[rawFromCurrency.toLowerCase()] || rawFromCurrency.toUpperCase();
      const toCurrency = currencyMap[rawToCurrency.toLowerCase()] || rawToCurrency.toUpperCase();
      if (amount === null || !isFinite(amount) || !fromCurrency || !toCurrency) {
        return message.sendReply('⚠️ *Lütfen geçerli bir giriş yapınız!* \n*Örnek:* \`.kur 1 dolar tl\`');
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
          '⚠️ *Döviz kuru dönüşümü yapılamadı! Lütfen para birimlerini kontrol ediniz.*'
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
      if (!query) return await message.sendReply("🔍 *Konu girin:* \`.resim kedi\`");
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
        await message.sendReply(`❌ *Görsel bulamadım!* \n\n*Hata:* ${e.message}`);
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
      if (!query) return await message.sendReply("🍳 *Yemek adı girin:* \`.yemekt pilav\`");
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
        await message.sendReply(`❌ *Tarif bulunamadı!* \n\n*Hata:* ${e.message}`);
      }
    }
  );
})();

// ==========================================
// FILE: komutlar.js
// ==========================================
(function () {
  const { Module, commands } = require('../main');

  // Komut adını çıkaran yardımcı fonksiyon
  const extractCommandName = (pattern) => {
    const raw = pattern instanceof RegExp ? pattern.source : String(pattern || "");
    const start = raw.search(/[\p{L}\p{N}]/u);
    if (start === -1) return "";
    const cmdPart = raw.slice(start);
    const match = cmdPart.match(/^[\p{L}\p{N}]+/u);
    return match && match[0] ? match[0].trim() : "";
  };

  // Komut detaylarını bulan yardımcı fonksiyon
  const retrieveCommandDetails = (commandName) => {
    const foundCommand = commands.find(
      (cmd) => extractCommandName(cmd.pattern) === commandName
    );
    if (!foundCommand) return null;
    return {
      name: commandName,
      ...foundCommand,
    };
  };

  Module({
    pattern: 'komut ?(.*)',
    fromMe: false,
    desc: 'Bot komutlarını listeler veya belirtilen komutun detaylarını gösterir.',
    use: 'genel',
    usage: '.komutlar | .komut spotify'
  },
    async (m, match) => {
      const arg = match[1]?.trim().toLowerCase();

      // Eğer 'lar' yazılmışsa tam listeyi göster
      if (arg === 'lar') {
        return await m.sendReply(
          "📋 *GENEL KOMUTLAR*\n" +
          "🧑 .uzakta\nSizi AFK (Uzakta) yapar. Etiketlenirseniz Bot sizin yerinize cevap verir.\n\n" +
          "💻 .kontrol\nBotun çalışıp çalışmadığını kontrol etmenizi sağlar.\n\n" +
          "📶 .ping\nPing süresini (tepki hızını) ölçer.\n\n" +
          "⏱️ .uptime\nSistem (OS) ve işlem çalışma süresini gösterir.\n\n" +
          "📋 .liste\nTüm komutları kategorilere ayrılmış şekilde listeler.\n\n" +
          "📋 .menü\nBot komut menüsünü gösterir.\n\n" +
          "🎮 .oyunlar\nMevcut tüm oyunları listeler.\n\n" +
          "📝 .take\nÇıkartma/ses dosyalarını değiştirir. Başlık, sanatçı, kapak resmi vb. değişiklik yapar.\n\n" +
          "🖋️ .fancy\nŞık yazı tipleri oluşturur.\n\n" +
          "🔁 .tekrar\nYanıtlanan komutu tekrar çalıştırır.\n\n" +
          "📣 .bildir\nBot hakkında istek, şikayet, hata bildirimi, öneri veya talep iletir.\n\n" +
          "📝 .düzenle\nBot'un yazdığı mesajı düzenlemeye yarar.\n\n" +
          "⏫ .url\nGörseli imgur.com'a yükler ve bağlantısını paylaşır.\n\n" +
          "🔁 .react\nYanıtlanan mesaja emoji tepkisi verir.\n\n" +
          "📨 .msjat\nBot'un attığı mesaja kendiniz cevap verir.\n\n" +
          "↪️ .msjyönlendir\nBot'un mesajını başka bir sohbete yönlendirir.\n\n" +
          "🗑️ .msjsil\nEtiketlenen mesajı herkesten siler.\n\n" +
          "💬 .msjgetir\nYanıtlanan mesajın asıl alıntılandığı mesajı bulur ve tekrar gönderir. Silinen mesajları görmek için idealdir.\n\n" +
          "👀 .vv\nTek seferlik görüntülenebilen medyayı gösterir.\n\n" +
          "📲 .dc\nDestek grubu iletişim bilgilerini gösterir.\n\n" +
          "🔗 .bağla\nWhatsApp Web bağlantısı kurar.\n\n" +
          "🔄 .otoindir\nOtomatik indirme özelliğini aç/kapat.\n\n" +
          "🔄 .ybaşlat|reload|reboot\nBotu yeniden başlatır.\n\n" +
          "🔄 .güncelle\nBot'u günceller.\n\n" +
          "📦 .modülyükle\nHarici bir modül yükler.\n\n" +
          "📦 .modül\nYüklenmiş modülleri listeler.\n\n" +
          "🗑️ .modülsil\nYüklenmiş bir modülü siler.\n\n" +
          "🔄 .mgüncelle\nModülleri günceller.\n\n" +
          "🎂 .yaşhesap\nYaş hesaplar.\n\n" +
          "⏳ .gerisayım\nZaman hesabı yapar. Belirlediğiniz tarihe ne kadar kaldığını söyler.\n\n" +
          "⚡ .hıztesti\nİnternet hızınızı test eder.\n\n" +
          "❤️ .aşkölç\nAşk ölçer.\n\n" +
          "🧠 .beyin\nBeyin oyunu.\n\n" +
          "🤔 .bilmece\nBilmece sorar.\n\n" +
          "🔬 .kimyasoru\nKimya sorusu sorar.\n\n" +
          "😂 .alay\nAlaycı mesaj oluşturur.\n\n" +
          "🐉 .dragonyazı\nDragon tarzı yazı yazdırır.\n\n" +
          "💫 .neonyazı\nNeon tarzı yazı yazdırır.\n\n" +
          "🎨 .grafitiyazı\nGrafiti tarzı yazı yazdırır.\n\n" +
          "😈 .devilyazı\nŞeytan tarzı yazı yazdırır.\n\n" +
          "🎵 .muzikkartı\nMüzik kartı oluşturur.\n\n" +
          "⚙️ *SSTEM & ANALZ KOMUTLARI*\n" +
          "⚙️ .setalive\nBot için çevrimiçi mesajı ayarlar.\n\n" +
          "⚙️ .setinfo\nBot yapılandırma komutları hakkında bilgi gösterir.\n\n" +
          "⚙️ .setname\nBot adını ayarlar.\n\n" +
          "🖼️ .setimage\nBot resmini ayarlar.\n\n" +
          "🧪 .testalive\nMevcut çevrimiçi mesajını test eder.\n\n" +
          "📊 .mesajlar\nÜyelerin mesaj istatistiklerini gösterir.\n\n" +
          "👥 .üyetemizle\nAktif olmayan üyeleri tespit eder / çıkarır.\n\n" +
          "👥 .users\nKullanıcı listesini gösterir.\n\n" +
          "🚫 .bahsetme\nBahsetmeyi engeller.\n\n" +
          "🔧 *GRUP YÖNETİM KOMUTLARI*\n" +
          "🗑️ .sohbetsil\nGrup sohbetini tamamen siler.\n\n" +
          "❌ .ban\nEtiketlenen kişiyi gruptan çıkarır.\n\n" +
          "😈 .at\nEtiketlenen kişiyi (sürprizli bir şekilde) gruptan çıkarır.\n\n" +
          "➕ .ekle\nKişiyi gruba ekler.\n\n" +
          "👑 .yetkiver\nYönetici yetkisi verir.\n\n" +
          "✅ .istekler\nBekleyen katılım isteklerini yönetir.\n\n" +
          "👋 .ayrıl\nGruptan ayrılır.\n\n" +
          "🔗 .davet\nGrup davet linki oluşturur.\n\n" +
          "🔄 .davetyenile\nGrup davet linkini yeniler.\n\n" +
          "🔕 .gayaryt\nGrup ayarlarını kilitler (sadece yöneticiler değiştirebilir).\n\n" +
          "🔕 .gayarherkes\nGrup ayarlarının kilidini açar (herkes değiştirebilir).\n\n" +
          "📝 .gadı\nGrup adını değiştirir.\n\n" +
          "📄 .gaçıklama\nGrup açıklamasını değiştirir.\n\n" +
          "🤝 .common\nİki grup arasındaki ortak üyeleri gösterir.\n\n" +
          "🔍 .diff\nİki grup arasındaki farkları gösterir.\n\n" +
          "📢 .tag\nTüm üyeleri etiketler.\n\n" +
          "🚫 .engelle\nKişiyi engeller.\n\n" +
          "✅ .katıl\nBelirtilen gruba katılır.\n\n" +
          "🔓 .engelkaldır\nEngeli kaldırır.\n\n" +
          "👥 .toplukatıl\nToplu olarak gruba katılır.\n\n" +
          "🆔 .tümjid\nTüm JID'leri gösterir.\n\n" +
          "📢 .duyuru\nDuyuru yapar.\n\n" +
          "📌 .sabitle\nMesajı sabitler. `.sabitle sil` sabitlenmiş mesajı kaldırır.\n\n" +
          "📸 .pp\nProfil fotoğrafını gösterir.\n\n" +
          "🖼️ .gfoto\nGrup fotoğrafını değiştirir.\n\n" +
          "🪙 .altın\nGüncel altın fiyatlarını gösterir.\n\n" +
          "👥 .etiket\nTüm üyeleri etiketler.\n\n" +
          "🛡️ .ytetiket\nTüm yöneticileri etiketler.\n\n" +
          "🔇 .sohbetkapat\nGrup sohbetini kapatır (yalnızca yöneticiler mesaj gönderebilir).\n\n" +
          "🔊 .sohbetaç\nGrup sohbetini açar (herkes mesaj gönderebilir).\n\n" +
          "🆔 .jid\nJID bilgisi verir.\n\n" +
          "👑 .yetkial\nYönetici yetkisini alır.\n\n" +
          "🕒 .otoçıkartma\nOtomatik çıkartma ayarlar.\n\n" +
          "🗑️ .otoçıkartmasil\nOtomatik çıkartma siler.\n\n" +
          "📋 .otoçıkartmalar\nOtomatik çıkartmaları listeler.\n\n" +
          "🕒 .otosohbetkapat\nOtomatik sohbet kapatma ayarlar.\n\n" +
          "📅 .otosohbetaç\nOtomatik sohbet açma ayarlar.\n\n" +
          "🔇 .otosohbet\nOtomatik sohbet ayarları.\n\n" +
          "⚠️ .uyar\nÜyeyi uyarır.\n\n" +
          "📊 .kaçuyarı\nUyarı sayısını gösterir.\n\n" +
          "➖ .uyarısil\nUyarı siler.\n\n" +
          "🔄 .uyarısıfırla\nTüm uyarıları sıfırlar.\n\n" +
          "📋 .uyarıliste\nUyarı listesini gösterir.\n\n" +
          "⚙️ .uyarılimit\nUyarı limitini ayarlar.\n\n" +
          "🚫 .filtre\nBelirli kelimelere otomatik yanıt oluşturur.\n\n" +
          "📋 .filtreler\nFiltreleri listeler.\n\n" +
          "🗑️ .filtresil\nFiltre siler.\n\n" +
          "🔄 .filtredurum\nFiltreyi aç/kapar.\n\n" +
          "🧪 .testfiltre\nFiltreyi test eder.\n\n" +
          "❓ .filtreyardım\nFiltre yardımını gösterir.\n\n" +
          "⬇️ *NDRME MERKEZ KOMUTLARI*\n" +
          "🎶 .şarkı\nYouTube'dan şarkı indirir.\n\n" +
          "🎧 .spotify\nSpotify'dan şarkı indirir.\n\n" +
          "📹 .video\nYouTube'dan video indirir.\n\n" +
          "🔽 .ytvideo\nYouTube'dan videoyi istenen kalitede indirir.\n\n" +
          "🎵 .ytsesb\nYouTube'dan ses indirir.\n\n" +
          "📷 .insta\nInstagram'dan gönderi/reel indirir.\n\n" +
          "🔎 .igara\nInstagram'dan kullanıcı bilgilerini getirir.\n\n" +
          "📘 .fb\nFacebook'tan gönderi/video indirir.\n\n" +
          "📌 .pinterest\nPinterest içeriği indirir.\n\n" +
          "🎥 .tiktok\nTikTok videolarını ve albümlerini (kaydırmalı fotoğrafları) filigransız indirir.\n\n" +
          "🔎 .ttara\nTikTok'tan kullanıcı bilgilerini getirir.\n\n" +
          "🎬 .capcut\nCapCut'tan video indirir.\n\n" +
          "🧵 .threads\nThreads'ten içerik indirir.\n\n" +
          "🎧 .soundcloud\nSoundCloud'dan müzik indirir.\n\n" +
          "⬆️ .upload\nURL'den medya indirir.\n\n" +
          "🔍 *ARAMA & BLG KOMUTLARI*\n" +
          "🎬 .movie\nFilm araması yapar.\n\n" +
          "💻 .hackernews\nHaber makalelerini getirir.\n\n" +
          "📲 .waupdate\nWhatsApp güncelleme haberlerini getirir.\n\n" +
          "📰 .news\nEn son haberleri getirir.\n\n" +
          "📊 .wapoll\nAnket oluşturur.\n\n" +
          "🖼️ .görsel\nGoogle'dan görsel arar.\n\n" +
          "🍳 .reçete\nYemek tarifi arar.\n\n" +
          "🔎 .ytara\nYouTube'dan kanal bilgisi alır.\n\n" +
          "📖 .hikaye\nInstagram hikayesini indirir.\n\n" +
          "🐦 .twitter\nTwitter'dan içerik indirir.\n\n" +
          "😂 .emojimix\nİki emoji'yi birleştirir.\n\n" +
          "📝 .yazı\nYazı yazdırır.\n\n" +
          "🥷 .naruto\nNaruto tarzı sticker oluşturur.\n\n" +
          "🦸 .marvel\nMarvel tarzı sticker oluşturur.\n\n" +
          "💖 .blackpink\nBlackpink tarzı sticker oluşturur.\n\n" +
          "👑 .brat\nBrat tarzı sticker oluşturur. Animasyonlu: .brat gif metin veya .bratgif metin | Hız: .brat gif 500 metin\n\n" +
          "💭 .söz\nGüzel sözler paylaşır.\n\n" +
          "🖼️ .duvar\nDuvar kağıdı arar.\n\n" +
          "🔍 .çıkartmabul\nSticker arar.\n\n" +
          "📚 .vikipedi\nVikipedi'den arama yapar.\n\n" +
          "💬 .alıntı\nAlıntı paylaşır.\n\n" +
          "💭 .rüya\nRüya tabiri yapar.\n\n" +
          "🕌 .ezan\nEzan vakitlerini gösterir.\n\n" +
          "🕋 .sahur\nSahur vaktini hesaplar.\n\n" +
          "🌙 .iftar\nİftar vaktini hesaplar.\n\n" +
          "☁️ .hava\nHava durumu bilgisi verir.\n\n" +
          "💱 .kur\nDöviz kuru dönüşümü yapar.\n\n" +
          "🌍 .çevir\nÇeviri yapar.\n\n" +
          "🔤 .detectlang\nMesaj dilini tespit eder.\n\n" +
          "📲 .true\nNumara sorgular.\n\n" +
          "📱 .onwa\nWhatsApp'da numara sorgular.\n\n" +
          "📳 .sondepremler\nSon depremleri listeler.\n\n" +
          "📳 .sondeprem\nSon depremi gösterir.\n\n" +
          "🎓 .bilgikaçnet\nÜniversite bölümleri hakkında bilgi verir.\n\n" +
          "💬 *SOHBET & MESAJ KOMUTLARI*\n" +
          "👋 .karşıla\nHoş geldiniz mesajı ayarlar.\n\n" +
          "👋 .elveda\nGörüşürüz mesajı ayarlar.\n\n" +
          "🧪 .karşılatest\nHoş geldiniz mesajını test eder.\n\n" +
          "🧪 .elvedatest\nGörüşürüz mesajını test eder.\n\n" +
          "👑 *KURUCU & GELŞTRC KOMUTLARI*\n" +
          " .değişkengetir\nDeğişken getirir.\n\n" +
          "🗑️ .değişkensil\nDeğişken siler.\n\n" +
          "📋 .değişkenler\nTüm değişkenleri listeler.\n\n" +
          "💻 .platform\nPlatform bilgisini gösterir.\n\n" +
          "🌍 .dil\nDil ayarları.\n\n" +
          "⚙️ .ayarlar\nBot ayarlarını gösterir.\n\n" +
          "🛡️ *KORUMA & GÜVENLİK*\n" +
          "️ .antisilme\nAnti-silme özelliği.\n\n" +
          "🤖 .antibot\nBot koruması.\n\n" +
          "🚫 .antispam\nSpam koruması.\n\n" +
          "📵 .antipdm\nAnti-PDM koruması.\n\n" +
          "📉 .antiyetkidüşürme\nAnti-yetki düşürme.\n\n" +
          "📈 .antiyetkiverme\nAnti-yetki verme.\n\n" +
          "🔗 .antibağlantı\nBağlantı engelleme.\n\n" +
          "🚫 .antikelime\nKelime engelleme.\n\n" +
          "🚫 .antinumara\nNumara engelleme ayarları.\n\n" +
          "🔍 .aramaengel\nArama engelleme.\n\n" +
          "👑 .sudolar\nSudo kullanıcılarını listeler.\n\n" +
          "🔄 .toggle\nÖzellik aç/kapar.\n\n" +
          "🎨 *GÖRSEL DÜZENLEME KOMUTLARI*\n" +
          "🖌️ .editör\nFotoğraf düzenleme komutlarını listeler.\n\n" +
          "🎮 .wasted\nFotoğrafa GTA tarzı öldün (wasted) efekti uygular.\n\n" +
          "🕵️ .wanted\nFotoğrafa aranıyor (wanted) poster efekti uygular.\n\n" +
          "🌸 .anime\nAnime efekti uygular.\n\n" +
          "🎨 .ghiblistil\nGhibli stili efekti uygular.\n\n" +
          "👶 .chibi\nChibi efekti uygular.\n\n" +
          "🎬 .efektsinema\nSinema efekti uygular.\n\n" +
          "🎨 .grafitisokak\nGrafiti sokak efekti uygular.\n\n" +
          "🎮 .pikselart\nPiksel art efekti uygular.\n\n" +
          "😂 .komik\nKomik efekti uygular.\n\n" +
          "🎭 .mafia\nMafia efekti uygular.\n\n" +
          "🎬 *MEDYA ŞLEMLER*\n" +
          "🖼️ .çıkartma\nMedyayı stickere çevirir.\n\n" +
          "🎵 .mp3\nVideodan ses çıkarır.\n\n" +
          "🐢 .slow\nMüziği yavaşlatır.\n\n" +
          "⚡ .hızlandır\nMüziği hızlandırır.\n\n" +
          "🔊 .bass\nBass ayarı yapar.\n\n" +
          "🏞️ .foto\nStickerı fotoğrafa çevirir.\n\n" +
          "✨ .yazıçıkartma\nMetinden sticker oluşturur.\n\n" +
          "🎞️ .mp4\nStickerı videoya çevirir.\n\n" +
          "📂 .belge\nMedyayı belgeye çevirir.\n\n" +
          "📄 .pdf\nFotoğrafları PDF'ye çevirir.\n\n" +
          "🔈 .ses\nMetni sese çevirir.\n\n" +
          "🎙️ .dinle\nSesi metne çevirir.\n\n" +
          "🔎 .bul\nŞarkıyı tanır.\n\n" +
          "📐 .square\nMedyayı kare yapar.\n\n" +
          "📏 .resize\nMedyayı yeniden boyutlandırır.\n\n" +
          "🗜️ .sıkıştır\nMedyayı sıkıştırır.\n\n" +
          "🎮 *OYUNLAR & TESTLER*\n" +
          "🎂 .testgay\nGay testi yapar.\n\n" +
          "🧊 .testlez\nLezbiyen testi yapar.\n\n" +
          "👸 .testprenses\nPrenses testi yapar.\n\n" +
          "🩸 .testregl\nRegl testi yapar.\n\n" +
          "🙏 .testinanç\nİnanç testi yapar.\n\n" +
          "⏳ .ykssayaç\nYKS sayacı.\n\n" +
          "📅 .kpsssayaç\nKPSS sayacı.\n\n" +
          "📜 .msüsayaç\nMSÜ sayacı.\n\n" +
          "🏫 .okulsayaç\nOkul sayacı.\n\n" +
          "🌙 .ramazansayaç\nRamazan sayacı.\n\n" +
          "⏰ .planla\nMesaj planlar.\n\n" +
          "📋 .plandurum\nPlan durumunu gösterir.\n\n" +
          "🗑️ .plansil\nPlanı siler.\n\n" +
          "🛠️ *ARAÇLAR & ÇEVİRİ KOMUTLARI*\n" +
          "🎥 .trim\nMedyayı keser.\n\n" +
          "⚫ .siyahvideo\nSiyah video yapar.\n\n" +
          "🎬 .birleştir\nSes ve video birleştirir.\n\n" +
          "🎥 .vmix\nİki video birleştirir.\n\n" +
          "🐌 .ağırçekim\nAğır çekim efekti.\n\n" +
          "⚙️ .interp\nFPS artırır.\n\n" +
          "🔄 .döndür\nVideoyu döndürür.\n\n" +
          "🔀 .flip\nVideoyu ters çevirir.\n\n" +
          "⭕ .oval\nDaire yapar.\n\n" +
          "📽️ .gif\nVideoyu GIF'e çevirir.\n\n" +
          "🖼️ .ss\nEkran görüntüsü alır.\n\n" +
          "🎨 .renklendir\nMedyayı renklendirir.\n\n" +
          "💻 .kodgörsel\nKoddan görsel oluşturur.\n\n" +
          "😂 .meme\nMeme oluşturur.\n\n" +
          "🤖 *YAPAY ZEKA KOMUTLARI*\n" +
          "🤖 .yz\nGemini AI'ya soru sor.\n\n" +
          "🎨 .yzgörsel\nMetni görsele çevirir.\n\n" +
          "🖌️ .yzdüzenle\nGörüntüyü AI ile düzenler.\n\n" +
          "🎭 .yzanime\nGörüntüyü anime yapar.\n\n" +
          "🧩 .soruçöz\nSınav sorularını çözer.\n\n" +
          "🤖 .yzayar\nAI ayarlarını yönetir.\n\n" +
          "🎬 *MEDYA İŞLEMLERİ*\n" +
          "🔍 .apsil\nArka planı kaldırır.\n\n" +
          "⬆️ .hd\nGörüntü kalitesini artırır.\n\n" +
          "🎙️ .ses\nMetni sese çevirir.\n\n" +
          "🎧 .dinle\nSesi metne çevirir.\n\n" +
          "🔎 .bul\nŞarkıyı tanır.\n\n" +
          "🖼️ .görsel\nGörsel arar.\n\n" +
          "⬆️ .upload\nURL'den medya indirir.\n\n" +
          "📂 .belge\nMedyayı belgeye çevirir.\n\n" +
          "📄 .pdf\nPDF oluşturur.\n\n" +
          "🖼️ .çıkartma\nSticker oluşturur.\n\n" +
          "🎵 .mp3\nSes çıkarır.\n\n" +
          "🐢 .slow\nMüziği yavaşlatır.\n\n" +
          "⚡ .sped\nMüziği hızlandırır.\n\n" +
          "🔊 .basartır\nBass ayarları.\n\n" +
          "🏞️ .foto\nStickerı fotoğraf yapar.\n\n" +
          "✨ .yazıçıkartma\nMetinden sticker yapar.\n\n" +
          "🎞️ .mp4\nStickerı video yapar.\n\n" +
          "👀 .vv\nView-once medyayı gösterir.\n\n" +
          "✂️ .trim\nMedyayı keser.\n\n" +
          "⚫ .siyahvideo\nSiyah video yapar.\n\n" +
          "🎬 .birleştir\nMedya birleştirir.\n\n" +
          "🎥 .vmix\nVideo birleştirir.\n\n" +
          "🐌 .ağırçekim\nAğır çekim efekti.\n\n" +
          "⚙️ .interp\nFPS artırır.\n\n" +
          "🔄 .döndür\nVideoyu döndürür.\n\n" +
          "🔀 .flip\nVideoyu ters çevirir.\n\n" +
          "⭕ .oval\nDaire yapar.\n\n" +
          "📽️ .gif\nVideoyu GIF yapar.\n\n" +
          "🖼️ .ss\nEkran görüntüsü alır.\n\n" +
          "⏫ .url\nGörseli yükler.\n\n" +
          "🎨 .renklendir\nMedyayı renklendirir.\n\n" +
          "💻 .kodgörsel\nKoddan görsel yapar.\n\n" +
          "😂 .meme\nMeme oluşturur.\n\n" +
          "📐 .square\nKare yapar.\n\n" +
          "📏 .resize\nBoyutlandırır.\n\n" +
          "🗜️ .sıkıştır\nSıkıştırır.\n\n" +
          "🎵 .tts\nMetni sese çevirir.\n\n" +
          "🎬 .ytsesb\nYouTube'dan ses indirir.\n\n" +
          "🔎 .ytara\nYouTube kanal bilgisi.\n\n" +
          "🎞️ .mp4\nVideoya çevirir.\n\n" +
          "⏫ .url\nGörseli yükler.\n"
        );
        return;
      }

      // Eğer 'lar' değilse ama yine de bir argüman varsa detay göster
      if (arg) {
        const commandDetails = retrieveCommandDetails(arg);
        if (!commandDetails) {
          return await m.sendReply(
            `❌ *'${arg}' komutu bulunamadı!* \n\nℹ️ _Komut listesine bakmak için_ \`.komutlar\` _yazın._`
          );
        }

        let permission = "👥 Herkes";
        if (commandDetails.fromMe || commandDetails.onlyOwner) permission = "👑 Bot Sahibi";
        else if (commandDetails.onlySudo) permission = "🛡️ Sudo Kullanıcıları";
        else if (commandDetails.onlyAdmin) permission = "👮 Grup Yöneticileri";

        let infoMessage = `*✨ ───「 KOMUT DETAYLARI 」─── ✨*\n\n`;
        infoMessage += `⌨️ *Komut:* \`${commandDetails.name}\`\n`;
        infoMessage += `📝 *Açıklama:* ${commandDetails.desc || "Açıklama bulunmuyor."}\n`;
        infoMessage += `🔐 *Erişim:* ${permission}\n`;

        if (commandDetails.use) {
          infoMessage += `🏷️ *Kategori:* ${commandDetails.use}\n`;
        }

        if (commandDetails.usage) {
          infoMessage += `💬 *Kullanım:* \`${commandDetails.usage}\`\n`;
        }

        if (commandDetails.onlyGroup) infoMessage += `📍 *Kısıtlama:* 👥 Sadece Gruplar\n`;
        if (commandDetails.onlyDm) infoMessage += `📍 *Kısıtlama:* 👤 Sadece Özel\n`;

        if (commandDetails.warn) {
          infoMessage += `\n⚠️ *BİLGİ:* _${commandDetails.warn}_\n`;
        }

        return await m.sendReply(infoMessage);
      }

      // Hiçbir şey yazılmamışsa kullanım hatırlatıcısı ver
      await m.sendReply(
        "💬 *Kullanım:* \n\n" +
        "• *.komutlar* - Tüm komut listesini gösterir.\n" +
        "• *.komut <isim>* - Belirli bir komutun detaylarını gösterir.\n" +
        "_💡 Örnek: .komut spotify_"
      );
    });
})();

// ==========================================
// FILE: dc.js
// ==========================================
(function () {
  const { Module } = require('../main')

  let choices = ['⚖️ Doğruluk', '🙌🏻 Cesaret'];

  let truthQuestions = [
    "📱 Telefonunda en son aradığın şey neydi?",
    "💔 Birisi kız arkadaşın veya erkek arkadaşından ayrılman için sana 1 milyon TL verseydi, yapar mıydın?",
    "❤️ Bu gruptaki en çok kimi seviyorsun ve neden?",
    "😳 Hiç sınıfta yüksek sesle genirdin mi?",
    "🐍 Yılan, kurbağa gibi şeyleri hiç yemek zorunda kaldın mı?",
    "🔄 Bir gün karşı cins olarak uyanırsan, ilk yapacağın şey ne olurdu?",
    "🏊‍♂️ Hiç havuzda işedin mi?",
    "👗 Sence bu gruptaki en kötü giyinen kişi kimdir?",
    "🚽 Tuvalette otururken aklına gelen şeyler nelerdir?",
    "👻 Büyüyen hayali bir arkadaşın var mıydı?",
    "🤔 En kötü alışkanlığın nedir?",
    "👃 Burnunu karıştırır mısın?",
    "🎤 Banyoda şarkı söyler misin?",
    "💦 Hiç üzerine işedin mi?",
    "😳 Toplumda en utanç verici anın neydi?",
    "🪞 Aynada kendinle hiç konuştun mu?",
    "🔍 Arama geçmişini birileri görseydi utanacağın şey ne olurdu?",
    "💤 Uykunda konuşur musun?",
    "💘 Gizli aşkın kim?",
    "😡 Benim hakkımda neyi sevmiyorsun?",
    "🩲 Şu an ne renk iç çamaşır giyiyorsun?",
    "📲 Son attığın mesaj neydi?",
    "🔥 İnsanları yanan bir binadan kurtarıyor olsaydın ve bir kişiyi bu odadan geride bırakmak zorunda kalsaydın bu kim olurdu?",
    "👂 Hiç kulak kiri tattın mı?",
    "💨 Hiç osurup başka birini suçladın mı?",
    "😅 Hiç terinin tadına baktın mı?",
    "😠 Bu gruptaki kim bugüne kadarki en kötü insan ve neden?",
    "🕰️ Yeniden doğmuş olsaydın, hangi yüzyılda doğmak isterdin?",
    "⏰ Söylediğin veya yaptığın bir şeyi geri alabilmek için zamanda geriye gidebilseydin, bu ne olurdu?",
    "😳 Erkek arkadaşın veya kız arkadaşın seni hiç utandırdı mı?",
    "👻 Birdenbire görünmez olsaydın ne yapardın?",
    "🛀 Banyoda kaldığın en uzun süre ne ve neden bu kadar uzun süre kaldın?",
    "🌙 Şimdiye kadar gördüğün en garip rüyayı anlat.",
    "🧸 Hala yaptığın en çocukça şey nedir?",
    "🎬 Hangi çocuk filmini tekrar tekrar izleyebilirsin?",
    "👣 Ayak kokun kötü mü?",
    "🤡 Saçma takma adların var mı?",
    "📱 Telefonunda hangi uygulamada en çok zaman harcıyorsun?",
    "🍔 Tek bir oturuşta yediğin en çok yemek ne?",
    "💃 Tek başınayken dans ediyor musun?",
    "🌚 Karanlıktan korkar mısın?",
    "🏠 Bütün gün evde olsan, ne yaparsın?",
    "🤳 Günde kaç öz çekim yapıyorsun?",
    "🦷 En son ne zaman dişlerini fırçaladın?",
    "👚 En sevdiğin pijamalar neye benziyor?",
    "🍬 Hiç yerden bir şey alıp yedin mi?",
    "🚫 Yapmaman gereken bir şeyi yaparken hiç yakalandın mı?",
    "🐜 Hiç bitlendin mi?",
    "✂️ Pantolonunu hiç kestin mi?",
    "🍽️ Tabağını yalıyor musun?",
    "🤫 Kimsenin senin hakkında bilmediği bir şey nedir?",
    "🍽️ Hiç tabağını yaladın mı?",
    "🦾 Dirseğini yalayabilir misin?",
    "🔥 Eğer buradaki herkesi yanan bir binadan kurtarmaya çalışıyor olsaydın ve birini geride bırakmak zorunda kalsaydın, kimi geride bırakırdın?",
    "💨 Hiç asansörde gaz kaçırdın mı?",
    "🔄 Bir günlüğüne karşı cins olsaydın ne yapardın?",
    "🔄 Hayatındaki bir şeyi değiştirebilseydin bu ne olurdu?",
    "😔 En büyük pişmanlığın nedir?",
    "📸 Telefonundaki en utanç verici fotoğraf hangisidir?",
    "🤫 Kimsenin bilmediği kötü bir şey yaptın mı?",
    "🤢 Sahip olduğun en iğrenç alışkanlık nedir?",
    "🔒 Hiç kimseye söylemediğin bir sırrın var mı?",
    "😱 Şimdiye kadar gördüğün en korkunç rüya nedir?",
    "🧦 Çorabını değiştirirken ayağını koklar mısın?",
    "🐾 Eğer bir tür hayvan olabilseydin, ilk ne yapardın?",
    "🤥 Hiç yaşın hakkında yalan söyledin mi?",
    "🤫 Kimsenin senin hakkında bilmediği şey nedir?",
    "💔 Bir ilişkideki en büyük korkun nedir?",
    "🙈 En rezil ilk randevun neydi?",
    "🤪 En garip alışkanlığın nedir?",
    "👶 Kaç tane çocuk sahibi olmak istersin?",
    "😳 Hakkında bilmemiz gereken utanç verici gerçek nedir?",
    "👶 Çocukluktaki lakabın neydi?",
    "🍔 En sevdiğin yemek nedir?",
    "🌈 En sevdiğin renkler nedir ve neden?",
    "💼 Hayalindeki meslek ne?",
    "🏝️ Bir adada 3 gün sıkışıp kalsan ne yapardın?",
    "❤️ En sevdiğin kişi kimlerdir ve neden?",
    "🧻 Tuvalet kağıdını ruloya nasıl koyarsın?",
    "💘 İlk görüşte aşka inanır mısın?",
    "❤️ Aşka inanıyor musun?",
    "💍 Hayalindeki düğün nedir?",
    "🌍 Fırsatın olursa hangi ülkede yaşamak isterdin?",
    "💭 En çok neyi hayal ediyorsun?",
    "🌙 Şu ana dek yaşadığın en garip rüyayı açıklayabilir misin?",
    "❤️ Beni seviyor musun?",
    "🚿 Saçını yıkamadan en uzun ne kadar bekledin?",
    "🌟 Herhangi bir ünlü ile evlenseydin bu kim olurdu?",
    "💔 Kaç tane erkek arkadaşın oldu?",
    "❤️ Senden en az 10 yaş büyük bir kişiye hiç aşık oldun mu?",
    "💑 Şu an kiminle çıkıyorsun?",
    "😳 Sevdiğin birinin önünde söylediğin veya yaptığın en utanç verici şey neydi?",
    "💖 Vücudunun hangi bölümünü seviyorsun ve hangi kısmından nefret ediyorsun?",
    "🌟 Hayran olduğun ünlü kim?",
    "💃 Bu gruptaki biriyle bir dans gösterisi yapmak zorunda olsaydın, kimi seçerdin?",
    "📵 Hayallerindeki insanla evleneceksin denilseydi, telefonsuz bir yıl geçirebilir miydin?",
    "💇‍♀️ Hayatının geri kalanında sadece tek bir saç modeli yapabilseydin, kıvırcık saçları mı yoksa düz saçları mı seçerdin?",
    "💄 Hayatının sonuna kadar bir makyaj eşyası kullanmaman söylense, hangisini seçerdin?",
    "❤️ Senden daha kısa biriyle çıkar mısın?",
    "🔄 Vücudunuzla ilgili bir şeyi değiştirebilseydin, bu ne olurdu?",
    "👧 Okulunda başka bir kız olsaydın kim olurdun?",
    "🪞 Aynada kendine aşık ola ola bakar mısın?",
    "📣 Hiç amigo olmak istedin mi?",
    "👦 Sınıfındaki en iyi 5 erkek kim? Onları bize sırala.",
    "👶 Gelecekte kaç çocuk sahibi olmak isterdin?",
    "😡 En çok kimden nefret ediyorsun?",
    "🌟 Ünlü biriyle çıkabilseydin, bu kim olurdu?",
    "🏝️ Issız bir adada okulundan kimin mahsur kalmasını isterdin?",
    "💔 Hiç terk edildin mi? Evetse, neden?",
    "🔄 Yapabilseydin kendin üzerinde değiştirebileceğin fiziksel özelliğin ne olurdu?",
    "🍔 Şişman olmadan istediğin bir şeyi yiyebilseydin, bu yemek ne olurdu?",
    "🤥 En son ne zaman yalan söyledin?",
    "😢 En son ne zaman ve ne için ağladın?",
    "😱 En büyük korkun ne?",
    "👩‍👦 Annenin senin hakkında bilmediğine sevindiğin şey nedir?",
    "💔 Hiç birini aldattın mı?",
    "😖 Şimdiye kadar yaptığın en kötü şey nedir?",
    "🤫 Hiç kimseye söylemediğin sırrın nedir?",
    "🎩 Gizli bir yeteneğin var mı?",
    "💘 Ünlü insanlardan aşık olduğun biri oldu mu?",
    "😭 Şimdiye kadar yaşadığın en kötü deneyim neydi?",
    "📝 Sınavda hiç kopya çektin mi?",
    "🍻 Şimdiye kadar hiç sarhoş oldun mu?",
    "⚖️ Hiç kanunu çiğnedin mi?",
    "😳 Şimdiye kadar yaptığın en utanç verici şey nedir?",
    "😟 En büyük güvensizliğin nedir?",
    "😔 Şimdiye kadarki yaptığın en büyük hata nedir?",
    "🤢 Şimdiye kadarki yaptığın en iğrenç şey nedir?",
    "😡 Birinin sana yaptığı en kötü şey neydi?",
    "🚔 Hiç karakola düşecek bir şey yaptın mı?",
    "🚬 En kötü alışkanlığın nedir?",
    "😡 Şimdiye kadar birine söylediğin en kötü şey nedir?",
    "🌙 Gördüğün en garip rüya neydi?",
    "🚫 Hiç yapmaman gereken bir şeyi yaparken yakalandın mı?",
    "💔 Hayatında yaşadığın en kötü buluşma nasıl oldu?",
    "🎭 İnsanların senin hakkında düşündüklerinin aksine, kötü olan gerçek yanın nedir?",
    "🤥 Kötü bir randevudan çıkmak için hiç yalan söyledin mi?",
    "😣 İçinde bulunduğun en büyük sorun neydi?",
    "🤫 Hiç arkadaşının sırrını başkasıyla paylaştın mı?",
    "📨 Benim mesajımı hiç görmezden geldin mi. Neden bunu yaptın?",
    "🤥 Hiç en iyi arkadaşına yalan söyledin mi?",
    "👯‍♀️ En iyi 2 arkadaşın arasında seçim yapsan hangisini seçerdin?",
    "😠 En iyi arkadaşının en sevmediğin huyu nedir?",
    "💔 Sevdiğin ama açılamadığın kişi sana en yakın arkadaşını sevdiğini söylese, ne yapardın?",
    "👫 Arkadaşının kendi sevgilisini aldattığını bilseydin ne yapardın?",
    "🤥 Kendini daha iyi biri gibi göstermek için en iyi arkadaşın hakkında yalan söyledin mi?",
    "👀 Kim daha güzel/yakışıklı? Sen mi (gruptan biri mi?)",
    "🤔 [Gruptan herhangi biri] hakkındaki ilk izlenimin, düşüncelerin neydi?",
    "🔢 Gruptaki herkese 1'den 10'a kadar puan ver. 10 en sıcak olanı; 1 ise en kötü ve en soğuk olanı olsun.",
    "🦷 Bir diş fırçasını en yakın arkadaşınla paylaşır mısın?",
    "🤐 Arkadaşın onun için yalan söylemeni istedi ve başının derde gireceğini biliyor olsaydın, yine de söyler miydin?",
    "👸 Okuldaki en popüler kız/erkek sen olsaydın arkadaşlarından vazgeçer miydin?",
    "🗣️ Biri sana en iyi arkadaşının nasıl olduğunu sorsaydı, onu nasıl anlatırdın?",
    "🏖️ Bir tatil kazandın ve yanında iki kişi getirmene izin verildi. Aramızdan kimleri seçerdin?",
    "🔒 Söylememen gereken bir sırrı hiç birine anlattın mı?",
    "🏊‍♂️ Sevgilin ve en yakın arkadaşın göle düşse, önce hangisini kurtarırdın?",
    "👱‍♀️ Sarışın mı seversin, esmer mi?",
    "👨‍👩‍👧‍👦 Eğer ailen kız arkadaşından nefret etseydi, onu terk eder miydin?",
    "👭 Kız arkadaşın en iyi arkadaşından nefret etseydi ne yapardın?",
    "👀 Kimi kıskanıyorsun?",
    "👥 Sizce grubumuzdaki en çok sevilen kişi kim?",
    "🚬 Hiç bir kız/erkek tarafından reddedildin mi?",
    "💰 Fakir ve akıllı olmak mı ya da zengin ve dilsiz olmak mı? Hangisini seçerdin?",
    "🤥 Sevgiline/eski sevgiline hiç yalan söyledin mi?",
    "🎂 Hiç yaşın hakkında yalan söyledin mi?",
    "💘 Hiç ilk görüşte aşık oldun mu? Olduysan bu kimdi?",
    "👩 Sevmediğin bir kız sana aşık olsaydı, ona ne söyler ve nasıl davranırdın?",
    "💔 Sevdiğin ama açılamadığın kişinin başka birini sevdiğini öğrenseydin ne yapardın? 🚬",
    "💘 Aşık olduğun birinin önünde asla yapamayacağın bir şey var mı?",
    "💑 En çok kiminle çıkmak isterdin?",
    "👥 Bu gruptaki insanlardan, kiminle çıkardın?",
    "😄 Bu grupta en iyi gülüşe sence kim sahip?",
    "👃 Bu grupta en şirin burun sence kimde?",
    "👁️ Bu grupta en güzel gözler sence kimde?",
    "😂 Bu grupta en komik kişi sence kim?",
    "🪞 Bir kız/erkek ile buluşmaya gittiğinde aynada kendini ne sıklıkta kontrol edersin?",
    "💃 Bu grupta en güzel dans eden sence kim?",
    "👥 Bu gruptaki birinin bir fiziksel özelliğine sahip olsaydın, bu ne olurdu?",
    "💍 Yaşamak için bir haftan kalsaydı ve bu gruptan biriyle evlenmek zorunda olsaydın, bu kim olurdu?",
    "⏳ Yaşamak için sadece 24 saatin kalsa ve bu gruptaki herhangi biriyle herhangi bir şey yapabilseydin, bu kim olurdu ve o kişiyle ne yapardın?",
    "🥲 Dünyadaki son kişi ben olsaydım, benimle çıkar mıydın?",
    "😉 Yaptığın en çapkın şey nedir?",
    "📲 Bir uygulamayı telefonundan silmek zorunda kalsan hangisini silerdin?",
    "😱 Bir ilişkideki en büyük korkun nedir?",
    "🗣️ Gruptaki her bir kişi hakkında bir tane olumlu, bir tane olumsuz bir şey söyle.",
    "😠 Sevmediğin bir kötü huyun var mı?",
    "🎢 Hayatında yaptığın en çılgın şey nedir?",
    "🏝️ 3 gün boyunca bir adada mahsur kalmış olsaydın, bu gruptan kimleri seçerdin?",
    "😡 Bu gruptaki en sinir bozucu kişi kim?",
    "💍 Bu gruptan biriyle evlenmek zorunda kalsaydın, bu kim olurdu?",
    "⏳ En uzun ilişkin ne kadar sürdü?",
    "🌟 Bir ünlü Instagram'da seni takip edecek olsaydı, bu ünlünün kim olmasını isterdin?",
    "📲 Instagram'da 5 kişiyi silmek zorunda olsaydın, kimleri silerdin?",
    "💭 Hayallerindeki ruh eşini bize tarif et.",
    "⚽ Messi mi, Ronaldo mu?",
    "💼 İlk işin neydi?",
    "🎓 Üniversite hakkındaki en büyük korkun nedir?",
    "👫 En iyi arkadaşının seninle aynı üniversiteye gitmesini ister miydin?",
    "💑 Mevcut erkek arkadaşının ya da kız arkadaşının seninle aynı üniversiteye gitmesini ister miydin?",
    "👩‍💼 Hayalindeki iş nedir?",
    "👥 Sınıfta asla yanında oturmak istemeyeceğin kişi kim?",
    "⏰ Hiç derse geç kaldın mı?",
    "👩‍🏫 Bir öğretmenin önünde yaptığın en utanç verici şey neydi?",
    "🍬 Hiç masanın altına sakız attın mı?",
    "👊 Hiç okulda kavga ettin mi?",
    "📝 Sınavdan aldığın en kötü puan kaçtı?",
    "😴 Hiç sınıfta uyuyakaldın mı?",
    "👻 Eğer görünmez olsaydın, hangi derse gizlice girerdin?",
    "📱 Telefonunda en son arama yaptığın şey neydi?",
    "🚪 Hiç ailenin odasına çatkapı girdin mi?",
    "🍔 Yere düşürüp uzun süre düşündükten sonra yediğin en son şey neydi?",
    "🍖 Hiç bilindik hayvan etlerinden farklı bir et yedin mi?",
    "🔄 Bir gün karşı cins olarak uyansaydın yapacağın ilk şey ne olurdu?",
    "🏊‍♂️ Hiç havuza işeyip sonrasında hiçbir şey olmamış gibi davrandın mı?",
    "👔 Sence bu grupta en kötü giyinen kişi kim?",
    "🔄 Bu gruptaki insanlardan kiminle hayatını değiştirmek isterdin?",
    "👻 Korkutucu bir film izlerken gözlerini kapatır mısın?",
    "😳 Yaptığında utanmana neden olan mahcup zevkin nedir?",
    "🛀 Hiç sen banyodayken birisi içeri pat diye girdi mi?",
    "👶 Altına işemek denilince çocukluğun aklına geliyor mu?",
    "💨 Hiç sınıfta yüksek sesle osurduğun oldu mu?",
    "🪞 Hiç aynada kendinle konuşuyor musun?",
    "💤 Uykunda hiç konuşur musun?",
  ];

  truthQuestions = truthQuestions.map(question => `*${question}*`);

  let dareTasks = [
    "📞 Ailene telefon et ve neden işten (üniversiteden ya da okuldan da olabilir) atıldığını onlara anlat.",
    "🍗 En yakın dürümcüyü ara ve 300 tavuk dürüm siparişi ver. 1 dakika sonra siparişi başka yerden verdik diye de iptal et.",
    "📱 Telefonunu yanındaki kişiye ver. 5 dakika boyunca her yere bakması serbest olsun.",
    "💄 Bir erkekten makyaj yapmasını veya bir kızdan makyajını silmesini iste.",
    "💃 1 dakika boyunca hiç müzik olmadan dans et ve bize göster.",
    "📲 Birine telefonunu verip istediği herhangi birine mesaj atmasına izin ver.",
    "👃 Evdeki herkesin koltuk altını kokla ve bize göster.",
    "🚶‍♂️ Odanın bir ucundan diğer ucuna ellerinin üzerinde yürü ve bize göster. Gerekirse birisinden bacaklarını tutmasını isteyebilirsin.",
    "🥚 Kafanın üstünde 2 yumurta kır ve bize göster.",
    "🐾 Önümüzdeki 5 dakika içinde birinin hayvanı ol ve o hayvanın tüm davranışlarını sergile.",
    "🚿 Elbiselerinle bir duş al ve sırıksıklam halini buraya gönder.",
    "👋 Çevrenden birinin sana tokat atmasını söyle ve tokat attığı kısmı bize göster.",
    "📸 Seçeceğin bir sosyal medya hesabından çok çirkin bir fotoğrafını paylaş ve bize göster.",
    "📱 Telefonundan mesaj yazma bölümünü aç, gözlerini kapat ve rastgele bir kişiye körü körüne bir mesaj gönder.",
    "🎤 3 dakika boyunca stand-up gösterisi yap ve bize göster.",
    "🎵 1 dakika açacağın herhangi bir müzikte break dansı yap ve bize gönder.",
    "🦶 Ayağına masaj yap ve videosunu bize gönder.",
    "🏡 Komşunun evine git ve ondan muz iste.",
    "🦷 Çevrendeki birinin dişlerini fırçala ve bize göster.",
    "💃 Masanın üzerine çık ve bizim için dans edip gönder.",
    "👀 Birinin gözünün içine bakarak fermuarını aç ve bize göster.",
    "📣 Şu anda aklına gelen ilk kelimeyi bağırarak ses kaydına al.",
    "⏳ 10 dakika boyunca gruptan seçtiğin bir kişinin kölesi ol.",
    "👵🧓 Yaşlı bir kadın ya da yaşlı bir adam gibi davran. (Videoya çekip gönder)",
    "🔄 10 kere etrafında dön, bittiğinde düz bir çizgide yürümeye çalış ve bize göster.",
    "🏋️‍♀️ 10 zıpla ve 10 şınav çek, sonucu bize göster.",
    "🔤 Alfabeyi 30 saniyede geriye doğru ses kaydına alarak söyle.",
    "🐔 1 dakika tavuk gibi davran.",
    "📺 En sevdiğin çizgi film karakteri gibi davran.",
    "🥒 Söyleyeceğin her şeyden sonra 'salatalık' de.",
    "🥜 Bir kaşık dolusu fıstık ezmesi ye ve bize göster.",
    "👟 Ayakkabı iplerini birbirine bağla, geriye doğru yürümeye çalış ve bize göster.",
    "👶 Bir sonraki mesaja kadar bebek gibi davran.",
    "🦸‍♂️ En sevdiğin süper kahraman gibi davran.",
    "🗿 Sıradaki mesaj gelene kadar bir heykel gibi hareket et. (Konuşmadan veya hareket etmeden)",
    "🐱 Kedi gibi miyavla.",
    "🎤 En sevdiğin şarkıyı bağırarak ve ses kaydına alarak söyle.",
    "✈️ 2 dakika uçak olduğunu farz et, bir uçak gibi 2 dakika boyunca uç ve bize göster.",
    "💃 Balerin gibi dans et ve bize göster.",
    "🕺 En iyi hip hop dansını yap ve videosunu buraya gönder."
  ];
  dareTasks = dareTasks.map(task => `*${task}*`);

  Module({
    pattern: 'dc ?(.*)',
    fromMe: false,
    use: 'grup',
    usage: '.dc',
    desc: "Doğruluk mu Cesaret mi oyununu oynatır."
  },
    (async (message, match) => {
      const choice = parseInt(match[1]);
      if (isNaN(choice) || choice < 1 || choice > 2) {
        return await message.sendReply(`*Hadi hemen birini seç!* 🔻\n\n*.dc 1* ➡️ Doğruluk 😌\n*.dc 2* ➡️ Cesaret 😈\n\nℹ️ _Seçimini yaz ve sorun gelsin._ 💣`);
      }

      const questions = choice === 1 ? truthQuestions : dareTasks;
      const randomIndex = Math.floor(Math.random() * questions.length);
      const text = `${choices[choice - 1]}:\n${questions[randomIndex]}`;

      if (message.reply_message && message.quoted) {
        await message.client.sendMessage(message.jid, { text }, { quoted: message.quoted });
      } else {
        await message.sendReply(text);
      }
    }));

  Module({
    on: 'text',
    fromMe: false
  }, async (message) => {
    if (!message.reply_message || !message.reply_message.fromMe) return;

    const repliedText = message.reply_message.text || "";
    if (!repliedText) return;

    let choice = 0;
    if (repliedText.includes("Doğruluk:")) {
      choice = 1;
    } else if (repliedText.includes("Cesaret:")) {
      choice = 2;
    }

    if (choice !== 0) {
      const questions = choice === 1 ? truthQuestions : dareTasks;
      const randomIndex = Math.floor(Math.random() * questions.length);
      const text = `${choices[choice - 1]}:\n${questions[randomIndex]}`;

      await message.sendReply(text);
    }
  });
})();

// ==========================================
// FILE: utility.js
// ==========================================
(function () {
  function TimeCalculator(a) {
    a = Math.abs(a);
    let b = Math.floor(a / 31536e3),
      c = Math.floor((a % 31536e3) / 2628e3),
      d = Math.floor(((a % 31536e3) % 2628e3) / 86400),
      e = Math.floor((a % 86400) / 3600),
      f = Math.floor((a % 3600) / 60),
      g = Math.floor(a % 60);

    let parts = [];
    if (b > 0) parts.push(b + " yıl");
    if (c > 0) parts.push(c + " ay");
    if (d > 0) parts.push(d + " gün");
    if (e > 0) parts.push(e + " saat");
    if (f > 0) parts.push(f + " dakika");
    if (g > 0) parts.push(g + " saniye");

    return parts.length > 0 ? parts.join(", ") : "0 saniye";
  }

  const { Module } = require("../main");
  const config = require("../config");

  const { exec } = require("child_process");
  const { promisify } = require("util");
  const execPromise = promisify(exec);
  const fs = require("fs");
  const path = require("path");
  const https = require("https");
  const { createWriteStream } = require("fs");
  const tar = require("tar");

  // ═══════════════════════════════════
  // 📅 Yaş Hesaplayıcı
  // ═══════════════════════════════════
  Module({
    pattern: "yaşhesap ?(.*)",
    fromMe: false,
    desc: "Doğum tarihinizi girerek detaylı yaş ve zaman hesabı yapmanıza yarar.",
    usage: ".yaşhesap 10/01/2021",
    use: "araçlar",
  },
    async (m, match) => {
      const input = match[1] ? match[1].trim() : "";
      if (!input) return await m.sendReply("📅 *Doğum tarihinizi yazın!* \n\n*💡 Örnek:* \`.yaşhesap 10/01/2021\`");
      if (
        !/^(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[012])[\/\-]\d{4}$/.test(input)
      )
        return await m.sendReply("_⚠️ Tarih gg/aa/yyyy formatında olmalıdır!_\n_Örnek: 15/06/1990_");

      var DOB = input;
      var parts = DOB.includes("-") ? DOB.split("-") : DOB.split("/");
      var actual = parts[1] + "/" + parts[0] + "/" + parts[2];
      var dob = new Date(actual).getTime();

      if (isNaN(dob)) return await m.sendReply("_⚠️ Geçersiz tarih!_");

      var today = new Date().getTime();

      if (dob > today) return await m.sendReply("_⚠️ Doğum tarihi gelecekte olamaz!_");

      var age = (today - dob) / 1000;
      return await m.sendReply("```🎂 Yaşınız: " + TimeCalculator(age) + "```");
    }
  );

  // ═══════════════════════════════════
  // ⏳ Geri Sayım
  // ═══════════════════════════════════
  Module({
    pattern: "gerisayım ?(.*)",
    fromMe: false,
    desc: "Gelecekteki bir tarihe ne kadar süre kaldığını detaylıca hesaplar.",
    usage: ".gerisayım 10/01/2099",
    use: "araçlar",
  },
    async (m, match) => {
      const input = match[1] ? match[1].trim() : "";
      if (!input) return await m.sendReply("📅 *Bana gelecek bir tarih verin!* \n\n*💡 Örnek:* \`.gerisayım 01/01/2099\`");
      if (
        !/^(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[012])[\/\-]\d{4}$/.test(input)
      )
        return await m.sendReply("_⚠️ Tarih gg/aa/yyyy formatında olmalıdır_\n_Örnek: 01/01/2026_");

      var DOB = input;
      var parts = DOB.includes("-") ? DOB.split("-") : DOB.split("/");
      var actual = parts[1] + "/" + parts[0] + "/" + parts[2];
      var dob = new Date(actual).getTime();

      if (isNaN(dob)) return await m.sendReply("_⚠️ Geçersiz tarih!_");

      var today = new Date().getTime();

      if (dob <= today) return await m.sendReply("_⚠️ Lütfen gelecekten bir tarih yazın!_");

      var remaining = (dob - today) / 1000;
      return await m.sendReply("⏳ *" + TimeCalculator(remaining) + "* kaldı.");
    }
  );

  // ═══════════════════════════════════
  // 🏓 Ping Testi
  // ═══════════════════════════════════
  Module({
    pattern: "ping",
    fromMe: false,
    desc: "Botun sunucuya olan tepki hızını ve ağ gecikmesini ölçer.",
    usage: ".ping",
    use: "araçlar",
  },
    async (message) => {
      const start = process.hrtime();
      let sent_msg = await message.sendReply("*❮ ᴘɪɴɢ ᴛᴇsᴛɪ ❯*");
      const diff = process.hrtime(start);
      const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
      await message.edit(
        "🚀 *ᴛᴇᴘᴋɪ sᴜ̈ʀᴇsɪ:* " + ms + " _ᴍs_",
        message.jid,
        sent_msg.key
      );
    }
  );

  // Helper function: Download file
  function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(dest);
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => { });
        reject(err);
      });
    });
  }

  // ═══════════════════════════════════
  // ⚡ Gerçek Speedtest (CLI Binary)
  // ═══════════════════════════════════
  Module({
    pattern: "hıztesti",
    fromMe: false,
    desc: "Botun bulunduğu sunucunun internet indirme ve yükleme hızlarını Ookla Speedtest ile ölçer.",
    usage: ".hıztesti",
    use: "araçlar",
  },
    async (message) => {
      const loading = await message.sendReply(
        "```⚡ Hız testi başlatılıyor...\n⏳ Lütfen bekleyin (30-60 saniye)```"
      );

      try {
        const baseDir = path.join(__dirname, "..");
        const speedtestBin = path.join(baseDir, "speedtest");
        const tempTgz = path.join(baseDir, "speedtest.tgz");

        // Speedtest binary kontrolü ve kurulumu
        if (!fs.existsSync(speedtestBin)) {
          await message.edit(
            "```📦 Speedtest CLI indiriliyor...\n⏳ İlk kullanım 1-2 dakika sürebilir```",
            message.jid,
            loading.key
          );

          try {
            const platform = process.platform;
            const arch = process.arch;

            let downloadUrl;
            if (platform === "linux" && arch === "x64") {
              downloadUrl = "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-x86_64.tgz";
            } else if (platform === "linux" && arch === "arm64") {
              downloadUrl = "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-aarch64.tgz";
            } else if (platform === "darwin" && arch === "x64") {
              downloadUrl = "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-macosx-x86_64.tgz";
            } else if (platform === "darwin" && arch === "arm64") {
              downloadUrl = "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-macosx-universal.tgz";
            } else {
              throw new Error("Desteklenmeyen platform: " + platform + " " + arch);
            }

            await downloadFile(downloadUrl, tempTgz);

            await tar.extract({
              file: tempTgz,
              cwd: baseDir,
              filter: (path) => path === 'speedtest' || path === 'speedtest.exe'
            });

            fs.unlinkSync(tempTgz);

            if (platform !== "win32") {
              fs.chmodSync(speedtestBin, 0o755);
            }

            if (!fs.existsSync(speedtestBin)) {
              throw new Error("Speedtest binary çıkarılamadı");
            }

          } catch (installError) {
            console.error("Speedtest install error:", installError);
            throw new Error("Speedtest kurulumu başarısız: " + installError.message);
          }
        }

        await message.edit(
          "```⚡ Speedtest çalışıyor...\n📊 En yakın sunucu bulunuyor...```",
          message.jid,
          loading.key
        );

        const { stdout } = await execPromise(`${speedtestBin} --accept-license --accept-gdpr --format=json`, {
          timeout: 90000
        });

        const result = JSON.parse(stdout);

        // Sonuçları parse et
        const download = (result.download.bandwidth * 8 / 1000000).toFixed(2);
        const upload = (result.upload.bandwidth * 8 / 1000000).toFixed(2);
        const ping = result.ping.latency.toFixed(0);
        const jitter = result.ping.jitter.toFixed(2);
        const packetLoss = result.packetLoss ? result.packetLoss.toFixed(1) : "0";
        const resultId = result.result.id;

        // Hız kategorisi
        let speedRating = "";
        const dlSpeed = parseFloat(download);
        if (dlSpeed < 10) speedRating = "🐌 Yavaş";
        else if (dlSpeed < 50) speedRating = "🚶 Orta";
        else if (dlSpeed < 100) speedRating = "🏃 Hızlı";
        else if (dlSpeed < 500) speedRating = "🚀 Çok Hızlı";
        else speedRating = "⚡ Ultra Hızlı";

        let finalResult = `⚡ *HIZ TESTİ SONUÇLARI*\n\n`;
        finalResult += `╭─────────────────╮\n`;
        finalResult += `│ 📥 *İndirme:* ${download} Mbps\n`;
        finalResult += `│ 📤 *Yükleme:* ${upload} Mbps\n`;
        finalResult += `│ 🏓 *Ping:* ${ping} ms\n`;
        finalResult += `│ 📊 *Jitter:* ${jitter} ms\n`;
        finalResult += `│ 📦 *Paket Kaybı:* ${packetLoss}%\n`;
        finalResult += `│ ⭐ *Değerlendirme:* ${speedRating}\n`;
        finalResult += `╰─────────────────╯\n\n`;
        finalResult += `_✅ Test tamamlandı! (Ookla Speedtest)_\n`;
        finalResult += `_ℹ️ Sonuç ID: ${resultId}_`;

        await message.edit(finalResult, message.jid, loading.key);

      } catch (error) {
        console.error("Speedtest error:", error);

        let errorMsg = `❌ *Hız testi başarısız!*\n\n`;

        if (error.message.includes("Desteklenmeyen platform")) {
          errorMsg += `_Platform desteklenmiyor: ${process.platform} ${process.arch}_`;
        } else if (error.killed) {
          errorMsg += `_Zaman aşımı! Test 90 saniyede tamamlanamadı._`;
        } else if (error.message.includes("EACCES")) {
          errorMsg += `_İzin hatası! Speedtest binary çalıştırılamadı._`;
        } else if (error.message.includes("kurulumu başarısız")) {
          errorMsg += `_Speedtest indirilemedi. İnternet bağlantınızı kontrol edin._`;
        } else {
          errorMsg += `_${error.message}_`;
        }

        errorMsg += `\n\n💡 *Alternatif:* .ping komutunu deneyin`;

        await message.edit(errorMsg, message.jid, loading.key);
      }
    }
  );
})();

