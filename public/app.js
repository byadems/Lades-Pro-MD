'use strict';

// ══════════════════════════════
//  STATE
// ══════════════════════════════
const S = {
  logs: [], logTotal: 0, activeFilter: 'all',
  autoScroll: true, newLogs: 0,
  stats: { messages: 0, commands: 0, users: 0, groups: 0 },
  activity: [],
  commands: [],
  plugins: [],
  ramHistory: [],
  chart: null,
  testProgressPoll: null,
};
let es = null;
let pairCountdownTimer = null;

// ══════════════════════════════
//  NAVIGATION
// ══════════════════════════════
function setupNav() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('mobileOverlay');

  const cleanupActiveIntervals = () => {
    if (S.testProgressPoll) { clearInterval(S.testProgressPoll); S.testProgressPoll = null; }
    if (pairCountdownTimer) { clearInterval(pairCountdownTimer); pairCountdownTimer = null; }
    if (pollT) { clearInterval(pollT); pollT = null; }
  };

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      cleanupActiveIntervals();
      const page = btn.dataset.page;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById(`page-${page}`)?.classList.add('active');

      if (sidebar && overlay) {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('active');
      }
      if (page === 'terminal') {
        S.newLogs = 0;
        updateTermBadge();
        setTimeout(() => {
          const body = document.getElementById('termBody');
          if (body) body.scrollTop = body.scrollHeight;
        }, 50);
      }
      if (page === 'komutlar') loadCommands();
      if (page === 'ayarlar') { fetchConfig(); loadEnvPreview(); }
      if (page === 'plugins') loadPlugins();
      if (page === 'stats') initChart();
    });
  });
}

// ══════════════════════════════
//  CONNECTION TABS
// ══════════════════════════════
function setupConnTabs() {
  document.querySelectorAll('.conn-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.conn-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.conn-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`ctab-${tab.dataset.ctab}`)?.classList.add('active');
    });
  });
}

// ══════════════════════════════
//  MOBILE MENU
// ══════════════════════════════
function setupMobileMenu() {
  const btn = document.getElementById('mobileMenuBtn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('mobileOverlay');

  if (btn && sidebar && overlay) {
    btn.addEventListener('click', () => {
      sidebar.classList.add('mobile-open');
      overlay.classList.add('active');
    });

    overlay.addEventListener('click', () => {
      sidebar.classList.remove('mobile-open');
      overlay.classList.remove('active');
    });
  }
}

// ══════════════════════════════
//  STATUS POLLING
// ══════════════════════════════
async function fetchStatus() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    const online = typeof d.connected === 'boolean' ? d.connected : d.hasSession;

    // Hero card
    const hero = document.getElementById('heroCard');
    if (hero) hero.className = `hero-card${online ? ' online' : ''}`;
    setText('heroTitle', online ? 'Sistem Aktif' : 'Sistem Çevrimdışı');
    const badge = document.getElementById('heroBadge');
    if (badge) { badge.className = `hero-badge ${online ? 'online' : 'offline'}`; badge.textContent = online ? '● Bağlı' : '● Bağlı Değil'; }
    setText('heroPhone', d.phone || (online ? 'Bağlı' : 'Bağlı değil'));
    setText('heroUptime', formatUptime(d.uptime || 0));
    setText('heroRam', d.memory || '--');
    setText('heroNode', d.nodeVersion || '--');

    // Sidebar
    const dot = document.getElementById('sidebarDot');
    if (dot) dot.className = `bsc-indicator${online ? ' online' : ''}`;
    setText('sidebarStatus', online ? 'Bağlı' : 'Bağlı Değil');

    // Connection page
    const csBadge = document.getElementById('csStatus');
    if (csBadge) { csBadge.className = `cs-badge ${online ? 'green' : 'red'}`; csBadge.textContent = online ? 'BAĞLI' : 'BAĞLI DEĞİL'; }
    setText('csName', d.botName || '--');
    setText('csPhone', d.phone || '--');
    setText('csSession', d.hasDb ? 'PostgreSQL' : 'Yerel Dosya');

    // Conn visual: update icon
    const heroIcon = document.getElementById('heroIcon');
    if (heroIcon) heroIcon.querySelector('svg')?.setAttribute('stroke', online ? 'currentColor' : 'currentColor');

  } catch { }
}

// ══════════════════════════════
//  AUTH
// ══════════════════════════════
function setupAuth() {
  document.getElementById('btnQR')?.addEventListener('click', () => startQR());
  document.getElementById('btnPair')?.addEventListener('click', () => {
    const tel = document.getElementById('phoneInput')?.value?.trim();
    if (!tel) return toast('Lütfen telefon numarasını girin.', 'error');
    startPair(tel);
  });

  // Controls
  document.getElementById('btnStart')?.addEventListener('click', () => startQR());
  document.getElementById('btnRestartSession')?.addEventListener('click', async () => {
    try {
      toast('WhatsApp bağlantısı yenileniyor...', 'info');
      await fetch('/api/auth/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'session' })
      });
    } catch { toast('İşlem başarısız.', 'error'); }
  });
  document.getElementById('btnRestartSystem')?.addEventListener('click', async () => {
    try {
      toast('Tüm sistem yeniden başlatılıyor (Phoenix)...', 'warn');
      await fetch('/api/auth/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'system' })
      });
    } catch { toast('Bağlantı hatası.', 'error'); }
  });
  document.getElementById('btnStop')?.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/stop', { method: 'POST' });
      toast('Oturum sonlandırıldı.', 'info');
    } catch { toast('İşlem başarısız.', 'error'); }
  });
}

async function startQR() {
  const visual = document.getElementById('qrVisual');
  if (!visual) return;
  visual.innerHTML = `<div style="text-align:center;color:var(--text3)">
    <div style="font-size:24px;margin-bottom:8px">⌛</div>
    <div style="font-size:13px">QR Kod hazırlanıyor…</div>
  </div>`;
  try {
    const r = await fetch('/api/auth/qr', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Hata');
    visual.innerHTML = `<img src="${d.qr}" alt="QR" style="max-width:200px;border-radius:8px;box-shadow:0 0 40px rgba(37,211,102,.2)">`;
    pollAuth();
  } catch (e) {
    visual.innerHTML = `<div style="color:var(--red);text-align:center;padding:20px;font-size:13px">❌ ${e.message}</div>`;
  }
}

async function startPair(phone) {
  const disp = document.getElementById('pairDisplay');
  const btn = document.getElementById('btnPair');
  const lockBtn = (locked) => {
    if (!btn) return;
    btn.disabled = locked;
    btn.style.opacity = locked ? '0.65' : '1';
  };
  if (disp) { disp.classList.remove('hidden'); disp.innerHTML = '<div style="color:var(--text3);font-size:13px">⌛ Kod alınıyor…</div>'; }
  if (pairCountdownTimer) {
    clearInterval(pairCountdownTimer);
    pairCountdownTimer = null;
  }
  lockBtn(true);
  try {
    const r = await fetch('/api/auth/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Hata');
    const renderPairInfo = () => {
      if (!disp) return;
      const now = Date.now();
      const leftMs = Math.max(0, (d.expiresAt || now) - now);
      const leftSec = Math.ceil(leftMs / 1000);
      const expired = leftSec <= 0;
      const safePhone = esc(d.phone || phone);
      disp.innerHTML = `<h2>${d.code}</h2><p>WhatsApp → Telefon Numarasıyla Bağla → Bu kodu girin</p><p style="font-size:12px;color:var(--text3);margin-top:8px">Numara: +${safePhone} · Deneme: #${d.attempt || '-'}</p><p style="font-size:12px;color:${expired ? 'var(--red)' : 'var(--green)'};margin-top:4px">${expired ? 'Kodun süresi doldu, yeni kod üretin.' : `Kalan süre: ${leftSec}sn`}</p>`;
      if (expired && pairCountdownTimer) {
        clearInterval(pairCountdownTimer);
        pairCountdownTimer = null;
        lockBtn(false);
      }
    };
    renderPairInfo();
    pairCountdownTimer = setInterval(renderPairInfo, 1000);
    pollAuth();
  } catch (e) {
    if (disp) disp.innerHTML = `<div style="color:var(--red);font-size:13px">❌ ${e.message}</div>`;
    lockBtn(false);
  }
}

let pollT = null;
function pollAuth() {
  if (pollT) clearInterval(pollT);
  pollT = setInterval(async () => {
    try {
      const r = await fetch('/api/auth/status');
      const d = await r.json();
      if (d.status === 'connected') {
        clearInterval(pollT);
        toast('✅ WhatsApp başarıyla bağlandı!', 'success');
        fetchStatus();
        const visual = document.getElementById('qrVisual');
        if (visual) visual.innerHTML = `<div style="text-align:center;color:var(--green);padding:20px"><div style="font-size:32px">✅</div><div style="font-size:14px;margin-top:8px;font-weight:600">Başarıyla Bağlandı!</div></div>`;
      } else if (d.status === 'error') { clearInterval(pollT); }
    } catch { }
  }, 2000);
}

// ══════════════════════════════
//  COMMANDS
// ══════════════════════════════
async function loadCommands() {
  const list = document.getElementById('cmdList');
  if (list) list.innerHTML = '<div class="cmd-loading">Komutlar ve test sonuçları yükleniyor…</div>';
  try {
    const r = await fetch('/api/commands?t=' + Date.now());
    const d = await r.json();
    S.commands = d.commands || [];

    // Fetch test progress
    const progressR = await fetch('/api/test-progress?t=' + Date.now());
    const progressData = await progressR.json();

    const tested = S.commands.filter(c => c.stat).length;
    const ok = S.commands.filter(c => c.stat?.status === 'ok').length;
    const errored = S.commands.filter(c => c.stat?.status === 'error').length;
    const timeout = S.commands.filter(c => c.stat?.status === 'timeout').length;
    const skipped = S.commands.filter(c => c.stat?.status === 'skipped').length;
    const banner = document.getElementById('cmdTestBanner');
    if (banner) {
      // If test is currently running, show current command
      if (progressData.status === 'testing' && progressData.currentCommand) {
        const current = progressData.currentIndex;
        const total = progressData.totalCommands;
        banner.innerHTML = `🧪 Test devam ediyor: <b>.${progressData.currentCommand}</b> (${current}/${total})`;
        banner.className = 'cmd-banner pending';
      } else if (tested === 0) {
        banner.innerHTML = '⏳ Bot henüz test çalıştırmadı. Bot bağlanınca otomatik başlar.';
        banner.className = 'cmd-banner pending';
      } else {
        banner.innerHTML = `🧪 Son test: <b>${ok}</b> ✅ başarılı · <b>${errored}</b> ❌ hata · <b>${timeout}</b> ⏱ zaman aşımı · <b>${skipped}</b> ⏭ atlandı`;
        banner.className = `cmd-banner ${errored > 0 ? 'has-error' : 'all-ok'}`;
      }
      banner.style.display = 'block';
    }
    renderCommands();

    // If test is active, set up polling to update banner in real-time
    if (progressData.status === 'testing') {
      if (S.testProgressPoll) clearInterval(S.testProgressPoll);
      S.testProgressPoll = setInterval(updateTestProgressBanner, 200); // 200ms for real-time updates
    } else {
      if (S.testProgressPoll) clearInterval(S.testProgressPoll);
      S.testProgressPoll = null;
    }
  } catch {
    if (list) list.innerHTML = '<div class="cmd-loading">Komutlar yüklenirken hata oluştu.</div>';
  }
}

async function updateTestProgressBanner() {
  try {
    const progressR = await fetch('/api/test-progress?t=' + Date.now());
    const progressData = await progressR.json();
    const banner = document.getElementById('cmdTestBanner');

    if (!banner) return;

    if (progressData.status === 'testing' && progressData.currentCommand) {
      const current = progressData.currentIndex;
      const total = progressData.totalCommands;
      banner.innerHTML = `🧪 Test devam ediyor: <b>.${progressData.currentCommand}</b> (${current}/${total})`;
      banner.className = 'cmd-banner pending';
      banner.style.display = 'block';
    } else if (progressData.status === 'completed') {
      // Test completed, show final results
      if (S.testProgressPoll) {
        clearInterval(S.testProgressPoll);
        S.testProgressPoll = null;
      }
      // Reload commands to get final stats
      loadCommands();
    }
  } catch (err) {
    console.error('Failed to update test progress:', err);
  }
}

function renderCommands(filter = '') {
  const list = document.getElementById('cmdList');
  const total = document.getElementById('cmdTotal');
  if (!list) return;

  const cmds = filter ? S.commands.filter(c =>
    c.pattern?.toLowerCase().includes(filter) || c.desc?.toLowerCase().includes(filter)
  ) : S.commands;

  if (total) total.textContent = `${cmds.length} komut`;

  if (!cmds.length) { list.innerHTML = '<div class="cmd-loading">Komut bulunamadı.</div>'; return; }

  // Group by use/type
  const groups = {};
  cmds.forEach(c => {
    const cat = c.use || c.type || 'genel';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(c);
  });

  const catLabels = { owner: "👑 Kurucu", system: "⚙️ Sistem", group: "👥 Grup", ai: "🤖 Yapay Zeka", download: "⬇️ İndirme", search: "🔍 Arama", tools: "🛠️ Araçlar", edit: "🎨 Görsel Düzenleme", media: "🎬 Medya", fun: "🎉 Eğlence", game: "🎮 Oyun & Test", dini: "🕌 Dini", chat: "💬 Sohbet", genel: "📦 Genel" };

  list.innerHTML = Object.entries(groups).map(([cat, items]) => `
    <div class="cmd-category">
      <div class="cmd-cat-name">${catLabels[cat] || '📦 ' + cat}</div>
      ${items.map(c => {
    const s = c.stat;
    let statBadge = '<span class="cmd-stat untested">— Henüz test edilmedi</span>';
    if (s) {
      if (s.status === 'ok') {
        const t = s.lastRun ? new Date(s.lastRun).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
        statBadge = `<span class="cmd-stat ok">✅ ${s.ms}ms · ${t} · ${s.runs}x</span>`;
      } else if (s.status === 'skipped') {
        statBadge = `<span class="cmd-stat" style="color:var(--text3);" title="${esc(s.error || 'Atlandı')}">⏭ Atlandı · ${s.error || 'Güvenlik'}</span>`;
      } else {
        statBadge = `<span class="cmd-stat error" title="${esc(s.error || 'Hata')}">❌ Hata · ${s.runs}x çalıştı</span>`;
      }
    }
    return `
          <div class="cmd-item">
            <span class="cmd-name">.${c.pattern || ''}</span>
            <span class="cmd-desc">${esc(c.desc || '--')}</span>
            ${statBadge}
            <span class="cmd-type">${c.use || c.type || 'genel'}</span>
          </div>
        `;
  }).join('')}
    </div>
  `).join('');
}

// ─── PLUGINS ─────────────────────────────────────────────
async function loadPlugins() {
  const grid = document.getElementById('pluginGrid');
  if (!grid) return;
  try {
    const r = await fetch('/api/plugins');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    S.plugins = d.plugins || [];
    renderPlugins();
  } catch (err) {
    console.error('Plugin Error:', err);
    grid.innerHTML = `<div class="cmd-loading">Eklentiler yüklenirken hata oluştu.<br><small style="color:var(--red);opacity:0.7">${err.message}</small></div>`;
  }
}

function renderPlugins(filter = '') {
  const grid = document.getElementById('pluginGrid');
  const countEl = document.getElementById('pluginCount');
  if (!grid) return;

  const plugins = filter ? S.plugins.filter(p =>
    p.name.toLowerCase().includes(filter) || p.desc.toLowerCase().includes(filter)
  ) : S.plugins;

  if (countEl) countEl.textContent = `${plugins.length} eklenti bulundu`;

  if (!plugins.length) {
    grid.innerHTML = '<div class="cmd-loading">Eklenti bulunamadı.</div>';
    return;
  }

  const prefix = getVal('s_PREFIX') || '.';

  grid.innerHTML = plugins.map(p => {
    // Prefix handler eklemesi (e.g. .afk)
    // utils gibi sistem dosyalarına prefix eklemeyelim
    const displayName = (p.name === 'utils' || p.name === 'main' || p.name === 'index') ? p.name : `${prefix}${p.name}`;

    return `
      <div class="plugin-card ${p.active ? 'active' : ''} spotlight-wrap">
        <div class="p-header">
          <span class="p-name">${displayName}</span>
          <span class="p-status">${p.active ? 'AKTİF' : 'DEVREDışı'}</span>
        </div>
        <p class="p-desc">${esc(p.desc)}</p>
        <button class="p-toggle-btn" onclick="togglePlugin('${p.id}')">
          ${p.active ? 'Devre Dışı Bırak' : 'Aktif Et'}
        </button>
      </div>
    `;
  }).join('');
}

async function togglePlugin(id) {
  try {
    const r = await fetch('/api/plugins/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (r.ok) {
      toast('Eklenti durumu değiştirildi!', 'success');
      loadPlugins();
    } else { toast('İşlem başarısız.', 'error'); }
  } catch { toast('Bağlantı hatası.', 'error'); }
}

// ─── BROADCAST ───────────────────────────────────────────
function setupBroadcast() {
  const form = document.getElementById('broadcastForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const jid = getVal('bc_jid').trim();
    const message = getVal('bc_message').trim();
    if (!message) return toast('Mesaj boş olamaz!', 'error');

    try {
      const btn = document.getElementById('bcSubmit');
      const btnSpan = btn.querySelector('span');
      btn.disabled = true; if (btnSpan) btnSpan.textContent = 'Gönderiliyor...';
      const r = await fetch('/api/system/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid, message })
      });
      btn.disabled = false; if (btnSpan) btnSpan.textContent = 'MESAJI ŞİMDİ GÖNDER';
      if (r.ok) {
        toast('Sinyal başarıyla gönderildi!', 'success');
        setVal('bc_message', '');
      } else { toast('Gönderim başarısız.', 'error'); }
    } catch { toast('Sunucu bağlantı hatası.', 'error'); }
  });
}

// ─── ANALYTICS / CHART ────────────────────────────────────
function initChart() {
  if (S.chart) return;
  const ctx = document.getElementById('ramChart');
  if (!ctx) return;

  S.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(20).fill(''),
      datasets: [{
        label: 'RAM Kullanımı (MB)',
        data: Array(20).fill(0),
        borderColor: '#a855f7',
        backgroundColor: 'rgba(168, 85, 247, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        fill: true,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } },
        x: { grid: { display: false }, ticks: { display: false } }
      }
    }
  });
}

function updateChart(val) {
  if (!S.chart) return;
  S.chart.data.datasets[0].data.push(val);
  S.chart.data.datasets[0].data.shift();
  S.chart.update('none');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cmdSearch')?.addEventListener('input', function () {
    renderCommands(this.value.toLowerCase().trim());
  });
  document.getElementById('pluginSearch')?.addEventListener('input', function () {
    renderPlugins(this.value.toLowerCase().trim());
  });
});

// ══════════════════════════════
//  LOGS / TERMINAL
// ══════════════════════════════
function connectLogs() {
  if (es) es.close();
  es = new EventSource('/api/logs/stream');
  const dot = document.getElementById('tsbDot');
  const txt = document.getElementById('tsbText');
  es.onopen = () => { if (dot) dot.className = 'tsb-dot live'; if (txt) txt.textContent = 'Bağlı · Canlı'; };
  es.onerror = () => {
    if (dot) dot.className = 'tsb-dot';
    if (txt) txt.textContent = 'Bağlantı kesildi, yeniden bağlanıyor…';
    setTimeout(connectLogs, 5000);
  };
  es.onmessage = (e) => {
    try {
      const log = JSON.parse(e.data);

      if (log.isMetrics) {
        document.getElementById('statMessages').textContent = log.messages || 0;
        document.getElementById('statCommands').textContent = log.commands || 0;
        document.getElementById('statUsers').textContent = log.users || 0;
        document.getElementById('statGroups').textContent = log.groups || 0;

        // Masterpiece: Add heap/max metrics
        if (log.memHeap) {
          updateChart(log.memHeap);
          setText('cpuMetric', log.cpuLoad || '0.1');
        }
        return; // Don't process as a terminal log
      }

      if (log.isActivity) {
        const tBody = document.getElementById('activityBody');
        if (tBody) {
          // Remove empty state message
          const emptyRow = tBody.querySelector('.empty-row');
          if (emptyRow) emptyRow.remove();
          let senderHtml;
          if (log.isGroup) {
            const name = esc(log.sender || 'Bilinmiyor');
            const group = esc(log.groupName || 'Grup');
            senderHtml = `<span style="color:var(--text)">${name}</span><span style="color:var(--text3);margin:0 3px">›</span><span style="color:var(--text2);font-size:12px">${group}</span> <span style="font-size:10px;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,0.08);color:var(--text2);margin-left:6px;font-weight:500;">Grup</span>`;
          } else {
            senderHtml = `<span style="color:var(--green)">${esc(log.sender || 'Bilinmiyor')}</span> <span style="font-size:10px;padding:2px 6px;border-radius:6px;background:var(--green-dim);color:var(--green);margin-left:6px;font-weight:500;">Özel</span>`;
          }

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="color:var(--text3)">${log.time || '--:--'}</td>
            <td>${senderHtml}</td>
            <td><span class="cmd-type" style="padding:2px 6px">${esc(log.type || 'Sistem')}</span></td>
            <td>${esc(log.content || '-')}</td>
            <td style="color:var(--text2);font-family:monospace">${esc(log.command || '-')}</td>
          `;
          tBody.prepend(tr);

          // Keep only the last 15 activities in DOM
          while (tBody.children.length > 15) {
            tBody.lastElementChild.remove();
          }

          // Update count text
          const actCount = document.getElementById('activityCount');
          if (actCount) actCount.textContent = `Son ${tBody.children.length} işlem`;
        }
        return;
      }

      S.logs.push(log); if (S.logs.length > 500) S.logs.shift();
      appendLog(log);
      S.logTotal++;
      const cnt = document.getElementById('tsbCount'); if (cnt) cnt.textContent = `${S.logTotal} log`;

      if (!document.getElementById('page-terminal')?.classList.contains('active')) {
        S.newLogs++; updateTermBadge();
      }
    } catch { }
  };
}

function detectLevel(txt) {
  const t = txt.toLowerCase();
  if (t.includes('error') || t.includes('hata') || t.includes('fatal')) return 'error';
  if (t.includes('warn') || t.includes('uyarı')) return 'warn';
  if (t.includes('success') || t.includes('connected') || t.includes('bağlandı') || t.includes('başarı')) return 'success';
  return 'info';
}

function appendLog(log) {
  const body = document.getElementById('termBody'); if (!body) return;
  const lv = log.level || detectLevel(log.data || '');
  const el = document.createElement('div');
  el.className = 'log-line';
  el.dataset.lv = lv;
  if (S.activeFilter !== 'all' && S.activeFilter !== lv) el.classList.add('fhide');
  const txt = (log.data || '').replace(/\x1b\[[0-9;]*m/g, '').trim();

  // Syntax Highlight Logic
  let contentHtml = esc(txt);
  contentHtml = contentHtml.replace(/(\{.*\}|\[.*\])/g, '<span style="color:#60a5fa">$1</span>'); // JSON
  contentHtml = contentHtml.replace(/(\+\d{10,15})/g, '<span style="color:#10b981">$1</span>'); // Numbers/Phones

  el.innerHTML = `<span class="ltime">${log.time || ''}</span><span class="llv ${lv}">${lv.toUpperCase()}</span><span class="lcontent">${contentHtml}</span>`;
  body.appendChild(el);
  if (body.children.length > 200) body.removeChild(body.firstChild);
  if (S.autoScroll) body.scrollTop = body.scrollHeight;
}

function updateTermBadge() {
  const b = document.getElementById('termBadge');
  if (!b) return;
  if (S.newLogs > 0) { b.style.display = 'flex'; b.textContent = S.newLogs > 99 ? '99+' : S.newLogs; }
  else { b.style.display = 'none'; }
}

function setupTerminalControls() {
  // Filter
  document.querySelectorAll('.f-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.f-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.activeFilter = btn.dataset.f;
      document.querySelectorAll('#termBody .log-line').forEach(line => {
        const lv = line.dataset.lv;
        line.classList.toggle('fhide', S.activeFilter !== 'all' && S.activeFilter !== lv);
      });
    });
  });

  // Auto-scroll
  document.getElementById('btnAutoScroll')?.addEventListener('click', function () {
    S.autoScroll = !S.autoScroll;
    this.classList.toggle('active', S.autoScroll);
  });

  // Clear
  document.getElementById('btnClearLogs')?.addEventListener('click', () => {
    const body = document.getElementById('termBody');
    if (body) body.innerHTML = '<div class="term-welcome">▶ Terminal temizlendi</div>';
    S.logs = []; S.logTotal = 0;
    const cnt = document.getElementById('tsbCount'); if (cnt) cnt.textContent = '0 log';
  });

  // Search
  document.getElementById('termSearch')?.addEventListener('input', function () {
    const q = this.value.toLowerCase().trim();
    let matches = 0;
    document.querySelectorAll('#termBody .log-line').forEach(line => {
      if (!q) { line.classList.remove('shide', 'smatch'); return; }
      const hits = line.textContent.toLowerCase().includes(q);
      line.classList.toggle('shide', !hits);
      line.classList.toggle('smatch', hits);
      if (hits) matches++;
    });
    const cnt = document.getElementById('termSearchCount');
    if (cnt) cnt.textContent = q ? `${matches} sonuç` : '';
  });
}

// ══════════════════════════════
//  CONFIG / SETTINGS
// ══════════════════════════════
async function fetchConfig() {
  try {
    const r = await fetch('/api/config');
    const d = await r.json();
    // Identity & Core
    setVal('s_BOT_NAME', d.BOT_NAME);
    setVal('s_OWNER_NUMBER', d.OWNER_NUMBER);
    setVal('s_PREFIX', d.PREFIX);
    setVal('s_SUDO', d.SUDO);
    setVal('s_LANG', d.LANG);
    setVal('s_ALIVE', d.ALIVE);
    setVal('s_BOT_INFO', d.BOT_INFO);
    setVal('s_STICKER_DATA', d.STICKER_DATA);

    // Toggles
    setChk('s_PUBLIC_MODE', d.PUBLIC_MODE === 'true');
    setChk('s_AUTO_READ', d.AUTO_READ === 'true');
    setChk('s_AUTO_TYPING', d.AUTO_TYPING === 'true');
    setChk('s_AUTO_RECORDING', d.AUTO_RECORDING === 'true');
    setChk('s_ANTI_LINK', d.ANTI_LINK === 'true');
    setChk('s_ANTI_SPAM', d.ANTI_SPAM === 'true');
    setChk('s_ADMIN_ACCESS', d.ADMIN_ACCESS === 'true');
    setChk('s_DEBUG', d.DEBUG === 'true');

    // AI & APIs
    setVal('s_GEMINI_API_KEY', d.GEMINI_API_KEY);
    setVal('s_OPENAI_API_KEY', d.OPENAI_API_KEY);
    setVal('s_GROQ_API_KEY', d.GROQ_API_KEY);
    setVal('s_AI_MODEL', d.AI_MODEL);
    setVal('s_ACR_A', d.ACR_A);
    setVal('s_ACR_S', d.ACR_S);

    // Systems
    setVal('s_MAX_STICKER_SIZE', d.MAX_STICKER_SIZE);
    setVal('s_MAX_DL_SIZE', d.MAX_DL_SIZE);
    setVal('s_PM2_RESTART_LIMIT_MB', d.PM2_RESTART_LIMIT_MB);
  } catch { }
}

async function loadEnvPreview() {
  const pre = document.getElementById('envPreview'); if (!pre) return;
  try {
    const r = await fetch('/api/config/raw');
    const txt = await r.text();
    const masked = txt.replace(/(KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL)\s*=\s*(\S+)/gi, '$1=*****');
    pre.textContent = masked || '(boş)';
  } catch { pre.textContent = 'Yüklenemedi.'; }
}

function setupSettings() {
  document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      BOT_NAME: getVal('s_BOT_NAME'),
      OWNER_NUMBER: getVal('s_OWNER_NUMBER'),
      PREFIX: getVal('s_PREFIX'),
      SUDO: getVal('s_SUDO'),
      LANG: getVal('s_LANG'),
      ALIVE: getVal('s_ALIVE'),
      BOT_INFO: getVal('s_BOT_INFO'),
      STICKER_DATA: getVal('s_STICKER_DATA'),
      
      PUBLIC_MODE: getChk('s_PUBLIC_MODE') ? 'true' : 'false',
      AUTO_READ: getChk('s_AUTO_READ') ? 'true' : 'false',
      AUTO_TYPING: getChk('s_AUTO_TYPING') ? 'true' : 'false',
      AUTO_RECORDING: getChk('s_AUTO_RECORDING') ? 'true' : 'false',
      ANTI_LINK: getChk('s_ANTI_LINK') ? 'true' : 'false',
      ANTI_SPAM: getChk('s_ANTI_SPAM') ? 'true' : 'false',
      ADMIN_ACCESS: getChk('s_ADMIN_ACCESS') ? 'true' : 'false',
      DEBUG: getChk('s_DEBUG') ? 'true' : 'false',

      GEMINI_API_KEY: getVal('s_GEMINI_API_KEY'),
      OPENAI_API_KEY: getVal('s_OPENAI_API_KEY'),
      GROQ_API_KEY: getVal('s_GROQ_API_KEY'),
      AI_MODEL: getVal('s_AI_MODEL'),
      ACR_A: getVal('s_ACR_A'),
      ACR_S: getVal('s_ACR_S'),

      MAX_STICKER_SIZE: getVal('s_MAX_STICKER_SIZE'),
      MAX_DL_SIZE: getVal('s_MAX_DL_SIZE'),
      PM2_RESTART_LIMIT_MB: getVal('s_PM2_RESTART_LIMIT_MB'),
    };
    try {
      const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) {
        toast('Ayarlar kaydedildi!', 'success');
        const ok = document.getElementById('saveOk'); if (ok) { ok.style.display = 'inline'; setTimeout(() => ok.style.display = 'none', 3000); }
        loadEnvPreview();
      } else { toast('Kayıt başarısız.', 'error'); }
    } catch { toast('Bağlantı hatası.', 'error'); }
  });

  document.getElementById('btnRefreshEnv')?.addEventListener('click', loadEnvPreview);
}

function toggleVisibility(id) {
  const inp = document.getElementById(id); if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}
window.toggleVisibility = toggleVisibility;

// ══════════════════════════════
//  TOAST
// ══════════════════════════════
function toast(msg, type = 'info') {
  const box = document.getElementById('toastBox'); if (!box) return;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ══════════════════════════════
//  HELPERS
// ══════════════════════════════
function formatUptime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  let res = [];
  if (h > 0) res.push(`${h}sa`);
  if (m > 0) res.push(`${m}dk`);
  if (s > 0 || res.length === 0) res.push(`${s}sn`);
  return res.join(' ');
}
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setVal(id, val) { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; }
function getVal(id) { return document.getElementById(id)?.value || ''; }
function setChk(id, val) { const el = document.getElementById(id); if (el) el.checked = !!val; }
function getChk(id) { return document.getElementById(id)?.checked || false; }
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ══════════════════════════════
//  INIT
// ══════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupMobileMenu();
  setupConnTabs();
  setupAuth();
  setupTerminalControls();
  setupSettings();
  setupBroadcast();
  connectLogs();
  fetchStatus();
  setInterval(fetchStatus, 5000);

  // Global helpers
  window.togglePlugin = togglePlugin;

  // Global Mouse tracking for Spotlight effects (Optimized with RAF)
  let rafPending = false;
  document.addEventListener('mousemove', e => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      document.body.style.setProperty('--mouse-x', `${e.clientX}px`);
      document.body.style.setProperty('--mouse-y', `${e.clientY}px`);
      rafPending = false;
    });
  });
});

function updateHealth() {
  const scoreEl = document.getElementById('healthScore');
  if (!scoreEl) return;
  // Simple logic: Base 100 - (small random jitter) - (if offline -20)
  let health = 98 + (Math.random() * 2);
  const isOnline = document.getElementById('heroBadge')?.textContent.includes('Bağlı');
  if (!isOnline) health -= 30;
  scoreEl.textContent = Math.min(100, Math.floor(health)) + '%';
}
setInterval(updateHealth, 10000);
