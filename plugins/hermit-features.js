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
  fromMe: false,
  desc: "Gelen mesajlara otomatik emoji tepkisi verir (aç/kapat).",
  usage: ".ototepki aç | .ototepki kapat",
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
  pattern: "sistembilgi",
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
// Okundu/Okunmadı İşareti (Grup bazlı izolasyon)
// ══════════════════════════════════════════════════════
Module({
  pattern: "otogörüldü ?(.*)",
  fromMe: false,
  desc: "Otomatik okundu bilgisini sadece bu grup için açıp/kapatır.",
  usage: ".otogörüldü aç | .otogörüldü kapat",
  use: "ayarlar",
}, async (message, match) => {
  const arg = (match[1] || "").trim().toLowerCase();
  if (!global._autoReadGroups) global._autoReadGroups = new Set();

  if (arg === "ac" || arg === "aç") {
    global._autoReadGroups.add(message.jid);
    await message.sendReply("✅ _Otomatik görüldü bilgisi bu sohbet için açıldı._");
  } else if (arg === "kapat") {
    global._autoReadGroups.delete(message.jid);
    await message.sendReply("❌ _Otomatik görüldü bilgisi bu sohbet için kapatıldı._");
  } else {
    const status = global._autoReadGroups?.has(message.jid) ? "Açık" : "Kapalı";
    await message.sendReply(`👀 *Otomatik Görüldü Bilgisi:* ${status}\n\n_.otogörüldü aç_ - Açmak için\n_.otogörüldü kapat_ - Kapatmak için`);
  }
});
