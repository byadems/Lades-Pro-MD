"use strict";

/**
 * core/runtime.js
 * Centralized state management for the bot's runtime.
 * Eliminates global namespace pollution.
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
    // RAM OPT: TTL kısaltıldı, max düşürüldü — stale JID'ler daha hızlı siliniyor
    users: new LRUCache({ max: 500,  ttl: 45 * 60 * 1000 }),   // 2h→45min TTL, 1000→500 max
    groups: new LRUCache({ max: 100, ttl: 6 * 60 * 60 * 1000 }), // 24h→6h TTL, 300→100 max
    /** Global group cache */
    allGroupsCache: null,
    allGroupsLastFetch: 0,
    errors: 0,
  },
  
  /** Active session information */
  activeSessions: new Set(),

  /** Cached parsed SUDO_MAP (Set for O(1) matching) */
  sudoSet: new Set(),

  /** LRU cache for LID -> PN resolutions — RAM OPT: 2000→500, TTL 24h→6h */
  lidCache: new LRUCache({ max: 500, ttl: 6 * 60 * 60 * 1000 }), // 24h→6h, 2000→500

  /** Batch for command performance metrics — plain Map prevents data loss from LRU eviction before flush */
  // RAM OPT: 5000→1000 giriş FIFO sınırı
  commandStatsBatch: new Map(),
  /** Max entries for commandStatsBatch before FIFO eviction */
  MAX_STATS_BATCH: 1000, // 5000→1000

  /** Self-test progress (moved from global namespace) */
  testProgress: { status: 'idle', currentIndex: 0, totalCommands: 0, currentCommand: '' },
};

module.exports = state;
