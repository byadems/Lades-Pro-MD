const fs = require('fs');
const files = [
  'plugins/indiriciler.js',
  'plugins/nexray_komutlari.js',
  'plugins/grup_yonetimi.js',
  'plugins/donusturuculer.js',
  'core/handler.js'
];
files.forEach(f => {
  try {
    let c = fs.readFileSync(f, 'utf8');
    c = c.replace(/"audio\/mp4"/g, '"audio/mpeg"');
    fs.writeFileSync(f, c, 'utf8');
    console.log(f + ' updated.');
  } catch (e) {
    console.error(e.message);
  }
});
