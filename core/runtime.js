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
    users: new LRUCache({ max: 150,  ttl: 30 * 60 * 1000 }),   // 500→150 max
    groups: new LRUCache({ max: 50, ttl: 2 * 60 * 60 * 1000 }), // 100→50 max
    allGroupsCache: null,
    allGroupsLastFetch: 0,
    errors: 0,
  },
  
  /** Active session information */
  activeSessions: new Set(),

  /** Cached parsed SUDO_MAP (Set for O(1) matching) */
  sudoSet: new Set(),

  /** LRU cache for LID -> PN resolutions — RAM OPT: 500→150, TTL 6h→2h */
  lidCache: new LRUCache({ max: 150, ttl: 2 * 60 * 60 * 1000 }),

  /** Batch for command performance metrics — plain Map prevents data loss from LRU eviction before flush */
  // RAM OPT: 1000→200 giriş FIFO sınırı
  commandStatsBatch: new Map(),
  /** Max entries for commandStatsBatch before FIFO eviction */
  MAX_STATS_BATCH: 200, // 1000→200

  /** Self-test progress (moved from global namespace) */
  testProgress: { status: 'idle', currentIndex: 0, totalCommands: 0, currentCommand: '' },
};

module.exports = state;
