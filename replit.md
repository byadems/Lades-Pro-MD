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
- **Error visibility**: empty `catch{}` in `core/handler.js` (group + groupParticipants handlers) and `core/bot.js` (queue fallback) replaced with `logger.debug/warn/error` calls. Uses safe `e?.message || String(e)` pattern.
- **Workflow**: `index.js` is master entry; do NOT change it back to running `scripts/dashboard.js` directly — that breaks IPC handover after QR auth.
