const fs = require('fs');

const fancy = fs.readFileSync('plugins/utils/fancy.js', 'utf-8');
const censor = fs.readFileSync('plugins/utils/censor.js', 'utf-8');
const manglish = fs.readFileSync('plugins/utils/manglish.js', 'utf-8');
const lang = fs.readFileSync('plugins/utils/lang.js', 'utf-8');

let combined = "const axios = require('axios');\n" +
  "const translate = require('@vitalets/google-translate-api');\n" +
  "const { LANGUAGE } = require('../../config');\n" +
  "const { existsSync, readFileSync } = require('fs');\n";

const stripRequiresAndExports = (content) => {
  return content
    .replace(/const [a-zA-Z0-9_{}\s,]+ = require\(['"][a-zA-Z0-9_\-\.\/]+['"]\);/g, '')
    .replace(/module\.exports\s*=\s*\{[\s\S]*?\};/g, '');
};

combined += stripRequiresAndExports(censor) + "\n";
combined += stripRequiresAndExports(manglish) + "\n";
combined += stripRequiresAndExports(lang) + "\n";
combined += stripRequiresAndExports(fancy) + "\n";

combined += `module.exports = {
  censorBadWords, badWords, BAD_WORD_REGEX,
  malayalamToManglish, manglishToMalayalam,
  language: json, getString,
  fancy10, fancy11, fancy12, fancy13, fancy14, fancy15, fancy16, fancy17, fancy18, fancy19, fancy1, fancy20, fancy21, fancy22, fancy23, fancy24, fancy25, fancy26, fancy27, fancy28, fancy29, fancy2, fancy30, fancy31, fancy32, fancy33, fancy3, fancy4, fancy5, fancy6, fancy7, fancy8, fancy9, randomfancy, textToStylist
};`;

fs.writeFileSync('plugins/utils/metin_araclari.js', combined, 'utf-8');
console.log('metin_araclari.js created');
