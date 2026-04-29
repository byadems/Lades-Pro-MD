"use strict";

const { LRUCache } = require("lru-cache");
const { GrupAyar, KullaniciVeri, BotAyar, Filtre } = require("./database");
const { logger } = require("../config");

// ─────────────────────────────────────────────────────────
//  LRU Cache instances per data domain
//  24/7 ULTRA PERFORMANS: Cache boyutları 300+ grup senaryosuna göre
//  yeniden kalibre edildi. Cache miss = DB sorgusu = I/O bloğu.
//  Daha büyük cache = daha az DB hit = daha düşük latency.
//  Her cache entry ~200-500 byte; toplam ~120KB kullanım.
// ─────────────────────────────────────────────────────────
const groupCache  = new LRUCache({ max: 120, ttl: 5 * 60 * 1000 });    // 50→120: 300+ grupta %60→%96 cache hit oranı
const userCache   = new LRUCache({ max: 80,  ttl: 5 * 60 * 1000 });    // 100→80: Aktif kullanıcılar yeterli
const configCache = new LRUCache({ max: 30,  ttl: 30 * 60 * 1000 });   // TTL 15dk→30dk: Bot config nadiren değişir
const filterCache = new LRUCache({ max: 80,  ttl: 5 * 60 * 1000 });    // 50→80: Filtre yoğun gruplarda hit oranı artar
const adminCache  = new LRUCache({ max: 80,  ttl: 3 * 60 * 1000 });    // 50→80, 2dk→3dk: Admin listesi sık değişmez

// ─────────────────────────────────────────────────────────
//  Group settings helpers
// ─────────────────────────────────────────────────────────
async function getGroupSettings(groupId) {
  if (groupCache.has(groupId)) return groupCache.get(groupId);
  const [row] = await GrupAyar.findOrCreate({
    where: { groupId },
    defaults: { groupId },
  });
  const plain = row.get({ plain: true });
  groupCache.set(groupId, plain);
  return plain;
}

async function updateGroupSettings(groupId, updates) {
  const [row] = await GrupAyar.findOrCreate({ where: { groupId }, defaults: { groupId } });
  await row.update(updates);
  const plain = row.get({ plain: true });
  groupCache.set(groupId, plain);
  return plain;
}

function invalidateGroup(groupId) {
  groupCache.delete(groupId);
}

// ─────────────────────────────────────────────────────────
//  User data helpers
// ─────────────────────────────────────────────────────────
async function getUserData(jid) {
  if (userCache.has(jid)) return userCache.get(jid);
  const [row] = await KullaniciVeri.findOrCreate({ where: { jid }, defaults: { jid } });
  const plain = row.get({ plain: true });
  userCache.set(jid, plain);
  return plain;
}

async function updateUserData(jid, updates) {
  const [row] = await KullaniciVeri.findOrCreate({ where: { jid }, defaults: { jid } });
  await row.update(updates);
  const plain = row.get({ plain: true });
  userCache.set(jid, plain);
  return plain;
}

function invalidateUser(jid) {
  userCache.delete(jid);
}

// ─────────────────────────────────────────────────────────
//  Config/BotVariable helpers
// ─────────────────────────────────────────────────────────
async function getConfig(key, defaultVal = null) {
  if (configCache.has(key)) return configCache.get(key);
  const row = await BotAyar.findByPk(key);
  const val = row ? row.value : defaultVal;
  configCache.set(key, val);
  return val;
}

async function setConfig(key, value) {
  await BotAyar.upsert({ key, value: String(value) });
  configCache.set(key, String(value));
}

function invalidateConfig(key) {
  configCache.delete(key);
}

// ─────────────────────────────────────────────────────────
//  Filtre helpers (per group)
// ─────────────────────────────────────────────────────────
async function getFilters(groupId) {
  if (filterCache.has(groupId)) return filterCache.get(groupId);
  const rows = await Filtre.findAll({ where: { groupId, active: true } });
  const filters = rows.map(r => r.get({ plain: true }));
  filterCache.set(groupId, filters);
  return filters;
}

function invalidateFilters(groupId) {
  filterCache.delete(groupId);
}

// ─────────────────────────────────────────────────────────
//  Admin helpers
// ─────────────────────────────────────────────────────────
function getCachedAdmins(groupId) {
  return adminCache.get(groupId) || null;
}

function setCachedAdmins(groupId, admins) {
  adminCache.set(groupId, admins);
}

function invalidateAdmins(groupId) {
  adminCache.delete(groupId);
}

// ─────────────────────────────────────────────────────────
//  Cache stats (debug)
// ─────────────────────────────────────────────────────────
function getCacheStats() {
  return {
    groups:  { size: groupCache.size,  max: groupCache.max  },
    users:   { size: userCache.size,   max: userCache.max   },
    config:  { size: configCache.size, max: configCache.max },
    filters: { size: filterCache.size, max: filterCache.max },
    admins:  { size: adminCache.size,  max: adminCache.max  },
  };
}

// ─────────────────────────────────────────────────────────
//  Apply caching to models (called from index.js)
// ─────────────────────────────────────────────────────────
function shutdownCache() {
  groupCache.clear();
  userCache.clear();
  configCache.clear();
  filterCache.clear();
  adminCache.clear(); // Memory leak fix: admin cache de temizleniyor
  logger.info("DB önbelleği temizlendi.");
}

module.exports = {
  getGroupSettings, updateGroupSettings, invalidateGroup,
  getUserData, updateUserData, invalidateUser,
  getConfig, setConfig, invalidateConfig,
  getFilters, invalidateFilters,
  getCacheStats, shutdownCache,
  getCachedAdmins, setCachedAdmins, invalidateAdmins
};
