const { jidDecode, jidNormalizedUser } = require('@whiskeysockets/baileys');
console.log("JID decode test:");
const jids = [
  "12159069245680@s.whatsapp.net",
  "12159069245:680@s.whatsapp.net",
  "12159069245680@lid"
];
jids.forEach(j => {
  console.log(`Original: ${j}`);
  console.log(`jidDecode:`, jidDecode(j));
  console.log(`jidNormalizedUser:`, jidNormalizedUser(j));
});
