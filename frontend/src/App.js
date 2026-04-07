import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Wifi, 
  WifiOff, 
  Settings, 
  Terminal, 
  Layers, 
  Send, 
  BarChart3,
  MessageSquare,
  Users,
  Shield,
  Clock,
  CheckCircle,
  AlertCircle,
  User,
  Phone
} from 'lucide-react';
import './App.css';

const API_BASE = process.env.REACT_APP_BACKEND_URL || '';

function App() {
  const [activePage, setActivePage] = useState('panel');
  const [status, setStatus] = useState({
    connected: false,
    phone: null,
    uptime: 0,
    memory: '0 MB',
    botName: 'Lades-Pro-MD'
  });
  const [commands, setCommands] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
    fetchCommands();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (e) {
      console.log('Status fetch error:', e);
    }
    setLoading(false);
  };

  const fetchCommands = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/commands`);
      if (res.ok) {
        const data = await res.json();
        setCommands(data.commands || []);
      }
    } catch (e) {
      console.log('Commands fetch error:', e);
    }
  };

  const formatUptime = (seconds) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}g ${hours}s ${mins}dk`;
    if (hours > 0) return `${hours}s ${mins}dk`;
    return `${mins}dk`;
  };

  const navItems = [
    { id: 'panel', label: 'Panel', icon: LayoutDashboard },
    { id: 'baglanti', label: 'Bağlantı', icon: Wifi },
    { id: 'komutlar', label: 'Komutlar', icon: Terminal },
    { id: 'plugins', label: 'Eklentiler', icon: Layers },
    { id: 'ayarlar', label: 'Ayarlar', icon: Settings },
  ];

  return (
    <div className="app-container">
      {/* Aurora Background */}
      <div className="aurora-bg">
        <div className="aur-1"></div>
        <div className="aur-2"></div>
        <div className="aur-3"></div>
      </div>

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <MessageSquare size={24} />
          </div>
          <div className="brand-text">
            <span className="brand-name">Lades-Pro-MD</span>
            <span className="brand-version">Ultra Premium</span>
          </div>
        </div>

        <div className="status-card">
          <div className="status-row">
            <div className={`status-dot ${status.connected ? 'connected' : ''}`}></div>
            <div className="status-info">
              <span className="status-label">Bot Bağlantısı</span>
              <span className="status-value">
                {status.connected ? 'Bağlı' : 'Bağlı Değil'}
              </span>
            </div>
          </div>
        </div>

        <div className="nav-section">
          <div className="nav-label">MENÜ</div>
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-btn ${activePage === item.id ? 'active' : ''}`}
              onClick={() => setActivePage(item.id)}
            >
              <item.icon size={20} />
              {item.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 'auto', padding: '16px', color: 'var(--text-muted)', fontSize: '12px' }}>
          <div>Sürüm 1.0.0</div>
          <div style={{ marginTop: '4px' }}>Sahip: +905396978235</div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {activePage === 'panel' && (
          <>
            <div className="page-header">
              <h1 className="page-title">Kontrol Paneli</h1>
              <p className="page-subtitle">Lades-Pro-MD WhatsApp Bot yönetim merkezi</p>
            </div>

            {/* Alert */}
            <div className={`alert ${status.connected ? 'alert-success' : 'alert-warning'}`}>
              {status.connected ? (
                <>
                  <CheckCircle size={20} />
                  <div>
                    <strong>Bot aktif ve çalışıyor!</strong>
                    <p style={{ marginTop: '4px', opacity: 0.8 }}>Tüm komutlar kullanılabilir durumda.</p>
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle size={20} />
                  <div>
                    <strong>Bot bağlı değil</strong>
                    <p style={{ marginTop: '4px', opacity: 0.8 }}>Bağlantı sekmesinden oturum açın.</p>
                  </div>
                </>
              )}
            </div>

            {/* Stats Grid */}
            <div className="cards-grid">
              <div className="stat-card">
                <div className="stat-icon">
                  <Clock size={24} />
                </div>
                <div className="stat-value">{formatUptime(status.uptime)}</div>
                <div className="stat-label">Çalışma Süresi</div>
              </div>

              <div className="stat-card">
                <div className="stat-icon">
                  <Terminal size={24} />
                </div>
                <div className="stat-value">{commands.length}+</div>
                <div className="stat-label">Aktif Komut</div>
              </div>

              <div className="stat-card">
                <div className="stat-icon">
                  <BarChart3 size={24} />
                </div>
                <div className="stat-value">{status.memory}</div>
                <div className="stat-label">Bellek Kullanımı</div>
              </div>

              <div className="stat-card">
                <div className="stat-icon">
                  <Shield size={24} />
                </div>
                <div className="stat-value">{status.connected ? 'Aktif' : 'Pasif'}</div>
                <div className="stat-label">Koruma Durumu</div>
              </div>
            </div>

            {/* Info Panel */}
            <div className="info-panel">
              <h3 className="info-title">
                <User size={20} />
                Bot Bilgileri
              </h3>
              <div className="info-row">
                <span className="info-key">Bot Adı</span>
                <span className="info-value">{status.botName}</span>
              </div>
              <div className="info-row">
                <span className="info-key">Sahip Numarası</span>
                <span className="info-value">+905396978235</span>
              </div>
              <div className="info-row">
                <span className="info-key">Prefix</span>
                <span className="info-value">.</span>
              </div>
              <div className="info-row">
                <span className="info-key">Mod</span>
                <span className="info-value">Public</span>
              </div>
              <div className="info-row">
                <span className="info-key">Node.js</span>
                <span className="info-value">{status.nodeVersion || 'v20.x'}</span>
              </div>
            </div>

            {/* Owner Info */}
            <div className="info-panel" style={{ background: 'rgba(0, 212, 170, 0.05)', borderColor: 'rgba(0, 212, 170, 0.2)' }}>
              <h3 className="info-title" style={{ color: 'var(--accent-primary)' }}>
                <CheckCircle size={20} />
                Sahiplik Doğrulandı
              </h3>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <strong>+905396978235</strong> numarası bot sahibi olarak ayarlandı. 
                Bu numara tüm yönetici komutlarına (<code>.setvar</code>, <code>.değişkengetir</code>, 
                <code>.antibot</code> vb.) tam erişime sahiptir.
              </p>
              <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ padding: '4px 12px', background: 'rgba(0, 212, 170, 0.1)', borderRadius: '20px', fontSize: '12px', color: 'var(--accent-primary)' }}>
                  ✓ OWNER_NUMBER ayarlandı
                </span>
                <span style={{ padding: '4px 12px', background: 'rgba(0, 212, 170, 0.1)', borderRadius: '20px', fontSize: '12px', color: 'var(--accent-primary)' }}>
                  ✓ HARD_OWNER aktif
                </span>
                <span style={{ padding: '4px 12px', background: 'rgba(0, 212, 170, 0.1)', borderRadius: '20px', fontSize: '12px', color: 'var(--accent-primary)' }}>
                  ✓ LID öğrenme aktif
                </span>
              </div>
            </div>
          </>
        )}

        {activePage === 'baglanti' && (
          <>
            <div className="page-header">
              <h1 className="page-title">Bağlantı Yönetimi</h1>
              <p className="page-subtitle">WhatsApp oturumunu yönetin</p>
            </div>

            <div className="info-panel">
              <h3 className="info-title">
                {status.connected ? <Wifi size={20} style={{ color: 'var(--success)' }} /> : <WifiOff size={20} style={{ color: 'var(--danger)' }} />}
                Bağlantı Durumu
              </h3>
              <div className="info-row">
                <span className="info-key">Durum</span>
                <span className="info-value" style={{ color: status.connected ? 'var(--success)' : 'var(--danger)' }}>
                  {status.connected ? 'Bağlı' : 'Bağlı Değil'}
                </span>
              </div>
              {status.phone && (
                <div className="info-row">
                  <span className="info-key">Telefon</span>
                  <span className="info-value">+{status.phone}</span>
                </div>
              )}
              <div className="info-row">
                <span className="info-key">Oturum</span>
                <span className="info-value">{status.hasStoredSession ? 'Kayıtlı' : 'Kayıtlı Değil'}</span>
              </div>
            </div>

            <div className="alert alert-info">
              <AlertCircle size={20} />
              <div>
                <strong>Oturum Açma Talimatları</strong>
                <p style={{ marginTop: '8px', opacity: 0.9 }}>
                  1. Sunucunuzda <code>node scripts/pair.js +905396978235</code> komutunu çalıştırın<br />
                  2. Ekranda görünen eşleşme kodunu WhatsApp'ta girin<br />
                  3. Bağlantı kurulduktan sonra <code>node index.js</code> ile botu başlatın
                </p>
              </div>
            </div>
          </>
        )}

        {activePage === 'komutlar' && (
          <>
            <div className="page-header">
              <h1 className="page-title">Komutlar</h1>
              <p className="page-subtitle">{commands.length}+ aktif komut</p>
            </div>

            <div className="commands-list">
              {commands.slice(0, 30).map((cmd, i) => (
                <div key={i} className="command-item">
                  <div>
                    <div className="command-name">.{cmd.pattern}</div>
                    <div className="command-desc">{cmd.desc || 'Açıklama yok'}</div>
                  </div>
                  <span className="command-category">{cmd.use || 'genel'}</span>
                </div>
              ))}
              {commands.length > 30 && (
                <div style={{ padding: '16px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  +{commands.length - 30} komut daha...
                </div>
              )}
            </div>
          </>
        )}

        {activePage === 'plugins' && (
          <>
            <div className="page-header">
              <h1 className="page-title">Eklentiler</h1>
              <p className="page-subtitle">Bot eklentilerini yönetin</p>
            </div>

            <div className="alert alert-info">
              <Layers size={20} />
              <div>
                <strong>Eklenti Yönetimi</strong>
                <p style={{ marginTop: '4px' }}>
                  Eklentiler <code>/plugins</code> klasöründe bulunur. Bir eklentiyi devre dışı bırakmak için 
                  dosya uzantısını <code>.bak</code> olarak değiştirin.
                </p>
              </div>
            </div>
          </>
        )}

        {activePage === 'ayarlar' && (
          <>
            <div className="page-header">
              <h1 className="page-title">Ayarlar</h1>
              <p className="page-subtitle">Bot yapılandırmasını düzenleyin</p>
            </div>

            <div className="info-panel">
              <h3 className="info-title">
                <Settings size={20} />
                Temel Ayarlar
              </h3>
              <div className="info-row">
                <span className="info-key">Bot Adı</span>
                <span className="info-value">Lades-Pro-MD</span>
              </div>
              <div className="info-row">
                <span className="info-key">Sahip Numarası</span>
                <span className="info-value">905396978235</span>
              </div>
              <div className="info-row">
                <span className="info-key">Prefix</span>
                <span className="info-value">.</span>
              </div>
              <div className="info-row">
                <span className="info-key">Public Mode</span>
                <span className="info-value">Açık</span>
              </div>
              <div className="info-row">
                <span className="info-key">Auto Read</span>
                <span className="info-value">Kapalı</span>
              </div>
              <div className="info-row">
                <span className="info-key">Auto Typing</span>
                <span className="info-value">Açık</span>
              </div>
            </div>

            <div className="alert alert-warning">
              <AlertCircle size={20} />
              <div>
                <strong>Ayarları Değiştirmek İçin</strong>
                <p style={{ marginTop: '4px' }}>
                  <code>config.env</code> dosyasını düzenleyin veya WhatsApp'tan <code>.setvar</code> komutunu kullanın.
                </p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
