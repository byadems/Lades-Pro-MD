/**
 * Küfür sansürü - Tüm pluginlerden erişilebilir.
 * censorBadWords(text): Metindeki yasaklı kelimeleri yıldızla maskeleler.
 */

const badWords = [
  "amk","aq","mk","orospu","orospu çocuğu","orospu cocugu","oç","o.ç","amcık","amına","amını","amina", 
"sik","sikerim","siktir","sikim","sikeyim","sikiyim","sikti","sikik","yarrak","yarak","yarram","yarrağım",
"piç","pezevenk","kahpe","kaltak","kaşar","puşt","ibne","ibine","ibneyim","şerefsiz","serefsiz",
"mal","salak","aptal","gerizekalı","dalyarak","dingil","yavşak","yavsak","göt","götveren","gavat",
  "döl","bok","bok gibi","amına koyayım","amına koyim","amına kodum","siktir git",
"fuck","fucking","pussy","bitch","asshole","bastard"
];

/**
 * Metindeki yasaklı kelimeleri yıldız (*) ile maskeleler.
 * @param {string} text - Sansürlenecek metin
 * @returns {string} Sansürlenmiş metin
 */
function censorBadWords(text) {
  if (!text || typeof text !== "string") return text;
  let result = text;
  for (const word of badWords) {
    if (!word || word.length < 2) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    result = result.replace(regex, (m) => "*".repeat(m.length));
  }
  return result;
}

module.exports = { censorBadWords, badWords };
