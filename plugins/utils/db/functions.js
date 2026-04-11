const {
  WarnLog,
  Filter,
} = require("../../../core/database");
const { 
  getGroupSettings, 
  updateGroupSettings, 
  getUserData, 
  updateUserData, 
  getConfig, 
  setConfig 
} = require("../../../core/db-cache");
const {
  antiBotDB,
  antiSpamDB,
  PDMDB,
  antiDemote,
  antiPromote,
  antiWordDB,
  antiDeleteDB,
  FakeDB,
  FilterDB,
  WelcomeDB,
  GoodbyeDB
} = require("./models");
const config = require("../../../config");

async function syncWarnsSequence() {
  // Not needed for modern WarnLog
  return;
}

async function getWarn(jid = null, user = null, cnt) {
  if (!jid || !user) return null;

  const uyarı = await WarnLog.findAll({
    where: { groupId: jid, userJid: user },
    order: [["createdAt", "DESC"]],
  });

  if (!cnt) {
    return uyarı;
  }

  const count = parseInt(cnt);
  const currentWarns = uyarı.length;
  const kalan = count - currentWarns;

  const kalanVal = kalan > 0 ? kalan : 0;
  return {
    current: currentWarns,
    limit: count,
    kalan: kalanVal,
    remaining: kalanVal,
    exceeded: kalan <= 0,
    uyarı: uyarı,
  };
}

async function setWarn(
  jid = null,
  user = null,
  reason = "Sebep belirtilmedi",
  warnedBy = null
) {
  if (!jid || !user || !warnedBy) return false;

  await WarnLog.create({
    groupId: jid,
    userJid: user,
    reason: reason,
    warnedBy: warnedBy
  });

  const warnLimit = parseInt(config.WARN || "3");
  return await getWarn(jid, user, warnLimit);
}

async function resetWarn(jid = null, user) {
  if (!jid || !user) return false;

  const deleted = await WarnLog.destroy({
    where: { groupId: jid, userJid: user },
  });

  return deleted > 0;
}

async function getWarnCount(jid = null, user = null) {
  if (!jid || !user) return 0;

  return await WarnLog.count({
    where: { groupId: jid, userJid: user },
  });
}

async function decrementWarn(jid = null, user = null) {
  if (!jid || !user) return false;

  const uyarı = await WarnLog.findAll({
    where: { groupId: jid, userJid: user },
    order: [["createdAt", "DESC"]],
    limit: 1,
  });

  if (uyarı.length === 0) return false;

  const deleted = await WarnLog.destroy({
    where: { id: uyarı[0].id },
  });

  return deleted > 0;
}

async function getAllWarns(jid = null) {
  if (!jid) return [];

  const uyarı = await WarnLog.findAll({
    where: { groupId: jid },
    order: [["createdAt", "DESC"]],
  });

  const groupedWarnings = {};
  uyarı.forEach((warn) => {
    if (!groupedWarnings[warn.userJid]) {
      groupedWarnings[warn.userJid] = [];
    }
    groupedWarnings[warn.userJid].push(warn);
  });

  return groupedWarnings;
}

// AntiFake (AntiNumara) - Gerçek veritabanı implementasyonu
async function getAntifake(jid = null) {
  if (jid) {
    return await FakeDB.findOne({ where: { jid } });
  }
  return await FakeDB.findAll();
}

async function setAntifake(jid, allowed = null) {
  // Duplikat önleme
  const existing = await FakeDB.findOne({ where: { jid } });
  if (existing) {
    if (allowed !== null) {
      await existing.update({ allowed });
    }
    return existing;
  }
  return await FakeDB.create({ jid, allowed });
}

async function delAntifake(jid = null) {
  return await FakeDB.destroy({ where: { jid } });
}

async function resetAntifake() {
  return await FakeDB.destroy({ where: {}, truncate: true });
}

// New advanced antilink functions - mapped to GroupSettings
async function getAntilinkConfig(jid = null) {
  if (!jid) {
    return [];
  }
  const settings = await getGroupSettings(jid);
  return {
    jid: jid,
    mode: "delete",
    enabled: settings.antiLink
  };
}

async function setAntilinkConfig(jid, conf = {}) {
  if (!jid) return false;
  const settings = await updateGroupSettings(jid, {
     antiLink: conf.enabled !== undefined ? conf.enabled : undefined
  });
  return { jid, enabled: settings.antiLink, mode: "delete" };
}

async function updateAntilinkConfig(jid, updates = {}) {
  if (!jid) return false;
  const [settings] = await GroupSettings.findOrCreate({ where: { groupId: jid } });
  if (updates.enabled !== undefined) {
    settings.antiLink = updates.enabled;
    await settings.save();
  }
  return { jid, enabled: settings.antiLink, mode: "delete" };
}

const antilinkConfig = {
  get: getAntilinkConfig,
  set: setAntilinkConfig,
  update: updateAntilinkConfig,
};

// antiSpam mapped to GroupSettings
async function getAntiSpam() {
  const all = await GroupSettings.findAll({ where: { antiSpam: true } });
  return all.map(s => ({ jid: s.groupId }));
}

async function setAntiSpam(jid) {
  await updateGroupSettings(jid, { antiSpam: true });
  return true;
}

async function delAntiSpam(jid) {
  await updateGroupSettings(jid, { antiSpam: false });
  return true;
}

async function resetAntiSpam() {
  return await antiSpamDB.destroy({ where: {}, truncate: true });
}

async function getPdm() {
  return await PDMDB.findAll();
}

async function setPdm(jid) {
  const existing = await PDMDB.findOne({ where: { jid } });
  if (existing) return existing;
  return await PDMDB.create({ jid });
}

async function delPdm(jid = null) {
  return await PDMDB.destroy({ where: { jid } });
}

async function resetPdm() {
  return await PDMDB.destroy({ where: {}, truncate: true });
}

async function getAntiDemote() {
  return await antiDemote.findAll();
}

async function setAntiDemote(jid) {
  const existing = await antiDemote.findOne({ where: { jid } });
  if (existing) return existing;
  return await antiDemote.create({ jid });
}

async function delAntiDemote(jid = null) {
  return await antiDemote.destroy({ where: { jid } });
}

async function resetAntiDemote() {
  return await antiDemote.destroy({ where: {}, truncate: true });
}

async function getAntiPromote() {
  return await antiPromote.findAll();
}

async function setAntiPromote(jid) {
  const existing = await antiPromote.findOne({ where: { jid } });
  if (existing) return existing;
  return await antiPromote.create({ jid });
}

async function delAntiPromote(jid = null) {
  return await antiPromote.destroy({ where: { jid } });
}

async function resetAntiPromote() {
  return await antiPromote.destroy({ where: {}, truncate: true });
}

async function getAntiBot() {
  return await antiBotDB.findAll();
}

async function setAntiBot(jid) {
  const existing = await antiBotDB.findOne({ where: { jid } });
  if (existing) return existing;
  return await antiBotDB.create({ jid });
}

async function delAntiBot(jid = null) {
  return await antiBotDB.destroy({ where: { jid } });
}

async function resetAntiBot() {
  return await antiBotDB.destroy({ where: {}, truncate: true });
}

async function getAntiDelete() {
  return await antiDeleteDB.findAll();
}

async function setAntiDelete(jid) {
  const existing = await antiDeleteDB.findOne({ where: { jid } });
  if (existing) return existing;
  return await antiDeleteDB.create({ jid });
}

async function delAntiDelete(jid = null) {
  return await antiDeleteDB.destroy({ where: { jid } });
}

async function resetAntiDelete() {
  return await antiDeleteDB.destroy({ where: {}, truncate: true });
}

async function getAntiWord() {
  return await antiWordDB.findAll();
}

async function setAntiWord(jid) {
  const existing = await antiWordDB.findOne({ where: { jid } });
  if (existing) return existing;
  return await antiWordDB.create({ jid });
}

async function delAntiWord(jid = null) {
  return await antiWordDB.destroy({ where: { jid } });
}

async function resetAntiWord() {
  return await antiWordDB.destroy({ where: {}, truncate: true });
}

async function getWelcome(jid = null) {
  if (jid) {
    return await WelcomeDB.findOne({ where: { jid } });
  }
  return await WelcomeDB.findAll();
}

async function setWelcome(jid, message) {
  const existing = await WelcomeDB.findOne({ where: { jid } });
  if (existing) {
    await existing.update({ message, enabled: true });
    return existing;
  }
  return await WelcomeDB.create({ jid, message, enabled: true });
}

async function delWelcome(jid = null) {
  return await WelcomeDB.destroy({ where: { jid } });
}

async function toggleWelcome(jid, enabled) {
  const existing = await WelcomeDB.findOne({ where: { jid } });
  if (existing) {
    await existing.update({ enabled });
    return existing;
  }
  return false;
}

async function getGoodbye(jid = null) {
  if (jid) {
    return await GoodbyeDB.findOne({ where: { jid } });
  }
  return await GoodbyeDB.findAll();
}

async function setGoodbye(jid, message) {
  const existing = await GoodbyeDB.findOne({ where: { jid } });
  if (existing) {
    await existing.update({ message, enabled: true });
    return existing;
  }
  return await GoodbyeDB.create({ jid, message, enabled: true });
}

async function delGoodbye(jid = null) {
  return await GoodbyeDB.destroy({ where: { jid } });
}

async function toggleGoodbye(jid, enabled) {
  const existing = await GoodbyeDB.findOne({ where: { jid } });
  if (existing) {
    await existing.update({ enabled });
    return existing;
  }
  return false;
}

async function getFilter(jid = null, trigger = null) {
  const { Op } = require("sequelize");

  if (trigger && jid) {
    return await FilterDB.findOne({
      where: {
        trigger: trigger,
        [Op.or]: [
          { jid: jid, scope: "chat" },
          { jid: null, scope: "global" },
          { jid: null, scope: jid.includes("@g.us") ? "group" : "dm" },
        ],
        enabled: true,
      },
    });
  } else if (jid) {
    return await FilterDB.findAll({
      where: {
        [Op.or]: [
          { jid: jid, scope: "chat" },
          { jid: null, scope: "global" },
          { jid: null, scope: jid.includes("@g.us") ? "group" : "dm" },
        ],
        enabled: true,
      },
    });
  } else {
    return await FilterDB.findAll();
  }
}

async function setFilter(
  trigger,
  response,
  jid = null,
  scope = "chat",
  createdBy,
  options = {}
) {
  const filterData = {
    trigger,
    response,
    jid: scope === "chat" ? jid : null,
    scope,
    enabled: true,
    caseSensitive: options.caseSensitive || false,
    exactMatch: options.exactMatch || false,
    createdBy,
  };

  const existing = await FilterDB.findOne({
    where: {
      trigger,
      jid: filterData.jid,
      scope,
    },
  });

  if (existing) {
    await existing.update(filterData);
    return existing;
  }

  return await FilterDB.create(filterData);
}

async function delFilter(trigger, jid = null, scope = "chat") {
  return await FilterDB.destroy({
    where: {
      trigger,
      jid: scope === "chat" ? jid : null,
      scope,
    },
  });
}

async function toggleFilter(trigger, jid = null, scope = "chat", enabled) {
  const filter = await FilterDB.findOne({
    where: {
      trigger,
      jid: scope === "chat" ? jid : null,
      scope,
    },
  });

  if (filter) {
    await filter.update({ enabled });
    return filter;
  }
  return false;
}

async function getFiltersByScope(scope, jid = null) {
  const whereCondition = { scope, enabled: true };
  if (scope === "chat" && jid) {
    whereCondition.jid = jid;
  } else if (scope !== "chat") {
    whereCondition.jid = null;
  }

  return await FilterDB.findAll({ where: whereCondition });
}

// Regex cache for filters
const filterRegexCache = new Map();

async function checkFilterMatch(text, jid) {
  if (!text) return null;

  const filters = await getFilters(jid); // Use cached filters

  for (const filter of filters) {
    const isExact = filter.exactMatch;
    const isCase = filter.caseSensitive;
    const cacheKey = `${filter.trigger}:${isExact}:${isCase}`;
    
    let regex = filterRegexCache.get(cacheKey);
    if (!regex) {
      const escaped = filter.trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = isExact ? `^${escaped}$` : escaped;
      regex = new RegExp(pattern, isCase ? "" : "i");
      filterRegexCache.set(cacheKey, regex);
    }

    if (regex.test(text)) {
      return filter;
    }
  }

  return null;
}

// antilinkConfig is already defined above, so we don't redefine it here
const antiword = {
  set: setAntiWord,
  get: getAntiWord,
  delete: delAntiWord,
  reset: resetAntiWord,
};
const antifake = {
  set: setAntifake,
  get: getAntifake,
  delete: delAntifake,
  reset: resetAntifake,
};
const antipromote = {
  set: setAntiPromote,
  get: getAntiPromote,
  delete: delAntiPromote,
  reset: resetAntiPromote,
};
const antidemote = {
  set: setAntiDemote,
  get: getAntiDemote,
  delete: delAntiDemote,
  reset: resetAntiDemote,
};
const antispam = {
  set: setAntiSpam,
  get: getAntiSpam,
  delete: delAntiSpam,
  reset: resetAntiSpam,
};
const antibot = {
  set: setAntiBot,
  get: getAntiBot,
  delete: delAntiBot,
  reset: resetAntiBot,
};
const antidelete = {
  set: setAntiDelete,
  get: getAntiDelete,
  delete: delAntiDelete,
  reset: resetAntiDelete,
};
const pdm = { set: setPdm, get: getPdm, delete: delPdm, reset: resetPdm };
const welcome = {
  set: setWelcome,
  get: getWelcome,
  delete: delWelcome,
  toggle: toggleWelcome,
};
const goodbye = {
  set: setGoodbye,
  get: getGoodbye,
  delete: delGoodbye,
  toggle: toggleGoodbye,
};
const filter = {
  set: setFilter,
  get: getFilter,
  delete: delFilter,
  toggle: toggleFilter,
  getByScope: getFiltersByScope,
  checkMatch: checkFilterMatch,
};

module.exports = {
  syncWarnsSequence,
  getWarn,
  setWarn,
  resetWarn,
  getWarnCount,
  decrementWarn,
  getAllWarns,
  antilinkConfig,
  antiword,
  antifake,
  antipromote,
  antidemote,
  antispam,
  antibot,
  antidelete,
  pdm,
  welcome,
  goodbye,
  filter,
};
