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

// Register dynamic commands for each bolum
for (const [key, data] of Object.entries(bolumler)) {
  Module({ pattern: key + ' ?(.*)', fromMe, dontAddCommandList: true }, async (m) => {
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
  });
}

// Help / index command
Module({ pattern: 'bilgikaçnet ?(.*)', fromMe, desc: "Üniversite bölümleri için kaç net yapmak gerektiğini, ilgili bölümün tam olarak ne olduğunu, ne iş yaptığını ve iş olanaklarına dair detaylı bilgiler paylaşmaya yarar." }, async (m) => {
  await m.sendReply(helpText);
});
