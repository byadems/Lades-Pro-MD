const fs = require('fs');
const files = ['plugins/afk_modu.js','plugins/araclar.js','plugins/grup_yonetimi.js','plugins/indiriciler.js'];
files.forEach(f => {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, 'utf8');
    content = content.replace(/require\(['"]\.\/manage['"]\)/g, "require('./yonetim_araclari')");
    content = content.replace(/require\(['"]\.\.\/manage['"]\)/g, "require('../yonetim_araclari')");
    fs.writeFileSync(f, content);
  }
});

// Also fix sistem.js
let s_cnt = fs.readFileSync('plugins/sistem.js', 'utf8');
s_cnt = s_cnt.replace(/const { PluginDB, installPlugin } = require\(['"]\.\/sql\/plugin['"]\);/g, "const { PluginDB } = require('./utils/db/modeller');\nconst installPlugin = async () => {}; // Stub for removed installer");
fs.writeFileSync('plugins/sistem.js', s_cnt);
console.log('Done replacement');
