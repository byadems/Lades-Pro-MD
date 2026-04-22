"use strict";

const path = require("path");
const fs = require("fs");

/**
 * Lades-Pro Configuration
 * Tüm ayarlar burada merkezi olarak yönetilir.
 */

// .env veya config.env varsa yükle (isteğe bağlı kullanım için)
if (fs.existsSync(path.join(__dirname, "config.env"))) {
  require("dotenv").config({ path: path.join(__dirname, "config.env") });
} else if (fs.existsSync(path.join(__dirname, ".env"))) {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
}

const pino = require("pino");

// ─────────────────────────────────────────────────────────
//  Logger Yapılandırması
// ─────────────────────────────────────────────────────────
const IS_PRODUCTION = process.env.NODE_ENV === "production" || true;

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: IS_PRODUCTION
    ? undefined
    : { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } },
});

// ─────────────────────────────────────────────────────────
//  Ana Konfigürasyon Nesnesi
// ─────────────────────────────────────────────────────────
const config = {
  // ── Bot Kimliği ──
  BOT_NAME: process.env.BOT_NAME || "Lades-Pro",
  OWNER_NUMBER: process.env.OWNER_NUMBER || "905396978235",
  PREFIX: process.env.PREFIX || ".",
  SESSION: process.env.SESSION || "",

  // ── Özellikler & Modlar ──
  MODE: process.env.MODE || "public", // "public" veya "private"
  AUTO_READ: process.env.AUTO_READ === "true" || false,
  AUTO_TYPING: process.env.AUTO_TYPING === "true" || true,
  AUTO_RECORDING: process.env.AUTO_RECORDING === "true" || true,
  ANTI_LINK: process.env.ANTI_LINK === "true" || false,
  ANTI_SPAM: process.env.ANTI_SPAM === "true" || true,
  REJECT_CALLS: process.env.REJECT_CALLS === "true" || true,
  PM_BLOCK: process.env.PM_BLOCK === "true" || true,
  SEND_REACTIONS: process.env.SEND_REACTIONS !== "false",
  REACTION_SAMPLING: parseInt(process.env.REACTION_SAMPLING || "100", 10),
  PUBLIC_MODE: process.env.PUBLIC_MODE !== "false", // Default true

  // ── Yetkiler ──
  // SUDO: Botu tam yetkiyle yönetebilecek numaralar (virgülle ayırın)
  SUDO: process.env.SUDO || "905396978235,905360187242,905342333255,41764185118",
  SUDO_MAP: process.env.SUDO_MAP || "",
  ADMIN_ACCESS: process.env.ADMIN_ACCESS === "true" || true,

  // ── Yapay Zeka (AI) ──
  // NOT: GitHub güvenliği için gerçek anahtarlarınızı buraya doğrudan yazmak yerine
  // .env dosyasında tutmanız veya push sonrası manuel eklemeniz önerilir.
  AI_MODEL: process.env.AI_MODEL || "gemini",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",

  // ── Bellek & Sistem ──
  HEAP_LIMIT_MB: parseInt(process.env.HEAP_LIMIT_MB || "250", 10),
  PM2_RESTART_LIMIT_MB: parseInt(process.env.PM2_RESTART_LIMIT_MB || "450", 10), // index.js ile uyumlu
  DEBUG: process.env.DEBUG === "true", // Production'da false — console spam önlenir
  SELF_TEST: process.env.SELF_TEST === "true", // Default: false. Testleri açmak için "true" yapın.
  NODE_ENV: process.env.NODE_ENV || "production",

  // ── Medya Sınırları ──
  MAX_STICKER_SIZE: parseInt(process.env.MAX_STICKER_SIZE || "2", 10) * 1024 * 1024,
  MAX_DL_SIZE: parseInt(process.env.MAX_DL_SIZE || "50", 10) * 1024 * 1024,

  // ── Diğer Ayarlar ──
  LANGUAGE: process.env.LANG || "turkish",
  ALIVE: process.env.ALIVE || "",
  VERSION: "1.0.0",
  BOT_INFO: process.env.BOT_INFO || "Lades-Pro;Lades Yönetimi;",
  STICKER_DATA: process.env.STICKER_DATA || "Lades-Pro;Lades-Pro;😂",
  TIKWM_API_KEY: process.env.TIKWM_API_KEY || "bee06ff010bb0987fc949c0e676450b7",
  ACR_A: process.env.ACR_A || "",
  ACR_S: process.env.ACR_S || "",
  PORT: process.env.PORT || 3000,
  CHANNEL_JID: process.env.CHANNEL_JID || "120363427366763599@newsletter",

  // Database instance (core/database.js tarafından ayağa kaldırılır)
  DATABASE_URL: process.env.DATABASE_URL || null,
  logger,
};

// ── Klasik Alanlar (Uyumluluk için) ──
config.HANDLERS = config.PREFIX;
config.WORKTYPE = config.MODE;

// Getterlar: Dinamik hesaplanan alanlar
Object.defineProperty(config, "HANDLER_PREFIX", {
  get() { return (this.PREFIX || ".")[0]; },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(config, "isPrivate", {
  get() { return this.MODE === "private"; },
  enumerable: true,
  configurable: true,
});

module.exports = config;
