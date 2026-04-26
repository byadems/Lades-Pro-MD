#!/usr/bin/env bash
# Post-merge setup for Lades-Pro
# Runs automatically after a task is merged into main.
# Keep it idempotent and fast.

set -euo pipefail

echo "[post-merge] Çalışma dizini: $(pwd)"

# 1) Eğer package-lock veya package.json değiştiyse bağımlılıkları senkronla.
if [ -f package.json ]; then
  echo "[post-merge] npm bağımlılıkları kontrol ediliyor..."
  # --no-audit / --no-fund hızlandırma; --omit=dev üretim çıktısını minimize eder
  npm install --no-audit --no-fund
fi

# 2) Eğer Sequelize migration klasörü varsa, taşıma kontrolü için bir uyarı bas.
# Bot başladığında migration'lar otomatik çalıştığı için burada ayrıca run etmiyoruz —
# salt-doğrulama amaçlı listeliyoruz.
if [ -d migrations ]; then
  COUNT=$(ls migrations 2>/dev/null | wc -l | tr -d ' ')
  echo "[post-merge] migrations/ dizininde $COUNT dosya var (bot başlangıcında uygulanır)."
fi

echo "[post-merge] Tamamlandı."
