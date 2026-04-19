// Import all modules
const dbOperations = require("./db/functions");
const mediaProcessing = require("./medya_islemcisi");
const utils = require("./genel_araclar");
const language = require("./manglish_ceviri");

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
  antipdm,
  welcome,
  goodbye,
  filter,
  antidelete,
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

const aiTTS = require("./yapay_zeka_ses");

const { gis } = require("./google_gorsel_arama");

const { uploadToImgbb, uploadToCatbox } = require("./dosya_yukleme");

const linkDetector = require("./baglanti_tespit");

const fancy = require("./metin_stilleri");

const { censorBadWords, badWords } = require("./sansur");

const { nx, nxTry, fmtCount, trToEn } = require("./nexray_api");

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
  antipdm,
  welcome,
  goodbye,
  filter,
  antidelete,

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
