const { Module } = require("../main");
const { getString } = require("./utils/lang");
const Lang = getString("group");
const config = require("../config");
const { ADMIN_ACCESS, HANDLER_PREFIX, WARN, SUDO } = config;
const {
  getWarn,
  setWarn,
  resetWarn,
  decrementWarn,
  getWarnCount,
  getAllWarns,
  censorBadWords,
  isAdmin,
} = require("./utils");
const { getNumericId, isBotIdentifier } = require("./utils/lid-helper");
const fs = require("fs");
const path = require("path");

const handler = HANDLER_PREFIX;
const warnLimit = parseInt(WARN || "4");
const sudoUsers = (SUDO || "").split(",");

async function sendBanAudio(message) {
  const audioPath = path.join(__dirname, "utils", "sounds", "Ban.mp3");
  try {
    if (!fs.existsSync(audioPath)) return;
    const stream = fs.createReadStream(audioPath);
    try {
      await message.send({ stream }, "audio");
    } finally {
      stream.destroy();
    }
  } catch (err) { }
}

Module(
  {
    pattern: "uyar(.*)",
    fromMe: true,
    desc: "Grup üyelerini uyarmaya yarar. Limit aşıldığında üye gruptan atılır.",
    usage: ".uyar @üye sebep\n.uyar sebep",
    use: "group",
  },
  async (message, match) => {
    // match[1], "uyar" kelimesinden sonra gelen kısımdır. 
    const cmd = match[1] ? match[1].toLowerCase().trim() : "";

    if (!message.isGroup)
      return await message.sendReply("❌ _Bu komut sadece gruplarda kullanılabilir!_");

    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin)
      return await message.sendReply(Lang.NEED_ADMIN);

    const botIsAdmin = await isAdmin(message);
    if (!botIsAdmin) {
      return await message.sendReply("❌ _İşlem yapabilmem için öncelikle yönetici olmam gerekiyor!_");
    }

    // ─────────────────────────────────────────────────────────
    //  ALT KOMUTLAR (Sub-commands)
    // ─────────────────────────────────────────────────────────

    // 1. UYARISİL (.uyarısil)
    if (cmd === "ısil") {
      const targetUser = message.mention?.[0] || message.reply_message?.jid;
      if (!targetUser) return await message.sendReply("❗ _Lütfen bir üye etiketleyin veya mesajına yanıtlayın!_");

      const targetNumericId = getNumericId(targetUser);
      try {
        const currentCount = await getWarnCount(message.jid, targetUser);
        if (currentCount === 0) {
          return await message.client.sendMessage(message.jid, {
            text: `🥳 *Hiç uyarısı yok!*\n\n👤 Üye: \`@${targetNumericId}\`\nℹ️ Durumu: \`Silinecek uyarı bulunamadı\``,
            mentions: [targetUser],
          });
        }
        const removed = await decrementWarn(message.jid, targetUser);
        if (removed) {
          const newCount = await getWarnCount(message.jid, targetUser);
          await message.client.sendMessage(message.jid, {
            text: `✅ *UYARI SİLİNDİ!*\n\n👤 Üye: *@${targetNumericId}*\n⛔ Silinen: \`1 uyarı\`\n🔢 Kalan: \`${newCount} uyarı\`\nℹ️ Durumu: *${newCount === 0 ? "SİCİLİ TEMİZ 😎" : "Hâlâ uyarısı mevcut"}*`,
            mentions: [targetUser],
          });
        }
      } catch (error) {
        await message.sendReply("❌ *İşlem sırasında hata oluştu.*");
      }
      return;
    }

    // 2. UYARISIFIRLA (.uyarısıfırla)
    if (cmd === "ısıfırla") {
      const targetUser = message.mention?.[0] || message.reply_message?.jid;
      if (!targetUser) return await message.sendReply("❗ _Lütfen bir üyeyi etiketleyin veya mesajına yanıt verin!_");

      const targetNumericId = getNumericId(targetUser);
      try {
        const currentCount = await getWarnCount(message.jid, targetUser);
        if (currentCount === 0) {
          return await message.client.sendMessage(message.jid, {
            text: `🤯 *UYARI BULUNAMADI!*\n\n👤 Üye: *@${targetNumericId}*\nℹ️ Durumu: \`Sıfırlanacak uyarı yok\``,
            mentions: [targetUser],
          });
        }
        const removed = await resetWarn(message.jid, targetUser);
        if (removed) {
          await message.client.sendMessage(message.jid, {
            text: `✅ *Uyarılar Sıfırlandı!*\n\n👤 Üye: *@${targetNumericId}*\n🔢 Sıfırlanan: \`${currentCount} uyarı\`\nℹ️ Durumu: *SİCİLİ TEMİZ* 😎`,
            mentions: [targetUser],
          });
        }
      } catch (error) {
        await message.sendReply("❌ *İşlem sırasında hata oluştu.*");
      }
      return;
    }

    // 3. UYARILİSTE (.uyarıliste)
    if (cmd === "ıliste") {
      try {
        const allWarnings = await getAllWarns(message.jid);
        if (Object.keys(allWarnings).length === 0) {
          return await message.sendReply(`✅ *GRUP TEMİZ!*\n\n🎉 Bu grupta uyarı alan üye göremedim.\n💯 _Herkes kurallara uyuyor, böyle devam!_ 😎`);
        }
        const sortedUsers = Object.entries(allWarnings).sort(([, a], [, b]) => b.length - a.length);
        let warnList = `📋 *Grup Uyarı Listesi*\n\n📊 _Toplam uyarılan üye sayısı: *${sortedUsers.length}*_\n\n⚠️ Uyarı limiti: \`${warnLimit}\`\n\n`;
        let mentions = [];
        sortedUsers.forEach(([userJid, userWarnings], index) => {
          const userNumericId = userJid?.split("@")[0];
          const warnCount = userWarnings.length;
          const remaining = warnLimit - warnCount;
          const status = remaining <= 0 ? "🚫 LİMİT AŞILDI!" : remaining === 1 ? "⚠️ SON UYARI" : `🔢 ${remaining} hak kaldı`;
          warnList += `*${index + 1}.* 👤 @${userNumericId}\n   🧾 _Uyarılar: \`${warnCount}/${warnLimit}\`_\n   📌 _Durum: ${status}_\n`;
          if (userWarnings.length > 0) {
            const latestWarning = userWarnings[0];
            warnList += `   🕒 _Son Uyarı Sebebi: ${latestWarning.reason.substring(0, 30)}${latestWarning.reason.length > 30 ? "..." : ""}_\n`;
          }
          warnList += "\n";
          mentions.push(userJid);
        });
        warnList += `ℹ️ _Detaylı uyarı geçmişi için: ${handler}kaçuyarı @üye_`;
        await message.client.sendMessage(message.jid, { text: warnList, mentions });
      } catch (error) {
        await message.sendReply("❌ _Liste alınamadı._");
      }
      return;
    }

    // 4. UYARILİMİT (.uyarılimit)
    if (cmd === "ılimit") {
      const textArg = match[1].replace(/ılimit/i, "").trim();
      const newLimit = parseInt(textArg);
      if (!newLimit || newLimit < 1 || newLimit > 20) {
        return await message.sendReply(`⚠ *Geçersiz Uyarı Limiti!*\n\n- Lütfen 1 ile 20 arasında bir miktar girin.\n- Mevcut limit: \`${warnLimit}\`\n\n💬 *Kullanım:* \`${handler}uyarılimit 5\``);
      }
      await message.sendReply(`✅ *Uyarı Limiti Güncellendi!*\n\n- Yeni limit: \`${newLimit}\`\n- Önceki limit: \`${warnLimit}\`\n\nℹ _Üyeler artık ${newLimit} uyarıdan sonra gruptan atılacak._`);
      return;
    }

    // ─────────────────────────────────────────────────────────
    //  5. VARSAYILAN: UYAR (.uyar)
    // ─────────────────────────────────────────────────────────
    const targetUser = message.mention?.[0] || message.reply_message?.jid;
    if (!targetUser) {
      return await message.sendReply(
        `❗ _Lütfen bir üyeyi etiketleyin veya mesajına yanıt verin!_\n\n` +
        `🔻 *Kullanımı:* \n` +
        `• \`${handler}uyar @üye sebep\` - Uyarmaya yarar\n` +
        `• \`${handler}kaçuyarı @üye\` - Uyarı sayısını gösterir\n` +
        `• \`${handler}uyarısil @üye\` - 1 uyarıyı siler\n` +
        `• \`${handler}uyarısıfırla @üye\` - Tüm uyarıları sıfırlar\n` +
        `• \`${handler}uyarılimit\` - Maksimum uyarı limitini belirler`
      );
    }
    const isTargetAdmin = message.groupAdmins.includes(targetUser);
    if (isTargetAdmin) return await message.sendReply("❗ _OPS! Yöneticiler uyarılamaz._");

    const targetNumericId = getNumericId(targetUser);
    if (sudoUsers.includes(targetNumericId)) return await message.sendReply("❗ _OPS! Bot geliştiricisi uyarılamaz._");

    let rawReason = match[1] || "Sebep belirtilmedi";
    const mentionRegex = new RegExp(`@${targetNumericId}\\s*`, "g");
    const reason = censorBadWords(rawReason.replace(mentionRegex, "").trim() || "Sebep belirtilmedi");

    try {
      await setWarn(message.jid, targetUser, reason, message.sender);
      const warnData = await getWarn(message.jid, targetUser, warnLimit);
      const currentWarns = warnData.current;
      const remaining = warnData.kalan ?? warnData.remaining;

      if (warnData.exceeded) {
        if (isBotIdentifier(targetUser, message.client)) return await message.sendReply("❌ _Kendimi atacak kadar delirmedim. 😉_");
        try {
          await message.client.groupParticipantsUpdate(message.jid, [targetUser], "remove");
          await sendBanAudio(message);
          await message.client.sendMessage(message.jid, {
            text: `⚠ *UYARI LİMİTİ AŞILDI!*\n\n👤 Üye: *@${targetNumericId}*\n🤔 Sebep: \`${reason}\`\n🔢 Uyarı Sayısı: \`${currentWarns}/${warnLimit}\`\n👋🏻 İşlem: \`Gruptan çıkarılma\`\n\n🧹 _Limit dolduğu için üye atıldı._`,
            mentions: [targetUser],
          });
        } catch (e) {
          await message.sendReply("⚠️ _Üyeyi atamadım, yetkimi kontrol edin._");
        }
      } else {
        const warnText = `⚠ *UYARI!*\n\n` +
          `👤 Üye: @${targetNumericId}\n` +
          `🤔 Sebep: \`${reason}\`\n` +
          `🔢 Uyarı Sayısı: \`${currentWarns}/${warnLimit}\`\n` +
          `⏳ Kalan Hakkı: \`${remaining}\`\n\n` +
          `${remaining === 1 ? "🫡 _Bir uyarı daha alırsa atılacak!_" : `🫡 _${remaining} uyarı sonra atılacak._`}`;

        await message.client.sendMessage(message.jid, {
          text: warnText,
          mentions: [targetUser],
        });
      }
    } catch (error) {
      console.error("Uyarı hatası:", error);
      await message.sendReply("❌ _Uyarı verilemedi! Lütfen tekrar deneyin._");
    }
  }
);

Module({
    pattern: "kaçuyarı ?(.*)",
    fromMe: false,
    desc: "Bir üyenin uyarılarını kontrol etmeyi sağlar.",
    usage: ".kaçuyarı @üye",
    use: "group",
  },
  async (message) => {
    if (!message.isGroup)
      return await message.sendReply("❌ _Bu komut sadece gruplarda kullanılabilir!_");

    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin)
      return await message.sendReply(Lang.NEED_ADMIN);

    const targetUser = message.mention?.[0] || message.reply_message?.jid || message.sender;
    const targetNumericId = getNumericId(targetUser);

    try {
      const warnings = await getWarn(message.jid, targetUser);
      if (!warnings || warnings.length === 0) {
        return await message.client.sendMessage(message.jid, {
          text: `✅ *UYARI BULUNAMADI!*\n\n👤 Üye: *@${targetNumericId}*\nℹ️ Durumu: *SİCİLİ TEMİZ* 😎\n🔢 Uyarı Sayısı: \`0/${warnLimit}\``,
          mentions: [targetUser],
        });
      }

      const currentWarns = warnings.length;
      const remaining = warnLimit - currentWarns;

      let warningsList = `📋 *UYARI GEÇMİŞİ*\n\n👤 Üye: *@${targetNumericId}*\n🔢 Toplam Uyarı: \`${currentWarns}/${warnLimit}\`\n🥲 Kalan Hakkı: \`${remaining > 0 ? remaining : 0}\`\n\n`;
      warnings.slice(0, 5).forEach((warn, index) => {
        const date = new Date(warn.timestamp).toLocaleString();
        const warnedByNumeric = getNumericId(warn.warnedBy);
        warningsList += `🤔 Sebep: *${index + 1}.* ${warn.reason}\n   👀 _Uyarıyı Veren:_ @${warnedByNumeric}\n   📅 _Tarih: *${date}*_\n\n`;
      });

      if (warnings.length > 5) warningsList += `_... ve ${warnings.length - 5} uyarı daha görünüyor._ 🧐\n\n`;
      if (remaining <= 0) warningsList += `🫢 _Kullanıcı uyarı limitini aştı!_`;
      else if (remaining === 1) warningsList += `🥲 _Bir sonraki uyarıda atılacak!_`;

      await message.client.sendMessage(message.jid, {
        text: warningsList,
        mentions: [targetUser, ...warnings.slice(0, 5).map((w) => w.warnedBy)],
      });
    } catch (error) {
      console.error("Uyarı kontrol hatası:", error);
      await message.sendReply("⚠️ _Uyarıları alamadım! Tekrar deneyin._");
    }
  }
);
