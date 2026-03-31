"use strict";

/**
 * core/manager.js
 * Multi-session bot manager.
 * Manages lifecycle of multiple bot instances.
 */

const { createBot } = require("./bot");
const { logger } = require("../config");

class BotManager {
  constructor() {
    this.bots = new Map(); // sessionId → sock
    this.states = new Map(); // sessionId → "connecting"|"open"|"closed"
  }

  async addSession(sessionId, options = {}) {
    if (this.bots.has(sessionId)) {
      logger.warn(`Session ${sessionId} already exists`);
      return;
    }
    logger.info(`Starting session: ${sessionId}`);
    this.states.set(sessionId, "connecting");

    try {
      const sock = await createBot(sessionId, options);
      this.bots.set(sessionId, sock);

      sock.ev.on("connection.update", ({ connection }) => {
        if (connection === "open") this.states.set(sessionId, "open");
        if (connection === "close") {
          this.states.set(sessionId, "closed");
          this.bots.delete(sessionId);
        }
      });

      return sock;
    } catch (err) {
      logger.error({ err, sessionId }, "Failed to start session");
      this.states.set(sessionId, "error");
    }
  }

  getSession(sessionId) {
    return this.bots.get(sessionId) || null;
  }

  getAllSessions() {
    return Array.from(this.bots.keys());
  }

  getState(sessionId) {
    return this.states.get(sessionId) || "unknown";
  }

  isConnected(sessionId) {
    return this.states.get(sessionId) === "open";
  }

  hasAnyConnected() {
    return Array.from(this.states.values()).some(s => s === "open");
  }

  async removeSession(sessionId) {
    const sock = this.bots.get(sessionId);
    if (sock) {
      await sock.logout().catch(() => {});
      this.bots.delete(sessionId);
      this.states.delete(sessionId);
      logger.info(`Session ${sessionId} removed.`);
    }
  }
}

module.exports = { BotManager };
