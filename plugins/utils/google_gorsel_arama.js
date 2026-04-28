/**
 * Görsel Arama Modülü
 * Google Bot tespiti nedeniyle DuckDuckGo Images API kullanır.
 * gis() ve pinterestSearch() arayüzü korundu — çağıran kod değişmedi.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Türkçe karakterleri ASCII karşılıklarına dönüştürür (API uyumu için)
 */
function trToEn(text) {
  const map = {
    ç: "c", Ç: "C",
    ğ: "g", Ğ: "G",
    ı: "i", İ: "I",
    ö: "o", Ö: "O",
    ş: "s", Ş: "S",
    ü: "u", Ü: "U",
  };
  return text.split("").map((c) => map[c] || c).join("");
}

/**
 * DuckDuckGo vqd token alır (arama oturumu için gerekli)
 */
async function getDDGToken(query) {
  const res = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=images&iax=images`,
    {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8",
      },
    }
  );
  const html = await res.text();
  const m = html.match(/vqd=['"]?([\d-]+)['"]?/) || html.match(/vqd=([\d-]+)/);
  if (!m) throw new Error("vqd token bulunamadı");
  return m[1];
}

/**
 * DuckDuckGo Images API üzerinden görsel arar
 * @param {string} searchTerm  Arama terimi (Türkçe destekli)
 * @param {number} limit       Maksimum sonuç sayısı
 * @param {object} _options    Eski uyumluluk için korundu (kullanılmıyor)
 * @returns {Promise<string[]>} Görsel URL listesi
 */
async function gis(searchTerm, limit = 5, _options = {}) {
  if (!searchTerm || typeof searchTerm !== "string") return [];

  const imgSet = new Set();

  // Önce orijinal terimi dene; sonuç yoksa ASCII versiyonunu dene
  const queries = [searchTerm];
  const enVersion = trToEn(searchTerm);
  if (enVersion !== searchTerm) queries.push(enVersion);

  for (const term of queries) {
    if (imgSet.size >= limit) break;
    try {
      const vqd = await getDDGToken(term);
      const searchUrl =
        `https://duckduckgo.com/i.js?` +
        new URLSearchParams({
          q: term,
          vqd,
          o: "json",
          p: "1",
          l: "tr-tr",
          f: ",,,,,",
        });

      const res = await fetch(searchUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: "https://duckduckgo.com/",
          "Accept-Language": "tr-TR,tr;q=0.9",
        },
      });
      const data = await res.json();
      const results = data.results || [];

      for (const item of results) {
        const url = item.image || item.url;
        if (
          url &&
          url.startsWith("http") &&
          !url.includes("duckduckgo.com") &&
          url.length > 20
        ) {
          imgSet.add(url);
        }
        if (imgSet.size >= limit * 3) break;
      }
    } catch (_) {
      // Bu sorgu başarısız — sonrakini dene
    }
  }

  return [...imgSet].slice(0, limit * 3);
}

/**
 * Pinterest görsel araması (DuckDuckGo'da "pinterest <sorgu>" ile)
 */
async function pinterestSearch(searchTerm, limit = 5, _options = {}) {
  const query = "pinterest " + searchTerm;
  const results = await gis(query, limit * 2);
  return results
    .filter((url) => url.includes("pinimg.com") || url.includes("pinterest"))
    .slice(0, limit);
}

module.exports = { gis, pinterestSearch, trToEn };
