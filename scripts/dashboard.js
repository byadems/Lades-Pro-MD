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

let dashboardStartTime = Date.now();

app.use(express.static(path.join(__dirname, "../public")));
app.use(express.json());

function getEnvConfig() {
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const config = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.*)?\s*$/);
    if (match) config[match[1]] = match[2] || '';
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

process.on('message', (msg) => {
    if (msg.type === 'log') {
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
    } else if (msg.type === 'reset_uptime') {
        dashboardStartTime = Date.now();
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

app.get('/api/status', (req, res) => {
  const conf = getEnvConfig();
  const mem = process.memoryUsage();
  const hasLocalSession = fs.existsSync(path.join(__dirname, "../sessions/lades-session/creds.json"));
  
  res.json({
    bot: conf.BOT_NAME || "NexBot-MD",
    botName: conf.BOT_NAME || "NexBot-MD",
    hasSession: hasLocalSession || !!conf.DATABASE_URL,
    hasDb: !!conf.DATABASE_URL,
    uptime: (Date.now() - dashboardStartTime) / 1000,
    memory: Math.round(mem.heapUsed / 1024 / 1024) + " MB",
    nodeVersion: process.version
  });
});

app.get('/api/config', (req, res) => {
  const conf = getEnvConfig();
  res.json({
    BOT_NAME:       conf.BOT_NAME || '',
    OWNER_NUMBER:   conf.OWNER_NUMBER || '',
    PREFIX:         conf.PREFIX || '.',
    SUDO:           conf.SUDO || '',
    GEMINI_API_KEY: conf.GEMINI_API_KEY || '',
    PUBLIC_MODE:    conf.PUBLIC_MODE || 'false',
    AUTO_READ:      conf.AUTO_READ || 'false',
    AUTO_TYPING:    conf.AUTO_TYPING || 'true',
    ANTI_LINK:      conf.ANTI_LINK || 'false',
    ANTI_SPAM:      conf.ANTI_SPAM || 'false',
  });
});

app.get('/api/config/raw', (req, res) => {
  if (!fs.existsSync(envPath)) return res.type('text').send('(boş)');
  const content = fs.readFileSync(envPath, 'utf8');
  res.type('text').send(content);
});

app.post('/api/config', (req, res) => {
  const allowed = ['BOT_NAME', 'OWNER_NUMBER', 'PREFIX', 'SUDO', 'GEMINI_API_KEY',
    'PUBLIC_MODE', 'AUTO_READ', 'AUTO_TYPING', 'ANTI_LINK', 'ANTI_SPAM',
    'AUTO_RECORDING', 'REJECT_CALLS', 'WARN'];
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

function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch {}
  return {};
}

app.get('/api/cmd-stats', (req, res) => {
  res.json(loadStats());
});

app.get('/api/commands', (req, res) => {
  try {
    const stats = loadStats();
    const allModules = [];
    const pluginsDir = path.join(__dirname, '../plugins');
    const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js') && f !== 'utils');
    files.forEach(file => {
      try {
        const src = fs.readFileSync(path.join(pluginsDir, file), 'utf8');
          const matches = src.matchAll(/(?:Module|bot|System)\s*\(\s*\{([\s\S]*?)\}\s*,/g);
          for (const m of matches) {
            const block = m[1];
            const pattern = (block.match(/pattern\s*:\s*["'`]([^"'`]+)["'`]/) || [])[1];
            const desc    = (block.match(/desc\s*:\s*["'`]([^"'`]+)["'`]/) || [])[1];
            const use     = (block.match(/use\s*:\s*["'`]([^"'`]+)["'`]/) || [])[1];
            const type    = (block.match(/type\s*:\s*["'`]([^"'`]+)["'`]/) || [])[1];
            if (!pattern) continue;
            const cleanPattern = pattern.replace(/\\?\?.*$/, '').replace(/\s*\?.*$/, '').trim();
            if (!cleanPattern) continue;
            
            // Match stats key
            const statKey = cleanPattern.split(' ')[0].replace(/[^\wçğıöşüÇĞİÖŞÜ]/gi, '');
            const stat = stats[statKey] || null;
            allModules.push({ 
              pattern: cleanPattern, 
              desc: desc || '', 
              use: use || type || 'genel',
              stat  // { status, ms, lastRun, error, runs } or null
            });
          }
      } catch {}
    });
    res.json({ commands: allModules, total: allModules.length });
  } catch (err) {
    res.json({ commands: [], total: 0 });
  }
});

// ─── Bot controls ────────────────────────────────────────
app.post('/api/auth/restart', (req, res) => {
  res.json({ ok: true, message: 'Bot oturumu yenileniyor...' });
  if (process.send) process.send({ type: 'restart' });
  else setTimeout(() => process.exit(0), 500); 
});

app.post('/api/auth/stop', (req, res) => {
  res.json({ ok: true });
  // Signal the parent process to stop session
  if (process.send) process.send({ type: 'stop' });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ status: authConnectionStatus });
});

app.post('/api/auth/qr', async (req, res) => {
  try {
    generatedCodeOrQR = null;
    await spawnSession(false, null, true);
    for(let i=0; i<30; i++) {
       if (generatedCodeOrQR) break;
       await new Promise(r => setTimeout(r, 1000));
    }
    if (!generatedCodeOrQR) return res.status(500).json({error: "Zaman Aşımı (Zayıf Bağlantı)"});
    const qrDataUrl = await qrcode.toDataURL(generatedCodeOrQR, { color: { dark: '#000', light: '#FFF' } });
    res.json({ qr: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/pair', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Telefon numarası gerekli" });
  try {
    generatedCodeOrQR = null;
    await spawnSession(true, phone, true);
    for(let i=0; i<30; i++) {
       if (generatedCodeOrQR) break;
       await new Promise(r => setTimeout(r, 1000));
    }
    if (!generatedCodeOrQR) return res.status(500).json({error: "Zaman Aşımı (Zayıf Bağlantı)"});
    res.json({ code: generatedCodeOrQR });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function spawnSession(usePairing, phoneNumber, forceNew) {
  authConnectionStatus = 'connecting';
  try {
    const { makeWASocket, fetchLatestBaileysVersion, DisconnectReason, useMultiFileAuthState } = await import('@whiskeysockets/baileys');

    if (forceNew) {
      if (currentSock) {
        try { currentSock.ws.close(); } catch {}
        currentSock = null;
      }
      const sessionDir = path.join(__dirname, "../sessions/lades-session");
      if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
    }

    const sessionDir = path.join(__dirname, "../sessions/lades-session");
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
      version,
      logger,
      auth: state,
      printQRInTerminal: false,
      browser: ["NexBot-MD", "Chrome", "3.0.0"],
      syncFullHistory: false,
      connectTimeoutMs: 60000,
    });
    currentSock = sock;

    // Request pair code immediately if pairing mode
    if (usePairing && phoneNumber && !state.creds.registered) {
      try {
        await new Promise(r => setTimeout(r, 3000)); // let socket initialize
        const clean = phoneNumber.replace(/[^0-9]/g, '');
        const code = await sock.requestPairingCode(clean);
        generatedCodeOrQR = code ? (code.match(/.{1,4}/g)?.join('-') || code) : null;
        if (generatedCodeOrQR) authConnectionStatus = 'generated';
      } catch (pairErr) {
        console.error('Pairing code error:', pairErr.message);
        authConnectionStatus = 'error';
      }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr && !usePairing) {
        generatedCodeOrQR = qr;
        authConnectionStatus = 'generated';
      }

      if (connection === 'open') {
        authConnectionStatus = 'connected';
        generatedCodeOrQR = null;
        console.log('✅ Session connected successfully.');
        try { sock.logout(); } catch {}
        currentSock = null;
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode !== DisconnectReason.loggedOut && authConnectionStatus !== 'connected') {
          console.log('Socket closed, reconnecting...');
          spawnSession(usePairing, phoneNumber, false).catch(() => {});
        } else {
          if (authConnectionStatus !== 'connected') authConnectionStatus = 'error';
          currentSock = null;
        }
      }
    });

  } catch (err) {
    console.error('spawnSession error:', err.message);
    authConnectionStatus = 'error';
  }
}

app.listen(PORT, () => {
  console.log(`\n==========================================`);
  console.log(`🚀 Lades-MD Dashboard is running!`);
  console.log(`🌐 Open: http://localhost:${PORT}`);
  console.log(`==========================================\n`);
});
