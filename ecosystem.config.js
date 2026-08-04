// BR-Agent PM2 生产部署配置（Windows Server）
// 启动：pm2 start ecosystem.config.js
// 说明：Windows 下避免 cmd/node 弹窗——
//       · script 一律走 node 直接加载（不经 npm.cmd）
//       · server 用 node --import tsx loader 进程内跑 TS，不 spawn 子 node（子进程会弹窗且 PM2 windowsHide 管不住）
const path = require("path");

// 仓库根 = 本配置文件所在目录
const ROOT = __dirname;
const NODE = process.execPath;
const TSX_LOADER = path.join(ROOT, "node_modules", "tsx", "dist", "loader.mjs");
const VITE_CLI = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

module.exports = {
  apps: [
    {
      name: "br-agent-server",
      cwd: path.join(ROOT, "apps", "server"),
      script: NODE,
      args: ["--import", `file:///${TSX_LOADER}`, "src/index.ts"],
      windowsHide: true, // Windows：隐藏 node 进程窗口（避免弹窗）
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
      windowsHide: true, // Windows：隐藏 node 进程窗口（避免弹窗）
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
