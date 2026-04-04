const { Module } = require("../main");

Module(
  {
    pattern: "ybaşlat",
    fromMe: true,
    desc: "Botu yeniden başlatır",
    use: "system",
  },
  async (m) => {
    await m.sendReply("_🔄 Bot yeniden başlatılıyor..._");
    process.exit(0);
  }
);
