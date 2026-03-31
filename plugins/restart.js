const { Module } = require("../main");

Module(
  {
    pattern: "ybaşlat|reload|reboot",
    fromMe: true,
    desc: "Botu yeniden başlatır",
    use: "system",
  },
  async (m) => {
    await m.sendReply("_🔄 Bot yeniden başlatılıyor..._");
    process.exit(0);
  }
);
