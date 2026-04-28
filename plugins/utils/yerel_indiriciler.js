"use strict";

/**
 * Yerel İndiriciler (Local Downloaders)
 *
 * Üçüncü-taraf API'lere bağlı kalmadan, Instagram / Facebook / YouTube
 * içeriklerini doğrudan kazıyıcı (scraper) kütüphaneleri ile indirir.
 *
 * Sıra:
 *   - Instagram & Story → ruhend-scraper.igdl
 *   - Facebook         → @bochilteam/scraper-facebook + ruhend-scraper.fbdl
 *   - YouTube ses      → @distube/ytdl-core (doğrudan stream)
 *
 * Tüm fonksiyonlar başarısızlıkta `null` döner (try/catch ile sarılı),
 * böylece çağıran taraf zincirleme fallback yapabilir.
 */

const fs = require("fs");
const path = require("path");
const { getTempPath } = require("../../core/yardimcilar");

let _ruhend = null;
function getRuhend() {
  if (_ruhend) return _ruhend;
  try {
    _ruhend = require("ruhend-scraper");
  } catch (e) {
    _ruhend = false;
  }
  return _ruhend || null;
}

let _bochilFb = null;
function getBochilFb() {
  if (_bochilFb) return _bochilFb;
  try {
    _bochilFb = require("@bochilteam/scraper-facebook");
  } catch (e) {
    _bochilFb = false;
  }
  return _bochilFb || null;
}

let _ytdl = null;
function getYtdl() {
  if (_ytdl) return _ytdl;
  try {
    _ytdl = require("@distube/ytdl-core");
  } catch (e) {
    _ytdl = false;
  }
  return _ytdl || null;
}

/**
 * Instagram (post / reel / tv / story) için yerel indirici.
 *
 * @param {string} url   Tam Instagram bağlantısı (post / reel / tv / story).
 * @returns {Promise<string[]|null>}  Medya URL listesi veya null.
 */
async function localInstagram(url) {
  const ruhend = getRuhend();
  if (!ruhend?.igdl) return null;

  try {
    const res = await ruhend.igdl(url);
    const data = res?.data;
    if (!data || !Array.isArray(data) || data.length === 0) return null;

    const out = [];
    const seen = new Set();
    for (const item of data) {
      const u = item?.url || item?.downloadUrl || item?.video || item?.image;
      if (!u || typeof u !== "string" || !u.startsWith("http")) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out.length ? out : null;
  } catch (e) {
    if (process.env.DEBUG) console.error("[Yerel IG]", e?.message || e);
    return null;
  }
}

/**
 * Facebook video için yerel indirici (iki kaynaklı).
 *
 * Önce @bochilteam/scraper-facebook, başarısızlıkta ruhend-scraper.fbdl.
 *
 * @param {string} url   Facebook video bağlantısı.
 * @returns {Promise<{url: string, quality?: string, title?: string}|null>}
 */
async function localFacebook(url) {
  // 1) @bochilteam/scraper-facebook → en yüksek kalite
  try {
    const bochil = getBochilFb();
    if (bochil?.facebookdl) {
      const data = await bochil.facebookdl(url);
      if (data?.video && Array.isArray(data.video) && data.video.length) {
        const opt = data.video[0];
        if (opt?.download) {
          const dl = await opt.download();
          let videoUrl = null;
          if (typeof dl === "string") videoUrl = dl;
          else if (dl?.url) videoUrl = dl.url;
          if (videoUrl) {
            return { url: videoUrl, quality: opt.quality || "HD", title: data.title };
          }
        }
      }
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Yerel FB bochil]", e?.message || e);
  }

  // 2) ruhend-scraper.fbdl
  try {
    const ruhend = getRuhend();
    if (ruhend?.fbdl) {
      const res = await ruhend.fbdl(url);
      const data = res?.data;
      if (Array.isArray(data) && data.length) {
        // HD tercih, yoksa SD, yoksa ilk
        const hd = data.find(v => /hd/i.test(v.resolution || v.quality || ""));
        const sd = data.find(v => /sd|360/i.test(v.resolution || v.quality || ""));
        const pick = hd || sd || data[0];
        if (pick?.url) return { url: pick.url, quality: pick.resolution || pick.quality, title: res.title };
      } else if (data?.url) {
        return { url: data.url, quality: data.resolution || data.quality, title: res.title };
      }
    }
  } catch (e) {
    if (process.env.DEBUG) console.error("[Yerel FB ruhend]", e?.message || e);
  }

  return null;
}

/**
 * @distube/ytdl-core ile YouTube ses indirme (yt-dlp düşünce yedek).
 *
 * @param {string} url   YouTube video URL'si.
 * @returns {Promise<{path: string, title: string}|null>}
 */
async function localYtAudio(url) {
  const ytdl = getYtdl();
  if (!ytdl) return null;

  try {
    if (!ytdl.validateURL(url)) return null;

    const info = await ytdl.getInfo(url);
    const title = (info?.videoDetails?.title || "audio").replace(/[^\w\s-]/gi, "").trim() || "audio";
    const outputPath = getTempPath(`distube_${Date.now()}.m4a`);

    await new Promise((resolve, reject) => {
      const stream = ytdl(url, {
        quality: "highestaudio",
        filter: "audioonly",
      });
      const writeStream = fs.createWriteStream(outputPath);
      stream.on("error", reject);
      writeStream.on("error", reject);
      writeStream.on("finish", resolve);
      stream.pipe(writeStream);
    });

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) {
      try { fs.unlinkSync(outputPath); } catch (_) {}
      return null;
    }

    return { path: outputPath, title };
  } catch (e) {
    if (process.env.DEBUG) console.error("[Yerel YT Ses]", e?.message || e);
    return null;
  }
}

module.exports = {
  localInstagram,
  localFacebook,
  localYtAudio,
};
