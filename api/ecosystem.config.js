module.exports = {
  apps: [
    {
      name: "korat-kpi-api",
      script: "./dist/server.js",
      // Cluster mode: ตั้ง PM2_INSTANCES ใน .env ให้สมดุลกับ CPU core และ MySQL max_connections
      //   total DB connections = instances × DB_POOL_LIMIT (default 75 ต่อ worker)
      //   แนะนำ: 2-4 instances สำหรับ ~100 user concurrent
      //   ถ้าใช้ "max" จะใช้ทุก core — ตรวจสอบ MySQL max_connections ≥ (core × 75) + buffer
      instances: process.env.PM2_INSTANCES || 2,
      exec_mode: "cluster",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      // graceful shutdown — ให้ in-flight requests จบก่อน worker ดับ
      kill_timeout: 5000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: "production",
        PORT: 8809,
      },
    },
  ],
};
