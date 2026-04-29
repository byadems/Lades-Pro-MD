module.exports = {
  apps: [
    {
      name: "lades-pro",
      script: "index.js",
      // ─── 24/7 ULTRA PERFORMANS V8 AYARLARI ───────────────────────────
      // --max-old-space-size=384 : Heap sınırı — GC'nin sık tetiklenmesini
      //   sağlarken PM2 restart'a kadar yeterli headroom bırakır.
      // --expose-gc              : Manuel GC çağrısına izin ver (scheduler kullanır)
      // --optimize-for-size      : V8 daha küçük kod üretir, bellek ayak izi düşer.
      //   Marginal hız kaybı vs büyük bellek kazanımı: 24/7'de kritik.
      // --max-semi-space-size=16 : Young generation (nursery) boyutu 16MB.
      //   Kısa ömürlü objeler (mesaj parse, buffer) daha hızlı toplanır.
      // --no-compilation-cache   : JIT derleme cache'ini bellekte tutma.
      //   Disk-first felsefesiyle uyumlu: kod gerektiğinde yeniden derlenir.
      node_args: "--max-old-space-size=384 --expose-gc --optimize-for-size --max-semi-space-size=16 --no-compilation-cache",
      watch: false,
      ignore_watch: ["node_modules", "sessions", "plugins/ai-generated", "*.log", "temp", "scratch"],
      max_memory_restart: "480M", // 380M→480M: 24/7 için daha geniş tolerans, gereksiz restart döngüsü önlenir
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
