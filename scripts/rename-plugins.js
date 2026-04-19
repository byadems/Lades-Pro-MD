const fs = require('fs');
const path = require('path');

const pluginNames = {
  'afk.js': 'afk_modu.js',
  'ai.js': 'yapay_zeka.js',
  'bagla.js': 'baglanti.js',
  'converters.js': 'donusturuculer.js',
  'download.js': 'indiriciler.js',
  'earthquake.js': 'deprem.js',
  'ezan.js': 'namaz_vakitleri.js',
  'games.js': 'oyunlar.js',
  'group_manager.js': 'grup_yonetimi.js',
  'manage.js': 'yonetim_araclari.js',
  'media.js': 'medya.js',
  'netler.js': 'ag_araclari.js',
  'nexray-komutlar.js': 'nexray_komutlari.js',
  'stalker.js': 'analiz.js',
  'system.js': 'sistem.js',
  'tools.js': 'araclar.js',
  'warn.js': 'uyari_sistemi.js'
};

const pluginsDir = path.join(__dirname, '..', 'plugins');

for (const [oldName, newName] of Object.entries(pluginNames)) {
  const oldPath = path.join(pluginsDir, oldName);
  const newPath = path.join(pluginsDir, newName);
  
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
    console.log(`Renamed: ${oldName} -> ${newName}`);
  }
}
