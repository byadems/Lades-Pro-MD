const {
  antifake,
  antibot,
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

Module({
  pattern: "otoçıkartmasil ?(.*)",
  fromMe: false,
  desc: "Çıkartmalardaki komutları siler",
  usage: ".otoçıkartmasil .ban",
  use: "araçlar",
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

Module({
  pattern: "otoçıkartmalar ?(.*)",
  fromMe: false,
  desc: "Çıkartmalardaki komutları gösterir",
  use: "araçlar",
},
  async (message, match) => {
    const all = await stickcmd.get();
    const commands = all.map((element) => element.dataValues.command);
    const msg = commands.join("_\n_");
    message.sendReply("_*✨ Çıkartma yapılmış komutlar:*_\n\n_" + msg + "_");
  }
);

Module({
  pattern: "otosohbetkapat ?(.*)",
  fromMe: true,
  onlyAdmin: true,
  desc: "Grup sohbetinin otomatik kapanma özelliğini aktif eder.",
  warn: "Sunucu saatine göre çalışır",
  use: "grup",
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
      if (match == "kapat") {
        await automute.delete(message.jid);
        return await message.sendReply("📴 *Otomatik sohbet kapatma devre dışı bırakıldı ❗*"
        );
      }
      const mregex = /[0-2][0-9] [0-5][0-9]/;
      if (mregex.test(match?.match(/(\d+)/g)?.join(" ")) === false)
        return await message.sendReply("*_⚠️ Yanlış format!_\n_.otosohbetkapat 22 00 (Saat 22:00 için)_\n_.otosohbetkapat 06 00 (Saat 06:00 için)_*"
        );
      const admin = await isAdmin(message);
      if (!admin) return await message.sendReply("🙁 _Üzgünüm! Öncelikle yönetici olmalısınız._");
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

Module({
  pattern: "otosohbetaç ?(.*)",
  fromMe: true,
  onlyAdmin: true,
  desc: "Grup sohbetinin otomatik açılma özelliğini aktif eder.",
  warn: "Sunucu saatine göre çalışır",
  use: "grup",
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
      if (match === "kapat") {
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

Module({
  pattern: "otosohbet ?(.*)",
  fromMe: true,
  onlyAdmin: true,
  desc: "Grup sohbetinin otomatik açılış ve kapanış saatlerini ayarlar. (Örn: .otosohbet 09:00|23:00)",
  use: "grup",
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

Module({
  on: "groupParticipants",
  fromMe: false,
},
  async (message, match) => {
    message.myjid = message.client.user.lid ? message.client.user.lid.split(":")[0] : message.client.user.id.split(":")[0];
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
      .map((x) => x.id.split(":")[0] + "@s.whatsapp.net");
    admins.map(async (user) => {
      admin_jids.push(user);
    });
    if (
      (message.action == "promote" || message.action == "demote") &&
      pdmjids.includes(message.jid)
    ) {
      if (message.from.split("@")[0] == message.myjid) return;
      const targetUser = typeof message.participant[0] === "string" ? message.participant[0] : message.participant[0].id;
      if (message.action == "demote") admin_jids.push(targetUser);
      await message.client.sendMessage(message.jid, {
        text: `_*[${message.action == "promote" ? "🔔 Yükseltme algılandı" : "🔔 Düşürme algılandı"
          }]*_\n\n@${message.from.split("@")[0]} @${targetUser.split("@")[0]
          } kişisini ${message.action == "promote" ? "yükseltti" : "düşürdü"}`,
        mentions: admin_jids,
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
          text: `_*❌ Bot yetkisi düşürüldü, geri yükleme yapılamıyor* [Yetki düşüren: @${message.from.split("@")[0]
            }]_`,
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
        const { isBotIdentifier } = require("./utils/lid-helper");
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
          const { resolveLidToPn } = require("../core/lid-helper");
          const resolvedPn = await resolveLidToPn(message.client, participantId);
          if (resolvedPn && resolvedPn !== participantId) {
            participantId = resolvedPn;
            isLid = false; // Başarıyla PN'ye çevrildi
          }
        } catch (e) { }
      }

      // ALTERNATİF: LID çözülemediyse ve yönetici bypassından geçtiysek bu kişi kendi kendine linkle girmiştir.
      // O halde 'message.from' (hareketi yapan) alanındaki veri kişinin gerçek telefon numarasıdır!
      if (isLid && message.from && message.from.includes("@s.whatsapp.net")) {
        participantId = message.from;
      }

      // KÖKTEN ÇÖZÜM: 'if (isLid) return;' kapatıldı. Artık LID numarasıyla katılıp
      // numarası tespit edilemeyen kişiler de "güvenlik ihlali / yabancı numara" sayılarak
      // taviz verilmeden gruptan atılacaktır. Sistem %100 herkezi tarayacaktır.

      // KÖKTEN ÇÖZÜM: LID ve PN her koşulda inceleniyor
      const participantNumber = participantId.split("@")[0];
      const isAllowedNumber = allowed.some((prefix) =>
        participantNumber.startsWith(prefix)
      );

      // Yabancı numara veya çözülemeyen LID tespit edildi
      if (!isAllowedNumber) {
        const { isBotIdentifier } = require("./utils/lid-helper");

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
          text: `🚨 *Anti-Numara Koruması!*\n\n🛡️ _İzin verilmeyen bir numara tespit ettim._\n🧹 _Gruptan uzaklaştırıyorum..._`
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

