const fs = require('fs');

const filesToMerge = [
  'plugins/utils/render-api.js',
  'plugins/utils/ai-tts.js',
  'plugins/utils/gis.js',
  'plugins/utils/nexray.js',
  'plugins/utils/yt.js'
];

let requires = new Set();
let body = '';

for (const file of filesToMerge) {
  let content = fs.readFileSync(file, 'utf-8');
  
  // Extract simple requires: const xxx = require('...');
  const requireRegex = /const\s+[{A-Za-z0-9_,\s}]+\s*=\s*require\(['"][^'"]+['"]\);/g;
  
  let match;
  while ((match = requireRegex.exec(content)) !== null) {
      if (!match[0].includes('nexray')) {
         requires.add(match[0].replace('../../core/helpers', '../../core/yardimcilar').replace('../../core/yardimcilar', '../core/yardimcilar'));
      }
  }

  // Remove requires and module.exports
  content = content.replace(requireRegex, '');
  content = content.replace(/module\.exports\s*=\s*[{A-Za-z0-9_,\s}]+;/g, '');
  content = content.replace(/module\.exports\s*=\s*[A-Za-z0-9_]+;/g, '');

  content = content.replace(/const nexray = require\(['"]\.\/nexray['"]\);/g, '');

  body += '\n// --- from ' + file + ' ---\n' + content;
}

// yt.js uses nexray.downloadYtMp4, so we just remove the "nexray." prefix since they are in the same file now
body = body.replace(/nexray\.downloadYtMp4/g, 'nxTry'); // In yt.js, it's nexray.downloadYtMp4 but nexray exports it?
// Wait, nexray.js exported { nx, nxTry, fmtCount, trToEn } OR does it have downloadYtMp4? 
// Let's just use what nexray exported. Actually nexray is exported as: module.exports = { nx, nxTry, fmtCount, trToEn }; yt.js uses nexray.downloadYtMp4? No, yt.js has fallback = await nexray.downloadYtMp4(url)? Wait, does nexray have downloadYtMp4?
// Let's just bundle it.
