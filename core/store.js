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
const { WhatsappOturum, BotMetrik, MesajIstatistik, KullaniciVeri, sequelize } = require("./database");
const scheduler = require("./zamanlayici").scheduler;

// Message store: jid → Map<msgId, msg>
// Northflank için optimize: 30 aktif grup, 60 mesaj/grup
const messageStore = new LRUCache({
  max: 30,   // max 30 aktif grup/sohbet (50'den düşürüldü)
  ttl: 3 * 60 * 60 * 1000, // 3h TTL (4h'ten düşürüldü)
  dispose: (bucket, jid) => {
    // Clean reverse index when LRU evicts a bucket
    if (bucket instanceof Map) {
      for (const msgId of bucket.keys()) msgIdIndex.delete(msgId);
    }
  },
});

// Reverse index: msgId → jid (O(1) lookup for getFullMessage)
const msgIdIndex = new Map();
const MAX_MSGS_PER_JID = 60;    // 100'den düşürüldü
const MAX_MSGID_INDEX = 20000;  // 50000'den düşürüldü — her entry ~100 byte = max ~2 MB

function storeMessage(jid, message) {
  if (!jid || !message || !message.key) return;
  let bucket = messageStore.get(jid);
  if (!bucket) { bucket = new Map(); messageStore.set(jid, bucket); }
  const msgId = message.key.id;
  bucket.set(msgId, message);
  msgIdIndex.set(msgId, jid); // O(1) reverse index
  // msgIdIndex sınırsız büyümeyi önle
  if (msgIdIndex.size > MAX_MSGID_INDEX) {
    const firstKey = msgIdIndex.keys().next().value;
    msgIdIndex.delete(firstKey);
  }
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
// Group metadata cache: Northflank için optimize edildi
const groupMetaCache = new LRUCache({
  max: 200, // 500'den düşürüldü
  ttl: 3 * 60 * 1000, // 3 dakika (5'ten kısaltıldı — admin değişikliklerini daha hızlı algıla)
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
  if (runtime.metrics.allGroupsCache && (now - runtime.metrics.allGroupsLastFetch < 15 * 60 * 1000)) { // 15 min cache
    return runtime.metrics.allGroupsCache;
  }

  try {
    const chats = await sock.groupFetchAllParticipating();
    // Eski cache'i serbest bırak (GC anında çalışabilsin)
    runtime.metrics.allGroupsCache = null;
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
    // Hem DB'den hem bellek önbelleğinden say, büyük olanı döndür
    // (Tablo henüz flush edilmemiş olabilir; in-memory her zaman taze)
    const [dbCount, memCount] = await Promise.all([
      MesajIstatistik.count({ distinct: true, col: 'userJid' }).catch(() => 0),
      Promise.resolve(runtime.metrics.users.size),
    ]);
    return Math.max(dbCount || 0, memCount || 0);
  } catch (err) {
    // Fallback: sadece bellek
    return runtime.metrics.users.size || 0;
  }
}

async function fetchFromStore(jid) {
  try {
    return await MesajIstatistik.findAll({
      where: { jid },
      include: [{ model: KullaniciVeri, as: "User" }],
    });
  } catch (err) {
    logger.debug({ err, jid }, "Failed to fetch from store");
    return [];
  }
}

async function getTopUsers(jid, limit = 10) {
  try {
    return await MesajIstatistik.findAll({
      where: { jid },
      order: [["totalMessages", "DESC"]],
      limit,
      include: [{ model: KullaniciVeri, as: "User" }],
    });
  } catch (err) {
    logger.debug({ err, jid }, "Failed to get top users");
    return [];
  }
}

async function getGlobalTopUsers(limit = 10) {
  try {
    const results = await MesajIstatistik.findAll({
      attributes: [
        "userJid",
        [sequelize.fn("SUM", sequelize.col("totalMessages")), "totalMessages"],
        [sequelize.fn("MAX", sequelize.col("lastMessageAt")), "lastMessageAt"],
      ],
      group: ["userJid", "User.jid"],
      include: [{ model: KullaniciVeri, as: "User" }],
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
// stats batch: plain Map (LRUCache'den daha hafif; TTL auto-expiry gereksiz — flush zaten 60s'de yapılıyor)
const statsBatch = new Map();

scheduler.register('message_stats_flush', async () => {
  if (statsBatch.size === 0) return;
  // Mevcut batch'i kopyala ve temizle
  const currentBatch = Array.from(statsBatch.entries());
  statsBatch.clear();

  try {
    for (const [key, inc] of currentBatch) {
      const { jid, userJid, data } = inc;
      const now = new Date();

      try {
        // KullaniciVeri (foreign key) önce oluşturulmalı
        await KullaniciVeri.findOrCreate({
          where: { jid: userJid },
          defaults: { jid: userJid },
        }).catch(() => {}); // Hata olsa bile devam et

        // Sequelize ORM upsert — hem SQLite hem PostgreSQL ile çalışır
        const [record, created] = await MesajIstatistik.findOrCreate({
          where: { jid, userJid },
          defaults: {
            ...data,
            lastMessageAt: now,
          },
        });

        if (!created) {
          // Mevcut kaydı atomik olarak artır
          await record.increment({
            totalMessages: data.totalMessages,
            textMessages: data.textMessages,
            imageMessages: data.imageMessages,
            videoMessages: data.videoMessages,
            audioMessages: data.audioMessages,
            stickerMessages: data.stickerMessages,
            otherMessages: data.otherMessages,
          });
          await record.update({ lastMessageAt: now });
        }
      } catch (rowErr) {
        logger.debug({ err: rowErr.message, jid, userJid }, "Stats row upsert failed");
      }
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
