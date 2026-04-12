if (process.env.DISABLE_NETLER === 'true') {
  return;
}

const { Module } = require('../main');
const config = require('../config');
const path = require('path');
const fs = require('fs');
const fromMe = config.isPrivate;

const bolumlerPath = path.join(__dirname, 'data', 'bolumler.json');
const helpPath = path.join(__dirname, 'data', 'bolumler_help.txt');

let bolumler = {};
let helpText = '';
try {
  bolumler = JSON.parse(fs.readFileSync(bolumlerPath, 'utf8'));
  helpText = fs.readFileSync(helpPath, 'utf8').replace(/\\n/g, '\n');
} catch (e) {
  console.error('Netler veri dosyası yüklenemedi:', e.message);
}

// Map-based lookup for performance (O(1) instead of O(N) regex tests)
const bolumKeys = Object.keys(bolumler);
const bolumMap = new Map();
bolumKeys.forEach(k => bolumMap.set(k.toLowerCase(), bolumler[k]));

// Register a single handler for all bolum commands
Module({
    on: "text",
    fromMe,
    use: "araçlar",
  },
  async (m) => {
    const text = m.text || "";
    const firstWord = text.split(/\s+/)[0].toLowerCase();
    
    const data = bolumMap.get(firstWord);
    if (!data) return; // Not a bolum command, ignore

    // Command matched - process matching
    if (data.images.length > 1) {
      for (let i = 0; i < data.images.length - 1; i++) {
        await m.client.sendMessage(m.jid, { image: { url: data.images[i] } });
      }
      await m.client.sendMessage(m.jid, {
        image: { url: data.images[data.images.length - 1] },
        caption: data.caption.replace(/\\n/g, '\n'),
      });
    } else if (data.images.length === 1) {
      await m.client.sendMessage(m.jid, {
        image: { url: data.images[0] },
        caption: data.caption.replace(/\\n/g, '\n'),
      });
    } else {
      await m.sendReply(data.caption.replace(/\\n/g, '\n'));
    }
  }
);

// Help / index command
Module({
    pattern: 'bilgikaçnet ?(.*)',
    fromMe,
    use: "araçlar",
    desc: "Üniversite bölümleri için kaç net yapmak gerektiğini, ilgili bölümün tam olarak ne olduğunu, ne iş yaptığını ve iş olanaklarına dair detaylı bilgiler paylaşmaya yarar."
  },
  async (m) => {
  await m.sendReply(helpText);
});

