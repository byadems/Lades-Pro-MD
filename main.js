"use strict";

/**
 * main.js - Bridge for original Lades-MD plugins
 * Redirects plugin registrations to the core handler.
 */

const { Module, commands } = require("./core/handler");

module.exports = {
  Module,
  commands,
  bot: Module
};
