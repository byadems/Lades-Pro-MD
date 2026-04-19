const fs = require('fs');

const helpers = fs.readFileSync('core/helpers.js', 'utf-8');
const lidHelper = fs.readFileSync('core/lid-helper.js', 'utf-8');

let newLidHelper = lidHelper
  .replace(/"use strict";/g, '')
  .replace(/const \{ logger \} = require\("\.\.\/config"\);/g, '')
  .replace(/const config = require\("\.\.\/config"\);/g, '');

let combined = helpers + '\n\n// --- LID HELPER EKLENTİLERİ ---\n\n' + newLidHelper;

// Remove all module.exports blocks
combined = combined.replace(/module\.exports\s*=\s*\{[\s\S]*?\};/g, '');

const exportsBlock = `
module.exports = {
  TEMP_DIR, ensureTempDir, getTempPath, cleanTempFile,
  startTempCleanup, stopTempCleanup,
  toUserJid, toGroupJid, parseJid, isGroup, isBroadcast,
  getGroupAdmins, isSuperAdmin,
  formatBytes, formatDuration, runtime, sleep, chunk,
  extractUrls, validateUrl,
  suppressLibsignalLogs,
  getMessageText, getQuotedMsg, getMentioned,
  loadBaileys, getTempSubdir, saveToDisk, isMediaImage, readMp4Dimensions,
  ffmpegLimit, getNumericalId,
  migrateSudoToLID,
  resolveLidToPn,
  getNumericalIdLocal,
  isBotIdentifier,
  getBotJid,
  getBotLid,
  getBotNumericIds,
};
`;

fs.writeFileSync('core/yardimcilar.js', combined + exportsBlock, 'utf-8');
console.log('yardimcilar.js created successfully');
