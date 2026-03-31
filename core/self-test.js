"use strict";

/**
 * core/self-test.js
 * Bot bağlandıktan sonra tüm komutları mock mesaj nesnesiyle çalıştırır,
 * sonuçları sessions/cmd-stats.json'a kaydeder.
 *
 * Komutların state değiştirmesini önlemek için:
 * - Tüm sendReply, send, react vs. → no-op (sessiz)
 * - Tüm dış ağ çağrıları zaman aşımına uğrarsa "timeout" olarak işaretlenir
 * - DMS/grup değiştiren komutlar güvenli liste dışındaysa atlanır
 */

const path = require("path");
const fs   = require("fs");

const STATS_FILE  = path.join(__dirname, "../sessions/cmd-stats.json");
const TIMEOUT_MS  = 6000;   // komut başına max bekleme
const BATCH_SIZE  = 5;      // Paralel test sayısı (Stability için düşürüldü)
const BATCH_DELAY = 500;    // Batch'ler arası bekleme (ms)

// Bu pattern'ler gerçek grup/kullanıcı işlemi yapar, atla
const DANGEROUS_PATTERNS = [
  /^ban/, /^at$/, /^ekle/, /^tagall/, /^etiket/, /^ytetiket/,
  /^yetkiver/, /^yetkial/, /^davet/, /^davetyenile/, /^ayrıl/,
  /^sohbetsil/, /^sohbetkapat/, /^sohbetaç/, /^duyuru/, /^sabitle/,
  /^engelle/, /^engelkaldır/, /^katıl/, /^toplukatıl/,
  /^otoçıkartma/, /^otosohbet/, /^antinumara/,
  /^ybaşlat/, /^güncelle/, /^reload/, /^reboot/, /^bağla/,
  /^modülyükle/, /^modülsil/, /^mgüncelle/,
  /^uyar/, /^uyarısıfırla/, /^filtre/, /^togglefilter/,
  /^warn/, /^pdm/, /^antikelime/, /^antisil/,
  /^speedtest/, /^hıztesti/,
];

function isDangerous(key) {
  return DANGEROUS_PATTERNS.some(r => r.test(key));
}

// loadStats, saveStats omitted since we will use handler's memory

function makeKey(pattern) {
  return String(pattern)
    .split("?")[0].split(" ")[0]
    .replace(/[^\wçğıöşüÇĞİÖŞÜ]/gi, "")
    .slice(0, 40);
}

// (Removed isFresh check to enforce testing all commands every startup)

/**
 * Sessiz mock mesaj nesnesi — hiçbir şey göndermez, hata atmaz.
 */
function createMockMsg(ownJid, text) {
  const noop = async () => ({});
  const mockClient = {
    sendMessage: noop,
    groupMetadata: async () => ({ subject: "Test Group", id: ownJid, participants: [] }),
    groupLeave: noop,
    groupUpdateSubject: noop,
    groupUpdateDescription: noop,
    groupSettingUpdate: noop,
    groupParticipantsUpdate: noop,
    groupInviteCode: async () => "https://chat.whatsapp.com/test",
    groupRevokeInvite: noop,
    groupAcceptInvite: noop,
    profilePictureUrl: async () => "https://test.com/pp.png",
    setProfilePicture: noop,
    updateProfileStatus: noop,
    updateProfileName: noop,
    presenceSubscribe: noop,
    sendPresenceUpdate: noop,
    readMessages: noop,
    user: { id: ownJid }
  };
  
  return {
    jid: ownJid,
    sender: ownJid,
    senderJid: ownJid,
    senderName: "Test User",
    pushName: "Test User",
    fromMe: true,
    text,
    client: mockClient, // Baileys connection object mock
    isGroup: false,
    quoted: null,
    reply_message: false, 
    mentions: [],
    groupMetadata: null,
    key: { id: "selftest-" + Date.now(), remoteJid: ownJid, fromMe: true },
    messageTimestamp: Math.floor(Date.now() / 1000),
    data: { key: { id: "selftest-" + Date.now(), remoteJid: ownJid, fromMe: true }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) },
    message: { conversation: text },
    reply:      noop,
    send:       noop,
    sendReply:  noop,
    sendMessage:noop,
    react:      noop,
    edit:       noop,
    forward:    noop,
    delete:     noop,
    download:   noop, 
  };
}

async function testOne(cmd, ownJid, prefix) {
  const key = makeKey(cmd.pattern);
  if (!key) return null;

  if (isDangerous(key)) {
    return { key, result: { status: "skipped", ms: 0, lastRun: new Date().toISOString(), error: "Güvenlik: state değiştiren komut", runs: 0 } };
  }

  const text = prefix + key;
  const mock  = createMockMsg(ownJid, text);
  const regex = new RegExp(String(cmd.pattern), "i");
  const match = key.match(regex) || [key, ""];

  const t0 = Date.now();
  try {
    // console.log(`[Self-Test] Running: ${key}`); // Verbose but useful for debugging hangs
    await Promise.race([
      cmd.run(mock, match),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS)),
    ]);
    return { key, result: { status: "ok", ms: Date.now() - t0, lastRun: new Date().toISOString(), error: null, runs: 1 } };
  } catch (err) {
    const isTimeout = err.message === "timeout";
    if (isTimeout) console.warn(`[Self-Test] Timeout: ${key}`);
    return { key, result: {
      status: isTimeout ? "timeout" : "error",
      ms: Date.now() - t0,
      lastRun: new Date().toISOString(),
      error: err.message.slice(0, 120),
      runs: 1,
    }};
  }
}

async function runSelfTest(sock) {
  const { logger } = require("../config");
  const handler = require("./handler");

  const ownJid = sock.user?.id;
  if (!ownJid || !handler.commands) return;
  
  const allCmds = typeof handler.commands === "function" ? handler.commands() : [];
  if (!allCmds.length) return;

  const prefix = (process.env.HANDLERS || process.env.PREFIX || ".")[0];

  const seen = new Set();
  const queue = allCmds.filter(cmd => {
    const k = makeKey(cmd.pattern);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true; 
  });

  logger.info(`🧪 Self-test başladı: ${queue.length} eşsiz komut test edilecek`);
  
  process.emit('dashboard_activity', {
    time: new Date().toLocaleTimeString(),
    sender: 'Sistem',
    type: 'Self-Test',
    content: `Self-test başladı: ${queue.length} komut taranacak...`,
    isGroup: false
  });

  let ok = 0, err = 0, skipped = 0, timeout = 0;

  for (let i = 0; i < queue.length; i += BATCH_SIZE) {
    const batch = queue.slice(i, i + BATCH_SIZE);
    
    // Heartbeat to dashboard to confirm we are not dead
    process.emit('dashboard_activity', {
        time: new Date().toLocaleTimeString(),
        sender: 'Sistem',
        type: 'Heartbeat',
        content: `Test devam ediyor... (${i}/${queue.length})`,
        isGroup: false
    });

    const results = await Promise.all(batch.map(cmd => testOne(cmd, ownJid, prefix).catch(() => null)));

    for (const r of results) {
      if (!r) continue;
      handler.recordStat(r.key, r.result.status, r.result.ms, r.result.error);

      if (r.result.status === "ok")      ok++;
      else if (r.result.status === "error")   err++;
      else if (r.result.status === "timeout") timeout++;
      else if (r.result.status === "skipped") skipped++;
    }

    if (i + BATCH_SIZE < queue.length) await new Promise(res => setTimeout(res, BATCH_DELAY));
  }

  const report = `🧪 Self-test tamamlandı — ✅ ${ok} başarılı · ❌ ${err} hata · ⏱ ${timeout} zaman aşımı · ⏭ ${skipped} atlandı`;
  logger.info(report);
  
  process.emit('dashboard_activity', {
    time: new Date().toLocaleTimeString(),
    sender: 'Sistem',
    type: 'Self-Test',
    content: `Self-test bitti: ${ok} BAŞARILI, ${err} HATA.`,
    isGroup: false
  });
}

module.exports = { runSelfTest };
