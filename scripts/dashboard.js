"use strict";
/**
 * scripts/dashboard.js
 * Dashboard imitating robust BotManager logic
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3001;
const envPath = path.join(__dirname, "../config.env");
const { BotMetrik, KomutIstatistik, KomutKayit, KullaniciVeri, GrupAyar, WhatsappOturum } = require('../core/database');
const runtime = require('../core/runtime');

// Prevent Baileys unhandled promise rejections / connection timeouts from crashing the Dashboard
process.on('uncaughtException', err => {
  console.error('[Dashboard Error] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('[Dashboard Error] Unhandled Rejection:', reason?.message || reason);
});

let dashboardStartTime = Date.now();

app.use(express.static(path.join(__dirname, "../public")));
app.use(express.json());

// ─── Yönetici token doğrulaması ───────────────────────────
// ADMIN_SYNC_SECRET ayarlandıysa yıkıcı endpoint'ler bu tokeni zorunlu kılar.
const ADMIN_TOKEN = process.env.ADMIN_SYNC_SECRET || null;

function requireAdminToken(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ error: 'Bu endpoint devre dışı: ADMIN_SYNC_SECRET ortam değişkeni ayarlanmamış.' });
  }
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.body && req.body.secret);
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Yetkisiz: Geçersiz yönetici tokeni' });
  }
  next();
}

// Health check endpoint for Northflank/Docker
app.get('/health', (req, res) => res.json({ status: "ok", uptime: (Date.now() - dashboardStartTime) / 1000 }));

function normalizePhone(input) {
  const clean = String(input || '').replace(/[^0-9]/g, '');
  if (!clean || clean.length < 10 || clean.length > 15) return null;
  return clean;
}

function getEnvConfig() {
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const config = {};
  content.split('\n').forEach(line => {
    const clean = line.replace(/\r/g, '').trim();
    if (!clean || clean.startsWith('#')) return;
    const match = clean.match(/^([\w]+)\s*=\s*(.*)$/);
    if (!match) return;
    let value = match[2] || '';
    const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (!isQuoted) value = value.split('#')[0];
    config[match[1]] = value.trim();
  });
  return config;
}

function saveEnvConfig(updates) {
  if (!fs.existsSync(envPath)) fs.writeFileSync(envPath, "");
  let content = fs.readFileSync(envPath, 'utf8');
  for (const [key, val] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${val}`);
    } else {
      content += `\n${key}=${val}`;
    }
  }
  fs.writeFileSync(envPath, content);
}

// Log & Activity streaming logic
const logBuffer = [];
const activityBuffer = [];
const logClients = new Set();
const MAX_LOGS = 500;
const MAX_ACTIVITY = 50;

let isParentReady = false;
process.on('message', (msg) => {
  if (msg.type === 'ready_to_login') {
    isParentReady = true;
  } else if (msg.type === 'log') {
    const logEntry = {
      time: new Date().toLocaleTimeString('tr-TR', { hour12: false }),
      data: msg.data.replace(/\x1B\[[0-9;]*[mK]/g, '') // Strip ANSI codes for now
    };
    logBuffer.push(logEntry);
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();

    // Broadcast to all connected SSE clients
    const payload = `data: ${JSON.stringify(logEntry)}\n\n`;
    for (const client of logClients) client.res.write(payload);
  } else if (msg.type === 'metrics') {
    // Forward metrics to SSE clients with a flag
    const payload = `data: ${JSON.stringify({ isMetrics: true, ...msg.data })}\n\n`;
    for (const client of logClients) client.res.write(payload);
  } else if (msg.type === 'activity') {
    const actData = msg.data;
    activityBuffer.unshift(actData);
    if (activityBuffer.length > MAX_ACTIVITY) activityBuffer.pop();

    const payload = `data: ${JSON.stringify({ isActivity: true, ...actData })}\n\n`;
    for (const client of logClients) client.res.write(payload);
  } else if (msg.type === 'test_progress') {
    runtime.testProgress = msg.data;
  } else if (msg.type === 'reset_uptime') {
    dashboardStartTime = Date.now();
  } else if (msg.type === 'bot_status') {
    liveBotConnected = !!msg.data?.connected;
    liveBotPhone = msg.data?.phone || null;
  } else if (msg.type === 'qr') {
    authConnectionStatus = 'generated';
    setAuthOutcome(msg.qr);
  }

  // Handle IPC responses (for requestFromParent calls)
  if (msg && msg.requestId) {
    const pending = pendingRequests.get(msg.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRequests.delete(msg.requestId);
      if (msg.type === 'groups_result') {
        pending.resolve(msg.data || []);
      } else if (msg.type === 'group_pp_result') {
        pending.resolve({ imgUrl: msg.data?.imgUrl || null });
      } else if (msg.type === 'send_result') {
        if (msg.data && msg.data.success) pending.resolve(msg.data);
        else pending.reject(new Error(msg.data?.error || 'Gönderim hatası'));
      }
    }
  }
});

app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send history
  logBuffer.forEach(log => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  });

  // Send activity history (reverse order so oldest is prepended first, ending with actual newest at top)
  const reversedActivities = [...activityBuffer].reverse();
  reversedActivities.forEach(act => {
    res.write(`data: ${JSON.stringify({ isActivity: true, ...act })}\n\n`);
  });

  const client = { res };
  logClients.add(client);

  req.on('close', () => {
    logClients.delete(client);
    res.end();
  });
});


// Emulate store logic
let authConnectionStatus = 'idle';
let generatedCodeOrQR = null;
let currentSock = null;
let liveBotConnected = false;
let liveBotPhone = null;
let authAttemptToken = 0;
let lastAuthError = null;
let activePairMeta = null;
let activePairCode = null;
// CRITICAL FIX: Track pair-success reconnect (isNewLogin flag from Baileys)
let _isNewLoginPending = false;

// Event-based auth notifier — replaces 1s polling loops in /api/auth/qr & /api/auth/pair.
// Reduces auth response latency from up-to-1000ms to ~immediate.
const { EventEmitter } = require('events');
const authEvents = new EventEmitter();
authEvents.setMaxListeners(50);
// Concurrency guard: aynı anda yalnızca tek bir QR/Pair akışı.
// Paralel istek geldiğinde sonuçların birbirine karışmasını önler.
let _authInFlight = false;

function setAuthOutcome(value, errorMsg) {
  if (value !== undefined) generatedCodeOrQR = value;
  if (errorMsg !== undefined) lastAuthError = errorMsg;
  authEvents.emit('change');
}

function waitForAuthOutcome(timeoutMs) {
  return new Promise((resolve) => {
    if (generatedCodeOrQR) return resolve({ ok: true, value: generatedCodeOrQR });
    if (authConnectionStatus === 'error') return resolve({ ok: false, error: lastAuthError });
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      authEvents.off('change', onChange);
      resolve(result);
    };
    const onChange = () => {
      if (generatedCodeOrQR) finish({ ok: true, value: generatedCodeOrQR });
      else if (authConnectionStatus === 'error') finish({ ok: false, error: lastAuthError });
    };
    const timer = setTimeout(() => finish({ ok: false, error: lastAuthError || 'Zaman Aşımı (Zayıf Bağlantı)' }), timeoutMs);
    authEvents.on('change', onChange);
  });
}

app.get('/api/status', async (req, res) => {
  const conf = getEnvConfig();
  const mem = process.memoryUsage();
  const hasLocalSession = fs.existsSync(path.join(__dirname, "../sessions/lades-session/creds.json"));
  const hasDashboardSession = fs.existsSync(path.join(__dirname, "../sessions/dashboard-auth/creds.json"));
  const hasDb = !!(process.env.EXTERNAL_DB_URL);
  const hasStoredSession = hasLocalSession || hasDashboardSession || hasDb;

  // Runtime stats
  let totalMessages = 0;
  let totalCommands = 0;
  let activeUsers = 0;
  let managedGroups = 0;

  try {
    const [msgM, cmdM, uCount, gCount] = await Promise.all([
      BotMetrik.findByPk('total_messages'),
      BotMetrik.findByPk('total_commands'),
      require('../core/store').getTotalUserCount(),
      GrupAyar.count()
    ]);
    totalMessages = msgM ? parseInt(msgM.value) : 0;
    totalCommands = cmdM ? parseInt(cmdM.value) : 0;
    activeUsers = uCount;
    managedGroups = gCount;
  } catch (e) { /* fallback to 0 */ }

  // Check if creds.json has valid credentials (registered = true)
  let sessionPhone = null;
  let isRegistered = false;
  const sessionPaths = [
    path.join(__dirname, "../sessions/dashboard-auth/creds.json"),
    path.join(__dirname, "../sessions/lades-session/creds.json")
  ];
  
  for (const credPath of sessionPaths) {
    if (fs.existsSync(credPath)) {
      try {
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        if (creds.me && creds.me.id) {
          // Extract phone from me.id (format: 1234567890:123@s.whatsapp.net)
          const match = creds.me.id.match(/^(\d+)/);
          if (match) sessionPhone = match[1];
          isRegistered = creds.registered === true || !!creds.me;
          break;
        }
      } catch (e) { /* ignore */ }
    }
  }

  const connected = liveBotConnected;
  const phone = liveBotPhone || sessionPhone;

  const uptimeSec = (Date.now() - dashboardStartTime) / 1000;
  const memStr = Math.round(mem.heapUsed / 1024 / 1024) + " MB";

  res.json({
    bot: conf.BOT_NAME || "Lades-Pro",
    botName: conf.BOT_NAME || "Lades-Pro",
    hasSession: isRegistered,
    connected: connected,
    hasStoredSession: hasStoredSession,
    hasDb,
    phone: phone,
    uptime: uptimeSec,
    memory: memStr,
    nodeVersion: process.version,
    // Runtime stats
    totalMessages,
    totalCommands,
    activeUsers,
    managedGroups
  });
});

app.get('/api/config', (req, res) => {
  const conf = getEnvConfig();
  res.json({
    // Identity & Core
    BOT_NAME: conf.BOT_NAME || 'Lades-Pro',
    OWNER_NUMBER: conf.OWNER_NUMBER || '',
    PREFIX: conf.PREFIX || '.',
    SUDO: conf.SUDO || '',
    LANG: conf.LANG || 'turkish',
    ALIVE: conf.ALIVE || '',
    BOT_INFO: conf.BOT_INFO || 'Lades-Pro;Lades Yönetimi;',
    STICKER_DATA: conf.STICKER_DATA || 'Lades-Pro;Lades-Pro;😂',

    // Features (Toggles)
    PUBLIC_MODE: conf.PUBLIC_MODE || 'true',
    AUTO_READ: conf.AUTO_READ || 'false',
    AUTO_TYPING: conf.AUTO_TYPING || 'true',
    AUTO_RECORDING: conf.AUTO_RECORDING || 'true',
    ANTI_LINK: conf.ANTI_LINK || 'false',
    ANTI_SPAM: conf.ANTI_SPAM || 'false',
    ADMIN_ACCESS: conf.ADMIN_ACCESS || 'true',

    // AI & External APIs
    GEMINI_API_KEY: conf.GEMINI_API_KEY || '',
    OPENAI_API_KEY: conf.OPENAI_API_KEY || '',
    GROQ_API_KEY: conf.GROQ_API_KEY || '',
    AI_MODEL: conf.AI_MODEL || 'gemini',
    ACR_A: conf.ACR_A || '',
    ACR_S: conf.ACR_S || '',

    // Advanced / Internal
    MAX_STICKER_SIZE: conf.MAX_STICKER_SIZE || '2',
    MAX_DL_SIZE: conf.MAX_DL_SIZE || '50',
    PM2_RESTART_LIMIT_MB: conf.PM2_RESTART_LIMIT_MB || '450',
    DEBUG: conf.DEBUG || 'false',
  });
});

app.get('/api/config/raw', (req, res) => {
  if (!fs.existsSync(envPath)) return res.type('text').send('(boş)');
  const content = fs.readFileSync(envPath, 'utf8');
  res.type('text').send(content);
});

app.post('/api/config', (req, res) => {
  const allowed = [
    'BOT_NAME', 'OWNER_NUMBER', 'PREFIX', 'SUDO', 'LANG', 'ALIVE', 'BOT_INFO', 'STICKER_DATA',
    'PUBLIC_MODE', 'AUTO_READ', 'AUTO_TYPING', 'AUTO_RECORDING', 'ANTI_LINK', 'ANTI_SPAM', 'ADMIN_ACCESS',
    'GEMINI_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'AI_MODEL', 'ACR_A', 'ACR_S',
    'MAX_STICKER_SIZE', 'MAX_DL_SIZE', 'PM2_RESTART_LIMIT_MB', 'DEBUG'
  ];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  saveEnvConfig(updates);
  res.json({ success: true });
});

// ─── Plugins management ──────────────────────────────────
app.get('/api/plugins', (req, res) => {
  try {
    const pluginsDir = path.join(__dirname, '../plugins');
    if (!fs.existsSync(pluginsDir)) {
      return res.status(404).json({ success: false, error: "Plugins dizini bulunamadı." });
    }
    const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js') || f.endsWith('.bak'));
    const pluginList = files.map(file => {
      const isBak = file.endsWith('.bak');
      const name = file.replace(/\.(js|bak)$/, '');
      let desc = 'Eklenti açıklaması bulunamadı';
      try {
        const filePath = path.join(pluginsDir, file);
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          const src = fs.readFileSync(filePath, 'utf8');
          const match = src.match(/desc\s*:\s*["'`]([^"'`]+)["'`]/);
          if (match) desc = match[1];
        }
      } catch (e) {
        console.error(`Error reading plugin ${file}:`, e.message);
      }
      return { id: file, name, desc, active: !isBak };
    });
    res.json({ success: true, plugins: pluginList });
  } catch (err) {
    console.error('API Plugins Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/plugins/toggle', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "Eklenti ID gerekli" });
  try {
    const pluginsDir = path.join(__dirname, '../plugins');
    const oldPath = path.join(pluginsDir, id);
    const isBak = id.endsWith('.bak');
    const newId = isBak ? id.replace(/\.bak$/, '.js') : id.replace(/\.js$/, '.bak');
    const newPath = path.join(pluginsDir, newId);

    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, newPath);
      res.json({ success: true, newId, active: isBak });
      // We don't exit here, the bot will pick up changes if it has a watcher or on restart
    } else {
      res.status(404).json({ error: "Eklenti bulunamadı" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Broadcast / Dispatch ────────────────────────────────
app.post('/api/system/broadcast', (req, res) => {
  const { jid, message, type } = req.body;
  if (!message) return res.status(400).json({ error: "Mesaj boş olamaz" });

  // Forward broadcast request to parent process
  if (process.send) {
    process.send({ 
      type: 'broadcast', 
      data: { 
        jid: jid || 'all', 
        message, 
        broadcastType: type || 'text' 
      } 
    });
    res.json({ success: true, message: "Duyuru sinyali gönderildi." });
  } else {
    res.status(500).json({ error: "Sistem bağlantısı kurulamadı." });
  }
});

// ─── Commands list ───────────────────────────────────────
async function loadStats() {
  try {
    const rows = await KomutIstatistik.findAll();
    const stats = {};
    rows.forEach(r => {
      stats[r.pattern] = {
        status: r.status,
        ms: r.avgMs,
        lastRun: r.lastRun,
        error: r.lastError,
        runs: r.runs
      };
    });
    return stats;
  } catch { return {}; }
}

async function loadRuntimeStats() {
  try {
    const [msgM, cmdM, uCount, gCount] = await Promise.all([
      BotMetrik.findByPk('total_messages'),
      BotMetrik.findByPk('total_commands'),
      KullaniciVeri.count(),
      GrupAyar.count()
    ]);
    return {
      totalMessages: msgM ? parseInt(msgM.value) : 0,
      totalCommands: cmdM ? parseInt(cmdM.value) : 0,
      activeUsers: uCount,
      managedGroups: gCount
    };
  } catch { return { totalMessages: 0, totalCommands: 0, activeUsers: 0, managedGroups: 0 }; }
}

app.get('/api/runtime-stats', async (req, res) => {
  res.json(await loadRuntimeStats());
});

app.get('/api/cmd-stats', async (req, res) => {
  res.json(await loadStats());
});

app.get('/api/commands', async (req, res) => {
  try {
    const stats = await loadStats();
    
    // SQL tabanlı registry'den komutları çek
    const commands = await KomutKayit.findAll();
    
    const allModules = commands.map(cmd => {
      const stat = stats[cmd.statKey] || null;
      return {
        pattern: cmd.pattern,
        desc: cmd.description,
        use: cmd.usage,
        stat: stat
      };
    });
    
    res.json({ commands: allModules, total: allModules.length });
  } catch (err) {
    console.error("API Commands Error:", err.message);
    res.json({ commands: [], total: 0 });
  }
});

// ─── Test Progress ───────────────────────────────────────
app.get('/api/test-progress', (req, res) => {
  const progress = runtime.testProgress;
  res.json(progress);
});

// ─── Bot controls ────────────────────────────────────────
app.post('/api/auth/restart', (req, res) => {
  const { type } = req.body;
  res.json({ ok: true, message: type === 'system' ? 'Sistem yeniden başlatılıyor...' : 'Bot oturumu yenileniyor...' });
  if (process.send) process.send({ type: 'restart', restartType: type || 'session' });
  else setTimeout(() => process.exit(0), 500);
});

app.post('/api/auth/stop', (req, res) => {
  res.json({ ok: true });
  if (process.send) process.send({ type: 'stop', isLogout: true });
});

app.post('/api/force-repair', requireAdminToken, async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const deletedCount = await WhatsappOturum.destroy({
      where: { sessionId: { [Op.like]: 'lades-session%' } }
    });
    console.log(`[Force-Repair] ${deletedCount} oturum kaydı silindi. Yeniden eşleştirme tetikleniyor...`);
    res.json({ ok: true, deleted: deletedCount, msg: 'Oturum temizlendi. QR kodu bekleniyor...' });
    if (process.send) process.send({ type: 'force-repair' });
  } catch (e) {
    console.error('[Force-Repair] Hata:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/auth/status', (req, res) => {
  res.json({ status: authConnectionStatus });
});

app.post('/api/auth/qr', async (req, res) => {
  if (_authInFlight) {
    return res.status(409).json({ error: "Başka bir bağlanma işlemi sürüyor. Lütfen bitmesini bekleyin veya /api/auth/cancel deneyin." });
  }
  _authInFlight = true;
  try {
    generatedCodeOrQR = null;
    lastAuthError = null;
    await spawnSession(false, null, true);
    const outcome = await waitForAuthOutcome(30000);
    if (!outcome.ok) {
      return res.status(500).json({ error: outcome.error || "Zaman Aşımı (Zayıf Bağlantı)" });
    }
    const qrDataUrl = await qrcode.toDataURL(outcome.value, { color: { dark: '#000', light: '#FFF' } });
    res.json({ qr: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    _authInFlight = false;
  }
});

app.post('/api/auth/pair', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Telefon numarası gerekli" });
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: "Numara formatı geçersiz. Ülke kodu ile birlikte girin (örn: 905xxxxxxxxx)." });
  }

  // Reuse-aktif kod kontrolü _authInFlight'tan ÖNCE yapılır:
  // başka istek sürerken bile aynı telefona aktif kod varsa onu döndürebilelim.
  const now = Date.now();
  if (activePairMeta && activePairCode && activePairMeta.expiresAt > now) {
    if (activePairMeta.phone === normalizedPhone) {
      return res.json({
        code: activePairCode,
        phone: activePairMeta.phone,
        issuedAt: activePairMeta.issuedAt,
        expiresAt: activePairMeta.expiresAt,
        ttlMs: activePairMeta.expiresAt - activePairMeta.issuedAt,
        attempt: activePairMeta.attempt,
        reused: true
      });
    }
    return res.status(429).json({
      error: `Aktif bir kod zaten var (+${activePairMeta.phone}). Yeni kod için ${Math.ceil((activePairMeta.expiresAt - now) / 1000)}sn bekleyin.`
    });
  }

  if (_authInFlight) {
    return res.status(409).json({ error: "Başka bir bağlanma işlemi sürüyor. Lütfen birkaç saniye bekleyip tekrar deneyin." });
  }
  _authInFlight = true;
  try {
    generatedCodeOrQR = null;
    lastAuthError = null;
    await spawnSession(true, normalizedPhone, true);
    const outcome = await waitForAuthOutcome(60000);
    if (!outcome.ok) {
      return res.status(500).json({ error: outcome.error || "Zaman Aşımı (Zayıf Bağlantı)" });
    }
    const issuedAt = Date.now();
    const ttlMs = 120000; // 2 minutes - enough time to enter the code
    const currentAttempt = authAttemptToken;
    activePairMeta = {
      phone: normalizedPhone,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      attempt: currentAttempt
    };
    activePairCode = outcome.value;
    res.json({
      code: outcome.value,
      phone: normalizedPhone,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      ttlMs,
      attempt: currentAttempt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    _authInFlight = false;
  }
});

app.get('/api/auth/pair-meta', (req, res) => {
  res.json({
    status: authConnectionStatus,
    currentAttempt: authAttemptToken,
    meta: activePairMeta
  });
});

let authRetryCount = 0;
async function spawnSession(usePairing, phoneNumber, forceNew) {
  authConnectionStatus = 'connecting';
  if (forceNew) authRetryCount = 0;
  const attemptToken = ++authAttemptToken;
  try {
    const { makeWASocket, fetchLatestBaileysVersion, DisconnectReason, Browsers, useMultiFileAuthState } = await import('@whiskeysockets/baileys');
    const config = getEnvConfig();

    if (forceNew) {
      isParentReady = false;
      if (currentSock) {
        try { currentSock.ws.close(); } catch { }
        currentSock = null;
      }
      if (process.send) {
        process.send({ type: 'stop', isLogout: false });
        console.log('⏳ Ana bot durdurma sinyali gönderildi. Onay bekleniyor...');
        for (let i = 0; i < 20; i++) {
          if (isParentReady) break;
          await new Promise(r => setTimeout(r, 500));
        }
        if (!isParentReady) {
          console.warn('⚠️ Ana bot onay sinyali gelmedi, devam ediliyor...');
        }
        // Extra delay to ensure main bot's socket is fully closed
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    generatedCodeOrQR = null;

    // CRITICAL FIX: Use an ISOLATED session directory for dashboard auth.
    // This prevents race conditions with the main bot's DB session.
    const dashAuthDir = path.join(__dirname, '../sessions/dashboard-auth');
    if (!fs.existsSync(dashAuthDir)) fs.mkdirSync(dashAuthDir, { recursive: true });

    // If forceNew, clear the dashboard auth dir to ensure fresh start
    if (forceNew) {
      try {
        const files = fs.readdirSync(dashAuthDir);
        for (const f of files) fs.unlinkSync(path.join(dashAuthDir, f));
        console.log('🗑️ Dashboard auth dizini temizlendi (taze başlangıç)');
      } catch (e) { /* ignore */ }
    }

    const { state, saveCreds } = await useMultiFileAuthState(dashAuthDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));
    const logger = pino({ level: 'info' });

    const sock = makeWASocket({
      version,
      logger,
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
    });
    currentSock = sock;
    sock.ev.on('creds.update', saveCreds);

    let pairCodeRequested = false;
    _isNewLoginPending = false; // Reset on each new session spawn

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;
      if (attemptToken !== authAttemptToken) return; // Stale attempt, ignore

      // CRITICAL FIX: When WhatsApp confirms pairing (pair-success),
      // Baileys emits isNewLogin:true and then WA intentionally closes the socket.
      // We MUST reconnect with the saved creds to complete authentication.
      if (isNewLogin) {
        _isNewLoginPending = true;
        authConnectionStatus = 'pairing_success';
        console.log('✅ Eşleşme onaylandı (isNewLogin)! WA yeniden bağlanmayı bekliyor...');
      }

      if (qr) {
        if (!usePairing) {
          authConnectionStatus = 'generated';
          setAuthOutcome(qr);
          console.log('✅ QR kodu üretildi!');
        } else if (!pairCodeRequested && phoneNumber) {
          pairCodeRequested = true;
          try {
            // Wait for connection to stabilize before requesting pairing code
            await new Promise(r => setTimeout(r, 3000));
            const code = await sock.requestPairingCode(phoneNumber);
            if (attemptToken !== authAttemptToken) return;
            console.log(`📱 Eşleşme kodu üretildi: ${phoneNumber}`);
            if (code) authConnectionStatus = 'generated';
            setAuthOutcome(code || null);
          } catch (pairErr) {
            const statusCode = pairErr?.output?.statusCode || pairErr?.data?.statusCode;
            console.error(`Pair code hatası (${statusCode || 'bilinmiyor'}):`, pairErr.message);
            authConnectionStatus = 'error';
            setAuthOutcome(undefined, pairErr.message || 'Eşleşme kodu alınamadı.');
          }
        }
      }

      if (connection === 'open') {
        // Capture the flag BEFORE clearing it, to determine correct handover delay
        const wasNewLoginReconnect = _isNewLoginPending;
        _isNewLoginPending = false;
        authConnectionStatus = 'connected';
        generatedCodeOrQR = null;
        activePairCode = null;
        activePairMeta = null;
        authRetryCount = 0;

        // Delay logic:
        // - wasNewLoginReconnect=true → This is the second connection after pair-success.
        //   PreKey upload was already done on the FIRST connection. Short delay is fine (8s).
        // - wasNewLoginReconnect=false AND usePairing=true → This is the FIRST pair-code login.
        //   WhatsApp needs up to 35s to complete initial PreKey upload + session sync.
        // - QR login → 10s is enough.
        const handoverDelay = wasNewLoginReconnect ? 8000 : (usePairing ? 35000 : 10000);
        console.log(`✅ Oturum açıldı! ${handoverDelay / 1000}sn bekleyip ana bota aktarılacak (WA senkronizasyonu için)...`);

        setTimeout(() => {
          if (attemptToken !== authAttemptToken) return; // Handle stale attempts
          console.log('🔄 Ana bota aktarılıyor...');
          try { if (currentSock) currentSock.ws.close(); } catch { }
          currentSock = null;
          if (process.send) {
            process.send({ type: 'dashboard_login_complete', authDir: path.join(__dirname, '../sessions/dashboard-auth') });
          }
        }, handoverDelay);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || '';
        console.log(`🔌 Dashboard soketi kapandı. Durum: ${statusCode || 'bilinmiyor'} | isNewLoginPending: ${_isNewLoginPending}`);

        // CRITICAL FIX: After pair-success, WhatsApp intentionally closes the socket
        // and expects a fresh reconnect with the updated credentials (creds.me is now set).
        // This MUST happen before the shouldRetry check which was blocking this path.
        if (_isNewLoginPending) {
          _isNewLoginPending = false;
          console.log('🔑 Eşleşme sonrası zorunlu yeniden bağlantı başlatılıyor (pair-success reconnect)...');
          authConnectionStatus = 'connecting';
          // Small delay to ensure saveCreds has flushed to disk
          setTimeout(() => {
            if (attemptToken === authAttemptToken) {
              // Reconnect WITHOUT pairing (creds.me is now set, WA will use generateLoginNode)
              spawnSession(false, null, false).catch(e => {
                console.error('Pair reconnect hatası:', e.message);
                authConnectionStatus = 'error';
                setAuthOutcome(undefined, e.message);
              });
            }
          }, 1500);
          return;
        }

        const shouldRetry = statusCode !== DisconnectReason.loggedOut
          && authConnectionStatus !== 'connected'
          && authConnectionStatus !== 'pairing_success'
          && authConnectionStatus !== 'generated'; // Don't retry if QR/code was shown (user hasn't acted yet)

        if (shouldRetry && authRetryCount < 3) {
          authRetryCount++;
          const delay = authRetryCount * 5000; // 5s, 10s, 15s backoff
          console.log(`🔁 ${delay}ms sonra tekrar denenecek... (${authRetryCount}/3)`);
          setTimeout(() => {
            if (attemptToken === authAttemptToken) {
              spawnSession(usePairing, phoneNumber, false).catch(e => console.error('Retry error:', e.message));
            }
          }, delay);
        } else if (authConnectionStatus !== 'connected' && authConnectionStatus !== 'pairing_success' && authConnectionStatus !== 'generated') {
          authConnectionStatus = 'error';
          const errMsg = statusCode === DisconnectReason.loggedOut
            ? 'Oturum kapatıldı.'
            : `Bağlantı kurulamadı (${statusCode || 'bilinmiyor'})`;
          setAuthOutcome(undefined, errMsg);
          currentSock = null;
        }
      }
    });

  } catch (err) {
    console.error('spawnSession hatası:', err.message);
    authConnectionStatus = 'error';
    setAuthOutcome(undefined, err.message || 'Oturum başlatılamadı.');
  }
}

// ─── AI Komut Üretici: FastAPI'de Gemini 3 Flash ile çalışır ─────
// /api/ai/generate-command ve /api/ai/save-command 
// artık FastAPI (port 8001) tarafından işleniyor.

// ─── Uzak Komut Çalıştırma (Remote Command Execution) ─────

// IPC promise helpers for requesting data from parent bot process
const pendingRequests = new Map();
let requestIdCounter = 0;

function requestFromParent(type, data = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const requestId = ++requestIdCounter;
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Zaman aşımı'));
    }, timeoutMs);
    pendingRequests.set(requestId, { resolve, reject, timer });
    if (process.send) {
      process.send({ type, requestId, data });
    } else {
      clearTimeout(timer);
      pendingRequests.delete(requestId);
      reject(new Error('IPC bağlantısı yok'));
    }
  });
}

app.get('/api/groups', async (req, res) => {
  try {
    const groups = await requestFromParent('fetch_groups');
    // Cache for future use
    const groupCachePath = path.join(__dirname, '../sessions/group-cache.json');
    fs.writeFileSync(groupCachePath, JSON.stringify(groups, null, 2));
    res.json({ success: true, groups });
  } catch (e) {
    // Fallback to cache
    const groupCachePath = path.join(__dirname, '../sessions/group-cache.json');
    let cachedGroups = [];
    if (fs.existsSync(groupCachePath)) {
      try { cachedGroups = JSON.parse(fs.readFileSync(groupCachePath, 'utf8')); } catch {}
    }
    res.json({ success: true, groups: cachedGroups, cached: true });
  }
});

app.get('/api/group-pp', async (req, res) => {
  const { jid } = req.query;
  if (!jid) return res.status(400).json({ error: "JID gerekli" });
  try {
    const result = await requestFromParent('fetch_group_pp', { jid });
    res.json({ success: true, imgUrl: result.imgUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/execute-command', async (req, res) => {
  const { groupJid, command } = req.body;
  if (!groupJid || !command) return res.status(400).json({ error: "Grup JID ve komut gerekli" });

  try {
    console.log(`[Panel API] Komut talebi: "${command}" -> ${groupJid}`);
    const result = await requestFromParent('execute_command', { jid: groupJid, command });
    
    if (result && result.success) {
      res.json({ success: true, message: `"${command}" komutu bot içinde yürütüldü.` });
    } else {
      const errMsg = result ? (result.error || 'Bilinmeyen hata') : 'Bot cevap vermedi (IPC Zaman Aşımı)';
      res.status(500).json({ error: errMsg });
    }
  } catch (e) {
    console.error(`[Panel API Error] /api/execute-command:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/remote-command', async (req, res) => {
  const { groupJid, command } = req.body;
  if (!groupJid || !command) return res.status(400).json({ error: "Grup JID ve komut gerekli" });

  try {
    await requestFromParent('send_to_chat', { jid: groupJid, text: command });
    res.json({ success: true, message: `"${command}" komutu ${groupJid} hedefine gönderildi.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/send-message', async (req, res) => {
  const { jid, text } = req.body;
  if (!jid || !text) return res.status(400).json({ error: "JID ve mesaj gerekli" });

  try {
    await requestFromParent('send_to_chat', { jid, text });
    res.json({ success: true, message: 'Mesaj gönderildi.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Yeni Komut Listesi (Kategorize) ─────────────────────
app.get('/api/commands/categorized', (req, res) => {
  try {
    const stats = loadStats();
    const pluginsDir = path.join(__dirname, '../plugins');
    const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js') && f !== 'utils');
    const categories = {};

    files.forEach(file => {
      try {
        const src = fs.readFileSync(path.join(pluginsDir, file), 'utf8');
        const matches = src.matchAll(/(?:Module|bot|System)\s*\(\s*\{([\s\S]*?)\}\s*,/g);
        for (const m of matches) {
          const block = m[1];
          const pattern = (block.match(/pattern\s*:\s*["'`]([^"'`]+)["'`]/) || [])[1];
          const desc = (block.match(/desc\s*:\s*["'`]([^"'`]+)["'`]/) || [])[1] || '';
          const usage = (block.match(/usage\s*:\s*["'`]([^"'`]+)["'`]/) || [])[1] || '';
          const use = (block.match(/use\s*:\s*["'`]([^"'`]+)["'`]/) || [])[1];
          const type = (block.match(/type\s*:\s*["'`]([^"'`]+)["'`]/) || [])[1];
          if (!pattern) continue;

          let cleanPattern = (pattern || "").trim()
            .replace(/^\(\?:\s*([^)]*)\)/, '$1')
            .replace(/\|/g, " / ")
            .split(" ?")[0]
            .trim();
          if (!cleanPattern) continue;

          const category = use || type || 'genel';
          if (!categories[category]) categories[category] = [];
          categories[category].push({
            command: cleanPattern,
            desc,
            usage,
            source: file
          });
        }
      } catch { }
    });

    res.json({ success: true, categories, totalCategories: Object.keys(categories).length });
  } catch (err) {
    res.json({ success: true, categories: {}, totalCategories: 0 });
  }
});

app.listen(PORT, () => {
  console.log(`\n==========================================`);
  console.log(`🚀 Lades-PRO Kontrol Paneli aktif!`);
  console.log(`🌐 Adres: http://localhost:${PORT}`);
  console.log(`==========================================\n`);
});
