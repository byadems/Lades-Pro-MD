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
    // TTL ile stale JID'ler otomatik siliniyor: bellek birikimini engeller
    users: new LRUCache({ max: 1000, ttl: 2 * 60 * 60 * 1000 }),  // 2h TTL, max 1000
    groups: new LRUCache({ max: 300, ttl: 24 * 60 * 60 * 1000 }), // 24h TTL, max 300
    /** Global group cache */
    allGroupsCache: null,
    allGroupsLastFetch: 0,
    errors: 0,
  },
  
  /** Active session information */
  activeSessions: new Set(),

  /** Cached parsed SUDO_MAP (Set for O(1) matching) */
  sudoSet: new Set(),

  /** LRU cache for LID -> PN resolutions — boyut 5000→2000, TTL 24h */
  lidCache: new LRUCache({ max: 2000, ttl: 1000 * 60 * 60 * 24 }), // 24h cache

  /** Batch for command performance metrics — plain Map prevents data loss from LRU eviction before flush */
  // PERFORMANS: 5000 giriş FIFO sınırı — yoğun trafikte bellek birikmesini önler
  commandStatsBatch: new Map(),
  /** Max entries for commandStatsBatch before FIFO eviction */
  MAX_STATS_BATCH: 5000,

  /** Self-test progress (moved from global namespace) */
  testProgress: { status: 'idle', currentIndex: 0, totalCommands: 0, currentCommand: '' },
};

module.exports = state;
