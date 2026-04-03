module.exports = {
  apps: [
    {
      name: "korat-kpi-api",
      script: "./dist/server.js",
      instances: process.env.PM2_INSTANCES || "max",
      exec_mode: "cluster",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 8809,
      },
    },
  ],
};
