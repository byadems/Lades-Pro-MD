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

// Pre-compile into a single optimized regex for performance
const escapedWords = badWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const BAD_WORD_REGEX = new RegExp(`\\b(${escapedWords.join("|")})\\b`, "gi");

/**
 * Metindeki yasaklı kelimeleri yıldız (*) ile maskeleler.
 * @param {string} text - Sansürlenecek metin
 * @returns {string} Sansürlenmiş metin
 */
function censorBadWords(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(BAD_WORD_REGEX, (m) => "*".repeat(m.length));
}

module.exports = { censorBadWords, badWords, BAD_WORD_REGEX };
