module.exports = {
  apps: [
    {
      name: "lades-pro",
      script: "index.js",
      // ─── 0.2 vCPU / 512 MB / 2 GB disk V8 + libuv AYARLARI ─────────────
      // --max-old-space-size=240 : Heap sınırı 280→240MB.
      //     Hesap: 240(heap) + ~150(sharp/ffmpeg/sqlite3 native peak) +
      //     ~30 (libuv buffers) + ~40 (V8 code/stacks) = ~460MB peak RSS.
      //     512MB container'da ~50MB güvenli marj bırakır (OOM kill öncesi
      //     PM2 max_memory_restart bizi temiz şekilde indirir).
      // --max-semi-space-size=4  : Young gen 8→4MB. 0.2 vCPU'da küçük young
      //     gen daha sık ama çok daha kısa scavenge → event-loop blokajı azalır.
      // --optimize-for-size      : V8 daha küçük kod üretir.
      // --no-compilation-cache   : JIT cache'i diske/bellekte tutma.
      // --expose-gc              : Manuel GC için (scheduler kullanır).
      // --no-deprecation         : Baileys deprecation gürültüsünü kapat.
      node_args: "--max-old-space-size=240 --expose-gc --optimize-for-size --max-semi-space-size=4 --no-compilation-cache --no-deprecation",
      watch: false,
      ignore_watch: ["node_modules", "sessions", "plugins/ai-generated", "*.log", "temp", "scratch"],
      // 240MB heap + ~140MB native = ~380MB normal RSS. 400MB'da PM2 temiz
      // restart yapar — kernel OOM-kill öncesi durdurur. Üst sınır 460MB'a
      // ulaşmadan müdahale ederek "process killed (signal: 9)" senaryosunu
      // kesinlikle engeller. (Eski: 420MB → SIGKILL riski yüksekti.)
      max_memory_restart: "400M",
      restart_delay: 4000,         // 3s→4s: 0.2 vCPU'da cold start daha uzun, restart storm koruması
      max_restarts: 50,             // 25→50: 24/7'de geçici ağ hatalarına daha yüksek tolerans
      min_uptime: "45s",            // 30s→45s: 0.2 vCPU'da Baileys handshake 30s+ sürebilir
      exp_backoff_restart_delay: 500, // 200→500: Restart loop'unda hızlı backoff (1s, 2s, 4s, 8s...)
      kill_timeout: 8000,           // SIGTERM sonrası 8s graceful kapanış süresi
      listen_timeout: 30000,        // Yeni instance dinlemeye başlaması için 30s tolerans
      env: {
        NODE_ENV: "production",
        PM2_AUTO_RESTART: "true",
        // libuv thread pool: 0.2 vCPU'da 4 thread yeterli. Default 4'tür ama
        // explicit set ederek başka modüllerin (sharp vs.) override etmesini engelliyoruz.
        // 8'di → fazla thread = kontekst switch overhead'i + RAM (her thread ~512KB stack).
        UV_THREADPOOL_SIZE: "4",
        // 400+ grup için PQueue tuning (bot.js okur)
        PQUEUE_CONCURRENCY: "6",
        PQUEUE_INTERVAL_CAP: "15",
        // Scheduler tick (zamanlayici.js okur)
        SCHEDULER_TICK_MS: "20000",
        // PM2 bellek eşiği index.js de bunu okuyor
        PM2_RESTART_LIMIT_MB: "380",
        // Disk bütçesi 2GB
        DISK_BUDGET_BYTES: String(2 * 1024 * 1024 * 1024),
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
