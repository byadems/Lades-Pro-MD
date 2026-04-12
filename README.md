# Lades-Pro-MD 🤖

> **Ultra-stabil, profesyonel ve %100 açık kaynaklı WhatsApp bot altyapısı.**  
> Gelişmiş bellek yönetimi, dinamik komut üretimi ve entegre yönetim paneli ile güçlendirilmiştir.

---

## ✨ Öne Çıkan Özellikler

- ⚡ **Yüksek Performans** — Baileys tabanlı hafif mimari, PM2 entegrasyonu ve otomatik bellek optimizasyonu.
- 🎨 **Dashboard** — Modern web arayüzü ile QR okutma, bot durumu izleme ve canlı log takibi.
- 🗄️ **Gelişmiş Veritabanı** — PostgreSQL & SQLite desteği (Sequelize), WAL modu, LRU cache ve atomik istatistik takibi.
- 🤖 **AI Komut Geliştirme** — `.aikomut` ile Gemini veya GPT kullanarak bot içerisinden anında yeni eklentiler üretin.
- 🌍 **Türkçe Odaklı** — Tamamen yerelleştirilmiş sistem mesajları, ezan vakitleri ve profesyonel komut setleri.
- 🔓 **Şeffaf & Güvenli** — Şifrelenmemiş (obfuscate edilmemiş) temiz kod yapısı.

---

## 🚀 Hızlı Kurulum

### 1. Bağımlılıkları Yükle
Aşağıdaki komutları terminalinizde çalıştırarak gerekli paketleri kurun:
```bash
git clone https://github.com/byadems/Lades-Pro-MD
cd Lades-Pro-MD
npm install
```

### 2. Konfigürasyon
Örnek dosyayı kopyalayın ve kendi bilgilerinize göre düzenleyin:
```bash
cp config.env.example config.env
```

**Kritik Değişkenler:**
| Değişken | Açıklama |
|---|---|
| `OWNER_NUMBER` | Bot sahibi numarası (Örn: `905XXXXXXXXX`) |
| `PREFIX` | Komut öneki (Varsayılan: `.`) |
| `DATABASE_URL` | PostgreSQL bağlantısı (Boş bırakılırsa SQLite kullanılır) |
| `GEMINI_API_KEY` | AI özellikleri için Google AI Studio anahtarı |

### 3. Kimlik Doğrulama (Login)
Botu WhatsApp hesabınıza bağlamak için iki yöntem mevcuttur:

**A. Dashboard (Önerilen):**
Sistemi başlattığınızda `http://localhost:3000` adresinden QR kod okutabilirsiniz.

**B. Pair Code (Terminal):**
```bash
npm run pair -- +905XXXXXXXXX
```

### 4. Çalıştırma
```bash
# Geliştirme modu (loglar temizlenmiş)
npm start

# PM2 ile (Production önerisi)
npm run pm2:start
```

---

## 📋 Komut Kategorileri

| Kategori | Örnek Komutlar |
|---|---|
| **🏠 Genel** | `.ping`, `.bilgi`, `.uptime`, `.hız`, `.owner`, `.komutlar` |
| **👥 Grup** | `.ekle`, `.kick`, `.promote`, `.demote`, `.mute`, `.link`, `.everyone`, `.tag` |
| **🛡️ Yönetim** | `.ban`, `.unban`, `.uyar`, `.warnlist`, `.broadcast`, `.restart`, `.antinumara` |
| **🖼️ Medya** | `.sticker`, `.toimg`, `.tomp3`, `.pp`, `.sil`, `.çevir`, `.instagram`, `.tiktok` |
| **📺 YouTube** | `.yts`, `.ytmp3`, `.ytmp4`, `.play` |
| **⚙️ Sistem** | `.welcome`, `.goodbye`, `.filtre`, `.antilink`, `.chatbot`, `.afk`, `.ezan` |
| **🧠 Yapay Zeka** | `.ai`, `.aikomut`, `.gpt`, `.dalle`, `.imagine` |

---

## 🤖 AI Komut Geliştirme
Botunuza yeni bir özellik eklemek mi istiyorsunuz? Kod yazmanıza gerek yok:
```text
.aikomut gruptaki kullanıcıların mesaj sayılarını listeleyen bir grafik komutu yaz
```
Bot, sistem mimarisini analiz eder, kodu üretir, `plugins/ai-generated/` içine kaydeder ve **anında aktif eder.**

---

## 🗄️ Veritabanı Şeması
Sistem verimlilik için 13+ tablo kullanır:
- `whatsapp_sessions`: Oturum verileri ve anahtarlar.
- `group_settings`: Gruba özel karşılama, anti-link vb. ayarlar.
- `user_data`: Kullanıcı yetkileri, uyarılar ve AFK durumları.
- `message_stats` & `bot_metrics`: Detaylı kullanım analizleri.
- `command_registry`: Aktif komutların dinamik listesi.

---

## 📁 Proje Klasör Yapısı

```text
Lades-Pro-MD/
├── core/                   # Çekirdek motor (Bağlantı, Handler, Database)
├── plugins/                # Komutlar ve özellikler (Modüler yapı)
├── scripts/                # Dashboard, Pair ve yardımcı araçlar
├── sessions/               # Yerel oturum yedekleri (Opsiyonel)
├── public/                 # Dashboard ön yüz dosyaları
├── index.js                # Ana giriş noktası ve watchdog
├── config.js               # Merkezi konfigürasyon yöneticisi
└── ecosystem.config.js     # PM2 yapılandırması
```

---

## 📄 Lisans
Bu proje **GPL-3.0** lisansı ile sunulmaktadır. Özgürce kullanabilir, geliştirebilir ve paylaşabilirsiniz.

**Geliştirici:** [@byadems](https://github.com/byadems)  
**Topluluk:** [Telegram Kanalı](https://t.me/LadesProMD)

