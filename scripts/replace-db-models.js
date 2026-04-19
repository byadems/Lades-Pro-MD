const fs = require('fs');
const path = require('path');

const replacements = [
  { old: 'WhatsappSession', new: 'WhatsappOturum' },
  { old: 'BotConfig', new: 'BotAyar' },
  { old: 'GroupSettings', new: 'GrupAyar' },
  { old: 'UserData', new: 'KullaniciVeri' },
  { old: 'WarnLog', new: 'UyariKayit' },
  { old: 'Filter', new: 'Filtre' },
  { old: 'Schedule', new: 'Zamanlama' },
  { old: 'ExternalPlugin', new: 'HariciEklenti' },
  { old: 'AiCommand', new: 'YapayZekaKomut' },
  { old: 'MessageStats', new: 'MesajIstatistik' },
  { old: 'BotMetric', new: 'BotMetrik' },
  { old: 'CommandStat', new: 'KomutIstatistik' },
  { old: 'CommandRegistry', new: 'KomutKayit' }
];

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
  if (err) throw err;
  files.forEach(file => {
    let content = fs.readFileSync(file, 'utf-8');
    let modified = false;
    
    // We only want to replace Model names that are whole words.
    for (const r of replacements) {
      const regex = new RegExp(`\\b${r.old}\\b`, 'g');
      if (regex.test(content)) {
        content = content.replace(regex, r.new);
        modified = true;
      }
    }

    if (modified) {
       fs.writeFileSync(file, content, 'utf-8');
       console.log(`Updated models in: ${file}`);
    }
  });
});
