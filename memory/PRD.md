# Lades-Pro-MD WhatsApp Bot - PRD

## Original Problem Statement
BOT'U BAŞTAN AŞAĞI DERİNLEMESİNE VE KAPSAMLICA ANALİZ ET, +905396978235 OLAN NUMARANIN ONUN SAHİBİ OLDUĞUNU ÖĞRETENE KADAR KAPSAMLI KESİN %100 ÇALIŞACAK ÇÖZÜM UYGULA.

GitHub: https://github.com/byadems/Lades-Pro-MD

## Problem
WhatsApp bot komutları (.değişkengetir, .setvar, .antibot vb.) "yalnızca Yazılım Geliştiricim tarafından kullanılabilir" hatası veriyordu. Bunun nedeni WhatsApp'ın yeni LID (Linked ID) sistemi nedeniyle sahiplik kontrolünün başarısız olmasıydı.

## Architecture
- **Bot Framework**: Node.js + Baileys (WhatsApp Web API)
- **Dashboard**: Node.js Express (port 3001)
- **Frontend Proxy**: Node.js Express (port 3000)
- **Database**: Mock Sequelize (in-memory) - SQLite GLIBC sorunu nedeniyle

## User Personas
- **Bot Sahibi (+905396978235)**: Tüm yönetici komutlarına erişim
- **SUDO Kullanıcılar**: Belirlenen yetkililer
- **Normal Kullanıcılar**: Public mode aktifse temel komutları kullanabilir

## What's Been Implemented (2026-04-07)

### 1. Sahiplik Ayarları Düzeltmeleri
- **config.env**: `OWNER_NUMBER=905396978235`, `SUDO=905396978235`
- **config.js**: `HARD_OWNER: "905396978235"` eklendi
- **handler.js**: 
  - `participantPn` kullanımı eklendi (WhatsApp'ın sağladığı telefon numarası)
  - `OWNER_LIDS` Set ile LID öğrenme
  - Çoklu kontrol katmanı: participantPn → LID resolver → HARD_OWNER

### 2. Dashboard Güncellemeleri
- **scripts/dashboard.js**: Session dosyasından bağlantı durumu okuma
- Orijinal Lades-Pro-MD dashboard korundu
- Port 3000'de proxy ile erişim

### 3. Auth.js Güncellemesi
- Yerel session dosyalarını öncelikli kullanma
- `dashboard-auth` ve `lades-session` klasörlerinden creds.json okuma

### 4. Database Çözümü
- SQLite native binding GLIBC sorunu nedeniyle mock Sequelize
- In-memory veri deposu ile temel işlevsellik

## Test Results
- ✅ Dashboard: connected=true, phone=17788276641
- ✅ Config: OWNER_NUMBER=905396978235
- ✅ Commands: 227 komut yüklendi
- ✅ LID Resolution: participantPn aktif
- ✅ Owner Auth: Owner=true loglarında görülüyor

## Known Limitations
- Mock DB kullanıldığından veriler kalıcı değil (restart'ta sıfırlanır)
- PostgreSQL DATABASE_URL ile tam kalıcılık sağlanabilir

## Next Tasks
1. `.setvar`, `.değişkengetir`, `.antibot` komutlarını WhatsApp'tan test et
2. PostgreSQL bağlantısı ekle (opsiyonel)
3. GEMINI_API_KEY ekleyerek AI özellikleri aktifleştir

## Files Modified
- `/app/config.env` - Sahip numarası
- `/app/config.js` - HARD_OWNER ve mock DB
- `/app/core/handler.js` - participantPn ve gelişmiş sahiplik kontrolü
- `/app/core/auth.js` - Yerel session önceliği
- `/app/scripts/dashboard.js` - File-based bağlantı durumu
- `/app/frontend/package.json` - Proxy server
- `/app/frontend/server.js` - Dashboard proxy
