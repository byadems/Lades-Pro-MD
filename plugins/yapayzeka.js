const { Module } = require("../main");
const fs = require("fs").promises;
const path = require("path");
const { logger } = require("../config");

Module({
  pattern: "yapayzeka ?(.*)",
  fromMe: true,
  desc: "Yapay zeka ile yeni bot komutları üretir ve kaydeder.",
  usage: ".yapayzeka [komut_adı] | [kod]",
  use: "yönetim",
},
async (message, match) => {
  const input = match[1];
  if (!input || !input.includes("|")) {
    return await message.sendReply("_⚠️ Lütfen formatı takip edin: .yapayzeka komut_adı | kod_");
  }

  const [name, ...codeParts] = input.split("|");
  const cmdName = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const code = codeParts.join("|").trim();

  if (!cmdName || !code) {
    return await message.sendReply("_❌ Geçersiz komut adı veya kod!_");
  }

  // Security Check: No eval, exec, or other dangerous keywords
  const dangerousKeywords = ["eval", "exec", "child_process", "spawn", "rm -rf", "process.exit"];
  const foundDangerous = dangerousKeywords.find(kw => code.includes(kw));
  
  if (foundDangerous) {
    return await message.sendReply(`_🛡️ Güvenlik Engeli: Kod içerisinde tehlikeli bir ifade tespit edildi: *${foundDangerous}*_`);
  }

  const generatedDir = path.join(__dirname, "ai-generated");
  const filePath = path.join(generatedDir, `${cmdName}.js`);

  try {
    // Ensure directory exists
    await fs.mkdir(generatedDir, { recursive: true });

    // Save code asynchronously
    await fs.writeFile(filePath, code, "utf-8");
    
    await message.sendReply(`_✅ Komut başarıyla üretildi ve kaydedildi: *${cmdName}.js*_\n_Botu yeniden başlatarak veya '.yükle' komutu ile aktif edebilirsiniz._`);
  } catch (err) {
    logger.error({ err: err.message, cmdName }, "AI command save failed");
    await message.sendReply(`_❌ Kaydedilirken bir hata oluştu: ${err.message}_`);
  }
});