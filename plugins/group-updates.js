const {
  antifake,
  pdm,
  antipromote,
  antidemote,
  welcome,
  goodbye,
  isAdmin,
} = require("./utils");
const { automute, autounmute, stickcmd } = require("./utils/db/schedulers");
const {
  parseWelcomeMessage,
  sendWelcomeMessage,
} = require("./utils/welcome-parser");

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

function tConvert(time) {
  time = time.toString().match(/^([01]\d|2[0-3])( )([0-5]\d)(:[0-5]\d)?$/) || [
    time,
  ];
  if (time.length > 1) {
    time = time.slice(1);
    time[5] = +time[0] < 12 ? " AM" : " PM";
    time[0] = +time[0] % 12 || 12;
  }
  return time.join("").replace(" ", ":");
}

async function extractData(message) {
  return message.quoted.message.stickerMessage.fileSha256.toString();
}
Module(
  {
    pattern: "otoçıkartma ?(.*)",
    fromMe: true,
    desc: "Komutları çıkartmalara yapıştırır. Çıkartma gönderilirse komut gibi çalışır!",
    usage: ".otoçıkartma .ban",
    warn: "Sadece çıkartmalarda çalışır",
    use: "tools",
  },
  async (message, match) => {
    if (!match[1] || !message.reply_message || !message.reply_message.sticker)
      return await message.sendReply("_💬 Bir çıkartmayı yanıtlayın_\n_Ör: *.otoçıkartma .ban*_"
      );
    try {
      await stickcmd.set(match[1], await extractData(message));
    } catch {
      return await message.sendReply("_❌ Başarısız!_");
    }
    await message.client.sendMessage(
      message.jid,
      {
        text: `_✨ ${match[1]} komutu bu çıkartmaya yapıştırıldı! Yeniden bağlanılıyor..._`,
      },
      {
        quoted: message.quoted,
      }
    );
  }
);

Module(
  {
    pattern: "otoçıkartmasil ?(.*)",
    fromMe: true,
    desc: "Çıkartmalardaki komutları siler",
    usage: ".otoçıkartmasil .ban",
    use: "tools",
  },
  async (message, match) => {
    if (message.reply_message && message.reply_message.sticker) {
      let deleted = await stickcmd.delete(await extractData(message), "file");
      if (deleted)
        return await message.client.sendMessage(
          message.jid,
          {
            text: `_🗑️ Çıkartma komutlardan kaldırıldı!_`,
          },
          {
            quoted: message.quoted,
          }
        );
      if (!deleted && match[1]) {
        const delete_again = await stickcmd.delete(match[1], "command");
        if (delete_again)
          return await message.sendReply(
            `_🗑️ ${match[1]} sabit komutlardan kaldırıldı!_`
          );
        if (!delete_again)
          return await message.sendReply("_❌ Böyle bir çıkartma/komut bulunamadı!_");
      }
      if (!deleted && !match[1])
        return await message.send("_❌ Böyle bir çıkartma bulunamadı!_");
    } else if (match[1] && !message.reply_message) {
      let deleted = await stickcmd.delete(match[1], "command");
      if (deleted)
        return await message.sendReply(
          `_✅ ${match[1]} sabit komutlardan başarıyla kaldırıldı!_`
        );
      if (!deleted)
        return await message.sendReply("_❌ Böyle bir komut bulunamadı!_");
    } else
      return await message.sendReply("_💬 Çıkartmaya yanıt verin veya komut girin!_\n_Ör: *.otoçıkartmasil .ban*_"
      );
  }
);

Module(
  {
    pattern: "otoçıkartmalar ?(.*)",
    fromMe: true,
    desc: "Çıkartmalardaki komutları gösterir",
    use: "tools",
  },
  async (message, match) => {
    const all = await stickcmd.get();
    const commands = all.map((element) => element.dataValues.command);
    const msg = commands.join("_\n_");
    message.sendReply("_*✨ Çıkartma yapılmış komutlar:*_\n\n_" + msg + "_");
  }
);

Module(
  {
    pattern: "otosohbetkapat ?(.*)",
    fromMe: true,
    desc: "Grup sohbetinin otomatik kapanma özelliğini aktif eder.",
    warn: "Sunucu saatine göre çalışır",
    use: "group",
  },
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);
    if (message.fromOwner || adminAccesValidated) {
      match = match[1]?.toLowerCase();
      if (!match)
        return await message.sendReply("*✨ Yanlış format!*\n*.otosohbetkapat 22 00 (Saat 22:00 için)*\n*.otosohbetkapat 06 00 (Saat 06:00 için)*\n*.otosohbetkapat kapat*"
        );
      if (match.includes("am") || match.includes("pm"))
        return await message.sendReply("_⏰ Zaman SS DD (24 saat) formatında olmalıdır (Örn: 22 00)_"
        );
      if (match == "off" || match == "kapat") {
        await automute.delete(message.jid);
        return await message.sendReply("📴 *Otomatik sohbet kapatma devre dışı bırakıldı ❗*"
        );
      }
      const mregex = /[0-2][0-9] [0-5][0-9]/;
      if (mregex.test(match?.match(/(\d+)/g)?.join(" ")) === false)
        return await message.sendReply("*_⚠️ Yanlış format!_\n_.otosohbetkapat 22 00 (Saat 22:00 için)_\n_.otosohbetkapat 06 00 (Saat 06:00 için)_*"
        );
      const admin = await isAdmin(message);
      if (!admin) return await message.sendReply("_❌ Ben yönetici değilim!_");
      await automute.set(message.jid, match.match(/(\d+)/g)?.join(" "));
      await message.sendReply(
        `*_⏰ Grup ${tConvert(
          match.match(/(\d+)/g).join(" ")
        )} saatinde otomatik susturulacak, sistemi yeniden başlatıyorum..._*`
      );
      process.exit(0);
    }
  }
);

Module(
  {
    pattern: "otosohbetaç ?(.*)",
    fromMe: true,
    desc: "Grup sohbetinin otomatik açılma özelliğini aktif eder.",
    warn: "Sunucu saatine göre çalışır",
    use: "group",
  },
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);
    if (message.fromOwner || adminAccesValidated) {
      match = match[1]?.toLowerCase();
      if (!match)
        return await message.sendReply("*_⚠️ Yanlış format!_*\n*_.otosohbetaç 22 00 (Saat 22:00 için)_*\n*_.otosohbetaç 06 00 (Saat 06:00 için)_*\n*_.otosohbetaç kapat_*"
        );
      if (match.includes("am") || match.includes("pm"))
        return await message.sendReply("_⏰ Zaman SS DD (24 saat) formatında olmalıdır (Örn: 08 00)_"
        );
      if (match === "off" || match === "kapat") {
        await autounmute.delete(message.jid);
        return await message.sendReply("*📴 _Otomatik sohbet açma devre dışı bırakıldı ❗_*"
        );
      }
      const mregex2 = /[0-2][0-9] [0-5][0-9]/;
      if (mregex2.test(match?.match(/(\d+)/g)?.join(" ")) === false)
        return await message.sendReply("*_⚠️ Yanlış format!_\n_.otosohbetaç 22 00 (Saat 22:00 için)_\n_.otosohbetaç 06 00 (Saat 06:00 için)_*"
        );
      const admin2 = await isAdmin(message);
      if (!admin2) return await message.sendReply("*❌ Yönetici değilim!*");
      await autounmute.set(message.jid, match?.match(/(\d+)/g)?.join(" "));
      await message.sendReply(
        `*_⏰ Grup ${tConvert(match)} saatinde otomatik açılacak, sistemi yeniden başlatıyorum..._*`
      );
      process.exit(0);
    }
  }
);

Module(
  {
    pattern: "otosohbet ?(.*)",
    fromMe: true,
    desc: "Grup sohbetinin otomatik açılış ve kapanış saatlerini ayarlar. (Örn: .otosohbet 09:00|23:00)",
    use: "group",
  },
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);
    if (message.fromOwner || adminAccesValidated) {
      const mute = await automute.get();
      const unmute = await autounmute.get();
      let msg = "";
      for (e in mute) {
        let temp = unmute.find((element) => element.chat === mute[e].chat);
        if (temp && temp.time) {
          mute[e].unmute = temp.time;
        }
        msg +=
          `*${Math.floor(parseInt(e) + 1)}. Grup:* ${(await message.client.groupMetadata(mute[e].chat)).subject
          }
*➥ Sessizlik:* ${tConvert(mute[e].time)}
*➥ Sessizlik Açılış:* ${tConvert(mute[e].unmute || "Ayarlanmadı")}` + "\n\n";
      }
      if (!msg) return await message.sendReply("_❌ Susturma/Açma kaydı bulunamadı!_");
      message.sendReply("*⏰ Zamanlanmış Susturmalar/Açmalar*\n\n" + msg);
    }
  }
);

Module(
  {
    pattern: "antinumara ?(.*)",
    fromMe: false,
    desc: "Belirli ülke koduna sahip numaraların gruba girişini engeller/yönetir.",
    use: "group",
  },
  async (message, match) => {
    let adminAccesValidated = await isAdmin(message);
    if (message.fromOwner || adminAccesValidated) {
      const adminCheck = await isAdmin(message);
      if (!adminCheck) return await message.sendReply("_❌ Ben yönetici değilim!_");
      if (match[1] === "aç" || match[1] === "on") {
        await antifake.set(message.jid);
        return await message.sendReply("_✅ Anti-Numara açıldı!_");
      }
      if (match[1] === "izinli" || match[1] === "allow") {
        return await message.sendReply(
          `_İzin verilen alan kodları: ${ALLOWED} (tüm gruplar için geçerlidir)_`
        );
      }
      if (match[1] === "kapat" || match[1] === "off") {
        await antifake.delete(message.jid);
        return await message.sendReply("_❌ Anti-Numara kapatıldı!_");
      }
      const db = await antifake.get();
      const jids = [];
      db.map((data) => {
        jids.push(data.jid);
      });
      const status = jids.includes(message.jid) ? "Açık ✅" : "Kapalı ❌";

      const buttons = [
        {
          buttonId: handler + "antinumara aç",
          buttonText: {
            displayText: "Açık",
          },
          type: 1,
        },
        {
          buttonId: handler + "antinumara kapat",
          buttonText: {
            displayText: "Kapalı",
          },
          type: 1,
        },
        {
          buttonId: handler + "antinumara izinli",
          buttonText: {
            displayText: "İzinli Önekler",
          },
          type: 1,
        },
      ];

      const buttonMessage = {
        text: `🚨 *Anti-Numara Kontrol Menüsü*\n\nℹ️ *Mevcut Durum:* ${status}\n\n💬 *Kullanım:* \`.antinumara aç/kapat\``,
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

Module(
  {
    on: "groupParticipants",
    fromMe: false,
  },
  async (message, match) => {
    message.myjid = message.client.user.lid.split(":")[0];
    const db = await antifake.get();
    let sudos = SUDO.split(",");
    const jids = [];
    db.map((data) => {
      jids.push(data.jid);
    });
    const pdmdb = await pdm.get();
    const pdmjids = [];
    pdmdb.map((data) => {
      pdmjids.push(data.jid);
    });
    const apdb = await antipromote.get();
    const apjids = [];
    apdb.map((data) => {
      apjids.push(data.jid);
    });
    const addb = await antidemote.get();
    const adjids = [];
    addb.map((data) => {
      adjids.push(data.jid);
    });
    const admin_jids = [];
    const admins = (await message.client.groupMetadata(message.jid)).participants
      .filter((v) => v.admin !== null)
      .map((x) => x.id);
    admins.map(async (user) => {
      admin_jids.push(user.replace("c.us", "s.whatsapp.net"));
    });
    if (
      (message.action == "promote" || message.action == "demote") &&
      pdmjids.includes(message.jid)
    ) {
      if (message.from.split("@")[0] == message.myjid) return;
      if (message.action == "demote") admin_jids.push(message.participant[0].id);
      await message.client.sendMessage(message.jid, {
        text: `_*[${message.action == "promote" ? "🔔 Yükseltme algılandı" : "🔔 Düşürme algılandı"
          }]*_\n\n@${message.from.split("@")[0]} @${message.participant[0].id.split("@")[0]
          } kişisini ${message.action == "promote" ? "yükseltti" : "düşürdü"}`,
        mentions: admin_jids,
      });
    }
    if (message.action == "promote" && apjids.includes(message.jid)) {
      if (
        message.from.split("@")[0] == message.myjid ||
        sudos.includes(message.from.split("@")[0]) ||
        message.participant[0].id.split("@")[0] == message.myjid ||
        (await isSuperAdmin(message, message.from))
      )
        return;
      const isAdminPromote = await isAdmin(message);
      if (!isAdminPromote) return;
      await message.client.groupParticipantsUpdate(
        message.jid,
        [message.from],
        "demote"
      );
      return await message.client.groupParticipantsUpdate(
        message.jid,
        [message.participant[0].id],
        "demote"
      );
    }
    if (message.action == "demote" && adjids.includes(message.jid)) {
      if (
        message.from.split("@")[0] == message.myjid ||
        sudos.includes(message.from.split("@")[0]) ||
        (await isSuperAdmin(message, message.from))
      )
        return;
      if (message.participant[0].id.split("@")[0] == message.myjid) {
        return await message.client.sendMessage(message.jid, {
          text: `_*❌ Bot yetkisi düşürüldü, geri yükleme yapılamıyor* [Yetki düşüren: @${message.from.split("@")[0]
            }]_`,
          mentions: admin_jids,
        });
      }
      const isAdminDemote = await isAdmin(message);
      if (!isAdminDemote) return;
      await message.client.groupParticipantsUpdate(
        message.jid,
        [message.from],
        "demote"
      );
      return await message.client.groupParticipantsUpdate(
        message.jid,
        [message.participant[0].id],
        "promote"
      );
    }
    if (message.action === "add" && jids.includes(message.jid)) {
      const allowed = ALLOWED.split(",").map((p) => p.trim()).filter(Boolean);
      const participantNumber = message.participant[0].id.split("@")[0];
      const isAllowedNumber = allowed.some((prefix) =>
        participantNumber.startsWith(prefix)
      );
      if (!isAllowedNumber) {
        const isAdminAdd = await isAdmin(message);
        if (!isAdminAdd) return;
        const botId = message.client.user.id.split(":")[0] + "@s.whatsapp.net";
        if (message.participant[0].id !== botId) {
          return await message.client.groupParticipantsUpdate(
            message.jid,
            [message.participant[0].id],
            "remove"
          );
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
