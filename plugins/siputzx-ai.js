/**
 * plugins/siputzx-ai.js
 * Siputzx API - AI Komutları (DuckAI, DeepSeek, Llama)
 * Tüm çıktılar %100 Türkçe
 */
const { Module } = require("../main");
const axios = require("axios");

const SIPUTZX_BASE = "https://api.siputzx.my.id";
const TIMEOUT = 30000;

async function siputGet(path, params = {}) {
  const url = `${SIPUTZX_BASE}${path}`;
  const res = await axios.get(url, { params, timeout: TIMEOUT, validateStatus: () => true });
  if (res.data && res.data.status) return res.data;
  throw new Error(res.data?.error || "API yanıt vermedi");
}

async function siputGetBuffer(path, params = {}) {
  const url = `${SIPUTZX_BASE}${path}`;
  const res = await axios.get(url, { params, timeout: TIMEOUT, responseType: "arraybuffer", validateStatus: () => true });
  if (res.status === 200 && res.data) return Buffer.from(res.data);
  throw new Error("Veri alınamadı");
}

// ══════════════════════════════════════════════════════
// DuckAI Sohbet
// ══════════════════════════════════════════════════════
Module({
  pattern: "duckai ?(.*)",
  fromMe: false,
  desc: "DuckAI ile sohbet eder.",
  usage: ".duckai Türkiye'nin başkenti neresi?",
  use: "yapay zeka",
}, async (message, match) => {
  const text = (match[1] || "").trim() || message.reply_message?.text;
  if (!text) return await message.sendReply("_Soru girin:_ `.duckai Türkiye'nin başkenti neresi?`");

  try {
    await message.sendReply("_Düşünüyorum..._");
    const data = await siputGet("/api/ai/duckai", { message: text });
    const result = data.data || data.result;
    if (!result) return await message.sendReply("_Yanıt alınamadı._");
    const answer = typeof result === "string" ? result : result.message || result.text || result.answer || JSON.stringify(result);
    await message.sendReply(`*DuckAI*\n\n${answer}`);
  } catch (e) {
    await message.sendReply(`_AI yanıtı alınamadı:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// DeepSeek R1
// ══════════════════════════════════════════════════════
Module({
  pattern: "deepseek ?(.*)",
  fromMe: false,
  desc: "DeepSeek R1 ile sohbet eder.",
  usage: ".deepseek Kuantum bilgisayar nedir?",
  use: "yapay zeka",
}, async (message, match) => {
  const text = (match[1] || "").trim() || message.reply_message?.text;
  if (!text) return await message.sendReply("_Soru girin:_ `.deepseek Kuantum bilgisayar nedir?`");

  try {
    await message.sendReply("_DeepSeek düşünüyor..._");
    const data = await siputGet("/api/ai/deepseekr1", { prompt: text });
    const result = data.data || data.result;
    if (!result) return await message.sendReply("_Yanıt alınamadı._");
    const answer = typeof result === "string" ? result : result.response || result.text || result.answer || JSON.stringify(result);
    await message.sendReply(`*DeepSeek R1*\n\n${answer}`);
  } catch (e) {
    await message.sendReply(`_AI yanıtı alınamadı:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Llama 3.3
// ══════════════════════════════════════════════════════
Module({
  pattern: "llama ?(.*)",
  fromMe: false,
  desc: "Llama 3.3 ile sohbet eder.",
  usage: ".llama Python ile merhaba dünya",
  use: "yapay zeka",
}, async (message, match) => {
  const text = (match[1] || "").trim() || message.reply_message?.text;
  if (!text) return await message.sendReply("_Soru girin:_ `.llama Python ile merhaba dünya`");

  try {
    await message.sendReply("_Llama düşünüyor..._");
    const data = await siputGet("/api/ai/llama33", { prompt: text });
    const result = data.data || data.result;
    if (!result) return await message.sendReply("_Yanıt alınamadı._");
    const answer = typeof result === "string" ? result : result.text || result.answer || JSON.stringify(result);
    await message.sendReply(`*Llama 3.3*\n\n${answer}`);
  } catch (e) {
    await message.sendReply(`_AI yanıtı alınamadı:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Meta AI
// ══════════════════════════════════════════════════════
Module({
  pattern: "metaai ?(.*)",
  fromMe: false,
  desc: "Meta AI ile sohbet eder.",
  usage: ".metaai Yapay zeka nedir?",
  use: "yapay zeka",
}, async (message, match) => {
  const text = (match[1] || "").trim() || message.reply_message?.text;
  if (!text) return await message.sendReply("_Soru girin:_ `.metaai Yapay zeka nedir?`");

  try {
    await message.sendReply("_Meta AI düşünüyor..._");
    const data = await siputGet("/api/ai/metaai", { query: text });
    const result = data.data || data.result;
    if (!result) return await message.sendReply("_Yanıt alınamadı._");
    const answer = typeof result === "string" ? result : result.text || result.answer || JSON.stringify(result);
    await message.sendReply(`*Meta AI*\n\n${answer}`);
  } catch (e) {
    await message.sendReply(`_AI yanıtı alınamadı:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// DuckAI Görsel Üretimi
// ══════════════════════════════════════════════════════
Module({
  pattern: "aigorsel ?(.*)",
  fromMe: false,
  desc: "AI ile görsel üretir (DuckAI).",
  usage: ".aigorsel uzayda bir kedi",
  use: "yapay zeka",
}, async (message, match) => {
  const prompt = (match[1] || "").trim();
  if (!prompt) return await message.sendReply("_Görsel açıklaması girin:_ `.aigorsel uzayda bir kedi`");

  try {
    await message.sendReply("_Görsel üretiliyor..._");
    const buf = await siputGetBuffer("/api/ai/duckaiimage", { prompt });
    await message.client.sendMessage(message.jid, {
      image: buf,
      caption: `*AI Görsel*\n_${prompt}_`
    }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`_Görsel üretilemedi:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Gemini Lite
// ══════════════════════════════════════════════════════
Module({
  pattern: "geminilite ?(.*)",
  fromMe: false,
  desc: "Gemini Lite ile sohbet eder (API anahtarı gerektirmez).",
  usage: ".geminilite Dünya'nın çapı nedir?",
  use: "yapay zeka",
}, async (message, match) => {
  const text = (match[1] || "").trim() || message.reply_message?.text;
  if (!text) return await message.sendReply("_Soru girin:_ `.geminilite Dünya'nın çapı nedir?`");

  try {
    await message.sendReply("_Gemini düşünüyor..._");
    const data = await siputGet("/api/ai/gemini-lite", { prompt: text });
    const result = data.data || data.result;
    if (!result) return await message.sendReply("_Yanıt alınamadı._");
    const answer = typeof result === "string" ? result : result.text || result.answer || JSON.stringify(result);
    await message.sendReply(`*Gemini Lite*\n\n${answer}`);
  } catch (e) {
    await message.sendReply(`_AI yanıtı alınamadı:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// QwQ 32B
// ══════════════════════════════════════════════════════
Module({
  pattern: "qwq ?(.*)",
  fromMe: false,
  desc: "QwQ 32B ile sohbet eder.",
  usage: ".qwq Fibonacci dizisi nedir?",
  use: "yapay zeka",
}, async (message, match) => {
  const text = (match[1] || "").trim() || message.reply_message?.text;
  if (!text) return await message.sendReply("_Soru girin:_ `.qwq Fibonacci dizisi nedir?`");

  try {
    await message.sendReply("_QwQ düşünüyor..._");
    const data = await siputGet("/api/ai/qwq32b", { prompt: text });
    const result = data.data || data.result;
    if (!result) return await message.sendReply("_Yanıt alınamadı._");
    const answer = typeof result === "string" ? result : result.text || result.answer || JSON.stringify(result);
    await message.sendReply(`*QwQ 32B*\n\n${answer}`);
  } catch (e) {
    await message.sendReply(`_AI yanıtı alınamadı:_ ${e.message}`);
  }
});
