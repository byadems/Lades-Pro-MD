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
  // BELLEK OPTİMİZASYONU: Pool max 20→3. Her PG bağlantısı ~10MB RAM tüketir.
  // 20 bağlantı = ~200MB, 3 bağlantı = ~30MB → ~170MB tasarruf!
  sequelize = new Sequelize(DATABASE_URL, {
    dialect: "postgres",
    logging: false,
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || "3", 10),   // 20 → 3 (kritik RAM tasarrufu)
      min: parseInt(process.env.DB_POOL_MIN || "1", 10),   // 2  → 1
      acquire: 60000,
      idle: 10000,  // 30s → 10s: Boş bağlantıları daha hızlı bırak
      evict: 5000,  // 5s'de bir boş bağlantıları kontrol et
    },
    dialectOptions: {
      ssl: process.env.DB_SSL === "false" ? false : { require: true, rejectUnauthorized: false },
      connectTimeout: 60000,
      // statement_timeout: Her sorgu max 30 saniye (sonsuz beklemeler engellenir)
      statement_timeout: 30000,
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
  logger.info(`[DB] PostgreSQL bağlantısı hazırlanıyor — pool: max=3 (${DATABASE_URL.split('@')[1] || 'host gizli'})`);
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
const WhatsappOturum = sequelize.define("WhatsappOturum", {
  sessionId: { type: DataTypes.STRING(256), primaryKey: true, allowNull: false },
  sessionData: {
    // TEXT('long') MySQL'e özgü. PostgreSQL ve SQLite için düz TEXT kullan.
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, { tableName: "whatsapp_oturumlar", timestamps: true });

/** Key-value bot configuration store */
const BotAyar = sequelize.define("BotAyar", {
  key: { type: DataTypes.STRING(128), primaryKey: true, allowNull: false, unique: true },
  value: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: "bot_ayarlar", timestamps: true });

/** Per-group settings */
const GrupAyar = sequelize.define("GrupAyar", {
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
  // ─── Otomatik özellikler (varsayılan: AÇIK) ────────────────────────────────
  // otoSesAnaliz: Gruptaki ptt seslerini otomatik metne çevirir (Groq/OpenAI)
  otoSesAnaliz: { type: DataTypes.BOOLEAN, defaultValue: true },
  // otoBaglanti: Grup davet linklerini otomatik siler (WhatsApp invite links)
  otoBaglanti: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: "grup_ayarlar", timestamps: true });


/** Per-user data */
const KullaniciVeri = sequelize.define("KullaniciVeri", {
  jid: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
  name: { type: DataTypes.STRING(128), allowNull: true },
  warns: { type: DataTypes.INTEGER, defaultValue: 0 },
  banned: { type: DataTypes.BOOLEAN, defaultValue: false },
  afk: { type: DataTypes.BOOLEAN, defaultValue: false },
  afkReason: { type: DataTypes.TEXT, allowNull: true },
  afkSince: { type: DataTypes.BIGINT, allowNull: true },
}, { tableName: "kullanici_veriler", timestamps: true });

/** Warn logs */
const UyariKayit = sequelize.define("UyariKayit", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  groupId: { type: DataTypes.STRING(64), allowNull: false },
  userJid: { type: DataTypes.STRING(64), allowNull: false },
  reason: { type: DataTypes.TEXT, allowNull: true },
  warnedBy: { type: DataTypes.STRING(64), allowNull: true },
}, { tableName: "uyari_kayitlar", timestamps: true, updatedAt: false });

/** Keyword filters */
const Filtre = sequelize.define("Filtre", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  groupId: { type: DataTypes.STRING(64), allowNull: false },
  keyword: { type: DataTypes.TEXT, allowNull: false },
  response: { type: DataTypes.TEXT, allowNull: true },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: "filtreler", timestamps: true });

/** Scheduled messages */
const Zamanlama = sequelize.define("Zamanlama", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  groupId: { type: DataTypes.STRING(64), allowNull: false },
  cronExpr: { type: DataTypes.STRING(64), allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  createdBy: { type: DataTypes.STRING(64), allowNull: true },
}, { tableName: "planlamalar", timestamps: true });

/** External plugins */
const HariciEklenti = sequelize.define("HariciEklenti", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(128), allowNull: false, unique: true },
  url: { type: DataTypes.TEXT, allowNull: true },
  // TEXT('long') MySQL'e özgü. PostgreSQL ve SQLite için düz TEXT kullan.
  code: { type: DataTypes.TEXT, allowNull: true },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: "harici_eklentiler", timestamps: true });

/** AI-generated command metadata */
const YapayZekaKomut = sequelize.define("YapayZekaKomut", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  commandName: { type: DataTypes.STRING(64), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  // TEXT('long') MySQL'e özgü. PostgreSQL ve SQLite için düz TEXT kullan.
  code: { type: DataTypes.TEXT, allowNull: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  createdBy: { type: DataTypes.STRING(64), allowNull: true },
}, { tableName: "yapay_zeka_komutlar", timestamps: true });

/** Message statistics tracking */
const MesajIstatistik = sequelize.define("MesajIstatistik", {
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
  tableName: "mesaj_istatistikler", 
  timestamps: true,
  indexes: [
    { fields: ["jid"] },
    { fields: ["userJid"] },
    { unique: true, fields: ["jid", "userJid"] }
  ]
});

/** Global bot metrics (Total messages, commands, etc.) */
const BotMetrik = sequelize.define("BotMetrik", {
  key: { type: DataTypes.STRING(64), primaryKey: true, allowNull: false },
  value: { type: DataTypes.BIGINT, defaultValue: 0 },
}, { tableName: "bot_metrikler", timestamps: true });

/** Command execution statistics */
const KomutIstatistik = sequelize.define("KomutIstatistik", {
  pattern: { type: DataTypes.STRING(128), primaryKey: true, allowNull: false },
  status: { type: DataTypes.STRING(32), defaultValue: "success" }, // success or error
  runs: { type: DataTypes.INTEGER, defaultValue: 0 },
  avgMs: { type: DataTypes.INTEGER, defaultValue: 0 },
  lastRun: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  lastError: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: "komut_istatistikler", timestamps: true });

/** Registered command metadata */
const KomutKayit = sequelize.define("KomutKayit", {
  pattern: { type: DataTypes.STRING(128), primaryKey: true, allowNull: false },
  statKey: { type: DataTypes.STRING(64), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  usage: { type: DataTypes.STRING(64), allowNull: true },
}, { tableName: "komut_kayitlar", timestamps: false });

/** Mass group join tracking logs */
const GrupKatilimLog = sequelize.define("GrupKatilimLog", {
  inviteCode: { type: DataTypes.STRING(128), primaryKey: true, allowNull: false },
  groupName: { type: DataTypes.STRING(256), allowNull: true },
  status: { type: DataTypes.STRING(32), allowNull: false },
  reason: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: "grup_katilim_loglari", timestamps: true });

// Associations
MesajIstatistik.belongsTo(KullaniciVeri, { foreignKey: "userJid", targetKey: "jid", as: "User" });

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
      logger.info("Veritabanı bağlantısı kuruldu.");

      // SQLite pragmaları: WAL modu ve busy_timeout
      if (sequelize.getDialect() === 'sqlite') {
        await sequelize.query("PRAGMA journal_mode = WAL;");         // Concurrent reads
        await sequelize.query("PRAGMA busy_timeout = 5000;");         // Retry on lock
        await sequelize.query("PRAGMA synchronous = NORMAL;");        // Safe + fast
        await sequelize.query("PRAGMA cache_size = -2000;");          // 2MB page cache (RAM tasarrufu)
        await sequelize.query("PRAGMA temp_store = FILE;");           // Temp tablolar diske (RAM koruma!)
        await sequelize.query("PRAGMA mmap_size = 0;");               // Mmap kapalı (tamamen diske güven, RAM koru)
        await sequelize.query("PRAGMA wal_autocheckpoint = 200;");    // Daha sık checkpoint (500→200: WAL dosyasını küçük tut)
        await sequelize.query("PRAGMA optimize;");                    // Sorgu planlamasını optimize et
        await sequelize.query("PRAGMA foreign_keys = OFF;");          // FK kontrolü gereksiz overhead
        logger.info("SQLite pragmaları ayarlandı (WAL, cache=2MB, temp=FILE, mmap=0MB, checkpoint=200).");
      }

      break;
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      logger.warn({ err: err.message }, `DB bağlantısı başarısız, yeniden deneniyor... (${retries} hakkınız kaldı)`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  const models = [
    WhatsappOturum, BotAyar, GrupAyar, KullaniciVeri,
    UyariKayit, Filtre, Zamanlama, HariciEklenti, YapayZekaKomut,
    MesajIstatistik, BotMetrik, KomutIstatistik, KomutKayit, GrupKatilimLog,
  ];

  // Eski Lades-Pro eklentilerinden gelen (SQLite'ta hata veren) tabloları da senkronize et
  try {
    const legacyModels = require("../plugins/utils/db/modeller");
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
    logger.info("Taşımalar başarıyla çalıştırıldı.");
  } catch (e) {
    logger.warn(`Taşıma hatası: ${e.message}`);
  }

  // Sync schema in parallel for faster startup (logging suppressed to reduce I/O noise)
  try {
    const syncResults = await Promise.allSettled(
      models.filter(m => m && m.sync).map(model => model.sync())
    );
    const failed = syncResults.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn(`${failed.length} tablo senkronizasyonunda hata oluştu.`);
    }
  } catch (e) {
    logger.warn(`Tablo senkronizasyonunda hata oluştu: ${e.message}`);
  }

  logger.info("Veritabanı başlatma tamamlandı.");
}

// ─────────────────────────────────────────────────────────
//  BotVariable helper (backward compat alias → BotAyar)
// ─────────────────────────────────────────────────────────
const BotVariable = BotAyar;

BotVariable.get = async (key, defaultVal = null) => {
  const row = await BotAyar.findByPk(key);
  return row ? row.value : defaultVal;
};

BotVariable.set = async (key, value) => {
  await BotAyar.upsert({ key, value: String(value) });
};

module.exports = {
  sequelize,
  isMongoDB,
  isPostgres,
  WhatsappOturum,
  BotAyar,
  BotVariable,
  GrupAyar,
  KullaniciVeri,
  UyariKayit,
  Filtre,
  Zamanlama,
  HariciEklenti,
  YapayZekaKomut,
  MesajIstatistik,
  BotMetrik,
  KomutIstatistik,
  KomutKayit,
  GrupKatilimLog,
  initializeDatabase,
  Op,
  DataTypes,
  Sequelize,
};
