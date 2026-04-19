/**
 * Küfür sansürü - Tüm pluginlerden erişilebilir.
 * censorBadWords(text): Metindeki yasaklı kelimeleri yıldızla maskeleler.
 */

const badWords = [
  // Ağır Küfürler & Cinsellik
  "amk", "orospu", "amcık", "amına", "amını", "amina", "amın",
  "sik", "sikerim", "siktir", "sikim", "sikeyim", "sikiyim", "sikti", "sikik", "sikiş", "sikis",
  "yarrak", "yarak", "yarram", "yarrağım", "taşak", "tasak", "daşşak",
  "piç", "pezevenk", "kahpe", "kaltak", "kaşar", "kasar", "puşt", "ibne", "ibine",
  "göt", "götveren", "gavat", "kavat", "döl",
  "amına koyayım", "amına koyim", "amına kodum", "amına koyarim", "amina koyayim",
  "siktir git", "taşşak", "daşşak",

  // Hakaretler
  "şerefsiz", "yavşak", "it",
  "geri zekalı", "gerizekalı", "gerizekali", "aptal", "salak",
  "dalyarak", "dingil", "it soyu",

  // İngilizce Temel Küfürler
  "fuck", "fucking", "pussy", "bitch", "asshole", "bastard", "dick", "shit",

  // Diğer & Argolar
  "bok"
];

// Kelime listesini temizle ve unique yap
const uniqueBadWords = [...new Set(badWords.map(w => w.toLowerCase().trim()))];

// Regex oluşturken Türkçe karakterlerin (ç, ı, g, ö, s, ü) kelime sınırı (\b) ile düzgün çalışmamasını 
// engellemek için özel bir sınır yapısı kullanıyoruz.
const escapedWords = uniqueBadWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const boundaryStart = "(?<=^|[^a-zA-ZçğıöşüÇĞİÖŞÜ])";
const boundaryEnd = "(?=[^a-zA-ZçğıöşüÇĞİÖŞÜ]|$)";
const BAD_WORD_REGEX = new RegExp(`${boundaryStart}(${escapedWords.join("|")})${boundaryEnd}`, "gi");

/**
 * Metindeki yasaklı kelimeleri yıldız (*) ile maskeleler.
 * @param {string} text - Sansürlenecek metin
 * @returns {string} Sansürlenmiş metin
 */
function censorBadWords(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(BAD_WORD_REGEX, (m) => "*".repeat(m.length));
}

/**
 * Metinde yasaklı kelime olup olmadığını kontrol eder.
 * @param {string} text - Kontrol edilecek metin
 * @returns {boolean} Küfür içeriyorsa true
 */
function containsBadWord(text) {
  if (!text || typeof text !== "string") return false;
  return BAD_WORD_REGEX.test(text);
}

module.exports = { censorBadWords, containsBadWord, badWords: uniqueBadWords, BAD_WORD_REGEX };
