// 客户端能力网关：内存注册表 + 工具调用路由
// 管理每个用户已连接的桌面客户端与其注册的本机工具；
// agent 调用本机工具时经 WebSocket 下发指令，并等待客户端回传结果（同步 Promise）。
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { ClientToolSchema, ServerToClientMessage } from "./types.js";

const INVOKE_TIMEOUT_MS = 60_000;

interface ClientSession {
  ws: WebSocket;
  clientId: string;
  tools: ClientToolSchema[];
  connectedAt: number;
}

interface PendingInvocation {
  username: string;
  clientId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const sessions = new Map<string, Map<string, ClientSession>>();
const pending = new Map<string, PendingInvocation>();

function isOpen(ws: WebSocket): boolean {
  return ws.readyState === 1; // ws.OPEN
}

function send(ws: WebSocket, msg: ServerToClientMessage): void {
  if (isOpen(ws)) ws.send(JSON.stringify(msg));
}

export function registerClient(
  username: string,
  clientId: string,
  ws: WebSocket,
  tools: ClientToolSchema[]
): void {
  let byUser = sessions.get(username);
  if (!byUser) {
    byUser = new Map();
    sessions.set(username, byUser);
  }
  byUser.set(clientId, { ws, clientId, tools, connectedAt: Date.now() });
}

export function unregisterClient(username: string, clientId: string): void {
  const byUser = sessions.get(username);
  if (!byUser) return;
  byUser.delete(clientId);
  if (byUser.size === 0) sessions.delete(username);
}

/** 该用户所有已连接客户端注册的工具（供 createAgentTools 注入 agent） */
export function getClientToolsForUser(username: string): ClientToolSchema[] {
  const byUser = sessions.get(username);
  if (!byUser) return [];
  const tools: ClientToolSchema[] = [];
  for (const session of byUser.values()) tools.push(...session.tools);
  return tools;
}

/** 客户端断线时，reject 该客户端未完成的调用，避免 agent 挂起到超时 */
export function rejectUserClientPending(username: string, clientId: string): void {
  for (const [callId, p] of pending) {
    if (p.username === username && p.clientId === clientId) {
      pending.delete(callId);
      clearTimeout(p.timer);
      p.reject(new Error("本机工具调用失败：客户端已断开连接"));
    }
  }
}

/** 经 WS 调用某用户的某本机工具，返回 Promise（等待客户端回传） */
export function invokeTool(
  username: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const byUser = sessions.get(username);
  if (!byUser) {
    return Promise.reject(new Error(`本机工具 ${toolName} 不可用：客户端未连接`));
  }
  let target: ClientSession | null = null;
  for (const session of byUser.values()) {
    if (session.tools.some((t) => t.name === toolName)) {
      target = session;
      break;
    }
  }
  if (!target) {
    return Promise.reject(new Error(`本机工具 ${toolName} 未注册`));
  }
  if (!isOpen(target.ws)) {
    return Promise.reject(new Error(`本机工具 ${toolName} 不可用：客户端已断开连接`));
  }
  return new Promise((resolve, reject) => {
    const callId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(callId);
      reject(new Error(`本机工具 ${toolName} 执行超时（${INVOKE_TIMEOUT_MS / 1000}s）`));
    }, INVOKE_TIMEOUT_MS);
    pending.set(callId, { username, clientId: target.clientId, resolve, reject, timer });
    send(target.ws, { type: "invoke", callId, toolName, args });
  });
}

export function resolveInvocation(callId: string, result?: unknown, error?: string): void {
  const p = pending.get(callId);
  if (!p) return;
  pending.delete(callId);
  clearTimeout(p.timer);
  if (error) p.reject(new Error(error));
  else p.resolve(result);
}

/** 向所有已连接桌面客户端广播登出通知（Keycloak back-channel logout 触发，单点登出用） */
export function broadcastLogout(): void {
  for (const byUser of sessions.values()) {
    for (const session of byUser.values()) {
      try {
        send(session.ws, { type: "logout" });
      } catch {
        /* 单个客户端发送失败不影响其他 */
      }
    }
  }
}
