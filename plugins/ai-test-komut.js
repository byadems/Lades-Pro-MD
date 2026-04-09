const { Module } = require("../main");
Module({ pattern: "testcmd", fromMe: false, desc: "Test komutu" }, async (m) => { await m.sendReply("Test!"); });