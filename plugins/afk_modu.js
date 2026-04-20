const { Module } = require("../main");
const { censorBadWords } = require("./utils");
const config = require("../config");
const { setVar, getVar, delVar } = require('./yonetim_araclari');
const afkCache = new Map();

async function initAFKCache() {
  try {
    // Clear the persistent AFK data on startup to avoid automatic 'Away' mode entry
    afkCache.clear();
    await setVar("AFK_DATA", "{}");
    console.log("[AFK] Önbellek ve kalıcı veriler sıfırlandı.");
  } catch (error) {
    console.error("AFK önbelleği sıfırlanamadı:", error);
  }
}

initAFKCache();

function timeSince(date) {
  if (!date) return "Hiç";
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + " yıl önce";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + " ay önce";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + " gün önce";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + " saat önce";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + " dakika önce";
  return Math.floor(seconds) + " saniye önce";
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}g ${hours % 24}s ${minutes % 60}dk`;
  } else if (hours > 0) {
    return `${hours}s ${minutes % 60}dk`;
  } else if (minutes > 0) {
    return `${minutes}dk ${seconds % 60}sn`;
  } else {
    return `${seconds}sn`;
  }
}

async function saveAFKData() {
  try {
    const afkData = {};
    for (const [userJid, userData] of afkCache.entries()) {
      afkData[userJid] = {
        reason: userData.reason,
        setAt: userData.setAt.toISOString(),
        lastSeen: userData.lastSeen.toISOString(),
        messageCount: userData.messageCount,
      };
    }
    await setVar("AFK_DATA", JSON.stringify(afkData));
  } catch (error) {
    console.error("AFK verisi kaydedilemedi:", error);
  }
}

async function setAFK(userJid, reason = "Şu anda klavyeden uzaktayım") {
  const now = new Date();
  const afkData = {
    reason: reason,
    setAt: now,
    lastSeen: now,
    messageCount: 0,
  };

  afkCache.set(userJid, afkData);

  await saveAFKData();
}

async function removeAFK(userJid) {
  const afkData = afkCache.get(userJid);
  afkCache.delete(userJid);

  await saveAFKData();

  return afkData;
}

async function updateLastSeen(userJid) {
  const afkData = afkCache.get(userJid);
  if (afkData) {
    afkData.lastSeen = new Date();

    await saveAFKData();
  }
}

async function incrementMessageCount(userJid) {
  const afkData = afkCache.get(userJid);
  if (afkData) {
    afkData.messageCount++;

    await saveAFKData();
  }
}

function isAFK(userJid) {
  return afkCache.has(userJid);
}

function getAFKData(userJid) {
  return afkCache.get(userJid);
}

Module({
  pattern: "uzakta ?(.*)",
  fromMe: false,
  desc: "AFK (Uzakta) modunu başlatarak sizi etiketleyenlere veya size mesaj atanlara otomatik bilgi verir.",
  usage: ".uzakta [sebep] - _İsteğe bağlı sebeple AFK ol_\n.uzakta durum - _Mevcut üyelerin durumunu kontrol eder_\n.uzakta list - _Tüm AFK kullanıcıları göster_",
  use: "genel",
},
  async (message, match) => {
    const userJid = message.sender;
    const input = match[1]?.trim();

    if (input?.toLowerCase() === "durum") {
      if (afkCache.size === 0) {
        return await message.sendReply("ℹ️ _Şu anda AFK olan herhangi bir üye bulunmuyor._");
      }

      let afkList = `*_🌙 AFK Üye Listesi (${afkCache.size})_*\n\n`;
      let count = 1;

      for (const [jid, data] of afkCache.entries()) {
        const timeAFK = formatDuration(
          Date.now() - new Date(data.setAt).getTime()
        );
        const lastSeen = timeSince(data.lastSeen);
        afkList += `${count}. @${jid.split("@")[0]}\n`;
        afkList += `   📝 _Sebep:_ \`${data.reason}\`\n`;
        afkList += `   ⏰ _AFK süresi:_ \`${timeAFK}\`\n`;
        afkList += `   👁️ _Son görülme:_ \`${lastSeen}\`\n`;
        afkList += `   💬 _Alınan mesajlar:_ \`${data.messageCount}\`\n\n`;
        count++;
      }

      return await message.sendMessage(afkList, "text", {
        mentions: Array.from(afkCache.keys()),
      });
    }

    if (isAFK(userJid)) {
      if (!input) {
        const afkData = getAFKData(userJid);
        const timeAFK = formatDuration(
          Date.now() - new Date(afkData.setAt).getTime()
        );
        const lastSeen = timeSince(afkData.lastSeen);

        return await message.sendReply(`🌙 *Şu anda AFK modundasınız!*\n\n` +
          `📝 _Sebep:_ \`${afkData.reason}\`\n` +
          `⏰ _AFK süresi:_ \`${timeAFK}\`\n` +
          `👁️ _Son görülme:_ \`${lastSeen}\`\n` +
          `💬 _Alınan mesajlar:_ \`${afkData.messageCount}\`\n\n` +
          `ℹ️ _Çevrimiçi olmak için herhangi bir mesaj yazın._`
        );
      } else {
        const censoredInput = censorBadWords(input);
        await setAFK(userJid, censoredInput);
        return await message.sendReply(`✅ *AFK nedeni başarıyla güncellendi!*\n\n` +
          `📝 _Yeni sebep:_ \`${censoredInput}\`\n\n` +
          `ℹ️ _Biri size mesaj attığında veya sizi etiketlediğinde otomatik yanıt vereceğim._`
        );
      }
    } else {
      const reason = censorBadWords(input || "Şu anda klavyeden uzaktayım");
      await setAFK(userJid, reason);
 
       return await message.sendReply(`✅ *AFK modu başarıyla aktif edildi!*\n\n` +
         `📝 _Sebep:_ \`${reason}\`\n` +
         `⏰ _Başlangıç:_ \`${new Date().toLocaleTimeString('tr-TR', { hour12: false })}\`\n\n` +
         `ℹ️ _Biri size mesaj attığında veya sizi etiketlediğinde otomatik yanıt vereceğim._\n` +
         `ℹ️ _Çevrimiçi olmak için herhangi bir mesaj yazın._`
       );
    }
  }
);

Module({
  on: "message",
  fromMe: false,
},
  async (message) => {
    try {
      const senderJid = message.sender;
      const chatJid = message.jid;
      const isGroup = message.isGroup;
      const isDM = !isGroup;

      if (isAFK(senderJid)) {
        const text = message.text || "";
        const prefixes = (config.PREFIX || ".").split("");
        const isCommand = prefixes.some(p => text.startsWith(p));

        const afkData = await removeAFK(senderJid);
        if (false) {
          const timeAFK = formatDuration(
            Date.now() - new Date(afkData.setAt).getTime()
          );
          const welcomeBack =
            `🌅 *Tekrar hoş geldiniz!*\n\n` +
            `⏰ _AFK süreniz:_ \`${timeAFK}\`\n` +
            `💬 _Alınan mesajlar:_ \`${afkData.messageCount}\`\n` +
            `📝 _Sebebiniz:_ \`${afkData.reason}\``;
 
           await message.sendReply(welcomeBack);
         }
        return;
      }

      if (message.reply_message && message.reply_message.text) {
        const repliedText = message.reply_message.text.toLowerCase();
        if (
          repliedText.includes("şu anda afk") ||
          repliedText.includes("🌙")
        ) {
          return;
        }
      }

      if (isGroup && message.mention && message.mention.length > 0) {
        for (const mentionedJid of message.mention) {
          if (isAFK(mentionedJid)) {
            const afkData = getAFKData(mentionedJid);
            const timeAFK = formatDuration(
              Date.now() - new Date(afkData.setAt).getTime()
            );
            const lastSeen = timeSince(afkData.lastSeen);

            await incrementMessageCount(mentionedJid);

            const afkReply =
              `🌙 * @${mentionedJid.split("@")[0]} şu anda AFK! *\n\n` +
              `📝 _Sebep:_ \`${afkData.reason}\`\n` +
              `⏰ _AFK süresi:_ \`${timeAFK}\`\n` +
              `👁️ _Son görülme:_ \`${lastSeen}\`\n` +
              `💬 _Alınan mesajlar:_ \`${afkData.messageCount + 1}\``;

            await message.sendMessage(afkReply, "text", {
              quoted: message.data,
              mentions: [mentionedJid],
            });
          }
        }
      }

      if (isDM) {
        const botOwnerJid = message.client.user?.lid?.split(":")[0] + "@lid";
        if (botOwnerJid && isAFK(botOwnerJid)) {
          const afkData = getAFKData(botOwnerJid);
          const timeAFK = formatDuration(
            Date.now() - new Date(afkData.setAt).getTime()
          );
          const lastSeen = timeSince(afkData.lastSeen);

          await incrementMessageCount(botOwnerJid);

          const afkReply =
            `🌙 *Bot geliştiricisi şu anda AFK!*\n\n` +
            `📝 _Sebep:_ \`${afkData.reason}\`\n` +
            `⏰ _AFK süresi:_ \`${timeAFK}\`\n` +
            `👁️ _Son görülme:_ \`${lastSeen}\`\n` +
            `💬 _Alınan mesajlar:_ \`${afkData.messageCount + 1}\`\n\n` +
            `ℹ️ _Mesajınız kaydedildi. Müsait olduğunda size dönecektir._`;

          await message.sendReply(afkReply);
        }
      }

      if (isGroup && message.reply_message && message.reply_message.jid) {
        const repliedToJid = message.reply_message.jid;
        if (isAFK(repliedToJid)) {
          const afkData = getAFKData(repliedToJid);
          const timeAFK = formatDuration(
            Date.now() - new Date(afkData.setAt).getTime()
          );
          const lastSeen = timeSince(afkData.lastSeen);

          await incrementMessageCount(repliedToJid);

          const afkReply =
            `🌙 * @${repliedToJid.split("@")[0]} şu anda AFK! *\n\n` +
            `📝 _Sebep:_ \`${afkData.reason}\`\n` +
            `⏰ _AFK süresi:_ \`${timeAFK}\`\n` +
            `👁️ _Son görülme:_ \`${lastSeen}\`\n` +
            `💬 _Alınan mesajlar:_ \`${afkData.messageCount + 1}\``;

          await message.sendMessage(afkReply, "text", {
            quoted: message.data,
            mentions: [repliedToJid],
          });
        }
      }
    } catch (error) {
      console.error("AFK otomatik yanıt işleyicisinde hata:", error);
    }
  }
);

Module({
  on: "message",
  fromMe: false,
},
  async (message) => {
    try {
      const senderJid = message.sender;

      if (isAFK(senderJid)) {
        await updateLastSeen(senderJid);
      }
    } catch (error) {
      console.error("AFK son görülme güncellenemedi:", error);
    }
  }
);

module.exports = {
  setAFK,
  removeAFK,
  isAFK,
  getAFKData,
  updateLastSeen,
  incrementMessageCount,
  saveAFKData,
};
