const fs = require('fs');

let content = fs.readFileSync('plugins/utils/index.js', 'utf-8');

// The replacements for everything we renamed
content = content.replace(/require\("\.\/mediaProcessors"\)/g, 'require("./medya_islemcisi")');
content = content.replace(/require\("\.\/misc"\)/g, 'require("./genel_araclar")');
content = content.replace(/require\("\.\/manglish"\)/g, 'require("./manglish_ceviri")');

content = content.replace(/require\("\.\/ai-tts"\)/g, 'require("./yapay_zeka_ses")');
content = content.replace(/require\("\.\/gis"\)/g, 'require("./google_gorsel_arama")');
content = content.replace(/require\("\.\/upload"\)/g, 'require("./dosya_yukleme")');
content = content.replace(/require\("\.\/link-detector"\)/g, 'require("./baglanti_tespit")');
content = content.replace(/require\("\.\/fancy"\)/g, 'require("./metin_stilleri")');
content = content.replace(/require\("\.\/censor"\)/g, 'require("./sansur")');
content = content.replace(/require\("\.\/nexray"\)/g, 'require("./nexray_api")');

fs.writeFileSync('plugins/utils/index.js', content, 'utf-8');
console.log('Fixed index.js references');
