"use strict";

/**
 * plugins/utils/grupstat.js
 * Günlük grup mesaj istatistikleri — in-memory sayaç.
 * Gün değişiminde otomatik temizlenir.
 * core/bot.js'den çağrılır, grup_istatistikleri.js'de sorgulanır.
 */

const stats = new Map(); // "YYYY-MM-DD:groupJid" -> Map(userJid -> count)

function dayLabel() {
  return new Date().toISOString().slice(0, 10); // "2024-01-15"
}

/**
 * Bir grup kullanıcısının mesaj sayısını artırır.
 * @param {string} groupJid - Grup JID (@g.us)
 * @param {string} userJid  - Kullanıcı JID
 */
function countMessage(groupJid, userJid) {
  if (!groupJid || !userJid) return;
  const key = `${dayLabel()}:${groupJid}`;
  if (!stats.has(key)) stats.set(key, new Map());
  const g = stats.get(key);
  g.set(userJid, (g.get(userJid) || 0) + 1);

  // Eski günlerin verilerini temizle (bellek sızıntısı önleme)
  const today = dayLabel();
  for (const k of stats.keys()) {
    if (!k.startsWith(today)) stats.delete(k);
  }
}

/**
 * Belirtilen grubun bugünkü istatistiklerini döner.
 * @param {string} groupJid
 * @returns {Map<string, number>} userJid -> count
 */
function getGroupStats(groupJid) {
  const key = `${dayLabel()}:${groupJid}`;
  return stats.get(key) || new Map();
}

/**
 * Bugünkü toplam mesaj sayısını döner.
 * @param {string} groupJid
 * @returns {number}
 */
function getTotalToday(groupJid) {
  const m = getGroupStats(groupJid);
  let total = 0;
  for (const v of m.values()) total += v;
  return total;
}

/**
 * Bir kullanıcının gruptaki bugünkü mesaj sayısı ve sıralamasını döner.
 * @param {string} groupJid
 * @param {string} userJid
 * @returns {{ count: number, rank: number, total: number, totalUsers: number }}
 */
function getUserStats(groupJid, userJid) {
  const m = getGroupStats(groupJid);
  const count = m.get(userJid) || 0;
  const total = getTotalToday(groupJid);
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const rank = sorted.findIndex(([id]) => id === userJid) + 1;
  return { count, rank: rank || sorted.length + 1, total, totalUsers: sorted.length };
}

module.exports = { countMessage, getGroupStats, getTotalToday, getUserStats };
