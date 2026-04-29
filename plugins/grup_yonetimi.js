"use strict";

/**
 * Merged Module: group_manager.js
 * Components: group.js, welcome.js, filter.js, sayac.js, group-updates.js, mention.js, message-stats.js
 */

// ==========================================
// FILE: group.js
// ==========================================
(function () {
  const { loadBaileys } = require("../core/yardimcilar");
  let delay, generateWAMessageFromContent, proto, getBinaryNodeChild, getBinaryNodeChildren, downloadMediaMessage, getContentType;

  const baileysPromise = loadBaileys()
    .then((baileys) => {
      ({ delay, generateWAMessageFromContent, proto, getBinaryNodeChild, getBinaryNodeChildren, downloadMediaMessage, getContentType } = baileys);
    })
    .catch((err) => {
      console.error("Baileys yüklenemedi (Eklenti Hatası):", err.message);
      console.log("⚠️ Bot çalışmaya devam edecek ancak grup yönetimi eklentisi stabil olmayabilir.");
    });
  const { isNumeric, mentionjid, censorBadWords, isAdmin } = require("./utils");
  const config = require("../config");
  const { ADMIN_ACCESS, MODE } = config;
  const { Module } = require("../main");
  const fs = require("fs");
  const path = require("path");
  const axios = require("axios");
  const {
    getFullMessage,
    fetchRecentChats,
  } = require("../core/store");
  const { setVar } = require('./yonetim_araclari');
  const { isBotIdentifier } = require("./utils/lid_yardimcisi");
  const handler = config.HANDLER_PREFIX;


  // Ban audio cached at first use — eliminates repeated sync disk I/O on every ban.
  let _banAudioCacheTop = null;
  let _banAudioMissingTop = false;
  async function getBanAudio() {
    if (_banAudioCacheTop) return _banAudioCacheTop;
    if (_banAudioMissingTop) return null;
    const audioPath = path.join(__dirname, "utils", "sounds", "Ban.mp3");
    try {
      _banAudioCacheTop = await fs.promises.readFile(audioPath);
      return _banAudioCacheTop;
    } catch {
      _banAudioMissingTop = true;
      return null;
    }
  }
  async function sendBanAudio(message) {
    try {
      const buf = await getBanAudio();
      if (!buf) return;
      // Send as voice note (PTT) for a more premium experience
      await message.sendMessage(buf, "audio", { ptt: true });
    } catch (err) {
      console.error("Ban sesini gönderirken hata:", err?.message);
    }
  }


  Module({
    pattern: "sohbetsil ?(.*)",
    fromMe: true,
    desc: "Mevcut grup sohbet geçmişini tamamen temizler ve konuşmayı siler.",
    use: "sistem",
    usage: ".sohbetsil",
  },
    async (message, match) => {
      await message.client.chatModify(
        {
          delete: true,
          lastMessages: [
            {
              key: message.data.key,
              messageTimestamp: message.data.messageTimestamp,
            },
          ],
        },
        message.jid
      );
      return await message.send("🧹 *Sohbet temizlendi!*");
    }
  );

  Module({
    pattern: "ban ?(.*)",
    fromMe: false,
    desc: "Gruptan kişi banlar. Yanıt verin ya da komutu yazdıktan sonra kişiyi etiketleyin.",
    use: "grup",
    usage:
      ".ban @etiket veya yanıtla\n.ban herkes (herkesi at)\n.ban 90 (90 ile başlayan numaraları atar)",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      const botId = message.client.user.id.split(":")[0] + "@s.whatsapp.net";
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      const { participants, subject } = await message.client.groupMetadata(
        message.jid
      );
      if (match[1]) {
        if (match[1] === "herkes") {
          let users = participants.filter((member) => !member.admin);
          await message.send(
            `❗ *${subject} grubunun tüm üyeleri atılıyor!* Bu işlemi durdurmak için botu hemen yeniden başlatın.\n\n⏳ *5 saniyeniz var...*`
          );
          await new Promise((r) => setTimeout(r, 5000));
          for (let member of users) {
            await new Promise((r) => setTimeout(r, 1000));
            await message.client.groupParticipantsUpdate(
              message.jid,
              [member.id],
              "remove"
            );
          }
          return;
        }
        if (isNumeric(match[1])) {
          let users = participants.filter(
            (member) => member.id.startsWith(match[1]) && !member.admin
          );
          await message.send(
            `❗ *${match[1]}* numarasıyla başlayan *${users.length}* üye atılıyor! Bu işlemi durdurmak için botu hemen yeniden başlatın.\n\n⏳ *5 saniyeniz var...*`
          );
          await new Promise((r) => setTimeout(r, 5000));
          for (let member of users) {
            await new Promise((r) => setTimeout(r, 1000));
            await message.client.groupParticipantsUpdate(
              message.jid,
              [member.id],
              "remove"
            );
          }
          return;
        }
      }
      let user = message.mention?.[0] || message.reply_message?.jid;
      if (!user) return await message.sendReply("❗ *Bana bir kullanıcı verin!*");

      if (user.includes("@lid")) {
        try {
          const { resolveLidToPn } = require("../core/yardimcilar");
          const pn = await resolveLidToPn(message.client, user);
          if (pn && pn !== user) user = pn;
        } catch (e) { }
      }

      if (isBotIdentifier(user, message.client)) {
        return await message.sendReply("❌ *Üzgünüm, daha kendimi çıkaracak kadar delirmedim!* 😉");
      }
      await message.client.sendMessage(message.jid, {
        text: mentionjid(user) + " *başarıyla çıkarıldı!* ✅",
        mentions: [user],
      });
      await message.client.groupParticipantsUpdate(
        message.jid,
        [user],
        "remove"
      );
    }
  );

  Module({
    pattern: "at ?(.*)",
    fromMe: false,
    desc: "Gruptan kişi banlar. Yanıt verin ya da komutu yazdıktan sonra kişiyi etiketleyin.",
    usage: ".at [@etiket/yanıtla]",
    use: "grup",
  },
    async (message, match) => {
      if (!message.isGroup) {
        return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      }

      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin) {
        return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      }

      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) {
        return await message.sendReply("❌ *Bot'un üyeleri atabilmesi için yönetici olması gerekiyor!*");
      }

      let usersToKick = [];
      if (message.mention && message.mention.length > 0) {
        usersToKick = message.mention;
      } else if (message.reply_message) {
        const replyUser =
          message.reply_message.participant ||
          message.reply_message.sender ||
          message.reply_message.jid;
        if (replyUser) {
          usersToKick = [replyUser];
        }
      }

      if (!usersToKick.length) {
        return await message.sendReply(
          "❌ *Lütfen bir üye etiketleyin veya bir mesaja yanıt verin!*"
        );
      }

      try {
        const { resolveLidToPn } = require("../core/yardimcilar");
        for (let i = 0; i < usersToKick.length; i++) {
          if (usersToKick[i].includes("@lid")) {
            const pn = await resolveLidToPn(message.client, usersToKick[i]);
            if (pn && pn !== usersToKick[i]) usersToKick[i] = pn;
          }
        }
      } catch (e) { }

      let canKickAnyone = false;
      let adminUsers = [];

      for (const user of usersToKick) {
        if (isBotIdentifier(user, message.client)) {
          continue;
        }
        try {
          const isTargetAdmin = message.groupAdmins.includes(user);
          if (isTargetAdmin) {
            adminUsers.push(user);
          } else {
            canKickAnyone = true;
          }
        } catch (error) {
          console.error("Admin kontrolü hatası:", user, error);
          canKickAnyone = true;
        }
      }

      if (!canKickAnyone) {
        if (adminUsers.length > 0) {
          return await message.sendReply(
            `❌ *Belirtilen üye ${adminUsers.length > 1 ? "lar" : ""} yönetici olduğu için atılamaz!*`
          );
        }
        return await message.sendReply("❌ *Üzgünüm, daha kendimi çıkaracak kadar delirmedim!* 😉");
      }

      await sendBanAudio(message);

      for (const user of usersToKick) {
        try {
          if (isBotIdentifier(user, message.client)) {
            await message.sendReply("❌ _Üzgünüm, daha kendimi çıkaracak kadar delirmedim. 😉_");
            continue;
          }
          const isTargetAdmin = message.groupAdmins.includes(user);
          if (isTargetAdmin) {
            await message.sendReply(
              `❌ ${mentionjid(user)} *yönetici olduğu için atılamaz!*`,
              { mentions: [user] }
            );
            continue;
          }

          await message.client.sendMessage(message.jid, {
            text: mentionjid(user) + " *başarıyla çıkarıldı!* ✅",
            mentions: [user],
          });
          await message.client.groupParticipantsUpdate(message.jid, [user], "remove");

          if (usersToKick.length > 1) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        } catch (error) {
          console.error("Üye atılırken hata:", error);
          await message.sendReply(`❌ ${mentionjid(user)} *atılırken bir hata oluştu!*`, {
            mentions: [user],
          });
        }
      }
    }
  );


  /*Module({
      pattern: "ekle ?(.*)",
      fromMe: true,
      desc: "Gruba kişi ekler.",
      warn: "Numaranız banlanabilir, dikkatli kullanın",
      use: "grup",
      usage: ".ekle 90532xxxxxxx",
    },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 _Üzgünüm! Öncelikle yönetici olmalısınız._");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");
      
      var init = match[1] || message.reply_message?.jid.split("@")[0];
      if (!init) return await message.sendReply("❗ *Bana bir kullanıcı verin!*");
      var initt = init.split(" ").join("");
      var user = initt
        .replace(/\+/g, "")
        .replace(" ", "")
        .replace(" ", "")
        .replace(" ", "")
        .replace(" ", "")
        .replace(/\(/g, "")
        .replace(/\)/g, "")
        .replace(/-/g, "");
      await message.client.groupAdd(user, message);
    }
  );
  */

  Module({
    pattern: "yetkiver ?(.*)",
    fromMe: false,
    desc: "Belirtilen kişiyi yönetici yapar.",
    use: "grup",
    usage: ".yetkiver [@etiket/yanıtla]",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      let user = message.mention?.[0] || message.reply_message?.jid;
      if (!user) return await message.sendReply("❗ *Bana bir kullanıcı verin!*");

      if (user.includes("@lid")) {
        try {
          const { resolveLidToPn } = require("../core/yardimcilar");
          const pn = await resolveLidToPn(message.client, user);
          if (pn && pn !== user) user = pn;
        } catch (e) { }
      }

      await message.client.sendMessage(message.jid, {
        text: mentionjid(user) + " ✅ *Yönetici yapıldı!*",
        mentions: [user],
      });
      await message.client.groupParticipantsUpdate(
        message.jid,
        [user],
        "promote"
      );
    }
  );
  Module({
    pattern: "istekler ?(.*)",
    fromMe: false,
    desc: "Gruptaki bekleyen katılım isteklerini listeler ve yönetmenizi sağlar.",
    use: "grup",
    usage: ".istekler (bekleyenleri gör)\n.istekler onayla hepsi (tüm istekleri onayla)\n.istekler reddet hepsi (tüm istekleri reddet)\n.istekler onayla 905xxx (belirli bir numarayı onayla)",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      let approvalList = await message.client.groupRequestParticipantsList(
        message.jid
      );
      if (!approvalList.length)
        return await message.sendReply("📭 _Bekleyen katılma isteği yok._");

      // MIGRATION: LID Çevirisi - Baileys'in döndürdüğü listedeki JID'leri normalize et
      const { resolveLidToPn } = require("../core/yardimcilar");
      for (let i = 0; i < approvalList.length; i++) {
        if (approvalList[i].jid && approvalList[i].jid.includes("@lid")) {
          try {
            const pn = await resolveLidToPn(message.client, approvalList[i].jid);
            if (pn && pn !== approvalList[i].jid) approvalList[i].resolvedJid = pn;
          } catch (e) { }
        } else {
          approvalList[i].resolvedJid = approvalList[i].jid;
        }
      }

      let approvalJids = approvalList.map((x) => x.jid); // Asıl işlem için orijinal LID/JID gerekli

      if (match[1]) {
        const args = (match[1] || "").toLowerCase().trim().split(" ");
        const action = args[0]; // "onayla", "reddet", "hepsini"
        const target = args[1] || ""; // "hepsi", "90532..." vb.

        if (action === "hepsini" && target === "onayla") {
          // Eski kullanıma (hepsini onayla) destek
          await message.sendReply(`✅ *${approvalJids.length} katılımcı onaylandı!*`);
          for (let x of approvalJids) {
            await message.client.groupRequestParticipantsUpdate(message.jid, [x], "approve");
            await delay(900);
          }
          return;
        }
        if (action === "hepsini" && target === "reddet") {
          // Eski kullanıma (hepsini reddet) destek
          await message.sendReply(`❌ *${approvalJids.length} katılımcı reddedildi!*`);
          for (let x of approvalJids) {
            await message.client.groupRequestParticipantsUpdate(message.jid, [x], "reject");
            await delay(900);
          }
          return;
        }

        if (action === "onayla" || action === "reddet") {
          const baileysAction = action === "onayla" ? "approve" : "reject";

          if (target === "hepsi") {
            await message.sendReply(`${action === "onayla" ? "✅" : "❌"} *Toplam ${approvalJids.length} istek ${action === "onayla" ? "onaylandı" : "reddedildi"}!*`);
            for (let x of approvalJids) {
              await message.client.groupRequestParticipantsUpdate(message.jid, [x], baileysAction);
              await delay(900);
            }
            return;
          }

          // Belirli bir numara girildiyse:
          if (target.length > 5) {
            const cleanTarget = target.replace(/[^0-9]/g, "");
            const targetUser = approvalList.find(x => (x.resolvedJid || x.jid).startsWith(cleanTarget));

            if (targetUser) {
              await message.client.groupRequestParticipantsUpdate(message.jid, [targetUser.jid], baileysAction);
              return await message.sendReply(`${action === "onayla" ? "✅" : "❌"} *@${(targetUser.resolvedJid || targetUser.jid).split("@")[0]} isteği ${action === "onayla" ? "onaylandı" : "reddedildi"}!*`, { mentions: [targetUser.resolvedJid || targetUser.jid] });
            } else {
              return await message.sendReply(`❌ *Bekleyen istekler arasında \`${cleanTarget}\` numarası bulunamadı!*`);
            }
          }
        }

        return await message.sendReply(
          `❌ *Geçersiz kullanım!*\n\n` +
          `ℹ️ *Kullanım:* \n` +
          `• \`.istekler onayla hepsi\`\n` +
          `• \`.istekler reddet hepsi\`\n` +
          `• \`.istekler onayla 905xxx\`\n` +
          `• \`.istekler reddet 905xxx\``
        );
      }

      let msg = "📋 *Bekleyen Katılma İstekleri*\n\n💬 _Hızlı işlem için \`.istekler onayla hepsi\` yazabilirsiniz._\n\n";
      const requestType = (type_, requestor) => {
        switch (type_) {
          case "linked_group_join":
            return "topluluk daveti";
          case "invite_link":
            return "davet bağlantısı";
          case "non_admin_add":
            return `+${requestor.split("@")[0]} tarafından eklendi`;
          default:
            return "bilinmiyor";
        }
      };

      let mentions = [];
      for (let x in approvalList) {
        const u = approvalList[x];
        const displayJid = u.resolvedJid || u.jid;
        msg += `*${parseInt(x) + 1}.* 👤 @${displayJid.split("@")[0]}\n` +
          `   🔗 _Yöntem: ${requestType(u.request_method, u.requestor)}_\n` +
          `   🕒 _Tarih: ${new Date(parseInt(u.request_time) * 1000).toLocaleString("tr-TR")}_\n\n`;
        mentions.push(displayJid);
      }

      msg += `ℹ️ _Belirli bir kişiyi onaylamak için:_ \`.istekler onayla numara\``;

      return await message.client.sendMessage(
        message.jid,
        { text: msg, mentions: mentions },
        { quoted: message.data }
      );
    }
  );
  Module({
    pattern: "ayrıl",
    fromMe: true,
    desc: "Gruptan çıkmayı sağlar.",
    usage: ".ayrıl (mevcut gruptan çıkar)",
    use: "grup",
  },
    async (message, match) => {
      if (!message.isGroup)
        return await message.sendReply("ℹ️ _Nereden çıkayım? Bu bir grup komutu!_"
        );
      const jid = message.jid;
      setImmediate(() => message.client.groupLeave(jid));
    }
  );
  Module({
    pattern: "msjgetir",
    fromMe: false,
    desc: "Yanıtlanan mesajın asıl alıntılandığı mesajı bulur ve tekrar gönderir. Silinen mesajları görmek için idealdir.",
    usage: ".msjgetir [yanıtla]",
    use: "grup",
  },
    async (message, match) => {
      try {
        if (!message.reply_message || !message.reply_message.id) {
          return await message.sendReply("💬 *Lütfen alıntılanmış bir mesajı yanıtlayın!*");
        }
        const repliedMessage = await getFullMessage(
          message.reply_message.id + "_"
        );
        if (!repliedMessage.found) {
          return await message.sendReply("❌ *Orijinal mesaj veritabanında bulunamadı!*"
          );
        }
        const messageData = repliedMessage.messageData;
        let quotedMessageId = null;
        let quotedMessage = null;
        let participant = null;
        if (messageData.message) {
          const msgKeys = Object.keys(messageData.message);
          for (const key of msgKeys) {
            const msgContent = messageData.message[key];
            if (msgContent?.contextInfo?.stanzaId) {
              quotedMessageId = msgContent.contextInfo.stanzaId;
              quotedMessage = msgContent.contextInfo.quotedMessage;
              participant = msgContent.contextInfo.participant;
              break;
            }
          }
        }
        if (!quotedMessageId) {
          return await message.sendReply("💬 *Yanıtlanan mesaj, alıntılanmış bir mesaj içermiyor!*"
          );
        }
        const originalQuoted = await getFullMessage(quotedMessageId);
        if (originalQuoted.found) {
          return await message.forwardMessage(
            message.jid,
            originalQuoted.messageData
          );
        } else if (quotedMessage) {
          const reconstructedMsg = {
            key: {
              remoteJid: message.jid,
              fromMe: false,
              id: quotedMessageId,
              participant: participant,
            },
            message: quotedMessage,
          };
          return await message.forwardMessage(message.jid, reconstructedMsg);
        } else {
          return await message.sendReply("❌ *Alıntılanan mesaj bulunamadı ve mevcut önbellek verisi yok!*"
          );
        }
      } catch (error) {
        console.error("Yanıtlanan komutta hata:", error);
        return await message.sendReply("❌ *Alıntılanan mesaj yüklenemedi!*");
      }
    }
  );

  Module({
    pattern: "yetkial ?(.*)",
    fromMe: false,
    desc: "Belirtilen yöneticinin yetkisini düşürür.",
    use: "grup",
    usage: ".yetkial [@etiket/yanıtla]",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      let user = message.mention?.[0] || message.reply_message?.jid;
      if (!user) return await message.sendReply("❗ *Bana bir kullanıcı verin!*");

      if (user.includes("@lid")) {
        try {
          const { resolveLidToPn } = require("../core/yardimcilar");
          const pn = await resolveLidToPn(message.client, user);
          if (pn && pn !== user) user = pn;
        } catch (e) { }
      }

      await message.client.sendMessage(message.jid, {
        text: mentionjid(user) + " ⛔ *Yetkisi düşürüldü!*",
        mentions: [user],
      });
      await message.client.groupParticipantsUpdate(
        message.jid,
        [user],
        "demote"
      );
    }
  );
  Module({
    pattern: "sohbetkapat ?(.*)",
    fromMe: false,
    desc: "Grup sohbetini kapatır. Yalnızca yöneticiler mesaj gönderebilir.",
    use: "grup",
    usage:
      ".sohbetkapat (grubu süresiz olarak sessize alır)\n.sohbetkapat 1s (1 saat sessize alır)\n.sohbetkapat 5d (5 dakika sessize alır)",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      if (match[1]) {
        const h2m = function (h) {
          return 1000 * 60 * 60 * h;
        };
        const m2m = function (m) {
          return 1000 * 60 * m;
        };
        let duration = (match[1].endsWith("h") || match[1].endsWith("s"))
          ? h2m(match[1].match(/\d+/)[0])
          : m2m(match[1].match(/\d+/)[0]);
        let displayMatch = (match[1].endsWith("h") || match[1].endsWith("s"))
          ? match[1].replace(/[hs]/g, " saat")
          : match[1].replace(/[md]/g, " dakika");
        await message.client.groupSettingUpdate(message.jid, "announcement");
        await message.send(`⏳ *${displayMatch} boyunca sessize alındı!*`);
        await require("timers/promises").setTimeout(duration);
        return await message.client.groupSettingUpdate(
          message.jid,
          "not_announcement"
        );
        await message.send("📢 ```Grup sohbeti açıldı!```");
      }
      await message.client.groupSettingUpdate(message.jid, "announcement");
      await message.send("⚠️ *Grup sohbeti kapatıldı!*");
    }
  );
  Module({
    pattern: "sohbetaç",
    fromMe: false,
    desc: "Grup sohbetini açar. Herkes mesaj gönderebilir.",
    use: "grup",
    usage: ".sohbetaç",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      await message.client.groupSettingUpdate(message.jid, "not_announcement");
      await message.send("📢 *Grup sohbeti açıldı!*");
    }
  );
  Module({
    pattern: "jid",
    fromMe: false,
    desc: "Belirtilen kişinin veya sohbetin JID adres bilgisini verir.",
    use: "grup",
    usage: ".jid (mevcut sohbet kimliğini alır)\n.jid (kullanıcı kimliğini almak için yanıtla)",
  },
    async (message) => {
      const isAdminUser = await isAdmin(message);
      if (message.isGroup) {
        if (message.fromOwner || isAdminUser) {
          const jid = message.reply_message?.jid || message.jid;
          await message.sendReply(jid);
        } else {
          await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
        }
      } else if (message.isChannel) {
        // Kanal bağlamı: kanal JID'ini doğrudan döndür (Admin gönderdiği için yetki kontrolü atlanır)
        await message.sendReply(message.jid);
      } else {
        if (MODE !== "public" && !message.fromOwner) return;
        await message.sendReply(message.jid);
      }
    }
  );
  Module({
    pattern: 'davet',
    fromMe: true,
    use: 'grup',
    desc: "Grubun davet linkini getirir.",
    usage: ".davet"
  },
    (async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*")
      const userIsAdmin = await isAdmin(message, message.sender);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      const code = await message.client.groupInviteCode(message.jid)
      await message.client.sendMessage(message.jid, {
        text: "🔗 *Grubun Davet Bağlantısı:*\n\nhttps://chat.whatsapp.com/" + code, detectLinks: true
      }, { detectLinks: true })
    }))

  Module({
    pattern: "davetyenile",
    fromMe: false,
    use: "grup",
    desc: "Grubun davet linkini sıfırlar.",
    usage: ".davetyenile",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      await message.client.groupRevokeInvite(message.jid);
      await message.send("♻️ *Grup davet linki başarıyla sıfırlandı!*");
    }
  );
  Module({
    pattern: "gayaryt ?(.*)",
    fromMe: false,
    use: "grup",
    desc: "Grup ayarlarını kilitler (sadece yöneticiler değiştirebilir)!",
    usage: ".gayaryt (grup ayarlarını kilitler)",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      return await message.client.groupSettingUpdate(message.jid, "locked");
    }
  );
  Module({
    pattern: "gayarherkes ?(.*)",
    fromMe: false,
    use: "grup",
    desc: "Grup ayarlarının kilidini açar (herkes değiştirebilir)!",
    usage: ".gayarherkes (grup ayarlarının kilidini açar)",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      return await message.client.groupSettingUpdate(message.jid, "unlocked");
    }
  );
  Module({
    pattern: "gadı ?(.*)",
    fromMe: false,
    use: "grup",
    desc: "Grup ismini (başlığını) belirlediğiniz yeni isimle değiştirir.",
    usage: ".gadı [yeni_isim]",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      const newName = (match[1] || message.reply_message?.text || "").trim();
      if (!newName) return await message.sendReply("💬 *Yeni grup adını girin!*");

      try {
        const oldName = (await message.client.groupMetadata(message.jid)).subject || "Bilinmeyen Grup";
        const finalName = newName.slice(0, 25);

        await message.client.groupUpdateSubject(message.jid, finalName);

        return await message.sendReply(
          `✏️ *_Grup adını güncelledim!_* ✅\n\n*⬅ Şöyleydi:* ${censorBadWords(oldName)}\n*🆕 Şöyle oldu:* ${censorBadWords(finalName)}`
        );
      } catch (error) {
        console.error("Grup adı değiştirme hatası:", error);
        return await message.sendReply("❌ *Grup adı değiştirilemedi!*");
      }
    }
  );
  Module({
    pattern: "gaçıklama ?(.*)",
    fromMe: false,
    use: "grup",
    desc: "Grup açıklamasını belirlediğiniz yeni metinle günceller.",
    usage: ".gaçıklama [yeni_açıklama]",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 _Üzgünüm! Öncelikle yönetici olmalısınız._");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      const newDesc = match[1] || message.reply_message?.text;
      if (!newDesc) return await message.sendReply("💬 *Yeni grup açıklamasını girin!*");
      try {
        const meta = await message.client.groupMetadata(message.jid);
        const oldDesc = meta.desc || "Açıklama yok";
        const finalDesc = newDesc.slice(0, 512);

        await message.client.groupUpdateDescription(message.jid, finalDesc);
        return await message.sendReply(
          `💬 *_Grup açıklamasını güncelledim!_* ✅\n\n*⬅ Şöyleydi:* ${censorBadWords(oldDesc)}\n*🆕 Şöyle oldu:* ${censorBadWords(finalDesc)}`
        );
      } catch {
        return await message.sendReply("❌ *Grup açıklaması değiştirilemedi!*");
      }
    }
  );
  Module({
    pattern: "common ?(.*)",
    fromMe: false,
    use: "grup",
    desc: "Verdiğiniz iki farklı gruptaki ortak olan üyeleri listeler veya gruptan çıkarmanızı sağlar.",
    usage: ".common [jid1,jid2] | .common çıkar [jid]",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!*");

      if (!match[1])
        return await message.sendReply(`⚠️ *Jid'ler gerekli!*\n\n💬 _Kullanım:_ *${handler}common jid1,jid2*\n💡 _Veya:_ *${handler}common kick grup_jid*`
        );
      if (match[1].includes("çıkar")) {
        const co = match[1].split(" ")[1];
        const g1 = await message.client.groupMetadata(co);
        const g2 = await message.client.groupMetadata(message.jid);
        const common = g1.participants.filter(({ id: id1 }) =>
          g2.participants.some(({ id: id2 }) => id2 === id1)
        );
        const jids = [];
        let msg = `❗ *${g1.subject}* & *${g2.subject}* grubundaki ortak üyeler atılıyor!\n\nℹ️ _Sayı:_ *${common.length}*\n`;
        common
          .map((e) => e.id)
          .filter((e) => !isBotIdentifier(e, message.client))
          .map(async (s) => {
            msg += "```@" + s.split("@")[0] + "```\n";
            jids.push(s);
          });
        await message.client.sendMessage(message.jid, {
          text: msg,
          mentions: jids,
        });
        for (let user of jids) {
          await new Promise((r) => setTimeout(r, 1000));
          if (isBotIdentifier(user, message.client)) {
            await message.sendReply("❌ _Üzgünüm, daha kendimi çıkaracak kadar delirmedim. 😉_");
            continue;
          }
          await message.client.groupParticipantsUpdate(
            message.jid,
            [user],
            "remove"
          );
        }
        return;
      }
      const co = match[1].split(",");
      const g1 = await message.client.groupMetadata(co[0]);
      const g2 = await message.client.groupMetadata(co[1]);
      const common = g1.participants.filter(({ id: id1 }) =>
        g2.participants.some(({ id: id2 }) => id2 === id1)
      );
      let msg = `📋 *${g1.subject}* & *${g2.subject}* ortak katılımcıları:\n\nℹ️ _Sayı:_ *${common.length}*\n`;
      const jids = [];
      common.map(async (s) => {
        msg += "```@" + s.id.split("@")[0] + "```\n";
        jids.push(s.id);
      });
      await message.client.sendMessage(message.jid, {
        text: msg,
        mentions: jids,
      });
    }
  );
  Module({
    pattern: "diff ?(.*)",
    fromMe: false,
    use: "grup",
    desc: "Verdiğiniz iki gruptaki birbirinden farklı (benzersiz) üyeleri listeler.",
    usage: ".diff [jid1,jid2]",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");

      if (!match[1])
        return await message.sendReply(`⚠️ *Jid'ler gerekli!*\n\n💬 _Kullanım:_ *${handler}diff jid1,jid2*`);
      const co = match[1].split(",");
      const g1 = (await message.client.groupMetadata(co[0])).participants;
      const g2 = (await message.client.groupMetadata(co[1])).participants;
      const common = g1.filter(
        ({ id: jid1 }) => !g2.some(({ id: jid2 }) => jid2 === jid1)
      );
      let msg =
        "📋 *Farklı katılımcılar*\n\nℹ️ _Sayı:_ *" + common.length + "*\n";
      common.map(async (s) => {
        msg += "```" + s.id.split("@")[0] + "``` \n";
      });
      return await message.sendReply(msg);
    }
  );
  Module({
    pattern: "tag ?(.*)",
    fromMe: false,
    desc: "Gruptaki herkesi etiketler. Mesaja gömülü etiket atmak için mesajı yanıtlayın ya da kelime girin.",
    use: "grup",
    usage:
      ".tag metin\n.tag (mesaja yanıtla)\n.tagherkes (herkesi etiketle)\n.tagyt (sadece yöneticileri etiketle)\n.tag 120363355307899193@g.us (belirli grupta etiketle)",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return;

      const input = (match[1] || "").toLowerCase().trim();
      const isTagAdmin = input === "yt" || input === "admin";
      const isTagAll = input === "herkes" || input === "";
      const isReply = !!message.reply_message;

      // Sadece .tag yazıldıysa veya metin yoksa bilgilendirme (Emoji ile sade)
      if (!isReply && !input) {
        return await message.sendReply(`📢 *Grup Etiketleme Modülü* 📢\n\n💡 *Örnek Kullanım:* \`.tag Merhaba!\`\n\n🚀 *Hızlı Komutlar:*
• \`.tag herkes\` 👥
• \`.tag yt\` (veya \`admin\`) 🛡
• \`.tag <metin>\` 📝`);
      }

      const meta = await message.client.groupMetadata(message.jid);
      const { participants } = meta;
      const targets = [];

      for (const p of participants) {
        if (isTagAdmin && !p.admin) continue;
        targets.push(p.id);
      }

      // Batch gönderimi: 50 üye/mesaj, aralarında 400ms bekleme.
      // Büyük gruplarda tek seferde 200+ mention göndermek WhatsApp
      // rate-limit'ine çarpar ve komutu yavaşlatır veya askıya alır.
      const BATCH_SIZE = 50;
      const BATCH_DELAY_MS = 400;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      const chunks = [];
      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        chunks.push(targets.slice(i, i + BATCH_SIZE));
      }

      if (isReply) {
        // Yanıtlanan mesajı ilk batch ile ilet, sonraki batch'ları mention olarak gönder
        await message.forwardMessage(message.jid, message.quoted, {
          contextInfo: {
            mentionedJid: targets,
            isForwarded: true,
            forwardingScore: 999
          }
        });
      } else if (input && !isTagAdmin && !isTagAll) {
        // Özel metin — tek mesaj, tüm mention'lar
        await message.client.sendMessage(message.jid, {
          text: match[1],
          mentions: targets,
          contextInfo: { isForwarded: true, forwardingScore: 999 }
        });
      } else {
        // Batch'lar halinde etiketle
        for (let i = 0; i < chunks.length; i++) {
          const batch = chunks[i];
          const batchText = batch.map(id => `• @${id.split("@")[0]}`).join("\n");
          const header = chunks.length > 1
            ? `📢 *Etiketlendi (${i + 1}/${chunks.length})* 📢\n\n`
            : `📢 *Sırayla Etiketlendi!* 📢\n\n`;
          await message.client.sendMessage(message.jid, {
            text: header + batchText,
            mentions: batch,
            contextInfo: { isForwarded: true, forwardingScore: 999 }
          });
          if (i < chunks.length - 1) await sleep(BATCH_DELAY_MS);
        }
      }
    }
  );
  Module({
    pattern: "engelle ?(.*)",
    fromMe: true,
    use: "sistem",
    desc: "Belirtilen kullanıcıyı bot üzerinden engeller.",
    usage: ".engelle [@etiket/yanıtla]",
  },
    async (message, match) => {
      const isGroup = message.jid.endsWith("@g.us");
      let user = message.jid;
      if (isGroup) user = message.mention?.[0] || message.reply_message?.jid;
      if (!user) return await message.sendReply("❗ *Üye etiketleyin veya mesajına yanıt verin!*");
      await message.client.updateBlockStatus(user, "block");
    }
  );
  const getJoinErrorMessage = (error) => {
    const msg = (error?.message || "").toLowerCase();

    if (msg.includes("401") || msg.includes("not-authorized"))
      return "⛔ Bağlantı geçersiz veya gruptan atılmış olabilirim!";

    if (msg.includes("403") || msg.includes("forbidden"))
      return "🔒 Gruba katılım kısıtlanmış! (Sadece yöneticiler ekleyebilir)";

    if (msg.includes("404") || msg.includes("item-not-found"))
      return "🔍 Grup bulunamadı veya bağlantı hatalı!";

    if (msg.includes("406") || msg.includes("not-acceptable"))
      return "⛔ Gruptan yeni atıldım/çıkarıldım veya grup dolu! Bir süre bekleyip tekrar deneyin.";

    if (msg.includes("408") || msg.includes("conflict"))
      return "✋ Zaten bu grubun üyesiyim!";

    if (msg.includes("500"))
      return "🔧 WhatsApp sunucu hatası! Lütfen daha sonra tekrar deneyin.";

    if (msg.includes("rate") || msg.includes("429"))
      return "⏳ Rate limit - çok hızlı işlem yaptınız! Biraz yavaşlayın.";

    return `❓ ${error?.message || "Bilinmeyen hata!"}`;
  };

  Module({
    pattern: "katıl ?(.*)",
    fromMe: false,
    use: "sistem",
    desc: "Verdiğiniz grup davet bağlantısını kullanarak bir gruba katılmamı sağlar.",
    usage: ".katıl [link]",
  },
    async (message, match) => {
      const linkRegex = /(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)/;
      const input = match[1] || message.reply_message?.text || "";
      const matchResult = input.match(linkRegex);

      if (!matchResult) return await message.sendReply("⚠️ *Grup bağlantısı gerekli!* (Bağlantıya da yanıtlayabilirsiniz)");

      const inviteCode = matchResult[1];
      try {
        await message.client.groupAcceptInvite(inviteCode);
        return await message.sendReply("✅ *Gruba başarıyla katıldım!*");
      } catch (error) {
        return await message.sendReply(`❌ *Hata:* ${getJoinErrorMessage(error)}`);
      }
    }
  );
  Module({
    pattern: "engelkaldır ?(.*)",
    fromMe: true,
    use: "sistem",
    desc: "Daha önce engellenmiş kullanıcının engelini kaldırır.",
    usage: ".engelkaldır [@etiket/yanıtla]",
  },
    async (message) => {
      const isGroup = message.jid.endsWith("@g.us");
      if (!isGroup) return;
      const user = message.mention?.[0] || message.reply_message?.jid;
      if (!user) return await message.sendReply("❗ *Üye etiketleyin veya mesajına yanıt verin!*");
      await message.client.updateBlockStatus(user, "unblock");
    }
  );
  // ESKİ visitedLinks.json sistemi yerine artık veritabanı logları kullanılıyor.

  Module({
    pattern: "toplukatıl(?:\\s+([\\s\\S]*))?",
    fromMe: false,
    use: "sistem",
    desc: "Birden fazla grup bağlantısını toplu olarak işleyerek gruplara sırayla katılmamı sağlar.",
    usage: ".toplukatıl [link1, link2...]",
  },
    async (message, match) => {
      const rgx = /(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)(?:\?[^\s,]*)*/g;
      const input = match[1] || message.reply_message?.text || "";

      if (!input.trim()) {
        return await message.sendReply(
          `❌ *Lütfen grup bağlantısı girin veya bağlantı içeren bir mesajı yanıtlayın!*\n\n` +
          `*Kullanımı:*\n` +
          `› .toplukatıl bağlantı1 bağlantı2\n` +
          `› .toplukatıl (bağlantıya yanıtlayarak)`
        );
      }

      let rawInput = input
        .replace(/,\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      let links = rawInput.match(rgx);
      if (!links || links.length === 0) {
        return await message.sendReply("❌ *Geçerli WhatsApp grup bağlantısı bulunamadı!*");
      }
      links = [...new Set(links)];
      const DELAY_MIN = 12000;
      const DELAY_MAX = 58000;
      const BATCH_SIZE = 9;
      const REST_TIME = 2700000;
      const randomDelay = () => {
        const delay = Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN;
        return new Promise((resolve) => setTimeout(resolve, delay));
      };
      const getErrorMessage = getJoinErrorMessage;

      const { GrupKatilimLog } = require("../core/database");
      let successCount = 0;
      let failCount = 0;
      let skipCount = 0;
      let memorySkipCount = 0;
      let results = [];
      const filteredLinks = [];

      for (let link of links) {
        const codeMatch = link.match(
          /(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)/
        );
        if (!codeMatch || !codeMatch[1]) continue;
        const code = codeMatch[1];

        try {
          const logEntry = await GrupKatilimLog.findOne({ where: { inviteCode: code } });
          if (logEntry) {
            memorySkipCount++;
            continue;
          }
        } catch (e) { } // DB hatası olursa yine de listeye al

        filteredLinks.push({ link, code });
      }
      const totalBatches = Math.ceil(filteredLinks.length / BATCH_SIZE);
      let startMsg =
        `🔄 *İşlem Başlatıldı*\n\n` +
        `📋 Toplam bağlantı: *${links.length}*\n`;
      if (memorySkipCount > 0) {
        startMsg += `🧠 Veritabanından atlanan: *${memorySkipCount}*\n`;
      }
      startMsg +=
        `🔗 İşlenecek bağlantı: *${filteredLinks.length}*\n` +
        `📦 Toplam part: *${totalBatches}*\n` +
        `⏸ Her *${BATCH_SIZE}* grup sonrası *${REST_TIME / 1000} saniye* dinlenilecek\n\n` +
        `_Spam koruması için her işlem arasında bekleniyor..._`;

      await message.sendReply(startMsg);
      for (let i = 0; i < filteredLinks.length; i++) {
        const { link, code } = filteredLinks[i];
        let groupName = null;

        try {
          const inviteInfo = await message.client.groupGetInviteInfo(code);
          groupName = inviteInfo.subject || "Bilinmeyen Grup";
        } catch (e) {
          // İptal edilmiş link veya fetch hatası
        }

        try {
          await message.client.groupAcceptInvite(code);

          await GrupKatilimLog.create({
            inviteCode: code,
            groupName: groupName,
            status: "success"
          }).catch(() => { });

          successCount++;
          results.push(`✅ [${i + 1}] başarıyla girildi${groupName ? ` (${groupName})` : ''}`);
        } catch (error) {
          if (error?.message?.includes("408")) {
            await GrupKatilimLog.create({
              inviteCode: code,
              groupName: groupName,
              status: "success",
              reason: "Zaten üyesiniz"
            }).catch(() => { });

            skipCount++;
            results.push(`♻ [${i + 1}] zaten üyesiniz${groupName ? ` (${groupName})` : ''}`);
          } else {
            const reason = getErrorMessage(error);
            await GrupKatilimLog.create({
              inviteCode: code,
              groupName: groupName,
              status: "failed",
              reason: reason
            }).catch(() => { });

            failCount++;
            results.push(`❌ [${i + 1}] ${reason}${groupName ? ` (${groupName})` : ''}`);
          }
        }
        const isLastLink = i === filteredLinks.length - 1;
        const isBatchEnd = (i + 1) % BATCH_SIZE === 0;
        if (!isLastLink) {
          if (isBatchEnd) {
            const currentBatch = Math.ceil((i + 1) / BATCH_SIZE);
            const nextBatch = currentBatch + 1;
            const nextBatchStart = i + 1;
            const nextBatchEnd = Math.min(nextBatchStart + BATCH_SIZE, filteredLinks.length);
            const nextBatchCount = nextBatchEnd - nextBatchStart;
            await message.sendReply(
              `⏸ *${currentBatch}. part tamamlandı.*\n\n` +
              `✅ Başarılı: *${successCount}*\n` +
              `❌ Başarısız: *${failCount}*\n` +
              `♻ Zaten Üye Olunan: *${skipCount}*\n` +
              `🧠 Hafızadan Atlanan: *${memorySkipCount}*\n\n` +
              `📦 Sonraki part: *${nextBatch}. part* (*${nextBatchCount} bağlantı* işlenecek)\n\n` +
              `⏳ _${REST_TIME / 1000} saniye dinleniliyor, ardından devam edilecek..._`
            );
            await new Promise((resolve) => setTimeout(resolve, REST_TIME));
          } else {
            await randomDelay();
          }
        }
      }
      let report =
        `╔═══════════════════╗\n` +
        `║   📊 İŞLEM RAPORU    ║\n` +
        `╚═══════════════════╝\n\n` +
        `✅ Başarılı: *${successCount}*\n` +
        `❌ Başarısız: *${failCount}*\n` +
        `♻ Zaten Üye Olunan: *${skipCount}*\n` +
        `🧠 Hafızadan Atlanan: *${memorySkipCount}*\n` +
        `📋 Toplam: *${links.length}*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `*📝 Detaylar:*\n` +
        results.join("\n");
      await message.sendReply(report);
    }
  );

  Module({
    pattern: "tümjid ?(.*)",
    fromMe: true,
    desc: "Dahil olduğum tüm grupların veya son sohbetlerin JID adreslerini listeler.",
    use: "araçlar",
    usage: ".tümjid hepsi | .tümjid son",
  },
    async (message, match) => {
      const args = match[1]?.trim().split(" ") || [];
      const command = args[0]?.toLowerCase();
      if (!command || (command !== "hepsi" && command !== "son")) {
        return await message.sendReply("*Kullanım:*\n" +
          "• `.tümjid hepsi` - Tüm grup JID'lerini göster\n" +
          "• `.tümjid son` - Son sohbet JID'lerini göster (varsayılan 10)\n" +
          "• `.tümjid son 15` - Son 15 sohbet JID'sini göster"
        );
      }
      if (command === "hepsi") {
        const allGroups = await message.client.groupFetchAllParticipating();
        const gruplar = Object.keys(allGroups);
        const recentChats = await fetchRecentChats(100);
        const dmChats = recentChats.filter((chat) => chat.type === "private");
        const totalChats = gruplar.length + dmChats.length;
        if (!totalChats) return await message.sendReply("❌ *Sohbet bulunamadı!*");
        const chunkSize = 100;
        let totalMessages = Math.ceil(totalChats / chunkSize);
        let chatIndex = 0;
        for (let msgIndex = 0; msgIndex < totalMessages; msgIndex++) {
          const startIdx = msgIndex * chunkSize;
          const endIdx = Math.min(startIdx + chunkSize, totalChats);
          let _msg = `*Tüm Sohbet JID'leri*\n`;
          if (totalMessages > 1) {
            _msg += `Bölüm ${msgIndex + 1}/${totalMessages}: Sohbetler ${startIdx + 1
              }-${endIdx} / ${totalChats}\n\n`;
          }
          while (
            chatIndex < gruplar.length &&
            chatIndex - msgIndex * chunkSize < chunkSize
          ) {
            const jid = gruplar[chatIndex - msgIndex * chunkSize];
            if (!jid) break;
            const count = chatIndex + 1;
            const groupData = allGroups[jid];
            const groupName = groupData ? groupData.subject : "Bilinmeyen Grup";
            _msg += `_*${count}. 👥 Grup:*_ \`${groupName}\`\n_JID:_ \`${jid}\`\n\n`;
            chatIndex++;
            if (chatIndex >= startIdx + chunkSize) break;
          }
          const dmStartIndex = Math.max(0, startIdx - gruplar.length);
          const dmEndIndex = Math.min(dmChats.length, endIdx - gruplar.length);
          for (let i = dmStartIndex; i < dmEndIndex && chatIndex < endIdx; i++) {
            const dm = dmChats[i];
            const count = chatIndex + 1;
            const dmName = dm.name || "Bilinmiyor";
            _msg += `_*${count}. 💬 Özel:*_ \`${dmName}\`\n_JID:_ \`${dm.jid}\`\n\n`;
            chatIndex++;
          }
          await message.sendReply(_msg);
          if (msgIndex < totalMessages - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      } else if (command === "son") {
        const limit = parseInt(args[1]) || 10;
        if (limit > 50) {
          return await message.sendReply("✨ *Maksimum sınır 50 sohbettir!*");
        }
        const recentChats = await fetchRecentChats(limit);
        if (!recentChats.length) {
          return await message.sendReply("❌ *Son sohbet bulunamadı!*");
        }
        let allGroups = {};
        try {
          allGroups = await message.client.groupFetchAllParticipating();
        } catch (error) {
          console.error("Grup verisi alınırken hata:", error);
        }
        let _msg = `*Son Sohbet JID'leri*\n_${recentChats.length} en son sohbet gösteriliyor_\n\n`;
        for (let i = 0; i < recentChats.length; i++) {
          const chat = recentChats[i];
          const count = i + 1;
          const chatType = chat.type === "group" ? "👥 Grup" : "💬 Özel";
          let chatName = chat.name || "Bilinmiyor";
          if (chat.type === "group" && allGroups[chat.jid]) {
            chatName =
              allGroups[chat.jid].subject || chat.name || "Bilinmeyen Grup";
          }
          const lastMessageTime = new Date(chat.lastMessageTime).toLocaleString("tr-TR");
          _msg += `_*${count}. ${chatType}:*_ \`${chatName}\`\n`;
          _msg += `_JID:_ \`${chat.jid}\`\n`;
          _msg += `_Son Mesaj:_ ${lastMessageTime}\n\n`;
        }
        const chunkSize = 4000;
        if (_msg.length > chunkSize) {
          const chunks = [];
          let currentChunk = `*Son Sohbet JID'leri*\n_${recentChats.length} en son sohbet gösteriliyor_\n\n`;
          for (let i = 0; i < recentChats.length; i++) {
            const chat = recentChats[i];
            const count = i + 1;
            const chatType = chat.type === "group" ? "👥 Grup" : "💬 Özel";
            let chatName = chat.name || "Bilinmiyor";
            if (chat.type === "group" && allGroups[chat.jid]) {
              chatName =
                allGroups[chat.jid].subject || chat.name || "Bilinmeyen Grup";
            }
            const lastMessageTime = new Date(
              chat.lastMessageTime
            ).toLocaleString("tr-TR");
            const chatInfo = `_*${count}. ${chatType}:*_ \`${chatName}\`\n_JID:_ \`${chat.jid}\`\n_Son Mesaj:_ ${lastMessageTime}\n\n`;
            if (currentChunk.length + chatInfo.length > chunkSize) {
              chunks.push(currentChunk);
              currentChunk = chatInfo;
            } else {
              currentChunk += chatInfo;
            }
          }
          if (currentChunk.trim()) {
            chunks.push(currentChunk);
          }
          for (let i = 0; i < chunks.length; i++) {
            await message.sendReply(chunks[i]);
            if (i < chunks.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
        } else {
          await message.sendReply(_msg);
        }
      }
    }
  );
  const channelCache = require("../core/channel-cache");
  const PIN_DURATIONS = {
    "24s": 86400,
    "7g": 604800,
    "30g": 2592000,
  };

  const loadKaraListe = () => {
    try {
      const raw = config.DUYURU_KARA_LISTE || "";
      return raw ? raw.split(",").map((j) => j.trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  };
  const saveKaraListe = async (liste) => {
    await setVar("DUYURU_KARA_LISTE", liste.join(","));
  };

  const formatDuration = (totalSeconds) => {
    const dk = Math.floor(totalSeconds / 60);
    const sn = Math.round(totalSeconds % 60);
    if (dk === 0) return `${sn} saniye`;
    if (sn === 0) return `${dk} dakika`;
    return `${dk} dakika ${sn} saniye`;
  };

  const estimateTime = (groupCount, hasPin) => {
    const batchSize = hasPin ? 5 : 10;
    const perGroupAvg = hasPin ? 4500 : 2500;
    const pinExtraAvg = hasPin ? 2000 : 0;
    const batchDelayAvg = hasPin ? 16000 : 10000;
    const batchCount = Math.floor(groupCount / batchSize);
    const totalMs = groupCount * (perGroupAvg + pinExtraAvg) + batchCount * batchDelayAvg;
    return Math.ceil(totalMs / 1000);
  };

  /**
   * Newsletter (kanal) mesajını gruba "taze" göndermek için hazırlar.
   * Forward metadata'sı OLMAYAN bir mesaj objesi döner — bu sayede WhatsApp'ın
   * "kanal-forward → spam" filtresi tetiklenmez.
   *
   * Medyalar bot tarafından indirilip yeniden yüklenir; metin doğrudan kopyalanır.
   *
   * @param {object} channelMsg  Önbellekten gelen WAMessage (cachedMsg)
   * @param {object} client      Baileys sock — medya indirme için gerekir
   * @returns {Promise<object|null>}  sendMessage'a verilebilen content objesi
   */
  const prepareChannelMessageForFreshSend = async (channelMsg, client) => {
    if (!channelMsg || !channelMsg.message) return null;

    // Sarmalayıcıları aç: ephemeral / viewOnce / documentWithCaption / edited
    const unwrap = (msg) => {
      if (!msg) return msg;
      if (msg.ephemeralMessage?.message) return unwrap(msg.ephemeralMessage.message);
      if (msg.viewOnceMessage?.message) return unwrap(msg.viewOnceMessage.message);
      if (msg.viewOnceMessageV2?.message) return unwrap(msg.viewOnceMessageV2.message);
      if (msg.viewOnceMessageV2Extension?.message) return unwrap(msg.viewOnceMessageV2Extension.message);
      if (msg.documentWithCaptionMessage?.message) return unwrap(msg.documentWithCaptionMessage.message);
      if (msg.editedMessage?.message) return unwrap(msg.editedMessage.message);
      if (msg.protocolMessage?.editedMessage) return unwrap(msg.protocolMessage.editedMessage);
      return msg;
    };
    const m = unwrap(channelMsg.message);
    if (!m) return null;

    // 1) Düz metin — caption/prefix YOK; "Kanaldan iletildi" görselini contextInfo verir
    if (m.conversation) return { text: m.conversation };
    if (m.extendedTextMessage?.text) return { text: m.extendedTextMessage.text };

    // 2) Medya — indir + yeniden yükle (spam filtresini bypass eder)
    const mediaTypes = [
      { key: "imageMessage", type: "image", out: "image", keepCaption: true },
      { key: "videoMessage", type: "video", out: "video", keepCaption: true },
      { key: "audioMessage", type: "audio", out: "audio", keepCaption: false },
      { key: "documentMessage", type: "document", out: "document", keepCaption: true },
      { key: "stickerMessage", type: "sticker", out: "sticker", keepCaption: false },
    ];

    // Newsletter (kanal) medyası ŞİFRESİZ yüklenir → mediaKey YOK.
    // Bu durumda doğrudan HTTPS GET ile url/directPath üzerinden indiririz.
    // url süresi dolmuş olabileceği için directPath ile ikinci bir deneme yaparız.
    const fetchRawUrl = async (downloadUrl) => {
      const resp = await axios.get(downloadUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: { Origin: "https://web.whatsapp.com" },
      });
      const buf = Buffer.from(resp.data);
      if (!buf.length) throw new Error("Boş yanıt");
      return buf;
    };

    const downloadNewsletterRawMedia = async (mediaObj) => {
      const candidates = [];
      if (mediaObj?.url && mediaObj.url.startsWith("https://")) {
        candidates.push(mediaObj.url);
      }
      if (mediaObj?.directPath) {
        candidates.push(`https://mmg.whatsapp.net${mediaObj.directPath}`);
      }
      if (!candidates.length) throw new Error("url/directPath yok");

      let lastErr;
      for (const u of candidates) {
        try {
          return await fetchRawUrl(u);
        } catch (e) {
          lastErr = e;
          console.warn(`[Duyuru/Kanal] Ham indirme başarısız (${u.slice(0, 60)}...): ${e?.message}`);
        }
      }
      throw lastErr || new Error("Tüm ham indirme denemeleri başarısız");
    };

    for (const mt of mediaTypes) {
      if (!m[mt.key]) continue;
      try {
        const mediaObj = m[mt.key];
        const hasMediaKey = mediaObj.mediaKey && mediaObj.mediaKey.length > 0;
        let buffer;

        if (hasMediaKey) {
          // Standart şifreli indirme (normal sohbet/grup mesajları)
          buffer = await downloadMediaMessage(
            { message: m, key: channelMsg.key },
            "buffer",
            {},
            { reuploadRequest: client?.updateMediaMessage }
          );
        } else {
          // Kanal/newsletter medyası — ham (şifresiz) indir
          console.log(`[Duyuru/Kanal] ${mt.key} ham (şifresiz) indiriliyor (newsletter medyası)...`);
          buffer = await downloadNewsletterRawMedia(mediaObj);
        }

        if (!buffer || !buffer.length) throw new Error("Boş medya buffer");

        const out = { [mt.out]: buffer };
        if (mt.keepCaption) {
          const orig = m[mt.key].caption || "";
          if (orig) out.caption = orig;
        }
        // Medya tipi ekstra alanları
        if (mt.key === "documentMessage") {
          out.mimetype = m.documentMessage.mimetype || "application/octet-stream";
          out.fileName = m.documentMessage.fileName || "dosya";
        } else if (mt.key === "audioMessage") {
          out.mimetype = m.audioMessage.mimetype || "audio/ogg; codecs=opus";
          out.ptt = !!m.audioMessage.ptt;
        } else if (mt.key === "videoMessage") {
          if (m.videoMessage.gifPlayback) out.gifPlayback = true;
        }
        return out;
      } catch (e) {
        console.warn(`[Duyuru/Kanal] ${mt.key} indirilemedi, metne düş:`, e?.message);
        // Caption varsa metin olarak gönder
        const caption = m[mt.key]?.caption;
        if (caption) return { text: caption };
        return null;
      }
    }

    // 3) Bilinmeyen tip — metin alanı varsa onu kullan
    const fallbackText = m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      m.documentMessage?.caption;
    if (fallbackText) return { text: fallbackText };
    return null;
  };

  Module({
    pattern: "duyuru ?(.*)",
    fromMe: true,
    desc: "Bulunduğum tüm gruplara duyuru iletir ve isteğe bağlı olarak sabitler.",
    use: "sistem",
    usage:
      ".duyuru <mesaj>\n" +
      ".duyuru <mesaj> - sabitle:24s\n" +
      ".duyuru karaliste ekle <jid>\n" +
      ".duyuru karaliste çıkar <jid>\n" +
      ".duyuru karaliste liste\n" +
      ".duyuru karaliste bu",
  },
    async (message, match) => {
      const adminAccess = message.isAdmin;
      if (!message.fromOwner && !adminAccess) {
        return await message.sendReply("❌ *Bu komutu sadece yetkili kullanıcılar çalıştırabilir!*");
      }

      const input = match[1]?.trim() || "";
      const arg = input.toLowerCase();

      if (arg.startsWith("grup") || arg.startsWith("karaliste")) {
        const parts = input.split(" ");
        const cmdOffset = parts[0]?.toLowerCase() === "karaliste" ? 0 : 1;
        const cmd = parts[cmdOffset + 1]?.toLowerCase();
        const jid = parts[cmdOffset + 2]?.trim();
        const liste = loadKaraListe();
        if (cmd === "filtrele" && jid) {
          if (liste.includes(jid)) return message.sendReply("⚠️ *Bu grup zaten kara listede.*");
          liste.push(jid);
          await saveKaraListe(liste);
          return message.sendReply(`✅ *${jid} filtreleme listesine eklendi!*`);
        }
        if (cmd === "sil" && jid) {
          const yeni = liste.filter((gJid) => gJid !== jid);
          await saveKaraListe(yeni);
          return message.sendReply(`✅ *${jid} filtreleme listesinden çıkarıldı!*`);
        }
        if (cmd === "liste") {
          if (!liste.length) return message.sendReply("📭 _Kara liste boş._");
          return message.sendReply(
            `*📋 Duyuru Kara Listesi (${liste.length} grup):*\n` +
            liste.map((gJid, i) => `${i + 1}. \`${gJid}\``).join("\n")
          );
        }
        if (cmd === "bu") {
          return message.sendReply(`ℹ️ _Mevcut grup JID'i:_ *${message.jid}*`);
        }
        return message.sendReply(
          `🔻 *Grup filtresi kullanımı:*\n` +
          `• \`.duyuru grup filtrele <jid>\`\n` +
          `• \`.duyuru grup sil <jid>\`\n` +
          `• \`.duyuru grup liste\`\n` +
          `• \`.duyuru grup bu\` - bulunduğun grubun JID'ini göster`
        );
      }

      let announceText = input;
      let pinDuration = null;
      let isKanalForward = false;
      let reconstructedMsg = null;

      if (arg.startsWith("kanal")) {
        const channelJid = config.CHANNEL_JID;

        if (!channelJid || !channelJid.includes("@newsletter")) {
          return await message.sendReply(
            "❌ *Geçersiz CHANNEL_JID!*\n\n" +
            "ℹ️ _Kanal JID'i `@newsletter` ile bitmeli._\n" +
            "💡 `.setvar CHANNEL_JID=120363xxxx@newsletter` ile ayarlayın."
          );
        }

        // ── YÖNTEM 1: Önbellekten oku (timeout riski yok) ───────────────────
        // Bellekte yoksa DB'den lazy-load eder → Republish/restart sonrası
        // bot eski kanal mesajını hatırlar.
        const cachedMsg = await channelCache.loadLastMsgAsync(channelJid);

        if (cachedMsg) {
          const msgTs = typeof cachedMsg.messageTimestamp === "object"
            ? (cachedMsg.messageTimestamp?.low ?? Number(cachedMsg.messageTimestamp))
            : Number(cachedMsg.messageTimestamp || 0);
          const nowTs = Math.floor(Date.now() / 1000);
          if (msgTs > 0 && nowTs - msgTs > 86400) {
            return await message.sendReply(
              "⚠️ *Önbellekteki kanal mesajı 24 saatten eski.*\n\n" +
              "📢 _Kanalda yeni bir paylaşım yapıldıktan sonra tekrar deneyin._"
            );
          }
          reconstructedMsg = {
            key: cachedMsg.key || { remoteJid: channelJid, id: String(Date.now()), fromMe: false },
            message: cachedMsg.message,
            messageTimestamp: msgTs || Math.floor(Date.now() / 1000),
          };
          isKanalForward = true;
        } else {
          // ── YÖNTEM 2: Canlı sorgu — önce abone ol, sonra kısa timeout ile çek ─
          try {
            // Önce abone ol (daha güvenilir yanıt alınır)
            await message.client.subscribeNewsletterUpdates(channelJid).catch(() => { });

            // 20 saniye timeout ile IQ sorgusu (varsayılan 60s'den çok daha kısa)
            const msgs = await Promise.race([
              message.client.newsletterFetchMessages(channelJid, 5),
              new Promise((_, rej) =>
                setTimeout(() => rej(new Error("Timed Out (20s)")), 20000)
              ),
            ]);

            if (!msgs || msgs.length === 0) {
              return await message.sendReply(
                "❌ *Kanaldan mesaj çekilemedi.*\n\n" +
                "📢 _Kanalda henüz mesaj yok veya kanal boş._\n" +
                `💡 _CHANNEL_JID:_ \`${channelJid}\``
              );
            }

            const lastMsg = msgs[msgs.length - 1];
            const msgTs = typeof lastMsg.messageTimestamp === "object"
              ? (lastMsg.messageTimestamp?.low ?? Number(lastMsg.messageTimestamp))
              : Number(lastMsg.messageTimestamp || 0);
            const nowTs = Math.floor(Date.now() / 1000);

            if (msgTs > 0 && nowTs - msgTs > 86400) {
              return await message.sendReply(
                "⚠️ *Kanaldaki son mesaj 24 saatten eski — WhatsApp iletmeye izin vermiyor.*\n\n" +
                "📢 _Kanalda yeni bir paylaşım yapıldıktan sonra tekrar deneyin._"
              );
            }

            reconstructedMsg = {
              key: lastMsg.key || { remoteJid: channelJid, id: String(Date.now()), fromMe: false },
              message: lastMsg.message,
              messageTimestamp: msgTs || Math.floor(Date.now() / 1000),
            };

            // Bir sonraki kullanım için önbelleğe kaydet
            channelCache.setLastMsg(channelJid, lastMsg);
            isKanalForward = true;

          } catch (err) {
            console.error("[Duyuru] Kanal mesajı çekilirken hata:", err?.message || err);
            const isTimeout = (err?.message || "").toLowerCase().includes("timed out") ||
              (err?.message || "").toLowerCase().includes("timeout");
            if (isTimeout) {
              return await message.sendReply(
                "⏱️ *WhatsApp kanal sorgusu zaman aşımına uğradı.*\n\n" +
                "📢 _Bot henüz bu kanaldan canlı mesaj almadı._\n" +
                "💡 _Kanalda yeni bir paylaşım yapıldığında mesaj otomatik önbelleğe alınır ve komut anında çalışır._\n\n" +
                `📌 _CHANNEL_JID:_ \`${channelJid}\``
              );
            }
            const detail = err?.message || String(err);
            return await message.sendReply(
              `❌ *Kanal mesajı çekilirken hata oluştu!*\n\n` +
              `🔍 _Hata:_ \`${detail.slice(0, 200)}\`\n\n` +
              `💡 _CHANNEL_JID değeri:_ \`${channelJid}\``
            );
          }
        }
      } else {
        const pipeIndex = input.lastIndexOf("-");
        if (pipeIndex !== -1) {
          const after = input.slice(pipeIndex + 1).trim().toLowerCase();
          const pinMatch = after.match(/^sabitle:(24s|7g|30g)$/);
          if (pinMatch) {
            pinDuration = PIN_DURATIONS[pinMatch[1]];
            announceText = input.slice(0, pipeIndex).trim();
          }
        }
      }

      const hasReply = !!message.reply_message;
      const hasText = announceText.length > 0;
      if (!isKanalForward && !hasText && !hasReply) {
        return message.sendReply(
          `📢 _Bot'un bulunduğu tüm gruplara duyuru iletir._\n\n` +
          `*Kullanım:*\n` +
          `• \`.duyuru <mesaj>\` - sadece gönder\n` +
          `• \`.duyuru kanal\` - Bot kanalından son mesajı gruplara ilet\n` +
          `• \`.duyuru <mesaj> - sabitle:24s\` - gönder ve 24 saat sabitle\n` +
          `• \`.duyuru <mesaj> - sabitle:7g\` - gönder ve 7 gün sabitle\n` +
          `• \`.duyuru <mesaj> - sabitle:30g\` - gönder ve 30 gün sabitle\n` +
          `• Bir mesaja yanıtla + \`.duyuru\` - o mesajı ilet\n\n` +
          `*Liste Düzenleme:*\n` +
          `• \`.duyuru grup filtrele <jid>\`\n` +
          `• \`.duyuru grup sil <jid>\`\n` +
          `• \`.duyuru grup liste\`\n` +
          `• \`.duyuru grup bu\``
        );
      }

      let allGroups;
      try {
        allGroups = await message.client.groupFetchAllParticipating();
      } catch (err) {
        console.error("[Duyuru] groupFetchAllParticipating hatası:", err);
        return message.sendReply("❌ *Grup listesi alınamadı!*");
      }

      const karaListe = loadKaraListe();
      const groupJids = Object.keys(allGroups).filter((jid) => !karaListe.includes(jid));
      if (!groupJids.length) {
        return message.sendReply("📭 _Hiç grup bulunamadı (veya tamamı liste dışına alınmış)._");
      }

      const pinLabel = pinDuration
        ? `, ${pinDuration === 86400 ? "24 saat" : pinDuration === 604800 ? "7 gün" : "30 gün"} süreyle sabitlenecek`
        : "";
      const eta = estimateTime(groupJids.length, !!pinDuration);
      const confirmMsg = await message.sendReply(
        `📢 *Duyuru ${groupJids.length} gruba gönderiliyor...*\n\n⏳ _Tahmini süre:_ *${formatDuration(eta)}*${pinLabel}` +
        (karaListe.length ? `\n_(${karaListe.length} grup atlandı)_` : "")
      );

      let sent = 0;
      let pinned = 0;
      let failed = 0;

      const BATCH_SIZE = pinDuration ? 5 : 10;
      const BATCH_DELAY_MIN = pinDuration ? 12000 : 8000;
      const BATCH_DELAY_EXTRA = pinDuration ? 8000 : 4000;
      const PER_GROUP_DELAY_MIN = pinDuration ? 3000 : 1500;
      const PER_GROUP_DELAY_EXTRA = pinDuration ? 3000 : 2000;
      const PIN_RETRY_COUNT = 2;
      const PIN_RETRY_DELAY = 5000;

      // ── KANAL İÇERİĞİNİ BİR KEZ HAZIRLA (medyayı 107x indirmeyelim) ──────
      // Forward yerine taze mesaj olarak gönderir → WhatsApp spam filtresini bypass eder
      let preparedKanalContent = null;
      let kanalAttribution = null; // forwardedNewsletterMessageInfo — yeşil kanal banner'ı
      if (isKanalForward) {
        try {
          preparedKanalContent = await prepareChannelMessageForFreshSend(
            reconstructedMsg,
            message.client
          );
          if (!preparedKanalContent) {
            return await message.sendReply(
              "❌ *Kanal mesajı işlenemedi.*\n\n" +
              "📢 _Mesaj içeriği boş veya desteklenmeyen bir tipte._"
            );
          }

          // Native "Kanal X'ten iletildi" + "Kanalı Görüntüle" görseli için attribution
          const kanalJid = config.CHANNEL_JID || reconstructedMsg.key?.remoteJid;
          const kanalAdi = (config.CHANNEL_NAME || "Kanal").trim();
          const rawId = reconstructedMsg.key?.id;
          const serverId = Number.parseInt(rawId, 10);
          if (kanalJid && Number.isFinite(serverId)) {
            kanalAttribution = {
              newsletterJid: kanalJid,
              serverMessageId: serverId,
              newsletterName: kanalAdi,
              contentType: 1, // UPDATE
            };
          } else {
            console.warn(
              `[Duyuru/Kanal] Attribution kurulamadı (jid=${kanalJid}, rawId=${rawId}) — banner'sız gönderilecek`
            );
          }
        } catch (prepErr) {
          console.error("[Duyuru/Kanal] Hazırlama hatası:", prepErr?.message);
          return await message.sendReply(
            `❌ *Kanal mesajı hazırlanırken hata!*\n\n🔍 \`${(prepErr?.message || "").slice(0, 200)}\``
          );
        }
      }

      for (const jid of groupJids) {
        try {
          let sentMsg;
          if (isKanalForward) {
            // Taze medya + forwardedNewsletterMessageInfo kombinasyonu:
            //   • Medya her grup için yeniden upload → her grupta farklı mediaKey → spam (420) yok
            //   • forwardedNewsletterMessageInfo + isForwarded → görselde yeşil kanal adı
            //     ("Lades-Pro | Bot kanalından iletildi") + "Kanalı Görüntüle" butonu çıkar
            // Shallow clone — Baileys'in objeyi değiştirme ihtimaline karşı garantici.
            const ctxInfo = {
              ...(preparedKanalContent.contextInfo || {}),
              isForwarded: true,
              forwardingScore: 999,
            };
            if (kanalAttribution) {
              ctxInfo.forwardedNewsletterMessageInfo = kanalAttribution;
            }
            sentMsg = await message.client.sendMessage(jid, {
              ...preparedKanalContent,
              contextInfo: ctxInfo,
            });
          } else if (hasReply) {
            sentMsg = await message.client.sendMessage(jid, {
              forward: message.quoted,
            });
            if (hasText) {
              await message.client.sendMessage(jid, { text: announceText, contextInfo: { isForwarded: true, forwardingScore: 999 } });
            }
          } else {
            sentMsg = await message.client.sendMessage(jid, {
              text: announceText,
              contextInfo: { isForwarded: true, forwardingScore: 999 }
            });
          }
          sent++;

          if (pinDuration && sentMsg?.key) {
            await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));

            let pinSuccess = false;
            for (let attempt = 1; attempt <= PIN_RETRY_COUNT; attempt++) {
              try {
                await message.client.sendMessage(jid, {
                  pin: sentMsg.key,
                  type: 1,
                  time: pinDuration,
                });
                pinned++;
                pinSuccess = true;
                break;
              } catch (pinErr) {
                const errMsg = pinErr?.message || "";
                console.warn(
                  `[Duyuru] Sabitleme denemesi ${attempt}/${PIN_RETRY_COUNT} başarısız ${jid}:`,
                  errMsg
                );

                if (
                  errMsg.includes("rate-overlimit") ||
                  errMsg.includes("429") ||
                  pinErr?.data === 429
                ) {
                  if (attempt < PIN_RETRY_COUNT) {
                    const backoffDelay = PIN_RETRY_DELAY * attempt + Math.random() * 3000;
                    console.log(
                      `[Duyuru] Rate limit, ${Math.round(backoffDelay / 1000)}s bekleniyor...`
                    );
                    await new Promise((r) => setTimeout(r, backoffDelay));
                  }
                } else {
                  break;
                }
              }
            }
          }

          if (sent % BATCH_SIZE === 0) {
            await new Promise((r) =>
              setTimeout(r, BATCH_DELAY_MIN + Math.random() * BATCH_DELAY_EXTRA)
            );
          }

          const delayMs = PER_GROUP_DELAY_MIN + Math.floor(Math.random() * PER_GROUP_DELAY_EXTRA);
          await new Promise((r) => setTimeout(r, delayMs));
        } catch (err) {
          console.error(`[Duyuru] ${jid} için başarısız:`, err?.message || err);
          failed++;

          const errMsg = err?.message || "";
          if (
            errMsg.includes("rate-overlimit") ||
            errMsg.includes("429") ||
            err?.data === 429
          ) {
            console.log("[Duyuru] Genel rate limit, 15s bekleniyor...");
            await new Promise((r) => setTimeout(r, 15000 + Math.random() * 5000));
          }
        }
      }

      let summary =
        `*📢 Duyuru tamamlandı!*\n\n` +
        `✅ _Gönderildi:_ *${sent}/${groupJids.length}*\n`;
      if (karaListe.length)
        summary += `🚫 _Atlandı (kara liste):_ *${karaListe.length}*\n`;
      if (pinDuration) summary += `📌 _Sabitlendi:_ *${pinned}/${sent}*\n`;
      if (failed > 0) summary += `❌ _Başarısız:_ *${failed}*\n`;
      await message.edit(summary, message.jid, confirmMsg.key);
    }
  );

  Module({
    pattern: "sabitle ?(.*)",
    fromMe: false,
    desc: "Mesajı sabitler veya sabitlenmiş mesajı kaldırır. `sil` argümanıyla sabitleme kaldırma moduna geçer.",
    use: "grup",
    usage:
      ".sabitle 24s | .sabitle 7g | .sabitle 30g | .sabitle (varsayılan 7 gün)\n" +
      ".sabitle sil (yanıtla → tek mesajı kaldır) | .sabitle sil (tüm sabitleri kaldır)",
  },
    async (message, match) => {
      if (!message.isGroup) {
        return await message.sendReply("❌ *Bu komut sadece gruplarda kullanılabilir!*");
      }

      await baileysPromise;
      if (!generateWAMessageFromContent || !proto) {
        return await message.sendReply(
          "❌ *Bot bileşenleri henüz yüklenmedi, lütfen biraz bekleyip tekrar deneyin.*"
        );
      }

      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) {
        return await message.sendReply("❌ *Bu grupta yönetici değilim!*");
      }

      const input = match[1] ? match[1].trim().toLowerCase() : "";

      // ── SABITLE SİL MODU ──────────────────────────────────────────
      if (input === "sil") {
        const userIsAdmin = await isAdmin(message, message.sender);
        if (!userIsAdmin && !message.fromOwner) {
          return await message.sendReply("_❌ Bu işlemi sadece yöneticiler yapabilir._");
        }

        try {
          // Mod 1: Yanıtlanan mesajın sabitini kaldır
          if (message.reply_message) {
            const quotedKey = {
              remoteJid: message.jid,
              fromMe:
                message.reply_message.jid?.split("@")[0] ===
                message.client.user?.id?.split(":")[0],
              id: message.reply_message.id,
              participant: message.reply_message.jid,
            };
            await message.client.sendMessage(message.jid, {
              pin: quotedKey,
              type: 2,
              time: 0,
            });
            return await message.sendReply("📌 *Mesajın sabitlemesi başarıyla kaldırıldı!*");
          }

          // Mod 2: Yanıt yok - gruptaki tüm sabitleri temizle
          const groupMeta = await message.client.groupMetadata(message.jid);
          const pinnedMsgs = groupMeta?.pinnedMessages || [];

          if (!pinnedMsgs || pinnedMsgs.length === 0) {
            return await message.sendReply(
              "⚠️ *Bu grupta sabitlenmiş mesaj bulunamadı.*\n\n" +
              "💬 _Belirli bir mesajın sabitlemesini kaldırmak için o mesaja yanıt vererek_ *.sabitle sil* _yazın._"
            );
          }

          let removed = 0;
          let failed = 0;

          for (const pinned of pinnedMsgs) {
            try {
              const pinKey = pinned.key || pinned;
              await message.client.sendMessage(message.jid, {
                pin: {
                  remoteJid: message.jid,
                  fromMe: pinKey.fromMe || false,
                  id: pinKey.id || pinned.id,
                  participant: pinKey.participant || pinned.participant || null,
                },
                type: 2,
                time: 0,
              });
              removed++;
              await new Promise(r => setTimeout(r, 800)); // Rate-limit koruması
            } catch (e) {
              console.error("Sabitle sil (tek mesaj) hatası:", e?.message || e);
              failed++;
            }
          }

          if (removed > 0 && failed === 0) {
            return await message.sendReply(
              `✅ *Gruptaki ${removed} sabitlenmiş mesaj başarıyla kaldırıldı!*`
            );
          } else if (removed > 0) {
            return await message.sendReply(
              `_⚠ *${removed}* mesaj kaldırıldı, *${failed}* mesajda hata oluştu._`
            );
          } else {
            return await message.sendReply("❌ *Sabitlenmiş mesajlar kaldırılırken hata oluştu!*");
          }
        } catch (error) {
          console.error("Sabitle sil komutu hatası:", error);
          return await message.sendReply(
            "❌ *İşlem sırasında bir hata oluştu! Lütfen tekrar deneyin.*"
          );
        }
      }

      // ── SABİTLE MODU (normal) ──────────────────────────────────────
      if (!message.reply_message) {
        return await message.sendReply(
          "_❌ Lütfen sabitlemek istediğiniz mesaja yanıtlayarak yazın!_\n\n" +
          "🔻 _Kullanım:_\n" +
          "_.sabitle 24s_ → 24 saat\n" +
          "_.sabitle 7g_ → 7 gün\n" +
          "_.sabitle 30g_ → 30 gün\n" +
          "_.sabitle_ → varsayılan 7 gün\n" +
          "_.sabitle sil_ → sabitlenmiş mesajı kaldırır"
        );
      }

      let durationSeconds;
      let durationText;

      if (input === "24s" || input === "24saat" || input === "1g" || input === "1gün") {
        durationSeconds = 86400;
        durationText = "24 saat";
      } else if (input === "30g" || input === "30gün" || input === "30gun") {
        durationSeconds = 2592000;
        durationText = "30 gün";
      } else {
        durationSeconds = 604800;
        durationText = "7 gün";
      }

      try {
        const quotedKey = {
          remoteJid: message.jid,
          fromMe:
            message.reply_message.jid?.split("@")[0] ===
            message.client.user?.id?.split(":")[0],
          id: message.reply_message.id,
          participant: message.reply_message.jid,
        };
        await message.client.sendMessage(message.jid, {
          pin: quotedKey,
          type: 1,
          time: durationSeconds,
        });
        return await message.sendReply(`📌 *Mesaj, başarıyla ${durationText} süreyle sabitlendi!*`);
      } catch (error) {
        console.error("Sabitle komutu hatası:", error);
        return await message.sendReply("❌ *Mesaj sabitleme sırasında bir hata oluştu!*");
      }
    }
  );

  Module({
    pattern: "pp ?(.*)",
    fromMe: true,
    use: "sistem",
    desc: "Profil resmimi değiştirir veya belirtilen kullanıcının profil resmini alır.",
    usage: ".pp [görsel/yanıtla]",
  },
    async (message, match) => {
      if (message.reply_message && message.reply_message.image) {
        const image = await message.reply_message.download();
        const botJid = message.client.user?.id?.split(":")[0] + "@s.whatsapp.net";
        await message.client.setProfilePicture(botJid, {
          url: image,
        });
        return await message.sendReply("⚙️ *Profil resmi güncellendi!* ✅");
      }
      if (message.reply_message && !message.reply_message.image) {
        try {
          const image = await message.client.profilePictureUrl(
            message.reply_message?.jid,
            "image"
          );
          return await message.sendReply({ url: image }, "image");
        } catch {
          return await message.sendReply("_❌ Profil resmi bulunamadı!_");
        }
      }
    }
  );
  Module({
    pattern: "gfoto ?(.*)",
    fromMe: false,
    use: "sistem",
    desc: "Grubun profil fotoğrafını değiştirir veya mevcut fotoğrafı tam boyut olarak gönderir.",
    usage: ".gfoto [görsel/yanıtla]",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 _Üzgünüm! Öncelikle yönetici olmalısınız._");
      const botId = message.client.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = await isAdmin(message, botId);
      if (!botIsAdmin) return await message.sendReply("❌ *Bu işlemi yapabilmesi için botun yönetici olması gerekiyor!*");

      if (message.reply_message && message.reply_message.image) {
        const image = await message.reply_message.download();
        await message.client.setProfilePicture(message.jid, { url: image });
        return await message.sendReply("⚙️ *Grup fotoğrafı güncellendi!* ✅");
      }
      if (!message.reply_message.image) {
        try {
          const image = await message.client.profilePictureUrl(
            message.jid,
            "image"
          );
          return await message.sendReply({ url: image }, "image");
        } catch {
          return await message.sendReply("_❌ Profil resmi bulunamadı!_");
        }
      }
    }
  );


  function parseSarrafiye(html) {
    const results = {};
    const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>([\d.,]+)<\/td>\s*<td[^>]*>([\d.,]+)<\/td>\s*<td[^>]*>(.*?)<\/td>/gi;
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
      const name = match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      results[name] = {
        buy: match[2],
        sell: match[3],
        change: match[4].replace("%", "").trim(),
      };
    }
    return results;
  }

  Module({
    pattern: "altın ?(.*)",
    fromMe: false,
    desc: "Anlık Altın fiyatlarını ve piyasa değişim verilerini listeler.",
    usage: ".altın",
    use: "araçlar",
  },
    async (message) => {
      const loading = await message.send("🔄 _Altın fiyatlarına bakıyorum..._");

      try {
        const { data: html } = await axios.get("https://www.sarrafiye.net/piyasa/altin.html", {
          timeout: 15000,
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
        });
        const data = parseSarrafiye(html);
        const kur = data["Kur"];
        const gram = data["Gram Altın"];
        const ceyrek = data["Çeyrek Altın"];
        const yarim = data["Yarım Altın"];
        const tam = data["Tam Ata Lira"] || data["Tam Altın"];

        if (!kur && !gram && !ceyrek && !yarim && !tam) {
          return await message.edit(
            "⚠ _Altın verilerine ulaşılamadı!_\n_Kaynak yapısı değişmiş olabilir._",
            message.jid,
            loading.key
          );
        }

        let text = "💰 `GÜNCEL ALTIN FİYATLARI`\n\n";
        function addBlock(title, emoji, item, currency = "₺") {
          if (!item) return;
          const symbol = item.change.startsWith("-") ? "📉" : "📈";
          text += `${emoji} *${title}*\n`;
          text += `   💵 Alış: *${item.buy} ${currency}*\n`;
          text += `   💰 Satış: *${item.sell} ${currency}*\n`;
          text += `   ${symbol} Değişim: %${item.change}\n\n`;
        }

        addBlock("Kur", "📊", kur);
        addBlock("Gram Altın", "🟡", gram);
        addBlock("Çeyrek Altın", "🪙", ceyrek);
        addBlock("Yarım Altın", "💎", yarim);
        addBlock("Tam Altın", "🏅", tam);

        const now = new Date().toLocaleString("tr-TR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        text += `_📅 ${now}_`;
        text += "\nℹ Kaynak: _Kuyumcu Altın Verileri_";

        await message.edit(text.trim(), message.jid, loading.key);
      } catch (err) {
        console.error("Altın modülü hata:", err?.message || err);
        await message.edit(
          "⚠ _Altın verileri alınırken hata oluştu._\n_Lütfen daha sonra tekrar deneyin._",
          message.jid,
          loading.key
        );
      }
    }
  );


  Module({
    pattern: 'etiket ?(.*)',
    fromMe: false,
    desc: "Gruptaki tüm üyeleri etiketleyerek duyuru yapmanızı sağlar.",
    usage: ".etiket [mesaj]",
    use: 'grup',
  },
    async (message, match) => {
      const userIsAdmin = await isAdmin(message, message.sender);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 _Üzgünüm! Öncelikle yönetici olmalısınız._");
      if (!message.isGroup) return await message.sendReply("❗ *Bu komut yalnızca grup sohbetlerinde çalışır!*");
      const target = message.jid;
      const group = await message.client.groupMetadata(target);
      const allMembers = group.participants.map(participant => participant.id);

      let baseText = match && match[1] ? match[1].trim() : (message.reply_message?.text ? message.reply_message.text : "");
      let text = baseText ? baseText + "\n\n" : "✅ *Herkes başarıyla etiketlendi!*\n\n";

      allMembers.forEach((jid, index) => {
        text += `${index + 1}. @${jid.split('@')[0]}\n`;
      });

      // Baileys 'quoted' sorununu by-pass etmek için manuel gönderim veya sendOpts boş gönderimi:
      const sendOpts = message.isChannel ? {} : ((message.data?.key?.id || '').includes('DASHBOARD_') ? {} : { quoted: message.data });

      await message.client.sendMessage(target, {
        text: text,
        contextInfo: { mentionedJid: allMembers, isForwarded: true, forwardingScore: 999 }
      }, sendOpts);
    });

  Module({
    pattern: 'ytetiket',
    fromMe: false,
    desc: "Grup yöneticilerini etiketler.",
    usage: ".ytetiket",
    use: 'grup',
  },
    async (message, match) => {
      const target = message.jid;
      const group = await message.client.groupMetadata(target);
      const admins = group.participants.filter(v => v.admin !== null).map(x => x.id);
      let text = "🚨 *Yöneticiler:*";
      admins.forEach(jid => {
        text += `
@${jid.split('@')[0]}`;
      });
      await message.client.sendMessage(target, { text: text, contextInfo: { mentionedJid: admins, isForwarded: true, forwardingScore: 999 } });
    });
})();

// ==========================================
// FILE: welcome.js
// ==========================================
(function () {
  const { Module } = require("../main");
  const config = require("../config");
  const { welcome, goodbye, censorBadWords, isAdmin } = require("./utils");
  const {
    parseWelcomeMessage,
    sendWelcomeMessage,
  } = require('./utils/karsilama_ayristirici');

  Module({
    pattern: "karşıla ?(.*)",
    fromMe: true,
    onlyAdmin: true,
    desc: "Yeni üye katıldığında gönderilecek olan grup karşılama mesajını özelleştirmenizi ve yönetmenizi sağlar.",
    usage: ".karşıla Merhaba $mention, $group grubuna hoş geldin! $pp\n.karşıla aç/kapat\n.karşıla getir\n.karşıla sil", use: "grup",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("_⚠ Bu komut sadece gruplarda kullanılabilir!_");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");

      const input = match[1]?.toLowerCase();
      if (!input) {
        const current = await welcome.get(message.jid);
        const status = current?.enabled ? "Açık ✅" : "Kapalı ❌";
        return await message.sendReply(`👋🏻 *Karşılama Mesajı Ayarları*
ℹ *Mevcut Durum:* ${status}

💬 *Kullanım:*
• \`.karşıla <mesaj>\` - Karşılama mesajını ayarla
• \`.karşıla aç/kapat\` - Karşılamayı aç/kapat
• \`.karşıla getir\` - Mevcut mesajı görüntüle
• \`.karşıla sil\` - Karşılama mesajını sil
• \`.karşıla durum\` - Tüm grupların durumunu göster (sadece sahip)
• \`.karşıla yardım\` - Örneklerle ayrıntılı yardımı göster

*Yer Tutucular:*
• \`$mention\` - Kullanıcıyı etiketle
• \`$user\` - Kullanıcı adı
• \`$group\` - Grup adı
• \`$desc\` - Grup açıklaması
• \`$count\` - Üye sayısı
• \`$pp\` - Kullanıcı profil resmi
• \`$gpp\` - Grup profil resmi
• \`$date\` - Bugünün tarihi
• \`$time\` - Şu anki saat

*Örnek:*
\`.karşıla Merhaba $mention! $group grubuna hoş geldin 🎉 $pp\`
\`.karşıla Hoş geldin $user! Harika grubumuzda artık $count üyeyiz! $gpp\``);
      }

      if (input === "aç") {
        const current = await welcome.get(message.jid);
        if (!current) {
          return await message.sendReply("⚙️ *Karşılama mesajı ayarlanmamış!*\n\n💬 _Önce şunu kullanarak bir tane ayarlayın:_ *.karşıla <mesajınız>*");
        }
        await welcome.toggle(message.jid, true);
        return await message.sendReply("✅ *Karşılama mesajları etkinleştirildi!* ✅");
      }

      if (input === "kapat") {
        await welcome.toggle(message.jid, false);
        return await message.sendReply("❌ *Karşılama mesajları devre dışı!*");
      }

      if (input === "getir") {
        const current = await welcome.get(message.jid);
        if (!current) return await message.sendReply("⚙️ *Bu grup için karşılama mesajı ayarlanmamış!*");
        return await message.sendReply(`*Mevcut Karşılama Mesajı:*\n\n${current.message}\n\n*Durum:* ${current.enabled ? "Açık ✅" : "Kapalı ❌"}`);
      }

      if (input === "sil") {
        const deleted = await welcome.delete(message.jid);
        if (deleted) {
          return await message.sendReply("✅ *Karşılama mesajı başarıyla silindi!* 🗑️");
        }
        return await message.sendReply("❌ *Silinecek karşılama mesajı bulunamadı!*");
      }

      if (input === "durum" && message.fromOwner) {
        const welcomeData = await welcome.get();
        let statusText = "*🎉 KARŞILAMA DURUMU 🎉*\n\n";
        for (let data of welcomeData) {
          statusText += `• *${data.jid}*: ${data.enabled ? "✅" : "❌"}\n`;
        }
        return await message.sendReply(statusText);
      }

      const welcomeMessage = censorBadWords(match[1]);
      if (welcomeMessage.length > 2000) {
        return await message.sendReply("⚠️ *Karşılama mesajı çok uzun! Lütfen 2000 karakterin altında tutun.*");
      }

      await welcome.set(message.jid, welcomeMessage);
      await message.sendReply("✅ *Karşılama mesajı ayarlandı!*\n\n💡 _İpucu:_ *.karşılatest* _kullanın!_");
    }
  );

  Module({
    pattern: "elveda ?(.*)",
    fromMe: true,
    onlyAdmin: true,
    desc: "Üye ayrıldığında gönderilecek olan grup veda mesajını özelleştirmenizi ve yönetmenizi sağlar.",
    usage: ".elveda [mesaj] | .elveda aç/kapat",
    use: "grup",
  },
    async (message, match) => {
      if (!message.isGroup) return await message.sendReply("_⚠ Bu komut sadece gruplarda kullanılabilir!_");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");

      const input = match[1]?.toLowerCase();
      if (!input) {
        const current = await goodbye.get(message.jid);
        const status = current?.enabled ? "Açık ✅" : "Kapalı ❌";
        return await message.sendReply(`🥺 *Veda Mesajı Ayarları*\nℹ *Mevcut Durum:* ${status}\n\n*Kullanım:* .elveda <mesaj>, .elveda aç/kapat, .elveda sil`);
      }

      if (input === "aç") {
        const current = await goodbye.get(message.jid);
        if (!current) return await message.sendReply("⚙️ *Veda mesajı ayarlanmamış!*");
        await goodbye.toggle(message.jid, true);
        return await message.sendReply("✅ *Veda mesajları açıldı!*");
      }

      if (input === "kapat") {
        await goodbye.toggle(message.jid, false);
        return await message.sendReply("❌ *Veda mesajları kapatıldı!*");
      }

      if (input === "getir") {
        const current = await goodbye.get(message.jid);
        if (!current) return await message.sendReply("⚙️ *Veda mesajı ayarlanmamış!*");
        return await message.sendReply(`*Mevcut Veda Mesajı:*\n\n${current.message}`);
      }

      if (input === "sil") {
        await goodbye.delete(message.jid);
        return await message.sendReply("✅ *Veda mesajı silindi!* 🗑️");
      }

      const goodbyeMessage = censorBadWords(match[1]);
      await goodbye.set(message.jid, goodbyeMessage);
      await message.sendReply("✅ *Veda mesajı ayarlandı!*");
    }
  );

  Module({
    pattern: "karşılatest ?(.*)",
    fromMe: true,
    onlyAdmin: true,
    desc: "Mevcut gruptaki karşılama mesajının nasıl göründüğünü denemeniz için bir test mesajı gönderir.",
    usage: ".karşılatest",
    use: "grup",
  },
    async (message) => {
      if (!message.isGroup) return await message.sendReply("⚠️ *Bu komut sadece gruplarda kullanılabilir!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");

      const welcomeData = await welcome.get(message.jid);
      if (!welcomeData || !welcomeData.enabled) return await message.sendReply("❌ *Karşılama mesajı kapalı veya ayarlanmamış!*");
      const parsed = await parseWelcomeMessage(welcomeData.message, message, [message.sender]);
      if (parsed) {
        await message.sendReply("*💬 Karşılama Test Ediliyor:*");
        await sendWelcomeMessage(message, parsed);
      }
    }
  );

  Module({
    pattern: "elvedatest ?(.*)",
    fromMe: true,
    onlyAdmin: true,
    desc: "Mevcut gruptaki veda mesajının nasıl göründüğünü denemeniz için bir test mesajı gönderir.",
    usage: ".elvedatest",
    use: "grup",
  },
    async (message) => {
      if (!message.isGroup) return await message.sendReply("⚠️ *Bu komut sadece gruplarda kullanılabilir!*");
      const userIsAdmin = await isAdmin(message);
      if (!userIsAdmin && !message.fromOwner) return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");

      const goodbyeData = await goodbye.get(message.jid);
      if (!goodbyeData || !goodbyeData.enabled) return await message.sendReply("❌ *Veda mesajı kapalı veya ayarlanmamış!*");
      const parsed = await parseWelcomeMessage(goodbyeData.message, message, [message.sender]);
      if (parsed) {
        await message.sendReply("*💬 Veda Test Ediliyor:*");
        await sendWelcomeMessage(message, parsed);
      }
    }
  );
})();

// ==========================================
// FILE: filter.js
// ==========================================
(function () {
  const { Module } = require("../main");
  const { ADMIN_ACCESS, HANDLER_PREFIX } = require("../config");
  const { filter, isAdmin } = require("./utils");

  const handler = HANDLER_PREFIX;

  Module({
    pattern: "filtre ?(.*)",
    fromMe: true,
    desc: "Belirli kelimelere otomatik yanıt oluşturur.",
    usage: ".filtre merhaba | Merhaba! | sohbet\n.filtre yardım | Size yardım edebilirim | herkes\n.filtre güle | Güle güle! | grup | tam-eşleşme",
    use: "grup",
  },
    async (message, match) => {
      if (match[0].includes("filtreler")) return;
      let adminAccess = await isAdmin(message);
      if (!message.fromOwner && !adminAccess) return;
      const input = match[1]?.trim();
      if (!input) {
        return await message.sendReply(`*📝 Filtre Komutları:*\n\n` +
          `• \`${handler}filtre tetikleyici | yanıt\` - Sohbet filtresi oluştur\n` +
          `• \`${handler}filtre tetikleyici | yanıt | herkes\` - Genel filtre oluştur\n` +
          `• \`${handler}filtre tetikleyici | yanıt | grup\` - Sadece grup filtresi\n` +
          `• \`${handler}filtre tetikleyici | yanıt | dm\` - Sadece DM filtresi\n` +
          `• \`${handler}filtre tetikleyici | yanıt | sohbet | exact\` - Sadece tam eşleşme\n` +
          `• \`${handler}filtre tetikleyici | yanıt | sohbet | case\` - Büyük/küçük harf duyarlı\n` +
          `• \`${handler}filtreler\` - Tüm filtreleri listele\n` +
          `• \`${handler}filtresil tetikleyici\` - Filtreyi sil\n` +
          `• \`${handler}filtredurum tetikleyici\` - Filtreyi aç/kapat\n\n` +
          `*Kapsamlar:*\n` +
          `• \`sohbet\` - Sadece mevcut sohbet (varsayılan)\n` +
          `• \`herkes\` - Tüm sohbetler\n` +
          `• \`grup\` - Tüm gruplar\n` +
          `• \`dm\` - Tüm DM'ler\n\n` +
          `*Seçenekler:*\n` +
          `• \`tam-eşleşme\` - Sadece tam kelime eşleşmesi\n` +
          `• \`büyük-küçük\` - Büyük/küçük harf duyarlı eşleşme`
        );
      }

      const parts = input.split("|").map((p) => p.trim());
      if (parts.length < 2) {
        return await message.sendReply("💬 _Format:_ *tetikleyici | yanıt | kapsam(isteğe bağlı) | seçenekler(isteğe bağlı)*"
        );
      }

      const trigger = parts[0];
      const response = parts[1];
      const scopeRaw = (parts[2] || "sohbet").toLowerCase().trim();
      const options = parts[3] || "";

      // Türkçe kapsam adlarını DB ile uyumlu İngilizce'ye çevir
      const scopeMap = { sohbet: "chat", herkes: "global", grup: "group", dm: "dm" };
      const scope = scopeMap[scopeRaw];

      if (!trigger || !response) {
        return await message.sendReply("⚠️ *Hem tetikleyici hem de yanıt gereklidir!*"
        );
      }

      if (!scope) {
        return await message.sendReply("❌ *Geçersiz kapsam! Şunları kullanın: sohbet, herkes, grup veya dm*"
        );
      }

      const filterOptions = {
        caseSensitive: options.includes("büyük-küçük") || options.includes("case"),
        exactMatch: options.includes("tam-eşleşme") || options.includes("exact"),
      };

      try {
        await filter.set(
          trigger,
          response,
          message.jid,
          scope,
          message.sender,
          filterOptions
        );

        const scopeText =
          scope === "chat"
            ? "bu sohbet"
            : scope === "global"
              ? "tüm sohbetler"
              : scope === "group"
                ? "tüm gruplar"
                : "tüm DM'ler";
        const optionsText = [];
        if (filterOptions.exactMatch) optionsText.push("tam eşleşme");
        if (filterOptions.caseSensitive) optionsText.push("büyük/küçük harf duyarlı");
        const optionsStr = optionsText.length
          ? ` (${optionsText.join(", ")})`
          : "";

        await message.sendReply(`✅ *Filtre Oluşturuldu!*\n\n` +
          `*Tetikleyici:* ${trigger}\n` +
          `*Yanıt:* ${response}\n` +
          `*Kapsam:* ${scopeText}${optionsStr}`
        );
      } catch (error) {
        console.error("Filtre oluşturma hatası:", error);
        await message.sendReply("❌ *Filtre oluşturulamadı!*");
      }
    }
  );

  Module({
    pattern: "filtreler ?(.*)",
    fromMe: false,
    desc: "Sohbet veya genel kapsamda oluşturulmuş olan tüm aktif filtreleri listeler.",
    usage: ".filtreler\n.filtreler herkes\n.filtreler grup",
    use: "grup",
  },
    async (message, match) => {
      let adminAccess = await isAdmin(message);
      if (!message.fromOwner && !adminAccess) return;

      const scopeRaw = match[1]?.trim().toLowerCase();
      const scopeMap = { herkes: "global", grup: "group", dm: "dm" };
      const scope = scopeRaw ? (scopeMap[scopeRaw] || scopeRaw) : null;
      let filters;

      try {
        if (scope && ["global", "group", "dm"].includes(scope)) {
          filters = await filter.getByScope(scope);
        } else {
          filters = await filter.get(message.jid);
        }

        if (!filters || filters.length === 0) {
          return await message.sendReply("📭 _Filtre bulunamadı._");
        }

        let msg = `*📝 Aktif Filtreler:*\n\n`;

        filters.forEach((f, index) => {
          const scopeEmoji =
            {
              sohbet: "💬",
              herkes: "🌍",
              grup: "👥",
              dm: "📱",
            }[f.scope] || "💬";

          const options = [];
          if (f.exactMatch) options.push("exact");
          if (f.caseSensitive) options.push("case");
          const optionsStr = options.length ? ` [${options.join(", ")}]` : "";

          msg += `${index + 1}. ${scopeEmoji} *${f.trigger}*${optionsStr}\n`;
          msg += `   ↳ _${f.response.substring(0, 50)}${f.response.length > 50 ? "..." : ""
            }_\n`;
          msg += `   _Kapsam: ${f.scope}${f.enabled ? "" : " (devre dışı)"}_\n\n`;
        });

        await message.sendReply(msg);
      } catch (error) {
        console.error("Filtre listeleme hatası:", error);
        await message.sendReply("❌ *Filtreler alınamadı!*");
      }
    }
  );

  Module({
    pattern: "filtresil ?(.*)",
    fromMe: false,
    desc: "Daha önce oluşturulmuş olan bir filtre tetikleyicisini sistemden kalıcı olarak siler.",
    usage: ".filtresil tetikleyici\n.filtresil tetikleyici herkes",
    use: "grup",
  },
    async (message, match) => {
      let adminAccess = await isAdmin(message);
      if (!message.fromOwner && !adminAccess) return;

      const input = match[1]?.trim();
      if (!input) {
        return await message.sendReply("🗑️ *Silinecek filtre tetikleyicisini belirtin!*\n\n💬 _Kullanım:_ *.filtresil tetikleyici*"
        );
      }

      const parts = input.split(" ");
      const trigger = parts[0];
      const scopeRaw = (parts[1] || "sohbet").toLowerCase();
      const scopeMap = { sohbet: "chat", herkes: "global", grup: "group", dm: "dm" };
      const scope = scopeMap[scopeRaw] || "chat";
      if (parts[1] && !scopeMap[scopeRaw]) {
        return await message.sendReply("❌ *Geçersiz kapsam! Şunları kullanın: sohbet, herkes, grup veya dm*"
        );
      }

      try {
        const deleted = await filter.delete(trigger, message.jid, scope);

        if (deleted > 0) {
          await message.sendReply(
            `✅ *"${trigger}" filtresi başarıyla silindi!*`
          );
        } else {
          await message.sendReply(`❌ *"${trigger}" filtresi bulunamadı!*`);
        }
      } catch (error) {
        console.error("Filtre silme hatası:", error);
        await message.sendReply("❌ *Filtre silinemedi!*");
      }
    }
  );

  Module({
    pattern: "filtredurum ?(.*)",
    fromMe: false,
    desc: "Belirlediğiniz bir filtreyi geçici olarak devre dışı bırakır veya tekrar aktif eder.",
    usage: ".filtredurum tetikleyici\n.filtredurum tetikleyici herkes",
    use: "grup",
  },
    async (message, match) => {
      let adminAccess = await isAdmin(message);
      if (!message.fromOwner && !adminAccess) return;

      const input = match[1]?.trim();
      if (!input) {
        return await message.sendReply("💬 *Değiştirilecek filtre tetikleyicisini belirtin!*\n\n💬 _Kullanım:_ *.filtredurum tetikleyici*"
        );
      }

      const parts = input.split(" ");
      const trigger = parts[0];
      const scopeRaw = (parts[1] || "sohbet").toLowerCase();
      const scopeMap = { sohbet: "chat", herkes: "global", grup: "group", dm: "dm" };
      const scope = scopeMap[scopeRaw] || "chat";
      if (parts[1] && !scopeMap[scopeRaw]) {
        return await message.sendReply("❌ *Geçersiz kapsam! Şunları kullanın: sohbet, herkes, grup veya dm*"
        );
      }

      try {
        const currentFilter = await filter.get(message.jid, trigger);
        if (!currentFilter) {
          return await message.sendReply(`❌ *"${trigger}" filtresi bulunamadı!*`);
        }

        const newStatus = !currentFilter.enabled;
        const toggled = await filter.toggle(
          trigger,
          message.jid,
          scope,
          newStatus
        );

        if (toggled) {
          await message.sendReply(
            `✅ *"${trigger}" filtresi ${newStatus ? "açıldı" : "kapatıldı"}!*`
          );
        } else {
          await message.sendReply(`❌ *"${trigger}" filtresi değiştirilemedi!*`);
        }
      } catch (error) {
        console.error("Filtre aç/kapa hatası:", error);
        await message.sendReply("❌ *Filtre değiştirilemedi!*");
      }
    }
  );

  Module({
    pattern: "testfiltre ?(.*)",
    fromMe: false,
    desc: "Yazdığınız bir kelimenin herhangi bir filtreyle eşleşip eşleşmediğini test eder.",
    usage: ".testfiltre [metin]",
    use: "grup",
  },
    async (message, match) => {
      let adminAccess = await isAdmin(message);
      if (!message.fromOwner && !adminAccess) return;

      const testText = match[1]?.trim();
      if (!testText) {
        return await message.sendReply("💬 *Filtrelere karşı test edilecek metni girin!*\n\n💬 _Kullanım:_ *.testfiltre merhaba dünya*"
        );
      }

      try {
        const matchedFilter = await filter.checkMatch(testText, message.jid);

        if (matchedFilter) {
          await message.sendReply(`✅ *Filtre Eşleşmesi Bulundu!*\n\n` +
            `*Tetikleyici:* ${matchedFilter.trigger}\n` +
            `*Yanıt:* ${matchedFilter.response}\n` +
            `*Kapsam:* ${matchedFilter.scope}\n` +
            `*Seçenekler:* ${matchedFilter.exactMatch ? "tam eşleşme " : ""}${matchedFilter.caseSensitive
              ? "büyük/küçük harf duyarlı"
              : "büyük/küçük harf duyarsız"
            }`
          );
        } else {
          await message.sendReply(
            `❌ *"${testText}" hiçbir filtreyi tetiklemez!*`
          );
        }
      } catch (error) {
        console.error("Filtre test hatası:", error);
        await message.sendReply("❌ *Filtre test edilemedi!*");
      }
    }
  );

  Module({
    pattern: "filtreyardım",
    fromMe: false,
    desc: "Filtreleme sistemi ve gelişmiş seçenekleri hakkında detaylı yardım sunar.",
    usage: ".filtreyardım",
    use: "grup",
  },
    async (message) => {
      const helpText =
        `*🔧 Filtre Sistemi Yardımı*\n\n` +
        `*Filtreler nedir?*\n` +
        `Filtreler, belirli kelime veya ifadelere otomatik yanıt veren tetikleyicilerdir.\n\n` +
        `*📝 Filtre Oluşturma:*\n` +
        `\`${handler}filtre merhaba | Merhaba! Nasılsın?\`\n` +
        `• Sohbete özel filtre oluşturur\n` +
        `• Birisi "merhaba" yazdığında bot "Merhaba! Nasılsın?" yanıtını verir\n\n` +
        `*🌍 Filtre Kapsamları:*\n` +
        `• \`sohbet\` - Sadece mevcut sohbette çalışır\n` +
        `• \`herkes\` - Tüm sohbetlerde çalışır\n` +
        `• \`grup\` - Sadece tüm gruplarda çalışır\n` +
        `• \`dm\` - Sadece tüm DM'lerde çalışır\n\n` +
        `*⚙ Filtre Seçenekleri:*\n` +
        `• \`tam-eşleşme\` - Sadece tam kelime eşleşmesi\n` +
        `• \`büyük-küçük\` - Büyük/küçük harf duyarlı eşleşme\n\n` +
        `*📋 Örnekler:*\n` +
        `\`${handler}filtre bot | Buradayım! | sohbet\`\n` +
        `\`${handler}filtre yardım | Yöneticiyle iletişime geçin | herkes\`\n` +
        `\`${handler}filtre Merhaba | Selam! | grup | tam-eşleşme\`\n` +
        `\`${handler}filtre ŞİFRE | Şş! | dm | büyük-küçük\`\n\n` +
        `*🔧 Yönetim:*\n` +
        `• \`${handler}filtreler\` - Tüm filtreleri listele\n` +
        `• \`${handler}filtresil tetikleyici\` - Filtreyi sil\n` +
        `• \`${handler}filtredurum tetikleyici\` - Aç/kapat\n` +
        `• \`${handler}testfiltre metin\` - Eşleşmeyi test et\n\n` +
        `*💡 İpuçları:*\n` +
        `• Her mesaj için filtreler kontrol edilir\n` +
        `• Genel filtreler her yerde çalışır\n` +
        `• Kesin tetikleyiciler için tam eşleşme kullanın\n` +
        `• Şifre/kodlar için büyük/küçük harf duyarlı kullanışlıdır`;

      await message.sendReply(helpText);
    }
  );
})();

// ==========================================
// FILE: sayac.js
// ==========================================
(function () {
  const { Module } = require('../main');
  const moment = require('moment-timezone');

  moment.locale('tr');



  function calculateTime(futureTime) {
    const future = moment(futureTime, 'YYYY-MM-DD HH:mm:ss');
    const now = moment();
    const diff = future.diff(now);

    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };

    const duration = moment.duration(diff);

    return {
      days: Math.floor(duration.asDays()),
      hours: duration.hours(),
      minutes: duration.minutes(),
      seconds: duration.seconds(),
    };
  }

  function findClosestDate(dates) {
    const now = moment();
    let closestDate = null;
    let minDiff = Infinity;

    dates.forEach((dateObj) => {
      const date = moment(dateObj.date);
      const diff = date.diff(now);

      if (diff >= 0 && diff < minDiff) {
        minDiff = diff;
        closestDate = dateObj;
      }
    });

    return closestDate;
  }

  Module({
    pattern: 'ykssayaç',
    fromMe: false,
    desc: 'YKS (TYT/AYT/YDT) sınavlarına kalan süreyi veya tercih tarihlerini gösterir.',
    usage: '.ykssayaç',
    use: 'araçlar',
  },
    async (m) => {
      const sinavsonuc = '2026-07-22 07:30:00';
      const tercihbaslangic = '2025-07-30 00:00:00';
      const tercihbitis = '2025-08-08 23:59:59';
      const now = moment();

      if (now.isAfter(moment(tercihbitis, 'YYYY-MM-DD HH:mm:ss'))) {
        const time1 = calculateTime('2026-06-20 10:15:00');
        const time2 = calculateTime('2026-06-21 10:15:00');
        const time3 = calculateTime('2026-06-21 15:45:00');

        await m.sendReply(
          `⏳ *TYT* sınavına *${time1.days} gün ${time1.hours} saat ${time1.minutes} dakika ${time1.seconds} saniye* kaldı!\n📅 *20 Haziran 2026 - 10:15*\n\n` +
          `⏳ *AYT* sınavına *${time2.days} gün ${time2.hours} saat ${time2.minutes} dakika ${time2.seconds} saniye* kaldı!\n📅 *21 Haziran 2026 - 10:15*\n\n` +
          `⏳ *YDT* sınavına *${time3.days} gün ${time3.hours} saat ${time3.minutes} dakika ${time3.seconds} saniye* kaldı!\n📅 *21 Haziran 2026 - 15:45*`
        );
      } else if (now.isBefore(moment(sinavsonuc, 'YYYY-MM-DD HH:mm:ss'))) {
        const timeToResults = calculateTime(sinavsonuc);
        await m.sendReply(
          `👀 YKS sonuçlarının açıklanmasına *${timeToResults.days} gün ${timeToResults.hours} saat ${timeToResults.minutes} dakika ${timeToResults.seconds} saniye* kaldı!\n📅 *22 Temmuz 2025 - 07:30*`
        );
      } else if (now.isBefore(moment(tercihbaslangic, 'YYYY-MM-DD HH:mm:ss'))) {
        const timeToPreferences = calculateTime(tercihbaslangic);
        await m.sendReply(
          `🎓 YKS tercihlerinin başlamasına *${timeToPreferences.days} gün ${timeToPreferences.hours} saat ${timeToPreferences.minutes} dakika ${timeToPreferences.seconds} saniye* kaldı!\n📅 *31 Temmuz 2025*`
        );
      } else if (now.isBefore(moment(tercihbitis, 'YYYY-MM-DD HH:mm:ss'))) {
        const timeToEnd = calculateTime(tercihbitis);
        await m.sendReply(
          `⏰ YKS tercihlerinin bitmesine *${timeToEnd.days} gün ${timeToEnd.hours} saat ${timeToEnd.minutes} dakika ${timeToEnd.seconds} saniye* kaldı!\n📅 *8 Ağustos 2025 - 23:59*`
        );
      } else {
        const time1 = calculateTime('2026-06-20 10:15:00');
        await m.sendReply(
          `🆕 *2026 YKS süreci başladı!*\n\n⏳ *TYT sınavına:* ${time1.days} gün kaldı.\n📅 *20 Haziran 2026 - 10:15*`
        );
      }
    }
  );

  Module({
    pattern: 'kpsssayaç',
    fromMe: false,
    desc: 'KPSS (Lisans/Önlisans/Ortaöğretim/E-KPSS) sınavlarına kalan süreyi gösterir.',
    usage: '.kpsssayaç',
    use: 'araçlar',
  },
    async (m) => {
      const lisans = calculateTime('2026-09-06 10:15:00');
      const onlisans = calculateTime('2026-10-04 10:15:00');
      const ortaogretim = calculateTime('2026-10-25 10:15:00');
      const ekpss = calculateTime('2026-04-19 10:15:00');
      await m.sendReply(
        `_(TAHMİNİ)_\n⏳ KPSS *(Lisans)* sınavına *${lisans.days} gün ${lisans.hours} saat ${lisans.minutes} dakika ${lisans.seconds} saniye* kaldı!\n📅 *26 Temmuz 2026 - 10:15*\n\n⏳ KPSS *(Önlisans)* sınavına *${onlisans.days} gün ${onlisans.hours} saat ${onlisans.minutes} dakika ${onlisans.seconds} saniye* kaldı!\n📅 *4 Ekim 2026 - 10:15*\n\n⏳ KPSS *(Ortaöğretim)* sınavına *${ortaogretim.days} gün ${ortaogretim.hours} saat ${ortaogretim.minutes} dakika ${ortaogretim.seconds} saniye* kaldı!\n📅 *25 Ekim 2026 - 10:15*\n\n⏳ *E-KPSS* sınavına *${ekpss.days} gün ${ekpss.hours} saat ${ekpss.minutes} dakika ${ekpss.seconds} saniye* kaldı!\n📅 *19 Nisan 2026 - 10:15*`
      );
    }
  );

  Module({
    pattern: 'msüsayaç',
    fromMe: false,
    desc: 'MSÜ sınavına kalan süreyi gösterir.',
    usage: '.msüsayaç',
    use: 'araçlar',
  },
    async (m) => {
      const targetDate = moment('2026-03-01 10:15:00');
      const now = moment();

      if (now.isAfter(targetDate)) {
        await m.sendReply(
          `❗ *OPS! MSÜ sınavı bu yıl için tamamlandı.* ✅\n📅 *1 Mart 2026 - 10:15*`
        );
      } else {
        const time = calculateTime(targetDate);
        await m.sendReply(
          `⏳ *MSÜ* sınavına *${time.days} gün ${time.hours} saat ${time.minutes} dakika ${time.seconds}* saniye kaldı!\n📅 *1 Mart 2026 - 10:15*`
        );
      }
    }
  );

  Module({
    pattern: 'okulsayaç',
    fromMe: false,
    desc: 'Okulların kapanmasına, ara tatillere veya yeni döneme kalan süreyi gösterir.',
    usage: '.okulsayaç',
    use: 'araçlar',
  },
    async (m) => {
      const schoolDates = [
        { date: '2025-11-10 08:00:00', label: '1. Dönem ara tatili' },
        { date: '2026-01-19 08:00:00', label: 'Yarıyıl tatili' },
        { date: '2026-03-16 08:00:00', label: '2. Dönem ara tatili' },
        { date: '2026-06-26 08:00:00', label: 'Yaz Tatili' },
      ];
      let closestDateObj = findClosestDate(schoolDates);
      if (!closestDateObj) {
        closestDateObj = {
          date: '2025-09-08 08:00:00',
          label: 'Okulların açılışı',
        };
      }

      const time = calculateTime(closestDateObj.date);
      const formattedDate = moment(closestDateObj.date).format('DD MMMM YYYY - dddd');

      await m.sendReply(
        `🧐 En yakın tarih: *${closestDateObj.label}*\n⏳ ${closestDateObj.label === 'Okulların açılışı'
          ? 'Okulların açılmasına'
          : 'Okulların kapanmasına'
        } *${time.days} gün ${time.hours} saat ${time.minutes} dakika ${time.seconds}* saniye kaldı! 🥳\n📅 *${formattedDate}*`
      );
    }
  );

  Module({
    pattern: 'ramazansayaç',
    fromMe: false,
    desc: 'Ramazan ayının başlangıcına veya bitişine kalan süreyi gösterir.',
    usage: '.ramazansayaç',
    use: 'araçlar',
  },
    async (m) => {
      const ramazanStart = '2026-02-19 02:23:00';
      const ramazanEnd = '2026-03-19 19:30:00';
      const now = moment();

      if (now.isBetween(moment(ramazanStart), moment(ramazanEnd))) {
        const time = calculateTime(ramazanEnd);
        await m.sendReply(
          `⏳ Ramazan ayının bitmesine *${time.days} gün ${time.hours} saat ${time.minutes} dakika ${time.seconds} saniye* kaldı! 🥲\n📅 *19 Mart 2026 - Perşembe*`
        );
      } else if (now.isBefore(moment(ramazanStart))) {
        const time = calculateTime(ramazanStart);
        await m.sendReply(
          `⏳ Ramazan ayına girmemize *${time.days} gün ${time.hours} saat ${time.minutes} dakika ${time.seconds} saniye* kaldı! 😍\n📅 *19 Şubat 2026 - Perşembe*`
        );
      }
    }
  );
})();

// ==========================================
// FILE: group-updates.js
// ==========================================
(function () {
  const {
    antifake,
    antibot,
    antipdm,
    antipromote,
    antidemote,
    welcome,
    goodbye,
    isAdmin,
  } = require("./utils");
  const { automute, autounmute, stickcmd } = require("./utils/db/zamanlayicilar");
  const {
    parseWelcomeMessage,
    sendWelcomeMessage,
  } = require('./utils/karsilama_ayristirici');

  async function isSuperAdmin(message, user = message.client.user.id) {
    const metadata = await message.client.groupMetadata(message.jid);
    let superadmin = metadata.participants.filter((v) => v.admin == "superadmin");
    superadmin = superadmin.length ? superadmin[0].id == user : false;
    return superadmin;
  }
  const { Module } = require("../main");
  const config = require("../config");
  const { ALLOWED, ADMIN_ACCESS, SUDO } = config;
  const handler = config.HANDLER_PREFIX;

  // Anti-Numara: LID çözülemediğinde bekleyen kullanıcılar
  // Map<groupJid, Map<participantLid, Date (ekleme zamanı)>>
  const pendingAntiFakeUsers = new Map();
  // 24 saat sonra temizle (gereksiz birikim önlemi)
  setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [gJid, users] of pendingAntiFakeUsers) {
      for (const [lid, addedAt] of users) {
        if (addedAt < cutoff) users.delete(lid);
      }
      if (users.size === 0) pendingAntiFakeUsers.delete(gJid);
    }
  }, 60 * 60 * 1000);

  function tConvert(time) {
    // Desteklenen formatlar: "22 45", "22:45", "22 45 00"
    const match = time.toString().match(/^([01]\d|2[0-3])[: ]?([0-5]\d)/);
    if (match) {
      return `${match[1]}:${match[2]}`;
    }
    return time.toString();
  }

  async function extractData(message) {
    const sha256 = message.quoted?.message?.stickerMessage?.fileSha256;
    if (!sha256) throw new Error("Çıkartmadan SHA256 alınamadı — geçerli bir çıkartmaya yanıt verin.");
    // BUG FIX: Uint8Array/Buffer → base64 string (handler ile aynı format)
    // .toString() latin1 çıkar, DB ile hiçbir zaman eşleşmez
    return Buffer.isBuffer(sha256)
      ? sha256.toString('base64')
      : Buffer.from(sha256).toString('base64');
  }
  Module({
    pattern: "otoçıkartma ?(.*)",
    fromMe: false,
    desc: "Komutları çıkartmalara yapıştırır. Çıkartma gönderilirse komut gibi çalışır!",
    use: "araçlar",
    usage: ".otoçıkartma .ban",
    warn: "Sadece çıkartmalarda çalışır",
  },
    async (message, match) => {
      if (!match[1] || !message.reply_message || !message.reply_message.sticker)
        return await message.sendReply("💬 *Bir çıkartmayı yanıtlayın!*\n\n💬 _Örn:_ *.otoçıkartma .ban*"
        );
      try {
        await stickcmd.set(match[1], await extractData(message));
        // BUG FIX: Yeni sticker eklendi — handler cache'ini anında sıfırla
        // Aksi hâlde 2 dakika boyunca eski liste döner, sticker çalışmaz.
        const { invalidateStickcmdCache } = require("../../core/handler");
        invalidateStickcmdCache();
      } catch {
        return await message.sendReply("❌ *İşlem başarısız oldu!*");
      }
      await message.client.sendMessage(
        message.jid,
        {
          text: `✨ *${match[1]} komutu bu çıkartmaya yapıştırıldı!* ✅`,
        },
        {
          quoted: message.quoted,
        }
      );
    }
  );

  Module({
    pattern: "otoçıkartmasil ?(.*)",
    fromMe: false,
    desc: "Çıkartmalardaki komutları siler",
    usage: ".otoçıkartmasil .ban",
    use: "araçlar",
  },
    async (message, match) => {
      const { invalidateStickcmdCache } = require("../../core/handler");
      if (message.reply_message && message.reply_message.sticker) {
        let deleted = await stickcmd.delete(await extractData(message), "file");
        if (deleted) {
          // BUG FIX: Silinen sticker'ı cache'den hemen kaldır
          invalidateStickcmdCache();
          return await message.client.sendMessage(
            message.jid,
            { text: `🗑️ *Çıkartma komutlardan kaldırıldı!*` },
            { quoted: message.quoted }
          );
        }
        if (!deleted && match[1]) {
          const delete_again = await stickcmd.delete(match[1], "command");
          if (delete_again) {
            invalidateStickcmdCache();
            return await message.sendReply(`🗑️ *${match[1]} sabit komutlardan kaldırıldı!*`);
          }
          return await message.sendReply("❌ *Böyle bir çıkartma/komut bulunamadı!*");
        }
        if (!deleted && !match[1])
          return await message.sendReply("❌ *Böyle bir çıkartma bulunamadı!*");
      } else if (match[1] && !message.reply_message) {
        let deleted = await stickcmd.delete(match[1], "command");
        if (deleted) {
          invalidateStickcmdCache();
          return await message.sendReply(`✅ *${match[1]} sabit komutlardan başarıyla kaldırıldı!*`);
        }
        return await message.sendReply("❌ *Böyle bir komut bulunamadı!*");
      } else
        return await message.sendReply("💬 *Çıkartmaya yanıt verin veya komut girin!*\n\n💬 _Örn:_ *.otoçıkartmasil .ban*"
        );
    }
  );

  Module({
    pattern: "otoçıkartmalar ?(.*)",
    fromMe: false,
    desc: "Çıkartmalardaki komutları gösterir",
    use: "araçlar",
  },
    async (message, match) => {
      const all = await stickcmd.get();
      if (!all || all.length === 0)
        return await message.sendReply("ℹ️ *Henüz hiçbir çıkartmaya komut yapıştırılmamış.*");
      // BUG FIX: .dataValues.command yerine güvenli erişim
      // Sequelize instance veya plain object her ikisini de destekler
      const commands = all.map((el) => (el.dataValues ? el.dataValues.command : el.command));
      const msg = commands.map((c, i) => `${i + 1}. \`${c}\``).join("\n");
      await message.sendReply("✨ *Çıkartmaya Yapıştırılmış Komutlar:*\n\n" + msg);
    }
  );

  Module({
    pattern: "otosohbet ?(.*)",
    fromMe: false,
    desc: "Grup sohbetinin otomatik açılış ve kapanış saatlerini yönetir.",
    usage: ".otosohbet aç [HH:MM] | .otosohbet kapat [HH:MM] | .otosohbet sil [aç/kapat] | .otosohbet liste",
    use: "grup",
  },
    async (message, match) => {
      let adminAccesValidated = await isAdmin(message);
      if (!(message.fromOwner || adminAccesValidated)) return;

      const args = match[1]?.trim().split(/\s+/);
      const subcommand = args?.[0]?.toLowerCase();
      const value = args?.slice(1).join(" ")?.trim();

      // Liste/Yardım görünümleri
      if (!subcommand || subcommand === "liste" || subcommand === "yardım") {
        const mutes = await automute.get();
        const unmutes = await autounmute.get();

        const allChats = new Set([
          ...mutes.map(m => m.chat),
          ...unmutes.map(u => u.chat)
        ]);

        let msg = "";
        let count = 0;

        for (const chatJid of allChats) {
          const muteData = mutes.find(m => m.chat === chatJid);
          const unmuteData = unmutes.find(u => u.chat === chatJid);

          let chatName = "Bilinmeyen Grup";
          try {
            const meta = await message.client.groupMetadata(chatJid);
            chatName = meta.subject || chatName;
          } catch (e) { }

          count++;
          msg += `*${count}. Grup:* ${chatName}\n`;
          msg += `*➥ Kapanış:* ${muteData ? tConvert(muteData.time) : "_Pasif_"}\n`;
          msg += `*➥ Açılış:* ${unmuteData ? tConvert(unmuteData.time) : "_Pasif_"}\n\n`;
        }

        if (!msg) return await message.sendReply("❌ *Henüz planlanmış bir açılış/kapanış kaydı bulunamadı!*");
        return await message.sendReply("⏰ *Zamanlanmış Sohbet Yönetimi*\n\n" + msg + "_ℹ️ Saatler Türkiye/İstanbul zamanına göredir._");
      }

      // Alt komut işlemleri
      switch (subcommand) {
        case "aç":
        case "kapat": {
          if (!value) {
            return await message.sendReply(`⚠️ *Saat belirtilmedi!* \n\n*Örnek:* \`.otosohbet ${subcommand} 08:00\``);
          }

          if (value.includes("am") || value.includes("pm")) {
            return await message.sendReply("⏰ *Lütfen saati 24 saat formatında (SS:DD) girin!* \n_Örn: 22:30_");
          }

          const timeMatch = value.match(/^([0-2][0-9])[:. ]?([0-5][0-9])$/);
          if (!timeMatch) {
            return await message.sendReply(`⚠️ *Geçersiz zaman formatı!* \n\n*Doğru Kullanım:* \`.otosohbet ${subcommand} 22:30\``);
          }

          if (message.isGroup && !message.isBotAdmin) {
            return await message.sendReply("❌ *Bu işlemi yapabilmem için yönetici olmam gerekiyor!*");
          }

          const timeStr = timeMatch[1] + " " + timeMatch[2];
          if (subcommand === "kapat") {
            await automute.set(message.jid, timeStr);
            return await message.sendReply(`✅ *Grup her gün saat ${tConvert(timeStr)}'de otomatik olarak KAPANACAK.*`);
          } else {
            await autounmute.set(message.jid, timeStr);
            return await message.sendReply(`✅ *Grup her gün saat ${tConvert(timeStr)}'de otomatik olarak AÇILACAK.*`);
          }
        }

        case "sil": {
          if (value === "aç" || value === "unmute") {
            await autounmute.delete(message.jid);
            return await message.sendReply("✅ *Otomatik açılma zamanlaması bu grup için silindi.*");
          } else if (value === "kapat" || value === "mute") {
            await automute.delete(message.jid);
            return await message.sendReply("✅ *Otomatik kapanma zamanlaması bu grup için silindi.*");
          } else {
            return await message.sendReply("⚠️ *Hangi zamanlamayı silmek istiyorsunuz?* \n\n*Örn:* \`.otosohbet sil kapat\` veya \`.otosohbet sil aç\`");
          }
        }

        default:
          return await message.sendReply(`❌ *Bilinmeyen alt komut:* \`${subcommand}\` \n\n*Mevcut komutlar:*\n• \`.otosohbet aç [saat]\`\n• \`.otosohbet kapat [saat]\`\n• \`.otosohbet sil aç/kapat\`\n• \`.otosohbet liste\``);
      }
    }
  );

  Module({
    on: "groupParticipants",
    fromMe: false,
  },
    async (message, match) => {
      message.myjid = message.client.user.lid ? message.client.user.lid.split(":")[0] : message.client.user.id.split(":")[0];
      // OPT: Her event'te antifake.get()/antipdm.get() vb. (findAll) yerine
      // cache'li Set sorgulaması — DB'ye gitmez (60sn TTL)
      const [antifakeDb, antipdmDb, apDb, adDb] = await Promise.all([
        antifake.get(),
        antipdm.get(),
        antipromote.get(),
        antidemote.get(),
      ]);
      let sudos = SUDO.split(",");
      const jids = antifakeDb.map((data) => data.jid);
      const antipdmjids = antipdmDb.map((data) => data.jid);
      const apjids = apDb.map((data) => data.jid);
      const adjids = adDb.map((data) => data.jid);
      const admin_jids = [];
      const admins = ((await message.client.groupMetadata(message.jid).catch(() => ({ participants: [] }))).participants || [])
        .filter((v) => v.admin !== null)
        .map((x) => x.id.split(":")[0] + "@s.whatsapp.net");
      admins.map(async (user) => {
        admin_jids.push(user);
      });
      if (
        (message.action == "promote" || message.action == "demote") &&
        antipdmjids.includes(message.jid)
      ) {
        if (message.from.split("@")[0] == message.myjid) return;
        const targetUser = typeof message.participant[0] === "string" ? message.participant[0] : message.participant[0].id;

        const notifyJids = [...admin_jids];
        notifyJids.push(message.from);
        notifyJids.push(targetUser);

        await message.client.sendMessage(message.jid, {
          text: `_*${message.action == "promote" ? "🔔 (Yetki verme algılandı!)" : "🔔 (Yetki alma algılandı!)"
            }*_\n\n_Yönetici @${message.from.split("@")[0]},\n @${targetUser.split("@")[0]
            } üyesini ${message.action == "promote" ? "yönetici yaptı._" : "yöneticilikten aldı._"}`,
          mentions: [...new Set(notifyJids)],
        });
      }
      if (message.action == "promote" && apjids.includes(message.jid)) {
        const targetUser = typeof message.participant[0] === "string" ? message.participant[0] : message.participant[0].id;
        if (
          message.from.split("@")[0] == message.myjid ||
          sudos.includes(message.from.split("@")[0]) ||
          targetUser.split("@")[0] == message.myjid ||
          (await isSuperAdmin(message, message.from))
        )
          return;
        const botId = message.client.user.id.split(":")[0] + "@s.whatsapp.net";
        const isAdminPromote = await isAdmin(message, botId);
        if (!isAdminPromote) return;
        await message.client.groupParticipantsUpdate(
          message.jid,
          [message.from],
          "demote"
        );
        return await message.client.groupParticipantsUpdate(
          message.jid,
          [targetUser],
          "demote"
        );
      }
      if (message.action == "demote" && adjids.includes(message.jid)) {
        const targetUser = typeof message.participant[0] === "string" ? message.participant[0] : message.participant[0].id;
        if (
          message.from.split("@")[0] == message.myjid ||
          sudos.includes(message.from.split("@")[0]) ||
          (await isSuperAdmin(message, message.from))
        )
          return;
        if (targetUser.split("@")[0] == message.myjid) {
          return await message.client.sendMessage(message.jid, {
            text: `❌ *Bot yetkisi düşürüldü!*\n\n⚠️ _Geri yükleme yapılamıyor._\n👤 _Yetkiyi düşüren:_ @${message.from.split("@")[0]}`,
            mentions: admin_jids,
          });
        }
        const botId = message.client.user.id.split(":")[0] + "@s.whatsapp.net";
        const isAdminDemote = await isAdmin(message, botId);
        if (!isAdminDemote) return;
        await message.client.groupParticipantsUpdate(
          message.jid,
          [message.from],
          "demote"
        );
        return await message.client.groupParticipantsUpdate(
          message.jid,
          [targetUser],
          "promote"
        );
      }
      if (message.action === "add" && jids.includes(message.jid)) {
        const fakeRecord = db.find((d) => d.jid === message.jid);
        const groupAllowed = (fakeRecord && fakeRecord.allowed) ? fakeRecord.allowed : (ALLOWED || "90");
        const allowed = groupAllowed.split(",").map((p) => p.trim()).filter(Boolean);
        let participantId = typeof message.participant[0] === "string" ? message.participant[0] : message.participant[0].id;

        // YÖNETİCİ BYPASS: Gruba bir yönetici tarafından manüel eklenen kişiler korunur ve göz ardı edilir.
        if (message.from) {
          const { isBotIdentifier } = require("./utils/lid_yardimcisi");
          const adderClean = message.from.split(":")[0] + "@s.whatsapp.net";

          if (isBotIdentifier(adderClean, message.client)) return; // Bot'un eklediklerini atla

          try {
            const isActionByAdmin = await isAdmin(message, adderClean);
            if (isActionByAdmin) {
              return console.log(`[Anti-Numara] Uyarı: Bir yönetici birini eklediği için antinumara istisnası uygulandı.`);
            }
          } catch (e) { }
        }

        // MIGRATION: Antinumara için LID'yi Telefon Numarasına Çevir
        let isLid = participantId.includes("@lid");
        if (isLid) {
          try {
            const { resolveLidToPn } = require("../core/yardimcilar");
            const resolvedPn = await resolveLidToPn(message.client, participantId);
            if (resolvedPn && resolvedPn !== participantId) {
              participantId = resolvedPn;
              isLid = false; // Başarıyla PN'ye çevrildi
            }
          } catch (e) { }
        }

        // LID çözülemediyse kişiyi bekle - ilk mesajında numara kontrol edilecek
        if (participantId.includes("@lid")) {
          console.log(`[Anti-Numara] ${participantId} telefon numarasına çevrilemedi. Mesaj atması bekleniyor...`);
          if (!pendingAntiFakeUsers.has(message.jid)) pendingAntiFakeUsers.set(message.jid, new Map());
          pendingAntiFakeUsers.get(message.jid).set(participantId, Date.now());
          return;
        }

        const participantNumber = participantId.split("@")[0];
        const isAllowedNumber = allowed.some((prefix) =>
          participantNumber.startsWith(prefix)
        );

        // Yabancı numara veya çözülemeyen LID tespit edildi
        if (!isAllowedNumber) {
          const { isBotIdentifier } = require("./utils/lid_yardimcisi");

          // Bot'un kendisi olup olmadığını kontrol edelim
          if (isBotIdentifier(participantId, message.client)) return;

          // Bot admin mi? WhatsApp Multi-Device session (örn. :15) kimlik karmaşası yaratmaması için temizliyoruz.
          const botIdClean = message.client.user.id.split(":")[0] + "@s.whatsapp.net";
          const isBotAdmin = await isAdmin(message, botIdClean);
          if (!isBotAdmin) {
            return console.log("[Anti-Numara] Bot yönetici olmadığı için atma işlemi iptal edildi.");
          }

          // Atılacak hedefi belirle
          const targetKick = typeof message.participant[0] === "string" ? message.participant[0] : message.participant[0].id;

          // Kullanıcıya şeffaf bildirim yapalım
          await message.client.sendMessage(message.jid, {
            text: `🚨 *Anti-Numara Koruması!*\n\n🛡 _İzin verilmeyen bir numara tespit ettim._\n🧹 _Gruptan uzaklaştırıyorum..._`
          });

          try {
            await message.client.groupParticipantsUpdate(
              message.jid,
              [targetKick],
              "remove"
            );
            console.log(`[Anti-Numara] ${targetKick} gruptan atıldı.`);
          } catch (err) {
            console.error(`[Anti-Numara] Atma hatası:`, err);
            await message.client.sendMessage(message.jid, {
              text: `❌ *Bot kişiyi atarken WhatsApp kaynaklı bir sunucu hatası yaşadı.*\n(Lütfen kişiyi manuel atınız.)`
            });
          }
        }
      }

      if (message.action === "add") {
        const welcomeData = await welcome.get(message.jid);
        if (welcomeData && welcomeData.enabled) {
          try {
            const parsedMessage = await parseWelcomeMessage(
              welcomeData.message,
              message,
              message.participant
            );
            if (parsedMessage) {
              await sendWelcomeMessage(message, parsedMessage);
            }
          } catch (error) {
            console.error("Hoş geldin mesajı gönderilirken hata:", error);
          }
        }
      }

      if (message.action === "remove") {
        const goodbyeData = await goodbye.get(message.jid);
        if (goodbyeData && goodbyeData.enabled) {
          try {
            const parsedMessage = await parseWelcomeMessage(
              goodbyeData.message,
              message,
              message.participant
            );
            if (parsedMessage) {
              await sendWelcomeMessage(message, parsedMessage);
            }
          } catch (error) {
            console.error("Hoşça kal mesajı gönderilirken hata:", error);
          }
        }
      }
    }
  );

  // Anti-Numara: Bekleyen LID kullanıcısı mesaj atınca numara kontrolü
  Module({
    on: "text",
    fromMe: false,
  },
    async (message) => {
      try {
        if (!message.isGroup) return;
        const groupPending = pendingAntiFakeUsers.get(message.jid);
        if (!groupPending || groupPending.size === 0) return;

        // Gönderen kişi bekleyen listede mi?
        const senderLid = message.sender;
        if (!groupPending.has(senderLid)) return;

        // Listeden çıkar
        groupPending.delete(senderLid);
        if (groupPending.size === 0) pendingAntiFakeUsers.delete(message.jid);

        // DB'den antifake ayarını kontrol et
        // NOT: antifake.get() burada kaçınılmaz — allowed değerini (izin verilen prefix) okumak için
        // tam kayıt gerekiyor. findAll yerine findOne(jid) ile sadece bu grubun kaydı çekilir.
        const { FakeDB } = require("../utils/db/modeller");
        const fakeRecord = await FakeDB.findByPk(message.jid).catch(() => null);
        if (!fakeRecord) return; // Bu grup antifake'de kayıtlı değil
        const groupAllowed = (fakeRecord && fakeRecord.allowed) ? fakeRecord.allowed : (ALLOWED || "90");
        const allowed = groupAllowed.split(",").map(p => p.trim()).filter(Boolean);

        // Gönderenin numarasını çöz - participantPn veya sender üzerinden
        let participantId = senderLid;
        if (participantId.includes("@lid")) {
          try {
            const { resolveLidToPn } = require("../core/yardimcilar");
            const resolved = await resolveLidToPn(message.client, participantId);
            if (resolved && resolved !== participantId) participantId = resolved;
          } catch (e) { }
        }

        if (participantId.includes("@lid")) {
          // Hâlâ çözülemediyse tekrar beklet
          if (!pendingAntiFakeUsers.has(message.jid)) pendingAntiFakeUsers.set(message.jid, new Map());
          pendingAntiFakeUsers.get(message.jid).set(senderLid, Date.now());
          return;
        }

        const participantNumber = participantId.split("@")[0];
        const isAllowedNumber = allowed.some(prefix => participantNumber.startsWith(prefix));

        if (!isAllowedNumber) {
          const { isBotIdentifier } = require("./utils/lid_yardimcisi");
          if (isBotIdentifier(participantId, message.client)) return;

          const botIdClean = message.client.user.id.split(":")[0] + "@s.whatsapp.net";
          const isBotAdmin = await isAdmin(message, botIdClean);
          if (!isBotAdmin) return;

          // Yönetici mi? Atma
          const admins = ((await message.client.groupMetadata(message.jid).catch(() => ({ participants: [] }))).participants || [])
            .filter(v => v.admin !== null)
            .map(x => x.id.split(":")[0] + "@s.whatsapp.net");
          if (admins.some(a => a.split("@")[0] === participantNumber)) return;

          await message.client.sendMessage(message.jid, {
            text: `🚨 *Anti-Numara Koruması!*\n\n🛡 _İzin verilmeyen bir numara tespit ettim._\n🧹 _Gruptan uzaklaştırıyorum..._`
          });
          try {
            await message.client.groupParticipantsUpdate(message.jid, [senderLid], "remove");
            console.log(`[Anti-Numara] ${senderLid} (mesaj sonrası) gruptan atıldı.`);
          } catch (err) {
            console.error(`[Anti-Numara] Atma hatası:`, err);
            await message.client.sendMessage(message.jid, {
              text: `❌ *Bot kişiyi atarken bir sunucu hatası yaşadı.*\n(Lütfen kişiyi manuel atınız.)`
            });
          }
        }
      } catch (e) {
        console.error("[Anti-Numara Pending] Hata:", e);
      }
    }
  );
})();

// ==========================================
// FILE: mention.js
// ==========================================
(function () {
  const { Module } = require("../main");
  const config = require("../config");
  const { uploadToCatbox } = require('./utils/dosya_yukleme');
  const { isAdmin } = require("./utils");

  const fs = require("fs");
  const path = require("path");

  const handler = config.HANDLER_PREFIX;

  const { setVar, delVar } = require('./yonetim_araclari');
  const { BotVariable } = require('../core/database');

  // ── Grup başına ayrı bahsetme yanıtı ──────────────────────────────────────
  // Anahtar: MENTION_REPLY_<groupJid>   (ör. MENTION_REPLY_120363...@g.us)
  // Fallback: Genel MENTION_REPLY (sahip tarafından ayarlanmış global mesaj)
  // ──────────────────────────────────────────────────────────────────────────

  async function getMentionReply(jid) {
    try {
      // 1) Gruba özel ayar
      if (jid) {
        const groupKey = `MENTION_REPLY_${jid}`;
        // in-memory cache'de var mı?
        let raw = config[groupKey];
        // yoksa DB'den çek
        if (!raw) {
          const row = await BotVariable.findByPk(groupKey);
          if (row?.value) {
            config[groupKey] = row.value; // bellekte önbelleğe al
            raw = row.value;
          }
        }
        if (raw) return JSON.parse(raw);
      }
      // 2) Global fallback (sahip tarafından ayarlanan varsayılan)
      const globalRaw = config.MENTION_REPLY;
      return globalRaw ? JSON.parse(globalRaw) : null;
    } catch (error) {
      console.error("Etiket yanıtı ayrıştırma hatası:", error);
      return null;
    }
  }

  async function setMentionReply(jid, data) {
    try {
      const key = jid ? `MENTION_REPLY_${jid}` : "MENTION_REPLY";
      return await setVar(key, JSON.stringify(data));
    } catch (error) {
      console.error("Etiket yanıtı ayarlama hatası:", error);
      return false;
    }
  }

  async function deleteMentionReply(jid) {
    try {
      const key = jid ? `MENTION_REPLY_${jid}` : "MENTION_REPLY";
      return await delVar(key);
    } catch (error) {
      console.error("Etiket yanıtı silme hatası:", error);
      return false;
    }
  }

  function isSudoUser(jid) {
    if (!jid) return false;

    let sudoMap = [];
    if (config.SUDO_MAP) {
      try {
        sudoMap = JSON.parse(config.SUDO_MAP);
        if (!Array.isArray(sudoMap)) sudoMap = []
      } catch (e) {
        sudoMap = [];
      }
    }

    return sudoMap.includes(jid);
  }

  Module({
    pattern: "bahsetme ?(.*)",
    fromMe: false,
    desc: "Grupta biri botu etiketlediğinde botun vereceği otomatik yanıtı ayarlar. Grup yöneticileri kendi grupları için özelleştirebilir.",
    use: "grup",
    usage: ".bahsetme [mesaj/getir/sil/yardım]",
  },
    async (message, match) => {
      // İzin kontrolü: Grup yöneticisi VEYA sahip/sudo
      const adminOk = await isAdmin(message);
      if (!message.fromOwner && !message.fromSudo && !adminOk) {
        return await message.sendReply("🔒 *Bu komut yalnızca grup yöneticilerine aittir!*");
      }

      const args = match[1]?.trim().split(" ");
      const subcommand = args?.[0]?.toLowerCase();
      const input = args?.slice(1).join(" ");
      // Gruba özel JID: grup içinde group JID, DM'de null (global)
      const targetJid = message.isGroup ? message.jid : null;

      if (!subcommand) {
        return await message.sendReply(
          `⚠️ *Lütfen bir alt komut belirtin!*\n\n` +
          `*Mevcut komutlar:*\n` +
          `• \`${handler}bahsetme mesaj\` - _Bu grup için bahsetme mesajını ayarla_\n` +
          `• \`${handler}bahsetme getir\` - _Mevcut bahsetme mesajını görüntüle_\n` +
          `• \`${handler}bahsetme sil\` - _Bu grubun bahsetme mesajını sil_\n` +
          `• \`${handler}bahsetme yardım\` - _Ayrıntılı yardımı göster_\n\n` +
          `ℹ️ _Her grup kendi özel bahsetme mesajını ayarlayabilir._`
        );
      }

      switch (subcommand) {
        case "sil": {
          const success = await deleteMentionReply(targetJid);
          if (success) {
            return await message.sendReply(
              targetJid
                ? "✅ *Bu grubun bahsetme mesajı başarıyla silindi!*\n\nℹ️ _Artık bot bu grupta etiketlenince varsayılan (global) mesaj kullanılacak ya da hiç yanıt verilmeyecek._"
                : "✅ *Global bahsetme mesajı başarıyla silindi!*"
            );
          } else {
            return await message.sendReply("❌ *Bahsetme mesajı silinemedi!*");
          }
        }

        case "getir":
        case "göster": {
          const mentionData = await getMentionReply(targetJid);
          if (!mentionData) {
            return await message.sendReply(
              `⚙️ *${targetJid ? "Bu grup için" : "Global"} bahsetme mesajı ayarlanmamış!*\n\n` +
              `*Kullanım:*\n• _Bir mesajı yanıtlayıp_ \`${handler}bahsetme mesaj\` _yazın_\n• _Veya metin mesajı için_ \`${handler}bahsetme mesaj <metin>\` _kullanın_`
            );
          }

          let responseText = `*${targetJid ? "Bu Grubun" : "Global"} Bahsetme Mesajı:*\n\n`;
          responseText += `*Tür:* \`${mentionData.type.toUpperCase()}\`\n`;
          if (mentionData.content) responseText += `*Mesaj:* _${mentionData.content}_\n`;
          if (mentionData.caption) responseText += `*Başlık:* _${mentionData.caption}_\n`;
          if (mentionData.url) responseText += `*Medya URL:* \`${mentionData.url}\`\n`;
          responseText += `*Ayarlandı:* _${new Date(mentionData.timestamp).toLocaleString("tr-TR")}_`;

          return await message.sendReply(responseText);
        }

        case "mesaj": {
          if (message.reply_message) {
            try {
              const replyMsg = message.reply_message;
              let mentionData = {
                type: "text",
                content: "",
                caption: "",
                url: "",
                timestamp: new Date().toISOString(),
              };

              if (
                replyMsg.image ||
                replyMsg.video ||
                replyMsg.audio ||
                replyMsg.document ||
                replyMsg.sticker
              ) {
                let mediaType = "document";
                if (replyMsg.image) mediaType = "image";
                else if (replyMsg.video) mediaType = "video";
                else if (replyMsg.audio) mediaType = "audio";
                else if (replyMsg.sticker) mediaType = "sticker";

                const downloadedFilePath = await replyMsg.download();
                const uploadResult = await uploadToCatbox(downloadedFilePath);

                try { fs.unlinkSync(downloadedFilePath); } catch (_) { }

                if (uploadResult && uploadResult.url) {
                  mentionData.type = mediaType;
                  mentionData.url = uploadResult.url;
                  mentionData.caption = censorBadWords(replyMsg.text || "");
                } else {
                  return await message.sendReply("⚠️ *Medya yüklenemedi! Lütfen tekrar deneyin.*");
                }
              } else if (replyMsg.text) {
                mentionData.type = "text";
                mentionData.content = censorBadWords(replyMsg.text);
              } else {
                return await message.sendReply("❌ *Bahsetme mesajı için desteklenmeyen mesaj türü!*");
              }

              const success = await setMentionReply(targetJid, mentionData);
              if (success) {
                return await message.sendReply(
                  `✅ *${targetJid ? "Bu grubun" : "Global"} bahsetme mesajı başarıyla ayarlandı!*\n\n` +
                  `ℹ️ _Tür:_ *${mentionData.type.toUpperCase()}*\n` +
                  `ℹ️ _İçerik:_ *${mentionData.content || mentionData.caption || "Medya dosyası"}*`
                );
              } else {
                return await message.sendReply("⚙ Bahsetme mesajı ayarlanamadı!");
              }
            } catch (error) {
              console.error("Etiket yanıtı ayarlama hatası:", error);
              return await message.sendReply("❌ *Bahsetme mesajı ayarlanırken bir hata oluştu! Lütfen tekrar deneyin.*");
            }
          }

          if (input && input.trim()) {
            const mentionData = {
              type: "text",
              content: censorBadWords(input.trim()),
              caption: "",
              url: "",
              timestamp: new Date().toISOString(),
            };

            const success = await setMentionReply(targetJid, mentionData);
            if (success) {
              return await message.sendReply(
                `✅ *${targetJid ? "Bu grubun" : "Global"} bahsetme mesajı başarıyla ayarlandı!*\n\nℹ️ _Mesaj:_ *${mentionData.content}*`
              );
            } else {
              return await message.sendReply("⚙ Bahsetme yanıtı ayarlanamadı!");
            }
          }

          return await message.sendReply(
            `💬 Lütfen 'mesaj' komutu için içerik sağlayın!\n\n*Kullanım:*\n• Herhangi bir mesajı yanıtlayın ve \`${handler}bahsetme mesaj\` yazın\n• Veya metin mesajı için \`${handler}bahsetme mesaj <metin>\` kullanın`
          );
        }

        case "yardım": {
          const helpText =
            `🏷 *Otomatik @Bahsetme (Etiket) Cevaplama Yardımı*\n\n` +
            `*Nedir?*\n` +
            `Bot bu grupta etiketlendiğinde otomatik olarak ayarlanan yanıtı gönderir.\n` +
            `Her grup kendi özel yanıtını ayarlayabilir — grup yöneticileri tarafından yönetilir.\n\n` +
            `*Komutlar:*\n` +
            `• \`${handler}bahsetme mesaj\` - Yanıtlamak istediğiniz mesajı yanıtlayıp yazın\n` +
            `• \`${handler}bahsetme mesaj <metin>\` - Metin mesajı ayarla\n` +
            `• \`${handler}bahsetme getir\` - Mevcut yanıtı görüntüle\n` +
            `• \`${handler}bahsetme sil\` - Bu grubun yanıtını sil\n\n` +
            `*Desteklenen Türler:*\n` +
            `• Metin mesajları\n• Görseller _(başlıklı)_\n• Videolar _(başlıklı)_\n` +
            `• Ses dosyaları\n• Çıkartmalar\n• Belgeler\n\n` +
            `*Örnekler:*\n` +
            `• \`${handler}bahsetme mesaj Efendim kanka?\`\n` +
            `• Bir resmi yanıtlayıp → \`${handler}bahsetme mesaj\`\n` +
            `• \`${handler}bahsetme getir\` - mevcut yanıtı görmek için\n` +
            `• \`${handler}bahsetme sil\` - yanıtı kaldırmak için\n\n` +
            `_ℹ Not: Medya dosyaları bulut depolama alanına yüklenir._`;

          return await message.sendReply(helpText);
        }

        default:
          return await message.sendReply(
            `❌ *Bilinmeyen alt komut:* \`${subcommand}\`\n\n` +
            `*Mevcut komutlar:*\n` +
            `• \`${handler}bahsetme mesaj\` - _Etiket yanıtını ayarla_\n` +
            `• \`${handler}bahsetme getir\` - _Mevcut etiket yanıtını görüntüle_\n` +
            `• \`${handler}bahsetme sil\` - _Etiket yanıtını sil_\n` +
            `• \`${handler}bahsetme yardım\` - _Yardımı göster_`
          );
      }
    }
  );

  Module({
    on: "text",
    fromMe: false,
  },
    async (message) => {
      try {
        if (
          !message.mention ||
          !Array.isArray(message.mention) ||
          message.mention.length === 0
        ) {
          return;
        }

        // Bot'un tüm olası JID varyantlarını topla (id, lid, device-suffix'li)
        const botIdRaw = message.client.user?.id || "";
        const botLidRaw = message.client.user?.lid || "";
        const botNums = new Set();
        if (botIdRaw) botNums.add(botIdRaw.split(":")[0].split("@")[0]);
        if (botLidRaw) botNums.add(botLidRaw.split(":")[0].split("@")[0]);

        let isMentioned = false;

        for (const mentionedJid of message.mention) {
          const mentionedNum = mentionedJid?.split(":")[0]?.split("@")[0];

          if (mentionedNum && botNums.has(mentionedNum)) {
            isMentioned = true;
            break;
          }

          if (isSudoUser(mentionedJid)) {
            isMentioned = true;
            break;
          }
        }

        if (!isMentioned) return;

        // Gruba özel yanıtı getir; yoksa global fallback; ikisi de yoksa sessiz geç
        const mentionData = await getMentionReply(message.jid);
        if (!mentionData) return;

        switch (mentionData.type) {
          case "text":
            if (mentionData.content) {
              await message.sendReply(censorBadWords(mentionData.content));
            }
            break;

          case "image":
            if (mentionData.url) {
              await message.sendReply({ url: mentionData.url }, "image", {
                caption: censorBadWords(mentionData.caption || ""),
              });
            }
            break;

          case "video":
            if (mentionData.url) {
              await message.sendReply({ url: mentionData.url }, "video", {
                caption: censorBadWords(mentionData.caption || ""),
              });
            }
            break;

          case "audio":
            if (mentionData.url) {
              await message.sendReply({ url: mentionData.url }, "audio", {
                ptt: true,
                mimetype: "audio/mpeg",
              });
            }
            break;

          case "sticker":
            if (mentionData.url) {
              await message.sendReply({ url: mentionData.url }, "sticker");
            }
            break;

          case "document":
            if (mentionData.url) {
              await message.sendReply({ url: mentionData.url }, "document", {
                caption: censorBadWords(mentionData.caption || ""),
              });
            }
            break;
        }
      } catch (error) {
        console.error("Otomatik etiket yanıtında hata:", error);
      }
    }
  );
})();



// ==========================================
// FILE: message-stats.js
// ==========================================
(function () {
  const { mentionjid, isAdmin } = require("./utils");
  const { ADMIN_ACCESS } = require("../config");
  const { Module } = require("../main");
  const {
    fetchFromStore,
    getTopUsers,
    getGlobalTopUsers,
    incrementStats,
  } = require("../core/store");
  const fs = require("fs");
  const path = require("path");


  function timeSince(date, lang = "tr") {
    if (!date) return lang === "tr" ? "Hiç" : "Never";
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    let interval = Math.floor(seconds / 31536000);
    if (interval >= 1) return lang == "tr" ? `${interval} yıl önce` : `${interval} years ago`;
    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) return lang == "tr" ? `${interval} ay önce` : `${interval} months ago`;
    interval = Math.floor(seconds / 604800);
    if (interval >= 1) return lang == "tr" ? `${interval} hafta önce` : `${interval} weeks ago`;
    interval = Math.floor(seconds / 86400);
    if (interval >= 1) return lang == "tr" ? `${interval} gün önce` : `${interval} days ago`;
    interval = Math.floor(seconds / 3600);
    if (interval >= 1) return lang == "tr" ? `${interval} saat önce` : `${interval} hours ago`;
    interval = Math.floor(seconds / 60);
    if (interval >= 1) return lang == "tr" ? `${interval} dakika önce` : `${interval} minutes ago`;
    return lang == "tr" ? `az önce` : `just now`;
  }

  function parseDuration(number, unit) {
    const num = parseInt(number);
    if (isNaN(num)) return null;
    switch (unit) {
      case "gün":
        return num * 24 * 60 * 60 * 1000;
      case "hafta":
        return num * 7 * 24 * 60 * 60 * 1000;
      case "ay":
        return num * 30 * 24 * 60 * 60 * 1000;
      case "yıl":
        return num * 365 * 24 * 60 * 60 * 1000;
      default:
        return null;
    }
  }


  // Ban audio cached at first use — eliminates repeated sync disk I/O on every ban.
  let _banAudioCacheBot = null;
  let _banAudioMissingBot = false;
  async function sendBanAudio(message) {
    if (_banAudioMissingBot) return;
    try {
      if (!_banAudioCacheBot) {
        const audioPath = path.join(__dirname, "utils", "sounds", "Ban.mp3");
        try {
          _banAudioCacheBot = await fs.promises.readFile(audioPath);
        } catch (e) {
          _banAudioMissingBot = true;
          console.error("Ban sesi dosyası bulunamadı:", audioPath);
          return;
        }
      }
      // Buffer olarak gönder: bot.js interceptor'ı OGG/Opus'a dönüştürebilsin
      await message.sendMessage(_banAudioCacheBot, "audio", { ptt: true });
    } catch (err) {
      console.error("Ban sesini gönderirken hata:", err?.message);
    }
  }

  function parseDurationInput(duration) {
    const regex = /^(\d+)\s*(gün|hafta|ay|yıl|d|w|m|y)$/i;
    const match = String(duration || "").trim().match(regex);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unitRaw = match[2].toLowerCase();
    const unitMap = { d: "gün", w: "hafta", m: "ay", y: "yıl" };
    const unit = unitMap[unitRaw] || unitRaw;
    const ms = parseDuration(value, unit);
    if (!ms) return null;
    return new Date(Date.now() - ms);
  }

  Module({
    pattern: "mesajlar ?(.*)",
    fromMe: false,
    desc: "Grup üyelerinin gönderdiği toplam mesaj sayılarını ve mesaj türü dağılımlarını liste halinde sunar.",
    usage: ".mesajlar (mesaj gönderen tüm üyeler)\n.mesajlar @etiket (belirli bir üye)",
    use: "araçlar",
  },
    async (message, match) => {
      if (!message.isGroup)
        return await message.sendReply("⚠️ *Bu komut sadece gruplarda kullanılabilir!*");

      var users = (await message.client.groupMetadata(message.jid)).participants.map((e) => e.id);
      if (message.mention?.[0]) users = message.mention;
      if (message.reply_message && !message.mention.length)
        users = [message.reply_message?.jid];

      let userStats = await fetchFromStore(message.jid);
      let usersWithMessages = [];

      // JID normalleştirme: LID ve PN formatlarını eşleştirmek için
      // device suffix'i (":XX") kaldır ve bare numara ile karşılaştır
      const normalizeJid = (jid) => (jid || "").split(":")[0].split("@")[0];

      for (let user of users) {
        const userBare = normalizeJid(user);
        // Hem tam JID hem de normalize edilmiş numara ile eşleşme dene
        let userStat = userStats.find((stat) => {
          if (stat.userJid === user) return true;
          return normalizeJid(stat.userJid) === userBare;
        });
        if (userStat && userStat.totalMessages > 0) {
          usersWithMessages.push({
            jid: user,
            stat: userStat,
          });
        }
      }

      usersWithMessages.sort((a, b) => b.stat.totalMessages - a.stat.totalMessages);

      if (usersWithMessages.length === 0) {
        return await message.sendReply("❌ *Veritabanında mesaj gönderen üye bulunamadı.*");
      }

      let final_msg = `👥 *${usersWithMessages.length} üye tarafından gönderilen mesajlar*
🏆 _Mesaj sayısına göre sıralanmış (en yüksekten en düşüğe)_

`;
      let mentionsList = [];

      for (let i = 0; i < usersWithMessages.length; i++) {
        let userObj = usersWithMessages[i];
        let user = userObj.jid;
        let userStat = userObj.stat;
        let count = userStat.totalMessages;
        let name = userStat.User?.name?.replace(/[\r\n]+/gm, "") || "Bilinmiyor";
        let lastMsg = timeSince(userStat.lastMessageAt);
        let types_msg = "\n";

        if (userStat.textMessages > 0)
          types_msg += `💬 Metin: *${userStat.textMessages}*\n`;
        if (userStat.imageMessages > 0)
          types_msg += `🖼 Görsel: *${userStat.imageMessages}*\n`;
        if (userStat.videoMessages > 0)
          types_msg += `🎥 Video: *${userStat.videoMessages}*\n`;
        if (userStat.audioMessages > 0)
          types_msg += `🎙 Ses: *${userStat.audioMessages}*\n`;
        if (userStat.stickerMessages > 0)
          types_msg += `🎨 Çıkartma: *${userStat.stickerMessages}*\n`;
        if (userStat.otherMessages > 0)
          types_msg += `📎 Diğer: *${userStat.otherMessages}*\n`;

        mentionsList.push(user);
        final_msg += `${i + 1}. 👤 Üye: @${user.split("@")[0]}\n`;
        final_msg += `📝 İsim: *${name}*\n`;
        final_msg += `📊 Toplam mesaj: *${count}*\n`;
        final_msg += `🕒 Son mesaj: *${lastMsg}*${types_msg}\n`;
      }

      return await message.client.sendMessage(message.jid, {
        text: final_msg,
        mentions: mentionsList,
      });
    }
  );


  Module({
    pattern: "üyetemizle ?(.*)",
    fromMe: false,
    desc: "Belirtilen süre boyunca mesaj atmayan üyeleri listeler veya çıkarır.",
    usage:
      ".üyetemizle 30 gün | .üyetemizle 2 hafta | .üyetemizle 3 ay | .üyetemizle 1 yıl\n\n" +
      "Komutun sonuna 'çıkar' ekleyerek üyeleri gruptan atabilirsiniz.",
    use: "araçlar",
  },
    async (message, match) => {
      try {
        if (!message.isGroup) {
          return await message.sendReply("❌ *Bu komut sadece grup sohbetlerinde kullanılabilir!*");
        }
        const admin = await isAdmin(message);
        if (!admin) {
          return await message.sendReply("🙁 *Üzgünüm! Öncelikle yönetici olmalısınız.*");
        }
        if (!match[1]?.trim()) {
          return await message.sendReply(
            "⚠️ *Lütfen şu şekillerde kullanınız:*\n" +
            ".üyetemizle 30 gün\n" +
            ".üyetemizle 2 hafta\n" +
            ".üyetemizle 3 ay\n" +
            ".üyetemizle 1 yıl\n" +
            "🧹 _(Üyeleri çıkarmak için komut sonuna *çıkar* ekleyebilirsiniz.)_"
          );
        }
        const args = (match[1] || "").trim().split(/\s+/);
        const durationStr = args[0];
        const durationUnit = args[1]?.toLowerCase();
        const shouldKick = args.includes("çıkar");
        const durationMs = parseDuration(durationStr, durationUnit);
        if (!durationMs) {
          return await message.sendReply(
            "❌ *Geçersiz süre formatı!* \n\n" +
            "💬 _Örnekler:_\n" +
            "*.üyetemizle 30 gün*\n" +
            "*.üyetemizle 2 hafta*\n" +
            "*.üyetemizle 3 ay*\n" +
            "*.üyetemizle 1 yıl çıkar*"
          );
        }
        const cutoffDate = new Date(Date.now() - durationMs);
        const groupMetadata = await message.client.groupMetadata(message.jid);
        const participants = groupMetadata.participants.map((p) => p.id);
        const admins = groupMetadata.participants.filter((p) => p.admin !== null).map((p) => p.id);
        const userStats = await fetchFromStore(message.jid);

        // JID normalleştirme: LID ve PN formatlarını eşleştirmek için
        const normalizeJid = (jid) => (jid || "").split(":")[0].split("@")[0];
        // Admin JID'lerini normalize et — LID formatındaki admin'ler de doğru tanınsın
        const adminBareSet = new Set(admins.map(a => normalizeJid(a)));

        let oldestMessageDate = null;
        if (userStats.length > 0) {
          const oldest = userStats.reduce((oldest, current) => {
            const currDate = new Date(current.lastMessageAt || current.createdAt);
            const oldDate = new Date(oldest.lastMessageAt || oldest.createdAt);
            return currDate < oldDate ? current : oldest;
          });
          oldestMessageDate = new Date(oldest.lastMessageAt || oldest.createdAt);
        }
        const dataWarning = oldestMessageDate && cutoffDate < oldestMessageDate;
        let inactiveMembers = [];
        for (const user of participants) {
          // Admin kontrolü: hem tam JID hem normalize edilmiş karşılaştır
          if (admins.includes(user) || adminBareSet.has(normalizeJid(user))) continue;
          const userBare = normalizeJid(user);
          const userStat = userStats.find((stat) => {
            if (stat.userJid === user) return true;
            return normalizeJid(stat.userJid) === userBare;
          });
          if (!userStat || !userStat.lastMessageAt) {
            inactiveMembers.push({ jid: user, lastMessage: "*Hiç mesaj yok*", totalMessages: userStat?.totalMessages || 0 });
            continue;
          }
          const lastMsgDate = new Date(userStat.lastMessageAt);
          if (lastMsgDate < cutoffDate) {
            inactiveMembers.push({ jid: user, lastMessage: timeSince(userStat.lastMessageAt, "tr"), totalMessages: userStat.totalMessages });
          }
        }
        if (shouldKick) {
          // Bot'un yönetici olup olmadığını kontrol et
          const botJid = message.client.user.id.split(":")[0] + "@s.whatsapp.net";
          const botIsAdmin = admins.some(a => normalizeJid(a) === normalizeJid(botJid));
          if (!botIsAdmin) {
            return await message.sendReply("❌ *Üzgünüm! Üyeleri çıkarabilmesi için botun yönetici olması gerekiyor.*");
          }
          if (inactiveMembers.length === 0) {
            return await message.sendReply("😎 _Belirtilen süre zarfında çıkarılacak inaktif üye bulunamadı._");
          }
          const kickMsg =
            `⚠️ *Dikkat! Bu işlem geri alınamaz.* \n\n` +
            `🧹 _Toplam_ *${inactiveMembers.length}* _üye_ *${durationStr} ${durationUnit}* _boyunca sessiz kaldıkları için çıkarılacaklar._\n\n` +
            `ℹ️ _5 saniye içinde başlıyoruz. Dua etmeye başlayın..._ 🥲`;
          await message.client.sendMessage(message.jid, { text: kickMsg, mentions: inactiveMembers.map((m) => m.jid) });
          await sendBanAudio(message);
          await new Promise((r) => setTimeout(r, 5000));
          let kickCount = 0;
          for (let i = 0; i < Math.min(inactiveMembers.length, 20); i++) {
            const member = inactiveMembers[i];
            try {
              await new Promise((r) => setTimeout(r, 3000));
              await message.client.groupParticipantsUpdate(message.jid, [member.jid], "remove");
              kickCount++;
              if (kickCount % 5 === 0) {
                await message.send(`⏳ _Şu ana kadar ${kickCount}/${inactiveMembers.length} üye gruptan çıkarıldı..._`);
              }
            } catch (err) {
              console.error("Üye çıkarılırken hata:", err);
              await message.send(`❌ *${member.jid.split("@")[0]} çıkarılırken bir sorun oluştu!*`);
            }
          }
          return await message.send(`✅ *Toplam ${kickCount}/${inactiveMembers.length} inaktif üye gruptan çıkarıldı!*`);
        }
        if (inactiveMembers.length === 0) {
          return await message.sendReply(`📭 _Belirtilen süre (${durationStr} ${durationUnit}) için inaktif üye bulunamadı._`);
        }
        let responseMsg =
          `ℹ️ *Son _${durationStr} ${durationUnit}_ boyunca mesaj atmayan üyeler;* _(${inactiveMembers.length})_\n` +
          `_(Kendilerine birer fatiha okuyalım)_ 🥲\n\n`;
        if (dataWarning) {
          responseMsg +=
            `⚠️ *Dikkat! Veritabanı yalnızca ${timeSince(oldestMessageDate, "tr")}'den itibaren kayıt tutuyor.* \n\n` +
            `ℹ️ _Bu tarihten önce aktif olanlar da inaktif sayılmış olabilir._\n\n`;
        }
        for (let i = 0; i < inactiveMembers.length; i++) {
          const member = inactiveMembers[i];
          responseMsg += `${i + 1}. @${member.jid.split("@")[0]}\n`;
          responseMsg += `   _Son mesaj:_ ${member.lastMessage}\n`;
          responseMsg += `   _Toplam mesaj:_ ${member.totalMessages}\n\n`;
        }
        return await message.client.sendMessage(message.jid, {
          text: responseMsg,
          mentions: inactiveMembers.map((m) => m.jid),
        });
      } catch (err) {
        console.error("üyetemizle komutunda hata:", err);
        return await message.sendReply("⚠️ *Bir hata oluştu. Lütfen tekrar deneyin.*");
      }
    }
  );


  Module({
    pattern: "users ?(.*)",
    fromMe: true,
    desc: "Tüm sohbetlerde veya mevcut grupta en çok mesaj gönderen lider kullanıcıları sıralı olarak listeler.",
    usage: ".users | .users [sayı] | .users genel [sayı]",
    use: "araçlar",
  },
    async (message, match) => {
      let adminAccesValidated =
        message.isGroup ? await isAdmin(message) : false;
      if (message.fromOwner || adminAccesValidated) {
        let limit = 10;
        let isGlobal = false;

        if (match[1]) {
          const args = (match[1] || "").trim().split(" ");

          if (args.includes("genel")) {
            isGlobal = true;

            const limitArg = args.find(
              (arg) => arg !== "genel" && !isNaN(parseInt(arg))
            );
            if (limitArg) {
              const parsedLimit = parseInt(limitArg);
              if (parsedLimit > 0 && parsedLimit <= 50) {
                limit = parsedLimit;
              } else if (parsedLimit > 50) {
                return await message.sendReply("❌ *Maksimum sınır 50 kullanıcıdır!*");
              }
            }
          } else {
            const parsedLimit = parseInt(args[0]);
            if (parsedLimit && parsedLimit > 0 && parsedLimit <= 50) {
              limit = parsedLimit;
            } else if (parsedLimit > 50) {
              return await message.sendReply("❌ *Maksimum sınır 50 kullanıcıdır!*");
            } else if (parsedLimit <= 0) {
              return await message.sendReply("⚠️ *Sınır pozitif bir sayı olmalıdır!*"
              );
            }
          }
        }

        if (!message.isGroup && !match[1]?.includes("chat")) {
          isGlobal = true;
        }

        try {
          let topUsers;
          let scopeText;

          if (isGlobal) {
            topUsers = await getGlobalTopUsers(limit);
            scopeText = "genel";
          } else {
            topUsers = await getTopUsers(message.jid, limit);
            scopeText = message.isGroup ? "group" : "chat";
          }

          if (topUsers.length === 0) {
            return await message.sendReply(
              `📊 _${scopeText} istatistikleri için veritabanında kullanıcı verisi bulunamadı._`
            );
          }

          let responseMsg = `🏆 *Mesaj sayısına göre en iyi ${topUsers.length} ${scopeText} kullanıcı*\n\n`;

          for (let i = 0; i < topUsers.length; i++) {
            const user = topUsers[i];
            const rank = i + 1;
            const name = user.name?.replace(/[\r\n]+/gm, "") || "Bilinmiyor";
            const lastMessage = timeSince(user.lastMessageAt);

            responseMsg += `*${rank}.* @${(user.userJid || user.jid || "").split("@")[0]}\n`;
            responseMsg += `   _İsim:_ ${name}\n`;
            responseMsg += `   _Mesajlar:_ ${user.totalMessages}${isGlobal ? " (tüm sohbetlerde)" : ""
              }\n`;
            responseMsg += `   _Son görülme:_ ${lastMessage}\n\n`;
          }

          if (isGlobal) {
            responseMsg += `\n_💡 İpucu: Sadece mevcut sohbet istatistikleri için \`.users chat\` kullanın._`;
          } else if (message.isGroup) {
            responseMsg += `\n_💡 İpucu: Tüm sohbetlerdeki genel istatistikler için \`.users global\` kullanın._`;
          }

          const mentions = topUsers.map((user) => user.userJid || user.jid).filter(Boolean);

          return await message.client.sendMessage(message.jid, {
            text: responseMsg,
            mentions: mentions,
          });
        } catch (error) {
          console.error("Kullanıcılar komutunda hata:", error);
          return await message.sendReply("⚠️ *Kullanıcı verisi alınamadı. Lütfen tekrar deneyin.*"
          );
        }
      }
    }
  );

  Module({
    on: "message",
    fromMe: false, // Track others
    desc: "Mesaj istatistiklerini günceller.",
  },
    async (message) => {
      try {
        let type = "text";
        if (message.image) type = "image";
        else if (message.video) type = "video";
        else if (message.audio) type = "audio";
        else if (message.sticker) type = "sticker";
        else if (!message.text) type = "other";

        await incrementStats(message.jid, message.sender, type);
      } catch (err) {
        console.error("İstatistik artırma hatası:", err);
      }
    }
  );

  Module({
    on: "text",
    fromMe: true, // Track self (pattern matching for commands usually excludes this, but 'on: message'/text catches it)
  },
    async (message) => {
      // Only track if it's NOT a command (to avoid double counting with patterns, 
      // although commands usually have their own logic. But here we want to track all)
      try {
        let type = "text";
        if (message.image) type = "image";
        else if (message.video) type = "video";
        else if (message.audio) type = "audio";
        else if (message.sticker) type = "sticker";
        else if (!message.text) type = "other";

        await incrementStats(message.jid, message.sender, type);
      } catch (err) {
        console.error("İstatistik artırma hatası (self):", err);
      }
    }
  );
})();

