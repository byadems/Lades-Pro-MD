const { Module } = require("../main");
Module({ pattern: "savetest", fromMe: false, desc: "Save Test" }, async (m) => { await m.sendReply("Saved!"); });