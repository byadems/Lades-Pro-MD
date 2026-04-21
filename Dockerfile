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
    DASHBOARD_PORT=3001

EXPOSE 3000 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "--no-warnings", "--max-old-space-size=300", "--expose-gc", "index.js"]
