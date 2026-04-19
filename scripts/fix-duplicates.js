const fs = require('fs');
let code = fs.readFileSync('plugins/utils/metin_araclari.js', 'utf-8');
code = code.replace(/const translate = require\(['"]@vitalets\/google-translate-api['"]\);/g, '');
code = "const translate = require('@vitalets/google-translate-api');\n" + code;
code = code.replace(/const axios = require\(['"]axios['"]\);/g, '');
code = "const axios = require('axios');\n" + code;

fs.writeFileSync('plugins/utils/metin_araclari.js', code);
