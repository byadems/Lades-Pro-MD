const { Module } = require("../main");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const fsPromises = fs.promises;
const Path = require("path");
const config = require("../config");

const RBG_KEYS = ["VwXQes36L5fpTjmMiFpwsy3W", "mkxdVteyNZZhx7fb6y6yqQ6o"];

function getFileNameFromUrl(url, defaultName = "arkaplan") {
  try {
    const parsed = new URL(url);
    let filename = Path.basename(parsed.pathname);
    if (!Path.extname(filename)) filename += ".jpg";
    return filename;
  } catch {
    return `${defaultName}.jpg`;
  }
}

function getDateBasedName(prefix = "Arkaplan") {
  const date = new Date();
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const HH = String(date.getHours()).padStart(2, "0");
  const MM = String(date.getMinutes()).padStart(2, "0");
  const SS = String(date.getSeconds()).padStart(2, "0");
  return `${prefix}-${yyyy}${mm}${dd}_${HH}${MM}${SS}`;
}

Module({
    pattern: "apsil ?(.*)",
    fromMe: false,
    desc: `Yapay zeka kullanarak görüntünün arka planını kaldırır veya düz renk/resim ile değiştirir.
👤 *Kullanım Örnekleri:*
• .apsil                → Arka planı şeffaf (kaldırır)
• .apsil mavi           → Arkaplan mavi
• .apsil #ff0000        → Arkaplan kırmızı (hex kodu)
• .apsil https://resim  → Arkaplan olarak URL'deki fotoğrafı kullan`,
    use: "ai",
  },
  async (message, match) => {
    if (!message.reply_message?.image && !message.reply_message?.document) {
      return await message.send(
        "❗ _Bir fotoğrafa veya belgeye yanıtlayarak yazınız._\n💬 Örnek: `.apsil`\n`.apsil kırmızı`\n`.apsil #00ff00`\n`.apsil https://...`"
      );
    }

    const colorMap = {
      kırmızı: "ff0000",
      red: "ff0000",
      mavi: "0000ff",
      blue: "0000ff",
      yeşil: "00ff00",
      green: "00ff00",
      sarı: "ffff00",
      yellow: "ffff00",
      mor: "800080",
      purple: "800080",
      pembe: "ff69b4",
      pink: "ff69b4",
      turuncu: "ffa500",
      orange: "ffa500",
      siyah: "000000",
      black: "000000",
      beyaz: "ffffff",
      white: "ffffff",
      gri: "808080",
      gray: "808080",
      grey: "808080",
    };

    let userInput = "";
    if (typeof match === "string") userInput = match.trim().toLowerCase();
    else if (Array.isArray(match) && match[1]) userInput = match[1].trim().toLowerCase();

    let bgColor = null;
    let bgImageUrl = null;
    let processingMsg;
    let okMsg;

    if (!userInput) {
      processingMsg = "🧹 _Arka plan kaldırılıyor..._";
      okMsg = "✨ _Arka plan temizlendi!_";
    } else if (userInput.startsWith("#")) {
      bgColor = userInput.replace("#", "");
      processingMsg = `🎨 _Arka plan ${userInput} olarak ayarlanıyor..._`;
      okMsg = `✨ _Arka plan ${userInput} yapıldı!_`;
    } else if (colorMap[userInput]) {
      bgColor = colorMap[userInput];
      processingMsg = `🎨 _Arka plan *${userInput}* olarak ayarlanıyor..._`;
      okMsg = `✨ _Arka plan ${userInput} yapıldı!_`;
    } else if (userInput.startsWith("http")) {
      bgImageUrl = userInput;
      processingMsg = "🖼️ _Belirtilen fotoğraf arka plan olarak uygulanıyor..._";
      okMsg = "✨ _Arka plan olarak özel bir resim uygulandı!_";
    } else {
      return await message.send(
        "❗ _Sadece renk yazabilir, hex kodu gönderebilir ya da resim URL'i belirtebilirsiniz._"
      );
    }

    const processing = await message.send(processingMsg);

    let imagePath;
    let outputPath;

    try {
      imagePath = await message.reply_message.download();
      const imageBuffer = await fsPromises.readFile(imagePath);

      let response = null;
      let lastError = null;

      for (let i = 0; i < RBG_KEYS.length; i++) {
        try {
          const formData = new FormData();
          formData.append("image_file", imageBuffer, { filename: "image.jpg" });
          formData.append("type", "auto");
          formData.append("size", "auto");
          if (bgColor) formData.append("bg_color", bgColor);
          if (bgImageUrl) formData.append("bg_image_url", bgImageUrl);

          response = await axios({
            method: "post",
            url: "https://api.remove.bg/v1.0/removebg",
            data: formData,
            headers: { ...formData.getHeaders(), "X-Api-Key": RBG_KEYS[i] },
            responseType: "arraybuffer",
          });

          console.log(`✅ Remove.bg API başarılı - Anahtar #${i + 1} kullanıldı`);
          break;
        } catch (error) {
          lastError = error;
          console.log(`❌ Anahtar #${i + 1} başarısız:`, error.response?.status || error.message);

          if (error.response && [402, 403, 429].includes(error.response.status)) {
            continue;
          }
          break;
        }
      }

      if (!response) {
        let errorMessage = "❌ _İşlem başarısız oldu!_";

        if (lastError?.response?.status === 400) {
          errorMessage =
            "❌ _Geçersiz parametre veya fotoğraf! Lütfen düz renk, hex kodu veya geçerli bir görsel URL girin._";
        } else if (lastError?.response?.status === 402) {
          errorMessage = "❌ _API limiti aşıldı! Lütfen daha sonra tekrar deneyin._";
        } else if (lastError?.response?.status === 403) {
          errorMessage = "❌ _API anahtarı geçersiz! Lütfen API key ayarlarını kontrol edin._";
        } else if (lastError?.response?.status === 413) {
          errorMessage = "❌ _Dosya çok büyük! Maksimum 22MB olmalı._";
        } else if (lastError?.response?.status === 415) {
          errorMessage = "❌ _Desteklenmeyen medya türü! Uygun bir dosya formatı kullanın._";
        } else if (lastError?.response?.status === 429) {
          errorMessage = "❌ _İstek limiti aşıldı! Lütfen biraz bekleyin ve tekrar deneyin._";
        }

        await message.edit(errorMessage, message.jid, processing.key);
        return;
      }

      const mimeType = response.headers["content-type"] || "image/png";
      const extension = (mimeType.split("/")[1] || "png").split(";")[0];
      outputPath = `rbg_${Date.now()}.${extension}`;
      await fsPromises.writeFile(outputPath, response.data);

      let originalFileName = "";
      try {
        const docName = message.reply_message.data?.message?.documentMessage?.fileName;
        if (docName) {
          const base = Path.parse(docName).name;
          originalFileName = `${base}.${extension}`;
        }
      } catch (e) { /* dosya adı çıkarma hatası, varsayılan kullanılacak */ }

      if (!originalFileName && bgImageUrl) {
        originalFileName = getFileNameFromUrl(bgImageUrl, "arkaplan");
      }

      if (!originalFileName) {
        originalFileName = `${getDateBasedName("Arkaplan")}.${extension}`;
      }

      await message.edit(okMsg, message.jid, processing.key);
      await message.client.sendMessage(
        message.jid,
        {
          document: await fsPromises.readFile(outputPath),
          fileName: originalFileName,
          mimetype: mimeType,
        },
        { quoted: message.quoted }
      );
    } catch (error) {
      console.error("APSil komutu hatası:", error);
      await message.edit("❌ _Dosya gönderilirken bir hata oluştu!_", message.jid, processing.key);
    } finally {
      if (imagePath) await fsPromises.unlink(imagePath).catch(() => {});
      if (outputPath) await fsPromises.unlink(outputPath).catch(() => {});
    }
  }
);
