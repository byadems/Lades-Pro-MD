function TimeCalculator(a) {
  a = Math.abs(a);
  let b = Math.floor(a / 31536e3),
    c = Math.floor((a % 31536e3) / 2628e3),
    d = Math.floor(((a % 31536e3) % 2628e3) / 86400),
    e = Math.floor((a % 86400) / 3600),
    f = Math.floor((a % 3600) / 60),
    g = Math.floor(a % 60);

  let parts = [];
  if (b > 0) parts.push(b + " yıl");
  if (c > 0) parts.push(c + " ay");
  if (d > 0) parts.push(d + " gün");
  if (e > 0) parts.push(e + " saat");
  if (f > 0) parts.push(f + " dakika");
  if (g > 0) parts.push(g + " saniye");

  return parts.length > 0 ? parts.join(", ") : "0 saniye";
}

const { Module } = require("../main");
const config = require("../config");

const { exec } = require("child_process");
const { promisify } = require("util");
const execPromise = promisify(exec);
const fs = require("fs");
const path = require("path");
const https = require("https");
const { createWriteStream } = require("fs");
const tar = require("tar");

// ═══════════════════════════════════
// 📅 Yaş Hesaplayıcı
// ═══════════════════════════════════
Module({
  pattern: "yaşhesap ?(.*)",
  fromMe: false,
  desc: "Doğum tarihinizi girerek detaylı yaş ve zaman hesabı yapmanıza yarar.",
  usage: ".yaşhesap 10/01/2021",
  use: "tools",
},
  async (m, match) => {
    const input = match[1] ? match[1].trim() : "";
    if (!input) return await m.sendReply("_📅 Doğum tarihinizi yazın._\n_Örnek: .yaşhesap 10/01/2021_");
    if (
      !/^(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[012])[\/\-]\d{4}$/.test(input)
    )
      return await m.sendReply("_⚠️ Tarih gg/aa/yyyy formatında olmalıdır!_\n_Örnek: 15/06/1990_");

    var DOB = input;
    var parts = DOB.includes("-") ? DOB.split("-") : DOB.split("/");
    var actual = parts[1] + "/" + parts[0] + "/" + parts[2];
    var dob = new Date(actual).getTime();

    if (isNaN(dob)) return await m.sendReply("_⚠️ Geçersiz tarih!_");

    var today = new Date().getTime();

    if (dob > today) return await m.sendReply("_⚠️ Doğum tarihi gelecekte olamaz!_");

    var age = (today - dob) / 1000;
    return await m.sendReply("```🎂 Yaşınız: " + TimeCalculator(age) + "```");
  }
);

// ═══════════════════════════════════
// ⏳ Geri Sayım
// ═══════════════════════════════════
Module({
  pattern: "gerisayım ?(.*)",
  fromMe: false,
  desc: "Gelecekteki bir tarihe ne kadar süre kaldığını detaylıca hesaplar.",
  usage: ".gerisayım 10/01/2099",
  use: "tools",
},
  async (m, match) => {
    const input = match[1] ? match[1].trim() : "";
    if (!input) return await m.sendReply("_📅 Bana gelecek bir tarih verin!_\n_Örnek: .gerisayım 01/01/2099_");
    if (
      !/^(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[012])[\/\-]\d{4}$/.test(input)
    )
      return await m.sendReply("_⚠️ Tarih gg/aa/yyyy formatında olmalıdır_\n_Örnek: 01/01/2026_");

    var DOB = input;
    var parts = DOB.includes("-") ? DOB.split("-") : DOB.split("/");
    var actual = parts[1] + "/" + parts[0] + "/" + parts[2];
    var dob = new Date(actual).getTime();

    if (isNaN(dob)) return await m.sendReply("_⚠️ Geçersiz tarih!_");

    var today = new Date().getTime();

    if (dob <= today) return await m.sendReply("_⚠️ Lütfen gelecekten bir tarih yazın!_");

    var remaining = (dob - today) / 1000;
    return await m.sendReply("_⏳ " + TimeCalculator(remaining) + " kaldı_");
  }
);

// ═══════════════════════════════════
// 🏓 Ping Testi
// ═══════════════════════════════════
Module({
  pattern: "ping",
  fromMe: false,
  desc: "Botun sunucuya olan tepki hızını ve ağ gecikmesini ölçer.",
  usage: ".ping",
  use: "tools",
},
  async (message) => {
    const start = process.hrtime();
    let sent_msg = await message.sendReply("*❮ ᴘɪɴɢ ᴛᴇsᴛɪ ❯*");
    const diff = process.hrtime(start);
    const ms = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
    await message.edit(
      "*🚀 ᴛᴇᴘᴋɪ sᴜ̈ʀᴇsɪ: " + ms + " _ᴍs_*",
      message.jid,
      sent_msg.key
    );
  }
);

// Helper function: Download file
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => { });
      reject(err);
    });
  });
}

// ═══════════════════════════════════
// ⚡ Gerçek Speedtest (CLI Binary)
// ═══════════════════════════════════
Module({
  pattern: "hıztesti",
  fromMe: false,
  desc: "Botun bulunduğu sunucunun internet indirme ve yükleme hızlarını Ookla Speedtest ile ölçer.",
  usage: ".hıztesti",
  use: "tools",
},
  async (message) => {
    const loading = await message.sendReply(
      "```⚡ Hız testi başlatılıyor...\n⏳ Lütfen bekleyin (30-60 saniye)```"
    );

    try {
      const baseDir = path.join(__dirname, "..");
      const speedtestBin = path.join(baseDir, "speedtest");
      const tempTgz = path.join(baseDir, "speedtest.tgz");

      // Speedtest binary kontrolü ve kurulumu
      if (!fs.existsSync(speedtestBin)) {
        await message.edit(
          "```📦 Speedtest CLI indiriliyor...\n⏳ İlk kullanım 1-2 dakika sürebilir```",
          message.jid,
          loading.key
        );

        try {
          const platform = process.platform;
          const arch = process.arch;

          let downloadUrl;
          if (platform === "linux" && arch === "x64") {
            downloadUrl = "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-x86_64.tgz";
          } else if (platform === "linux" && arch === "arm64") {
            downloadUrl = "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-aarch64.tgz";
          } else if (platform === "darwin" && arch === "x64") {
            downloadUrl = "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-macosx-x86_64.tgz";
          } else if (platform === "darwin" && arch === "arm64") {
            downloadUrl = "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-macosx-universal.tgz";
          } else {
            throw new Error("Desteklenmeyen platform: " + platform + " " + arch);
          }

          await downloadFile(downloadUrl, tempTgz);

          await tar.extract({
            file: tempTgz,
            cwd: baseDir,
            filter: (path) => path === 'speedtest' || path === 'speedtest.exe'
          });

          fs.unlinkSync(tempTgz);

          if (platform !== "win32") {
            fs.chmodSync(speedtestBin, 0o755);
          }

          if (!fs.existsSync(speedtestBin)) {
            throw new Error("Speedtest binary çıkarılamadı");
          }

        } catch (installError) {
          console.error("Speedtest install error:", installError);
          throw new Error("Speedtest kurulumu başarısız: " + installError.message);
        }
      }

      await message.edit(
        "```⚡ Speedtest çalışıyor...\n📊 En yakın sunucu bulunuyor...```",
        message.jid,
        loading.key
      );

      const { stdout } = await execPromise(`${speedtestBin} --accept-license --accept-gdpr --format=json`, {
        timeout: 90000
      });

      const result = JSON.parse(stdout);

      // Sonuçları parse et
      const download = (result.download.bandwidth * 8 / 1000000).toFixed(2);
      const upload = (result.upload.bandwidth * 8 / 1000000).toFixed(2);
      const ping = result.ping.latency.toFixed(0);
      const jitter = result.ping.jitter.toFixed(2);
      const packetLoss = result.packetLoss ? result.packetLoss.toFixed(1) : "0";
      const resultId = result.result.id;

      // Hız kategorisi
      let speedRating = "";
      const dlSpeed = parseFloat(download);
      if (dlSpeed < 10) speedRating = "🐌 Yavaş";
      else if (dlSpeed < 50) speedRating = "🚶 Orta";
      else if (dlSpeed < 100) speedRating = "🏃 Hızlı";
      else if (dlSpeed < 500) speedRating = "🚀 Çok Hızlı";
      else speedRating = "⚡ Ultra Hızlı";

      let finalResult = `⚡ *HIZ TESTİ SONUÇLARI*\n\n`;
      finalResult += `╭─────────────────╮\n`;
      finalResult += `│ 📥 *İndirme:* ${download} Mbps\n`;
      finalResult += `│ 📤 *Yükleme:* ${upload} Mbps\n`;
      finalResult += `│ 🏓 *Ping:* ${ping} ms\n`;
      finalResult += `│ 📊 *Jitter:* ${jitter} ms\n`;
      finalResult += `│ 📦 *Paket Kaybı:* ${packetLoss}%\n`;
      finalResult += `│ ⭐ *Değerlendirme:* ${speedRating}\n`;
      finalResult += `╰─────────────────╯\n\n`;
      finalResult += `_✅ Test tamamlandı! (Ookla Speedtest)_\n`;
      finalResult += `_ℹ️ Sonuç ID: ${resultId}_`;

      await message.edit(finalResult, message.jid, loading.key);

    } catch (error) {
      console.error("Speedtest error:", error);

      let errorMsg = `❌ *Hız testi başarısız!*\n\n`;

      if (error.message.includes("Desteklenmeyen platform")) {
        errorMsg += `_Platform desteklenmiyor: ${process.platform} ${process.arch}_`;
      } else if (error.killed) {
        errorMsg += `_Zaman aşımı! Test 90 saniyede tamamlanamadı._`;
      } else if (error.message.includes("EACCES")) {
        errorMsg += `_İzin hatası! Speedtest binary çalıştırılamadı._`;
      } else if (error.message.includes("kurulumu başarısız")) {
        errorMsg += `_Speedtest indirilemedi. İnternet bağlantınızı kontrol edin._`;
      } else {
        errorMsg += `_${error.message}_`;
      }

      errorMsg += `\n\n💡 *Alternatif:* .ping komutunu deneyin`;

      await message.edit(errorMsg, message.jid, loading.key);
    }
  }
);
