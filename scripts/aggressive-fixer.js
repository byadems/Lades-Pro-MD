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
    // Match require("...oldName") and update to ...newName
    const escapedOld = oldName.replace(/\//g, '\\/');
    // Regex matches require("any/path/oldName") or require("./oldName")
    const regex = new RegExp(`require\\((['"])(.*?\\/)?${escapedOld}\\1\\)`, 'g');
    
    content = content.replace(regex, (match, quote, pathPart) => {
        pathPart = pathPart || "";
        // Avoid double core/core or similar if possible, but pathPart should be preserved
        return `require(${quote}${pathPart}${newName}${quote})`;
    });
  }

  if (content !== originalContent) {
    console.log(`Updated: ${f}`);
    fs.writeFileSync(f, content);
  }
});
