'use strict';

// ══════════════════════════════
//  STATE
// ══════════════════════════════
const S = {
  logs: [], logTotal: 0, activeFilter: 'all',
  autoScroll: true, newLogs: 0,
  stats: { messages: 0, commands: 0, users: 0, groups: 0 },
  activity: [],
  commands: [], cmdStatusFilter: 'all',
  plugins: [],
  ramHistory: [],
  chart: null,
  testProgressPoll: null,
  selectedBroadcastJids: new Set(),
  activeSingleTarget: null,
  allCommands: [],
  activeBroadcastMode: 'text'
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
      if (page === 'uzakkomut') { loadGroups(); loadCategorizedCommands(); loadGroupsForBroadcast(); }
      if (page === 'komutlar') loadCommands();
      if (page === 'ayarlar') { fetchConfig(); loadEnvPreview(); }
      if (page === 'plugins') loadPlugins();
      if (page === 'stats') initChart();
    });
  });
}

function setupRemoteTabs() {
  document.querySelectorAll('[data-remote-tab]').forEach(tab => {
    tab.onclick = () => {
      const target = tab.dataset.remoteTab;
      document.querySelectorAll('[data-remote-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.remote-tab-pane').forEach(p => {
        p.classList.toggle('active', p.id === `remote-tab-content-${target}`);
        if (p.id !== `remote-tab-content-${target}`) p.style.display = 'none';
        else p.style.display = 'block';
      });
    };
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

    // Stats kartları güncelle
    setText('statMessages', d.totalMessages || 0);
    setText('statCommands', d.totalCommands || 0);
    setText('statUsers', d.activeUsers || 0);
    setText('statGroups', d.managedGroups || 0);

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
      // Format code as XXXX-XXXX
      const rawCode = (d.code || '').replace(/-/g, '');
      const formattedCode = rawCode.length === 8 ? rawCode.slice(0, 4) + '-' + rawCode.slice(4) : (d.code || '');
      disp.innerHTML = `<h2 style="letter-spacing:4px;font-size:28px">${formattedCode}</h2><p>WhatsApp → Bağlı Cihazlar → Cihaz Bağla → Telefon Numarası Kullanarak Bağlayın → Bu kodu girin</p><p style="font-size:12px;color:var(--text3);margin-top:8px">Numara: +${safePhone} · Deneme: #${d.attempt || '-'}</p><p style="font-size:12px;color:${expired ? 'var(--red)' : 'var(--green)'};margin-top:4px">${expired ? 'Kodun süresi doldu, yeni kod üretin.' : `Kalan süre: ${leftSec}sn`}</p>`;
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
        pollT = null;
        // Stop pair countdown
        if (pairCountdownTimer) { clearInterval(pairCountdownTimer); pairCountdownTimer = null; }
        toast('✅ WhatsApp başarıyla bağlandı!', 'success');
        fetchStatus();
        // Update QR visual
        const visual = document.getElementById('qrVisual');
        if (visual) visual.innerHTML = `<div style="text-align:center;color:var(--green);padding:20px"><div style="font-size:32px">✅</div><div style="font-size:14px;margin-top:8px;font-weight:600">Başarıyla Bağlandı!</div></div>`;
        // Update Pair display
        const pairDisp = document.getElementById('pairDisplay');
        if (pairDisp && !pairDisp.classList.contains('hidden')) {
          pairDisp.innerHTML = `<div style="text-align:center;color:var(--green);padding:20px"><div style="font-size:32px">✅</div><div style="font-size:14px;margin-top:8px;font-weight:600">Başarıyla Bağlandı!</div></div>`;
        }
        // Re-enable pair button
        const pBtn = document.getElementById('btnPair');
        if (pBtn) { pBtn.disabled = false; pBtn.style.opacity = '1'; }
      } else if (d.status === 'error') { clearInterval(pollT); pollT = null; }
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
      if (progressData && progressData.status === 'testing' && progressData.currentCommand) {
        const current = progressData.currentIndex;
        const total = progressData.totalCommands;
        banner.innerHTML = `🧪 Test devam ediyor: <b>.${progressData.currentCommand}</b> (${current}/${total})`;
        banner.className = 'cmd-banner pending';
      } else if (tested === 0) {
        banner.innerHTML = '⏳ Bot henüz test çalıştırmadı. Bot bağlanınca otomatik başlar.';
        banner.className = 'cmd-banner pending';
      } else {
        banner.innerHTML = `🧪 Son test sonuçları: <span style="margin-left:8px">✅ <b>${ok}</b> başarılı</span> <span style="margin-left:12px">❌ <b>${errored}</b> hatalı</span> <span style="margin-left:12px">⏱ <b>${timeout}</b> zaman aşımı</span> <span style="margin-left:12px">⏭ <b>${skipped}</b> atlandı</span>`;
        banner.className = `cmd-banner ${errored > 0 ? 'has-error' : 'all-ok'}`;
      }
      banner.style.display = 'block';
    }
    renderCommands();
    setupCommandFilters();

    // If test is active, set up polling to update banner in real-time
    if (progressData && progressData.status === 'testing') {
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

    if (progressData && progressData.status === 'testing' && progressData.currentCommand) {
      const current = progressData.currentIndex;
      const total = progressData.totalCommands;
      banner.innerHTML = `🧪 Test devam ediyor: <b>.${progressData.currentCommand}</b> (${current}/${total})`;
      banner.className = 'cmd-banner pending';
      banner.style.display = 'block';
    } else if (progressData && progressData.status === 'completed') {
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

function setupCommandFilters() {
  document.querySelectorAll('[data-cmd-f]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-cmd-f]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.cmdStatusFilter = btn.dataset.cmdF;
      renderCommands(document.getElementById('cmdSearch')?.value.toLowerCase().trim() || '');
    };
  });
}

function renderCommands(filter = '') {
  const list = document.getElementById('cmdList');
  const total = document.getElementById('cmdTotal');
  if (!list) return;

  let cmds = filter ? S.commands.filter(c =>
    c.pattern?.toLowerCase().includes(filter) || c.desc?.toLowerCase().includes(filter)
  ) : S.commands;

  // Apply Status Filtre
  if (S.cmdStatusFilter !== 'all') {
    cmds = cmds.filter(c => {
      if (S.cmdStatusFilter === 'ok') return c.stat?.status === 'ok';
      if (S.cmdStatusFilter === 'error') return c.stat?.status === 'error';
      if (S.cmdStatusFilter === 'skipped') return c.stat?.status === 'skipped';
      return true;
    });
  }

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

// --- Redundant broadcast render function removed --

function toggleBroadcastGroup(jid) {
  if (S.selectedBroadcastJids.has(jid)) S.selectedBroadcastJids.delete(jid);
  else S.selectedBroadcastJids.add(jid);
  updateBroadcastSelectionUI();
}

function selectAllGroups(select) {
  if (select) {
    S.broadcastGroups.forEach(g => S.selectedBroadcastJids.add(g.jid || g.id));
  } else {
    S.selectedBroadcastJids.clear();
  }
  updateBroadcastSelectionUI();
}

function updateBroadcastSelectionUI() {
  renderBroadcastGroups(document.getElementById('bcSearch')?.value.trim());
  const badge = document.getElementById('selectedCountBadge');
  if (badge) badge.textContent = `${S.selectedBroadcastJids.size} Alıcı Seçildi`;
}

function filterBroadcastGroups() {
  renderBroadcastGroups(document.getElementById('bcSearch')?.value.trim());
}

function setupBroadcast() {
  const form = document.getElementById('broadcastForm');
  if (!form) return;

  // Mod Seçici Başlatma
  document.querySelectorAll('.bc-mode-btn').forEach(btn => {
    btn.onclick = () => {
      const mode = btn.dataset.bcMode;
      S.activeBroadcastMode = mode;

      document.querySelectorAll('.bc-mode-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'var(--bg2)';
        b.style.borderColor = 'var(--border2)';
        b.style.color = 'var(--text2)';
        b.style.boxShadow = 'none';
      });

      btn.classList.add('active');
      const accentColor = mode === 'text' ? 'var(--blue)' : 'var(--accent)';
      btn.style.background = mode === 'command' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(59, 130, 246, 0.15)';
      btn.style.borderColor = accentColor;
      btn.style.color = 'var(--text)';
      btn.style.boxShadow = `0 0 15px ${accentColor}44`;

      const msgArea = document.getElementById('bc_message');
      if (msgArea) {
        msgArea.placeholder = mode === 'text'
          ? 'Tüm alıcılara gönderilecek mesajı buraya yazın...'
          : 'Seçilen gruplarda çalıştırılacak komutu yazın (Örn: .menu)...';
      }

      const submitSpan = document.querySelector('#bcSubmit span');
      if (submitSpan) {
        submitSpan.textContent = mode === 'text' ? 'YAYINI BAŞLAT' : 'TOPLU KOMUT ÇALIŞTIR';
      }
    };
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = getVal('bc_message').trim();
    if (!message) return toast('Mesaj/Komut boş olamaz!', 'error');
    if (S.selectedBroadcastJids.size === 0) return toast('En az bir hedef seçmelisiniz!', 'warn');

    const isCommand = S.activeBroadcastMode === 'command';
    const targets = Array.from(S.selectedBroadcastJids);
    const total = targets.length;
    let minD = parseInt(getVal('bc_min_delay')) || 2;
    let maxD = parseInt(getVal('bc_max_delay')) || 5;
    if (minD > maxD) [minD, maxD] = [maxD, minD];

    const btn = document.getElementById('bcSubmit');
    const progBox = document.getElementById('bcProgressBox');
    const progFill = document.getElementById('bcProgressBarFill');
    const progTxt = document.getElementById('bcProgressStatus');

    btn.disabled = true;
    progBox.style.display = 'block';
    let successCount = 0;

    const actionText = isCommand ? 'Çalıştırılıyor' : 'Gönderiliyor';

    for (let i = 0; i < total; i++) {
      const jid = targets[i];
      const progress = Math.round(((i + 1) / total) * 100);
      progFill.style.width = `${progress}%`;
      progFill.style.background = isCommand ? 'var(--accent-glow)' : 'var(--blue-glow)';
      progTxt.innerHTML = `<span style="color:${isCommand ? 'var(--accent)' : 'var(--blue)'}">${actionText}:</span> ${i + 1}/${total} <br><small>${esc(jid)}</small>`;

      try {
        const r = await fetch('/api/system/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jid, message, type: isCommand ? 'command' : 'text' })
        });
        if (r.ok) successCount++;
      } catch (err) { console.error('Broadcast error for ' + jid, err); }

      if (i < total - 1) {
        const nextDelay = Math.floor(Math.random() * (maxD - minD + 1) + minD);
        for (let s = nextDelay; s > 0; s--) {
          progTxt.innerHTML = `<span style="color:var(--green)">Sıradaki:</span> ${i + 2}/${total} <br><small>${s} saniye bekleniyor... (${nextDelay}s aralık)</small>`;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    btn.disabled = false;
    progTxt.innerHTML = `<span style="color:var(--green); font-weight:bold;">TAMAMLANDI</span><br>${successCount}/${total} başarılı işlem.`;
    toast(`${successCount} işlem başarıyla tamamlandı!`, 'success');

    setTimeout(() => {
      progBox.style.display = 'none';
      progFill.style.width = '0%';
    }, 5000);
  });
}

window.toggleBroadcastGroup = toggleBroadcastGroup;
window.selectAllGroups = selectAllGroups;
window.filterBroadcastGroups = filterBroadcastGroups;

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

          const typeMap = {
            'Error': 'Hata',
            'Sistem Testi': 'Sistem Testi',
            'Sistem Nabzı': 'Sistem Nabzı',
            'Self-Test': 'Sistem Testi',
            'Heartbeat': 'Sistem Nabzı'
          };
          const displayType = typeMap[log.type] || log.type || 'Sistem';

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="color:var(--text3)">${log.time || '--:--'}</td>
            <td>${senderHtml}</td>
            <td><span class="cmd-type" style="padding:2px 6px">${esc(displayType)}</span></td>
            <td>${esc(log.content || '-')}</td>
            <td style="color:var(--text2);font-family:monospace">${esc(log.command || '-')}</td>
          `;
          tBody.prepend(tr);

          // Keep only the last 50 activities in DOM
          while (tBody.children.length > 50) {
            tBody.lastElementChild.remove();
          }

          // Update count text
          const actCount = document.getElementById('activityCount');
          if (actCount) actCount.textContent = `Son ${tBody.children.length} işlem`;
        }
        return;
      }

      S.logs.push(log); if (S.logs.length > 1000) S.logs.shift();
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
  const lvLabelsArr = {
    error: 'HATA',
    warn: 'UYARI',
    success: 'BAŞARILI',
    info: 'BİLGİ'
  };
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

  const lvLabels = {
    error: 'HATA',
    warn: 'UYARI',
    success: 'BAŞARILI',
    info: 'BİLGİ'
  };
  const displayLv = lvLabels[lv] || lv.toUpperCase();
  el.innerHTML = `<span class="ltime">${log.time || ''}</span><span class="llv ${lv}">${displayLv}</span><span class="lcontent">${contentHtml}</span>`;
  body.appendChild(el);
  if (body.children.length > 500) body.removeChild(body.firstChild);
  if (S.autoScroll) body.scrollTop = body.scrollHeight;
}

function updateTermBadge() {
  const b = document.getElementById('termBadge');
  if (!b) return;
  if (S.newLogs > 0) { b.style.display = 'flex'; b.textContent = S.newLogs > 99 ? '99+' : S.newLogs; }
  else { b.style.display = 'none'; }
}

function setupTerminalControls() {
  // Filtre
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

  // Slide out and remove
  setTimeout(() => {
    t.classList.add('removing');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}
function showToast(msg, type = 'info') { toast(msg, type); }
window.showToast = showToast;

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
  setupRemoteTabs();
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

// ══════════════════════════════
//  AI KOMUT FABRİKASI
// ══════════════════════════════
let _lastAiCode = '';

async function generateAiCommand() {
  const desc = document.getElementById('aiCmdDesc')?.value?.trim();
  if (!desc) { showToast('Komut açıklaması girin.', 'warning'); return; }

  const btn = document.getElementById('btnAiGenerate');
  const resultPanel = document.getElementById('aiResultPanel');
  const resultCode = document.getElementById('aiResultCode');
  const saveBtn = document.getElementById('btnAiSave');

  btn.disabled = true;
  btn.textContent = 'Üretiliyor...';

  try {
    const res = await fetch('/api/ai/generate-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hata');

    _lastAiCode = data.code;
    resultCode.textContent = data.code;
    resultPanel.style.display = 'block';
    saveBtn.style.display = 'inline-flex';

    // Auto-generate name from desc
    const nameInput = document.getElementById('aiCmdName');
    const autoName = desc.split(' ').slice(0, 3).join('-').toLowerCase()
      .replace(/[^a-z0-9-]/g, '').substring(0, 30);
    nameInput.value = autoName || 'yeni-komut';

    showToast('Komut başarıyla üretildi!', 'success');
  } catch (e) {
    showToast('AI hatası: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Komut Üret';
  }
}

async function saveAiCommand() {
  const name = document.getElementById('aiCmdName')?.value?.trim();
  if (!name || !_lastAiCode) { showToast('İsim ve kod gerekli.', 'warning'); return; }

  try {
    const res = await fetch('/api/ai/save-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: _lastAiCode, name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hata');
    showToast(data.message, 'success');
  } catch (e) {
    showToast('Kayıt hatası: ' + e.message, 'error');
  }
}

// ══════════════════════════════
//  UZAK KOMUT ÇALIŞTIRMA
// ══════════════════════════════
async function loadGroups() {
  const container = document.getElementById('groupList');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted); padding:20px;">Yükleniyor...</p>';

  try {
    const res = await fetch('/api/groups');
    const data = await res.json();
    const groups = data.groups || [];
    S.remoteGroups = groups;
    renderSingleTargetGroups();
  } catch (e) {
    container.innerHTML = `<p style="color:var(--red); padding:20px;">Hata: ${esc(e.message)}</p>`;
  }
}

function renderSingleTargetGroups(filter = '') {
  const container = document.getElementById('groupList');
  if (!container) return;
  const filtered = filter ? S.remoteGroups.filter(g => (g.subject || g.name || '').toLowerCase().includes(filter.toLowerCase())) : S.remoteGroups;

  if (!filtered.length) {
    container.innerHTML = '<p style="color:var(--text3); padding:20px;">Grup bulunamadı.</p>';
    return;
  }

  container.innerHTML = filtered.map(g => {
    const jid = g.jid || g.id;
    const name = g.subject || g.name || jid;
    const isActive = S.activeSingleTarget?.jid === jid;
    return `
      <div class="bc-item ${isActive ? 'selected' : ''}" onclick="selectSingleTarget('${esc(jid)}', '${esc(name)}')">
        <div class="target-avatar-mini" data-avatar-jid="${esc(jid)}" style="width:32px; height:32px; background:var(--surface3); border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16" stroke="var(--text2)" style="opacity:0.4;"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke-width="2"/></svg>
        </div>
        <div class="bc-item-info">
          <span class="bc-item-name">${esc(name)}</span>
          <span class="bc-item-jid">${esc(jid)}</span>
        </div>
      </div>
    `;
  }).join('');

  // Lazy load avatars
  setTimeout(loadGroupAvatars, 100);
}

async function loadGroupAvatars() {
  const avatars = document.querySelectorAll('[data-avatar-jid], [data-jid]');
  for (const el of avatars) {
    const jid = el.dataset.avatarJid || el.dataset.jid;
    // Special: if it already has an img, skip
    if (el.querySelector('img')) continue;

    try {
      const res = await fetch(`/api/group-pp?jid=${encodeURIComponent(jid)}`);
      const data = await res.json();
      if (data.imgUrl) {
        // Update both the list and the S.remoteGroups data
        const g = S.remoteGroups.find(rg => (rg.jid || rg.id) === jid);
        if (g) g.imgUrl = data.imgUrl;

        el.innerHTML = `<img src="${esc(data.imgUrl)}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16" stroke="var(--text2)" style="display:none; opacity:0.4;"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke-width="2"/></svg>`;
      }
    } catch (e) { }
  }
}

function selectSingleTarget(jid, name) {
  const group = S.remoteGroups.find(g => (g.jid || g.id) === jid);
  S.activeSingleTarget = { jid, name, imgUrl: group?.imgUrl };
  document.getElementById('remoteJid').value = jid;

  const header = document.getElementById('activeTargetHeader');
  const nameEl = document.getElementById('activeTargetName');
  const jidEl = document.getElementById('activeTargetJid');

  // Update header avatar
  const avatarContainer = header.querySelector('.target-avatar-mini');
  if (avatarContainer) {
    if (group && group.imgUrl) {
      avatarContainer.innerHTML = `<img src="${esc(group.imgUrl)}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
      <svg viewBox="0 0 24 24" fill="none" width="20" height="20" stroke="var(--accent)" style="display:none;"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke-width="2"/></svg>`;
    } else {
      // Try to fetch it live if not in cache (lazy load)
      avatarContainer.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="20" height="20" stroke="var(--accent)"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke-width="2"/></svg>`;
      fetch(`/api/group-pp?jid=${encodeURIComponent(jid)}`).then(r => r.json()).then(data => {
        if (data.imgUrl) {
          if (group) group.imgUrl = data.imgUrl;
          avatarContainer.innerHTML = `<img src="${esc(data.imgUrl)}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20" stroke="var(--accent)" style="display:none;"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke-width="2"/></svg>`;
        }
      }).catch(() => { });
    }
  }

  header.style.display = 'block';
  nameEl.textContent = name;
  jidEl.textContent = jid;

  renderSingleTargetGroups(document.getElementById('targetSearch')?.value.trim());
  toast(`${name} hedefine kilitlenildi.`, 'info');
}

function filterSingleTargets() {
  renderSingleTargetGroups(document.getElementById('targetSearch')?.value.trim());
}

async function sendRemoteCommand() {
  const jid = document.getElementById('remoteJid')?.value?.trim();
  const cmd = document.getElementById('remoteCmd')?.value?.trim();
  if (!jid) { toast('Önce bir hedef seçin!', 'warn'); return; }
  if (!cmd) { toast('Komut girin.', 'warning'); return; }

  const resultDiv = document.getElementById('remoteResult');
  try {
    const res = await fetch('/api/execute-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupJid: jid, command: cmd })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hata');

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `<span style="color:var(--green)">[TAMAMLANDI]</span> ${esc(cmd)} -> Bot içinde yürütüldü.`;
    toast('Komut başarıyla yürütüldü.', 'success');
  } catch (e) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `<span style="color:var(--red)">[HATA]</span> ${esc(e.message)}`;
    toast('Hata: ' + e.message, 'error');
  }
}

async function sendRemoteMessage() {
  const jid = document.getElementById('remoteJid')?.value?.trim();
  const text = document.getElementById('remoteCmd')?.value?.trim();
  if (!jid) { toast('Önce bir hedef seçin!', 'warn'); return; }
  if (!text) { toast('Mesaj yazın.', 'warning'); return; }

  try {
    const res = await fetch('/api/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid, text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hata');
    toast('Mesaj gönderildi.', 'success');
  } catch (e) {
    toast('Hata: ' + e.message, 'error');
  }
}

async function loadCategorizedCommands() {
  const container = document.getElementById('categorizedCommands');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text3); padding:20px;">Yükleniyor...</p>';

  try {
    const res = await fetch('/api/commands/categorized');
    const data = await res.json();
    S.allCategorizedCmds = data.categories || {};
    renderCmdLibrary('');
  } catch (e) {
    container.innerHTML = `<p style="color:var(--red)">Hata: ${esc(e.message)}</p>`;
  }
}

function renderCmdLibrary(query = '') {
  const container = document.getElementById('categorizedCommands');
  if (!container) return;

  let html = '';
  const cats = S.allCategorizedCmds || {};
  let found = 0;

  for (const [cat, cmds] of Object.entries(cats)) {
    const filtered = query ? cmds.filter(c =>
      c.command.toLowerCase().includes(query.toLowerCase()) ||
      (c.desc && c.desc.toLowerCase().includes(query.toLowerCase()))
    ) : cmds;

    if (filtered.length === 0) continue;
    found += filtered.length;

    html += `<div style="margin-bottom:20px;">
      <div class="op-cat-header">
        <div class="op-cat-line"></div>
        <div class="op-cat-title">${esc(cat)} (${filtered.length})</div>
      </div>
      <div class="cmd-grid">
        ${filtered.map(c => `
          <div class="cmd-item" onclick="setRemoteCmd('.${esc(c.command)}')">
            <span class="cmd-item-name">.${esc(c.command)}</span>
            <span class="cmd-item-desc" title="${esc(c.desc || '')}">${esc(c.desc || '')}</span>
          </div>
        `).join('')}
      </div>
    </div>`;
  }
  container.innerHTML = html || `<p style="color:var(--text-muted); padding:20px;">"${esc(query)}" ile eşleşen komut bulunamadı.</p>`;
}

function searchCmdLibrary() {
  const val = document.getElementById('cmdLibSearch')?.value.trim();
  renderCmdLibrary(val);
}

function setRemoteCmd(val) {
  setVal('remoteCmd', val);
  toast('Komut seçildi.', 'info');
}

window.selectSingleTarget = selectSingleTarget;
window.filterSingleTargets = filterSingleTargets;
window.searchCmdLibrary = searchCmdLibrary;
window.setRemoteCmd = setRemoteCmd;

window.addEventListener('load', () => {
  document.body.classList.remove('preload');
});

// ══════════════════════════════
//  STAT MODAL
// ══════════════════════════════
window.openStatModal = async function (type) {
  const overlay = document.getElementById('statModalOverlay');
  const title = document.getElementById('smTitle');
  const sub = document.getElementById('smSub');
  const icon = document.getElementById('smIcon');
  const body = document.getElementById('smBody');
  if (!overlay || !body) return;

  body.innerHTML = '<div style="text-align:center; padding: 30px; color:var(--text3);">Yükleniyor...</div>';
  overlay.classList.add('active');

  let themeColor = 'var(--blue)';
  let iconHtml = '';

  if (type === 'messages') {
    themeColor = 'var(--blue)';
    iconHtml = '<svg viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="2"/></svg>';
    title.textContent = 'Toplam Mesaj Analizi';
    sub.textContent = 'Sistem kurulduğundan beri işlenen veriler';

    body.innerHTML = `
      <div class="sm-stat-box" style="align-items:center; border-color:rgba(0,225,255,0.3); background:rgba(0,225,255,0.05);">
        <span class="sm-sb-lbl" style="color:var(--blue);">TÜM İŞLENEN MESAJLAR</span>
        <span class="sm-sb-val" style="font-size:32px; color:var(--blue);">${document.getElementById('statMessages').textContent}</span>
      </div>
      <p style="color:var(--text3); font-size:13px; line-height:1.6; text-align:center; margin-top:10px;">
        Bot kurulduğundan itibaren gelen ve giden tüm mesajların toplam sayısıdır.
      </p>
    `;
  } else if (type === 'commands') {
    themeColor = 'var(--purple)';
    iconHtml = '<svg viewBox="0 0 24 24" fill="none"><polyline points="4 17 10 11 4 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="19" x2="20" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    title.textContent = 'Komut Kullanım Verileri';
    sub.textContent = 'Performans ve komut başarı dökümü';

    try {
      if (!S.commands || S.commands.length === 0) {
        const r = await fetch('/api/commands?t=' + Date.now());
        const d = await r.json();
        S.commands = d.commands || [];
      }

      let totalRuns = 0; let okCount = 0; let errCount = 0;
      S.commands.forEach(c => {
        if (c.stat) {
          totalRuns += (c.stat.runs || 0);
          if (c.stat.status === 'ok') okCount++;
          if (c.stat.status === 'error') errCount++;
        }
      });

      body.innerHTML = `
        <div class="sm-stat-grid">
          <div class="sm-stat-box">
            <span class="sm-sb-lbl" style="color:var(--purple);">Toplam Çalıştırma</span>
            <span class="sm-sb-val">${totalRuns}</span>
          </div>
          <div class="sm-stat-box">
            <span class="sm-sb-lbl" style="color:var(--green);">Başarılı Komut</span>
            <span class="sm-sb-val">${okCount}</span>
          </div>
          <div class="sm-stat-box">
            <span class="sm-sb-lbl" style="color:var(--red);">Hatalı Komut</span>
            <span class="sm-sb-val">${errCount}</span>
          </div>
          <div class="sm-stat-box">
            <span class="sm-sb-lbl" style="color:var(--text2);">Kayıtlı Komut</span>
            <span class="sm-sb-val">${S.commands.length}</span>
          </div>
        </div>
      `;
    } catch {
      body.innerHTML = '<p style="color:var(--red);">Veri yüklenemedi.</p>';
    }
  } else if (type === 'users') {
    themeColor = 'var(--green)';
    iconHtml = '<svg viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="2"/></svg>';
    title.textContent = 'Aktif Kullanıcılar';
    sub.textContent = 'Sistemle etkileşime geçen kişi sayısı';

    body.innerHTML = `
      <div class="sm-stat-box" style="align-items:center; border-color:rgba(0,255,163,0.3); background:rgba(0,255,163,0.05);">
        <span class="sm-sb-lbl" style="color:var(--green);">BENZERSİZ KULLANICI</span>
        <span class="sm-sb-val" style="font-size:32px; color:var(--green);">${document.getElementById('statUsers').textContent}</span>
      </div>
      <p style="color:var(--text3); font-size:13px; line-height:1.6; text-align:center; margin-top:10px;">
        Grup veya özel mesajlardan otomatik olarak kaydedilen ve botu kullanan toplam kişi sayısı.
      </p>
    `;
  } else if (type === 'groups') {
    themeColor = 'var(--amber)';
    iconHtml = '<svg viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="2"/></svg>';
    title.textContent = 'Yönetilen Gruplar';
    sub.textContent = 'Botun bulunduğu whatsapp grupları';

    try {
      if (!S.remoteGroups || S.remoteGroups.length === 0) {
        const res = await fetch('/api/groups');
        const data = await res.json();
        S.remoteGroups = data.groups || [];
      }

      if (S.remoteGroups.length === 0) {
        body.innerHTML = '<p style="color:var(--text3);">Bot henüz hiçbir grupta değil.</p>';
      } else {
        const groupHtml = S.remoteGroups.map(g => {
          let jid = g.jid || g.id;
          let name = g.subject || g.name || jid;
          return `
             <div class="modal-list-item">
               <div data-avatar-jid="${esc(jid)}" style="width:36px; height:36px; border-radius:50%; background:var(--surface3); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                 ${g.imgUrl ? `<img src="${esc(g.imgUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : `<svg viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="var(--text2)" style="opacity:0.5;"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke-width="2"/><circle cx="9" cy="7" r="4" stroke-width="2"/></svg>`}
               </div>
               <div style="display:flex; flex-direction:column; overflow:hidden;">
                 <span style="font-weight:700; font-size:13.5px; color:var(--text); white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${esc(name)}</span>
                 <span style="font-size:11px; color:var(--text3);">${esc(jid)}</span>
               </div>
             </div>
           `;
        }).join('');

        body.innerHTML = `
           <div style="font-size:12px; font-weight:700; color:var(--text3); margin-bottom:4px;">TOPLAM ${S.remoteGroups.length} GRUP</div>
           <div style="display:flex; flex-direction:column; gap:8px;">
             ${groupHtml}
           </div>
         `;
        // Trigger lazy loader for avatars
        setTimeout(loadGroupAvatars, 100);
      }
    } catch {
      body.innerHTML = '<p style="color:var(--red);">Grup verileri alınamadı.</p>';
    }
  }

  icon.innerHTML = iconHtml;
  icon.style.color = themeColor;
  icon.style.borderColor = themeColor;
  icon.style.boxShadow = `0 0 15px ${themeColor}`;
};

document.addEventListener('DOMContentLoaded', () => {
  const smClose = document.getElementById('smCloseBtn');
  const overlay = document.getElementById('statModalOverlay');
  if (smClose && overlay) {
    smClose.addEventListener('click', () => overlay.classList.remove('active'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  }

  // Visibility change: ensure animations resume after tab switch
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      document.querySelectorAll('.brand-name').forEach(el => {
        void el.offsetHeight;
      });
    }
  });
});

