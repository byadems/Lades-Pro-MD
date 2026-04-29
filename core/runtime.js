"use strict";

/**
 * core/runtime.js
 * Centralized state management for the bot's runtime.
 * Eliminates global namespace pollution.
 * 
 * 24/7 ULTRA PERFORMANS: Tüm LRU cache boyutları minimize edildi.
 * Stale veri daha hızlı temizlenir, GC baskısı azalır.
 */

const { LRUCache } = require("lru-cache");

const state = {
  /** Bot start timestamp */
  startTime: Date.now(),
  
  /** BotManager instance */
  manager: null,
  
  /** Dashboard metrics */
  metrics: {
    messages: 0,
    commands: 0,
    // 24/7 OPT: Daha sıkı LRU sınırları — stale JID'ler hızla atılır
    // Aktif kullanıcı sayımı DB-backed (MesajIstatistik); bu sadece anlık snapshot.
    users: new LRUCache({ max: 100,  ttl: 20 * 60 * 1000 }),   // 150→100, 30dk→20dk TTL
    groups: new LRUCache({ max: 40, ttl: 60 * 60 * 1000 }),     // 50→40, 2h→1h TTL
    allGroupsCache: null,
    allGroupsLastFetch: 0,
    errors: 0,
  },
  
  /** Active session information */
  activeSessions: new Set(),

  /** Cached parsed SUDO_MAP (Set for O(1) matching) */
  sudoSet: new Set(),

  /** LRU cache for LID -> PN resolutions — 24/7 OPT: daha sıkı */
  lidCache: new LRUCache({ max: 100, ttl: 60 * 60 * 1000 }), // 150→100, 2h→1h

  /** Batch for command performance metrics — plain Map prevents data loss from LRU eviction before flush */
  commandStatsBatch: new Map(),
  /** Max entries for commandStatsBatch before FIFO eviction */
  MAX_STATS_BATCH: 150, // 200→150: Flush aralığı 30s; bu sürede 150 farklı komut yeterli

  /** Self-test progress (moved from global namespace) */
  testProgress: { status: 'idle', currentIndex: 0, totalCommands: 0, currentCommand: '' },
};

module.exports = state;
