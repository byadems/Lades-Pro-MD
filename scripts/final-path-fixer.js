const fs = require('fs');
const path = require('path');

const renames = {
  'lid-helper': 'lid_yardimcisi',
  'db/models': 'db/modeller',
  'db/functions': 'db/fonksiyonlar',
  'db/schedulers': 'db/zamanlayicilar',
  'helpers': 'yardimcilar',
  'scheduler': 'zamanlayici',
  'schedulers': 'zamanlayici'
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

  for (const [oldName, newName] of Object.entries(renames)) {
    // Escape for regex
    const escapedOld = oldName.replace(/\//g, '\\/');
    
    const regexes = [
      new RegExp(`require\\(["']([^"']*)${escapedOld}["']\\)`, 'g')
    ];

    regexes.forEach(reg => {
      content = content.replace(reg, (match, prefix) => {
        // Only replace if it's a relative path in a require
        if (prefix.startsWith('.') || prefix === '') {
           // If we are in core and referencing something that was renamed to zamanlayici in core
           if (oldName === 'scheduler' || oldName === 'schedulers') {
              if (f.includes('index.js')) {
                 return `require("./core/zamanlayici")`; // Special case handled manually but for safety
              }
           }
           return `require("${prefix}${newName}")`;
        }
        return match;
      });
    });
  }

  if (content !== originalContent) {
    console.log(`Updated: ${f}`);
    fs.writeFileSync(f, content);
  }
});
