module.exports = {
  apps: [
    {
      name: "lades-pro",
      script: "index.js",
      // ─────────────────────────────────────────────────────────────────
      //  ULTRA-LOW RESOURCE: 0.2 vCPU / 512MB RAM / 2GB Disk
      //  400+ grup, 24/7 kesintisiz çalışma için optimize edildi
      // ─────────────────────────────────────────────────────────────────
      // --max-old-space-size=220 : Heap sınırı 220MB — native (ffmpeg/pg) için 250MB bırak
      //   Toplam: 220MB heap + ~200MB native = ~420MB. OOM korumalı.
      // --expose-gc              : Manuel GC çağrısına izin ver
      // --optimize-for-size      : V8 daha küçük kod üretir, bellek ayak izi düşer
      // --max-semi-space-size=4  : Young gen 4MB — daha sık minor GC, düşük peak RAM
      // --no-compilation-cache   : JIT cache bellekte tutulmasın
      // --gc-interval=50         : Her 50 allocation'da GC check — agresif temizlik
      // --lite-mode              : V8 lite mode — daha az optimize ama daha az RAM
      node_args: "--max-old-space-size=220 --expose-gc --optimize-for-size --max-semi-space-size=4 --no-compilation-cache --gc-interval=50 --lite-mode",
      watch: false,
      ignore_watch: ["node_modules", "sessions", "plugins/ai-generated", "*.log", "temp", "scratch", "uploads", "downloads"],
      max_memory_restart: "380M", // 220MB heap + ~160MB native = ~380MB güvenli restart eşiği
      restart_delay: 2000,        // 3s→2s: Daha hızlı recovery
      max_restarts: 50,           // 25→50: 24/7 uzun vadeli tolerans
      min_uptime: "45s",          // 30s→45s: Restart storm koruması güçlendirildi
      exp_backoff_restart_delay: 150, // 200→150: Daha hızlı backoff başlangıcı
      kill_timeout: 5000,         // Graceful shutdown için 5s timeout
      listen_timeout: 10000,      // Başlatma timeout'u
      env: {
        NODE_ENV: "production",
        PM2_AUTO_RESTART: "true",
        UV_THREADPOOL_SIZE: "4",  // 8→4: 0.2 vCPU için 4 thread yeterli, context switch azalır
        NODE_OPTIONS: "--no-warnings", // Uyarıları bastır, log kirliliği azalt
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,
      time: true,
      // Log rotasyonu — 2GB disk sınırı için kritik
      log_type: "json",
      // Crash durumunda otomatik restart
      autorestart: true,
    },
  ],
};
