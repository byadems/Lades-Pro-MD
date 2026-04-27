"use strict";

/**
 * core/channel-cache.js
 * Newsletter kanallarından gelen son mesajları bellekte tutar.
 * newsletterFetchMessages IQ sorgusu yerine bu önbellekten faydalanılır.
 */

const _cache = new Map(); // jid → { msg: WAMessage, savedAt: number }

/**
 * Kanal JID'i için son mesajı kaydet.
 * @param {string} jid  "@newsletter" ile biten JID
 * @param {object} msg  Baileys WAMessage nesnesi
 */
function setLastMsg(jid, msg) {
  _cache.set(jid, { msg, savedAt: Date.now() });
}

/**
 * Kanal JID'i için önbellekteki son mesajı döndür.
 * @param {string} jid
 * @param {number} [maxAgeMs=86400000]  En fazla kaç ms eski olabilir (varsayılan 24 saat)
 * @returns {object|null}  WAMessage ya da null
 */
function getLastMsg(jid, maxAgeMs = 24 * 60 * 60 * 1000) {
  const entry = _cache.get(jid);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > maxAgeMs) {
    _cache.delete(jid);
    return null;
  }
  return entry.msg;
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

module.exports = { setLastMsg, getLastMsg, getAllCached };
