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
// 24/7 OPT: Antidelete için 60 JID yeterli, TTL 2 saat
// Disk-first felsefe: Eski mesajlar bellekten düşsün, DB/WhatsApp'tan alınsın
const messageStore = new LRUCache({
  max: 60,   // 80→60: daha az JID bellekte, antidelete hala çalışır
  ttl: 2 * 60 * 60 * 1000, // 2 saat TTL (3h→2h: daha az bellek basıncı)
  dispose: (bucket, jid) => {
    if (bucket instanceof Map) {
      for (const msgId of bucket.keys()) msgIdIndex.delete(msgId);
    }
  },
});

// Reverse index: msgId → jid (O(1) lookup for getFullMessage)
const msgIdIndex = new Map();
const MAX_MSGS_PER_JID = 50;    // 60→50: %16 daha az bellek, antidelete için yeterli
const MAX_MSGID_INDEX = 900;    // 1200→900: Daha sıkı indeks sınırı

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

function getAlbumMessages(jid, albumId) {
  const bucket = messageStore.get(jid);
  if (!bucket) return [];
  const children = [];
  for (const msg of bucket.values()) {
    const parentId = msg.message?.messageContextInfo?.messageAssociation?.parentMessageKey?.id;
    if (parentId === albumId) {
      children.push(msg);
    }
  }
  return children.sort((a, b) => {
    const idxA = a.message?.messageContextInfo?.messageAssociation?.messageIndex || 0;
    const idxB = b.message?.messageContextInfo?.messageAssociation?.messageIndex || 0;
    return idxA - idxB;
  });
}

// ─────────────────────────────────────────────────────────
//  Group metadata
// ─────────────────────────────────────────────────────────
// Group metadata cache: 24/7 OPT — 300 kapasiteyle 300 grubu kapsıyor
// Cache miss = WhatsApp API sorgusu = rate-overlimit riski
// TTL 4dk: Admin değişikliği algılanması için yeterli, 5dk→4dk: daha hızlı eviction
const groupMetaCache = new LRUCache({
  max: 300,  // 400→300: 300 grup için tam uygun, gereksiz 100 slot kaldırıldı
  ttl: 4 * 60 * 1000,
});

function setGroupMeta(groupId, meta) {
  groupMetaCache.set(groupId, meta);
}

function getGroupMeta(groupId) {
  return groupMetaCache.get(groupId) || null;
}

const groupMetaErrorCache = new Map();

async function fetchGroupMeta(client, groupId) {
  const cached = getGroupMeta(groupId);
  if (cached) return cached;
  
  // Hata cache kontrolü: Eğer son 30 saniye içinde başarısız olduysa, tekrar deneme (Kuyruk tıkanıklığını önler)
  const lastError = groupMetaErrorCache.get(groupId);
  if (lastError && (Date.now() - lastError) < 30000) {
    return null;
  }

  try {
    // Kilitlenmeyi (deadlock) önlemek için 5 saniyelik zorunlu zaman aşımı (timeout)
    const meta = await Promise.race([
      client.groupMetadata(groupId),
      new Promise((_, reject) => setTimeout(() => reject(new Error("groupMetadata timeout")), 5000))
    ]);
    setGroupMeta(groupId, meta);
    return meta;
  } catch (err) {
    logger.debug({ err: err.message, groupId }, "Grup meta verileri alınamadı");
    groupMetaErrorCache.set(groupId, Date.now()); // Hata anını kaydet
    return null;
  }
}

function invalidateGroupMeta(groupId) {
  groupMetaCache.delete(groupId);
}

async function getAllGroups(sock) {
  const now = Date.now();
  // 24/7 OPT: allGroupsCache TTL 5 dakika — gece saatlerinde gereksiz WA sorgusu önlenir
  if (runtime.metrics.allGroupsCache && (now - runtime.metrics.allGroupsLastFetch < 5 * 60 * 1000)) {
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
    logger.debug({ err: err.message }, "Tüm gruplar alınamadı");
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

async function fetchRecentChats(limit = 100) {
  const jids = Array.from(messageStore.keys());
  const chats = [];

  for (const jid of jids) {
    const bucket = messageStore.get(jid);
    let lastMessageTime = Date.now();

    if (bucket && bucket.size > 0) {
      const msgs = Array.from(bucket.values());
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.messageTimestamp) {
        const ts = lastMsg.messageTimestamp;
        lastMessageTime = (typeof ts === "object" ? ts.low : ts) * 1000;
      }
    }

    chats.push({
      id: jid,
      jid: jid,
      type: jid.endsWith("@g.us") ? "group" : "private",
      lastMessageTime: lastMessageTime,
      name: "Bilinmiyor"
    });
  }

  chats.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
  return chats.slice(0, limit);
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
    logger.debug({ err, jid }, "Mağazadan alınamadı");
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
    logger.debug({ err, jid }, "En iyi kullanıcılar alınamadı");
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
    logger.debug({ err }, "Global en iyi kullanıcılar alınamadı");
    return [];
  }
}

/**
 * Increments message statistics for a user in a specific chat.
 * @param {string} jid - The chat JID
 * @param {string} userJid - The user JID
 * @param {string} type - Message type (text, image, video, audio, sticker, other)
 */
// stats batch: plain Map (LRUCache'den daha hafif; TTL auto-expiry gereksiz — flush zaten 90s'de yapılıyor)
// 24/7 OPT: Flush aralığı 90s'e çıkarıldı, DB write %33 azaldı
const statsBatch = new Map();
const MAX_STATS_BATCH = 250; // 400→250: Flush 90s aralıkla; 250 farklı user:group kombinasyonu yeterli (~50KB)

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
    // OPT: KullaniciVeri.findOrCreate ön-yüklemesi kaldırıldı
    // Yabancı anahtar zorlaması kapalı (database.js: foreign_keys=OFF)
    // Bu sayı iter başına 4 sorgu yerine 2 sorgu kullanılıyor.

    // PostgreSQL / Sequelize v7+: bulkCreate + updateOnDuplicate ile tek sorguda upsert
    try {
      const now = new Date();
      const records = currentBatch.map(([_, inc]) => ({
        jid: inc.jid,
        userJid: inc.userJid,
        totalMessages:   inc.data.totalMessages,
        textMessages:    inc.data.textMessages,
        imageMessages:   inc.data.imageMessages,
        videoMessages:   inc.data.videoMessages,
        audioMessages:   inc.data.audioMessages,
        stickerMessages: inc.data.stickerMessages,
        otherMessages:   inc.data.otherMessages,
        lastMessageAt:   now,
      }));

      await MesajIstatistik.bulkCreate(records, {
        updateOnDuplicate: [
          'totalMessages', 'textMessages', 'imageMessages',
          'videoMessages', 'audioMessages', 'stickerMessages',
          'otherMessages', 'lastMessageAt', 'updatedAt',
        ],
        // SQLite özgü kilitlenme sorununa karşı timeout
        timeout: 15000,
      });
      return; // Başarılı — erken dön
    } catch (_bulkErr) {
      // bulkCreate+updateOnDuplicate desteklenmiyorsa (eski SQLite) fallback
    }

    // Fallback: her satır için findOrCreate + increment (2 sorgu, 4 değil)
    for (const [key, inc] of currentBatch) {
      const { jid, userJid, data } = inc;
      const now = new Date();
      try {
        const [record, created] = await MesajIstatistik.findOrCreate({
          where: { jid, userJid },
          defaults: { ...data, lastMessageAt: now },
        });

        if (!created) {
          // increment + update yerine tek bir update çağrısı
          await record.update({
            totalMessages:   record.totalMessages   + data.totalMessages,
            textMessages:    record.textMessages    + data.textMessages,
            imageMessages:   record.imageMessages   + data.imageMessages,
            videoMessages:   record.videoMessages   + data.videoMessages,
            audioMessages:   record.audioMessages   + data.audioMessages,
            stickerMessages: record.stickerMessages + data.stickerMessages,
            otherMessages:   record.otherMessages   + data.otherMessages,
            lastMessageAt:   now,
          });
        }
      } catch (rowErr) {
        logger.debug({ err: rowErr.message, jid, userJid }, "İstatistik satırı kaydedilemedi");
      }
    }
  } catch (e) {
    logger.debug({ err: e.message }, "İstatistik toplu flush başarısız");
  }
}, 90000); // 60s→90s: 24/7 OPT — DB yazım sıklığı azaltıldı, bağlantı havuzu rahatlar

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
  storeMessage, getMessage, getMessageByKey, getAlbumMessages,
  setGroupMeta, getGroupMeta, fetchGroupMeta, invalidateGroupMeta,
  bindToSocket, getStoreStats,
  getTotalUserCount, getFullMessage, fetchRecentChats,
  fetchFromStore, getTopUsers, getGlobalTopUsers,
  incrementStats,
  getAllGroups,
};
