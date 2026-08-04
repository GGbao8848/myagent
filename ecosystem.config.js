// BR-Agent PM2 生产部署配置（Windows Server）
// 启动：pm2 start ecosystem.config.js
// 说明：Windows 下直接跑 tsx/vite 的 js 入口（不经 npm.cmd/cmd.exe），避免弹出 cmd 窗口。
//       script 用绝对路径（基于仓库根），PM2 用 node 直接加载。
const path = require("path");

// 仓库根 = 本配置文件所在目录
const ROOT = __dirname;
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const VITE_CLI = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

module.exports = {
  apps: [
    {
      name: "br-agent-server",
      cwd: path.join(ROOT, "apps", "server"),
      script: TSX_CLI,
      args: "src/index.ts",
      env: {
        NODE_ENV: "production",
      },
      max_restarts: 10, // 崩溃最多重启 10 次
      restart_delay: 3000, // 重启间隔 3s
      out_file: path.join(ROOT, "logs", "server-out.log"),
      error_file: path.join(ROOT, "logs", "server-error.log"),
      merge_logs: true,
      time: true,
    },
    {
      name: "br-agent-web",
      cwd: path.join(ROOT, "apps", "web"),
      script: VITE_CLI,
      args: "preview",
      env: {
        NODE_ENV: "production",
      },
      max_restarts: 10,
      restart_delay: 3000,
      out_file: path.join(ROOT, "logs", "web-out.log"),
      error_file: path.join(ROOT, "logs", "web-error.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
