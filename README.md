# Lades-Pro-MD 🤖

> Ultra-stabil, ultra-hızlı, %100 açık kaynaklı WhatsApp bot altyapısı.
> Lades-Pro-MD mimarisi temel alınarak sıfırdan yazılmıştır.

---

## ✨ Özellikler

- ⚡ **Ultra-Kararlı** — Exponential backoff yeniden bağlanma, PM2 watchdog, bellek izleyici
- 🗄️ **Güçlü Veritabanı** — PostgreSQL (Sequelize) + SQLite fallback + LRU cache katmanı
- 🤖 **AI Komut Geliştirme** — `.aikomut` ile Gemini veya GPT kullanarak anında yeni komut üret
- 📱 **QR + Pair Code** — `node scripts/pair.js` ile kolayca bağlan
- 🔌 **35+ Komut** — Grup yönetimi, medya, YouTube, AFK, filtre, welcome, chatbot ve daha fazlası
- 🔓 **Obfuscate-Sız** — %100 temiz ve açık kaynak
- 🌍 **Türkçe odaklı** — Ezan vakitleri, Türkçe komut isimleri

---

## 🚀 Kurulum

### 1. Bağımlılıkları Yükle

```bash
cd lades-pro-md
npm install
```

### 2. Konfigürasyon

```bash
cp config.env.example config.env
# config.env dosyasını düzenle
```

**En az şunları ayarlayın:**
| Değişken | Açıklama |
|---|---|
| `OWNER_NUMBER` | Bot sahibi telefon numarası (başında 90, + olmadan) |
| `PREFIX` | Komut öneki (varsayılan: `.`) |
| `DATABASE_URL` | PostgreSQL URL (boş bırakırsanız SQLite kullanır) |
| `GEMINI_API_KEY` | AI özellikler için Google AI Studio anahtarı |

### 3. Kimlik Doğrulama

**QR Kod ile:**
```bash
node scripts/pair.js
```

**Pair Code ile (önerilir):**
```bash
node scripts/pair.js +905XXXXXXXXX
```

> Yeni: Otomatik oturum kapatma varsayılan olarak açık. Eğer bağlı cihazda "Çıkış işlemi bekleniyor" ve oturum kaybolması istemiyorsanız `config.env` veya `.env` içinde:
> `PAIR_AUTO_LOGOUT=false`
> olarak ayarlayın.

Gösterilen session string'i `config.env` dosyasında `SESSION=` alanına yapıştırın.

### 4. Başlat

**Doğrudan:**
```bash
node index.js
```

**PM2 ile (önerilir):**
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## 📋 Komutlar

| Kategori | Komutlar |
|---|---|
| **Genel** | `.ping`, `.bilgi`, `.uptime`, `.hız`, `.owner`, `.komutlar` |
| **Grup** | `.ekle`, `.kick`, `.promote`, `.demote`, `.mute`, `.unmute`, `.link`, `.revoke`, `.grupadi`, `.everyone`, `.grupbilgi`, `.çık` |
| **Yönetim** | `.ban`, `.unban`, `.uyar`, `.warnlist`, `.setvar`, `.getvar`, `.broadcast`, `.restart`, `.mod` |
| **Medya** | `.sticker`, `.toimg`, `.tomp3`, `.pp`, `.sil`, `.kaydet`, `.tepki` |
| **YouTube** | `.yts`, `.ytmp3`, `.ytmp4` |
| **Sistem** | `.welcome`, `.goodbye`, `.filtre`, `.antilink`, `.chatbot`, `.zamanla`, `.ezan`, `.afk` |
| **AI** | `.ai`, `.aikomut`, `.ailistesi` |
| **Metin** | `.koyuyazi`, `.italik`, `.mono`, `.take` |

---

## 🤖 AI Komut Geliştirme

```
.aikomut kullanıcıyı güzel Türkçe ile selamlayan bir komut yaz
```

Bot otomatik olarak:
1. Mevcut bot yapısını analiz eder
2. Gemini/GPT API'ye gönderir
3. Üretilen kodu doğrular
4. `plugins/ai-generated/` klasörüne kaydeder
5. **Canlı olarak yükler** (yeniden başlatma gerekmez!)

---

## 🗄️ Veritabanı Mimarisi

```
whatsapp_sessions   (oturum durumu)
bot_config          (dinamik ayarlar)
group_settings      (grup başına ayarlar)
user_data           (kullanıcı verisi + uyarılar)
warn_logs           (uyarı geçmişi)
filters             (anahtar kelime filtreler)
schedules           (zamanlanmış mesajlar)
external_plugins    (harici eklentiler)
ai_commands         (AI üretilen komutlar)
```

---

## 📁 Proje Yapısı

```
lades-pro-md/
├── index.js                # Giriş noktası (memory monitor, graceful shutdown)
├── config.js               # Merkezi yapılandırma + logger
├── config.env.example      # Örnek .env dosyası
├── ecosystem.config.js     # PM2 yapılandırması
├── core/
│   ├── auth.js             # QR + Pair Code + DB/file session
│   ├── bot.js              # Baileys bağlantısı + reconnect
│   ├── handler.js          # Temiz mesaj yönlendirici (Lades-Pro stili)
│   ├── database.js         # Sequelize ORM (9 tablo)
│   ├── db-cache.js         # LRU cache katmanı
│   ├── store.js            # Mesaj ve grup metadata store
│   ├── manager.js          # Multi-session yöneticisi
│   ├── schedulers.js       # node-cron zamanlamalar
│   ├── helpers.js          # Ortak yardımcı fonksiyonlar
│   └── constructors/       # Mesaj bağlam zenginleştirici
├── plugins/
│   ├── utility.js          # ping, bilgi, uptime...
│   ├── group.js            # Grup yönetimi
│   ├── manage.js           # Bot yönetimi
│   ├── warn.js             # Uyarı sistemi
│   ├── welcome.js          # Hoşgeldin/veda
│   ├── filter.js           # Filtre + anti-link
│   ├── afk.js              # AFK sistemi
│   ├── chatbot.js          # AI sohbet botu
│   ├── yapayzeka.js        # AI komut üretici ⭐
│   ├── converters.js       # Sticker, MP3, dönüştürücüler
│   ├── media.js            # Medya komutları
│   ├── youtube.js          # YouTube indirici
│   ├── schedule.js         # Zamanlanmış mesajlar
│   ├── commands.js         # Komut listesi
│   ├── fancy.js            # Süslü metin
│   ├── ezan.js             # Ezan vakitleri (TR)
│   └── ai-generated/       # AI'nın ürettiği komutlar
└── scripts/
    └── pair.js             # Kimlik doğrulama yardımcısı
```

---

## 📄 Lisans

GPL-3.0 © Lades-Pro-MD Contributors
