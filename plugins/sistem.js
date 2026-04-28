"use strict";

/**
 * Merged Module: system.js
 * Components: restart.js, updater.js, schedule.js, external-plugin.js, wamsg.js, hermit-features.js, siputzx.js
 */

// ==========================================
// FILE: restart.js
// ==========================================
(function () {
  const { Module } = require("../main");

  Module({
    pattern: "ybaşlat",
    fromMe: true,
    desc: "Botu yeniden başlatır",
    use: "sistem",
  },
    async (m) => {
      await m.sendReply("🔄 *Bot yeniden başlatılıyor...*");
      process.emit("SIGINT");
    }
  );

  Module({
    pattern: "yinele",
    fromMe: true,
    desc: "Sistemi kapatmadan tüm eklentileri yeniler & günceller.",
    use: "sistem",
  },
    async (m) => {
      const handler = require("../core/handler");
      const path = require("path");
      const { logger } = require("../config");

      const sent = await m.sendReply("⏳ *Eklentiler yenileniyor...*");
      try {
        const pluginsDir = path.join(__dirname, "../plugins");
        const { loaded, failed } = await handler.loadPlugins(pluginsDir, true);
 
        let msg = `✅ *Eklentiler başarıyla yenilendi!*\n\n`;
        msg += `• Toplam Dosya: *${loaded}*\n`;
        if (failed > 0) msg += `• ⚠️ Hatalı: *${failed}* (Konsolu kontrol edin)\n`;
        msg += `• Komut Sayısı: *${handler.commands.length}*\n\n`;
        msg += `_Bağlantı kesilmeden sıcak yenileme tamamlandı._`;
 
        await m.edit(msg, m.jid, sent.key);
        logger.info(`Hot-reload triggered by ${m.pushName}`);
      } catch (err) {
        await m.edit(`❌ *Yenileme sırasında hata oluştu:* ${err.message}`, m.jid, sent.key);
      }
    }
  );
})();

// ==========================================
// FILE: updater.js
// ==========================================
(function () {
  const simpleGit = require("simple-git");
  const git = simpleGit();
  const { Module } = require("../main");
  // const { update } = require('./misc/koyeb');
  const renderDeploy = require('./utils/render_api_baglantisi');
  const config = require("../config");
  const fs = require("fs").promises;
  const axios = require("axios");

  const handler = config.HANDLER_PREFIX;
  const localPackageJson = require("../package.json");

  async function isGitRepo() {
    try {
      await fs.access(".git");
      return true;
    } catch (e) {
      return false;
    }
  }

  async function getRemoteVersion() {
    try {
      const remotePackageJsonUrl = "";
      const response = await axios.get(remotePackageJsonUrl);
      return response.data.version;
    } catch (error) {
      throw new Error("Uzak sürüm bilgisi alınamadı");
    }
  }

  Module({
    pattern: "güncelle ?(.*)",
    fromMe: true,
    desc: "Bot güncellemelerini kontrol eder ve uygular.",
    use: "sistem",
  },
    async (message, match) => {
      if (!(await isGitRepo())) {
        return await message.sendReply("❌ *Bu bot bir Git deposundan çalıştırılmıyor. Otomatik güncellemeler mevcut değil.*"
        );
      }

      const command = match[1] ? match[1].toLowerCase() : "";
      const processingMsg = await message.sendReply("⏳ _Güncellemeler kontrol ediliyor..._");

      try {
        // fetch remote version & commits
        await git.fetch();
        const commits = await git.log(["main" + "..origin/" + "main"]);
        const localVersion = localPackageJson.version;
        let remoteVersion;

        try {
          remoteVersion = await getRemoteVersion();
        } catch (error) {
          return await message.edit(
            "❌ *Uzak sürüm kontrol edilemedi. Lütfen daha sonra tekrar deneyin.*",
            message.jid,
            processingMsg.key
          );
        }

        const hasCommits = commits.total > 0;
        const versionChanged = remoteVersion !== localVersion;

        if (!hasCommits && !versionChanged) {
          return await message.edit(
            "✅ *Bot güncel!*",
            message.jid,
            processingMsg.key
          );
        }

        const isBetaUpdate = hasCommits && !versionChanged;
        const isStableUpdate = hasCommits && versionChanged;

        if (!command) {
          let updateInfo = "";

          if (isStableUpdate) {
            updateInfo = `*_GÜNCELLEME MEVCUT_*\n\n`;
            updateInfo += `📦 Mevcut sürüm: *${localVersion}*\n`;
            updateInfo += `📦 Yeni sürüm: *${remoteVersion}*\n\n`;
            updateInfo += `*_DEĞİŞİKLİK GÜNLÜĞÜ:_*\n\n`;
            for (let i in commits.all) {
              updateInfo += `${parseInt(i) + 1}• *${commits.all[i].message}*\n`;
            }
            updateInfo += `\n_Güncellemeyi uygulamak için "${handler}update start" kullanın_`;
          } else if (isBetaUpdate) {
            updateInfo = `*_BETA GÜNCELLEMESİ MEVCUT_*\n\n`;
            updateInfo += `📦 Mevcut sürüm: *${localVersion}*\n`;
            updateInfo += `⚠️ Yeni commitler mevcut (sürüm değişmedi)\n\n`;
            updateInfo += `*_DEĞİŞİKLİK GÜNLÜĞÜ:_*\n\n`;
            for (let i in commits.all) {
              updateInfo += `${parseInt(i) + 1}• *${commits.all[i].message}*\n`;
            }
            updateInfo += `\n_Beta güncellemelerini uygulamak için "${handler}update beta" kullanın_`;
          }

          return await message.edit(updateInfo, message.jid, processingMsg.key);
        }

        if (command === "start") {
          if (!isStableUpdate) {
            if (isBetaUpdate) {
              return await message.edit(
                `_Sadece beta güncellemeleri mevcut. Uygulamak için "${handler}update beta" kullanın._`,
                message.jid,
                processingMsg.key
              );
            }
            return await message.edit(
              "ℹ️ _Kararlı güncelleme mevcut değil!_",
              message.jid,
              processingMsg.key
            );
          }

          await message.edit(
            "⏳ _Güncelleme başlatılıyor..._",
            message.jid,
            processingMsg.key
          );

          if (process.env.RENDER_SERVICE_ID) {
            if (!config.RENDER_API_KEY) {
              return await message.edit(
                "_⚠️ RENDER_API_KEY eksik!_",
                message.jid,
                processingMsg.key
              );
            }

            await renderDeploy(
              process.env.RENDER_SERVICE_ID,
              config.RENDER_API_KEY
            );
            return await message.edit(
              "✅ *Render dağıtımı başlatıldı!*",
              message.jid,
              processingMsg.key
            );
          }

          if (!__dirname.startsWith("/lds")) {
            await git.reset("hard", ["HEAD"]);
            await git.pull();
            await message.edit(
              `✅ *Sürüm ${remoteVersion}'e başarıyla güncellendi!* \n\nℹ️ _Gerekirse npm modüllerini manuel güncelleyin._`,
              message.jid,
              processingMsg.key
            );
            process.emit("SIGINT");
          } else {
            return await message.edit(
              "_Güncellemek için barındırma platformunu ziyaret edip dağıtımı başlatın._",
              message.jid,
              processingMsg.key
            );
          }
        } else if (command === "beta") {
          if (!hasCommits) {
            return await message.edit(
              "ℹ️ _Beta güncellemesi mevcut değil!_",
              message.jid,
              processingMsg.key
            );
          }

          await message.edit(
            "⏳ _Beta güncellemesi başlatılıyor..._",
            message.jid,
            processingMsg.key
          );

          if (process.env.RENDER_SERVICE_ID) {
            if (!config.RENDER_API_KEY) {
              return await message.edit(
                "_⚠️ RENDER_API_KEY eksik!_",
                message.jid,
                processingMsg.key
              );
            }

            await renderDeploy(
              process.env.RENDER_SERVICE_ID,
              config.RENDER_API_KEY
            );
            return await message.edit(
              "✅ *Beta güncellemesi için Render dağıtımı başlatıldı!*",
              message.jid,
              processingMsg.key
            );
          }

          if (!__dirname.startsWith("/lds")) {
            await git.reset("hard", ["HEAD"]);
            await git.pull();
            await message.edit(
              `✅ *Beta güncellemesi başarıyla uygulandı!* (${commits.total} commit) \n\nℹ️ _Gerekirse npm modüllerini manuel güncelleyin!_`,
              message.jid,
              processingMsg.key
            );
            process.emit("SIGINT");
          } else {
            return await message.edit(
              "_Güncellemek için barındırma platformunu ziyaret edip dağıtımı başlatın._",
              message.jid,
              processingMsg.key
            );
          }
        } else {
          return await message.edit(
            `_Geçersiz komut. Güncellemeleri kontrol için "${handler}update", kararlı güncelleme için "${handler}update start", beta güncelleme için "${handler}update beta" kullanın._`,
            message.jid,
            processingMsg.key
          );
        }
      } catch (error) {
        console.error("Güncelleme hatası:", error);
        return await message.edit(
          "❌ *Güncellemeler kontrol edilirken bir hata oluştu.*",
          message.jid,
          processingMsg.key
        );
      }
    }
  );
})();

// ==========================================
// FILE: schedule.js
// ==========================================
(function () {
  const { Module } = require("../main");
  const { scheduledMessages } = require("./utils/db/zamanlayicilar");
  const moment = require("moment");

  function isValidJID(text) {
    return (
      text.endsWith("@g.us") ||
      text.endsWith("@s.whatsapp.net") ||
      text.endsWith("@lid")
    );
  }

  function parseTime(timeStr) {
    const now = moment();
    const durationMatch =
      timeStr.match(/^(\d+)\s*(g|gün|gun)$/i) ||
      timeStr.match(/^(\d+)\s*(s|saat)$/i) ||
      timeStr.match(/^(\d+)\s*(d|dk|dakika)$/i) ||
      timeStr.match(/^(\d+)\s*(sn|saniye)$/i) ||
      timeStr.match(/^(\d+)\s*(saat)\s*(\d+)\s*(dk|dakika)$/i) ||
      timeStr.match(/^(\d+)\s*(s)\s*(\d+)\s*(dk|dakika)$/i) ||
      timeStr.match(/^(\d+)\s*(dk|dakika)\s*(\d+)\s*(sn|saniye)$/i);

    if (durationMatch) {
      let duration = moment.duration();
      if (
        (timeStr.includes("saat") || timeStr.match(/\d+s\d+/)) &&
        (timeStr.includes("dk") || timeStr.includes("dakika"))
      ) {
        const match = timeStr.match(/^(\d+)\s*(saat|s)\s*(\d+)\s*(dk|dakika)$/i);
        if (match) {
          const [, hours, , minutes] = match;
          duration.add(parseInt(hours), "hours").add(parseInt(minutes), "minutes");
        }
      } else if (
        (timeStr.includes("dk") || timeStr.includes("dakika")) &&
        (timeStr.includes("sn") || timeStr.includes("saniye"))
      ) {
        const match = timeStr.match(/^(\d+)\s*(dk|dakika)\s*(\d+)\s*(sn|saniye)$/i);
        if (match) {
          const [, minutes, , seconds] = match;
          duration
            .add(parseInt(minutes), "minutes")
            .add(parseInt(seconds), "seconds");
        }
      } else {
        const [, value, unit] = durationMatch;
        const unitMap = {
          g: "days",
          gün: "days",
          gun: "days",
          s: "hours",
          saat: "hours",
          d: "minutes",
          dk: "minutes",
          dakika: "minutes",
          sn: "seconds",
          saniye: "seconds",
        };
        duration.add(parseInt(value), unitMap[unit.toLowerCase()]);
      }
      return now.add(duration).subtract(1, "minute").toDate();
    }

    const timeMatch = timeStr.match(/^(\d{1,2})[:.](\d{2})$/i);
    if (timeMatch) {
      let [, hours, minutes] = timeMatch;
      hours = parseInt(hours);
      minutes = parseInt(minutes);
      const targetTime = moment().hours(hours).minutes(minutes).seconds(0);
      if (targetTime.isBefore(now)) {
        targetTime.add(1, "day");
      }
      return targetTime.subtract(1, "minute").toDate();
    }

    const dateTime = moment(timeStr, [
      "DD.MM.YYYY HH:mm",
      "DD/MM/YYYY HH:mm",
      "DD.MM.YYYY HH.mm",
      "YYYY-MM-DD HH:mm",
    ]);
    if (dateTime.isValid()) {
      return dateTime.subtract(1, "minute").toDate();
    }

    return null;
  }

  async function createMessageObject(
    replyMessage,
    mentionJid = null,
    isGroupMessage = false
  ) {
    let messageObj = {};

    if (isGroupMessage && mentionJid && replyMessage.text) {
      const mentionText = `⏰ @${mentionJid.split("@")[0]} `;
      messageObj.text = mentionText + replyMessage.text;
      messageObj.mentions = [mentionJid];
    } else if (replyMessage.text) {
      messageObj.text = replyMessage.text;
    }

    if (replyMessage.image) {
      const buffer = await replyMessage.download("buffer");
      messageObj.image = buffer.toString("base64");
      if (replyMessage.caption) {
        if (isGroupMessage && mentionJid) {
          const mentionText = `⏰ @${mentionJid.split("@")[0]} `;
          messageObj.caption = mentionText + replyMessage.caption;
          messageObj.mentions = [mentionJid];
        } else {
          messageObj.caption = replyMessage.caption;
        }
      }
      messageObj._mediaType = "image";
    }

    if (replyMessage.video) {
      const buffer = await replyMessage.download("buffer");
      messageObj.video = buffer.toString("base64");
      if (replyMessage.caption) {
        if (isGroupMessage && mentionJid) {
          const mentionText = `⏰ @${mentionJid.split("@")[0]} `;
          messageObj.caption = mentionText + replyMessage.caption;
          messageObj.mentions = [mentionJid];
        } else {
          messageObj.caption = replyMessage.caption;
        }
      }
      messageObj._mediaType = "video";
      if (replyMessage.gifPlayback) messageObj.gifPlayback = true;
    }

    if (replyMessage.audio) {
      const buffer = await replyMessage.download("buffer");
      messageObj.audio = buffer.toString("base64");
      messageObj.mimetype = replyMessage.mimetype || "audio/mp4";
      messageObj._mediaType = "audio";
      if (replyMessage.ptt) messageObj.ptt = true;
    }

    if (replyMessage.document) {
      const buffer = await replyMessage.download("buffer");
      messageObj.document = buffer.toString("base64");
      messageObj.fileName = replyMessage.fileName || "document";
      messageObj.mimetype = replyMessage.mimetype;
      messageObj._mediaType = "document";
    }

    if (replyMessage.sticker) {
      const buffer = await replyMessage.download("buffer");
      messageObj.sticker = buffer.toString("base64");
      messageObj._mediaType = "sticker";
    }

    return JSON.stringify(messageObj);
  }

  Module({
    pattern: "planla ?(.*)",
    fromMe: false,
    desc: "⏰ Mesaj planla - Gruba veya özele zamanlanmış mesaj gönder",
    use: "araçlar",
  },
    async (m, match) => {
      if (!m.reply_message) {
        return await m.sendReply(
          "⚠️ *Planlamak istediğiniz mesaja yanıt veriniz!* \n\n*📋 Kullanımı:*\n• `.planla @üye <zaman>` _(gruba etiketle ve gönder)_\n• `.planla dm @üye <zaman>` _(özeline gönder)_\n\n*⏱️ Zaman formatları:*\n• `2 saat 30 dakika`\n• `1 gün`\n• `30 dakika`\n• `5 saniye`\n• `14:30`\n• `25.12.2026 11:00`"
        );
      }

      if (!match[1]?.trim()) {
        return await m.sendReply(
          "⚠️ *Lütfen üye etiketleyip zaman belirtiniz!* \n\n*💡 Örnek:*\n• `.planla @üye 2 saat`\n• `.planla dm @üye 30 dakika`"
        );
      }

      let input = match[1].trim();
      let isDM = false;

      if (input.startsWith("dm ")) {
        isDM = true;
        input = input.substring(3).trim();
      }

      let targetJid = null;
      let mentionedUser = m.mention?.[0];

      if (!mentionedUser) {
        return await m.sendReply(
          "⚠️ *Lütfen bir üyeyi etiketleyin!* \n\n*💡 Örnek:*\n• `.planla @üye 2 saat`\n• `.planla dm @üye 30 dakika`"
        );
      }

      targetJid = mentionedUser;
      input = input.replace(/@\d+/g, "").trim();

      const timeStr = input.trim();
      if (!timeStr) {
        return await m.sendReply(
          "⚠️ *Lütfen zaman belirtin!* \n\n*💡 Örnek:*\n• `.planla @üye 2 saat`\n• `.planla dm @üye 30 dakika`"
        );
      }

      const scheduleTime = parseTime(timeStr);
      if (!scheduleTime) {
        return await m.sendReply(
          "❌ *Geçersiz zaman formatı!* \n\n*⏱️ Desteklenen formatlar:*\n• `2 saat 30 dakika`, `2saat30dk`, `2s30dk`\n• `1 gün`, `1g`\n• `30 dakika`, `30dk`, `30 dk`\n• `5 saniye`, `5sn`\n• `14:30`, `14.30`\n• `25.12.2024 14:30`"
        );
      }

      const originalTime = moment(scheduleTime).add(1, "minute").toDate();
      if (originalTime <= new Date()) {
        return await m.sendReply("⚠️ *Planlama zamanı gelecek zaman olmalıdır!*");
      }

      const minTime = moment().add(2, "minutes").toDate();
      if (originalTime < minTime) {
        return await m.sendReply(
          "⚠️ *Minimum planlama süresi 2 dakikadır. Lütfen en az 2 dakika sonrası için planlayın.*"
        );
      }

      const finalJid = isDM ? targetJid : m.jid;
      const isGroupMessage = !isDM;

      try {
        const messageData = await createMessageObject(
          m.reply_message,
          isGroupMessage ? targetJid : null,
          isGroupMessage
        );

        await scheduledMessages.add(finalJid, messageData, scheduleTime);

        moment.locale("tr");
        const timeFromNow = moment(scheduleTime).add(1, "minute").fromNow();
        const formattedTime = moment(scheduleTime)
          .add(1, "minute")
          .format("DD.MM.YYYY HH:mm");

        const targetInfo = isDM ? "📩 Özelden İletilecek (DM)" : "💬 Gruba İletilecek (Etiket ile)";

        await m.sendReply(
          `✅ *Mesaj başarıyla planlandı!*\n\n📅 *Tarih:* ${formattedTime}\n⏰ *Kalan süre:* ${timeFromNow}\n📱 *Hedef:* ${targetInfo}\n👤 *Üye:* @${targetJid.split("@")[0]}`,
          { mentions: [targetJid] }
        );
      } catch (error) {
        console.error("Mesaj planlama hatası:", error);
        await m.sendReply("❌ *Mesaj planlanırken hata oluştu. Lütfen tekrar deneyin.*");
      }
    }
  );

  Module({
    pattern: "plandurum ?(.*)",
    fromMe: false,
    desc: "📋 Planlanan tüm mesajları listeler",
    use: "araçlar",
    usage: ".plandurum",
  },
    async (m, match) => {
      try {
        const pending = await scheduledMessages.getAllPending();
        if (pending.length === 0) {
          return await m.sendReply("📭 _Bekleyen planlı mesaj bulunmuyor._");
        }

        moment.locale("tr");
        let response = "📋 *Planlanan Mesajlar*\n\n";

        pending.sort(
          (a, b) => new Date(a.scheduleTime).getTime() - new Date(b.scheduleTime).getTime()
        );

        pending.forEach((msg, index) => {
          const timeFromNow = moment(msg.scheduleTime).add(1, "minute").fromNow();
          const formattedTime = moment(msg.scheduleTime)
            .add(1, "minute")
            .format("DD.MM.YYYY HH:mm");

          const preview = JSON.parse(msg.message);
          let content = preview.text || preview.caption || "🎬 Medya mesajı";
          if (content.length > 30) content = content.substring(0, 30) + "...";

          response += `${index + 1}. *🆔 ID:* ${msg.id}\n`;
          response += `   *📱 Gönderilecek:* ${msg.jid}\n`;
          response += `   *📅 Tarih:* ${formattedTime}\n`;
          response += `   *⏰ Kalan:* ${timeFromNow}\n`;
          response += `   *💬 İçerik:* ${content}\n\n`;
        });

        response += '💡 _Planlı mesajı iptal etmek için ".plansil <id>" yazınız._';
        await m.sendReply(response);
      } catch (error) {
        console.error("Planlananlar listelenirken hata:", error);
        await m.sendReply("❌ *Planlanan mesajlar getirilemedi!*");
      }
    }
  );

  Module({
    pattern: "plansil ?(.*)",
    fromMe: false,
    desc: "🗑️ Planlanan mesajı ID ile iptal eder",
    use: "araçlar",
    usage: ".plansil <id>",
  },
    async (m, match) => {
      if (!match[1]?.trim()) {
        return await m.sendReply(
          "⚠️ *Lütfen iptal edilecek mesajın ID'sini girin!* \n\n*💡 Kullanım:* `.plansil <id>` \n\nℹ️ _Planlanan mesajları görmek için_ \`.plandurum\` _yazınız._"
        );
      }

      const messageId = parseInt(match[1].trim());
      if (isNaN(messageId)) {
        return await m.sendReply("⚠️ *Lütfen geçerli bir mesaj ID'si girin!*");
      }

      try {
        const success = await scheduledMessages.delete(messageId);
        if (success) {
          await m.sendReply(
            `✅ *Planlı mesaj başarıyla silindi!*\n\n🗑️ *Mesaj ID:* ${messageId}`
          );
        } else {
          await m.sendReply("❌ *Mesaj bulunamadı veya zaten gönderilmiş!*");
        }
      } catch (error) {
        console.error("Planlama iptal hatası:", error);
        await m.sendReply("❌ *Planlı mesaj iptal edilemedi!*");
      }
    }
  );

  module.exports = {
    isValidJID,
    parseTime,
    createMessageObject,
  };
})();

// ==========================================
// FILE: external-plugin.js
// ==========================================
(function () {
  const { Module } = require("../main");
  const config = require("../config");
  const axios = require("axios");
  const fs = require("fs");
  const { PluginDB } = require('./utils/db/modeller');
  const installPlugin = async (url, name) => {
    await PluginDB.findOrCreate({ where: { name }, defaults: { name, url } });
  };
  const handler = config.HANDLER_PREFIX;
  const { extractUrls, validateUrl } = require("../core/yardimcilar");
  const crypto = require("crypto");
  const vm = require("vm");

  Module({
    pattern: "modülyükle ?(.*)",
    fromMe: true,
    desc: "Modül yükler.",
    use: "sahip",
  },
    async (message, match) => {
      match = match[1] !== "" ? match[1] : (message.reply_message?.text || "");
      if (!match) return await message.send("⚠️ *Lütfen bir bağlantı giriniz!*");

      const links = extractUrls(match);
      if (!links.length) return await message.send("⚠️ *Lütfen bir bağlantı giriniz!*");

      for (const link of links) {
        let url;
        try {
          url = new URL(link);
        } catch {
          return await message.send("❗️ ```Lütfen bir geçerli URL giriniz!```");
        }

        if (!validateUrl(link, "github_gist")) {
          return await message.sendReply(
            `⚠️ *Güvenlik:* _Yalnızca GitHub Gist bağlantıları desteklenir._`
          );
        }

        if (
          url.host === "gist.github.com" ||
          url.host === "gist.githubusercontent.com"
        ) {
          url = !url?.toString().endsWith("raw")
            ? url.toString() + "/raw"
            : url.toString();
        } else {
          url = url.toString();
        }
        let response;
        try {
          response = await axios(url + "?timestamp=" + new Date());
        } catch {
          return await message.send("❗️ *Lütfen geçerli bir URL giriniz!*");
        }
        let plugin_name = /pattern: ["'](.*)["'],/g.exec(response.data);
        let plugin_name_temp = response.data.match(/pattern: ["'](.*)["'],/g)
          ? response.data
            .match(/pattern: ["'](.*)["'],/g)
            .map((e) => e.replace("pattern", "").replace(/[^a-zA-Z]/g, ""))
          : "temp";
        try {
          plugin_name = plugin_name[1].split(" ")[0].replace(/[^a-zA-Z0-9_]/g, "");
        } catch {
          return await message.sendReply("❌ *Geçersiz eklenti. Eklenti adı bulunamadı!*"
          );
        }
        const pluginHash = crypto.createHash("sha256").update(response.data).digest("hex");
        try {
          // VM validation parse
          const script = new vm.Script(response.data);
        } catch (err) {
          return await message.sendReply(`❌ *Güvenlik Duvarı:* _Eklenti sözdizimi asimetrik veya hatalı._`);
        }

        fs.writeFileSync("./plugins/" + plugin_name + ".js", response.data);
        plugin_name_temp =
          plugin_name_temp.length > 1 ? plugin_name_temp.join(", ") : plugin_name;
        try {
          require("./" + plugin_name);
        } catch (e) {
          fs.unlinkSync(__dirname + "/" + plugin_name + ".js");
          return await message.sendReply("❌ *Modülünüz hatalı!*\n\n*Hata:*" + e);
        }

        // Kayıtlara kodun kendisini de hash ile birlikte kaydet
        await installPlugin(url, plugin_name);
        await PluginDB.update({ code: pluginHash }, { where: { name: plugin_name } });
        await message.send(`*✅ Modül başarılı bir şekilde yüklendi!* (${plugin_name_temp})\n\n*🔒 Güvenlik Hash:* \`${pluginHash.slice(0, 8)}\``);
      }
    }
  );

  Module({
    pattern: "modül ?(.*)",
    fromMe: true,
    desc: "Yüklediğiniz eklentileri gösterir.",
    use: "sahip",
  },
    async (message, match) => {
      let plugins = await PluginDB.findAll();
      if (match[1] !== "") {
        const plugin = plugins.filter(
          (_plugin) => _plugin.dataValues.name === match[1]
        );
        try {
          await message.sendReply(
            `ℹ️ _${plugin[0].dataValues.name}:_ ${plugin[0].dataValues.url}`
          );
        } catch {
          return await message.sendReply("⚠️ ```Böyle bir modül belki yüklediniz, belki de yüklemediniz... Ama şu an olmadığı kesin.```");
        }
        return;
      }
      let msg = "*✅ Yüklü Modüller:*\n\n";
      plugins = await PluginDB.findAll();
      if (plugins.length < 1) {
        return await message.send("⚠️ *Dışarıdan hiç modül yüklememişsiniz!*");
      } else {
        plugins.map((plugin) => {
          msg +=
            "*" +
            plugin.dataValues.name +
            "* : " +
            (plugin.dataValues.url.endsWith("/raw")
              ? plugin.dataValues.url.replace("raw", "")
              : plugin.dataValues.url) +
            "\n\n";
        });
        return await message.sendReply(msg);
      }
    }
  );

  Module({
    pattern: "modülsil ?(.*)",
    fromMe: true,
    desc: "Modül kaldırır.",
    use: "sahip",
  },
    async (message, match) => {
      if (match[1] === "") return await message.send("⚠️ *Lütfen bir modül giriniz!* \n\n*Örnek:* `.modülsil test`");
      const safePluginName = match[1].replace(/[^a-zA-Z0-9_]/g, "");
      const plugin = await PluginDB.findAll({
        where: {
          name: safePluginName,
        },
      });
      if (plugin.length < 1) {
        return await message.send("⚠️ *Dışarıdan hiç modül yüklememişsiniz!*");
      } else {
        await plugin[0].destroy();
        const Message = `*✅ Modül başarıyla silindi! (${safePluginName})*`;
        await message.sendReply(Message);
        try { delete require.cache[require.resolve("./" + safePluginName + ".js")]; } catch (_) { }
        try { if (fs.existsSync("./plugins/" + safePluginName + ".js")) fs.unlinkSync("./plugins/" + safePluginName + ".js"); } catch (_) { }
      }
    }
  );

  Module({
    pattern: "mgüncelle ?(.*)",
    fromMe: true,
    desc: "Bir eklentiyi (plugin) günceller",
    use: "sahip",
    usage: ".mgüncelle eklenti_adı",
  },
    async (m, match) => {
      let plugin = match[1];
      if (!plugin) return await m.send("⚠️ *Lütfen bir modül giriniz!* \n\n*Örnek:* `.mgüncelle test`");
      plugin = plugin.replace(/[^a-zA-Z0-9_]/g, "");
      await PluginDB.sync();
      const plugins = await PluginDB.findAll({
        where: {
          name: plugin,
        },
      });
      if (plugins.length < 1) {
        return await m.send("⚠️ ```Böyle bir modül belki yüklediniz, belki de yüklemediniz... Ama şu an olmadığı kesin.```");
      }
      const url = plugins[0].dataValues.url;
      let response;
      try {
        response = await axios(url + "?timestamp=" + new Date());
      } catch {
        return await m.send("❗️ *Lütfen geçerli bir URL giriniz!*");
      }
      const pluginHash = crypto.createHash("sha256").update(response.data).digest("hex");
      if (plugins[0].dataValues.code && plugins[0].dataValues.code === pluginHash) {
        return await m.send("⚠️ *Eklenti güncel, değişiklik yok.*");
      }

      try {
        const script = new vm.Script(response.data);
      } catch (e) {
        return await m.send("❌ *Güvenlik Duvarı Reddedildi!*");
      }

      fs.writeFileSync("./plugins/" + plugin + ".js", response.data);
      delete require.cache[require.resolve("./" + plugin + ".js")];
      try {
        require("./" + plugin);
      } catch (e) {
        fs.unlinkSync(__dirname + "/" + plugin + ".js");
        return await m.send("*❌ Modülünüz hatalı!*\n\n*Hata:*" + e);
      }
      await PluginDB.update({ code: pluginHash }, { where: { name: plugin } });
      await m.send(`✅ *Eklenti '${plugin}' güncellendi!*\n\n*🔒 Yeni Hash:* \`${pluginHash.slice(0, 8)}\``);
      process.emit("SIGINT");
      return;
    }
  );
})();

// ==========================================
// FILE: wamsg.js
// ==========================================
(function () {
  const { Module } = require("../main");
  const { censorBadWords, isAdmin } = require("./utils");
  const { ADMIN_ACCESS, MODE } = require("../config");
  Module({
    pattern: "ifade ?(.*)",
    fromMe: false,
    desc: "Yanıtlanan mesaja belirtilen emoji ile ifade bırakır.",
    use: "araçlar",
  },
    async (m, t) => {
      if (!m.reply_message) return await m.sendReply("💬 *Bir mesaja yanıtlayın!*");
      let msg = {
        remoteJid: m.reply_message?.jid,
        id: m.reply_message.id,
      };
      const reactionMessage = {
        react: {
          text: t[1],
          key: msg,
        },
      };

      await m.client.sendMessage(m.jid, reactionMessage);
    }
  );
  Module({
    pattern: "düzenle ?(.*)",
    fromMe: true,
    desc: "Botun gönderdiği mesajı düzenler.",
    use: "araçlar",
  },
    async (m, t) => {
      if (!m.reply_message) return await m.sendReply("💬 *Düzenlenecek mesajı yanıtlayın!*");
      if (!t[1]) return await m.sendReply("💬 *Yeni metni girin!*");

      if (m.quoted?.key?.fromMe) {
        const safeText = censorBadWords(t[1]);
        await m.edit(safeText, m.jid, m.quoted.key);
        await m.sendReply("✅ *Mesaj düzenlendi!*");
      } else {
        await m.sendReply("❌ *Sadece kendi mesajlarınızı düzenleyebilirsiniz!*");
      }
    }
  );
  Module({
    pattern: "msjat ?(.*)",
    fromMe: true,
    desc: "Sohbeti veya mesajı, belirtilen JID adresine (numaraya) doğrudan iletir.",
    use: "araçlar",
  },
    async (m, t) => {
      const query = (t[1] || "").trim();

      if (m.reply_message) {
        const jidMap = (query || m.jid).split(" ").filter((x) => x.includes("@"));
        if (!jidMap.length) {
          return await m.sendReply("❌ *Sorguda geçerli bir JID bulunamadı!* \n\n💬 _Kullanım:_ `msjat jid1 jid2 ...`"
          );
        }
        for (const jid of jidMap) {
          await m.forwardMessage(jid, m.quoted, {
            contextInfo: { isForwarded: false },
          });
        }
        return;
      }

      if (!query) {
        return await m.sendReply("💬 *Bir mesajı yanıtlayın veya* `.msjat jid mesaj` *şeklinde kullanın.*");
      }

      const firstSpace = query.indexOf(" ");
      const jid = firstSpace === -1 ? query : query.slice(0, firstSpace).trim();
      const text = firstSpace === -1 ? "" : query.slice(firstSpace + 1).trim();

      if (!jid.includes("@")) {
        return await m.sendReply("❌ *Geçerli bir JID girin!* \n\n*Örnek:* `.msjat 120363xxxx@g.us Merhaba`");
      }

      if (!text) {
        return await m.sendReply("_❌ Gönderilecek mesaj metni eksik!_");
      }

      await m.client.sendMessage(jid, { text });
      return await m.sendReply("✅ *Mesaj gönderildi!*");
    }
  );
  Module({
    pattern: "msjyönlendir ?(.*)",
    fromMe: true,
    desc: "Sohbeti veya mesajı, belirtilen JID adresine `İletildi` olarak gönderir.",
    use: "araçlar",
  },
    async (m, t) => {
      const query = (t[1] || "").trim();

      if (m.reply_message) {
        const jidMap = (query || m.jid).split(" ").filter((x) => x.includes("@"));
        if (!jidMap.length) {
          return await m.sendReply("❌ *Sorguda geçerli bir JID bulunamadı!* \n\n💬 _Kullanım:_ `msjyönlendir jid1 jid2 ...`"
          );
        }
        for (const jid of jidMap) {
          await m.forwardMessage(jid, m.quoted, {
            contextInfo: { isForwarded: true, forwardingScore: 2 },
          });
        }
        return;
      }

      if (!query) {
        return await m.sendReply("💬 *Bir mesajı yanıtlayın veya* `.msjyönlendir jid mesaj` *şeklinde kullanın.*");
      }

      const firstSpace = query.indexOf(" ");
      const jid = firstSpace === -1 ? query : query.slice(0, firstSpace).trim();
      const text = firstSpace === -1 ? "" : query.slice(firstSpace + 1).trim();

      if (!jid.includes("@")) {
        return await m.sendReply("❌ *Geçerli bir JID girin!* \n\n*Örnek:* `.msjyönlendir 120363xxxx@g.us Merhaba`");
      }

      if (!text) {
        return await m.sendReply("_❌ Gönderilecek mesaj metni eksik!_");
      }

      await m.client.sendMessage(jid, {
        text,
        contextInfo: { isForwarded: true, forwardingScore: 2 },
      });
      return await m.sendReply("✅ *Mesaj gönderildi!*");
    }
  );
  Module({
    pattern: "tekrar ?(.*)",
    fromMe: false,
    desc: "Yanıtlanan komutu tekrar çalıştırmayı dener",
    use: "araçlar",
  },
    async (m, t) => {
      if (!m.reply_message)
        return await m.sendReply("💬 *Bir komut mesajına yanıtlayın!*");
      await new Promise(resolve => setTimeout(resolve, 500));
      await m.client.ev.emit("messages.upsert", {
        messages: [m.quoted],
        type: "notify",
      });
    }
  );
  Module({
    pattern: "vv ?(.*)",
    fromMe: false,
    desc: "Tek gösterimlik mesajları yakalar",
    use: "araçlar",
  },
    async (m, match) => {
      const adminAccesValidated = await isAdmin(m);
      if (!m.fromOwner && !adminAccesValidated) {
        return await m.sendReply("❌ *Bu komutu sadece yöneticiler kullanabilir!*");
      }

      const quoted = m.quoted?.message,
        realQuoted = m.quoted;

      if (!m.reply_message || !quoted) {
        return await m.sendReply("❌ *Tek gösterimlik mesaj değil!*");
      }

      if (match[1] && match[1].includes("@")) m.jid = match[1];

      const viewOnceKey = [
        "viewOnceMessage",
        "viewOnceMessageV2",
        "viewOnceMessageV2Extension",
      ].find((key) => quoted.hasOwnProperty(key));

      const { resolveLidToPn } = require("../core/yardimcilar");
      const fixMentions = async (msgBody) => {
        const type = Object.keys(msgBody)[0];
        if (msgBody[type] && msgBody[type].contextInfo && msgBody[type].contextInfo.mentionedJid) {
          const mentions = msgBody[type].contextInfo.mentionedJid;
          const resolved = [];
          for (let jid of mentions) {
            const resolvedJid = await resolveLidToPn(m.client, jid);
            resolved.push(resolvedJid);
            if (jid.includes("@lid") && msgBody[type].caption) {
              const lidNum = jid.split("@")[0];
              const pnNum = resolvedJid.split("@")[0];
              msgBody[type].caption = msgBody[type].caption.replace(
                new RegExp("@" + lidNum, "g"),
                "@" + pnNum
              );
            }
          }
          msgBody[type].contextInfo.mentionedJid = resolved;
        }
      };

      if (viewOnceKey) {
        const realMessage = quoted[viewOnceKey].message;
        const msgType = Object.keys(realMessage)[0];
        if (realMessage[msgType]?.viewOnce) realMessage[msgType].viewOnce = false;
        await fixMentions(realMessage);
        m.quoted.message = realMessage;
        return await m.forwardMessage(m.jid, m.quoted, {
          contextInfo: { isForwarded: false },
        });
      }

      const directType = quoted.imageMessage
        ? "imageMessage"
        : quoted.audioMessage
          ? "audioMessage"
          : quoted.videoMessage
            ? "videoMessage"
            : null;

      if (directType && quoted[directType]?.viewOnce) {
        quoted[directType].viewOnce = false;
        await fixMentions(quoted);
        return await m.forwardMessage(m.jid, m.quoted, {
          contextInfo: { isForwarded: false },
        });
      }

      await m.sendReply("❌ *Tek gösterimlik mesaj değil!*");
    }
  );
  Module({
    pattern: "msjsil",
    fromMe: true,
    desc: "Mesajı herkesten siler. Yönetici silmesini destekler",
    use: "araçlar",
  },
    async (m, t) => {
      if (!m.reply_message) return await m.sendReply("💬 *Silinecek mesajı yanıtlayın!*");

      let adminAccesValidated = await isAdmin(m);
      if (m.fromOwner || adminAccesValidated) {
        m.jid = m.quoted.key.remoteJid;
        if (m.quoted.key.fromMe) {
          await m.client.sendMessage(m.jid, { delete: m.quoted.key });
          return await m.sendReply("✅ *Mesaj silindi!*");
        }
        if (!m.quoted.key.fromMe) {
          var admin = await isAdmin(m);
          if (!admin) return await m.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
          await m.client.sendMessage(m.jid, { delete: m.quoted.key });
          return await m.sendReply("✅ *Mesaj yönetici yetkisiyle silindi!*");
        }
      } else {
        await m.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      }
    }
  );
})();

// ==========================================
// FILE: hermit-features.js
// ==========================================
(function () {
  /**
   * plugins/hermit-features.js
   * hermit-bot'dan uyarlanan özellikler
   * - Mesaj yönlendirme
   * - Otomatik tepki
   * - Sistem bilgisi  
   * - QR kod oluşturma
   * Tüm çıktılar %100 Türkçe
   */
  const { Module } = require("../main");
  const os = require("os");

  // ══════════════════════════════════════════════════════
  // Mesaj Yönlendirme
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "ilet ?(.*)",
    fromMe: true,
    desc: "Yanıtlanan mesajı belirtilen sohbete yönlendirir.",
    usage: ".ilet [numara veya grup jid]",
    use: "araçlar",
  }, async (message, match) => {
    const target = (match[1] || "").trim();
    if (!target) return await message.sendReply("💬 *Hedef numara/grup girin:* `.ilet 905xxxxxxxxx`");
    if (!message.reply_message) return await message.sendReply("💬 *Bir mesajı yanıtlayarak kullanın!*");

    try {
      const jid = target.includes("@") ? target : target + "@s.whatsapp.net";
      await message.client.sendMessage(jid, {
        forward: message.reply_message.data || message.data
      });
      await message.sendReply("✅ *Mesaj iletildi!*");
    } catch (e) {
      await message.sendReply(`❌ *Mesaj iletilemedi:* ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════
  // Otomatik Tepki (Auto React)  
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "ototepki ?(.*)",
    fromMe: false,
    desc: "Gelen mesajlara otomatik emoji tepkisi verir (aç/kapat).",
    usage: ".ototepki aç | .ototepki kapat",
    use: "ayarlar",
  }, async (message, match) => {
    const arg = (match[1] || "").trim().toLowerCase();
    if (!global._autoReactGroups) global._autoReactGroups = new Set();

    if (arg === "ac" || arg === "aç") {
      global._autoReactGroups.add(message.jid);
      await message.sendReply("✅ *Otomatik tepki bu sohbet için açıldı.*");
    } else if (arg === "kapat" || arg === "kapa") {
      global._autoReactGroups.delete(message.jid);
      await message.sendReply("❌ *Otomatik tepki bu sohbet için kapatıldı.*");
    } else {
      const status = global._autoReactGroups.has(message.jid) ? "Açık" : "Kapalı";
      await message.sendReply(`*Otomatik Tepki:* ${status}\n\n_.ototepki ac_ - Açmak için\n_.ototepki kapat_ - Kapatmak için`);
    }
  });

  // ══════════════════════════════════════════════════════
  // Sistem Bilgisi
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "sistembilgi",
    fromMe: false,
    desc: "Sistem donanım ve yazılım bilgilerini gösterir.",
    usage: ".sistembilgi",
    use: "araçlar",
  }, async (message) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const secs = Math.floor(uptime % 60);

    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : "Bilinmiyor";

    const text = [
      `*Sistem Bilgileri*\n`,
      `*Platform:* ${os.platform()} ${os.arch()}`,
      `*Hostname:* ${os.hostname()}`,
      `*OS:* ${os.type()} ${os.release()}`,
      `*Node.js:* ${process.version}`,
      `*CPU:* ${cpuModel}`,
      `*CPU Çekirdek:* ${cpus.length}`,
      `*Toplam RAM:* ${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
      `*Kullanılan RAM:* ${(usedMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
      `*Boş RAM:* ${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
      `*Bot RAM:* ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
      `*Çalışma Süresi:* ${hours}s ${mins}dk ${secs}sn`,
      `*PID:* ${process.pid}`,
    ].join("\n");

    await message.sendReply(text);
  });

  // ══════════════════════════════════════════════════════
  // Bio (Hakkımda) Yazma — WhatsApp profil durumu
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "bioyaz ?(.*)",
    fromMe: true,
    desc: "WhatsApp 'Hakkımda' bilgisini (bio) günceller.",
    usage: ".bioyaz [metin]",
    use: "ayarlar",
  }, async (message, match) => {
    const text = (match[1] || "").trim();
    if (!text) return await message.sendReply("💬 *Bio metni girin:* `.bioyaz Aktif!`");
    if (text.length > 139) {
      return await message.sendReply(`⚠️ *Bio en fazla 139 karakter olabilir!* \n_Girilen:_ ${text.length} karakter`);
    }

    try {
      const sock = message.client;
      // Baileys updateProfileStatus -> WhatsApp 'About' alanı (bio)
      if (typeof sock.updateProfileStatus !== "function") {
        throw new Error("Baileys updateProfileStatus fonksiyonu mevcut değil");
      }
      await sock.updateProfileStatus(text);

      // Doğrulama: Hemen geri okumaya çalış
      let verified = "";
      try {
        if (typeof sock.fetchStatus === "function" && sock.user?.id) {
          const me = sock.user.id;
          const cur = await sock.fetchStatus(me);
          const got = cur?.status || cur?.[0]?.status?.status;
          if (got) verified = `\n\n_Şu anki:_ *${got}*`;
        }
      } catch (_) { }

      await message.sendReply(`✅ *Bio güncellendi:* *${text}*${verified}`);
    } catch (e) {
      await message.sendReply(`❌ *Bio güncellenemedi!* \n\n*Hata:* ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════
  // Okundu/Okunmadı İşareti (Grup bazlı izolasyon)
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "otogörüldü ?(.*)",
    fromMe: false,
    desc: "Otomatik okundu bilgisini sadece bu grup için açıp/kapatır.",
    usage: ".otogörüldü aç | .otogörüldü kapat",
    use: "ayarlar",
  }, async (message, match) => {
    const arg = (match[1] || "").trim().toLowerCase();
    if (!global._autoReadGroups) global._autoReadGroups = new Set();

    if (arg === "ac" || arg === "aç") {
      global._autoReadGroups.add(message.jid);
      await message.sendReply("✅ *Otomatik görüldü bilgisi bu sohbet için açıldı.*");
    } else if (arg === "kapat") {
      global._autoReadGroups.delete(message.jid);
      await message.sendReply("❌ *Otomatik görüldü bilgisi bu sohbet için kapatıldı.*");
    } else {
      const status = global._autoReadGroups?.has(message.jid) ? "Açık" : "Kapalı";
      await message.sendReply(`👀 *Otomatik Görüldü Bilgisi:* ${status}\n\n_.otogörüldü aç_ - Açmak için\n_.otogörüldü kapat_ - Kapatmak için`);
    }
  });
})();

// ==========================================
// FILE: siputzx.js
// ==========================================
(function () {
  /**
   * plugins/siputzx.js
   * Siputzx API entegrasyonu - Arama, Stalker, Araçlar, Oyunlar
   * Tüm çıktılar %100 Türkçe
   */
  const { Module } = require("../main");
  const axios = require("axios");

  const SIPUTZX_BASE = "https://api.siputzx.my.id";
  const TIMEOUT = 25000;

  async function siputGet(path, params = {}) {
    try {
      const url = `${SIPUTZX_BASE}${path}`;
      const res = await axios.get(url, { params, timeout: TIMEOUT, validateStatus: () => true });
      if (res.data && res.data.status) return res.data;
      throw new Error(res.data?.error || "API yanıt vermedi");
    } catch (e) {
      if (e.code === "ECONNABORTED") throw new Error("API zaman aşımı. Lütfen tekrar deneyin.");
      throw e;
    }
  }

  async function siputGetBuffer(path, params = {}) {
    const url = `${SIPUTZX_BASE}${path}`;
    const res = await axios.get(url, { params, timeout: TIMEOUT, responseType: "arraybuffer", validateStatus: () => true });
    if (res.status === 200 && res.data) return Buffer.from(res.data);
    throw new Error("Görsel alınamadı");
  }

  // ══════════════════════════════════════════════════════
  // Ekran Görüntüsü (Website Screenshot)
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "ekranfoto ?(.*)",
    fromMe: false,
    desc: "Bir web sitesinin ekran görüntüsünü alır.",
    usage: ".ekranfoto https://google.com",
    use: "araçlar",
  }, async (message, match) => {
    let url = (match[1] || "").trim();
    if (!url) return await message.sendReply("💬 *URL girin:* `.ekranfoto https://google.com`");
    if (!url.startsWith("http")) url = "https://" + url;

    try {
      const buf = await siputGetBuffer("/api/tools/ssweb", { url });
      await message.client.sendMessage(message.jid, {
        image: buf,
        caption: `*Ekran Görüntüsü*\n${url}`
      }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ *Ekran görüntüsü alınamadı!* \n\n*Hata:* ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════
  // SoundCloud Arama
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "soundcloud ?(.*)",
    fromMe: false,
    desc: "SoundCloud'da müzik arar.",
    usage: ".scara lofi beats",
    use: "arama",
  }, async (message, match) => {
    const query = (match[1] || "").trim();
    if (!query) return await message.sendReply("💬 *Arama terimi girin:* `.scara lofi beats`");

    try {
      const data = await siputGet("/api/s/soundcloud", { query });
      const results = data.data || [];
      if (results.length === 0) return await message.sendReply("❌ *Sonuç bulunamadı!*");

      let text = `*SoundCloud Arama* | ${query}\n\n`;
      results.slice(0, 8).forEach((r, i) => {
        text += `*${i + 1}.* ${r.title || r.name || "?"}\n`;
        if (r.user || r.artist) text += `   Sanatçı: ${r.user || r.artist}\n`;
        if (r.url || r.link) text += `   ${r.url || r.link}\n`;
        text += "\n";
      });
      await message.sendReply(text.trim());
    } catch (e) {
      await message.sendReply(`❌ *SoundCloud araması başarısız!* \n\n*Hata:* ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════
  // DuckDuckGo Arama
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "ddg ?(.*)",
    fromMe: false,
    desc: "DuckDuckGo ile web araması yapar.",
    usage: ".ddg yapay zeka nedir",
    use: "arama",
  }, async (message, match) => {
    const query = (match[1] || "").trim();
    if (!query) return await message.sendReply("💬 *Arama terimi girin:* `.ddg yapay zeka nedir`" + (message.reply_message?.text ? `\n\n_Veya mesajı yanıtlayarak arayın._` : ""));

    try {
      const data = await siputGet("/api/s/duckduckgo", { query });
      const results = data.data || [];
      if (results.length === 0) return await message.sendReply("❌ *Sonuç bulunamadı!*");

      let text = `*Web Araması* | ${query}\n\n`;
      results.slice(0, 8).forEach((r, i) => {
        text += `*${i + 1}.* ${r.title || "?"}\n`;
        if (r.description || r.snippet) text += `   ${(r.description || r.snippet).substring(0, 150)}\n`;
        if (r.url || r.link) text += `   ${r.url || r.link}\n`;
        text += "\n";
      });
      await message.sendReply(text.trim());
    } catch (e) {
      await message.sendReply(`❌ *Web araması başarısız!* \n\n*Hata:* ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════
  // Rastgele Kedi Çıkartması
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "(?:kedi|randomkedi)",
    fromMe: false,
    desc: "Rastgele bir kedi görselini çıkartmaya dönüştürür.",
    usage: ".kedi",
    use: "eglence",
  }, async (message) => {
    const { sticker, addExif } = require("./utils");
    const config = require("../config");
    try {
      let buf;
      try {
        buf = await siputGetBuffer("/api/r/cats");
      } catch (_) {
        const res = await axios.get("https://api.thecatapi.com/v1/images/search");
        const url = res.data?.[0]?.url;
        if (!url) throw new Error("Görsel URL bulunamadı");
        const imgRes = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
        buf = Buffer.from(imgRes.data);
      }

      if (!buf || buf.length < 500) throw new Error("Geçersiz görsel verisi");

      const packParts = (config.STICKER_DATA || "Lades-Pro;Lades-Pro").split(";");
      const stickerBuf = await addExif(
        await sticker(buf, false),
        { packname: packParts[0] || "Lades-Pro", author: packParts[1] || "Lades-Pro" }
      );

      await message.client.sendMessage(
        message.jid,
        { sticker: stickerBuf },
        { quoted: message.data }
      );
    } catch (e) {
      await message.sendReply(`❌ *Kedi çıkartması alınamadı!* \n\n*Hata:* ${e.message}`);
    }
  });


  // ══════════════════════════════════════════════════════
  // Çeviri
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "çevir ?(.*)",
    fromMe: false,
    desc: "Metni belirtilen dile çevirir.",
    usage: ".çevir tr Hello World | .çevir en Merhaba Dünya",
    use: "araçlar",
  }, async (message, match) => {
    const input = (match[1] || "").trim();
    if (!input) return await message.sendReply("💬 *Kullanım:* `.çevir tr Hello World`");

    const parts = input.split(" ");
    const targetLang = parts[0];
    const text = parts.slice(1).join(" ") || message.reply_message?.text;
    if (!text) return await message.sendReply("⚠️ *Çevrilecek metin girin.*");

    try {
      const data = await siputGet("/api/tools/translate", { text, to: targetLang });
      const result = data.data?.translatedText || data.data?.text || data.result;
      if (!result) return await message.sendReply("❌ *Çeviri başarısız!*");
      await message.sendReply(`*Çeviri (${targetLang})*\n\n${result}`);
    } catch (e) {
      await message.sendReply(`❌ *Çeviri başarısız!* \n\n*Hata:* ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════
  // Waifu / Anime Görseli
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "waifu",
    fromMe: false,
    desc: "Rastgele anime waifu görseli gönderir.",
    usage: ".waifu",
    use: "eglence",
  }, async (message) => {
    try {
      const buf = await siputGetBuffer("/api/r/waifu");
      await message.client.sendMessage(message.jid, {
        image: buf,
        caption: "*Waifu*"
      }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ *Waifu görseli alınamadı!* \n\n*Hata:* ${e.message}`);
    }
  });

  // ══════════════════════════════════════════════════════
  // Neko Görseli
  // ══════════════════════════════════════════════════════
  Module({
    pattern: "neko",
    fromMe: false,
    desc: "Rastgele anime neko görseli gönderir.",
    usage: ".neko",
    use: "eglence",
  }, async (message) => {
    try {
      const buf = await siputGetBuffer("/api/r/neko");
      await message.client.sendMessage(message.jid, {
        image: buf,
        caption: "*Neko*"
      }, { quoted: message.data });
    } catch (e) {
      await message.sendReply(`❌ *Neko görseli alınamadı!* \n\n*Hata:* ${e.message}`);
    }
  });
})();

