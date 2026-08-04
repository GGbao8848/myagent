// BR-Agent PM2 生产部署配置（Windows Server）
// 启动：pm2 start ecosystem.config.js
// 说明：server 用 npm run start（tsx，非 watch）；web 用 npm run preview（vite preview 服务 build 产物）
// Windows 下 script 必须用 npm.cmd（npm 在 Windows 无 .exe）
module.exports = {
  apps: [
    {
      name: "br-agent-server",
      cwd: "./apps/server",
      script: "npm.cmd",
      args: "run start",
      env: {
        NODE_ENV: "production",
      },
      max_restarts: 10, // 崩溃最多重启 10 次
      restart_delay: 3000, // 重启间隔 3s
      out_file: "./logs/server-out.log",
      error_file: "./logs/server-error.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "br-agent-web",
      cwd: "./apps/web",
      script: "npm.cmd",
      args: "run preview",
      env: {
        NODE_ENV: "production",
      },
      max_restarts: 10,
      restart_delay: 3000,
      out_file: "./logs/web-out.log",
      error_file: "./logs/web-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
