// Birden fazla regex pattern ile görsel URL'lerini yakala
const REGEX_PATTERNS = [
  /\["(\bhttps?:\/\/(?:(?!gstatic|google|googleapis)[^"]+\.(?:jpg|jpeg|png|webp|gif))[^"]*)"/gi,
  /\["(\bhttps?:\/\/[^"]+)",(\d+),(\d+)\],null/g,
  /"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/gi,
];

/**
 * Türkçe karakterleri ASCII karşılıklarına dönüştürür (API uyumu için)
 */
function trToEn(text) {
  const map = {
    'ç': 'c', 'Ç': 'C',
    'ğ': 'g', 'Ğ': 'G',
    'ı': 'i', 'İ': 'I',
    'ö': 'o', 'Ö': 'O',
    'ş': 's', 'Ş': 'S',
    'ü': 'u', 'Ü': 'U',
  };
  return text.split('').map(c => map[c] || c).join('');
}

/**
 * Google'dan görsel arar - birden fazla yöntemle
 * @param {string} searchTerm Arama terimi (Türkçe destekli)
 * @param {number} limit Maksimum sonuç sayısı
 * @param {object} options Ek seçenekler
 * @returns {Promise<string[]>} Görsel URL listesi
 */
async function gis(searchTerm, limit = 5, options = {}) {
  if (!searchTerm || typeof searchTerm !== "string") return [];
  if (typeof options !== "object") return [];

  const { query = {} } = options;

  // Hem Türkçe hem İngilizce versiyonu dene
  const queries = [searchTerm];
  const enVersion = trToEn(searchTerm);
  if (enVersion !== searchTerm) queries.push(enVersion);

  const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  ];

  const imgSet = new Set();

  for (const term of queries) {
    if (imgSet.size >= limit) break;

    for (const userAgent of USER_AGENTS) {
      if (imgSet.size >= limit * 2) break;
      try {
        const url = `https://www.google.com/search?${new URLSearchParams({
          ...query,
          udm: "2",
          tbm: "isch",
          q: term,
          hl: "tr",
          gl: "TR",
        })}`;

        const res = await fetch(url, {
          headers: {
            "User-Agent": userAgent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
          },
        });
        const body = await res.text();

        // Tüm regex pattern'leri dene
        for (const pattern of REGEX_PATTERNS) {
          pattern.lastIndex = 0; // regex state sıfırla
          let match;
          while ((match = pattern.exec(body)) !== null) {
            const imgUrl = match[1];
            if (
              imgUrl &&
              imgUrl.startsWith('http') &&
              !imgUrl.includes('google.com') &&
              !imgUrl.includes('gstatic.com') &&
              !imgUrl.includes('googleapis.com') &&
              !imgUrl.includes('data:') &&
              imgUrl.length > 20
            ) {
              imgSet.add(imgUrl);
            }
            if (imgSet.size >= limit * 3) break;
          }
        }

        if (imgSet.size > 0) break; // Bu UA ile sonuç bulunduysa diğer UA'yı deneme
      } catch (e) {
        // Bu UA başarısız, diğerini dene
      }
    }
  }

  return [...imgSet].slice(0, limit * 3); // buffer için fazla döndür
}

/**
 * Pinterest görseli araması
 */
async function pinterestSearch(searchTerm, limit, options = {}) {
  searchTerm = "pinterest " + searchTerm;
  if (!searchTerm || typeof searchTerm !== "string") return [];
  if (typeof options !== "object") return [];

  const {
    query = {},
    userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  } = options;

  try {
    const body = await fetch(
      `http://www.google.com/search?${new URLSearchParams({
        ...query,
        udm: "2",
        tbm: "isch",
        q: searchTerm,
      })}`,
      { headers: { "User-Agent": userAgent } }
    ).then((res) => res.text());

    const content = body.slice(
      body.lastIndexOf("ds:1"),
      body.lastIndexOf("sideChannel")
    );

    const re = /\["(\bhttps?:\/\/[^"]+)",(\d+),(\d+)\],null/g;
    let result;
    let urls = [];
    let i = 0;
    while ((result = re.exec(content))) {
      if (result[1].includes("pinimg.com")) {
        if (i == limit) break;
        urls.push(result[1]);
        i++;
      }
    }
    return urls;
  } catch (e) {
    return [];
  }
}

module.exports = { gis, pinterestSearch, trToEn };
