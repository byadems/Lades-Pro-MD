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
const fs = require("fs");

const STATS_FILE = path.join(__dirname, "../sessions/cmd-stats.json");
const TIMEOUT_MS = 10000;   // Accelerated command timeout
const BATCH_SIZE = 5;
const BATCH_DELAY = 150;

// Bu pattern'ler gerçek grup/kullanıcı işlemi yapar veya veri tabanı/config değiştirir, atla
const DANGEROUS_PATTERNS = [
  /^ban/, /^at$/, /^ekle/, /^tagall/, /^etiket/, /^ytetiket/,
  /^yetkiver/, /^yetkial/, /^davet/, /^davetyenile/, /^ayrıl/,
  /^sohbetsil/, /^sohbetkapat/, /^sohbetaç/, /^duyuru/,
  /^engelle/, /^engelkaldır/, /^katıl/, /^toplukatıl/,
  /^otoçıkartma/, /^otosohbet/, /^antinumara/,
  /^ybaşlat/, /^güncelle/, /^reload/, /^reboot/, /^bağla/,
  /^modülyükle/, /^modülsil/, /^mgüncelle/,
  /^uyar/, /^uyarısıfırla/, /^filtre/, /^togglefilter/,
  /^warn/, /^pdm/, /^antikelime/, /^antisil/,
  /^speedtest/, /^hıztesti/,
  /^setvar/, /^setenv/, /^delvar/, /^değişkensil/, /^dil$/, /^mod$/,
  /^ayarlar$/, /^setsudo/, /^sudosil/, /^toggle$/, /^antibot/, /^antispam/,
  /^antiyetkidüşürme/, /^antiyetkiverme/, /^antiyetkiyükseltme/,
  /^aramaengel/
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
function createMockMsg(ownJid, text, cmd) {
  const noop = async () => ({});
  
  const isGroupCmd = cmd.onlyGroup || cmd.onlyAdmin || text.includes("test") || text.includes("kick") || text.includes("ban");
  
  const mockClient = {
    sendMessage: noop,
    groupMetadata: async () => ({ subject: "Test Group", id: "1234567890-123456@g.us", participants: [{ id: ownJid, admin: "admin" }, { id: "11111111111@s.whatsapp.net", admin: null }] }),
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
    albumMessage: noop,
    user: { id: ownJid }
  };

  const isGroup = isGroupCmd;
  const jid = isGroup ? "1234567890-123456@g.us" : ownJid;
  const sender = ownJid;

  const mockReplyMsg = {
    text: "dummy text",
    jid: jid,
    sender: sender,
    fromMe: true,
    key: { remoteJid: jid, fromMe: true, id: "reply-" + Date.now() },
    data: { key: { remoteJid: jid, fromMe: true, id: "reply-" + Date.now() }, message: { imageMessage: { mimetype: "image/jpeg" } } },
    message: { conversation: "dummy text" },
    mimetype: "image/jpeg",
    download: async (type) => {
      const fs = require('fs');
      const path = require('path');
      const { getTempPath } = require('./helpers');
      const isMedia = ["slow", "sped", "bass", "dinle", "trim", "vmix", "ağırçekim", "fps", "kes", "döndür", "flip", "gif"].some(x => String(cmd.pattern).includes(x));
      if (isMedia) {
        const sourcePath = path.join(__dirname, 'dummy.mp4');
        const dummyPath = getTempPath('.mp4');
        if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, dummyPath);
        if (type === 'buffer') return fs.readFileSync(dummyPath);
        return dummyPath;
      }
      const sourcePath = path.join(__dirname, 'dummy.jpg');
      const dummyPath = getTempPath('.jpg');
      if (!fs.existsSync(sourcePath)) {
        fs.writeFileSync(sourcePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
      }
      fs.copyFileSync(sourcePath, dummyPath);
      if (type === 'buffer') return fs.readFileSync(dummyPath);
      return dummyPath;
    },
    image: true,
    video: true,
    audio: true,
    sticker: true,
    document: true,
    album: false
  };

  return {
    jid: jid,
    sender: sender,
    senderJid: sender,
    senderName: "Test User",
    pushName: "Test User",
    fromMe: true,
    fromOwner: true,
    isAdmin: true,
    isBotAdmin: true,
    isGroup: isGroup,
    isGroupAdmins: true,
    groupAdmins: [ownJid],
    text,
    client: mockClient,
    quoted: mockReplyMsg,
    reply_message: mockReplyMsg,
    mention: ["11111111111@s.whatsapp.net"],
    mentions: ["11111111111@s.whatsapp.net"],
    groupMetadata: null,
    key: { id: "selftest-" + Date.now(), remoteJid: jid, fromMe: true },
    messageTimestamp: Math.floor(Date.now() / 1000),
    data: { key: { id: "selftest-" + Date.now(), remoteJid: jid, fromMe: true }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) },
    message: { conversation: text },
    reply: noop,
    send: noop,
    sendReply: noop,
    sendMessage: noop,
    react: noop,
    edit: noop,
    forward: noop,
    delete: noop,
    download: async () => {
      const fs = require('fs');
      const path = require('path');
      const dummyPath = path.join(__dirname, 'dummy.jpg');
      if (!fs.existsSync(dummyPath)) {
        fs.writeFileSync(dummyPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
      }
      return dummyPath;
    },
    _isStale: false
  };
}

/**
 * Tek bir komutu test eder ve sonuç döndürür.
 */
async function testCommand(cmd, prefix, ownJid) {
  const key = makeKey(cmd.pattern);
  if (!key || isDangerous(key)) {
    return { key, result: { status: "skipped", ms: 0, lastRun: new Date().toISOString(), error: "Tehlikeli komut", runs: 0 } };
  }

  // Akıllı input üretici (Dummy args)
  let dummyArg = "";
  if (key.match(/insta|tiktok|fb|twitter|pinterest|youtube|ytvideo|video|şarkı|ytsesb|spotify/)) dummyArg = " https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  else if (key.match(/ara|hava|söz|vikipedi|çevir/)) dummyArg = " istanbul";
  else if (key.match(/test|ölç/)) dummyArg = " @11111111111";

  const text = prefix + key + dummyArg;
  const mock = createMockMsg(ownJid, text, cmd);
  const regex = new RegExp(String(cmd.pattern), "i");
  const match = (key + dummyArg).match(regex) || [key, dummyArg.trim()];

  const t0 = Date.now();
  try {
    if (process.env.DEBUG === "true") console.log(`[Self-Test] Running: ${key}`);

    await Promise.race([
      cmd.run(mock, match),
      new Promise((_, rej) => setTimeout(() => {
        mock._isStale = true;
        rej(new Error("timeout"));
      }, TIMEOUT_MS)),
    ]);
  
    return { key, result: { status: "ok", ms: Date.now() - t0, lastRun: new Date().toISOString(), error: null, runs: 1 } };
  } catch (err) {
    const isTimeout = err.message === "timeout";
    if (isTimeout) console.warn(`[Self-Test] Timeout: ${key}`);
    else console.warn(`[Self-Test] Hatası (${key}): ${err.message}`);
    return {
      key, result: {
        status: isTimeout ? "timeout" : "error",
        ms: Date.now() - t0,
        lastRun: new Date().toISOString(),
        error: err.message.slice(0, 120),
        runs: 1,
      }
    };
  }
}

async function runSelfTest(sock) {
  const { logger } = require("../config");
  const handler = require("./handler");

  process.env.IS_SELF_TEST = 'true';

  // 100% KALICI ÇÖZÜM: Devre dışı bırakma kontrolü
  if (process.env.SELF_TEST === "false") {
    logger.info("🧪 Self-test 'SELF_TEST=false' nedeniyle atlandı.");
    return;
  }

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

  if (!global.testProgress) global.testProgress = {};

  // Global Timeout: Test suite 180 saniyeyi (3dk) geçemez
  const GLOBAL_SUITE_TIMEOUT = 180000;
  const startTime = Date.now();
  let ok = 0, err = 0, skipped = 0, timeout = 0;
  let isSuiteTimedOut = false;

  for (let i = 0; i < queue.length; i += BATCH_SIZE) {
    if (Date.now() - startTime > GLOBAL_SUITE_TIMEOUT) {
      logger.warn(`🧪 Self-test GLOBAL ZAMAN AŞIMI (${GLOBAL_SUITE_TIMEOUT / 1000}sn). Kalan komutlar atlanıyor.`);
      isSuiteTimedOut = true;
      break;
    }

    const batch = queue.slice(i, i + BATCH_SIZE);
    const results = [];

    const batchResults = await Promise.allSettled(
      batch.map((cmd, j) => {
        const cmdIndex = i + j + 1;
        const cmdName = makeKey(cmd.pattern);

        // Sadece ilk komutu progress olarak göster ama hepsini çalıştır
        if (j === 0) {
          global.testProgress = {
            currentCommand: cmdName,
            currentIndex: cmdIndex,
            totalCommands: queue.length,
            status: 'testing'
          };
          process.emit('test_progress', global.testProgress);
        }

        return testCommand(cmd, prefix, ownJid);
      })
    );

    for (const res of batchResults) {
      if (res.status === 'fulfilled' && res.value) {
        results.push(res.value);
      }
    }

    if (i % 15 === 0) {
      process.emit('dashboard_activity', {
        time: new Date().toLocaleTimeString(),
        sender: 'Sistem',
        type: 'Heartbeat',
        content: `Test devam ediyor... (${Math.min(i + batch.length, queue.length)}/${queue.length})`,
        isGroup: false
      });
    }

    for (const r of results) {
      if (!r) continue;
      handler.recordStat(r.key, r.result.status, r.result.ms, r.result.error, true);
      if (r.result.status === "ok") ok++;
      else if (r.result.status === "error") err++;
      else if (r.result.status === "timeout") timeout++;
      else if (r.result.status === "skipped") skipped++;
    }

    if (i + BATCH_SIZE < queue.length) {
      await new Promise(res => setImmediate(res));
      await new Promise(res => setTimeout(res, BATCH_DELAY));
    }

    // Lifecycle Check: Eğer oturum kapatıldıysa veya yenilendiyse testi durdur
    if (!sock.ev) {
      logger.warn("🧪 Self-test: Socket bağlantısı koptuğu için test döngüsü durduruldu.");
      break;
    }
  }

  const report = isSuiteTimedOut
    ? `⚠️ Self-test yarıda kesildi (Zaman Aşımı) — ✅ ${ok} başarılı · ❌ ${err} hata · ⏱ ${timeout} zaman aşımı`
    : `🧪 Self-test tamamlandı — ✅ ${ok} başarılı · ❌ ${err} hata · ⏱ ${timeout} zaman aşımı · ⏭ ${skipped} atlandı`;

  logger.info(report);

  global.testProgress = {
    currentCommand: null,
    currentIndex: queue.length,
    totalCommands: queue.length,
    status: 'completed'
  };
  process.emit('test_progress', global.testProgress);

  process.env.IS_SELF_TEST = 'false';

  process.emit('dashboard_activity', {
    time: new Date().toLocaleTimeString(),
    sender: 'Sistem',
    type: 'Self-Test',
    content: isSuiteTimedOut ? `Self-test ZAMAN AŞIMINA uğradı. ${ok} BAŞARILI.` : `Self-test bitti: ${ok} BAŞARILI, ${err} HATA.`,
    isGroup: false
  });
}

module.exports = { runSelfTest };
