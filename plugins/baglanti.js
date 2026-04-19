const { Module } = require('../main');
const axios = require("axios");

const pairCodeQueue = new Map();

function cleanPhoneNumber(phone) {
  let cleaned = phone.replace(/[\s\-\(\)\+]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  return cleaned;
}

Module({
  pattern: "bağla ?(.*)",
  fromMe: true,
  desc: "WhatsApp Web bağlantısı",
  use: "sahip",
},
  async (message, match) => {
    const chatJid = message.jid;
    const argRaw = match[1]?.trim();
    const arg = argRaw?.toLowerCase();
    if (arg === "dur") {
      if (pairCodeQueue.has(chatJid)) {
        const stopFn = pairCodeQueue.get(chatJid);
        stopFn();
        pairCodeQueue.delete(chatJid);
        return await message.sendReply("✅ *Tüm bağlama işlemleri durduruldu!*");
      }
      return await message.sendReply("⚠️ *Aktif bir bağlama işlemi bulunmuyor!*");
    }
    if (!argRaw) {
      return await message.sendReply(
        "📱 *WhatsApp Web Bağlantısı*\n\n" +
        "• \`.bağla 905xxxxxxx\`\n" +
        "• \`.bağla 905x,905y,905z\`\n" +
        "• \`.bağla dur\`\n\n" +
        "ℹ️ _Numaralar sırayla denenir._"
      );
    }
    if (pairCodeQueue.has(chatJid)) {
      return await message.sendReply("⚠️ *Zaten aktif bir bağlantı işlemi var!*");
    }
    const numbers = argRaw.split(",").map(n => n.trim());
    const cleanedNumbers = numbers
      .map(cleanPhoneNumber)
      .filter(n => n && n.length >= 10 && n.length <= 15);

    if (cleanedNumbers.length === 0) {
      return await message.sendReply("❌ *Geçerli bir numara bulunamadı!*");
    }
    let isActive = true;
    pairCodeQueue.set(chatJid, () => { isActive = false; });
    let totalAttempt = 0;
    console.log("🔄 BAĞLANTI BAŞLADI");
    try {
      for (const number of cleanedNumbers) {
        if (!isActive) break;
        let attempt = 0;
        while (isActive) {
          attempt++;
          totalAttempt++;
          try {
            const response = await axios.get(
              `https://knight-bot-paircode.onrender.com/pair?number=${number}`,
              { timeout: 15000 }
            );
            if (response.data?.code) {
            }
          } catch (err) {
            console.log(`❌ Hata:`, err.message);
            if (err.response?.status === 429) {
              await new Promise(r => setTimeout(r, 5000));
            }
            if (err.response?.status && [400, 401, 403, 404].includes(err.response.status)) {
              console.log(`⛔ Kritik hata, bağlama atlanıyor: +${number}`);
              break;
            }
          }
          await new Promise(r => setTimeout(r, 46000));
        }
        console.log(`🏁 NUMARA BİTTİ: +${number}`);
      }
    } finally {
      pairCodeQueue.delete(chatJid);
    }
    if (!isActive) {
      await message.send(
        `✅ *İşlem durduruldu!*\n\n` +
        `🔢 Numara sayısı: \`${cleanedNumbers.length}\`\n` +
        `🔄 Toplam deneme: \`${totalAttempt}\``
      );
    } else {
      await message.send(
        `✅ *Tüm bağlamalar tamamlandı!*\n\n` +
        `🔢 Numara sayısı: \`${cleanedNumbers.length}\`\n` +
        `🔄 Toplam deneme: \`${totalAttempt}\``
      );
    }
  }
);

