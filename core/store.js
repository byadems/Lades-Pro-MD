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
const { WhatsappSession, BotMetric, MessageStats, UserData, sequelize } = require("./database");
const scheduler = require("./scheduler");

// Message store: jid → Map<msgId, msg>
const messageStore = new LRUCache({
  max: 50,   // max 50 active groups/chats in memory
  ttl: 4 * 60 * 60 * 1000, // 4h TTL
  dispose: (bucket, jid) => {
    // Clean reverse index when LRU evicts a bucket
    if (bucket instanceof Map) {
      for (const msgId of bucket.keys()) msgIdIndex.delete(msgId);
    }
  },
});

// Reverse index: msgId → jid (O(1) lookup for getFullMessage)
const msgIdIndex = new Map();
const MAX_MSGS_PER_JID = 100;

function storeMessage(jid, message) {
  if (!jid || !message || !message.key) return;
  let bucket = messageStore.get(jid);
  if (!bucket) { bucket = new Map(); messageStore.set(jid, bucket); }
  const msgId = message.key.id;
  bucket.set(msgId, message);
  msgIdIndex.set(msgId, jid); // O(1) reverse index
  if (bucket.size > MAX_MSGS_PER_JID) {
    const firstKey = bucket.keys().next().value;
    bucket.delete(firstKey);
    msgIdIndex.delete(firstKey);
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
    const id = (msgId || "").split("_")[0];
    if (!id || id === "undefined" || id === "null") return { found: false };

    // O(1) lookup via reverse index
    const jid = msgIdIndex.get(id);
    if (jid) {
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
    return await UserData.count();
  } catch (err) {
    return 0;
  }
}

async function fetchFromStore(jid) {
  try {
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
const statsBatch = new LRUCache({ max: 1000, ttl: 120_000 }); // Auto-cleanup after 2min

scheduler.register('message_stats_flush', async () => {
  if (statsBatch.size === 0) return;
  // Copy current entries for processing
  const currentBatch = [];
  for (const [key, val] of statsBatch.entries()) {
    currentBatch.push([key, val]);
  }
  statsBatch.clear();

  try {
    for (const [key, inc] of currentBatch) {
      const { jid, userJid, data } = inc;

      // Atomic UPSERT for MessageStats
      await sequelize.query(
        "INSERT INTO message_stats (jid, userJid, totalMessages, textMessages, imageMessages, videoMessages, audioMessages, stickerMessages, otherMessages, lastMessageAt, createdAt, updatedAt) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATETIME('now'), DATETIME('now'), DATETIME('now')) " +
        "ON CONFLICT(jid, userJid) DO UPDATE SET " +
        "totalMessages = totalMessages + excluded.totalMessages, " +
        "textMessages = textMessages + excluded.textMessages, " +
        "imageMessages = imageMessages + excluded.imageMessages, " +
        "videoMessages = videoMessages + excluded.videoMessages, " +
        "audioMessages = audioMessages + excluded.audioMessages, " +
        "stickerMessages = stickerMessages + excluded.stickerMessages, " +
        "otherMessages = otherMessages + excluded.otherMessages, " +
        "lastMessageAt = DATETIME('now'), " +
        "updatedAt = DATETIME('now')",
        {
          replacements: [
            jid, userJid,
            data.totalMessages, data.textMessages, data.imageMessages,
            data.videoMessages, data.audioMessages, data.stickerMessages,
            data.otherMessages
          ],
          type: sequelize.QueryTypes.INSERT
        }
      );
    }
  } catch (e) {
    logger.debug({ err: e.message }, "Stats batch flush failed");
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
