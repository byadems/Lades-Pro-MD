const ytdl = require('ytdl-core');
const yts = require('yt-search');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { getTempPath } = require('../../core/helpers');

/**
 * YouTube downloader utility replacing the obfuscated bytecode.
 * Clean, readable, and open-source.
 */

async function convertM4aToMp3(inputPath) {
  const outputPath = getTempPath(`converted_${Date.now()}.mp3`);
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('libmp3lame')
      .save(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err));
  });
}

async function searchYoutube(query) {
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
  try {
    const info = await ytdl.getInfo(url);
    const formats = info.formats.map(f => ({
      type: f.hasVideo ? 'video' : 'audio',
      quality: f.qualityLabel || f.audioQuality || 'unknown',
      size: f.contentLength ? `${(f.contentLength / 1024 / 1024).toFixed(2)}MB` : '',
      url: f.url
    }));
    return { formats, title: info.videoDetails.title };
  } catch (error) {
    console.error('ytdl getInfo error:', error);
    throw error;
  }
}

async function downloadVideo(url, quality) {
  try {
    const info = await ytdl.getInfo(url);
    const safeTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '').trim() || 'video';
    const outputPath = getTempPath(`${safeTitle}_${Date.now()}.mp4`);

    // Choose the best format with both video and audio
    const format = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'videoandaudio' });

    return new Promise((resolve, reject) => {
      ytdl(url, { format })
        .pipe(fs.createWriteStream(outputPath))
        .on('finish', () => resolve({ path: outputPath, title: info.videoDetails.title }))
        .on('error', reject);
    });
  } catch (error) {
    console.error('ytdl downloadVideo error:', error);
    throw error;
  }
}

async function downloadAudio(url) {
  try {
    const info = await ytdl.getInfo(url);
    const safeTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '').trim() || 'audio';
    const outputPath = getTempPath(`${safeTitle}_${Date.now()}.m4a`);

    return new Promise((resolve, reject) => {
      ytdl(url, { filter: 'audioonly' })
        .pipe(fs.createWriteStream(outputPath))
        .on('finish', () => resolve({ path: outputPath, title: info.videoDetails.title }))
        .on('error', reject);
    });
  } catch (error) {
    console.error('ytdl downloadAudio error:', error);
    throw error;
  }
}

module.exports = {
  downloadVideo,
  downloadAudio,
  searchYoutube,
  getVideoInfo,
  convertM4aToMp3
};
