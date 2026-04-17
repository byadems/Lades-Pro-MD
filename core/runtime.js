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
    users: new LRUCache({ max: 2000 }),
    groups: new LRUCache({ max: 500 }),
    /** Global group cache */
    allGroupsCache: null,
    allGroupsLastFetch: 0,
    errors: 0,
  },
  
  /** Active session information */
  activeSessions: new Set(),

  /** Cached parsed SUDO_MAP (Set for O(1) matching) */
  sudoSet: new Set(),

  /** LRU cache for LID -> PN resolutions (Avoid redundant auth-state queries) */
  lidCache: new LRUCache({ max: 5000, ttl: 1000 * 60 * 60 * 24 }), // 24h cache

  /** Batch for command performance metrics — plain Map prevents data loss from LRU eviction before flush */
  // PERFORMANS: 5000 giriş FIFO sınırı — yoğun trafikte bellek birikmesini önler
  commandStatsBatch: new Map(),
  /** Max entries for commandStatsBatch before FIFO eviction */
  MAX_STATS_BATCH: 5000,

  /** Self-test progress (moved from global namespace) */
  testProgress: { status: 'idle', currentIndex: 0, totalCommands: 0, currentCommand: '' },
};

module.exports = state;
