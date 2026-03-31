"use strict";

/**
 * core/store.js
 * Message store with LRU eviction.
 * Keeps group metadata cached and provides
 * downloadable message content lookup.
 */

const { LRUCache } = require("lru-cache");
const { logger } = require("../config");

// Message store: jid → Map<msgId, msg>
const messageStore = new LRUCache({
  max: 300,   // max 300 JIDs
  ttl: 60 * 60 * 1000, // 1h per JID bucket
});

// Group metadata cache
const groupMetaCache = new LRUCache({
  max: 200,
  ttl: 10 * 60 * 1000, // 10min
});

// ─────────────────────────────────────────────────────────
//  Message store
// ─────────────────────────────────────────────────────────
const MAX_MSGS_PER_JID = parseInt(process.env.MAX_MESSAGES_PER_JID || "50", 10);

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

module.exports = {
  storeMessage, getMessage, getMessageByKey,
  setGroupMeta, getGroupMeta, fetchGroupMeta, invalidateGroupMeta,
  bindToSocket, getStoreStats,
  getTotalUserCount, getFullMessage, fetchRecentChats,
};
