/**
 * plugins/hermit-features.js
 * hermit-bot'dan uyarlanan özellikler
 * - Mesaj yönlendirme
 * - Otomatik tepki
 * - Sistem bilgisi  
 * - QR kod oluşturma
 * Tüm çıktılar %100 Türkçe
 */
const { Module } = require("../main");
const os = require("os");

// ══════════════════════════════════════════════════════
// Mesaj Yönlendirme
// ══════════════════════════════════════════════════════
Module({
  pattern: "ilet ?(.*)",
  fromMe: true,
  desc: "Yanıtlanan mesajı belirtilen sohbete yönlendirir.",
  usage: ".ilet [numara veya grup jid]",
  use: "araçlar",
}, async (message, match) => {
  const target = (match[1] || "").trim();
  if (!target) return await message.sendReply("_Hedef numara/grup girin:_ `.ilet 905xxxxxxxxx`");
  if (!message.reply_message) return await message.sendReply("_Bir mesajı yanıtlayarak kullanın._");

  try {
    const jid = target.includes("@") ? target : target + "@s.whatsapp.net";
    await message.client.sendMessage(jid, {
      forward: message.reply_message.data || message.data
    });
    await message.sendReply("_Mesaj iletildi._");
  } catch (e) {
    await message.sendReply(`_Mesaj iletilemedi:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Otomatik Tepki (Auto React)  
// ══════════════════════════════════════════════════════
Module({
  pattern: "ototepki ?(.*)",
  fromMe: true,
  desc: "Gelen mesajlara otomatik emoji tepkisi verir (aç/kapat).",
  usage: ".ototepki ac | .ototepki kapat",
  use: "ayarlar",
}, async (message, match) => {
  const arg = (match[1] || "").trim().toLowerCase();
  if (!global._autoReactGroups) global._autoReactGroups = new Set();

  if (arg === "ac" || arg === "aç") {
    global._autoReactGroups.add(message.jid);
    await message.sendReply("_Otomatik tepki bu sohbet için açıldı._");
  } else if (arg === "kapat" || arg === "kapa") {
    global._autoReactGroups.delete(message.jid);
    await message.sendReply("_Otomatik tepki bu sohbet için kapatıldı._");
  } else {
    const status = global._autoReactGroups.has(message.jid) ? "Açık" : "Kapalı";
    await message.sendReply(`*Otomatik Tepki:* ${status}\n\n_.ototepki ac_ - Açmak için\n_.ototepki kapat_ - Kapatmak için`);
  }
});

// ══════════════════════════════════════════════════════
// Sistem Bilgisi
// ══════════════════════════════════════════════════════
Module({
  pattern: "(?:sistembilgi|sysinfo)",
  fromMe: false,
  desc: "Sistem donanım ve yazılım bilgilerini gösterir.",
  usage: ".sistembilgi",
  use: "araçlar",
}, async (message) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const secs = Math.floor(uptime % 60);

  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : "Bilinmiyor";

  const text = [
    `*Sistem Bilgileri*\n`,
    `*Platform:* ${os.platform()} ${os.arch()}`,
    `*Hostname:* ${os.hostname()}`,
    `*OS:* ${os.type()} ${os.release()}`,
    `*Node.js:* ${process.version}`,
    `*CPU:* ${cpuModel}`,
    `*CPU Çekirdek:* ${cpus.length}`,
    `*Toplam RAM:* ${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
    `*Kullanılan RAM:* ${(usedMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
    `*Boş RAM:* ${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
    `*Bot RAM:* ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
    `*Çalışma Süresi:* ${hours}s ${mins}dk ${secs}sn`,
    `*PID:* ${process.pid}`,
  ].join("\n");

  await message.sendReply(text);
});

// ══════════════════════════════════════════════════════
// Herkes Etiketleme (Tag All)
// ══════════════════════════════════════════════════════
Module({
  pattern: "herkese ?(.*)",
  fromMe: true,
  desc: "Gruptaki herkesi etiketler.",
  usage: ".herkese [mesaj]",
  use: "grup",
}, async (message, match) => {
  if (!message.jid.endsWith("@g.us")) return await message.sendReply("_Bu komut sadece gruplarda çalışır._");

  try {
    const metadata = await message.client.groupMetadata(message.jid);
    const participants = metadata.participants.map(p => p.id);
    const text = (match[1] || "Herkes!").trim();

    const mentions = participants;
    const mentionText = participants.map(p => `@${p.split("@")[0]}`).join(" ");

    await message.client.sendMessage(message.jid, {
      text: `${text}\n\n${mentionText}`,
      mentions
    }, { quoted: message.data });
  } catch (e) {
    await message.sendReply(`_Etiketleme başarısız:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Çevrimiçi Durum Değiştirme
// ══════════════════════════════════════════════════════
Module({
  pattern: "durumyaz ?(.*)",
  fromMe: true,
  desc: "Bot'un durum mesajını değiştirir.",
  usage: ".durumyaz [mesaj]",
  use: "ayarlar",
}, async (message, match) => {
  const text = (match[1] || "").trim();
  if (!text) return await message.sendReply("_Durum mesajı girin:_ `.durumyaz Aktif!`");

  try {
    await message.client.updateProfileStatus(text);
    await message.sendReply(`_Durum güncellendi:_ *${text}*`);
  } catch (e) {
    await message.sendReply(`_Durum güncellenemedi:_ ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════
// Okundu/Okunmadı İşareti
// ══════════════════════════════════════════════════════
Module({
  pattern: "okundu ?(.*)",
  fromMe: true,
  desc: "Otomatik okundu işaretini aç/kapat.",
  usage: ".okundu ac | .okundu kapat",
  use: "ayarlar",
}, async (message, match) => {
  const arg = (match[1] || "").trim().toLowerCase();
  if (arg === "ac" || arg === "aç") {
    global._autoRead = true;
    await message.sendReply("_Otomatik okundu işareti açıldı._");
  } else if (arg === "kapat") {
    global._autoRead = false;
    await message.sendReply("_Otomatik okundu işareti kapatıldı._");
  } else {
    const status = global._autoRead ? "Açık" : "Kapalı";
    await message.sendReply(`*Otomatik Okundu:* ${status}\n\n_.okundu ac_ - Açmak için\n_.okundu kapat_ - Kapatmak için`);
  }
});
