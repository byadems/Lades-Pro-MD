const fs = require('fs');
const path = require('path');

const pluginNames = {
  'ai-tts.js': 'yapay_zeka_ses.js',
  'alive-parser.js': 'sistem_durum_ayristirici.js',
  'gis.js': 'google_gorsel_arama.js',
  'link-detector.js': 'baglanti_tespit.js',
  'mediaProcessors.js': 'medya_islemcisi.js',
  'misc.js': 'genel_araclar.js',
  'nexray.js': 'nexray_api.js',
  'render-api.js': 'render_api_baglantisi.js',
  'resilience.js': 'hata_yonetimi.js',
  'upload.js': 'dosya_yukleme.js',
  'welcome-parser.js': 'karsilama_ayristirici.js',
  'yt.js': 'youtube_araclari.js'
};

const pluginsDir = path.join(__dirname, '..', 'plugins', 'utils');

for (const [oldName, newName] of Object.entries(pluginNames)) {
  const oldPath = path.join(pluginsDir, oldName);
  const newPath = path.join(pluginsDir, newName);
  
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
    console.log(`Renamed utils: ${oldName} -> ${newName}`);
  }
}
