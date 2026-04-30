# Debian Bookworm (glibc 2.36) — enough for most prebuilt binaries.
# sqlite3 v6 prebuilt needs GLIBC_2.38 so we rebuild it from source.
# sharp uses its own bundled libvips via SHARP_IGNORE_GLOBAL_LIBVIPS=1.
FROM node:20-bookworm-slim

LABEL maintainer="Lades-Pro"
LABEL description="Lades-Pro WhatsApp Bot - Ultra Premium"

# Build tools + runtime deps
# NOTE: No libvips-dev needed — sharp will use its own bundled libvips.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git ffmpeg webp \
    libgbm1 libnss3 libatk-bridge2.0-0 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libcups2 libasound2 ca-certificates curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./

# Step 1: Install all packages using prebuilt binaries.
# Step 2: Rebuild ONLY sqlite3 from source so it links against
#         this container's glibc (solves GLIBC_2.38 mismatch).
# SHARP_IGNORE_GLOBAL_LIBVIPS=1 tells sharp to use its own bundled
# libvips instead of the system one — avoids all glib/vips header errors.
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
RUN npm install --production && \
    npm rebuild sqlite3 --build-from-source && \
    npm cache clean --force

COPY . .

RUN mkdir -p sessions temp plugins/utils

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
