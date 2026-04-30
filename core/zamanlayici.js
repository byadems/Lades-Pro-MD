"use strict";

/**
 * core/scheduler.js
 * Centralized Task Scheduler
 * Minimizes CPU wake-ups by consolidating multiple intervals into a single tick.
 */

const { logger } = require("../config");

class Scheduler {
  constructor(tickMs = parseInt(process.env.SCHEDULER_TICK_MS || "20000", 10)) {
    // 0.2 vCPU OPT: Tick 15s → 20s. Her tick CPU wake-up demek; 33% daha az
    // periyodik wake = idle anlarında daha düşük CPU kullanımı.
    // Tüm görev aralıkları zaten saniyeler değil dakikalar mertebesinde,
    // bu yüzden 20s tick hassasiyeti fazlasıyla yeterli.

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
      logger.error({ err: err.message, task: task.name }, "Zamanlayıcı görevi başarısız");
    }
  }
}

// Singleton instance
const scheduler = new Scheduler();





/**
 * core/schedulers.js
 * Cron-based scheduled tasks using node-cron.
 */

const cron = require("node-cron");

const { Zamanlama } = require("./database");

const activeTasks = new Map(); // id → cron task

async function startSchedulers(client) {
  try {
    const schedules = await Zamanlama.findAll({ where: { active: true } });
    for (const s of schedules) {
      registerSchedule(client, s.get({ plain: true }));
    }
    logger.info(`${schedules.length} zamanlanmış görev başlatıldı.`);
  } catch (err) {
    logger.error({ err }, "Zamanlama verileri yüklenemedi");
  }
}

function registerSchedule(client, schedule) {
  if (!cron.validate(schedule.cronExpr)) {
    logger.warn({ cronExpr: schedule.cronExpr }, "Invalid cron expression");
    return;
  }
  const task = cron.schedule(schedule.cronExpr, async () => {
    try {
      await client.sendMessage(schedule.groupId, { text: schedule.message });
      logger.debug({ groupId: schedule.groupId }, "Scheduled message sent");
    } catch (err) {
      logger.error({ err, scheduleId: schedule.id }, "Planlı mesaj gönderilemedi");
    }
  }, { timezone: process.env.TIMEZONE || "Europe/Istanbul" });

  activeTasks.set(schedule.id, task);
  return task;
}

async function addSchedule(client, data) {
  const record = await Zamanlama.create(data);
  registerSchedule(client, record.get({ plain: true }));
  return record;
}

async function removeSchedule(id) {
  const task = activeTasks.get(id);
  if (task) { task.stop(); activeTasks.delete(id); }
  await Zamanlama.update({ active: false }, { where: { id } });
}

function stopAllSchedulers() {
  for (const [id, task] of activeTasks) { task.stop(); }
  activeTasks.clear();
  logger.info("Tüm zamanlayıcılar durduruldu.");
}



module.exports = { scheduler, startSchedulers, registerSchedule, addSchedule, removeSchedule, stopAllSchedulers };
