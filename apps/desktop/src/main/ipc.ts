// IPC handlers：认证、REST 代理、设置
import { BrowserWindow, ipcMain } from "electron";
import { loginWithKeycloak } from "./auth.js";
import { apiClient } from "./api.js";
import { DEFAULT_SERVER_URL, readPresetServerUrl, settingsStore } from "./store.js";
import { tokenStore } from "./token-store.js";
import { parseServerUrl } from "./url.js";
import { LocalAgentEngine, type SecurityMode } from "./agent/engine.js";

let agentEngine: LocalAgentEngine | null = null;
export function setAgentEngine(engine: LocalAgentEngine): void {
  agentEngine = engine;
}

export function setupIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("auth:login", async () => {
    // 服务器地址打包时硬编码（DEFAULT_SERVER_URL），客户端零配置
    const serverUrl = settingsStore.get().serverUrl || DEFAULT_SERVER_URL;
    const tokens = await loginWithKeycloak(serverUrl);
    apiClient.setTokens(tokens.access, tokens.refresh);
    tokenStore.save(tokens);
    return { ok: true };
  });

  ipcMain.handle("auth:logout", () => {
    apiClient.setTokens("", "");
    tokenStore.clear();
    return { ok: true };
  });

  ipcMain.handle("auth:status", () => ({
    ok: apiClient.hasToken(),
    username: apiClient.username,
    isAdmin: apiClient.isAdmin,
  }));

  // renderer → 主进程 REST 代理（带 token + 401 自动刷新）
  ipcMain.handle(
    "api:request",
    (_event, payload: { method?: string; path?: string; body?: unknown }) => {
      const method = (payload?.method ?? "GET").toUpperCase();
      const path = payload?.path ?? "";
      return apiClient.request<unknown>(method, path, payload?.body);
    }
  );

  ipcMain.handle("settings:get", () => {
    const s = settingsStore.get();
    if (!s.serverUrl) s.serverUrl = readPresetServerUrl() || DEFAULT_SERVER_URL || undefined;
    return s;
  });

  ipcMain.handle("settings:save", (_event, payload: { serverUrl?: string }) => {
    const raw = (payload?.serverUrl ?? "").trim();
    if (!raw) return { ok: false, error: "服务器地址不能为空" };
    const { web } = parseServerUrl(raw);
    settingsStore.save({ serverUrl: web });
    apiClient.setServerUrl(web);
    return { ok: true };
  });

  // 本地 agent 对话（引擎在客户端本机跑）
  ipcMain.handle(
    "agent:chat",
    async (_event, payload: { sessionId?: string; content?: string; securityMode?: string }) => {
      if (!agentEngine) return { ok: false, error: "agent 引擎未就绪" };
      const sessionId = payload?.sessionId ?? "";
      const content = (payload?.content ?? "").trim();
      if (!sessionId || !content) return { ok: false, error: "参数不完整" };
      const mode = (payload?.securityMode ?? "auto") as SecurityMode;
      void agentEngine.chat(sessionId, content, mode);
      return { ok: true };
    }
  );

  ipcMain.handle("agent:stop", (_event, payload: { sessionId?: string }) => {
    agentEngine?.stop(payload?.sessionId ?? "");
    return { ok: true };
  });

  // 工具确认响应（渲染进程用户点击允许/拒绝）
  ipcMain.handle("tool:confirm:response", (_event, payload: { callId?: string; approved?: boolean }) => {
    agentEngine?.respondConfirm(payload?.callId ?? "", !!payload?.approved);
    return { ok: true };
  });
}
