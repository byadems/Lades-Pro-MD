/**
 * Küfür sansürü - Tüm pluginlerden erişilebilir.
 * censorBadWords(text): Metindeki yasaklı kelimeleri yıldızla maskeleler.
 */

const badWords = [
  // Ağır Küfürler & Cinsellik
  "orospu", "amcı", "amına", "amını", "amın", "sik", "göt",
  "yarra", "yarak", "taşak", "daşşak", "piç", "pezevenk", "kahpe",
  "kaltak", "kaşar", "puşt", "ibne", "ibine", "gavat", "döl",

  // Hakaretler
  "şerefsiz", "yavşak", "mal", "gerizekalı", "aptal", "salak", "dalyarak", "bok",

  // İngilizce Temel Küfürler
  "fuck", "pussy", "bitch", "asshole"
];

// Kelime listesini temizle, unique yap ve UZUNLUKLARINA GÖRE SIRALA
const uniqueBadWords = [...new Set(badWords.map(w => w.toLowerCase().trim()))]
  .sort((a, b) => b.length - a.length);

const escapedWords = uniqueBadWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

// Sınır belirleyiciler: 
// boundaryStart: Kelimenin başında harf olmamasını sağlar (Örn: 'basik' içindeki 'sik' yakalanmaz).
// boundaryEnd: Kök mantığı için kaldırıldı (Örn: 'siktim' yakalanır).
const boundaryStart = "(?<=^|[^a-zA-ZçğıöşüÇĞİÖŞÜ])";
const BAD_WORD_REGEX = new RegExp(`${boundaryStart}(${escapedWords.join("|")})`, "gi");

/**
 * Metindeki yasaklı kelimeleri yıldız (*) ile maskeleler.
 */
function censorBadWords(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(BAD_WORD_REGEX, (m) => "*".repeat(m.length));
}

/**
 * Metinde yasaklı kelime olup olmadığını kontrol eder.
 */
function containsBadWord(text) {
  if (!text || typeof text !== "string") return false;
  const regex = new RegExp(BAD_WORD_REGEX.source, "i");
  return regex.test(text);
}

module.exports = {
  censorBadWords,
  containsBadWord,
  containsDisallowedWords: containsBadWord,
  badWords: uniqueBadWords,
  BAD_WORD_REGEX
};



