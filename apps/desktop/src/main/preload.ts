// Preload：向渲染进程暴露安全的 IPC 桥
import { contextBridge, ipcRenderer } from "electron";

const electronAPI = {
  login: () => ipcRenderer.invoke("auth:login"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  authStatus: () => ipcRenderer.invoke("auth:status"),
  apiRequest: (payload: unknown) => ipcRenderer.invoke("api:request", payload),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("settings:save", settings),
  chat: (sessionId: string, content: string) => ipcRenderer.invoke("agent:chat", { sessionId, content }),
  stop: (sessionId: string) => ipcRenderer.invoke("agent:stop", { sessionId }),

  // agent 事件流（本地 agent 引擎 → 渲染）
  onAgentEvent: (callback: (data: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  onTokenExpired: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("auth:token-expired", listener);
    return () => ipcRenderer.removeListener("auth:token-expired", listener);
  },
  // 单点登出：其他端（web/aimemory）登出触发 Keycloak back-channel → 本端也应退出
  onRemoteLogout: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("auth:logout-remote", listener);
    return () => ipcRenderer.removeListener("auth:logout-remote", listener);
  },
  onToolConfirm: (callback: (data: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on("agent:tool:confirm", listener);
    return () => ipcRenderer.removeListener("agent:tool:confirm", listener);
  },
  toolConfirmResponse: (callId: string, approved: boolean) =>
    ipcRenderer.invoke("tool:confirm:response", { callId, approved }),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
