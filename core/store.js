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
// RAM OPT: 60 aktif grup, TTL 30min (Antidelete için daha geniş coverage)
const messageStore = new LRUCache({
  max: 60,   // 15→60 aktif grup/sohbet
  ttl: 30 * 60 * 1000, // 30 dakika TTL
  dispose: (bucket, jid) => {
    // Clean reverse index when LRU evicts a bucket
    if (bucket instanceof Map) {
      for (const msgId of bucket.keys()) msgIdIndex.delete(msgId);
    }
  },
});

// Reverse index: msgId → jid (O(1) lookup for getFullMessage)
const msgIdIndex = new Map();
const MAX_MSGS_PER_JID = 10;   // 20→10: 60 grup × 10 mesaj = 600 entry (RAM dostu)
const MAX_MSGID_INDEX = 3000;  // 20000→3000: her entry ~150 byte = max ~450 KB

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
// Group metadata cache: RAM OPT edildi (200 grup)
const groupMetaCache = new LRUCache({
  max: 200,  // 80→200: 200 aktif grup için yeterli kapasite
  ttl: 5 * 60 * 1000, // 5 dakika (aynı kalıyor — admin değişikliği algısı)
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
  // RAM OPT: allGroupsCache TTL 15min→8min
  if (runtime.metrics.allGroupsCache && (now - runtime.metrics.allGroupsLastFetch < 8 * 60 * 1000)) {
    return runtime.metrics.allGroupsCache;
  }

  try {
    const chats = await sock.groupFetchAllParticipating();
    // Eski cache'i serbest bırak (GC anında çalışabilsin)
    runtime.metrics.allGroupsCache = null;

    // RAM OPT CRITICAL: Tüm grup katılımcılarını (binlerce obje) bellekte tutmak 
    // Out Of Memory (OOM) hatasının en büyük sebebidir. Yalnızca gerekli kısımları alıyoruz.
    const simplifiedChats = {};
    for (const jid in chats) {
      const g = chats[jid];
      simplifiedChats[jid] = {
        id: g.id,
        subject: g.subject,
        owner: g.owner,
        // Sadece length lazım, gerçek obje listesi devasa RAM tüketir.
        participants: g.participants ? new Array(g.participants.length) : [], 
      };
      // DİKKAT: Burada setGroupMeta(jid, chats[jid]) ÇAĞRILMAMALIDIR!
      // LRU cache kapasitesi 80 olduğu için 3000 grubu döngüyle eklemek, 
      // cache'i saniyede 3000 kez boşaltıp yenilemek demektir (Trashing).
    }

    runtime.metrics.allGroupsCache = simplifiedChats;
    runtime.metrics.allGroupsLastFetch = now;

    return simplifiedChats;
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
// RAM KORU: Max 500 girdi — 60+ grupta her saniye mesaj yagımuru olunca bu Map sonsuz büyüyüdek
const statsBatch = new Map();
const MAX_STATS_BATCH = 500; // Her entry ~200 byte = max ~100 KB

// Guard: scheduler.register tekrar çağırılmamasını sağla
let _statsFlusherRegistered = false;

if (!_statsFlusherRegistered) {
  _statsFlusherRegistered = true;

scheduler.register('message_stats_flush', async () => {
  if (statsBatch.size === 0) return;
  // Mevcut batch'ı kopyala ve temizle
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

} // end _statsFlusherRegistered guard

async function incrementStats(jid, userJid, type = "text") {
  const key = `${jid}:${userJid}`;

  // RAM KORU: Max 500 girdi aşılmadan önce en eski girdileri temizle
  if (statsBatch.size >= MAX_STATS_BATCH) {
    // En eski N girdinin üzerinden geç ve sil (FIFO)
    const toDelete = Math.floor(MAX_STATS_BATCH * 0.2); // %20 temizle
    let deleted = 0;
    for (const k of statsBatch.keys()) {
      if (deleted >= toDelete) break;
      statsBatch.delete(k);
      deleted++;
    }
    logger.debug(`[Stats] statsBatch limit aşıldı. ${deleted} eski girdi temizlendi.`);
  }

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
