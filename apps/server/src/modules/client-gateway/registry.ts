// 客户端连接注册表（CS 模式精简版）：仅维护已连接的桌面客户端 WebSocket 集合，
// 用于单点登出（SLO）广播。桌面端本地直连 MCP 后，本机工具注册/调用协议已移除。
import type { WebSocket } from "ws";
import type { ServerToClientMessage } from "./types.js";

const clients = new Set<WebSocket>();

function isOpen(ws: WebSocket): boolean {
  return ws.readyState === 1; // ws.OPEN
}

export function addClient(ws: WebSocket): void {
  clients.add(ws);
}

export function removeClient(ws: WebSocket): void {
  clients.delete(ws);
}

/** 向所有已连接桌面客户端广播登出通知（Keycloak back-channel logout 触发，单点登出用） */
export function broadcastLogout(): void {
  for (const ws of clients) {
    try {
      if (isOpen(ws)) ws.send(JSON.stringify({ type: "logout" } satisfies ServerToClientMessage));
    } catch {
      /* 单个客户端发送失败不影响其他 */
    }
  }
}
