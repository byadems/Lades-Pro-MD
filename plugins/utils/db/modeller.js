const { DataTypes, sequelize } = require("../../../core/database");
const { logger, ...config } = require("../../../config");

const FakeDB = sequelize.define("fake", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  allowed: {
    type: DataTypes.TEXT,
    allowNull: true,
  }
}, { tableName: "sahte_numaralar", indexes: [{ fields: ['jid'] }] });

// Advanced antilink system
const AntilinkConfigDB = sequelize.define("antilink_config", {
  jid: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
  },
  mode: {
    type: DataTypes.STRING,
    defaultValue: "delete",
    allowNull: false,
    comment: "Can be warn, kick, or delete",
  },
  allowedLinks: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: "Comma-separated list of allowed domains/patterns",
  },
  blockedLinks: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: "Comma-separated list of blocked domains/patterns",
  },
  isWhitelist: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: "true = only allow listed links, false = block listed links",
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  customMessage: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: "Custom message to send when link is detected",
  },
  updatedBy: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  updatedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, { tableName: "antibaglanti_ayarlari" });

const antiSpamDB = sequelize.define("antispam", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { tableName: "antispam_ayarlari", indexes: [{ fields: ['jid'] }] });

const PDMDB = sequelize.define("pdm", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { tableName: "antipdm_ayarlari", indexes: [{ fields: ['jid'] }] });

const antiDemote = sequelize.define("antidemote", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { tableName: "antiyetkial_ayarlari", indexes: [{ fields: ['jid'] }] });

const antiPromote = sequelize.define("antipromote", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { tableName: "antiyetkiver_ayarlari", indexes: [{ fields: ['jid'] }] });

const antiBotDB = sequelize.define("antibot", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { tableName: "antibot_ayarlari", indexes: [{ fields: ['jid'] }] });

const antiWordDB = sequelize.define("antiword", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { tableName: "antikelime_ayarlari", indexes: [{ fields: ['jid'] }] });

const antiDeleteDB = sequelize.define("antidelete", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { tableName: "antisilme_ayarlari", indexes: [{ fields: ['jid'] }] });

const WelcomeDB = sequelize.define("welcome", {
  jid: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, { tableName: "karsilama_ayarlari", indexes: [{ fields: ['jid'] }] });

const GoodbyeDB = sequelize.define("goodbye", {
  jid: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, { tableName: "veda_ayarlari", indexes: [{ fields: ['jid'] }] });

const FilterDB = sequelize.define("filter", {
  trigger: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  response: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  jid: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  scope: {
    type: DataTypes.STRING,
    defaultValue: "chat",
    comment: "Can be chat, global, dm, or group",
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  caseSensitive: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  exactMatch: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: false,
  },
}, { tableName: "sohbet_filtreleri", indexes: [{ fields: ['jid'] }, { fields: ['trigger'] }] });

const PluginDB = sequelize.define("Plugin", {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  url: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  code: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: "SHA-256 hash of last installed plugin code",
  },
}, { tableName: "eklenti_verileri", indexes: [{ fields: ['url'] }] });

module.exports = {
  FakeDB,
  AntilinkConfigDB,
  antiSpamDB,
  PDMDB,
  antiDemote,
  antiPromote,
  antiBotDB,
  antiWordDB,
  antiDeleteDB,
  FilterDB,
  PluginDB,
  WelcomeDB,
  GoodbyeDB,
};
