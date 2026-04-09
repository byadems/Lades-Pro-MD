"use strict";

const fs = require("fs");
const path = require("path");
const { DataTypes, Op } = require("sequelize");
const { sequelize, logger } = require("../config");

// ─────────────────────────────────────────────────────────
//  Models
// ─────────────────────────────────────────────────────────

/** WhatsApp session state - one row per session */
const WhatsappSession = sequelize.define("WhatsappSession", {
  sessionId: { type: DataTypes.STRING(256), primaryKey: true, allowNull: false },
  sessionData: {
    type: DataTypes.TEXT("long"),
    allowNull: true,
  },
}, { tableName: "whatsapp_sessions", timestamps: true });

/** Key-value bot configuration store */
const BotConfig = sequelize.define("BotConfig", {
  key: { type: DataTypes.STRING(128), primaryKey: true, allowNull: false, unique: true },
  value: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: "bot_config", timestamps: true });

/** Per-group settings */
const GroupSettings = sequelize.define("GroupSettings", {
  groupId: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
  welcome: { type: DataTypes.BOOLEAN, defaultValue: false },
  welcomeMsg: { type: DataTypes.TEXT, allowNull: true },
  goodbye: { type: DataTypes.BOOLEAN, defaultValue: false },
  goodbyeMsg: { type: DataTypes.TEXT, allowNull: true },
  antiLink: { type: DataTypes.BOOLEAN, defaultValue: false },
  antiSpam: { type: DataTypes.BOOLEAN, defaultValue: false },
  mute: { type: DataTypes.BOOLEAN, defaultValue: false },
  antiToxic: { type: DataTypes.BOOLEAN, defaultValue: false },
  chatbot: { type: DataTypes.BOOLEAN, defaultValue: false },
  warnLimit: { type: DataTypes.INTEGER, defaultValue: 3 },
  maxWarn: { type: DataTypes.INTEGER, defaultValue: 3 },
  prefix: { type: DataTypes.STRING(5), defaultValue: "." },
}, { tableName: "group_settings", timestamps: true });

/** Per-user data */
const UserData = sequelize.define("UserData", {
  jid: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
  name: { type: DataTypes.STRING(128), allowNull: true },
  warns: { type: DataTypes.INTEGER, defaultValue: 0 },
  banned: { type: DataTypes.BOOLEAN, defaultValue: false },
  afk: { type: DataTypes.BOOLEAN, defaultValue: false },
  afkReason: { type: DataTypes.TEXT, allowNull: true },
  afkSince: { type: DataTypes.BIGINT, allowNull: true },
}, { tableName: "user_data", timestamps: true });

/** Warn logs */
const WarnLog = sequelize.define("WarnLog", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  groupId: { type: DataTypes.STRING(64), allowNull: false },
  userJid: { type: DataTypes.STRING(64), allowNull: false },
  reason: { type: DataTypes.TEXT, allowNull: true },
  warnedBy: { type: DataTypes.STRING(64), allowNull: true },
}, { tableName: "warn_logs", timestamps: true, updatedAt: false });

/** Keyword filters */
const Filter = sequelize.define("Filter", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  groupId: { type: DataTypes.STRING(64), allowNull: false },
  keyword: { type: DataTypes.TEXT, allowNull: false },
  response: { type: DataTypes.TEXT, allowNull: true },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: "filters", timestamps: true });

/** Scheduled messages */
const Schedule = sequelize.define("Schedule", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  groupId: { type: DataTypes.STRING(64), allowNull: false },
  cronExpr: { type: DataTypes.STRING(64), allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  createdBy: { type: DataTypes.STRING(64), allowNull: true },
}, { tableName: "schedules", timestamps: true });

/** External plugins */
const ExternalPlugin = sequelize.define("ExternalPlugin", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(128), allowNull: false, unique: true },
  url: { type: DataTypes.TEXT, allowNull: true },
  code: { type: DataTypes.TEXT("long"), allowNull: true },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: "external_plugins", timestamps: true });

/** AI-generated command metadata */
const AiCommand = sequelize.define("AiCommand", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  commandName: { type: DataTypes.STRING(64), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  code: { type: DataTypes.TEXT("long"), allowNull: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  createdBy: { type: DataTypes.STRING(64), allowNull: true },
}, { tableName: "ai_commands", timestamps: true });

/** Message statistics tracking */
const MessageStats = sequelize.define("MessageStats", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  jid: { type: DataTypes.STRING(64), allowNull: false },
  userJid: { type: DataTypes.STRING(64), allowNull: false },
  totalMessages: { type: DataTypes.INTEGER, defaultValue: 0 },
  textMessages: { type: DataTypes.INTEGER, defaultValue: 0 },
  imageMessages: { type: DataTypes.INTEGER, defaultValue: 0 },
  videoMessages: { type: DataTypes.INTEGER, defaultValue: 0 },
  audioMessages: { type: DataTypes.INTEGER, defaultValue: 0 },
  stickerMessages: { type: DataTypes.INTEGER, defaultValue: 0 },
  otherMessages: { type: DataTypes.INTEGER, defaultValue: 0 },
  lastMessageAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { 
  tableName: "message_stats", 
  timestamps: true,
  indexes: [
    { fields: ["jid"] },
    { fields: ["userJid"] },
    { unique: true, fields: ["jid", "userJid"] }
  ]
});

// Associations
MessageStats.belongsTo(UserData, { foreignKey: "userJid", targetKey: "jid", as: "User" });

// ─────────────────────────────────────────────────────────
//  Database initialization
// ─────────────────────────────────────────────────────────
async function initializeDatabase() {
  // SQLite için sessions klasörünü oluştur
  const sessionsDir = path.join(__dirname, "..", "sessions");
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
    logger.info("Oturum dizini (sessions/) oluşturuldu.");
  }

  let retries = 10;
  while (retries > 0) {
    try {
      await sequelize.authenticate();
      logger.info("Database connection established.");
      break;
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      logger.warn({ err: err.message }, `DB connect failed, retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  const models = [
    WhatsappSession, BotConfig, GroupSettings, UserData,
    WarnLog, Filter, Schedule, ExternalPlugin, AiCommand,
    MessageStats,
  ];

  // Eski Lades-MD eklentilerinden gelen (SQLite'ta hata veren) tabloları da senkronize et
  try {
    const legacyModels = require("../plugins/utils/db/models");
    Object.values(legacyModels).forEach(model => {
      // Sadece sequelize Model instance'larını ekle
      if (model && model.sync && model.getTableName) {
        models.push(model);
      }
    });
  } catch (e) {
    logger.warn("Legacy modeller (plugins/utils/db/models.js) yüklenirken atlandı.");
  }

  const { Umzug, SequelizeStorage } = require('umzug');

  const umzug = new Umzug({
    migrations: { glob: path.join(__dirname, '../migrations/*.js') },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: console,
    create: {
      folder: path.join(__dirname, '../migrations')
    }
  });

  try {
    if (!fs.existsSync(path.join(__dirname, '../migrations'))) {
      fs.mkdirSync(path.join(__dirname, '../migrations'), { recursive: true });
    }
    await umzug.up();
    logger.info("Migrations executed successfully.");
  } catch (e) {
    logger.warn(`Migration error: ${e.message}`);
  }

  for (const model of models) {
    try {
      if (model.sync) {
        const isSqlite = sequelize.getDialect() === 'sqlite';
        try {
          await model.sync({ alter: true });
        } catch (alterErr) {
          if (alterErr.name === 'SequelizeValidationError' || alterErr.name === 'SequelizeUniqueConstraintError' || (alterErr.message && alterErr.message.includes('Validation error'))) {
            await model.sync(); // Fallback to safe sync without altering if validation fails
          } else {
            throw alterErr;
          }
        }
      }
      logger.info(`Table synced: ${model.getTableName ? model.getTableName() : 'unknown'}`);
    } catch (e) {
      logger.warn(`Tablo senkronizasyonunda hata oluştu: ${e.message}`);
    }
  }

  logger.info("Database initialization complete.");
}

// ─────────────────────────────────────────────────────────
//  BotVariable helper (backward compat alias → BotConfig)
// ─────────────────────────────────────────────────────────
const BotVariable = {
  get: async (key, defaultVal = null) => {
    const row = await BotConfig.findByPk(key);
    return row ? row.value : defaultVal;
  },
  set: async (key, value) => {
    await BotConfig.upsert({ key, value: String(value) });
  },
  upsert: async (data) => BotConfig.upsert(data),
  findAll: async () => BotConfig.findAll(),
  findByPk: async (key) => BotConfig.findByPk(key),
};

module.exports = {
  sequelize,
  WhatsappSession,
  BotConfig,
  BotVariable,
  GroupSettings,
  UserData,
  WarnLog,
  Filter,
  Schedule,
  ExternalPlugin,
  AiCommand,
  MessageStats,
  initializeDatabase,
  Op,
};
