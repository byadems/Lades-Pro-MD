const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes, Op } = require("sequelize");
const { logger, ...config } = require("../config");

// ─────────────────────────────────────────────────────────
//  Database / Sequelize Initialization
// ─────────────────────────────────────────────────────────
const DATABASE_URL = config.DATABASE_URL;

// ─────────────────────────────────────────────────────────
//  Veritabanı Platform Tespiti
// ─────────────────────────────────────────────────────────
const isMongoDB = DATABASE_URL && (DATABASE_URL.startsWith('mongodb://') || DATABASE_URL.startsWith('mongodb+srv://'));
const isPostgres = DATABASE_URL && (DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://'));

if (isMongoDB) {
  logger.warn("[DB] MongoDB URL tespit edildi. Sequelize ORM MongoDB'yi desteklemez.");
  logger.warn("[DB] MongoDB için: 'npm install mongoose' çalıştırın ve DATABASE_URL='mongodb+srv://...' ayarlayın.");
  logger.warn("[DB] Önerilen alternatif: Neon/Supabase/Render üzerinde ÜCRETSİZ PostgreSQL kullanın.");
  logger.warn("[DB] PostgreSQL URL formatı: postgresql://kullanici:sifre@host:5432/db");
  logger.warn("[DB] SQLite'a geri dönülüyor (yerel geliştirme modu)...");
}

let sequelize;
if (isPostgres && !isMongoDB) {
  // PostgreSQL: Neon, Supabase, Render Database, standart PostgreSQL
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
      connectTimeout: 60000,
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
  logger.info(`[DB] PostgreSQL bağlantısı hazırlanıyor (${DATABASE_URL.split('@')[1] || 'host gizli'})`);
} else {
  // SQLite (varsayılan — yerel geliştirme ve MongoDB URL fallback)
  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: path.join(__dirname, "../database.sqlite"),
    logging: false,
    pool: {
      max: 1,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    retry: {
      max: 10,
      match: [/SQLITE_BUSY/],
    },
  });
  if (!isMongoDB) logger.info("[DB] SQLite veritabanı kullanılıyor (database.sqlite)");
}

// ─────────────────────────────────────────────────────────
//  Models
// ─────────────────────────────────────────────────────────

/** WhatsApp session state - one row per session */
const WhatsappSession = sequelize.define("WhatsappSession", {
  sessionId: { type: DataTypes.STRING(256), primaryKey: true, allowNull: false },
  sessionData: {
    // TEXT('long') MySQL'e özgü. PostgreSQL ve SQLite için düz TEXT kullan.
    type: DataTypes.TEXT,
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
  // TEXT('long') MySQL'e özgü. PostgreSQL ve SQLite için düz TEXT kullan.
  code: { type: DataTypes.TEXT, allowNull: true },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: "external_plugins", timestamps: true });

/** AI-generated command metadata */
const AiCommand = sequelize.define("AiCommand", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  commandName: { type: DataTypes.STRING(64), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  // TEXT('long') MySQL'e özgü. PostgreSQL ve SQLite için düz TEXT kullan.
  code: { type: DataTypes.TEXT, allowNull: false },
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

/** Global bot metrics (Total messages, commands, etc.) */
const BotMetric = sequelize.define("BotMetric", {
  key: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
  value: { type: DataTypes.BIGINT, defaultValue: 0 },
}, { tableName: "bot_metrics", timestamps: true });

/** Command execution statistics */
const CommandStat = sequelize.define("CommandStat", {
  pattern: { type: DataTypes.STRING(128), primaryKey: true, allowNull: false },
  status: { type: DataTypes.STRING(32), defaultValue: "success" }, // success or error
  runs: { type: DataTypes.INTEGER, defaultValue: 0 },
  avgMs: { type: DataTypes.INTEGER, defaultValue: 0 },
  lastRun: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  lastError: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: "command_stats", timestamps: true });

/** Registered command metadata */
const CommandRegistry = sequelize.define("CommandRegistry", {
  pattern: { type: DataTypes.STRING(128), primaryKey: true, allowNull: false },
  statKey: { type: DataTypes.STRING(64), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  usage: { type: DataTypes.STRING(64), allowNull: true },
}, { tableName: "command_registry", timestamps: false });

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

      // SQLite pragmaları: WAL modu ve busy_timeout
      if (sequelize.getDialect() === 'sqlite') {
        await sequelize.query("PRAGMA journal_mode = WAL;");
        await sequelize.query("PRAGMA busy_timeout = 5000;");
        await sequelize.query("PRAGMA synchronous = NORMAL;");
        // Performance optimizations
        await sequelize.query("PRAGMA cache_size = -64000;"); // 64MB cache
        await sequelize.query("PRAGMA temp_store = MEMORY;"); // Temp tables in RAM
        await sequelize.query("PRAGMA mmap_size = 268435456;"); // 256MB mmap
        logger.info("SQLite pragmaları ayarlandı (WAL, cache=64MB, temp=MEMORY, mmap=256MB).");
      }

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
    MessageStats, BotMetric, CommandStat, CommandRegistry,
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

  // Sync schema in parallel for faster startup
  try {
    await Promise.allSettled(
      models.filter(m => m && m.sync).map(model => 
        model.sync().then(() => logger.info(`Table synced: ${model.getTableName ? model.getTableName() : 'unknown'}`))
      )
    );
  } catch (e) {
    logger.warn(`Tablo senkronizasyonunda hata oluştu: ${e.message}`);
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
  isMongoDB,
  isPostgres,
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
  BotMetric,
  CommandStat,
  CommandRegistry,
  initializeDatabase,
  Op,
  DataTypes,
  Sequelize,
};
