FROM node:20-slim

LABEL maintainer="Lades-Pro-MD"
LABEL description="Lades-Pro-MD WhatsApp Bot - Ultra Premium"

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git ffmpeg webp libgbm1 libnss3 libatk-bridge2.0-0 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libcups2 libasound2 ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Work directory
WORKDIR /app

# Copy package files first for caching
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --production --build-from-source && \
    npm cache clean --force

# Copy source files
COPY . .

# Create required directories
RUN mkdir -p sessions temp plugins/utils

# Environment defaults (override via platform env vars)
ENV PORT=3000 \
    NODE_ENV=production \
    DASHBOARD_PORT=3001

# Expose ports
EXPOSE 3000 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start command
CMD ["node", "--no-warnings", "--experimental-require-module", "index.js"]
