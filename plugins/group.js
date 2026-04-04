const { getString } = require("./utils/lang");
const Lang = getString("group");
const { loadBaileys } = require("../core/helpers");
let delay, generateWAMessageFromContent, proto;

const baileysPromise = loadBaileys()
  .then((baileys) => {
    ({ delay, generateWAMessageFromContent, proto } = baileys);
  })
  .catch((err) => {
    console.error("Baileys yüklenemedi:", err.message);
    process.exit(1);
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
const { setVar } = require("./manage");
const { isBotIdentifier } = require("./utils/lid-helper");
const handler = config.HANDLER_PREFIX;


async function sendBanAudio(message) {
  const audioPath = path.join(__dirname, "utils", "sounds", "Ban.mp3");

  try {
    if (!fs.existsSync(audioPath)) {
      console.error("Ban sesi dosyası bulunamadı:", audioPath);
      return; // Do not send error to user, just skip audio
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


Module(
  {
    pattern: "sohbetsil ?(.*)",
    fromMe: true,
    desc: "Sohbeti temizle",
    use: "system",
    usage: ".sohbetsil (mevcut sohbeti temizler)",
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
    return await message.send("_🧹 Sohbet temizlendi!_");
  }
);

Module(
  {
    pattern: "ban ?(.*)",
    fromMe: false,
    desc: Lang.KICK_DESC,
    use: "group",
    usage:
      ".ban @etiket veya yanıtla\n.ban herkes (herkesi at)\n.ban 90 (90 ile başlayan numaraları atar)",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

    const { participants, subject } = await message.client.groupMetadata(
      message.jid
    );
    if (match[1]) {
      if (match[1] === "herkes") {
        let users = participants.filter((member) => !member.admin);
        await message.send(
          `_❗ ${subject} grubunun *tüm* üyeleri atılıyor. Bu işlemi durdurmak için botu hemen yeniden başlatın ❗_\n_*5 saniyeniz var*_`
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
          `_❗❗ *${match[1]}* numarasıyla başlayan *${users.length}* üye atılıyor. Bu işlemi durdurmak için botu hemen yeniden başlatın ❗❗_\n_*5 saniyeniz var*_`
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
    const user = message.mention?.[0] || message.reply_message?.jid;
    if (!user) return await message.sendReply(Lang.NEED_USER);
    if (isBotIdentifier(user, message.client)) {
      return await message.sendReply("❌ _Üzgünüm, daha kendimi çıkaracak kadar delirmedim. 😉_");
    }
    await message.client.sendMessage(message.jid, {
      text: mentionjid(user) + Lang.KICKED,
      mentions: [user],
    });
    await message.client.groupParticipantsUpdate(
      message.jid,
      [user],
      "remove"
    );
  }
);

Module(
  {
    pattern: "at ?(.*)",
    fromMe: false,
    desc: Lang.KICK_DESC,
    use: "group",
  },
  async (message, match) => {
    if (!message.isGroup) {
      return await message.sendReply(Lang.GROUP_COMMAND);
    }

    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin) {
      return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    }

    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) {
      return await message.sendReply("❌ _Bot'un üyeleri atabilmesi için yönetici olması gerekiyor!_");
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
        "❌ _Lütfen bir üye etiketleyin veya bir mesaja yanıt verin!_"
      );
    }

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
          `❌ _Belirtilen kişi${adminUsers.length > 1 ? "lar" : ""} yönetici olduğu için atılamaz!_`
        );
      }
      return await message.sendReply("❌ _Üzgünüm, daha kendimi çıkaracak kadar delirmedim. 😉_");
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
            `❌ ${mentionjid(user)} _bir yönetici olduğu için atılamaz!_`,
            { mentions: [user] }
          );
          continue;
        }

        await message.client.sendMessage(message.jid, {
          text: mentionjid(user) + Lang.KICKED,
          mentions: [user],
        });
        await message.client.groupParticipantsUpdate(message.jid, [user], "remove");

        if (usersToKick.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      } catch (error) {
        console.error("Üye atılırken hata:", error);
        await message.sendReply(`❌ ${mentionjid(user)} _atılırken bir hata oluştu!_`, {
          mentions: [user],
        });
      }
    }
  }
);


/*Module(
  {
    pattern: "ekle ?(.*)",
    fromMe: true,
    desc: Lang.ADD_DESC,
    warn: "Numaranız banlanabilir, dikkatli kullanın",
    use: "group",
    usage: ".ekle 90532xxxxxxx",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");
    
    var init = match[1] || message.reply_message?.jid.split("@")[0];
    if (!init) return await message.sendReply(Lang.NEED_USER);
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

Module(
  {
    pattern: "yetkiver ?(.*)",
    fromMe: false,
    desc: Lang.PROMOTE_DESC,
    use: "group",
    usage: ".yetkiver @etiket veya yanıtla",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

    const user = message.mention?.[0] || message.reply_message?.jid;
    if (!user) return await message.sendReply(Lang.NEED_USER);
    await message.client.sendMessage(message.jid, {
      text: mentionjid(user) + Lang.PROMOTED,
      mentions: [user],
    });
    await message.client.groupParticipantsUpdate(
      message.jid,
      [user],
      "promote"
    );
  }
);
Module(
  {
    pattern: "istekler ?(.*)",
    fromMe: false,
    desc: "Bekleyen katılma isteklerinin listesini al",
    use: "group",
    usage: ".istekler (bekleyen istekleri gör)\n.istekler hepsi onayla (tüm istekleri onayla)\n.istekler hepsi reddet (tüm istekleri reddet)",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

    let approvalList = await message.client.groupRequestParticipantsList(
      message.jid
    );
    if (!approvalList.length)
      return await message.sendReply("_📭 Bekleyen katılma isteği yok!_");
    let approvalJids = approvalList.map((x) => x.jid);
    if (match[1]) {
      match = match[1].toLowerCase();
      switch (match) {
        case "hepsini onayla":
        case "approve all": {
          await message.sendReply(
            `_${approvalJids.length} katılımcı onaylandı._`
          );
          for (let x of approvalJids) {
            await message.client.groupRequestParticipantsUpdate(
              message.jid,
              [x],
              "approve"
            );
            await delay(900);
          }
          break;
        }
        case "hepsini reddet":
        case "reject all": {
          await message.sendReply(
            `_${approvalJids.length} katılımcı reddedildi._`
          );
          for (let x of approvalJids) {
            await message.client.groupRequestParticipantsUpdate(
              message.jid,
              [x],
              "reject"
            );
            await delay(900);
          }
          break;
        }
        default: {
          return await message.sendReply("_❌ Geçersiz giriş_\n_Örn: .istekler hepsini onayla_\n_.istekler hepsini reddet_"
          );
        }
      }
      return;
    }
    let msg =
      "*_Grup katılma istekleri_*\n\n_(.istekler hepsini onayla|reddet şeklinde kullanın)_\n\n";
    const requestType = (type_, requestor) => {
      switch (type_) {
        case "linked_group_join":
          return "topluluk";
        case "invite_link":
          return "davet bağlantısı";
        case "non_admin_add":
          return `+${requestor.split("@")[0]} tarafından eklendi`;
      }
    };
    for (let x in approvalList) {
      msg += `*_${parseInt(x) + 1}. @${approvalList[x].jid.split("@")[0]
        }_*\n  _• via: ${requestType(
          approvalList[x].request_method,
          approvalList[x].requestor
        )}_\n  _• at: ${new Date(
          parseInt(approvalList[x].request_time) * 1000
        ).toLocaleString()}_\n\n`;
    }
    return await message.client.sendMessage(
      message.jid,
      { text: msg, mentions: approvalJids },
      { quoted: message.data }
    );
  }
);
Module(
  {
    pattern: "ayrıl",
    fromMe: true,
    desc: Lang.LEAVE_DESC,
    usage: ".ayrıl (mevcut gruptan çıkar)",
    use: "group",
  },
  async (message, match) => {
    if (!message.isGroup)
      return await message.sendReply("_ℹ️ Nereden çıkayım? Bu bir grup komutu!_"
      );
    const jid = message.jid;
    setImmediate(() => message.client.groupLeave(jid));
  }
);
Module(
  {
    pattern: "quoted",
    fromMe: true,
    desc: "Yanıtlanan mesajın alıntıladığı mesajı gönderir. Silinen mesajları kurtarmak için kullanışlıdır.",
    usage: ".quoted (alıntılanmış bir mesaja yanıtla)",
    use: "group",
  },
  async (message, match) => {
    try {
      if (!message.reply_message || !message.reply_message.id) {
        return await message.sendReply("_💬 Lütfen alıntılanmış bir mesajı yanıtlayın!_");
      }
      const repliedMessage = await getFullMessage(
        message.reply_message.id + "_"
      );
      if (!repliedMessage.found) {
        return await message.sendReply("_❌ Orijinal mesaj veritabanında bulunamadı!_"
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
        return await message.sendReply("_💬 Yanıtlanan mesaj, alıntılanmış bir mesaj içermiyor!_"
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
        return await message.sendReply("_❌ Alıntılanan mesaj bulunamadı ve mevcut önbellek verisi yok!_"
        );
      }
    } catch (error) {
      console.error("Yanıtlanan komutta hata:", error);
      return await message.sendReply("_⬇️ Alıntılanan mesaj yüklenemedi!_");
    }
  }
);

Module(
  {
    pattern: "yetkial ?(.*)",
    fromMe: false,
    desc: Lang.DEMOTE_DESC,
    use: "group",
    usage: ".yetkial @etiket veya yanıtla",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

    const user = message.mention?.[0] || message.reply_message?.jid;
    if (!user) return await message.sendReply(Lang.NEED_USER);
    await message.client.sendMessage(message.jid, {
      text: mentionjid(user) + Lang.DEMOTED,
      mentions: [user],
    });
    await message.client.groupParticipantsUpdate(
      message.jid,
      [message.reply_message?.jid],
      "demote"
    );
  }
);
Module(
  {
    pattern: "sohbetkapat ?(.*)",
    fromMe: false,
    desc: Lang.MUTE_DESC,
    use: "group",
    usage:
      ".sohbetkapat (grubu süresiz olarak sessize alır)\n.sohbetkapat 1s (1 saat sessize alır)\n.sohbetkapat 5d (5 dakika sessize alır)",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

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
      await message.send(`_${displayMatch} boyunca sessize alındı_`);
      await require("timers/promises").setTimeout(duration);
      return await message.client.groupSettingUpdate(
        message.jid,
        "not_announcement"
      );
      await message.send(Lang.UNMUTED);
    }
    await message.client.groupSettingUpdate(message.jid, "announcement");
    await message.send(Lang.MUTED);
  }
);
Module(
  {
    pattern: "sohbetaç",
    fromMe: false,
    desc: Lang.UNMUTE_DESC,
    use: "group",
    usage: ".sohbetaç (grubun sessizini açar)",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

    await message.client.groupSettingUpdate(message.jid, "not_announcement");
    await message.send(Lang.UNMUTED);
  }
);
Module(
  {
    pattern: "jid",
    fromMe: false,
    desc: Lang.JID_DESC,
    use: "group",
    usage: ".jid (mevcut sohbet kimliğini alır)\n.jid (kullanıcı kimliğini almak için yanıtla)",
  },
  async (message) => {
    const isAdminUser = await isAdmin(message);
    if (message.isGroup) {
      if (message.fromOwner || isAdminUser) {
        const jid = message.reply_message?.jid || message.jid;
        await message.sendReply(jid);
      } else {
        await message.sendReply("❌ _Üzgünüm! Bu komutu kullanabilmek için yönetici olmalısınız._");
      }
    } else {
      if (MODE !== "public" && !message.fromOwner) return;
      await message.sendReply(message.jid);
    }
  }
);
Module(
  {
    pattern: 'davet',
    fromMe: true,
    use: 'group',
    desc: Lang.INVITE_DESC
  },
  (async (message, match) => {
  if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND)
  const userIsAdmin = await isAdmin(message, message.sender);
  if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
  const botIsAdmin = await isAdmin(message);
  if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

  const code = await message.client.groupInviteCode(message.jid)
  await message.client.sendMessage(message.jid, {
    text: "*Grubun Davet Bağlantısı: 👇🏻*\n https://chat.whatsapp.com/" + code, detectLinks: true
  }, { detectLinks: true })
}))

Module(
  {
    pattern: "davetyenile",
    fromMe: false,
    use: "group",
    desc: Lang.REVOKE_DESC,
    usage: ".davetyenile (grup davet bağlantısını sıfırlar)",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

    await message.client.groupRevokeInvite(message.jid);
    await message.send(Lang.REVOKED);
  }
);
Module(
  {
    pattern: "gayaryt ?(.*)",
    fromMe: false,
    use: "group",
    desc: "Grup ayarlarını sadece yöneticilerin düzenleyebileceği şekilde değiştirir!",
    usage: ".gayaryt (grup ayarlarını kilitler)",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

    return await message.client.groupSettingUpdate(message.jid, "locked");
  }
);
Module(
  {
    pattern: "gayarherkes ?(.*)",
    fromMe: false,
    use: "group",
    desc: "Grup ayarlarını herkesin düzenleyebileceği şekilde değiştirir!",
    usage: ".gayarherkes (grup ayarlarının kilidini açar)",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

    return await message.client.groupSettingUpdate(message.jid, "unlocked");
  }
);
Module(
  {
    pattern: "gadı ?(.*)",
    fromMe: false,
    use: "group",
    desc: "Grup adını (başlığını) değiştir",
    usage: ".gadı Yeni Grup Adı",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

    const newName = (match[1] || message.reply_message?.text || "").trim();
    if (!newName) return await message.sendReply("*_💬 Yeni grup adını girin!_*");

    try {
      const oldName = (await message.client.groupMetadata(message.jid)).subject || "Bilinmeyen Grup";
      const finalName = newName.slice(0, 25);

      await message.client.groupUpdateSubject(message.jid, finalName);

      return await message.sendReply(
        `*_✏️ Grup adını güncelledim!_* ✅\n\n*⬅️ Şöyleydi:* ${censorBadWords(oldName)}\n*🆕 Şöyle oldu:* ${censorBadWords(finalName)}`
      );
    } catch (error) {
      console.error("Grup adı değiştirme hatası:", error);
      return await message.sendReply("❌ _Grup adı değiştirilemedi!_");
    }
  }
);
Module(
  {
    pattern: "gaçıklama ?(.*)",
    fromMe: false,
    use: "group",
    desc: "Grup açıklamasını değiştir",
    usage: ".gaçıklama Yeni grup açıklaması!",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

    const newDesc = match[1] || message.reply_message?.text;
    if (!newDesc) return await message.sendReply("*_💬 Yeni grup açıklamasını girin!_*");
    try {
      const meta = await message.client.groupMetadata(message.jid);
      const oldDesc = meta.desc || "Açıklama yok";
      const finalDesc = newDesc.slice(0, 512);

      await message.client.groupUpdateDescription(message.jid, finalDesc);
      return await message.sendReply(
        `*_💬 Grup açıklamasını güncelledim!_* ✅\n\n*⬅️ Şöyleydi:* ${censorBadWords(oldDesc)}\n*🆕 Şöyle oldu:* ${censorBadWords(finalDesc)}`
      );
    } catch {
      return await message.sendReply("_❌ Değiştirilemedi!_");
    }
  }
);
Module(
  {
    pattern: "common ?(.*)",
    fromMe: false,
    use: "group",
    desc: "İki gruptaki ortak katılımcıları bulur",
    usage: ".common jid1,jid2\n.common çıkar grup_jid",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

    if (!match[1])
      return await message.sendReply("_*⚠️ Jid'ler gerekli*_\n_*.common jid1,jid2*_\n _VEYA_ \n_*.common kick grup_jid*_"
      );
    if (match[1].includes("kick")) {
      const co = match[1].split(" ")[1];
      const g1 = await message.client.groupMetadata(co);
      const g2 = await message.client.groupMetadata(message.jid);
      const common = g1.participants.filter(({ id: id1 }) =>
        g2.participants.some(({ id: id2 }) => id2 === id1)
      );
      const jids = [];
      let msg = `_${g1.subject}_ & _${g2.subject}_ grubundaki ortak katılımcılar atılıyor_\n_sayı: ${common.length}_\n`;
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
    let msg = `_*${g1.subject}* & *${g2.subject}* ortak katılımcıları:_\n_sayı: ${common.length}_\n`;
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
Module(
  {
    pattern: "diff ?(.*)",
    fromMe: false,
    use: "group",
    desc: "İki gruptaki farklı katılımcıları bulur",
    usage: ".diff jid1,jid2",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");

    if (!match[1])
      return await message.sendReply("_*⚠️ Jid'ler gerekli*_\n_*.diff jid1,jid2*_");
    const co = match[1].split(",");
    const g1 = (await message.client.groupMetadata(co[0])).participants;
    const g2 = (await message.client.groupMetadata(co[1])).participants;
    const common = g1.filter(
      ({ id: jid1 }) => !g2.some(({ id: jid2 }) => jid2 === jid1)
    );
    let msg =
      "_*Farklı katılımcılar*_\n_sayı: " + common.length + "_\n";
    common.map(async (s) => {
      msg += "```" + s.id.split("@")[0] + "``` \n";
    });
    return await message.sendReply(msg);
  }
);
Module(
  {
    pattern: "tag ?(.*)",
    fromMe: false,
    desc: Lang.TAGALL_DESC,
    use: "group",
    usage:
      ".tag metin\n.tag (mesaja yanıtla)\n.tagherkes (herkesi etiketle)\n.tagyt (sadece yöneticileri etiketle)\n.tag 120363355307899193@g.us (belirli grupta etiketle)",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return;

    const input = (match[1] || "").toLowerCase().trim();
    const isTagAdmin = input === "yt" || input === "admin";
    const isTagAll = input === "herkes" || input === "all" || input === "";
    const isReply = !!message.reply_message;

    // Sadece .tag yazıldıysa veya metin yoksa bilgilendirme (Emoji ile sade)
    if (!isReply && !input) {
      return await message.sendReply(`📢 *Grup Etiketleme Modülü* 📢\n\n💡 *Örnek Kullanım:* \`.tag Merhaba!\`\n\n🚀 *Hızlı Komutlar:*
• \`.tag herkes\` (veya \`all\`) 👥
• \`.tag yt\` (veya \`admin\`) 🛡️
• \`.tag <metin>\` 📝`);
    }

    const { participants } = await message.client.groupMetadata(message.jid);
    const targets = [];
    let msgText = "";

    for (const p of participants) {
      if (isTagAdmin && !p.admin) continue;
      targets.push(p.id);
      msgText += `• @${p.id.split("@")[0]}\n`;
    }

    if (isReply) {
      // Yanıtlanan mesajı, katılımcıları etiketleyerek ilet
      await message.client.sendMessage(message.jid, {
        forward: message.reply_message.data,
        contextInfo: { mentionedJid: targets }
      });
    } else if (input && !isTagAdmin && !isTagAll) {
      // Özel metin ile etiketle
      await message.client.sendMessage(message.jid, {
        text: match[1],
        mentions: targets,
      });
    } else {
      // Liste şeklinde etiketle
      await message.client.sendMessage(message.jid, {
        text: `📢 *Sırayla Etiketlendi!* 📢\n\n${msgText}`,
        mentions: targets,
      });
    }
  }
);
Module(
  {
    pattern: "engelle ?(.*)",
    fromMe: true,
    use: "system",
    desc: "Kullanıcıyı engelle",
    usage: ".block (bir mesaja yanıtla)\n.block @etiket",
  },
  async (message, match) => {
    const isGroup = message.jid.endsWith("@g.us");
    let user = message.jid;
    if (isGroup) user = message.mention?.[0] || message.reply_message?.jid;
    await message.client.updateBlockStatus(user, "block");
  }
);
Module(
  {
    pattern: "katıl ?(.*)",
    fromMe: true,
    use: "system",
    desc: "Davet bağlantısını kullanarak bir WhatsApp grubuna katılın",
    usage: ".join https://chat.whatsapp.com/lades",
  },
  async (message, match) => {
    let rgx =
      /^(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]{22})(?:\?.*)?$/;
    let matchResult = match[1] && match[1].match(rgx);
    if (!matchResult) return await message.sendReply("_*⚠️ Grup bağlantısı gerekli*_");
    let inviteCode = matchResult[1];
    await message.client.groupAcceptInvite(inviteCode);
  }
);
Module(
  {
    pattern: "engelkaldır ?(.*)",
    fromMe: true,
    use: "system",
    desc: "Kullanıcının engelini kaldır",
    usage: ".unblock (reply to a message)\n.unblock @mention",
  },
  async (message) => {
    const isGroup = message.jid.endsWith("@g.us");
    if (!isGroup) return;
    const user = message.mention?.[0] || message.reply_message?.jid;
    await message.client.updateBlockStatus(user, "unblock");
  }
);
const MEMORY_FILE = path.join(__dirname, "visitedLinks.json");
const loadVisitedLinks = async () => {
  try {
    const fsPromises = require("fs").promises;
    if (fs.existsSync(MEMORY_FILE)) {
      const data = await fsPromises.readFile(MEMORY_FILE, "utf-8");
      return new Set(JSON.parse(data));
    }
  } catch {
    return new Set();
  }
  return new Set();
};
const saveVisitedLinks = async (set) => {
  try {
    const fsPromises = require("fs").promises;
    await fsPromises.writeFile(MEMORY_FILE, JSON.stringify([...set]), "utf-8");
  } catch (e) {
    console.error("Hafıza kaydedilemedi:", e);
  }
};
let visitedLinks = new Set();
(async () => {
  visitedLinks = await loadVisitedLinks();
})();

Module({
  pattern: "toplukatıl ?(.*)",
  fromMe: false,
  use: "system",
  desc: "Davet bağlantılarını kullanarak birden fazla WhatsApp grubuna katılmayı sağlar",
  usage: ".toplukatıl link1, link2, link3 veya .toplukatıl link1 link2 link3",
},
  async (message, match) => {
    const rgx = /(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]{22})(?:\?[^\s,]*)*/g;
    if (!match[1] || !match[1].trim()) {
      return await message.sendReply(
        `❌ *Lütfen grup bağlantısı girin!*\n\n` +
        `*Kullanımı:*\n` +
        `› .toplukatıl link1 link2\n` +
        `› .toplukatıl link1, link2, link3\n` +
        `› .toplukatıl link1,link2,link3`
      );
    }
    let rawInput = match[1]
      .replace(/,\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    let links = rawInput.match(rgx);
    if (!links || links.length === 0) {
      return await message.sendReply("❌ *Geçerli WhatsApp grup bağlantısı bulunamadı!*");
    }
    links = [...new Set(links)];
    const DELAY_MIN = 3000;
    const DELAY_MAX = 6000;
    const BATCH_SIZE = 21;
    const REST_TIME = 900000;
    const randomDelay = () => {
      const delay = Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN;
      return new Promise((resolve) => setTimeout(resolve, delay));
    };
    const getErrorMessage = (error) => {
      const msg = error?.message || "";
      if (msg.includes("401")) return "⛔ Bağlantı geçersiz veya süresi dolmuş";
      if (msg.includes("403")) return "🔒 Gruba katılım kısıtlanmış";
      if (msg.includes("404")) return "🔍 Grup bulunamadı";
      if (msg.includes("408")) return "✋ Zaten bu grubun üyesisiniz";
      if (msg.includes("500")) return "🔧 WhatsApp sunucu hatası";
      if (msg.includes("rate")) return "⏳ Rate limit - çok hızlı istek";
      return `❓ ${msg || "Bilinmeyen hata"}`;
    };

    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;
    let memorySkipCount = 0;
    let results = [];
    const filteredLinks = [];
    for (let link of links) {
      const codeMatch = link.match(
        /(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]{22})/
      );
      if (!codeMatch || !codeMatch[1]) continue;
      const code = codeMatch[1];
      if (visitedLinks.has(code)) {
        memorySkipCount++;
      } else {
        filteredLinks.push({ link, code });
      }
    }
    const totalBatches = Math.ceil(filteredLinks.length / BATCH_SIZE);
    let startMsg =
      `🔄 *İşlem Başlatıldı*\n\n` +
      `📋 Toplam bağlantı: *${links.length}*\n`;
    if (memorySkipCount > 0) {
      startMsg += `🧠 Hafızadan atlanan: *${memorySkipCount}*\n`;
    }
    startMsg +=
      `🔗 İşlenecek bağlantı: *${filteredLinks.length}*\n` +
      `📦 Toplam part: *${totalBatches}*\n` +
      `⏸️ Her *${BATCH_SIZE}* grup sonrası *${REST_TIME / 1000} saniye* dinlenilecek\n\n` +
      `_Spam koruması için her işlem arasında bekleniyor..._`;

    await message.sendReply(startMsg);
    for (let i = 0; i < filteredLinks.length; i++) {
      const { link, code } = filteredLinks[i];
      try {
        await message.client.groupAcceptInvite(code);
        visitedLinks.add(code);
        saveVisitedLinks(visitedLinks);
        successCount++;
        results.push(`✅ [${i + 1}] başarıyla girildi`);
      } catch (error) {
        if (error?.message?.includes("408")) {
          visitedLinks.add(code);
          saveVisitedLinks(visitedLinks);
          skipCount++;
          results.push(`♻️ [${i + 1}] zaten üyesiniz`);
        } else {
          failCount++;
          results.push(`❌ [${i + 1}] ${getErrorMessage(error)}`);
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
            `⏸️ *${currentBatch}. part tamamlandı.*\n\n` +
            `✅ Başarılı: *${successCount}*\n` +
            `❌ Başarısız: *${failCount}*\n` +
            `♻️ Zaten Üye Olunan: *${skipCount}*\n` +
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
      `♻️ Zaten Üye Olunan: *${skipCount}*\n` +
      `🧠 Hafızadan Atlanan: *${memorySkipCount}*\n` +
      `📋 Toplam: *${links.length}*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `*📝 Detaylar:*\n` +
      results.join("\n");
    await message.sendReply(report);
  }
);

Module(
  {
    pattern: "tümjid ?(.*)",
    fromMe: true,
    desc: "Sohbetlerin veya grupların tüm JID adreslerini listeler.",
    use: "tools",
    usage:
      ".getjids all (shows all group JIDs)\n.getjids recent (shows recent chat JIDs)\n.getjids recent 15 (shows 15 recent chats)",
  },
  async (message, match) => {
    const args = match[1]?.trim().split(" ") || [];
    const command = args[0]?.toLowerCase();
    if (!command || (command !== "all" && command !== "recent")) {
      return await message.sendReply("*Kullanım:*\n" +
        "• `.tümjid hepsi` - Tüm grup JID'lerini göster\n" +
        "• `.tümjid son` - Son sohbet JID'lerini göster (varsayılan 10)\n" +
        "• `.tümjid son 15` - Son 15 sohbet JID'sini göster"
      );
    }
    if (command === "all") {
      const allGroups = await message.client.groupFetchAllParticipating();
      const gruplar = Object.keys(allGroups);
      const recentChats = await fetchRecentChats(100);
      const dmChats = recentChats.filter((chat) => chat.type === "private");
      const totalChats = gruplar.length + dmChats.length;
      if (!totalChats) return await message.sendReply("_❌ Sohbet bulunamadı!_");
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
    } else if (command === "recent") {
      const limit = parseInt(args[1]) || 10;
      if (limit > 50) {
        return await message.sendReply("_*✨ Maksimum sınır 50 sohbettir!*_");
      }
      const recentChats = await fetchRecentChats(limit);
      if (!recentChats.length) {
        return await message.sendReply("_❌ Son sohbet bulunamadı!_");
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
        const lastMessageTime = new Date(chat.lastMessageTime).toLocaleString();
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
          ).toLocaleString();
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

Module(
  {
    pattern: "duyuru ?(.*)",
    fromMe: true,
    desc: "Bot'un bulunduğu tüm gruplara duyuru iletir ve isteğe bağlı olarak sabitler.",
    use: "system",
    usage:
      ".duyuru <mesaj>\n" +
      ".duyuru <mesaj> | sabitle:24s\n" +
      ".duyuru karalist ekle <jid>\n" +
      ".duyuru karalist çıkar <jid>\n" +
      ".duyuru karalist liste\n" +
      ".duyuru karalist bu",
  },
  async (message, match) => {
    const adminAccess = message.isAdmin;
    if (!message.fromOwner && !adminAccess) {
      return await message.sendReply("_❌ Bu komutu sadece yetkili kullanıcılar çalıştırabilir._");
    }

    const input = match[1]?.trim() || "";
    const arg = input.toLowerCase();

    if (arg.startsWith("grup") || arg.startsWith("karalist")) {
      const parts = input.split(" ");
      const cmdOffset = parts[0]?.toLowerCase() === "karalist" ? 0 : 1;
      const cmd = parts[cmdOffset + 1]?.toLowerCase();
      const jid = parts[cmdOffset + 2]?.trim();
      const liste = loadKaraListe();
      if (cmd === "filtrele" && jid) {
        if (liste.includes(jid)) return message.sendReply("_Bu grup zaten kara listede._");
        liste.push(jid);
        await saveKaraListe(liste);
        return message.sendReply(`_✅ \`${jid}\` filtreleme listesine eklendi._`);
      }
      if (cmd === "sil" && jid) {
        const yeni = liste.filter((gJid) => gJid !== jid);
        await saveKaraListe(yeni);
        return message.sendReply(`_✅ \`${jid}\` filtreleme listesinden çıkarıldı._`);
      }
      if (cmd === "liste") {
        if (!liste.length) return message.sendReply("_Kara liste boş._");
        return message.sendReply(
          `*📋 Duyuru Kara Listesi (${liste.length} grup):*\n` +
          liste.map((gJid, i) => `${i + 1}. \`${gJid}\``).join("\n")
        );
      }
      if (cmd === "bu") {
        return message.sendReply(`ℹ _Mevcut grup JID'i:_\n\`${message.jid}\``);
      }
      return message.sendReply(
        `🔻 *Grup filtresi kullanımı:*\n` +
        `• \`.duyuru grup filtrele <jid>\`\n` +
        `• \`.duyuru grup sil <jid>\`\n` +
        `• \`.duyuru grup liste\`\n` +
        `• \`.duyuru grup bu\` — bulunduğun grubun JID'ini göster`
      );
    }

    let announceText = input;
    let pinDuration = null;
    const pipeIndex = input.lastIndexOf("|");
    if (pipeIndex !== -1) {
      const after = input.slice(pipeIndex + 1).trim().toLowerCase();
      const pinMatch = after.match(/^sabitle:(24s|7g|30g)$/);
      if (pinMatch) {
        pinDuration = PIN_DURATIONS[pinMatch[1]];
        announceText = input.slice(0, pipeIndex).trim();
      }
    }

    const hasReply = !!message.reply_message;
    const hasText = announceText.length > 0;
    if (!hasText && !hasReply) {
      return message.sendReply(
        `📢 _Bot'un bulunduğu tüm gruplara duyuru iletir._\n\n` +
        `*Kullanım:*\n` +
        `• \`.duyuru <mesaj>\` — sadece gönder\n` +
        `• \`.duyuru <mesaj> | sabitle:24s\` — gönder ve 24 saat sabitle\n` +
        `• \`.duyuru <mesaj> | sabitle:7g\` — gönder ve 7 gün sabitle\n` +
        `• \`.duyuru <mesaj> | sabitle:30g\` — gönder ve 30 gün sabitle\n` +
        `• Bir mesaja yanıtla + \`.duyuru\` — o mesajı ilet\n\n` +
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
      return message.sendReply("_❌ Grup listesi alınamadı._");
    }

    const karaListe = loadKaraListe();
    const groupJids = Object.keys(allGroups).filter((jid) => !karaListe.includes(jid));
    if (!groupJids.length) {
      return message.sendReply("_Hiç grup bulunamadı (veya tamamı liste dışına alınmış)._");
    }

    const pinLabel = pinDuration
      ? `, ${pinDuration === 86400 ? "24 saat" : pinDuration === 604800 ? "7 gün" : "30 gün"} süreyle sabitlenecek`
      : "";
    const eta = estimateTime(groupJids.length, !!pinDuration);
    const confirmMsg = await message.sendReply(
      `_📢 Duyuru *${groupJids.length}* gruba gönderiliyor${pinLabel}…_\n` +
      `_⏱️ Tahmini süre: *${formatDuration(eta)}*_` +
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

    for (const jid of groupJids) {
      try {
        let sentMsg;
        if (hasReply) {
          sentMsg = await message.client.sendMessage(jid, {
            forward: message.quoted,
          });
          if (hasText) {
            await message.client.sendMessage(jid, { text: announceText });
          }
        } else {
          sentMsg = await message.client.sendMessage(jid, {
            text: announceText,
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

Module(
  {
    pattern: "sabitle ?(.*)",
    fromMe: false,
    desc: "Yanıtlanan mesajı belirli bir süre için sabitler",
    use: "group",
    usage:
      ".sabitle 24s (24 saat)\n.sabitle 7g (7 gün)\n.sabitle 30g (30 gün)\n.sabitle (varsayılan: 7 gün)",
  },
  async (message, match) => {
    if (!message.isGroup) {
      return await message.sendReply("_❌ Bu komut sadece gruplarda kullanılabilir._");
    }

    if (!message.reply_message) {
      return await message.sendReply(
        "_❌ Lütfen sabitlemek istediğiniz mesaja yanıtlayarak yazın!_\n\n" +
        "🔻 _Kullanım:_\n" +
        "_.sabitle 24s_ → 24 saat\n" +
        "_.sabitle 7g_ → 7 gün\n" +
        "_.sabitle 30g_ → 30 gün\n" +
        "_.sabitle_ → varsayılan 7 gün"
      );
    }

    await baileysPromise;
    if (!generateWAMessageFromContent || !proto) {
      return await message.sendReply(
        "_❌ Bot bileşenleri henüz yüklenmedi, lütfen biraz bekleyip tekrar deneyin._"
      );
    }

    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) {
      return await message.sendReply(
        "_❌ Bu grupta yönetici değilim!_"
      );
    }

    const input = match[1] ? match[1].trim().toLowerCase() : "";
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
      return await message.sendReply(`_📌 Mesaj, başarıyla *${durationText}* süreyle sabitlendi!_`);
    } catch (error) {
      console.error("Sabitle komutu hatası:", error);
      return await message.sendReply(
        "_❌ Mesaj sabitleme sırasında bir hata oluştu!_"
      );
    }
  }
);

Module(
  {
    pattern: "pp ?(.*)",
    fromMe: true,
    use: "system",
    desc: "Profil resmini değiştir/al (tam ekran destekli)",
    usage:
      ".pp (reply to image to set profile pic)\n.pp (reply to user to get their profile pic)",
  },
  async (message, match) => {
    if (message.reply_message && message.reply_message.image) {
      const image = await message.reply_message.download();
      const botJid = message.client.user?.id?.split(":")[0] + "@s.whatsapp.net";
      await message.client.setProfilePicture(botJid, {
        url: image,
      });
      return await message.sendReply("_*⚙️ Profil resmi güncellendi ✅*_");
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
Module(
  {
    pattern: "grupfoto ?(.*)",
    fromMe: false,
    use: "system",
    desc: "Grup simgesini değiştir/al (tam ekran destekli)",
    usage: ".gpp (reply to image to set group icon)",
  },
  async (message, match) => {
    if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) return await message.sendReply("❌ _Bot'un bu işlemi yapabilmesi için yönetici olması gerekiyor!_");

    if (message.reply_message && message.reply_message.image) {
      const image = await message.reply_message.download();
      await message.client.setProfilePicture(message.jid, { url: image });
      return await message.sendReply("_*⚙️ Grup simgesi güncellendi ✅*_");
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

Module(
  {
    pattern: "altın ?(.*)",
    fromMe: false,
    desc: "Güncel altın fiyatlarını gösterir",
    use: "tools",
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
          "⚠️ _Altın verilerine ulaşılamadı!_\n_Kaynak yapısı değişmiş olabilir._",
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
        timeZone: "Europe/Istanbul",
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
        "⚠️ _Altın verileri alınırken hata oluştu._\n_Lütfen daha sonra tekrar deneyin._",
        message.jid,
        loading.key
      );
    }
  }
);


Module(
  {
    pattern: 'etiket',
    fromMe: false,
    desc: 'Tüm üyeleri etiketler.',
    use: 'group',
  },
  async (message, match) => {
  const userIsAdmin = await isAdmin(message, message.sender);
  if (!userIsAdmin && !message.fromOwner) return await message.sendReply("❌ _Üzgünüm! Öncelikle yönetici olmalısınız._");
  if (!message.isGroup) return await message.sendReply(Lang.GROUP_COMMAND);
  const target = message.jid;
  const group = await message.client.groupMetadata(target);
  const allMembers = group.participants.map(participant => participant.id);
  let text = "✅ *Herkes başarıyla etiketlendi!*";
  allMembers.forEach((jid, index) => {
    text += `
${index + 1}. @${jid.split('@')[0]}`;
  });
  await message.client.sendMessage(target, {
    text: text,
    contextInfo: { mentionedJid: allMembers }
  });
});

Module(
  {
    pattern: 'ytetiket',
    fromMe: false,
    desc: 'Tüm yöneticileri etiketler.',
    use: 'group',
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
  await message.client.sendMessage(target, { text: text, contextInfo: { mentionedJid: admins } });
});
