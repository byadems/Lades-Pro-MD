"use strict";

/**
 * core/scheduler.js
 * Centralized Task Scheduler
 * Minimizes CPU wake-ups by consolidating multiple intervals into a single tick.
 */

const { logger } = require("../config");

class Scheduler {
  constructor(tickMs = 10000) {
    this.tasks = [];
    this._tickMs = tickMs;
    this._interval = null;
  }

  /**
   * Register a recurring task
   * @param {string} name - Task name for logging
   * @param {Function} fn - Async or sync function to run
   * @param {number} intervalMs - Preferred interval
   * @param {object} options - { runImmediately: boolean }
   */
  register(name, fn, intervalMs, options = {}) {
    const task = {
      name,
      fn,
      interval: intervalMs,
      lastRun: options.runImmediately ? 0 : Date.now(),
    };
    this.tasks.push(task);
    
    if (!this._interval) {
      this.start();
    }

    if (options.runImmediately) {
      this._runTask(task);
    }
    
    return () => {
      this.tasks = this.tasks.filter(t => t !== task);
    };
  }

  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this._tick(), this._tickMs);
    logger.debug(`Centralized Scheduler started (tick: ${this._tickMs}ms)`);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  async _tick() {
    const now = Date.now();
    for (const task of this.tasks) {
      if (now - task.lastRun >= task.interval) {
        task.lastRun = now;
        this._runTask(task);
      }
    }
  }

  async _runTask(task) {
    try {
      const result = task.fn();
      if (result instanceof Promise) {
        await result;
      }
    } catch (err) {
      logger.error({ err: err.message, task: task.name }, "Scheduler task failed");
    }
  }
}

// Singleton instance
const scheduler = new Scheduler();

module.exports = scheduler;
