"use strict";

/**
 * core/channel-cache.js
 * Newsletter kanallarından gelen son mesajları bellek + DB'de tutar.
 * newsletterFetchMessages IQ sorgusu sıkça zaman aşımına uğradığı için
 * bu önbellekten okuruz. DB persistance sayesinde Republish/restart
 * sonrası en son kanal mesajı kaybolmaz.
 */

const _cache = new Map(); // jid → { msg: WAMessage, savedAt: number }
const KEY_PREFIX = "channel_cache:";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let _BotAyar = null;
let _proto = null;

const getModels = () => {
  if (!_BotAyar) {
    try { _BotAyar = require("./database").BotAyar; } catch { /* DB henüz hazır değil */ }
  }
  return _BotAyar;
};

const getProto = () => {
  if (!_proto) {
    try { _proto = require("@whiskeysockets/baileys").proto; } catch { /* eklenti yüklenmedi */ }
  }
  return _proto;
};

const dbKey = (jid) => `${KEY_PREFIX}${jid}`;

/**
 * Mesajı DB'ye kalıcı yaz. Hata olursa sessizce yutar (bellek hâlâ tutar).
 */
async function persistToDb(jid, msg, savedAt) {
  const BotAyar = getModels();
  const proto = getProto();
  if (!BotAyar || !proto) return;
  try {
    const bytes = proto.WebMessageInfo.encode(msg).finish();
    const value = JSON.stringify({
      v: 1,
      savedAt,
      msgB64: Buffer.from(bytes).toString("base64"),
    });
    await BotAyar.upsert({ key: dbKey(jid), value });
  } catch (e) {
    console.warn(`[ChannelCache] DB'ye yazılamadı (${jid}): ${e?.message}`);
  }
}

/**
 * DB'den belirli kanalın son mesajını oku ve belleğe yükle.
 * @returns {object|null}  WAMessage veya null
 */
async function loadFromDb(jid) {
  const BotAyar = getModels();
  const proto = getProto();
  if (!BotAyar || !proto) return null;
  try {
    const row = await BotAyar.findByPk(dbKey(jid));
    if (!row || !row.value) return null;
    const data = JSON.parse(row.value);
    if (!data.msgB64) return null;
    const buf = Buffer.from(data.msgB64, "base64");
    const msg = proto.WebMessageInfo.decode(buf);
    const savedAt = Number(data.savedAt) || Date.now();
    _cache.set(jid, { msg, savedAt });
    return msg;
  } catch (e) {
    console.warn(`[ChannelCache] DB'den okunamadı (${jid}): ${e?.message}`);
    return null;
  }
}

/**
 * Tüm kayıtlı kanal mesajlarını DB'den belleğe yükle (bot startup'ta çağırılır).
 */
async function preloadFromDb() {
  const BotAyar = getModels();
  const proto = getProto();
  if (!BotAyar || !proto) return 0;
  try {
    const { Op } = require("sequelize");
    const rows = await BotAyar.findAll({
      where: { key: { [Op.like]: `${KEY_PREFIX}%` } },
    });
    let loaded = 0;
    for (const row of rows) {
      const jid = row.key.slice(KEY_PREFIX.length);
      try {
        const data = JSON.parse(row.value);
        if (!data?.msgB64) continue;
        const buf = Buffer.from(data.msgB64, "base64");
        const msg = proto.WebMessageInfo.decode(buf);
        const savedAt = Number(data.savedAt) || Date.now();
        _cache.set(jid, { msg, savedAt });
        loaded++;
      } catch (e) {
        console.warn(`[ChannelCache] Preload bozuk satır (${jid}): ${e?.message}`);
      }
    }
    if (loaded > 0) {
      console.log(`[ChannelCache] ${loaded} kanal mesajı DB'den belleğe yüklendi.`);
    }
    return loaded;
  } catch (e) {
    console.warn(`[ChannelCache] Preload başarısız: ${e?.message}`);
    return 0;
  }
}

/**
 * Kanal JID'i için son mesajı kaydet (bellek + DB).
 * @param {string} jid  "@newsletter" ile biten JID
 * @param {object} msg  Baileys WAMessage nesnesi
 */
function setLastMsg(jid, msg) {
  const savedAt = Date.now();
  _cache.set(jid, { msg, savedAt });
  // Async — engellemez
  persistToDb(jid, msg, savedAt).catch(() => {});
}

/**
 * Kanal JID'i için önbellekteki son mesajı döndür (yalnızca bellek).
 * Bellekte yoksa null döner; çağıran taraf DB'den yüklemek için
 * loadLastMsgAsync()'i de deneyebilir.
 *
 * @param {string} jid
 * @param {number} [maxAgeMs=86400000]
 * @returns {object|null}  WAMessage ya da null
 */
function getLastMsg(jid, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  const entry = _cache.get(jid);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > maxAgeMs) {
    _cache.delete(jid);
    return null;
  }
  return entry.msg;
}

/**
 * Önce belleğe, sonra DB'ye bakarak son kanal mesajını döner.
 * Republish sonrası bellek boşsa DB'den lazy-load yapar.
 */
async function loadLastMsgAsync(jid, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  const cached = getLastMsg(jid, maxAgeMs);
  if (cached) return cached;
  const fromDb = await loadFromDb(jid);
  if (!fromDb) return null;
  // Yaş kontrolünü uygula
  const entry = _cache.get(jid);
  if (entry && Date.now() - entry.savedAt > maxAgeMs) {
    _cache.delete(jid);
    return null;
  }
  return fromDb;
}

/**
 * Önbellekteki tüm kanalları döndür (debug için).
 */
function getAllCached() {
  const out = {};
  for (const [jid, entry] of _cache.entries()) {
    out[jid] = { savedAt: entry.savedAt, hasMessage: !!entry.msg };
  }
  return out;
}

module.exports = {
  setLastMsg,
  getLastMsg,
  loadLastMsgAsync,
  preloadFromDb,
  getAllCached,
};
