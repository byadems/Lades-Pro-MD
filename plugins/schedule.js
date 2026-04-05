const { Module } = require("../main");
const { scheduledMessages } = require("./utils/db/schedulers");
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

Module(
  {
    pattern: "planla ?(.*)",
    fromMe: false,
    desc: "⏰ Mesaj planla - Gruba veya özele zamanlanmış mesaj gönder",
    use: "tools",
  },
  async (m, match) => {
    if (!m.reply_message) {
      return await m.sendReply(
        "⚠️ _Planlamak istediğiniz mesaja yanıt veriniz._\n\n*📋 Kullanımı:*\n• `.planla @üye <zaman>` (gruba etiketle ve gönder)\n• `.planla dm @üye <zaman>` (özeline gönder)\n\n*⏱️ Zaman formatları:*\n• `2 saat 30 dakika` veya `2saat30dk` veya `2s30dk`\n• `1 gün` veya `1g`\n• `30 dakika` veya `30dk` veya `30 dk`\n• `5 saniye` veya `5sn`\n• `14:30` veya `14.30`\n• `25.12.2026 11:00`"
      );
    }

    if (!match[1]) {
      return await m.sendReply(
        "⚠️ _Lütfen üye etiketleyip zaman belirtiniz._\n\n*💡 Örnek:*\n• `.planla @üye 2 saat`\n• `.planla dm @üye 30 dakika`"
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
        "⚠️ _Lütfen bir üyeyi etiketleyin!_\n\n*💡 Örnek:*\n• `.planla @üye 2 saat`\n• `.planla dm @üye 30 dakika`"
      );
    }

    targetJid = mentionedUser;
    input = input.replace(/@\d+/g, "").trim();

    const timeStr = input.trim();
    if (!timeStr) {
      return await m.sendReply(
        "⚠️ _Lütfen zaman belirtin!_\n\n*💡 Örnek:*\n• `.planla @üye 2 saat`\n• `.planla dm @üye 30 dakika`"
      );
    }

    const scheduleTime = parseTime(timeStr);
    if (!scheduleTime) {
      return await m.sendReply(
        "❌ _Geçersiz zaman formatı_\n\n*⏱️ Desteklenen formatlar:*\n• `2 saat 30 dakika`, `2saat30dk`, `2s30dk`\n• `1 gün`, `1g`\n• `30 dakika`, `30dk`, `30 dk`\n• `5 saniye`, `5sn`\n• `14:30`, `14.30`\n• `25.12.2024 14:30`"
      );
    }

    const originalTime = moment(scheduleTime).add(1, "minute").toDate();
    if (originalTime <= new Date()) {
      return await m.sendReply("⚠️ _Planlama zamanı gelecek zaman olmalıdır._");
    }

    const minTime = moment().add(2, "minutes").toDate();
    if (originalTime < minTime) {
      return await m.sendReply(
        "⚠️ _Minimum planlama süresi 2 dakikadır. Lütfen en az 2 dakika sonrası için planlayın._"
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

      const targetInfo = isDM ? "📩 özelden" : "💬 gruba (⏰ etiketli)";

      await m.sendReply(
        `✅ *Mesaj başarıyla planlandı!*\n\n📅 *Tarih:* ${formattedTime}\n⏰ *Kalan süre:* ${timeFromNow}\n📱 *Hedef:* ${targetInfo}\n👤 *Üye:* @${targetJid.split("@")[0]}`,
        { mentions: [targetJid] }
      );
    } catch (error) {
      console.error("Mesaj planlama hatası:", error);
      await m.sendReply("❌ _Mesaj planlanırken hata oluştu. Lütfen tekrar deneyin._");
    }
  }
);

Module(
  {
    pattern: "plandurum ?(.*)",
    fromMe: false,
    desc: "📋 Planlanan tüm mesajları listeler",
    use: "tools",
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
        (a, b) => a.scheduleTime.getTime() - b.scheduleTime.getTime()
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
      await m.sendReply("❌ _Planlanan mesajlar getirilemedi_");
    }
  }
);

Module(
  {
    pattern: "plansil ?(.*)",
    fromMe: false,
    desc: "🗑️ Planlanan mesajı ID ile iptal eder",
    use: "tools",
    usage: ".plansil <id>",
  },
  async (m, match) => {
    if (!match[1]) {
      return await m.sendReply(
        "⚠️ _Lütfen iptal edilecek mesajın ID'sini girin._\n\n*💡 Kullanım:* `.plansil <id>`\n\n_Planlanan mesajları görmek için `.plandurum` yazınız._"
      );
    }

    const messageId = parseInt(match[1].trim());
    if (isNaN(messageId)) {
      return await m.sendReply("⚠️ _Lütfen geçerli bir mesaj ID'si girin!_");
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
      await m.sendReply("❌ _Planlı mesaj iptal edilemedi!_");
    }
  }
);

module.exports = {
  isValidJID,
  parseTime,
  createMessageObject,
};
