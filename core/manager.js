"use strict";

/**
 * core/manager.js
 * Multi-session bot manager.
 * Manages lifecycle of multiple bot instances.
 */

const EventEmitter = require("events");
const { createBot } = require("./bot");
const { logger } = require("../config");

class BotManager extends EventEmitter {
  constructor() {
    super();
    this.bots = new Map(); // sessionId → sock
    this.states = new Map(); // sessionId → "connecting"|"open"|"closed"
    this.suspendedSessions = new Set(); // sessionId → true (if being handled by dashboard)
  }

  suspend(sessionId) {
    logger.info(`Oturum ${sessionId} ASKIYA ALINDI (Kontrol Panelinde).`);
    this.suspendedSessions.add(sessionId);
  }

  resume(sessionId) {
    logger.info(`Oturum ${sessionId} DEVAM EDİYOR.`);
    this.suspendedSessions.delete(sessionId);
  }

  isSuspended(sessionId) {
    return this.suspendedSessions.has(sessionId);
  }

  async addSession(sessionId, options = {}) {
    if (this.bots.has(sessionId)) {
      logger.warn(`Session ${sessionId} already exists`);
      return this.bots.get(sessionId);
    }
    logger.info(`Oturum başlatılıyor: ${sessionId}`);
    this.states.set(sessionId, "connecting");
    this.emit("status", { sessionId, status: "connecting" });

    try {
      // Pass the manager to createBot so it can notify when a new socket is created
      const sock = await createBot(sessionId, { ...options, manager: this });
      this.bots.set(sessionId, sock);

      this._bindEvents(sessionId, sock);

      return sock;
    } catch (err) {
      logger.error({ err, sessionId }, "Failed to start session");
      this.states.set(sessionId, "error");
    }
  }

  _bindEvents(sessionId, sock) {
    sock.ev.on("connection.update", ({ connection }) => {
      if (connection) {
        this.states.set(sessionId, connection);
        this.emit("status", { sessionId, status: connection });
      }
    });
  }

  updateSocket(sessionId, newSock) {
    logger.info(`Session ${sessionId} socket updated (reconnected)`);
    this.bots.set(sessionId, newSock);
    this._bindEvents(sessionId, newSock);
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

  /**
   * Removes a session from the manager.
   * @param {string} sessionId 
   * @param {boolean} isLogout If true, performs a full logout (deletes credentials).
   */
  async removeSession(sessionId, isLogout = false) {
    const sock = this.bots.get(sessionId);
    if (sock) {
      if (isLogout) {
        logger.info(`Performing full logout for session: ${sessionId}`);
        sock.__intentionalLogout = true;
        await sock.logout().catch(() => {});
      } else {
        logger.info(`Stopping session (connection only): ${sessionId}`);
        sock.ws.close();
      }
      this.bots.delete(sessionId);
      this.states.delete(sessionId);
      logger.info(`Session ${sessionId} removed from manager.`);
    }
  }
}

module.exports = { BotManager };
