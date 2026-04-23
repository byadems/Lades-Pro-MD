const { Module } = require("../main");
const config = require("../config");
const { ADMIN_ACCESS, HANDLER_PREFIX, WARN, SUDO } = config;
const {
  uyariGetir,
  uyariEkle,
  uyariSifirla,
  uyariAzalt,
  uyariSayisiAl,
  tumUyarilariAl,
  censorBadWords,
  isAdmin,
} = require("./utils");
const { getGroupSettings, updateGroupSettings } = require("../core/db-cache");
const { getNumericId, isBotIdentifier } = require("./utils/lid_yardimcisi");
const fs = require("fs");
const path = require("path");

const handler = HANDLER_PREFIX;
const globalWarnLimit = parseInt(WARN || "3");
const sudoUsers = (SUDO || "").split(",");

async function sendBanAudio(message) {
  const audioPath = path.join(__dirname, "utils", "sounds", "Ban.mp3");
  try {
    if (!fs.existsSync(audioPath)) return;
    await message.sendMessage(fs.readFileSync(audioPath), "audio", { ptt: true });
  } catch (err) { }
}

Module({
  pattern: "uyar(.*)",
  fromMe: false,
  desc: "Grup üyelerini uyarmaya yarar. Belirlenen uyarı limitine ulaşıldığında üye otomatik olarak gruptan uzaklaştırılır.",
  usage: ".uyar [@üye] [sebep] | .uyarısil | .uyarısıfırla | .uyarıliste | .uyarılimit [sayı]",
  use: "grup",
},
  async (message, match) => {
    // match[1], "uyar" kelimesinden sonra gelen kısımdır. 
    const cmd = match[1] ? match[1].toLowerCase().trim() : "";

    if (!message.isGroup)
      return await message.sendReply("❌ *Bu komut yalnızca gruplarda çalışır!*");

    const userIsAdmin = await isAdmin(message);
    if (!userIsAdmin)
      return await message.sendReply("🙁 _Üzgünüm! Öncelikle yönetici olmalısınız._");

    // Bot'un kendisinin admin olup olmadığını kontrol et (mesajı gönderenden bağımsız)
    const botIsAdmin = message.isBotAdmin ?? (() => {
      try {
        if (!message.groupAdmins) return false;
        const { isBotIdentifier } = require("./utils/lid_yardimcisi");
        return message.groupAdmins.some(a => isBotIdentifier(a, message.client));
      } catch { return false; }
    })();
    if (!botIsAdmin) {
      return await message.sendReply("❌ *İşlem yapabilmem için yönetici olmam gerekiyor!*");
    }

    const settings = await getGroupSettings(message.jid);
    const warnLimit = settings.warnLimit || globalWarnLimit;

    // ─────────────────────────────────────────────────────────
    //  ALT KOMUTLAR (Sub-commands)
    // ─────────────────────────────────────────────────────────

    // MIGRATION: LID Çevirisi (Ortak yardımcı fonksiyon)
    async function resolveTargetUser(user) {
      if (user && user.includes("@lid")) {
        try {
          const { resolveLidToPn } = require("../core/yardimcilar");
          const pn = await resolveLidToPn(message.client, user);
          if (pn && pn !== user) return pn;
        } catch (e) { }
      }
      return user;
    }

    // 1. UYARISİL (.uyarısil)
    if (cmd.startsWith("ısil")) {
      let targetUser = message.mention?.[0] || message.reply_message?.jid;
      if (!targetUser) return await message.sendReply("⚠️ *Lütfen bir üye etiketleyin veya mesajına yanıtlayın!*");
      targetUser = await resolveTargetUser(targetUser);

      const targetNumericId = getNumericId(targetUser);
      try {
        const currentCount = await uyariSayisiAl(message.jid, targetUser);
        if (currentCount === 0) {
          return await message.client.sendMessage(message.jid, {
            text: `🥳 *Hiç uyarısı yok!*\n\n👤 Üye: \`@${targetNumericId}\`\nℹ️ Durumu: \`Silinecek uyarı bulunamadı\``,
            mentions: [targetUser],
          });
        }
        const removed = await uyariAzalt(message.jid, targetUser);
        if (removed) {
          const newCount = await uyariSayisiAl(message.jid, targetUser);
          await message.client.sendMessage(message.jid, {
            text: `✅ *UYARI SİLİNDİ!*\n\n👤 Üye: *@${targetNumericId}*\n⛔ Silinen: \`1 uyarı\`\n🔢 Kalan: \`${newCount} uyarı\`\nℹ️ Durumu: *${newCount === 0 ? "SİCİLİ TEMİZ 😎" : "Hâlâ uyarısı mevcut"}*`,
            mentions: [targetUser],
          });
        }
      } catch (error) {
        await message.sendReply("❌ *İşlem sırasında hata oluştu!*");
      }
      return;
    }

    // 2. UYARISIFIRLA (.uyarısıfırla)
    if (cmd.startsWith("ısıfırla")) {
      let targetUser = message.mention?.[0] || message.reply_message?.jid;
      if (!targetUser) return await message.sendReply("⚠️ *Lütfen bir üyeyi etiketleyin veya mesajına yanıt verin!*");
      targetUser = await resolveTargetUser(targetUser);

      const targetNumericId = getNumericId(targetUser);
      try {
        const currentCount = await uyariSayisiAl(message.jid, targetUser);
        if (currentCount === 0) {
          return await message.client.sendMessage(message.jid, {
            text: `🤯 *UYARI BULUNAMADI!*\n\n👤 Üye: *@${targetNumericId}*\nℹ️ Durumu: \`Sıfırlanacak uyarı yok\``,
            mentions: [targetUser],
          });
        }
        const removed = await uyariSifirla(message.jid, targetUser);
        if (removed) {
          await message.client.sendMessage(message.jid, {
            text: `✅ *Uyarılar Sıfırlandı!*\n\n👤 Üye: *@${targetNumericId}*\n🔢 Sıfırlanan: \`${currentCount} uyarı\`\nℹ️ Durumu: *SİCİLİ TEMİZ* 😎`,
            mentions: [targetUser],
          });
        }
      } catch (error) {
        await message.sendReply("❌ *İşlem sırasında hata oluştu!*");
      }
      return;
    }

    // 3. UYARILİSTE (.uyarıliste)
    if (cmd.startsWith("ıliste")) {
      try {
        const allWarnings = await tumUyarilariAl(message.jid);
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
        await message.sendReply("❌ *Liste alınamadı!*");
      }
      return;
    }

    // 4. UYARILİMİT (.uyarılimit)
    if (cmd.startsWith("ılimit")) {
      const textArg = match[1].replace(/ılimit/i, "").trim();
      const newLimit = parseInt(textArg);
      if (!newLimit || newLimit < 1 || newLimit > 20) {
        return await message.sendReply(`⚠️ *Geçersiz Uyarı Limiti!*\n\n- Lütfen 1 ile 20 arasında bir miktar girin.\n- Mevcut limit: \`${warnLimit}\`\n\n💬 *Kullanım:* \`${handler}uyarılimit 5\``);
      }
      await updateGroupSettings(message.jid, { warnLimit: newLimit });
      await message.sendReply(`✅ *Uyarı Limiti Güncellendi!*\n\n- Yeni limit: \`${newLimit}\`\n- Önceki limit: \`${warnLimit}\`\n\nℹ️ _Üyeler artık ${newLimit} uyarıdan sonra gruptan atılacak._`);
      return;
    }

    // ─────────────────────────────────────────────────────────
    //  5. VARSAYILAN: UYAR (.uyar)
    // ─────────────────────────────────────────────────────────
    let targetUser = message.mention?.[0] || message.reply_message?.jid;
    if (!targetUser) {
      return await message.sendReply(
        `⚠️ *Lütfen bir üyeyi etiketleyin veya mesajına yanıt verin!*\n\n` +
        `🔻 *Kullanımı:* \n` +
        `• \`${handler}uyar @üye sebep\` _- Uyarmaya yarar_\n` +
        `• \`${handler}kaçuyarı @üye\` _- Uyarı sayısını gösterir_\n` +
        `• \`${handler}uyarısil @üye\` _- 1 uyarıyı siler_\n` +
        `• \`${handler}uyarısıfırla @üye\` _- Tüm uyarıları sıfırlar_\n` +
        `• \`${handler}uyarılimit\` _- Maksimum uyarı limitini belirler_`
      );
    }
    targetUser = await resolveTargetUser(targetUser);

    // Üyelik kontrolü: Kullanıcı grupta mı?
    const groupMetadata = await message.client.groupMetadata(message.jid);
    const isParticipant = groupMetadata.participants.some(p => p.id === targetUser);
    if (!isParticipant) {
      const targetNumericId = getNumericId(targetUser);
      return await message.client.sendMessage(message.jid, { text: `❌ *İşlem Başarısız!* \n\n👤 Üye: *@${targetNumericId}*\nℹ️ Durum: \`Grupta bulunmuyor\`\n\n_Grupta olmayan birine nasıl uyarı verebilirim?_`, mentions: [targetUser] }, { quoted: message.data });
    }

    const isTargetAdmin = Array.isArray(message.groupAdmins) && message.groupAdmins.includes(targetUser);
    if (isTargetAdmin) return await message.sendReply("❗ _OPS! Yöneticiler uyarılamaz._");

    const targetNumericId = getNumericId(targetUser);
    if (sudoUsers.includes(targetNumericId)) return await message.sendReply("❗ _OPS! Bot geliştiricisi uyarılamaz._");

    let rawReason = match[1] || "Sebep belirtilmedi";
    const mentionRegex = new RegExp(`@${targetNumericId}\\s*`, "g");
    const reason = censorBadWords(rawReason.replace(mentionRegex, "").trim() || "Sebep belirtilmedi");

    try {
      // Ön-limit kontrolü: Yeni uyarı eklemeden önce mevcut durumu kontrol et
      const currentCountBefore = await uyariSayisiAl(message.jid, targetUser);
      if (currentCountBefore >= warnLimit) {
        if (isBotIdentifier(targetUser, message.client)) return await message.sendReply("❌ *Kendimi atacak kadar delirmedim. 😉*");

        await message.client.sendMessage(message.jid, {
          text: `⚠️ *LİMİT ZATEN DOLMUŞ!*\n\n👤 Üye: *@${targetNumericId}*\n🔢 Mevcut Uyarı: \`${currentCountBefore}/${warnLimit}\`\n\n_Bu üye zaten sınırda. Tekrardan gruptan çıkarma işlemi deneniyor..._`,
          mentions: [targetUser],
        });

        try {
          await message.client.groupParticipantsUpdate(message.jid, [targetUser], "remove");
          await sendBanAudio(message);
          return;
        } catch (e) {
          return await message.sendReply("❌ *Üye zaten limiti doldurmuş fakat gruptan atılamamış!* _Lütfen yönetici yetkimi kontrol edin._");
        }
      }

      // message.sender boş olabilir, fallback uygula
      const warnedBy = message.sender || message.jid || "system";
      const setResult = await uyariEkle(message.jid, targetUser, reason, warnedBy);

      // setWarn false döndürürse doğrudan getWarn ile kontrol et
      let warnData = (setResult && typeof setResult === "object" && "exceeded" in setResult)
        ? setResult
        : await uyariGetir(message.jid, targetUser, warnLimit);

      if (!warnData) return await message.sendReply("❌ *Uyarı kaydedilemedi!*");

      const currentWarns = warnData.current;
      const remaining = warnData.kalan ?? warnData.remaining;

      if (warnData.exceeded) {
        if (isBotIdentifier(targetUser, message.client)) return await message.sendReply("❌ *Kendimi atacak kadar delirmedim. 😉*");
        try {
          await message.client.groupParticipantsUpdate(message.jid, [targetUser], "remove");
          await sendBanAudio(message);
          await message.client.sendMessage(message.jid, {
            text: `⚠️ *UYARI LİMİTİ AŞILDI!*\n\n👤 Üye: *@${targetNumericId}*\n🤔 Sebep: \`${reason}\`\n🔢 Uyarı Sayısı: \`${currentWarns}/${warnLimit}\`\n👋🏻 İşlem: \`Gruptan çıkarılma\`\n\n🧹 _Limit dolduğu için üye atıldı._`,
            mentions: [targetUser],
          });
        } catch (e) {
          await message.sendReply("❌ *Üyeyi gruptan atamadım!* _Lütfen yetkimi kontrol edin._");
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
      await message.sendReply("❌ *Uyarı verilemedi!* _Lütfen tekrar deneyin._");
    }
  }
);

Module({
  pattern: "kaçuyarı ?(.*)",
  fromMe: false,
  desc: "Bir üyenin toplamda kaç uyarı aldığını ve uyarı geçmişini detaylıca listeler.",
  usage: ".kaçuyarı [@üye]",
  use: "grup",
},
  async (message) => {
    if (!message.isGroup)
      return await message.sendReply("❌ *Bu komut yalnızca gruplarda çalışır!*");

    const settings = await getGroupSettings(message.jid);
    const warnLimit = settings.warnLimit || globalWarnLimit;

    let targetUser = message.mention?.[0] || message.reply_message?.jid || message.sender;

    // MIGRATION: LID Çevirisi
    if (targetUser && targetUser.includes("@lid")) {
      try {
        const { resolveLidToPn } = require("../core/yardimcilar");
        const pn = await resolveLidToPn(message.client, targetUser);
        if (pn && pn !== targetUser) targetUser = pn;
      } catch (e) { }
    }

    const targetNumericId = getNumericId(targetUser);

    try {
      const warnings = await uyariGetir(message.jid, targetUser);
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
      await message.sendReply("❌ *Uyarıları alamadım!* _Lütfen tekrar deneyin._");
    }
  }
);

