const path = require("path");
const fs = require("fs");
const { makeWASocket, useMultiFileAuthState, Browsers } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");

const sessionDir = path.join(__dirname, "../sessions/pair-temp");
const artifactsDir = 'C:\\Users\\Windows\\.gemini\\antigravity\\brain\\37f18c2e-6588-403b-b949-78916bacf4e2\\artifacts';

if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
  const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));
  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    browser: Browsers.ubuntu("Chrome"),
    syncFullHistory: false,
    logger: require("pino")({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) {
      const qrPath = path.join(artifactsDir, "qr.png");
      qrcode.toFile(qrPath, qr, {
        color: { dark: '#000000', light: '#FFFFFF' } // QR options
      }, (err) => {
        if (err) console.error(err);
        else console.log("QR_READY " + qrPath);
      });
    }

    if (connection === "open") {
      console.log("CONNECTED");
      const sessionData = JSON.stringify({ creds: state.creds, keys: state.keys });
      const sessionB64 = Buffer.from(sessionData).toString("base64");
      fs.writeFileSync(path.join(__dirname, "../sessions/session.txt"), sessionB64, "utf8");

      // Update config.env
      const envPath = path.join(__dirname, "../config.env");
      if (fs.existsSync(envPath)) {
        let envVal = fs.readFileSync(envPath, 'utf8');
        envVal = envVal.replace(/^SESSION=.*$/m, `SESSION=${sessionB64}`);
        fs.writeFileSync(envPath, envVal);
      }

      console.log("SESSION_SAVED");
      process.exit(0);
    }

    if (connection === "close") {
      console.log("CLOSED", lastDisconnect?.error);
      process.exit(1);
    }
  });
}

start();
