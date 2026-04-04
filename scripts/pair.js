#!/usr/bin/env node
"use strict";

/**
 * scripts/pair.js
 * Standalone pairing script for QR or Pair Code authentication.
 * Usage:
 *   node scripts/pair.js              → QR code
 *   node scripts/pair.js +905XXXXXXXX → Pair code
 */

const path = require("path");
const fs = require("fs");

if (fs.existsSync(path.join(__dirname, "../config.env"))) {
  require("dotenv").config({ path: path.join(__dirname, "../config.env") });
} else if (fs.existsSync(path.join(__dirname, "../.env"))) {
  require("dotenv").config({ path: path.join(__dirname, "../.env") });
}

const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
} = require("@whiskeysockets/baileys");
const qrcodeTerminal = require("qrcode-terminal");
const pino = require("pino");

const phoneNumber = process.argv[2] || null;
const useQR = !phoneNumber;
const sessionDir = path.join(__dirname, "../sessions/lades-session");

const logger = pino({ level: "silent" });

async function startPairing() {
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         N E X B O T - M D               ║");
  console.log("║   WhatsApp Authentication Script         ║");
  console.log("╚══════════════════════════════════════════╝\n");

  if (useQR) {
    console.log("📱 QR kod yöntemi seçildi.");
    console.log("   WhatsApp > Bağlı Cihazlar > Cihaz Bağla\n");
  } else {
    console.log(`📱 Pair Code yöntemi: ${phoneNumber}`);
    console.log("   WhatsApp > Bağlı Cihazlar > Cihaz Bağla > Telefon numarasıyla bağla\n");
  }

  let pairCodeRequested = false;

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.ubuntu("Chrome"),
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      if (useQR) {
        console.clear();
        console.log("📷 QR Kodu tarayın:\n");
        qrcodeTerminal.generate(qr, { small: true });
        console.log("\n⏳ QR kod 60 saniye geçerlidir...\n");
      } else if (!pairCodeRequested) {
        pairCodeRequested = true;
        setTimeout(async () => {
          try {
            const phone = phoneNumber.replace(/[^0-9]/g, "");
            const code = await sock.requestPairingCode(phone);
            console.log("\n╔══════════════════════════════════════════╗");
            console.log(`║  📱 PAIR CODE: ${code.padEnd(26)}║`);
            console.log("╚══════════════════════════════════════════╝\n");
            console.log("  WhatsApp'ı açın:");
            console.log("  ⚙️ Ayarlar → Bağlı Cihazlar → Cihaz Bağla");
            console.log("  📲 Telefon numarasıyla bağla → Kodu girin\n");
          } catch (err) {
            console.error("❌ Pair code alınamadı:", err.message);
          }
        }, 3000);
      }
    }

    if (connection === "open") {
      const botJid = sock.user?.id;
      console.log("✅ Başarıyla bağlandı!");
      console.log(`📱 Numara: ${botJid?.split(":")[0] || "N/A"}`);

      // Export session
      const sessionData = JSON.stringify({
        creds: state.creds,
        keys: state.keys,
      });
      const sessionB64 = Buffer.from(sessionData).toString("base64");

      console.log("\n╔══════════════════════════════════════════╗");
      console.log("║           SESSION STRING                 ║");
      console.log("╚══════════════════════════════════════════╝");
      console.log("\n" + sessionB64 + "\n");
      console.log("⚠️  Bu session string'i güvende tutun!");
      console.log("   config.env dosyasına SESSION= olarak ekleyin.\n");

      // Save to file too
      const outFile = path.join(__dirname, "../sessions/session.txt");
      fs.writeFileSync(outFile, sessionB64, "utf8");
      console.log(`📁 Kaydedildi: ${outFile}\n`);

      const autoLogout = process.env.PAIR_AUTO_LOGOUT !== "false";
      if (autoLogout) {
        console.log("⚠️  Otomatik oturum kapatma etkin. Cihaz listesinde 'Çıkış işlemi bekleniyor' durumu normaldir.");
        console.log("🔄 Eğer oturumu sürekli tutmak istiyorsanız, .env dosyanıza PAIR_AUTO_LOGOUT=false ekleyin.");
        await sock.logout().catch(() => {});
        process.exit(0);
      } else {
        console.log("✅ Oturum açık tutuluyor. Bu pencereyi kapatmadan önce config.env'e SESSION= değeri ekleyin veya index.js'i başlatın.");
        console.log("⌨️  Çıkmak için Ctrl+C tuşlayın.");
      }
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log("🔄 Yeniden deneniyor...");
        setTimeout(startPairing, 3000);
      } else {
        console.log("❌ Oturum kapatıldı.");
        process.exit(1);
      }
    }
  });
}

startPairing().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
