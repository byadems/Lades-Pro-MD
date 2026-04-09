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
const PORT = 3001;
const envPath = path.join(__dirname, "../config.env");

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
const MAX_LOGS = 100;
const MAX_ACTIVITY = 15;

let isParentReady = false;
process.on('message', (msg) => {
  if (msg.type === 'ready_to_login') {
    isParentReady = true;
  } else if (msg.type === 'log') {
    const logEntry = {
      time: new Date().toLocaleTimeString(),
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
    global.testProgress = msg.data;
  } else if (msg.type === 'reset_uptime') {
    dashboardStartTime = Date.now();
  } else if (msg.type === 'bot_status') {
    liveBotConnected = !!msg.data?.connected;
    liveBotPhone = msg.data?.phone || null;
  } else if (msg.type === 'qr') {
    generatedCodeOrQR = msg.qr;
    authConnectionStatus = 'generated';
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

app.get('/api/status', (req, res) => {
  const conf = getEnvConfig();
  const mem = process.memoryUsage();
  const hasLocalSession = fs.existsSync(path.join(__dirname, "../sessions/lades-session/creds.json"));
  const hasDashboardSession = fs.existsSync(path.join(__dirname, "../sessions/dashboard-auth/creds.json"));
  const hasDb = !!(conf.DATABASE_URL && conf.DATABASE_URL.trim());
  const hasStoredSession = hasLocalSession || hasDashboardSession || hasDb;

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

  // Use file-based detection when IPC is not available
  const connected = liveBotConnected || isRegistered;
  const phone = liveBotPhone || sessionPhone;
  
  // Load runtime stats
  const runtimeStats = loadRuntimeStats();

  res.json({
    bot: conf.BOT_NAME || "Lades-Pro-MD",
    botName: conf.BOT_NAME || "Lades-Pro-MD",
    hasSession: connected,
    connected: connected,
    hasStoredSession,
    hasDb,
    phone: phone,
    uptime: (Date.now() - dashboardStartTime) / 1000,
    memory: Math.round(mem.heapUsed / 1024 / 1024) + " MB",
    nodeVersion: process.version,
    // Runtime stats
    totalMessages: runtimeStats.totalMessages,
    totalCommands: runtimeStats.totalCommands,
    activeUsers: runtimeStats.activeUsers,
    managedGroups: runtimeStats.managedGroups
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
    process.send({ type: 'broadcast', data: { jid: jid || 'all', message, broadcastType: type || 'text' } });
    res.json({ success: true, message: "Duyuru sinyali gönderildi." });
  } else {
    res.status(500).json({ error: "Sistem bağlantısı kurulamadı." });
  }
});

// ─── Commands list ───────────────────────────────────────
const STATS_FILE = path.join(__dirname, '../sessions/cmd-stats.json');
const RUNTIME_STATS_FILE = path.join(__dirname, '../sessions/runtime-stats.json');

function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch { }
  return {};
}

function loadRuntimeStats() {
  try {
    if (fs.existsSync(RUNTIME_STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(RUNTIME_STATS_FILE, 'utf8'));
      return {
        totalMessages: data.totalMessages || 0,
        totalCommands: data.totalCommands || 0,
        activeUsers: Array.isArray(data.activeUsers) ? data.activeUsers.length : 0,
        managedGroups: Array.isArray(data.managedGroups) ? data.managedGroups.length : 0
      };
    }
  } catch { }
  return { totalMessages: 0, totalCommands: 0, activeUsers: 0, managedGroups: 0 };
}

app.get('/api/runtime-stats', (req, res) => {
  res.json(loadRuntimeStats());
});

app.get('/api/cmd-stats', (req, res) => {
  res.json(loadStats());
});

app.get('/api/commands', (req, res) => {
  try {
    const stats = loadStats();
    let allModules = [];
    let total = 0;
    
    // Read directly from the bot's exported commands!
    const activeCommandsPath = path.join(__dirname, '../sessions', 'active-commands.json');
    if (fs.existsSync(activeCommandsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(activeCommandsPath, 'utf8'));
        const commands = data.commands || [];
        
        // Merge stats with the accurate command list
        allModules = commands.map(cmd => {
          const stat = stats[cmd.statKey] || null;
          return {
            pattern: cmd.pattern,
            desc: cmd.desc,
            use: cmd.use,
            stat: stat
          };
        });
        total = data.total || allModules.length;
      } catch (err) {
        console.error("Error reading active-commands.json:", err.message);
      }
    }
    
    res.json({ commands: allModules, total: total });
  } catch (err) {
    res.json({ commands: [], total: 0 });
  }
});

// ─── Test Progress ───────────────────────────────────────
app.get('/api/test-progress', (req, res) => {
  const progress = global.testProgress || {
    currentCommand: null,
    currentIndex: 0,
    totalCommands: 0,
    status: 'idle'
  };
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

app.get('/api/auth/status', (req, res) => {
  res.json({ status: authConnectionStatus });
});

app.post('/api/auth/qr', async (req, res) => {
  try {
    generatedCodeOrQR = null;
    lastAuthError = null;
    await spawnSession(false, null, true);
    for (let i = 0; i < 30; i++) {
      if (authConnectionStatus === 'error') break;
      if (generatedCodeOrQR) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!generatedCodeOrQR) {
      return res.status(500).json({ error: lastAuthError || "Zaman Aşımı (Zayıf Bağlantı)" });
    }
    const qrDataUrl = await qrcode.toDataURL(generatedCodeOrQR, { color: { dark: '#000', light: '#FFF' } });
    res.json({ qr: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/pair', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Telefon numarası gerekli" });
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: "Numara formatı geçersiz. Ülke kodu ile birlikte girin (örn: 905xxxxxxxxx)." });
  }
  try {
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

    generatedCodeOrQR = null;
    lastAuthError = null;
    await spawnSession(true, normalizedPhone, true);
    for (let i = 0; i < 60; i++) {  // wait up to 60s
      if (authConnectionStatus === 'error') break;
      if (generatedCodeOrQR) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!generatedCodeOrQR) {
      return res.status(500).json({ error: lastAuthError || "Zaman Aşımı (Zayıf Bağlantı)" });
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
    activePairCode = generatedCodeOrQR;
    res.json({
      code: generatedCodeOrQR,
      phone: normalizedPhone,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      ttlMs,
      attempt: currentAttempt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
          generatedCodeOrQR = qr;
          authConnectionStatus = 'generated';
          console.log('✅ QR kodu üretildi!');
        } else if (!pairCodeRequested && phoneNumber) {
          pairCodeRequested = true;
          try {
            // Wait for connection to stabilize before requesting pairing code
            await new Promise(r => setTimeout(r, 3000));
            const code = await sock.requestPairingCode(phoneNumber);
            if (attemptToken !== authAttemptToken) return;
            generatedCodeOrQR = code || null;
            console.log(`📱 Eşleşme kodu üretildi: ${phoneNumber}`);
            if (generatedCodeOrQR) authConnectionStatus = 'generated';
          } catch (pairErr) {
            const statusCode = pairErr?.output?.statusCode || pairErr?.data?.statusCode;
            console.error(`Pair code hatası (${statusCode || 'bilinmiyor'}):`, pairErr.message);
            authConnectionStatus = 'error';
            lastAuthError = pairErr.message || 'Eşleşme kodu alınamadı.';
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
                lastAuthError = e.message;
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
          lastAuthError = statusCode === DisconnectReason.loggedOut
            ? 'Oturum kapatıldı.'
            : `Bağlantı kurulamadı (${statusCode || 'bilinmiyor'})`;
          currentSock = null;
        }
      }
    });

  } catch (err) {
    console.error('spawnSession hatası:', err.message);
    authConnectionStatus = 'error';
    lastAuthError = err.message || 'Oturum başlatılamadı.';
  }
}

app.listen(PORT, () => {
  console.log(`\n==========================================`);
  console.log(`🚀 Lades-PRO Kontrol Paneli aktif!`);
  console.log(`🌐 Adres: http://localhost:${PORT}`);
  console.log(`==========================================\n`);
});
