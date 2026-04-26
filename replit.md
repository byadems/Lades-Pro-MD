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
The Replit workflow runs `PORT=5000 node --no-warnings scripts/dashboard.js` and exposes the dashboard at port 5000.

## Notes
- The `chcp 65001` commands in `package.json` scripts are Windows-only and are ignored on Linux/Replit.
- Sessions are stored in `sessions/` (gitignored).
- SQLite database stored at `database.sqlite`.
