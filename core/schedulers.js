"use strict";

/**
 * core/schedulers.js
 * Cron-based scheduled tasks using node-cron.
 */

const cron = require("node-cron");
const { logger } = require("../config");
const { Schedule } = require("./database");

const activeTasks = new Map(); // id → cron task

async function startSchedulers(client) {
  try {
    const schedules = await Schedule.findAll({ where: { active: true } });
    for (const s of schedules) {
      registerSchedule(client, s.get({ plain: true }));
    }
    logger.info(`Started ${schedules.length} scheduled tasks.`);
  } catch (err) {
    logger.error({ err }, "Failed to load schedules from DB");
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
      logger.error({ err, scheduleId: schedule.id }, "Failed to send scheduled message");
    }
  }, { timezone: "Europe/Istanbul" });

  activeTasks.set(schedule.id, task);
  return task;
}

async function addSchedule(client, data) {
  const record = await Schedule.create(data);
  registerSchedule(client, record.get({ plain: true }));
  return record;
}

async function removeSchedule(id) {
  const task = activeTasks.get(id);
  if (task) { task.stop(); activeTasks.delete(id); }
  await Schedule.update({ active: false }, { where: { id } });
}

function stopAllSchedulers() {
  for (const [id, task] of activeTasks) { task.stop(); }
  activeTasks.clear();
  logger.info("All schedulers stopped.");
}

module.exports = { startSchedulers, registerSchedule, addSchedule, removeSchedule, stopAllSchedulers };
