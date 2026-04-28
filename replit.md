# Lades-Pro — WhatsApp Bot Framework

## Overview
Lades-Pro is an ultra-premium, open-source WhatsApp bot framework built on the [Baileys](https://github.com/WhiskeySockets/Baileys) library. It features a built-in web dashboard for managing sessions, plugins, commands, and configuration.

## Tech Stack
- **Runtime**: Node.js >= 20.0.0
- **WhatsApp Library**: @whiskeysockets/baileys
- **Database**: Sequelize ORM with SQLite (default) or PostgreSQL
- **Web Framework**: Express.js (dashboard + health checks)
- **AI Integration**: Google Gemini, OpenAI, Groq
- **Media Processing**: FFmpeg (via ffmpeg-static), Sharp
- **Logging**: Pino

## Architecture
- `index.js` — Main bot entry point (WhatsApp session manager + keep-alive server)
- `scripts/dashboard.js` — Web dashboard server (Express, port 5000 in dev / PORT env var)
- `config.js` — Central configuration (reads from `config.env` or `.env`)
- `core/` — Bot engine (bot.js, handler.js, database.js, manager.js, etc.)
- `plugins/` — Modular command plugins
- `public/` — Dashboard frontend (HTML/CSS/JS)
- `migrations/` — Sequelize database migrations
- `sessions/` — Auth session files (gitignored)

## Running the App

### Dashboard (Web UI — port 5000)
```bash
PORT=5000 node --no-warnings scripts/dashboard.js
```

### Bot (WhatsApp connection)
```bash
node --no-warnings --expose-gc --max-old-space-size=300 index.js
```

## Configuration
Copy `config.env.example` to `config.env` and fill in values:
- `BOT_NAME` — Bot display name
- `OWNER_NUMBER` — Owner's phone number with country code
- `PREFIX` — Command prefix (default: `.`)
- `GEMINI_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` — AI API keys
- `DATABASE_URL` — PostgreSQL URL (optional; SQLite used by default)
- `PAIR_PHONE` — Phone number for pairing (optional)

## Workflow
The Replit workflow runs `PORT=5000 node --no-warnings --expose-gc --max-old-space-size=300 index.js` (master) which forks `scripts/dashboard.js` as a child via `core/dashboard-bridge.js`. IPC carries QR/auth/log/status events both ways.

## Notes
- The `chcp 65001` commands in `package.json` scripts are Windows-only and are ignored on Linux/Replit.
- Sessions are stored in `sessions/` (gitignored). Hybrid auth: env → DB → files (DB is the source of truth after first login).
- SQLite database stored at `database.sqlite`. PostgreSQL pool capped at `max=3` for memory efficiency.

## Recent Improvements (2026-04-26 — Stability/Speed/Light Refactor)
- **Auth latency**: `/api/auth/qr` & `/api/auth/pair` no longer use 1s for-loop polling. EventEmitter-based `waitForAuthOutcome()` resolves immediately when QR/code is ready.
- **Concurrency guard**: `_authInFlight` flag prevents two parallel auth flows from corrupting shared state (returns HTTP 409).
- **IPC heartbeat**: `dashboard_status_polling` interval reduced 5s → 30s. Real-time status changes already propagate via `manager.on('status')`; polling is just a sync-drift heartbeat.
- **IPC listener safety**: `_dashboardRef.setMaxListeners(100)` to prevent EventEmitter warnings under parallel sendIPC bursts.
- **Audio I/O cache**: `sendBanAudio()` in `plugins/uyari_sistemi.js` and twice in `plugins/grup_yonetimi.js` now uses async `fs.promises.readFile` + module-level buffer cache. Eliminates sync disk I/O on every ban event.
- **Ban sesi dosyası eklendi**: `plugins/utils/sounds/Ban.mp3` eksikti (dizin bile yoktu); ffmpeg ile 0.7s descending-tone ban efekti oluşturuldu ve `plugins/utils/sounds/` dizinine yerleştirildi. `.at` / `.ban` komutlarında artık ses çalacak.
- **Error visibility**: empty `catch{}` in `core/handler.js` (group + groupParticipants handlers) and `core/bot.js` (queue fallback) replaced with `logger.debug/warn/error` calls. Uses safe `e?.message || String(e)` pattern.
- **Reconnect policy (HOTFIX)**: `core/bot.js` connection-close handler now classifies `DisconnectReason` codes (Hermit-bot + KnightBot-Mini referansı). **Permanent** (loggedOut 401 / forbidden 403 / connectionReplaced 440 / multideviceMismatch 411 / badSession 500) → no naive retry. `connectionReplaced` & `forbidden` → suspend session, notify dashboard, do NOT reconnect (prevents infinite ping-pong with another active device). `loggedOut`/`multideviceMismatch`/`badSession` → clearState + fresh QR. **Fast-retry transient** (restartRequired 515 / connectionClosed 428 / connectionLost 408 / unavailableService 503) → fixed 3s delay, retry-count capped at 1 (these are normal handshake events). Defansif statusCode extraction (3 fallback paths). Intentional logout cleanup runs even when session is suspended. Stale WebSocket explicitly closed before re-spawn.
- **Group metadata cache (rate-limit fix)**: `makeWASocket` now receives a `cachedGroupMetadata` callback backed by an LRU (200 groups × 5 min TTL). Additionally, `sock.groupMetadata` is wrapped to populate the same cache for all plugin calls. `groups.update` and `group-participants.update` events invalidate cache entries. Eliminates `rate-overlimit` errors that previously broke message delivery in 60+ groups (root cause of WhatsApp's "Mesaj bekleniyor" pending balloon).
- **Browser fingerprint → macOS/Safari**: `browser: Browsers.macOS('Safari')` (was `['Chrome', 'Windows', '10.0']`). KnightBot-Mini-style fingerprint that WhatsApp's multi-device correlation algorithm flags least often → less aggressive session invalidation, longer-lived pairings. Cosmetic change in WhatsApp's "Linked Devices" list (shows "Safari (Mac OS)"); existing sessions stayed valid because the device is identified by registration ID, not browser string.
- **Init-query bypass (CRITICAL)**: `fireInitQueries: false` set on `makeWASocket`. On Replit network, Baileys' `chats.js fetchProps` + `presenceSubscribe` repeatedly timed out (60-90s), and during that window Baileys' event-buffer **withheld `messages.upsert` events** — so the handler never fired and the bot appeared dead even though the socket was open. Disabling init queries skips these non-essential bootstrap requests; messaging works normally and event-buffer flushes immediately. `defaultQueryTimeoutMs` reverted to 60s (no longer hit).
- **Log silencing for benign rate-limits**: `plugins/yonetim_araclari.js` antilink delete/kick `catch` blocks now suppress `rate-overlimit` and `forbidden` console spam (still logs unknown errors).
- **Workflow**: `index.js` is master entry; do NOT change it back to running `scripts/dashboard.js` directly — that breaks IPC handover after QR auth.

## Recent Additions (2026-04-27 — KnightBot-Mini Feature Adaptations)
- **`.otodurum` (Auto Status)**: `plugins/yonetim_araclari.js`'e eklendi. Bot tüm kişilerin WhatsApp durumlarını otomatik görüntüler ve isteğe bağlı tepki verir. `BotVariable` (DB cache 2dk) ile `AUTO_STATUS_ENABLED` + `AUTO_STATUS_REACT` toggle. `core/bot.js`'de `status@broadcast` interceptor.
- **`.sihirlikure` (Magic 8-Ball)**: `plugins/oyunlar.js`'e eklendi. 20 Türkçe cevap (olumlu/tarafsız/olumsuz). Soru girilmezse kullanım ipucu gösterir.
- **Adam Asmaca (Hangman)**: `plugins/oyunlar.js`'e eklendi. `.adamasmaca` yeni oyun başlatır (50+ Türkçe kelime), `.harf [X]` tahmin girer, `.adamasmacabitti` iptal eder. ASCII darağacı görseli, 10 dk timeout, sohbet başına izole state.
- **`plugins/utils/grupstat.js`** (yeni): In-memory günlük mesaj sayacı. `countMessage`, `getGroupStats`, `getTotalToday`, `getUserStats` API'leri. `core/bot.js`'den grup mesajlarında çağrılır.
- **`plugins/grup_istatistikleri.js`** (yeni): `.grupistatistikleri` (top 5 aktif üye, toplam mesaj, aktivite yüzdesi) ve `.aktivitem` (kişisel sıralama + yüzde). Sadece gruplarda çalışır. `groupMetadata` ile katılımcı adı çözümleme (fallback: numara).
- **`oyunlar.js` sözdizim düzeltmesi**: Önceki oturumda eklenen `sihirlikure/adamasmaca` bloğu fazladan `})();` kapanması bırakmıştı; giderildi.

## Recent Additions (2026-04-28 — `.ayarlar` Menüsü Yeniden Düzenlendi)
- **`.ayarlar` menüsü komut tabanlı**: `plugins/yonetim_araclari.js`'de menü artık numara yerine doğrudan komut adlarını listeler (`.antispam`, `.antisilme`, `.antibağlantı`, `.antikelime`, `.antinumara`, `.otogörüldü`). Numerik seçim (`.ayarlar 1`) ve "1=Aç / 2=Kapat" yanıt akışı tamamen kaldırıldı; alıntı yanıt dinleyicisi (`text` event handler içindeki üç blok) silindi.
- **`.otogörüldü` (Auto Read Receipts)**: Yeni `BotVariable` toggle (`AUTO_READ_ENABLED`). Hem `.otogörüldü aç/kapat` standalone komutu hem de `.ayarlar` menüsünden erişilebilir. `core/bot.js`'de `messages.upsert` döngüsünde 2dk DB cache'li (`getAutoReadState`); `notify` tipinde olup `fromMe` olmayan tüm gelen mesajları `sock.readMessages([msg.key])` ile mavi tik işaretler.
