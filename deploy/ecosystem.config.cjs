// ═════════════════════════════════════════════════════════════════════
// ChaoZhouBus (高校潮州同乡会大巴智能系统)
// PM2 生产级进程守护配置 (用于 VPS / 裸机直接部署)
// ═════════════════════════════════════════════════════════════════════

module.exports = {
  apps: [
    {
      name: 'chaozhoubus-server',
      cwd: './server',
      script: 'dist/src/index.js',
      // 重要架构说明：必须为 1 实例！
      // ChaoZhouBus 基于 Node.js 单线程事件循环 + better-sqlite3 WAL 模式下的同步排他事务 (db.transaction().immediate())
      // 实现微秒级内存串行防超卖锁座。单进程即可支撑每秒数千次选座抢票，多进程会引发跨进程 SQLite 文件锁竞争。
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env_production: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3000,
        SQLITE_DB_PATH: 'data/chaozhoubus.db',
        ADMIN_SECRET_TOKEN: 'chaozhou_admin_prod_secret_token_2026',
        LOCK_TTL_MS: 300000,
        MAX_SEATS_PER_USER: 2,
        ENABLE_FILE_LOGGING: 'true',
        LOG_FILE_PATH: 'logs/server.log',
      },
      output: './logs/pm2-out.log',
      error: './logs/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
}
