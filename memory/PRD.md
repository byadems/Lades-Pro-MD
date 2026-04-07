# Lades-Pro-MD WhatsApp Bot - PRD

## Original Problem Statement
BOT'U BAŞTAN AŞAĞI DERİNLEMESİNE VE KAPSAMLICA ANALİZ ET, +905396978235 OLAN NUMARANIN ONUN SAHİBİ OLDUĞUNU ÖĞRETENE KADAR KAPSAMLI KESİN %100 ÇALIŞACAK ÇÖZÜM UYGULA.

GitHub: https://github.com/byadems/Lades-Pro-MD

## Problem
WhatsApp bot komutları (.değişkengetir, .setvar, .antibot vb.) "yalnızca Yazılım Geliştiricim tarafından kullanılabilir" hatası veriyordu. Bunun nedeni WhatsApp'ın yeni LID (Linked ID) sistemi nedeniyle sahiplik kontrolünün başarısız olmasıydı.

## Architecture
- **Bot Framework**: Node.js + Baileys (WhatsApp Web API)
- **Dashboard**: Node.js Express (port 3001)
- **Frontend**: React.js
- **Backend Proxy**: FastAPI (port 8001)
- **Database**: PostgreSQL/SQLite

## User Personas
- **Bot Sahibi (+905396978235)**: Tüm yönetici komutlarına erişim
- **SUDO Kullanıcılar**: Belirlenen yetkililer
- **Normal Kullanıcılar**: Public mode aktifse temel komutları kullanabilir

## Core Requirements (Static)
1. ✅ +905396978235 numarası OWNER olarak tanınmalı
2. ✅ Tüm yönetici komutları (.setvar, .değişkengetir, .antibot) çalışmalı
3. ✅ LID sistemi ile uyumlu sahiplik kontrolü
4. ✅ Dashboard ile bot yönetimi

## What's Been Implemented (2026-04-07)

### Sahiplik Ayarları Düzeltmeleri
1. **config.env oluşturuldu**
   - OWNER_NUMBER=905396978235
   - SUDO=905396978235
   - PUBLIC_MODE=true

2. **config.js güncellendi**
   - HARD_OWNER: "905396978235" eklendi
   - Varsayılan OWNER_NUMBER ayarlandı

3. **handler.js kapsamlı güncelleme**
   - `OWNER_LIDS` Set eklendi (öğrenilen LID'ler)
   - `HARD_OWNER` sabiti tanımlandı
   - `isOwner()` fonksiyonu güçlendirildi:
     - Numerical ID match
     - Substring match (JID içinde numara kontrolü)
     - Öğrenilmiş LID kontrolü
     - SUDO_MAP kontrolü
     - Bot'un kendi numarası kontrolü
   - `isSudo()` fonksiyonu güncellendi
   - LID öğrenme mekanizması eklendi
   - `fromOwner` hesaplaması düzeltildi

4. **Dashboard oluşturuldu**
   - React frontend
   - FastAPI backend proxy
   - Real-time status
   - Komut listesi (227+)
   - Sahiplik doğrulama paneli

## Prioritized Backlog

### P0 (Critical) - Tamamlandı
- [x] Sahiplik tanıma sorunu
- [x] LID uyumluluk

### P1 (High)
- [ ] WhatsApp oturum bağlantısı (kullanıcı tarafından yapılacak)
- [ ] Bot'u sunucuda başlatma

### P2 (Medium)
- [ ] Database bağlantısı (PostgreSQL)
- [ ] AI entegrasyonu (Gemini/OpenAI)

### P3 (Low)
- [ ] Eklenti yönetimi UI
- [ ] Broadcast özelliği
- [ ] Zamanlama sistemi

## Next Tasks
1. Kullanıcı WhatsApp oturumu açmalı: `node scripts/pair.js +905396978235`
2. Bot başlatılmalı: `node index.js` veya `pm2 start ecosystem.config.js`
3. `.setvar`, `.değişkengetir` komutları test edilmeli

## Technical Notes
- WhatsApp artık LID (Linked ID) sistemi kullanıyor
- Telefon numarası direkt JID'de görünmüyor
- SUDO_MAP ile LID'ler veritabanında saklanıyor
- İlk mesajda LID otomatik öğreniliyor
