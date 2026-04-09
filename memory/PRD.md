# Lades-Pro-MD - Ürün Gereksinimleri Dokümanı (PRD)

## Proje Tanımı
WhatsApp bot projesi (Lades-Pro-MD) - Ultra Premium. Hedef: Son derece kararlı, çökmeye dayanıklı, tam Türkçe WhatsApp botu. Dashboard ile yönetim, AI komut üretimi, uzak komut çalıştırma.

## Kaynak Repo
- https://github.com/byadems/Lades-Pro-MD

## Teknik Mimari
```
Port 3000: Node.js static file server (Dashboard UI - /app/public/)
Port 3001: Express dashboard API (Bot yönetimi, AI, komutlar)
Port 8001: FastAPI proxy (/api/* → port 3001)
```

## Temel Gereksinimler
1. Bot son derece kararlı, hatasız ve crash-resistant olmalı
2. Dashboard üzerinden yönetim + AI komut üretimi + uzak komut çalıştırma
3. Tüm çıktılar %100 Türkçe
4. Docker (Northflank/Koyeb/Netlify) uyumluluğu
5. MongoDB/Supabase veritabanı desteği (mevcut SQLite/Postgres yanına)
6. Hedef repo'lardan özellik taşıma (hermit-bot, KnightBot-MD, raganork-md)
7. Siputzx ve Nexray API entegrasyonları

## Tamamlanan İşler (9 Nisan 2026)
### Ortam & Altyapı
- [x] Repo /app dizinine taşındı ve bağımlılıklar yüklendi
- [x] sqlite3 native modül GLIBC sorunu çözüldü (build-from-source)
- [x] Port 3000'de dashboard statik dosya servisi (keepalive sunucusu güncellendi)
- [x] FastAPI proxy (8001 → 3001) bağlantı havuzu düzeltildi
- [x] Bot başarıyla başlatıldı ve WhatsApp oturumu bağlandı

### Siputzx API Entegrasyonu (YENİ)
- [x] `siputzx.js` - Arama, Stalker, Araçlar (Pinterest, Google Görsel, SS, GitHub/TikTok/IG/Twitter/YouTube stalker, çeviri, DuckDuckGo, Spotify/SoundCloud arama, kedi, waifu, neko, anime sözleri)
- [x] `siputzx-dl.js` - Medya indirme (TikTok, Facebook, Twitter, Spotify, Pinterest, SoundCloud, CapCut, Instagram, SaveFrom)
- [x] `siputzx-games.js` - Oyunlar (Bilgi yarışması, matematik, görsel tahmin, logo tahmin, bayrak tahmin, bulmaca, kelime dizme, profil kartı)
- [x] `siputzx-ai.js` - AI komutları (DuckAI, DeepSeek R1, Llama 3.3, Meta AI, AI görsel üretimi, Gemini Lite, QwQ 32B)

### Hermit-Bot Özellik Taşıma (YENİ)
- [x] `hermit-features.js` - Mesaj yönlendirme, otomatik tepki, sistem bilgisi, herkese etiketleme, anonim mesaj, durum yazma, okundu ayarı
- [x] `tts.js` - Metin-konuşma (Google TTS, Türkçe varsayılan)

### Dashboard Geliştirmeleri (YENİ)
- [x] AI Komut Fabrikası sayfası (Siputzx DuckAI ile otomatik kod üretimi)
- [x] Uzak Komut Çalıştırma sayfası (grup listesi, komut gönderme, mesaj gönderme)
- [x] Kategorize komut listesi API endpoint'i (/api/commands/categorized)
- [x] Grup listesi API endpoint'i (/api/groups)
- [x] Form stil düzenlemeleri (glass-panel uyumu)

### Stabilite
- [x] callGenerativeAI fonksiyonu oluşturuldu (Siputzx DuckAI/DeepSeek fallback)
- [x] Tüm API parametre adları düzeltildi (duckai: message, deepseek: prompt, vb.)
- [x] Dockerfile oluşturuldu (Northflank/Koyeb uyumlu)
- [x] .dockerignore oluşturuldu

### Test Sonuçları
- Bot self-test: 402 komut, 321 başarılı, 22 hata (API bağımlı), 4 timeout
- Testing agent: Backend %100 (20/20), Frontend %100 (6/6)
- 23 komut kategorisi, 282+ komut

## Bekleyen İşler

### P0 - Acil
- [ ] Tam Türkçe çeviri taraması (kalan İngilizce string'ler)

### P1 - Önemli
- [ ] MongoDB/Supabase veritabanı desteği ekleme
- [ ] KnightBot-MD ve raganork-md'den ek özellik taşıma (repo'lar 404, alternatif kaynaklar gerekli)
- [ ] Nexray API fallback'leri güçlendirme (tüm endpoint'ler için Siputzx alternatifi)
- [ ] Derin hata yönetimi (core/handler.js crash-resistant yapı)

### P2 - İyileştirme
- [ ] Dashboard UI/UX iyileştirmeleri
- [ ] Emergent LLM Key ile premium AI entegrasyonu
- [ ] Otomatik grup cache güncelleme
- [ ] Plugin hot-reload (bot yeniden başlatmadan)

## Komut Kategorileri (23 adet)
ai, arama, araçlar, ayarlar, canvas, dini, download, edit, eglence, fun, game, genel, group, grup, indirme, media, owner, oyun, search, stalker, system, tools, yapay zeka
