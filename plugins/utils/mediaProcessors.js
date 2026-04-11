"use strict";

/**
 * plugins/utils/mediaProcessors.js
 * Clean, transparent media processing utility (De-obfuscated version).
 */

const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const { Image } = require("node-webpmux");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const { getTempPath, cleanTempFile, ffmpegLimit } = require("../../core/helpers");
const nx = require("./nexray");

// Configure ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Adds Exif metadata to a WebP sticker.
 * Supports: (buffer/path, packname, author) OR (buffer/path, {packname, author})
 */
async function addExif(webpInput, packname = "Lades-Pro", author = "Lades-Pro") {
  let webpBuffer;
  if (Buffer.isBuffer(webpInput)) {
    webpBuffer = webpInput;
  } else if (typeof webpInput === "string" && fs.existsSync(webpInput)) {
    webpBuffer = await fs.promises.readFile(webpInput);
  } else {
    throw new Error("addExif: Geçersiz girdi (Buffer veya dosya yolu gerekli)");
  }

  // Handle object as second argument
  if (typeof packname === "object" && packname !== null) {
    const meta = packname;
    packname = (meta.packname || meta.pack || "Lades-Pro").toString();
    author = (meta.author || "Lades-Pro").toString();
  } else {
    packname = (packname || "Lades-Pro").toString();
    author = (author || "Lades-Pro").toString();
  }

  const img = new Image();
  await img.load(webpBuffer);
  const json = JSON.stringify({
    "sticker-pack-id": `lades-${Date.now()}`,
    "sticker-pack-name": packname,
    "sticker-pack-publisher": author,
    "emojis": ["\u2764\uFE0F", "\uD83D\uDE0D", "\uD83D\uDE02"]
  });

  const exifAttr = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
  const jsonBuffer = Buffer.from(json, "utf-8");
  const exifBuffer = Buffer.concat([exifAttr, jsonBuffer]);

  // Set json length in header
  exifBuffer.writeUIntLE(jsonBuffer.length, 14, 4);

  img.exif = exifBuffer;
  return await img.save(null);
}

/**
 * Applies bass boost to audio.
 */
async function bass(audioBuffer, gain = 20) {
  const input = getTempPath(".mp3");
  const output = getTempPath(".mp3");
  const fsPromises = require("fs").promises;
  await fsPromises.writeFile(input, audioBuffer);

  return ffmpegLimit(() => new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioFilter(`equalizer=f=40:width_type=h:width=50:g=${gain}`)
      .format("mp3")
      .on("end", async () => {
        try {
          const result = await fsPromises.readFile(output);
          cleanTempFile(input);
          cleanTempFile(output);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      })
      .on("error", (e) => {
        cleanTempFile(input);
        cleanTempFile(output);
        reject(e);
      })
      .save(output);
  }));
}

/**
 * Crops image to circle.
 * Supports webp, png, jpeg formats
 */
async function circle(imageBuffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 512;
    const height = metadata.height || 512;
    const minSize = Math.min(width, height);
    
    // Create a circular SVG mask
    const circleSvg = `<svg width="${minSize}" height="${minSize}"><circle cx="${minSize/2}" cy="${minSize/2}" r="${minSize/2}" fill="white"/></svg>`;
    
    return await sharp(imageBuffer)
      .resize(minSize, minSize)
      .composite([{
        input: Buffer.from(circleSvg),
        blend: 'dest-in'
      }])
      .png()
      .toBuffer();
  } catch (e) {
    console.error("Circle processing error:", e);
    return await sharp(imageBuffer).png().toBuffer();
  }
}

/**
 * Blurs image.
 * Supports webp, png, jpeg formats
 */
async function blur(imageBuffer, level = 5) {
  try {
    // Sharp blur takes a sigma value usually between 0.3 and 1000.
    const sigma = Math.min(1000, Math.max(0.3, level * 2));
    return await sharp(imageBuffer)
      .blur(sigma)
      .jpeg()
      .toBuffer();
  } catch (e) {
    console.error("Blur processing error:", e);
    return await sharp(imageBuffer).jpeg().toBuffer();
  }
}

/**
 * Text to picture (placeholder for actual API call).
 */
async function attp(text) {
  return await nx.nx(`/tools/attp?text=${encodeURIComponent(text)}`, { buffer: true });
}

/**
 * Converts image/video to sticker.
 */
async function sticker(buffer, isVideo = false) {
  const input = getTempPath(isVideo ? ".mp4" : ".jpg");
  const output = getTempPath(".webp");
  const fsPromises = require("fs").promises;
  await fsPromises.writeFile(input, buffer);

  return ffmpegLimit(() => new Promise((resolve, reject) => {
    const ff = ffmpeg(input);
    if (isVideo) {
      ff.addOptions([
        "-vcodec", "libwebp",
        "-vf", "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15, pad=320:320:(320-iw)/2:(320-ih)/2:color=0x00000000,setsar=1",
        "-loop", "0", "-ss", "00:00:00", "-t", "00:00:05", "-an", "-vsync", "0"
      ]);
    } else {
      ff.addOptions([
        "-vcodec", "libwebp",
        "-vf", "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15, pad=320:320:(320-iw)/2:(320-ih)/2:color=0x00000000,setsar=1"
      ]);
    }
    ff.on("end", async () => {
      try {
        const result = await fsPromises.readFile(output);
        cleanTempFile(input);
        cleanTempFile(output);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    })
      .on("error", (e) => {
        cleanTempFile(input);
        cleanTempFile(output);
        reject(e);
      })
      .save(output);
  }));
}

/**
 * Rotates media.
 */
async function rotate(buffer, deg = 90) {
  const input = getTempPath();
  const output = getTempPath();
  const fsPromises = require("fs").promises;
  await fsPromises.writeFile(input, buffer);
  return ffmpegLimit(() => new Promise((resolve, reject) => {
    ffmpeg(input)
      .addOptions([`-vf`, `rotate=${deg}*(PI/180)`])
      .on('end', async () => {
        try {
          const result = await fsPromises.readFile(output);
          cleanTempFile(input);
          cleanTempFile(output);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (e) => {
        cleanTempFile(input);
        cleanTempFile(output);
        reject(e);
      })
      .save(output);
  }));
}

/**
 * Mix audio and video.
 */
async function avMix(videoBuffer, audioBuffer) {
  const video = getTempPath(".mp4");
  const audio = getTempPath(".mp3");
  const output = getTempPath(".mp4");
  const fsPromises = require("fs").promises;
  await fsPromises.writeFile(video, videoBuffer);
  await fsPromises.writeFile(audio, audioBuffer);

  return ffmpegLimit(() => new Promise((resolve, reject) => {
    ffmpeg(video)
      .input(audio)
      .addOptions(['-c:v copy', '-c:a aac', '-map 0:v:0', '-map 1:a:0', '-shortest'])
      .on('end', async () => {
        try {
          const result = await fsPromises.readFile(output);
          cleanTempFile(video);
          cleanTempFile(audio);
          cleanTempFile(output);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (e) => {
        cleanTempFile(video);
        cleanTempFile(audio);
        cleanTempFile(output);
        reject(e);
      })
      .save(output);
  }));
}

/**
 * Converts WebP to MP4.
 */
async function webp2mp4(buffer, outputPath) {
  const res = await nx.nxTry([`/tools/webp2mp4?url=`, `/tools/ezgif-webp2mp4`], { buffer: true });
  if (outputPath && res) {
    await fs.promises.writeFile(outputPath, res);
  }
  return res;
}

/**
 * Trims video/audio.
 */
async function trim(buffer, start, end) {
  const input = getTempPath();
  const output = getTempPath();
  const fsPromises = require("fs").promises;
  await fsPromises.writeFile(input, buffer);
  return ffmpegLimit(() => new Promise((resolve, reject) => {
    ffmpeg(input)
      .setStartTime(start)
      .setDuration(end - start)
      .on('end', async () => {
        try {
          const result = await fsPromises.readFile(output);
          cleanTempFile(input);
          cleanTempFile(output);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (e) => {
        cleanTempFile(input);
        cleanTempFile(output);
        reject(e);
      })
      .save(output);
  }));
}

async function addID3(audioBuffer, title, artist, imageBuffer) {
  const ID3WriterModule = await import("browser-id3-writer");
  const ID3Writer = ID3WriterModule.default;
  const writer = new ID3Writer(audioBuffer);

  writer.setFrame('TIT2', title)
    .setFrame('TPE1', [artist])
    .setFrame('APIC', {
      type: 3,
      data: imageBuffer,
      description: 'Cover'
    });
  writer.addTag();
  return Buffer.from(writer.arrayBuffer);
}

module.exports = {
  addExif,
  bass,
  circle,
  blur,
  attp,
  sticker,
  rotate,
  avMix,
  webp2mp4,
  addID3,
  trim,
};