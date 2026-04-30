# Northflank PostgreSQL deployment — slim image, no SQLite rebuild needed.
# Debian Bookworm (glibc 2.36) is sufficient for all prebuilt native bindings.
# sharp uses its own bundled libvips via SHARP_IGNORE_GLOBAL_LIBVIPS=1.
FROM node:20-bookworm-slim

LABEL maintainer="Lades-Pro"
LABEL description="Lades-Pro WhatsApp Bot — Northflank-ready (PostgreSQL)"

# Runtime + minimal build deps. ffmpeg/webp = medya pipeline. python3/make/g++
# sadece bağımlılıklar prebuilt binary bulamazsa (nadir) gerek olur; küçük
# bir ek yük ama daha güvenli build sağlar.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git ffmpeg webp \
    libgbm1 libnss3 libatk-bridge2.0-0 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libcups2 libasound2 ca-certificates curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./

# sharp kendi libvips'ini kullansın (sistem libvips kurmayız).
# --omit=optional → sqlite3'ü atla (Northflank'te PostgreSQL kullanılır).
# --omit=dev      → eslint vs. dev paketleri atla (image boyutu).
# Sonuç: build süresi ~1.5dk daha hızlı, image ~30MB daha küçük.
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
RUN npm install --omit=dev --omit=optional && npm cache clean --force

COPY . .

RUN mkdir -p sessions temp logs uploads downloads plugins/utils plugins/ai-generated

ENV PORT=3000 \
    NODE_ENV=production \
    DASHBOARD_PORT=3001 \
    UV_THREADPOOL_SIZE=4 \
    PQUEUE_CONCURRENCY=6 \
    PQUEUE_INTERVAL_CAP=15 \
    SCHEDULER_TICK_MS=20000 \
    PM2_RESTART_LIMIT_MB=380 \
    DISK_BUDGET_BYTES=2147483648

EXPOSE 3000 3001

# Healthcheck 0.2 vCPU'ya nazik: 60s aralık + 90s start grace + /ping (DB sorgusuz lightweight endpoint)
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 \
  CMD curl -fsS http://localhost:3000/ping || exit 1

# 0.2 vCPU / 512 MB için V8 + libuv tuning (ecosystem.config.js ile birebir aynı)
CMD ["node", \
  "--no-warnings", \
  "--max-old-space-size=240", \
  "--max-semi-space-size=4", \
  "--optimize-for-size", \
  "--no-compilation-cache", \
  "--expose-gc", \
  "--no-deprecation", \
  "index.js"]
