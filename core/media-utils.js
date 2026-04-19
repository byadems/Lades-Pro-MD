"use strict";

const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
const { getTempPath, cleanTempFile, ffmpegLimit } = require("./yardimcilar");
const fs = require("fs");
const { Readable } = require("stream");

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Converts any audio buffer to OGG/Opus for WhatsApp Voice Messages (PTT).
 * @param {Buffer} buffer - Input audio buffer
 * @returns {Promise<Buffer>} - OGG/Opus buffer
 */
async function toOpus(buffer) {
  return ffmpegLimit(async () => {
    const inputPath = getTempPath(".input");
    const outputPath = getTempPath(".ogg");

    try {
      await fs.promises.writeFile(inputPath, buffer);

      return await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioCodec("libopus")
          .audioChannels(1)
          .audioBitrate("128k")
          .audioFrequency(48000)
          .outputOptions([
            "-avoid_negative_ts make_zero",
            "-map_metadata -1",
          ])
          .toFormat("opus")
          .on("end", async () => {
            try {
              const outBuffer = await fs.promises.readFile(outputPath);
              resolve(outBuffer);
            } catch (e) {
              reject(e);
            } finally {
              cleanTempFile(inputPath);
              cleanTempFile(outputPath);
            }
          })
          .on("error", (err) => {
            cleanTempFile(inputPath);
            cleanTempFile(outputPath);
            reject(err);
          })
          .save(outputPath);
      });
    } catch (err) {
      cleanTempFile(inputPath);
      cleanTempFile(outputPath);
      throw err;
    }
  });
}

/**
 * Converts any audio buffer to MP4/AAC for iOS compatibility.
 * @param {Buffer} buffer - Input audio buffer
 * @returns {Promise<Buffer>} - MP4 Audio buffer
 */
async function toMp4Audio(buffer) {
  return ffmpegLimit(async () => {
    const inputPath = getTempPath(".input");
    const outputPath = getTempPath(".m4a");

    try {
      await fs.promises.writeFile(inputPath, buffer);

      return await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioCodec("aac")
          .audioChannels(2)
          .audioBitrate("128k")
          .outputOptions([
            "-avoid_negative_ts make_zero",
          ])
          .toFormat("mp4")
          .on("end", async () => {
            try {
              const outBuffer = await fs.promises.readFile(outputPath);
              resolve(outBuffer);
            } catch (e) {
              reject(e);
            } finally {
              cleanTempFile(inputPath);
              cleanTempFile(outputPath);
            }
          })
          .on("error", (err) => {
            cleanTempFile(inputPath);
            cleanTempFile(outputPath);
            reject(err);
          })
          .save(outputPath);
      });
    } catch (err) {
      cleanTempFile(inputPath);
      cleanTempFile(outputPath);
      throw err;
    }
  });
}

/**
 * Converts any audio buffer to MP3 (Legacy/Fallback).
 */
async function toMp3(buffer) {
  return ffmpegLimit(async () => {
    const inputPath = getTempPath(".input");
    const outputPath = getTempPath(".mp3");

    try {
      await fs.promises.writeFile(inputPath, buffer);

      return await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioCodec("libmp3lame")
          .audioBitrate("128k")
          .toFormat("mp3")
          .on("end", async () => {
            try {
              const outBuffer = await fs.promises.readFile(outputPath);
              resolve(outBuffer);
            } catch (e) {
              reject(e);
            } finally {
              cleanTempFile(inputPath);
              cleanTempFile(outputPath);
            }
          })
          .on("error", (err) => {
            cleanTempFile(inputPath);
            cleanTempFile(outputPath);
            reject(err);
          })
          .save(outputPath);
      });
    } catch (err) {
      cleanTempFile(inputPath);
      cleanTempFile(outputPath);
      throw err;
    }
  });
}

module.exports = {
  toOpus,
  toMp4Audio,
  toMp3
};
