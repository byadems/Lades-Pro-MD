const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { getTempPath, saveToDisk } = require('../../core/yardimcilar');
const nexray = require('./nexray_api');
const pLimit = require('p-limit');

// YouTube concurrency limit (max 3 concurrent downloads/info requests)
const limit = pLimit(3);


// FFmpeg binary'yi otomatik bul ve kaydet (@ffmpeg-installer/ffmpeg ile)
try {
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
} catch (_) {
  // Sistem FFmpeg'i yoksa sessizce devam et - çevre değişkeni veya PATH'ten alınır
}


/**
 * YouTube downloader utility replacing the obfuscated bytecode.
 * Clean, readable, and open-source.
 */

async function convertM4aToMp3(inputPath, metadata = null) {
  const outputPath = getTempPath(`converted_${Date.now()}.mp3`);
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('libmp3lame')
      .save(outputPath)
      .on('end', async () => {
        if (metadata) {
          try {
            const NodeID3 = require('node-id3');
            let tags = {
              title: metadata.title || 'Bilinmeyen Başlık',
              artist: metadata.artist || 'Bilinmeyen Sanatçı',
              album: 'Lades-Pro|Bot'
            };

            if (metadata.imageBuffer) {
              tags.image = {
                mime: 'image/jpeg',
                type: { id: 3, name: 'front cover' },
                description: 'Cover',
                imageBuffer: metadata.imageBuffer
              };
            } else if (metadata.imageUrl) {
              const axios = require('axios');
              try {
                const response = await axios.get(metadata.imageUrl, { responseType: 'arraybuffer' });
                tags.image = {
                  mime: 'image/jpeg',
                  type: { id: 3, name: 'front cover' },
                  description: 'Cover',
                  imageBuffer: response.data
                };
              } catch (imgErr) {
                console.error("Cover image fetch error:", imgErr.message);
              }
            }
            NodeID3.write(tags, outputPath);
          } catch (e) {
            console.error("ID3 Tag error:", e);
          }
        }
        resolve(outputPath);
      })
      .on('error', (err) => reject(err));
  });
}

async function searchYoutube(query) {
  const yts = require('yt-search');
  try {
    const r = await yts(query);
    const videos = r.videos.slice(0, 10);
    return videos.map(v => ({
      title: v.title,
      url: v.url,
      duration: v.timestamp,
      views: v.views,
      channel: v.author.name,
      id: v.videoId
    }));
  } catch (error) {
    console.error('yt-search error:', error);
    return [];
  }
}

async function getVideoInfo(url) {
  const ytdl = require('@distube/ytdl-core');
  return limit(async () => {
    try {
      const requestOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 15000 // 15s metadata timeout
      };
      const info = await ytdl.getInfo(url, { requestOptions });
      const formats = info.formats.map(f => ({
        type: f.hasVideo ? 'video' : 'audio',
        quality: f.qualityLabel || f.audioQuality || 'unknown',
        size: f.contentLength ? `${(f.contentLength / 1024 / 1024).toFixed(2)}MB` : '',
        url: f.url
      }));
      return { formats, title: info.videoDetails.title, videoId: info.videoDetails.videoId };
    } catch (error) {
      console.error('ytdl getInfo error:', error.message);
      return getVideoInfoFallback(url);
    }
  });
}

async function getVideoInfoFallback(url) {
  const yts = require('yt-search');
  try {
    const search = await yts(url);
    if (search) {
      return {
        title: search.title || 'YouTube Videosu',
        videoId: search.videoId,
        isFallback: true,
        formats: [
          { type: 'video', quality: '360p', size: 'Standart' },
          { type: 'video', quality: '720p', size: 'HD' },
          { type: 'video', quality: '1080p', size: 'Full HD' },
          { type: 'video', quality: '1440p', size: '2K' },
          { type: 'video', quality: '2160p', size: '4K' },
          { type: 'audio', quality: '128kbps', size: '-' }
        ]
      };
    }
  } catch (e) {
    console.error('Metadata fallback error:', e.message);
  }
  throw new Error('Video bilgisi alınamadı.');
}

async function downloadVideo(url, quality) {
  const ytdl = require('@distube/ytdl-core');
  return limit(async () => {
    try {
      const requestOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      };
      const info = await ytdl.getInfo(url, { requestOptions });
      const safeTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '').trim() || 'video';
      const outputPath = getTempPath(`${safeTitle}_${Date.now()}.mp4`);

      const format = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'videoandaudio' });

      return await new Promise((resolve, reject) => {
        ytdl(url, { format, requestOptions })
          .pipe(fs.createWriteStream(outputPath))
          .on('finish', () => resolve({ path: outputPath, title: info.videoDetails.title }))
          .on('error', reject);
      });
    } catch (error) {
      console.error('ytdl downloadVideo error:', error.message);
      try {
        const fallback = await nexray.downloadYtMp4(url);
        if (fallback && fallback.url) {
          const safeTitle = (fallback.title || 'video').replace(/[^\w\s]/gi, '').trim();
          const outputPath = getTempPath(`${safeTitle}_${Date.now()}.mp4`);
          await saveToDisk(fallback.url, outputPath);
          return { path: outputPath, title: fallback.title || 'YouTube Videosu' };
        }
      } catch (fbError) {
        console.error('ytdl downloadVideo fallback error:', fbError.message);
      }
      throw error;
    }
  });
}

async function downloadAudio(url) {
  const ytdl = require('@distube/ytdl-core');
  return limit(async () => {
    try {
      const requestOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      };
      const info = await ytdl.getInfo(url, { requestOptions });
      const safeTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '').trim() || 'audio';
      const outputPath = getTempPath(`${safeTitle}_${Date.now()}.m4a`);

      return await new Promise((resolve, reject) => {
        ytdl(url, { filter: 'audioonly', requestOptions })
          .pipe(fs.createWriteStream(outputPath))
          .on('finish', () => resolve({ path: outputPath, title: info.videoDetails.title }))
          .on('error', reject);
      });
    } catch (error) {
      console.error('ytdl downloadAudio error:', error.message);
      try {
        const fallback = await nexray.downloadYtMp3(url);
        if (fallback && fallback.url) {
          const safeTitle = (fallback.title || 'audio').replace(/[^\w\s]/gi, '').trim();
          const outputPath = getTempPath(`${safeTitle}_${Date.now()}.m4a`);
          await saveToDisk(fallback.url, outputPath);
          return { path: outputPath, title: fallback.title || 'YouTube Sesi' };
        }
      } catch (fbError) {
        console.error('ytdl downloadAudio fallback error:', fbError.message);
      }
      throw error;
    }
  });
}

module.exports = {
  downloadVideo,
  downloadAudio,
  searchYoutube,
  getVideoInfo,
  convertM4aToMp3
};
