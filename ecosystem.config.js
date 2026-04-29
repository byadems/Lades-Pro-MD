module.exports = {
  apps: [
    {
      name: "lades-pro",
      script: "index.js",
      // ─── Cloud Run 0.2 vCPU / 512MB V8 AYARLARI ─────────────────────
      // --max-old-space-size=280 : Heap sınırı — 280MB heap + ~150MB native
      //   (sharp/ffmpeg/sqlite3) = ~430MB RSS. 512MB container'da güvenli.
      // --expose-gc              : Manuel GC çağrısına izin ver (scheduler kullanır)
      // --optimize-for-size      : V8 daha küçük kod üretir, bellek ayak izi düşer.
      // --max-semi-space-size=8  : Young generation 8MB — kısa ömürlü objeler hızlı toplanır.
      // --no-compilation-cache   : JIT derleme cache'ini bellekte tutma.
      // --gc-interval=100        : Her 100 allocation'da GC kontrolü — proaktif temizlik.
      node_args: "--max-old-space-size=280 --expose-gc --optimize-for-size --max-semi-space-size=8 --no-compilation-cache --gc-interval=100",
      watch: false,
      ignore_watch: ["node_modules", "sessions", "plugins/ai-generated", "*.log", "temp", "scratch"],
      max_memory_restart: "420M", // 280MB heap + ~140MB native overhead = ~420MB safe restart threshold
      restart_delay: 3000,        // 5s→3s: Restart sonrası daha hızlı geri dönüş
      max_restarts: 25,           // 10→25: 24/7 çalışma için uzun vadeli tolerans
      min_uptime: "30s",          // 15s→30s: Restart storm koruması (30s altında yaşayan instance restart sayılmaz)
      exp_backoff_restart_delay: 200, // 100→200: Backoff artışı daha yumuşak
      env: {
        NODE_ENV: "production",
        PM2_AUTO_RESTART: "true",
        UV_THREADPOOL_SIZE: "8", // libuv thread havuzu: DNS, fs, crypto paralel işlemleri hızlandır
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
