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

// ─────────────────────────────────────────────────────────
//  Database / Sequelize
// ─────────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL || null;
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "lades_pro_md";

let sequelize;
if (DATABASE_URL && DATABASE_URL.startsWith("postgres")) {
  sequelize = new Sequelize(DATABASE_URL, {
    dialect: "postgres",
    logging: false,
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || "20", 10),
      min: parseInt(process.env.DB_POOL_MIN || "2", 10),
      acquire: 60000,
      idle: 30000,
    },
    dialectOptions: {
      ssl: process.env.DB_SSL === "false" ? false : { require: true, rejectUnauthorized: false },
    },
    retry: {
      max: 5,
      match: [
        Sequelize.ConnectionError,
        Sequelize.ConnectionRefusedError,
        Sequelize.ConnectionTimedOutError,
      ],
    },
  });
} else {
  logger.info("[DB] DATABASE_URL bulunamadı veya geçersiz, yerel SQLite veritabanı kullanılıyor.");
  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: path.join(__dirname, "database.sqlite"),
    logging: false,
    pool: {
      max: 1,       // SQLite tek yazıcı destekler, pool=1 kilitlemeyi önler
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    retry: {
      max: 10,
      match: [/SQLITE_BUSY/],
    },
  });
}

// ─────────────────────────────────────────────────────────
//  Config exports
// ─────────────────────────────────────────────────────────
const config = {
  // Bot identity
  BOT_NAME: process.env.BOT_NAME || "Lades-MD",
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
  MODE: process.env.MODE || (process.env.PUBLIC_MODE === "true" ? "public" : "private"),

  // Komut handler prefix string (tam string, ör: ".")
  HANDLERS: process.env.HANDLERS || process.env.PREFIX || ".",

  // Alive mesajı
  ALIVE: process.env.ALIVE || "",

  // Bot sürümü
  VERSION: process.env.VERSION || "1.0.0",

  // Bot bilgisi: "Ad;Sahip;GörselURL"
  BOT_INFO: process.env.BOT_INFO || "Lades-MD;Lades Yönetimi;",

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
  DATABASE_URL,
  sequelize,
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
