const fs = require('fs');
const path = require('path');

const pluginDir = 'c:/Users/Windows/Documents/Visual Studio Code/Yeni/Lades-Pro-MD/plugins';

const groups = {
  'ai.js': ['chatbot.js', 'siputzx-ai.js', 'yapayzeka.js'],
  'media.js': ['media.js', 'editor.js', 'pdf.js', 'removebg.js', 'fancy.js', 'take.js'],
  'download.js': ['autodl.js', 'social.js', 'youtube.js', 'siputzx-dl.js'],
  'tools.js': ['commands.js', 'komutlar.js', 'dc.js', 'utility.js'],
  'group_manager.js': ['group.js', 'welcome.js', 'filter.js', 'sayac.js', 'group-updates.js', 'mention.js', 'message-stats.js'],
  'games.js': ['siputzx-games.js', 'fun-tests.js'],
  'system.js': ['restart.js', 'updater.js', 'schedule.js', 'external-plugin.js', 'wamsg.js', 'hermit-features.js', 'siputzx.js']
};

for (const [targetName, files] of Object.entries(groups)) {
  let combinedContent = `/**\n * Merged Module: ${targetName}\n * Components: ${files.join(', ')}\n */\n\n`;
  let filesToDelete = [];
  
  for (const file of files) {
    const filePath = path.join(pluginDir, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      combinedContent += `// ==========================================\n`;
      combinedContent += `// FILE: ${file}\n`;
      combinedContent += `// ==========================================\n`;
      let cleanContent = content.replace(/^"use strict";\n?/gm, '').trim();
      combinedContent += `(function() {\n${cleanContent}\n})();\n\n`;
      if (file !== targetName) {
         filesToDelete.push(filePath);
      }
    } else {
      console.log(`Warning: File to merge not found: ${file}`);
    }
  }
  
  fs.writeFileSync(path.join(pluginDir, targetName), '"use strict";\n\n' + combinedContent, 'utf8');
  
  for (const filePath of filesToDelete) {
     if (fs.existsSync(filePath)) {
       fs.unlinkSync(filePath);
       console.log(`Deleted original file: ${path.basename(filePath)}`);
     }
  }
  console.log(`Created merged file: ${targetName}`);
}
