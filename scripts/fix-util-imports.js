const fs = require('fs');
const path = require('path');

const renamesMap = {
  'ai-tts': 'yapay_zeka_ses',
  'alive-parser': 'sistem_durum_ayristirici',
  'gis': 'google_gorsel_arama',
  'link-detector': 'baglanti_tespit',
  'mediaProcessors': 'medya_islemcisi',
  'misc': 'genel_araclar',
  'nexray': 'nexray_api',
  'render-api': 'render_api_baglantisi',
  'resilience': 'hata_yonetimi',
  'upload': 'dosya_yukleme',
  'welcome-parser': 'karsilama_ayristirici',
  'yt': 'youtube_araclari'
};

const walk = (dir, done) => {
  let results = [];
  fs.readdir(dir, (err, list) => {
    if (err) return done(err);
    let pending = list.length;
    if (!pending) return done(null, results);
    list.forEach(file => {
      file = path.resolve(dir, file);
      fs.stat(file, (err, stat) => {
        if (stat && stat.isDirectory()) {
          const base = path.basename(file);
          if (base !== 'node_modules' && base !== '.git' && !file.includes('.gemini')) {
            walk(file, (err, res) => {
              results = results.concat(res);
              if (!--pending) done(null, results);
            });
          } else {
            if (!--pending) done(null, results);
          }
        } else {
          if (file.endsWith('.js') && file !== __filename) {
             results.push(file);
          }
          if (!--pending) done(null, results);
        }
      });
    });
  });
};

walk(path.join(__dirname, '..'), (err, files) => {
  files.forEach(f => {
    let content = fs.readFileSync(f, 'utf-8');
    let modified = false;

    for (const [oldName, newName] of Object.entries(renamesMap)) {
      // replace require('./xyz') and require('../utils/xyz') properly
      const regex1 = new RegExp(`require\\(['"]\\.\\/${oldName}['"]\\)`, 'g');
      if (regex1.test(content)) {
        content = content.replace(regex1, `require('./${newName}')`);
        modified = true;
      }
      
      const regex2 = new RegExp(`require\\(['"]\\.\\/utils\\/${oldName}['"]\\)`, 'g');
      if (regex2.test(content)) {
        content = content.replace(regex2, `require('./utils/${newName}')`);
        modified = true;
      }
      
      const regex3 = new RegExp(`require\\(['"]\\.\\.\\/utils\\/${oldName}['"]\\)`, 'g');
      if (regex3.test(content)) {
        content = content.replace(regex3, `require('../utils/${newName}')`);
        modified = true;
      }
    }

    if (modified) fs.writeFileSync(f, content);
  });
  console.log('Fixed imports for renamed utils');
});
