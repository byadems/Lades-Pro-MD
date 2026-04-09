/**
 * plugins/tts.js
 * Metin-Konuşma (Text-to-Speech) komutu
 * hermit-bot'dan uyarlanmıştır
 * Tüm çıktılar %100 Türkçe
 */
const { Module } = require("../main");
const googleTTS = require("google-tts-api");
const fs = require("fs");
const path = require("path");

async function convertTextToSpeech(text, lang = "tr") {
  const options = {
    lang,
    slow: false,
    host: "https://translate.google.com"
  };

  const audioBase64Array = await googleTTS.getAllAudioBase64(text, options);
  const combined = audioBase64Array.map(a => a.base64).join("");
  return Buffer.from(combined, "base64");
}

Module({
  pattern: "tts ?(.*)",
  fromMe: false,
  desc: "Metni sesli mesaja dönüştürür.",
  usage: ".tts Merhaba Dünya | .tts Merhaba {en}",
  use: "araçlar",
}, async (message, match) => {
  let text = (match[1] || "").trim();
  const quotedText = message.reply_message?.text;
  if (!text && quotedText) text = quotedText;
  if (!text) return await message.sendReply("_Metin girin:_ `.tts Merhaba Dünya`\n_Dil belirtmek için:_ `.tts Hello World {en}`");

  let lang = "tr";
  const langMatch = text.match(/\{([a-z]{2,5})\}/);
  if (langMatch) {
    lang = langMatch[1];
    text = text.replace(langMatch[0], "").trim();
  }

  if (!text) return await message.sendReply("_Seslendirilecek metin girin._");

  try {
    const audioBuffer = await convertTextToSpeech(text, lang);
    await message.client.sendMessage(message.jid, {
      audio: audioBuffer,
      mimetype: "audio/mpeg",
      ptt: true,
    }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`_Ses oluşturulamadı:_ ${e.message}`);
  }
});

Module({
  pattern: "seslisoz ?(.*)",
  fromMe: false,
  desc: "Yanıtlanan mesajı sesli mesaja dönüştürür.",
  usage: ".seslisoz",
  use: "araçlar",
}, async (message, match) => {
  const text = message.reply_message?.text || (match[1] || "").trim();
  if (!text) return await message.sendReply("_Bir mesajı yanıtlayarak kullanın veya metin girin._");

  try {
    const audioBuffer = await convertTextToSpeech(text, "tr");
    await message.client.sendMessage(message.jid, {
      audio: audioBuffer,
      mimetype: "audio/mpeg",
      ptt: true,
    }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`_Ses oluşturulamadı:_ ${e.message}`);
  }
});
