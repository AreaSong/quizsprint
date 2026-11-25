const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "quizsprint",
      script: "./server.mjs",
      cwd: path.resolve(__dirname, ".."),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: 8787
        // 建议生产环境设置固定签名密钥与兜底管理密码：
        // AUTH_SECRET: "replace-with-random-long-secret",
        // ADMIN_PASSWORD: "replace-with-strong-password"
      }
    }
  ]
};
