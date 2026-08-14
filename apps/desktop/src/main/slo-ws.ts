// 单点登出推送：主进程常驻 WebSocket 连接 BR-Agent server 的 /api/ws/client，
// 收到 logout 消息 → 回调登出（清本地 token + 通知渲染层）。断线自动重连。
// 注意：Electron 33 内置 Node 20 无全局 WebSocket，必须用 ws 库。
import { app } from "electron";
import WebSocket from "ws";
import { apiClient } from "./api.js";
import { tokenStore } from "./token-store.js";

/** 服务端 → 客户端的消息（与 server client-gateway/types.ts 对齐，仅取本端用到的） */
type ServerToClientMessage = { type: "logout" } | { type: "pong" } | { type: "invoke"; callId: string; toolName: string; args: Record<string, unknown> } | { type: "error"; callId: string; message: string };

const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS = 60_000;
const PING_INTERVAL_MS = 25_000;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let backoff = RECONNECT_BASE_MS;
let stopped = false;

let onLogout: (() => void) | null = null;

/** 注册登出回调（渲染层切回登录页前，主进程先清本地 token） */
export function setLogoutHandler(fn: () => void): void {
  onLogout = fn;
}

function clearTimers(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (pingTimer) clearInterval(pingTimer);
  reconnectTimer = null;
  pingTimer = null;
}

function cleanup(): void {
  clearTimers();
  if (ws) {
    try {
      ws.onclose = null;
      ws.close();
    } catch {
      /* 忽略 */
    }
    ws = null;
  }
}

/** 登录后启动 SLO 监听；登出/退出时停止 */
export function startSloWatcher(): void {
  stopped = false;
  backoff = RECONNECT_BASE_MS;
  connect();
}

/** 登出后停止监听并断开连接 */
export function stopSloWatcher(): void {
  stopped = true;
  cleanup();
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoff);
  backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
}

function handleLogout(): void {
  // 清本地 token（web/aimemory 的 front-channel 已由 Keycloak 处理，桌面靠此推送）
  apiClient.setTokens("", "");
  tokenStore.clear();
  try {
    onLogout?.();
  } catch {
    /* 渲染层回调异常不影响清理 */
  }
}

function connect(): void {
  if (stopped || ws) return;
  const serverUrl = apiClient.serverUrl;
  const access = apiClient.accessToken;
  if (!serverUrl || !access) {
    scheduleReconnect();
    return;
  }
  let url: URL;
  try {
    url = new URL(serverUrl.replace(/^http/, "ws"));
    url.pathname = "/api/ws/client";
    url.searchParams.set("token", access);
  } catch {
    scheduleReconnect();
    return;
  }
  const socket = new WebSocket(url.toString());
  ws = socket;

  socket.onopen = () => {
    backoff = RECONNECT_BASE_MS; // 连上后重置退避
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    }, PING_INTERVAL_MS);
  };
  socket.onmessage = (evt) => {
    try {
      const msg = JSON.parse(String(evt.data)) as ServerToClientMessage;
      if (msg.type === "logout") handleLogout();
    } catch {
      /* 忽略非 JSON */
    }
  };
  socket.onclose = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    if (ws === socket) ws = null;
    scheduleReconnect();
  };
  socket.onerror = () => {
    try {
      socket.close();
    } catch {
      /* 忽略 */
    }
  };
}

/** 应用退出时断开 */
app.on("before-quit", () => {
  stopped = true;
  cleanup();
});
