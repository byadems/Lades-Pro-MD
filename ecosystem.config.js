module.exports = {
  apps: [
    {
      name: "lades-pro",
      script: "index.js",
      // RAM OPT: --expose-gc: manuel GC çağrısına izin ver (index.js'de scheduler kullanır)
      // --max-old-space-size=300: Heap büyüyünce GC daha sık tetiklenir
      node_args: "--max-old-space-size=300 --expose-gc",
      watch: false,
      ignore_watch: ["node_modules", "sessions", "plugins/ai-generated", "*.log"],
      max_memory_restart: "380M", // 400M→380M: daha erken restart
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "15s",
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: "production",
        PM2_AUTO_RESTART: "true",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
