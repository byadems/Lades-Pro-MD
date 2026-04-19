const fs = require('fs');
const path = require('path');

const coreRenames = {
  'helpers': 'yardimcilar',
  'lid-helper': 'yardimcilar',
  'scheduler': 'zamanlayici',
  'schedulers': 'zamanlayici'
};

const utilRenames = {
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
  'yt': 'youtube_araclari',
  'fancy': 'metin_stilleri',
  'censor': 'sansur',
  'lang': 'dil_ayari',
  'manglish': 'manglish_ceviri'
};

const walk = (dir) => {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      const base = path.basename(file);
      if (!['node_modules', '.git', '.gemini'].includes(base)) {
        results = results.concat(walk(file));
      }
    } else if (file.endsWith('.js')) {
      results.push(file);
    }
  });
  return results;
};

const files = walk('.');

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf-8');
  let originalContent = content;

  // Fix Core Renames
  for (const [oldName, newName] of Object.entries(coreRenames)) {
    // Match require("./core/old") or require("./old") or require("../core/old")
    const regexes = [
      new RegExp(`require\\(["']\\.\\/core\\/${oldName}["']\\)`, 'g'),
      new RegExp(`require\\(["']\\.\\/\\.\\.\\/core\\/${oldName}["']\\)`, 'g'),
      new RegExp(`require\\(["']\\.\\.\\/core\\/${oldName}["']\\)`, 'g'),
      new RegExp(`require\\(["']\\.\\/${oldName}["']\\)`, 'g')
    ];

    regexes.forEach(reg => {
      if (reg.test(content)) {
        // Special case for scheduler/zamanlayici if it's assigned to a variable named scheduler
        if (oldName === 'scheduler' || oldName === 'schedulers') {
           // If it's "const scheduler = require(...)", replace with "{ scheduler } = require(...)"
           content = content.replace(new RegExp(`const\\s+scheduler\\s*=\\s*require\\((["']).*${oldName}\\1\\)`, 'g'), 
             `const { scheduler } = require("./${f.includes('core') ? '' : 'core/'}zamanlayici")`);
           
           // Generic replacement for others
           content = content.replace(reg, `require("./${f.includes('core') ? '' : 'core/'}${newName}")`);
        } else {
           content = content.replace(reg, `require("./${f.includes('core') ? '' : 'core/'}${newName}")`);
        }
      }
    });
  }

  // Fix Util Renames
  for (const [oldName, newName] of Object.entries(utilRenames)) {
    const regexes = [
      new RegExp(`require\\(["']\\.\\/utils\\/${oldName}["']\\)`, 'g'),
      new RegExp(`require\\(["']\\.\\.\\/utils\\/${oldName}["']\\)`, 'g'),
      new RegExp(`require\\(["']\\.\\/${oldName}["']\\)`, 'g')
    ];
    regexes.forEach(reg => {
      content = content.replace(reg, (match) => match.replace(oldName, newName));
    });
  }

  if (content !== originalContent) {
    console.log(`Updated: ${f}`);
    fs.writeFileSync(f, content);
  }
});

console.log('Final cleanup of redundant paths...');
// Fix cases where we might have double core/core or similar due to relative pathing bugs in simple regex
// Manual sweep for known files is safer after this.
