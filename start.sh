#!/bin/bash
# Vercel ortamında DATABASE_URL'i ortam değişkeninden oku
export DATABASE_URL="${DATABASE_URL:-}"

# Node.js uygulamasını başlat
NODE_ENV=development node --no-warnings --expose-gc --max-old-space-size=300 index.js
