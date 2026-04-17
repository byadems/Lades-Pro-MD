"use strict";

const path = require("path");
const fs = require("fs");

// Load .env if present
if (fs.existsSync(path.join(__dirname, "config.env"))) {
  require("dotenv").config({ path: path.join(__dirname, "config.env") });
} else if (fs.existsSync(path.join(__dirname, ".env"))) {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
}

const { Sequelize } = require("sequelize");
const pino = require("pino");

// ─────────────────────────────────────────────────────────
//  Logger
// ─────────────────────────────────────────────────────────
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: IS_PRODUCTION
    ? undefined
    : { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } },
});

// Sequelize initialization moved to core/database.js

// ─────────────────────────────────────────────────────────
//  Config exports
// ─────────────────────────────────────────────────────────
const config = {
  // Bot identity
  BOT_NAME: process.env.BOT_NAME || "Lades-Pro",
  OWNER_NUMBER: process.env.OWNER_NUMBER || "905396978235",
  PREFIX: process.env.PREFIX || ".",
  SESSION: process.env.SESSION || "",
  LANGUAGE: process.env.LANG || "turkish",

  // Features
  AUTO_READ: process.env.AUTO_READ === "true",
  AUTO_TYPING: process.env.AUTO_TYPING === "true",
  AUTO_RECORDING: process.env.AUTO_RECORDING === "true",
  ANTI_LINK: process.env.ANTI_LINK === "true",
  ANTI_SPAM: process.env.ANTI_SPAM === "true",
  SEND_REACTIONS: process.env.SEND_REACTIONS !== "false", // Default true
  REACTION_SAMPLING: parseInt(process.env.REACTION_SAMPLING || "100", 10), // Percentage
  ALLOWED: process.env.ALLOWED || "90", // İzin verilen numaralar (antinumara için)

  // Permissions
  SUDO: process.env.SUDO || "905396978235",
  SUDO_MAP: process.env.SUDO_MAP || "",
  PUBLIC_MODE: process.env.PUBLIC_MODE === "true",

  // Media
  MAX_STICKER_SIZE: parseInt(process.env.MAX_STICKER_SIZE || "2", 10) * 1024 * 1024, // 2 MB
  MAX_DL_SIZE: parseInt(process.env.MAX_DL_SIZE || "50", 10) * 1024 * 1024, // 50 MB

  // AI
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  AI_MODEL: process.env.AI_MODEL || "gemini",

  // Memory/performance
  HEAP_LIMIT_MB: parseInt(process.env.HEAP_LIMIT_MB || "512", 10),
  PM2_RESTART_LIMIT_MB: parseInt(process.env.PM2_RESTART_LIMIT_MB || "450", 10),

  // Debug
  DEBUG: process.env.DEBUG === "true",

  // ─── Plugin uyumluluk alanları (pluginler tarafından doğrudan kullanılır) ─
  // Bot modu: "public" veya "private"
  MODE: process.env.MODE || process.env.WORKTYPE || (process.env.PUBLIC_MODE === "false" ? "private" : "public"),

  // Komut handler prefix string (tam string, ör: ".")
  HANDLERS: process.env.HANDLERS || process.env.PREFIX || ".",

  // Alive mesajı
  ALIVE: process.env.ALIVE || "",

  // Bot sürümü
  VERSION: process.env.VERSION || "1.0.0",

  // Bot bilgisi: "Ad;Sahip;GörselURL"
  BOT_INFO: process.env.BOT_INFO || "Lades-Pro;Lades Yönetimi;",

  // Çıkartma paketi: "PaketAdı;Yazar;Emojiler"
  STICKER_DATA: process.env.STICKER_DATA || "Lades-Pro;Lades-Pro;😂",

  // Grup yöneticileri admin komutlarını kullanabilir mi?
  ADMIN_ACCESS: process.env.ADMIN_ACCESS === "true" || process.env.ADMIN_ACCESS === "1",

  // Ayarlar menüsü (runtime'da DB'den doldurulur)
  settingsMenu: [],

  // ACRCloud kimlik bilgileri (.bul komutu için)
  ACR_A: process.env.ACR_A || process.env.ACRCLOUD_ACCESS_KEY || "",
  ACR_S: process.env.ACR_S || process.env.ACRCLOUD_ACCESS_SECRET || "",

  // Groq API anahtarı (.dinle komutu için)
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",

  // TikWM API Anahtarı
  TIKWM_API_KEY: process.env.TIKWM_API_KEY || "bee06ff010bb0987fc949c0e676450b7",

  // Platform
  PLATFORM: process.env.PLATFORM || process.env.NODE_ENV || "local",

  // Database & logger instances (available to all modules)
  DATABASE_URL: process.env.DATABASE_URL || null,
  logger,
};

// Computed getter'lar: Object.defineProperty ile ekle (get shorthand serileştirme sorununu önler)
Object.defineProperty(config, "HANDLER_PREFIX", {
  get() { return (this.HANDLERS || this.PREFIX || ".")[0]; },
  enumerable: true,
  configurable: true,
});
Object.defineProperty(config, "isPrivate", {
  get() { return this.MODE === "private"; },
  enumerable: true,
  configurable: true,
});

module.exports = config;
