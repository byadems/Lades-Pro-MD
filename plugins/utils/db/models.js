const { DataTypes } = require("sequelize");
const config = require("../../../config");

const warnDB = config.sequelize.define("_warn", {
  chat: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  user: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: "Sebep belirtilmedi",
  },
  warnedBy: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  indexes: [{ fields: ['chat'] }, { fields: ['user'] }]
});

const FakeDB = config.sequelize.define("fake", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { indexes: [{ fields: ['jid'] }] });

// Advanced antilink system
const AntilinkConfigDB = config.sequelize.define("antilink_config", {
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
});

const antiSpamDB = config.sequelize.define("antispam", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { indexes: [{ fields: ['jid'] }] });

const PDMDB = config.sequelize.define("pdm", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { indexes: [{ fields: ['jid'] }] });

const antiDemote = config.sequelize.define("antidemote", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { indexes: [{ fields: ['jid'] }] });

const antiPromote = config.sequelize.define("antipromote", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { indexes: [{ fields: ['jid'] }] });

const antiBotDB = config.sequelize.define("antibot", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { indexes: [{ fields: ['jid'] }] });

const antiWordDB = config.sequelize.define("antiword", {
  jid: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { indexes: [{ fields: ['jid'] }] });

const WelcomeDB = config.sequelize.define("welcome", {
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
}, { indexes: [{ fields: ['jid'] }] });

const GoodbyeDB = config.sequelize.define("goodbye", {
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
}, { indexes: [{ fields: ['jid'] }] });

const FilterDB = config.sequelize.define("filter", {
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
}, { indexes: [{ fields: ['jid'] }, { fields: ['trigger'] }] });

const PluginDB = config.sequelize.define("Plugin", {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  url: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, { indexes: [{ fields: ['url'] }] });

// We no longer override sync since we removed statement_timeout from config.js
// so PostgreSQL index metadata query will not timeout.
module.exports = {
  warnDB,
  FakeDB,
  AntilinkConfigDB,
  antiSpamDB,
  PDMDB,
  antiDemote,
  antiPromote,
  antiBotDB,
  antiWordDB,
  WelcomeDB,
  GoodbyeDB,
  FilterDB,
  PluginDB,
};
