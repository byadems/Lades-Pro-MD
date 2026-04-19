const ld = require('./plugins/utils/link-detector');
const links = ld.detectLinks('join my group https://chat.whatsapp.com/ABcDeFgHiJkLmNoPqRsTuV');
console.log('links:', links);
for(const link of links) {
  console.log('match origin:', (link || '').match(/^(https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]{22})(\?.*)?$/i));
  console.log('match any length:', (link || '').match(/^(https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)(\?.*)?$/i));
}
