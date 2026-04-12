"use strict";

/**
 * core/store.js
 * Message store with LRU eviction.
 * Keeps group metadata cached and provides
 * downloadable message content lookup.
 */

const { LRUCache } = require("lru-cache");
const { logger } = require("../config");
const runtime = require("./runtime");

// Message store: jid → Map<msgId, msg>
const messageStore = new LRUCache({
  max: 100,   // max 100 active groups/chats in memory
  ttl: 24 * 60 * 60 * 1000, // 24h TTL
});

const MAX_MSGS_PER_JID = 500; 
let totalMessagesCached = 0;

function storeMessage(jid, message) {
  if (!jid || !message || !message.key) return;
  let bucket = messageStore.get(jid);
  if (!bucket) { bucket = new Map(); messageStore.set(jid, bucket); }
  bucket.set(message.key.id, message);
  if (bucket.size > MAX_MSGS_PER_JID) {
    const firstKey = bucket.keys().next().value;
    bucket.delete(firstKey);
  }
}

function getMessage(jid, msgId) {
  const bucket = messageStore.get(jid);
  return bucket ? bucket.get(msgId) : null;
}

function getMessageByKey(key) {
  if (!key) return null;
  return getMessage(key.remoteJid, key.id);
}

// ─────────────────────────────────────────────────────────
//  Group metadata
// ─────────────────────────────────────────────────────────
const groupMetaCache = new LRUCache({
  max: 500,
  ttl: 24 * 60 * 60 * 1000,
});

function setGroupMeta(groupId, meta) {
  groupMetaCache.set(groupId, meta);
}

function getGroupMeta(groupId) {
  return groupMetaCache.get(groupId) || null;
}

async function fetchGroupMeta(client, groupId) {
  const cached = getGroupMeta(groupId);
  if (cached) return cached;
  try {
    const meta = await client.groupMetadata(groupId);
    setGroupMeta(groupId, meta);
    return meta;
  } catch (err) {
    logger.debug({ err, groupId }, "Failed to fetch group metadata");
    return null;
  }
}

function invalidateGroupMeta(groupId) {
  groupMetaCache.delete(groupId);
}

async function getAllGroups(sock) {
  const now = Date.now();
  if (runtime.metrics.allGroupsCache && (now - runtime.metrics.allGroupsLastFetch < 10 * 60 * 1000)) { // 10 min cache
    return runtime.metrics.allGroupsCache;
  }
  
  try {
    const chats = await sock.groupFetchAllParticipating();
    runtime.metrics.allGroupsCache = chats;
    runtime.metrics.allGroupsLastFetch = now;
    
    // Also populate individual meta cache
    for (const jid in chats) {
      setGroupMeta(jid, chats[jid]);
    }
    
    return chats;
  } catch (err) {
    logger.debug({ err: err.message }, "getAllGroups failed");
    return runtime.metrics.allGroupsCache || {};
  }
}

// ─────────────────────────────────────────────────────────
//  Baileys store event binder
// ─────────────────────────────────────────────────────────
function bindToSocket(sock) {
  sock.ev.on("messages.upsert", ({ messages }) => {
    for (const msg of messages) {
      if (msg.key && msg.key.remoteJid) storeMessage(msg.key.remoteJid, msg);
    }
  });

  sock.ev.on("groups.update", (updates) => {
    for (const update of updates) {
      if (update.id) invalidateGroupMeta(update.id);
    }
  });

  sock.ev.on("group-participants.update", ({ id }) => {
    if (id) invalidateGroupMeta(id);
  });
}

// ─────────────────────────────────────────────────────────
//  Store stats
// ─────────────────────────────────────────────────────────
function getStoreStats() {
  return {
    jids: messageStore.size,
    groups: groupMetaCache.size,
  };
}

async function getFullMessage(msgId) {
  try {
    // msgId might come with suffix or prefix, search accurately
    const id = (msgId || "").split("_")[0];
    if (!id || id === "undefined" || id === "null") return { found: false };

    for (const jid of messageStore.keys()) {
      const bucket = messageStore.get(jid);
      if (bucket && bucket.has(id)) {
        return { found: true, messageData: bucket.get(id) };
      }
    }
    return { found: false };
  } catch (err) {
    return { found: false };
  }
}

async function fetchRecentChats() {
  // Mock recent chats from in-memory store
  return Array.from(messageStore.keys()).map(jid => ({ id: jid }));
}

async function getTotalUserCount() {
  try {
    const { UserData } = require("./database");
    return await UserData.count();
  } catch (err) {
    return 0;
  }
}

async function fetchFromStore(jid) {
  try {
    const { MessageStats, UserData } = require("./database");
    return await MessageStats.findAll({
      where: { jid },
      include: [{ model: UserData, as: "User" }],
    });
  } catch (err) {
    logger.debug({ err, jid }, "Failed to fetch from store");
    return [];
  }
}

async function getTopUsers(jid, limit = 10) {
  try {
    const { MessageStats, UserData } = require("./database");
    return await MessageStats.findAll({
      where: { jid },
      order: [["totalMessages", "DESC"]],
      limit,
      include: [{ model: UserData, as: "User" }],
    });
  } catch (err) {
    logger.debug({ err, jid }, "Failed to get top users");
    return [];
  }
}

async function getGlobalTopUsers(limit = 10) {
  try {
    const { MessageStats, UserData, sequelize } = require("./database");
    // Global stats: sum totals for each user across all chats
    const results = await MessageStats.findAll({
      attributes: [
        "userJid",
        [sequelize.fn("SUM", sequelize.col("totalMessages")), "totalMessages"],
        [sequelize.fn("MAX", sequelize.col("lastMessageAt")), "lastMessageAt"],
      ],
      group: ["userJid", "User.jid"],
      include: [{ model: UserData, as: "User" }],
      order: [[sequelize.literal("totalMessages"), "DESC"]],
      limit,
    });
    return results;
  } catch (err) {
    logger.debug({ err }, "Failed to get global top users");
    return [];
  }
}

/**
 * Increments message statistics for a user in a specific chat.
 * @param {string} jid - The chat JID
 * @param {string} userJid - The user JID
 * @param {string} type - Message type (text, image, video, audio, sticker, other)
 */
const statsBatch = new Map();

setInterval(async () => {
  if (statsBatch.size === 0) return;
  const currentBatch = new Map(statsBatch);
  statsBatch.clear();

  try {
    const { MessageStats, UserData } = require("./database");
    for (const [key, inc] of currentBatch.entries()) {
      const { jid, userJid, data } = inc;
      await UserData.findOrCreate({ where: { jid: userJid } });
      const [stats] = await MessageStats.findOrCreate({
        where: { jid, userJid },
        defaults: { totalMessages: 0, textMessages: 0, imageMessages: 0, videoMessages: 0, audioMessages: 0, stickerMessages: 0, otherMessages: 0 }
      });
      await stats.increment({
        totalMessages: data.totalMessages,
        textMessages: data.textMessages,
        imageMessages: data.imageMessages,
        videoMessages: data.videoMessages,
        audioMessages: data.audioMessages,
        stickerMessages: data.stickerMessages,
        otherMessages: data.otherMessages
      });
      await stats.update({ lastMessageAt: new Date() });
    }
  } catch (e) {
    logger.debug({ err: e.message }, "Batch stats update failed");
  }
}, 60000);

async function incrementStats(jid, userJid, type = "text") {
  const key = `${jid}:${userJid}`;
  if (!statsBatch.has(key)) {
    statsBatch.set(key, { jid, userJid, data: { totalMessages: 0, textMessages: 0, imageMessages: 0, videoMessages: 0, audioMessages: 0, stickerMessages: 0, otherMessages: 0 } });
  }
  const inc = statsBatch.get(key).data;
  inc.totalMessages++;
  if (type === "text") inc.textMessages++;
  else if (type === "image") inc.imageMessages++;
  else if (type === "video") inc.videoMessages++;
  else if (type === "audio") inc.audioMessages++;
  else if (type === "sticker") inc.stickerMessages++;
  else inc.otherMessages++;
}

module.exports = {
  storeMessage, getMessage, getMessageByKey,
  setGroupMeta, getGroupMeta, fetchGroupMeta, invalidateGroupMeta,
  bindToSocket, getStoreStats,
  getTotalUserCount, getFullMessage, fetchRecentChats,
  fetchFromStore, getTopUsers, getGlobalTopUsers,
  incrementStats,
  getAllGroups,
};
