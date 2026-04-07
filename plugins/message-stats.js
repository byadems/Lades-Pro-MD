const { mentionjid, isAdmin } = require("./utils");
const { getString } = require("./utils/lang");
const Lang = getString("group");
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


async function sendBanAudio(message) {
  const audioPath = path.join(__dirname, "utils", "sounds", "Ban.mp3");
  try {
    if (!fs.existsSync(audioPath)) {
      console.error("Ban sesi dosyası bulunamadı:", audioPath);
      return;
    }
    const stream = fs.createReadStream(audioPath);
    try {
      await message.send({ stream }, "audio");
    } finally {
      stream.destroy();
    }
  } catch (err) {
    console.error("Ban sesini gönderirken hata:", err);
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
  use: "tools",
},
  async (message, match) => {
    if (!message.isGroup)
      return await message.sendReply("⚠ _Bu komut sadece gruplarda kullanılabilir!_");

    var users = (await message.client.groupMetadata(message.jid)).participants.map((e) => e.id);
    if (message.mention?.[0]) users = message.mention;
    if (message.reply_message && !message.mention.length)
      users = [message.reply_message?.jid];

    let userStats = await fetchFromStore(message.jid);
    let usersWithMessages = [];

    for (let user of users) {
      let userStat = userStats.find((stat) => stat.userJid === user);
      if (userStat && userStat.totalMessages > 0) {
        usersWithMessages.push({
          jid: user,
          stat: userStat,
        });
      }
    }

    usersWithMessages.sort((a, b) => b.stat.totalMessages - a.stat.totalMessages);

    if (usersWithMessages.length === 0) {
      return await message.sendReply("❌ _Veritabanında mesaj gönderen üye bulunamadı._");
    }

    let final_msg = `👥 _${usersWithMessages.length} üye tarafından gönderilen mesajlar_
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
        types_msg += `🖼️ Görsel: *${userStat.imageMessages}*\n`;
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
  pattern: "inactive ?(.*)",
  fromMe: true,
  desc: "Belirlediğiniz süre boyunca mesaj atmayan pasif üyeleri tespit eder ve istenirse gruptan uzaklaştırır.",
  usage: ".inactive [süre] | .inactive [süre] kick",
  use: "tools",
},
  async (message, match) => {
    if (!message.isGroup)
      return await message.sendReply("_ℹ️ Bu bir grup komutudur!_");

    let adminAccesValidated = await isAdmin(message);
    if (message.fromOwner || adminAccesValidated) {
      if (!match[1]) {
        return await message.sendReply("_Kullanım:_\n" +
          "• `.inactive 30gün` - 30+ gündür pasif üyeleri göster\n" +
          "• `.inactive 10gün kick` - 10+ gündür pasif üyeleri at\n" +
          "• `.inactive 2hafta` - 2+ haftadır pasif üyeleri göster\n" +
          "• `.inactive 3ay kick` - 3+ aydır pasif üyeleri at\n\n" +
          "_Desteklenen birimler:_ gün, hafta, ay, yıl (veya d, w, m, y)"
        );
      }

      const args = match[1].trim().split(" ");
      const durationStr = args[0];
      const shouldKick = args[1]?.toLowerCase() === "kick";

      const cutoffDate = parseDurationInput(durationStr);
      if (!cutoffDate) {
        return await message.sendReply("_❌ Geçersiz süre formatı!_\n" + "_Örnekler:_ 30gün, 2hafta, 3ay, 1yıl"
        );
      }

      if (shouldKick) {
        var admin = await isAdmin(message);
        if (!admin)
          return await message.sendReply("_🔒 Üyeleri çıkarmak için botun yönetici yetkilerine ihtiyacı var!_"
          );
      }

      const groupMetadata = await message.client.groupMetadata(message.jid);
      const participants = groupMetadata.participants.map((e) => e.id);
      const userStats = await fetchFromStore(message.jid);

      let oldestMessageDate = null;
      if (userStats.length > 0) {
        const oldestStat = userStats.reduce((oldest, current) => {
          const currentDate = new Date(
            current.lastMessageAt || current.createdAt
          );
          const oldestDate = new Date(oldest.lastMessageAt || oldest.createdAt);
          return currentDate < oldestDate ? current : oldest;
        });
        oldestMessageDate = new Date(
          oldestStat.lastMessageAt || oldestStat.createdAt
        );
      }

      const dataWarning = oldestMessageDate && cutoffDate < oldestMessageDate;

      let inactiveMembers = [];
      for (let user of participants) {
        let userStat = userStats.find((stat) => stat.userJid === user);

        if (!userStat || !userStat.lastMessageAt) {
          inactiveMembers.push({
            jid: user,
            name: userStat?.User?.name?.replace(/[\r\n]+/gm, "") || "Bilinmeyen",
            lastMessage: "Hiç",
            totalMessages: userStat?.totalMessages || 0,
          });
        } else {
          const lastMessageDate = new Date(userStat.lastMessageAt);
          if (lastMessageDate < cutoffDate) {
            inactiveMembers.push({
              jid: user,
              name: userStat.User?.name?.replace(/[\r\n]+/gm, "") || "Bilinmeyen",
              lastMessage: timeSince(userStat.lastMessageAt),
              totalMessages: userStat.totalMessages,
            });
          }
        }
      }

      if (shouldKick) {
        const botId =
          message.client.user?.lid?.split(":")[0] + "@lid" ||
          message.client.user.id.split(":")[0] + "@s.whatsapp.net";
        inactiveMembers = inactiveMembers.filter((member) => {
          const participant = groupMetadata.participants.find(
            (p) => (p.id.split(":")[0] + "@s.whatsapp.net") === member.jid
          );
          return !participant?.admin && member.jid !== botId;
        });
      }

      if (inactiveMembers.length === 0) {
        return await message.sendReply(
          `_Belirtilen süre için pasif üye bulunamadı (${durationStr})._`
        );
      }

      let responseMsg = `👥 _Aktif olmayan üyeler (${durationStr}+):_ *${inactiveMembers.length}*\n\n`;

      if (dataWarning) {
        responseMsg += `⚠️ _Uyarı: Veritabanında sadece ${timeSince(
          oldestMessageDate
        )} tarihinden itibaren veri var. Bu tarihten önce aktif olan üyeler pasif görünebilir._\n\n`;
      }

      if (shouldKick) {
        responseMsg += `_❗❗ ${inactiveMembers.length} pasif üye gruptan atılıyor. Bu işlem geri alınamaz! ❗❗_\n\n`;

        for (let i = 0; i < Math.min(inactiveMembers.length, 10); i++) {
          const member = inactiveMembers[i];
          responseMsg += `${i + 1}. @${member.jid.split("@")[0]} (${member.name
            })\n`;
        }

        if (inactiveMembers.length > 10) {
          responseMsg += `... ve ${inactiveMembers.length - 10} kişi daha\n`;
        }

        responseMsg += `\n_5 saniye içinde atma işlemi başlayacak..._`;

        await message.client.sendMessage(message.jid, {
          text: responseMsg,
          mentions: inactiveMembers.map((m) => m.jid),
        });

        await new Promise((r) => setTimeout(r, 5000));

        let kickCount = 0;
        for (let member of inactiveMembers) {
          try {
            await new Promise((r) => setTimeout(r, 2000));
            await message.client.groupParticipantsUpdate(
              message.jid,
              [member.jid],
              "remove"
            );
            kickCount++;

            if (kickCount % 5 === 0) {
              await message.send(
                `_${kickCount}/${inactiveMembers.length} üye atıldı..._`
              );
            }
          } catch (error) {
            console.error(`${member.jid} gruptan atılamadı:`, error);
          }
        }

        return await message.send(
          `_✅ ${kickCount}/${inactiveMembers.length} pasif üye atıldı._`
        );
      } else {
        for (let i = 0; i < inactiveMembers.length; i++) {
          const member = inactiveMembers[i];
          responseMsg += `${i + 1}. @${member.jid.split("@")[0]}\n`;
          responseMsg += `   _İsim:_ ${member.name}\n`;
          responseMsg += `   _Son mesaj:_ ${member.lastMessage}\n`;
          responseMsg += `   _Toplam mesaj:_ ${member.totalMessages}\n\n`;
        }

        responseMsg += `_Bu üyeleri atmak için \`.inactive ${durationStr} kick\` kullanın._`;

        return await message.client.sendMessage(message.jid, {
          text: responseMsg,
          mentions: inactiveMembers.map((m) => m.jid),
        });
      }
    }
  }
);


Module({
  pattern: "üyetemizle ?(.*)",
  fromMe: false,
  desc: "Belirtilen süre boyunca mesaj atmayan üyeleri listeler veya çıkarır.",
  usage:
    ".üyetemizle 30 gün | .üyetemizle 2 hafta | .üyetemizle 3 ay | .üyetemizle 1 yıl\n\n" +
    "Komutun sonuna 'çıkar' ekleyerek üyeleri gruptan atabilirsiniz.",
  use: "tools",
},
  async (message, match) => {
    try {
      if (!message.isGroup) {
        return await message.sendReply("❌ _Bu komut sadece grup sohbetlerinde kullanılabilir!_");
      }
      const admin = await isAdmin(message);
      if (!admin) {
        return await message.sendReply(Lang.NEED_ADMIN);
      }
      if (!match[1]) {
        return await message.sendReply(
          "❗  *Lütfen şu şekillerde kullanınız:*\n" +
          ".üyetemizle 30 gün\n" +
          ".üyetemizle 2 hafta\n" +
          ".üyetemizle 3 ay\n" +
          ".üyetemizle 1 yıl\n" +
          "🧹 _(Üyeleri çıkarmak için komut sonuna *çıkar* ekleyebilirsiniz.)_"
        );
      }
      const args = match[1].trim().split(/\s+/);
      const durationStr = args[0];
      const durationUnit = args[1]?.toLowerCase();
      const shouldKick = args.includes("çıkar");
      const durationMs = parseDuration(durationStr, durationUnit);
      if (!durationMs) {
        return await message.sendReply(
          "❌ _Geçersiz süre formatı!_\n" +
          "Örnekler:\n" +
          ".üyetemizle 30 gün\n" +
          ".üyetemizle 2 hafta\n" +
          ".üyetemizle 3 ay\n" +
          ".üyetemizle 1 yıl çıkar"
        );
      }
      const cutoffDate = new Date(Date.now() - durationMs);
      const groupMetadata = await message.client.groupMetadata(message.jid);
      const participants = groupMetadata.participants.map((p) => p.id);
      const admins = groupMetadata.participants.filter((p) => p.admin !== null).map((p) => p.id);
      const userStats = await fetchFromStore(message.jid);
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
        if (admins.includes(user)) continue;
        const userStat = userStats.find((stat) => stat.userJid === user);
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
        const botIsAdmin = await isAdmin(message);
        if (!botIsAdmin) {
          return await message.sendReply("⚠️ _Üzgünüm! Üyeleri çıkarabilmem için yönetici olmam gerekiyor._");
        }
        if (inactiveMembers.length === 0) {
          return await message.sendReply("😎 _Belirtilen süre zarfında çıkarılacak inaktif üye bulunamadı._");
        }
        const kickMsg =
          `⚠️ _Dikkat! Bu işlem geri alınamaz._\n` +
          `🧹 _Toplam ${inactiveMembers.length} üye ${durationStr} ${durationUnit} boyunca sessiz kaldıkları için çıkarılacaklar._\n` +
          `_5 saniye içinde başlıyoruz. Dua etmeye başlayın..._ 🥲`;
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
              await message.send(`_Şu ana kadar ${kickCount}/${inactiveMembers.length} üye gruptan çıkarıldı..._`);
            }
          } catch (err) {
            console.error("Üye çıkarılırken hata:", err);
            await message.send(`❌ @${member.jid.split("@")[0]} çıkarılırken bir sorun oluştu.`);
          }
        }
        return await message.send(`✅ _Toplam ${kickCount}/${inactiveMembers.length} inaktif üye gruptan çıkarıldı._`);
      }
      if (inactiveMembers.length === 0) {
        return await message.sendReply(`_Belirtilen süre (${durationStr} ${durationUnit}) için inaktif üye bulunamadı._`);
      }
      let responseMsg =
        `ℹ️ *Son _${durationStr} ${durationUnit}_ boyunca mesaj atmayan üyeler;* _(${inactiveMembers.length})_\n` +
        `_(Kendilerine birer fatiha okuyalım)_ 🥲\n\n`;
      if (dataWarning) {
        responseMsg +=
          `⚠️ _Dikkat! Veritabanı yalnızca ${timeSince(oldestMessageDate, "tr")}'den itibaren kayıt tutuyor. ` +
          `Bu tarihten önce aktif olanlar da inaktif sayılmış olabilir._\n\n`;
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
      return await message.sendReply("⚠️ _Bir hata oluştu. Lütfen tekrar deneyin._");
    }
  }
);


Module({
  pattern: "users ?(.*)",
  fromMe: true,
  desc: "Tüm sohbetlerde veya mevcut grupta en çok mesaj gönderen lider kullanıcıları sıralı olarak listeler.",
  usage: ".users | .users [sayı] | .users genel [sayı]",
  use: "tools",
},
  async (message, match) => {
    let adminAccesValidated =
      message.isGroup ? await isAdmin(message) : false;
    if (message.fromOwner || adminAccesValidated) {
      let limit = 10;
      let isGlobal = false;

      if (match[1]) {
        const args = match[1].trim().split(" ");

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
              return await message.sendReply("_👤 Maksimum sınır 50 kullanıcıdır._");
            }
          }
        } else {
          const parsedLimit = parseInt(args[0]);
          if (parsedLimit && parsedLimit > 0 && parsedLimit <= 50) {
            limit = parsedLimit;
          } else if (parsedLimit > 50) {
            return await message.sendReply("_👤 Maksimum sınır 50 kullanıcıdır._");
          } else if (parsedLimit <= 0) {
            return await message.sendReply("_⚠️ Sınır pozitif bir sayı olmalıdır._"
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

        let responseMsg = `_Mesaj sayısına göre en iyi ${topUsers.length} ${scopeText} kullanıcı_\n\n`;

        for (let i = 0; i < topUsers.length; i++) {
          const user = topUsers[i];
          const rank = i + 1;
          const name = user.name?.replace(/[\r\n]+/gm, "") || "Bilinmiyor";
          const lastMessage = timeSince(user.lastMessageAt);

          responseMsg += `*${rank}.* @${user.jid.split("@")[0]}\n`;
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

        const mentions = topUsers.map((user) => user.jid);

        return await message.client.sendMessage(message.jid, {
          text: responseMsg,
          mentions: mentions,
        });
      } catch (error) {
        console.error("Kullanıcılar komutunda hata:", error);
        return await message.sendReply("_⚠️ Kullanıcı verisi alınamadı. Lütfen tekrar deneyin._"
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
