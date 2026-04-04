"use strict";

/**
 * plugins/utils/mediaProcessors.js
 * Clean, transparent media processing utility (De-obfuscated version).
 */

const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const { Jimp, JimpMime } = require("jimp");
const { Image } = require("node-webpmux");
const fs = require("fs");
const path = require("path");
// const ID3Writer = require("browser-id3-writer"); // Removed due to ESM mismatch in Node 22

const { getTempPath, cleanTempFile } = require("../../core/helpers");
const nx = require("./nexray");

// Configure ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Adds Exif metadata to a WebP sticker.
 */
async function addExif(webpBuffer, packname = "Lades-MD", author = "NexBot") {
  const img = new Image();
  await img.load(webpBuffer);
  const exif = {
    "sticker-pack-id": `lades-${Date.now()}`,
    "sticker-pack-name": packname,
    "sticker-pack-publisher": author,
    "android-app-store-link": "https://github.com/byadems",
    "ios-app-store-link": "https://github.com/byadems",
  };
  const json = JSON.stringify({ "sticker-pack-id": exif["sticker-pack-id"], "sticker-pack-name": exif["sticker-pack-name"], "sticker-pack-publisher": exif["sticker-pack-publisher"] });
  const exifAttr = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, json.length & 0xff, (json.length >> 8) & 0xff, (json.length >> 16) & 0xff, (json.length >> 24) & 0xff, 0x16, 0x00, 0x00, 0x00]);
  const exifBuffer = Buffer.concat([exifAttr, Buffer.from(json)]);
  exifBuffer.fill(0, 0, 4);
  exifBuffer[0] = 0x45; exifBuffer[1] = 0x78; exifBuffer[2] = 0x69; exifBuffer[3] = 0x66;
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

  return new Promise((resolve, reject) => {
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
  });
}

/**
 * Crops image to circle.
 */
async function circle(imageBuffer) {
  const image = await Jimp.read(imageBuffer);
  image.circle();
  return await image.getBuffer(JimpMime.png);
}

/**
 * Blurs image.
 */
async function blur(imageBuffer, level = 5) {
  const image = await Jimp.read(imageBuffer);
  image.blur(level);
  return await image.getBuffer(JimpMime.jpeg);
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

  return new Promise((resolve, reject) => {
    const ff = ffmpeg(input);
    if (isVideo) {
      ff.addOptions([
        "-vcodec", "libwebp",
        "-vf", "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15, pad=320:320:(320-iw)/2:(320-ih)/2:color=0x00000000,setsar=1",
        "-loop", "0", "-ss", "00:00:00", "-t", "00:00:05", "-preset", "superfast", "-an", "-vsync", "0"
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
  });
}

/**
 * Rotates media.
 */
async function rotate(buffer, deg = 90) {
    const input = getTempPath();
    const output = getTempPath();
    const fsPromises = require("fs").promises;
    await fsPromises.writeFile(input, buffer);
    return new Promise((resolve, reject) => {
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
    });
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

    return new Promise((resolve, reject) => {
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
    });
}

/**
 * Converts WebP to MP4.
 */
async function webp2mp4(buffer) {
    return await nx.nxTry([`/tools/webp2mp4?url=`, `/tools/ezgif-webp2mp4`], { buffer: true });
}

/**
 * Trims video/audio.
 */
async function trim(buffer, start, end) {
    const input = getTempPath();
    const output = getTempPath();
    const fsPromises = require("fs").promises;
    await fsPromises.writeFile(input, buffer);
    return new Promise((resolve, reject) => {
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
    });
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