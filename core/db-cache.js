"use strict";

const { LRUCache } = require("lru-cache");
const { GroupSettings, UserData, BotConfig, Filter } = require("./database");
const { logger } = require("../config");

// ─────────────────────────────────────────────────────────
//  LRU Cache instances per data domain
// ─────────────────────────────────────────────────────────
const groupCache = new LRUCache({ max: 500, ttl: 5 * 60 * 1000 });   // 5 min TTL
const userCache  = new LRUCache({ max: 2000, ttl: 10 * 60 * 1000 }); // 10 min TTL
const configCache = new LRUCache({ max: 100, ttl: 15 * 60 * 1000 }); // 15 min TTL
const filterCache = new LRUCache({ max: 300, ttl: 5 * 60 * 1000 });
const adminCache  = new LRUCache({ max: 500, ttl: 2 * 60 * 1000 });  // 2 min TTL for admins

// ─────────────────────────────────────────────────────────
//  Group settings helpers
// ─────────────────────────────────────────────────────────
async function getGroupSettings(groupId) {
  if (groupCache.has(groupId)) return groupCache.get(groupId);
  const [row] = await GroupSettings.findOrCreate({
    where: { groupId },
    defaults: { groupId },
  });
  const plain = row.get({ plain: true });
  groupCache.set(groupId, plain);
  return plain;
}

async function updateGroupSettings(groupId, updates) {
  const [row] = await GroupSettings.findOrCreate({ where: { groupId }, defaults: { groupId } });
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
  const [row] = await UserData.findOrCreate({ where: { jid }, defaults: { jid } });
  const plain = row.get({ plain: true });
  userCache.set(jid, plain);
  return plain;
}

async function updateUserData(jid, updates) {
  const [row] = await UserData.findOrCreate({ where: { jid }, defaults: { jid } });
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
  const row = await BotConfig.findByPk(key);
  const val = row ? row.value : defaultVal;
  configCache.set(key, val);
  return val;
}

async function setConfig(key, value) {
  await BotConfig.upsert({ key, value: String(value) });
  configCache.set(key, String(value));
}

function invalidateConfig(key) {
  configCache.delete(key);
}

// ─────────────────────────────────────────────────────────
//  Filter helpers (per group)
// ─────────────────────────────────────────────────────────
async function getFilters(groupId) {
  if (filterCache.has(groupId)) return filterCache.get(groupId);
  const rows = await Filter.findAll({ where: { groupId, active: true } });
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
    groups: { size: groupCache.size, max: groupCache.max },
    users: { size: userCache.size, max: userCache.max },
    config: { size: configCache.size, max: configCache.max },
    filters: { size: filterCache.size, max: filterCache.max },
  };
}

// ─────────────────────────────────────────────────────────
//  Apply caching to models (called from index.js)
// ─────────────────────────────────────────────────────────
function applyDatabaseCaching() {
  logger.info("DB cache layer initialized.");
}

function shutdownCache() {
  groupCache.clear();
  userCache.clear();
  configCache.clear();
  filterCache.clear();
  logger.info("DB cache cleared.");
}

module.exports = {
  getGroupSettings, updateGroupSettings, invalidateGroup,
  getUserData, updateUserData, invalidateUser,
  getConfig, setConfig, invalidateConfig,
  getFilters, invalidateFilters,
  getCacheStats, applyDatabaseCaching, shutdownCache,
  getCachedAdmins, setCachedAdmins, invalidateAdmins
};
