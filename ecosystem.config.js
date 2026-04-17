module.exports = {
  apps: [
    {
      name: "lades-pro",
      script: "index.js",
      watch: false,
      ignore_watch: ["node_modules", "sessions", "plugins/ai-generated", "*.log"],
      max_memory_restart: "500M",
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
