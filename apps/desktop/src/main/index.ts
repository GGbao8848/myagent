// Electron 主进程入口：窗口 + 认证 + REST 代理
import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { setupIpcHandlers, setAgentEngine } from "./ipc.js";
import { LocalAgentEngine } from "./agent/engine.js";
import { apiClient } from "./api.js";
import { DEFAULT_SERVER_URL, readPresetServerUrl, settingsStore } from "./store.js";
import { tokenStore } from "./token-store.js";
import { setLogoutHandler, startSloWatcher } from "./slo-ws.js";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "BR-Agent",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(join(__dirname, "../renderer/index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // 创建本地 agent 引擎（绑定窗口，事件经 IPC 推给渲染）
  setAgentEngine(new LocalAgentEngine(mainWindow));
}

app.whenReady().then(() => {
  // 初始化服务器地址（用户配置 → 打包预设 → 环境变量）与持久化 token
  let serverUrl =
    settingsStore.get().serverUrl || readPresetServerUrl() || DEFAULT_SERVER_URL || (process.env.BR_SERVER_URL || "");
  if (serverUrl && !settingsStore.get().serverUrl) {
    // 首启：把预设地址固化到本地 settings，避免依赖每次读 resources 文件
    settingsStore.save({ serverUrl });
  }
  if (serverUrl) {
    apiClient.setServerUrl(serverUrl);
    const tokens = tokenStore.load();
    if (tokens) {
      apiClient.setTokens(tokens.access, tokens.refresh);
      startSloWatcher(); // 已登录则监听单点登出
    }
  }

  apiClient.setOnTokenExpired(() => {
    if (mainWindow) mainWindow.webContents.send("auth:token-expired");
  });

  // 单点登出：Keycloak back-channel 推送 → 清本地 token + 通知渲染层回登录页
  setLogoutHandler(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("auth:logout-remote");
    }
  });

  setupIpcHandlers(() => mainWindow);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
