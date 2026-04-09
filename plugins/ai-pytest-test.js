const { Module } = require("../main");
Module({ pattern: "pytest", fromMe: false, desc: "Test" }, async (m) => { await m.sendReply("Test!"); });