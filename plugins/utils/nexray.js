/**
 * Nexray API (api.nexray.web.id) yardımcı modülü
 * Yedek indirme, colorize ve AI görsel işleme için kullanılır.
 */
const axios = require("axios");
const FormData = require("form-data");
const { withRetry, CircuitBreaker } = require("./resilience");

const BASE = "https://api.nexray.web.id";
const TIMEOUT = 60000;

function withSignal(options = {}, signal) {
  if (!signal) return options;
  return { ...options, signal };
}

// Circuit breaker for Nexray API calls to prevent hanging if the API goes down
const nxCircuitBreaker = new CircuitBreaker(async (url, config) => {
  return await axios.get(url, config);
}, {
  failureThreshold: 5,
  successThreshold: 2,
  openTimeout: 30000 // 30s open state before retry
});

async function nx(path, opts = {}) {
  if (process.env.IS_SELF_TEST === 'true') {
    // Return dummy buffer or generic successful response to avoid actual API spam
    if (opts.buffer) return Buffer.from("dummy-data");
    return { url: "https://example.com/dummy.mp4", title: "Test Title", data: [] };
  }

  const fetchAction = async () => {
    const res = await nxCircuitBreaker.fire(`${BASE}${path}`, withSignal({
      timeout: opts.timeout || TIMEOUT,
      validateStatus: () => true,
      responseType: opts.buffer ? "arraybuffer" : "json",
    }, opts.signal));

    if (opts.buffer) {
      // If we requested a buffer but got JSON (happens on some errors or redirected tools like ssweb)
      const contentType = res.headers["content-type"] || "";
      if (res.status === 200 && contentType.includes("application/json")) {
        const jsonStr = Buffer.from(res.data).toString();
        try {
          const d = JSON.parse(jsonStr);
          if (d.result?.file_url) return { url: d.result.file_url };
          if (d.status === false) throw new Error(d.error || d.message || "API Hatası");
        } catch (e) {
          // Not JSON after all or no file_url, continue to size check
        }
      }

      if (res.status === 200 && res.data?.byteLength > 100) {
        return Buffer.from(res.data);
      }

      // Attempt to extract error from buffer if it's small (likely JSON error)
      if (res.data?.byteLength < 500) {
        try {
          const errJson = JSON.parse(Buffer.from(res.data).toString());
          throw new Error(errJson.error || errJson.message || `HTTP ${res.status}`);
        } catch (e) { }
      }
      throw new Error(`API hatası: HTTP ${res.status}`);
    }

    const d = res.data;
    if (d?.status === true && d?.result !== undefined) return d.result;
    if (d?.status && d?.data !== undefined) return d.data;
    if (d?.result !== undefined) return d.result;
    if (d?.data !== undefined) return d.data;
    if (res.status === 200 && d && typeof d === "object") return d;
    throw new Error(d?.message || d?.error || `API hatası: HTTP ${res.status}`);
  };

  // Use exponential backoff for resilience
  return await withRetry(fetchAction, {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 5000
  });
}

async function nxTry(paths, opts = {}) {
  const errors = [];
  for (const path of paths) {
    try {
      return await nx(path, opts);
    } catch (e) {
      errors.push(`${path} → ${e.message}`);
    }
  }
  throw new Error(errors.length ? errors.join(" | ") : "API isteği başarısız");
}

function fmtCount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : "-";
}

function trToEn(text) {
  const tr = {
    'ç': 'c', 'Ç': 'C',
    'ğ': 'g', 'Ğ': 'G',
    'ı': 'i', 'İ': 'I',
    'ö': 'o', 'Ö': 'O',
    'ş': 's', 'Ş': 'S',
    'ü': 'u', 'Ü': 'U'
  };
  return text.split('').map(c => tr[c] || c).join('');
}

/**
 * Siyah-beyaz fotoğrafı renklendirir.
 * @param {string} imageUrl - Görsel URL'si
 * @returns {Promise<Buffer|null>} Renklendirilmiş görsel buffer veya null
 */
async function colorize(imageUrl, options = {}) {
  try {
    const res = await axios.get(`${BASE}/tools/colorize`, withSignal({
      params: { url: imageUrl },
      responseType: "arraybuffer",
      timeout: TIMEOUT,
    }, options.signal));
    if (res.status === 200 && res.data?.length) {
      return Buffer.from(res.data);
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray colorize]", e?.message);
  }
  return null;
}

/**
 * GPT Vision ile görseli metin promptuna göre düzenler.
 * @param {Buffer} imageBuffer - Düzenlenecek görsel
 * @param {string} prompt - Düzenleme talimatı (örn: "Change skin color to black")
 * @param {string} [mimetype] - Görsel MIME tipi (varsayılan: image/jpeg)
 * @returns {Promise<Buffer|null>} Düzenlenmiş görsel buffer veya null
 */
async function gptImage(imageBuffer, prompt, mimetype = "image/jpeg", options = {}) {
  try {
    const ext = mimetype.split("/")[1] || "jpg";
    const form = new FormData();
    form.append("image", imageBuffer, { filename: `image.${ext}`, contentType: mimetype });
    form.append("param", String(prompt).trim());

    const res = await axios.post(`${BASE}/ai/gptimage`, form, withSignal({
      headers: form.getHeaders(),
      responseType: "arraybuffer",
      timeout: 90000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }, options.signal));
    if (res.status === 200 && res.data?.length) {
      return Buffer.from(res.data);
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray gptImage]", e?.message);
  }
  return null;
}

/**
 * AI ile metinden görsel oluşturur (DeepImg).
 * @param {string} prompt - Görsel açıklaması
 * @returns {Promise<Buffer|null>} Oluşturulan görsel buffer veya null
 */
async function deepImg(prompt, options = {}) {
  try {
    const res = await axios.get(`${BASE}/ai/deepimg`, withSignal({
      params: { prompt: String(prompt).trim() },
      responseType: "arraybuffer",
      timeout: 90000,
    }, options.signal));
    if (res.status === 200 && res.data?.length) {
      return Buffer.from(res.data);
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray deepImg]", e?.message);
  }
  return null;
}

/**
 * Instagram indirme
 * @param {string} url - Instagram URL
 * @returns {Promise<string[]|null>} Medya URL listesi veya null
 */
async function downloadInstagram(url, options = {}) {
  if (process.env.IS_SELF_TEST === 'true') return ["https://example.com/dummy.mp4"];
  // v1 endpoint
  try {
    const cleanUrl = url.split("?")[0].replace(/\/$/, "");
    const res = await axios.get(`${BASE}/downloader/instagram`, withSignal({
      params: { url: cleanUrl },
      timeout: TIMEOUT,
    }, options.signal));
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      if (Array.isArray(r)) {
        const urls = r.map(item => (typeof item === 'object' ? (item?.url || item?.video_url || item?.thumbnail) : item)).filter(Boolean);
        if (urls.length) return urls;
      }
      if (r.url) return [r.url];
      if (r.video_url) return [r.video_url];
      if (r.video_urls) return r.video_urls.filter(Boolean);
    }
  } catch (e) {
    if (process.env.DEBUG || true) console.error("[Nexray instagram v1 Error]", url, e?.response?.status, e?.message);
  }

  // v2 endpoint (daha zengin veri, yedek)
  try {
    const cleanUrl = url.split("?")[0].replace(/\/$/, "");
    const res = await axios.get(`${BASE}/downloader/v2/instagram`, withSignal({
      params: { url: cleanUrl },
      timeout: TIMEOUT,
    }, options.signal));
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      if (r.media && Array.isArray(r.media)) {
        const urls = r.media.map(m => (typeof m === 'object' ? (m?.url || m?.video_url || m?.thumbnail) : m)).filter(Boolean);
        if (urls.length) return urls;
      }
      if (r.url) return [r.url];
      if (r.video_url) return [r.video_url];
      if (r.thumbnail) return [r.thumbnail];
    }
  } catch (e) {
    if (process.env.DEBUG || true) console.error("[Nexray instagram v2 Error]", url, e?.response?.status, e?.message);
  }

  // 3. Bağımsız Fallback (Siputzx API)
  try {
    const res = await axios.get(`https://api.siputzx.my.id/api/d/igdl`, { params: { url } });
    if (res.data?.status && res.data?.data) {
      const data = res.data.data;
      if (Array.isArray(data)) {
        const urls = data.map(i => i.url || i).filter(Boolean);
        if (urls.length) return urls;
      }
      if (data.url) return [data.url];
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Fallback Siputzx Error]", e?.message);
  }

  return null;
}

/**
 * TikTok indirme - TikWM API (birincil) + Nexray (yedek)
 * @param {string} url - TikTok URL
 * @returns {Promise<{url?: string, video?: string}|null>} Video URL veya null
 */
async function downloadTiktok(url, options = {}) {
  if (process.env.IS_SELF_TEST === 'true') return { url: "https://example.com/dummy.mp4", title: "Test TikTok" };

  // 1. Siputzx TikTok V2 API (POST) - En yeni ve HD destekli
  try {
    const res = await axios.post("https://api.siputzx.my.id/api/d/tiktok/v2", { url }, withSignal({
      timeout: TIMEOUT,
    }, options.signal));

    if (res.data?.status && res.data?.data) {
      const d = res.data.data;
      // HD linki varsa onu kullan, yoksa normal no watermark linki
      const videoUrl = d.no_watermark_link_hd || d.no_watermark_link;
      if (videoUrl) {
        return {
          url: videoUrl,
          title: d.text || d.itemID || "TikTok Video",
          thumbnail: d.cover_link,
          author: d.author_nickname || d.author_unique_id,
          music: d.music_link
        };
      }
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Siputzx V2 Error]", e?.message);
  }

  // 2. TikWM API (ikincil güvenilir kaynak)
  try {
    const res = await axios.post("https://www.tikwm.com/api/",
      `url=${encodeURIComponent(url)}&count=12&cursor=0&web=1&hd=1`,
      withSignal({
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: TIMEOUT,
      }, options.signal)
    );
    const data = res.data?.data;
    if (data) {
      const videoUrl = data.hdplay || data.play || data.wmplay;
      if (videoUrl) {
        return { url: videoUrl, title: data.title, thumbnail: data.cover };
      }
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[TikWM]", e?.message);
  }

  // 3. Nexray API (yedek)
  try {
    const res = await axios.get(`${BASE}/downloader/tiktok`, withSignal({
      params: { url },
      timeout: TIMEOUT,
    }, options.signal));
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      const videoUrl = r.data || r.url || r.video || r.play?.url || r.download_url;
      if (videoUrl) {
        return { url: videoUrl, title: r.title || r.desc };
      }
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray tiktok]", e?.message);
  }

  // 4. Siputzx API (Tiktok v1 - Yedek)
  try {
    const res = await axios.get(`https://api.siputzx.my.id/api/d/tiktok`, { params: { url } });
    if (res.data?.status && res.data?.data) {
      const d = res.data.data;
      if (d.play) return { url: d.play, title: d.title };
    }
  } catch (e) { }

  return null;
}

/**
 * Facebook video indirme
 * @param {string} url - Facebook URL
 * @returns {Promise<{url?: string}|null>}
 */
async function downloadFacebook(url, options = {}) {
  if (process.env.IS_SELF_TEST === 'true') return { url: "https://example.com/dummy.mp4", title: "Test FB" };
  try {
    const res = await axios.get(`${BASE}/downloader/facebook`, withSignal({
      params: { url },
      timeout: TIMEOUT,
    }, options.signal));
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      const videoUrl = r.video_hd || r.video_sd || r.url || r.hd || r.sd || r.audio;
      if (videoUrl) return { url: videoUrl, title: r.title };
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray facebook]", e?.message);
  }

  // 2. Siputzx FB
  try {
    const res = await axios.get(`https://api.siputzx.my.id/api/d/facebook`, { params: { url } });
    if (res.data?.status && res.data?.data) {
      const d = res.data.data;
      if (Array.isArray(d)) {
        const hd = d.find(x => x.resolution === 'HD');
        if (hd) return { url: hd.url };
        if (d[0]?.url) return { url: d[0].url };
      }
    }
  } catch (e) { }

  return null;
}

/**
 * Pinterest indirme
 * @param {string} url - Pinterest URL
 * @returns {Promise<string|null>} Medya URL veya null
 */
async function downloadPinterest(url, options = {}) {
  try {
    const res = await axios.get(`${BASE}/downloader/pinterest`, withSignal({
      params: { url: url.trim() },
      timeout: TIMEOUT,
      validateStatus: () => true
    }, options.signal));

    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      // Akıllı Kaynak Seçimi (HD Öncelikli):
      // 1. Video (Genelde 720p HD)
      // 2. Orijinal Çözünürlükteki Resim (/originals/ dizini Full HD+)
      // 3. Standart Resim veya Thumbnail
      if (r.video) return r.video;
      if (r.thumbnail && r.thumbnail.includes('/originals/')) return r.thumbnail;
      if (r.image && r.image.includes('/originals/')) return r.image;

      return r.image || r.url || r.thumbnail || null;
    }

  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray pinterest]", e?.message);
  }
  return null;
}



/**
 * Twitter/X video indirme - TwDown scraping + Nexray yedek
 * @param {string} url - Twitter/X URL
 * @returns {Promise<{url?: string, video?: string}|null>}
 */
async function downloadTwitter(url, options = {}) {
  if (process.env.IS_SELF_TEST === 'true') return { url: "https://example.com/dummy.mp4", title: "Test X" };
  // 1. TwDown.net scraping (en güvenilir)
  try {
    const res = await axios.post("https://twdown.net/download.php",
      `URL=${encodeURIComponent(url)}`,
      withSignal({
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        timeout: TIMEOUT,
      }, options.signal)
    );
    // HTML'den video URL'lerini çıkar
    const html = res.data;
    const mp4Match = html.match(/https:\/\/[^"'\s]+\.mp4[^"'\s]*/gi);
    if (mp4Match && mp4Match.length > 0) {
      // En yüksek kaliteli olanı seç (genellikle ilk)
      return { url: mp4Match[0].replace(/&amp;/g, "&") };
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[TwDown]", e?.message);
  }

  // 2. Nexray API (yedek)
  try {
    const res = await axios.get(`${BASE}/downloader/twitter`, withSignal({
      params: { url },
      timeout: TIMEOUT,
    }, options.signal));
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      const dlArr = r.download_url;
      const bestUrl = Array.isArray(dlArr) && dlArr.length > 0
        ? dlArr[0]?.url || dlArr[0]
        : r.video_url || r.video || r.url || r.videos?.[0]?.url;
      return bestUrl ? { url: bestUrl, title: r.title, thumbnail: r.thumbnail } : null;
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray twitter]", e?.message);
  }
  return null;
}

/**
 * Spotify indirme (URL ile doğrudan ses indirir)
 * @param {string} url - Spotify track URL
 * @returns {Promise<{url?: string, title?: string, artist?: string}|null>}
 */
async function downloadSpotify(url, options = {}) {
  if (process.env.IS_SELF_TEST === 'true') return { url: "https://example.com/dummy.mp3", title: "Test Spotify", artist: "Test" };
  try {
    const res = await axios.get(`${BASE}/downloader/spotify`, withSignal({
      params: { url },
      timeout: TIMEOUT,
    }, options.signal));
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      const dl = r.url || r.download_url || r.audio_url;
      return dl ? { url: dl, title: r.title || r.name, artist: r.artist } : null;
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray spotify]", e?.message);
  }
  return null;
}

/**
 * Spotify Play (Arama terimi ile doğrudan indirir)
 * @param {string} query - Arama terimi
 * @returns {Promise<{url?: string, title?: string, artist?: string, thumbnail?: string, duration?: string, album?: string}|null>}
 */
async function spotifyPlay(query, options = {}) {
  try {
    const res = await axios.get(`${BASE}/downloader/spotifyplay`, withSignal({
      params: { q: String(query).trim() },
      timeout: TIMEOUT,
    }, options.signal));
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      const dl = r.download_url || r.url;
      return dl ? {
        url: dl,
        title: r.title,
        artist: r.artist,
        thumbnail: r.thumbnail,
        duration: r.duration,
        album: r.album
      } : null;
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray spotifyPlay]", e?.message);
  }
  return null;
}

/**
 * YouTube video indirme (MP4)
 * @param {string} url - YouTube URL
 * @returns {Promise<{url?: string, title?: string}|null>}
 */
async function downloadYtMp4(url, options = {}) {
  try {
    const res = await axios.get(`${BASE}/downloader/ytmp4`, withSignal({
      params: { url },
      timeout: 90000,
    }, options.signal));
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      return { url: r.url || r.download_url, title: r.title };
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray ytmp4]", e?.message);
  }
  return null;
}

/**
 * YouTube ses indirme (MP3)
 * @param {string} url - YouTube URL
 * @returns {Promise<{url?: string, title?: string}|null>}
 */
async function downloadYtMp3(url, options = {}) {
  try {
    const res = await axios.get(`${BASE}/downloader/ytmp3`, withSignal({
      params: { url },
      timeout: 90000,
    }, options.signal));
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      return { url: r.url || r.download_url, title: r.title };
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray ytmp3]", e?.message);
  }
  return null;
}

/**
 * YouTube Play (Arama + İndirme tek seferde) - Ses
 * @param {string} query - Arama terimi
 * @returns {Promise<{url?: string, title?: string}|null>}
 */
async function ytPlayAud(query, options = {}) {
  try {
    const res = await axios.get(`${BASE}/downloader/ytplay`, withSignal({
      params: { q: String(query).trim() },
      timeout: 90000,
    }, options.signal));
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      return { url: r.download_url || r.url, title: r.title };
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray ytPlayAud]", e?.message);
  }
  return null;
}

/**
 * YouTube Play (Arama + İndirme tek seferde) - Video
 * @param {string} query - Arama terimi
 * @returns {Promise<{url?: string, title?: string}|null>}
 */
async function ytPlayVid(query, options = {}) {
  try {
    const res = await axios.get(`${BASE}/downloader/ytplayvid`, withSignal({
      params: { q: String(query).trim() },
      timeout: 90000,
    }, options.signal));
    const data = res.data;
    if (data?.status && data?.result) {
      const r = data.result;
      return { url: r.download_url || r.url, title: r.title };
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray ytPlayVid]", e?.message);
  }
  return null;
}

/**
 * YouTube arama (Arama terimi ile sonuç listeler)
 * @param {string} query - Arama terimi
 * @returns {Promise<any[]|null>}
 */
/**
 * URL üzerinden buffer alır.
 * @param {string} url - İndirilecek görsel/dosya URL'si
 * @returns {Promise<Buffer|string>} Buffer veya hata durumunda boş string
 */
async function getBuffer(url, options = {}) {
  try {
    const res = await axios.get(
      url,
      withSignal({ responseType: "arraybuffer", timeout: TIMEOUT }, options.signal)
    );
    return Buffer.from(res.data);
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray getBuffer]", e?.message);
    return "";
  }
}

async function searchYoutube(query, options = {}) {
  try {
    const res = await axios.get(`${BASE}/search/youtube`, withSignal({
      params: { q: String(query).trim() },
      timeout: TIMEOUT,
    }, options.signal));
    const data = res.data;
    if (data?.status && Array.isArray(data?.result)) {
      return data.result;
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Nexray searchYoutube]", e?.message);
  }
  return null;
}

module.exports = {
  colorize,
  gptImage,
  deepImg,
  downloadInstagram,
  downloadTiktok,
  downloadFacebook,
  downloadPinterest,
  downloadTwitter,
  downloadSpotify,
  spotifyPlay,
  downloadYtMp4,
  downloadYtMp3,
  ytPlayAud,
  ytPlayVid,
  searchYoutube,
  getBuffer,
  nx,
  nxTry,
  fmtCount,
  trToEn,
};
