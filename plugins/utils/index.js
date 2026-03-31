// Import all modules
const dbOperations = require("./db/functions");
const mediaProcessing = require("./mediaProcessors");
const utils = require("./misc");
const language = require("./manglish");

// Grouped database operations
const {
  syncWarnsSequence,
  getWarn,
  setWarn,
  resetWarn,
  decrementWarn,
  getWarnCount,
  getAllWarns,
  antilinkConfig,
  antiword,
  antifake,
  antipromote,
  antidemote,
  antispam,
  antibot,
  pdm,
  welcome,
  goodbye,
  filter,
} = dbOperations;

// Media processing functions
const {
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
} = mediaProcessing;

// Utility functions
const {
  parseUptime,
  isNumeric,
  isAdmin,
  mentionjid,
  getJson,
  bytesToSize,
  isFake,
  processOnwa,
  findMusic,
  searchYT,
  downloadGram,
  pinterestDl,
  fb,
  igStalk,
  tiktok,
  story,
  getThumb,
  gtts,
  getBuffer,
  lyrics,
  pinterestSearch,
} = utils;

// Language functions
const { malayalamToManglish, manglishToMalayalam } = language;

const aiTTS = require("./ai-tts");

const { gis } = require("./gis");

const { uploadToImgbb, uploadToCatbox } = require("./upload");

const linkDetector = require("./link-detector");

const fancy = require("./fancy");

const { censorBadWords, badWords } = require("./censor");

const { nx, nxTry, fmtCount, trToEn } = require("./nexray");

module.exports = {
  // Database Operations
  syncWarnsSequence,
  getWarn,
  setWarn,
  fancy,
  resetWarn,
  decrementWarn,
  getWarnCount,
  getAllWarns,
  antilinkConfig,
  antiword,
  antifake,
  antipromote,
  antidemote,
  antispam,
  antibot,
  pdm,
  welcome,
  goodbye,
  filter,

  // Media Processing
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

  // Utilities
  parseUptime,
  isNumeric,
  isAdmin,
  mentionjid,
  getJson,
  bytesToSize,
  isFake,
  aiTTS,
  processOnwa,
  findMusic,
  searchYT,
  downloadGram,
  pinterestDl,
  fb,
  igStalk,
  tiktok,
  story,
  getThumb,
  gtts,
  getBuffer,
  pinterestSearch,

  // Language
  malayalamToManglish,
  manglishToMalayalam,

  // GIS
  gis,

  // File Upload
  uploadToImgbb,
  uploadToCatbox,

  // Link Detection
  linkDetector,
  lyrics,

  // Küfür sansürü (tüm pluginlerden erişilebilir)
  censorBadWords,
  badWords,

  // Nexray Utilities
  nx,
  nxTry,
  fmtCount,
  trToEn,
};
