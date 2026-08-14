// 客户端能力网关：WebSocket 协议类型（CS 模式精简版）
// 桌面客户端仅用于单点登出（SLO）：连接后发 ping 保活，收 logout 广播清本地 token。

/** 客户端 → 后端 */
export type ClientToServerMessage = { type: "ping" };

/** 后端 → 客户端 */
export type ServerToClientMessage =
  | { type: "pong" }
  | { type: "logout" } // 单点登出：Keycloak back-channel logout 触发，客户端应清除本地 token
  | { type: "error"; callId: string; message: string };
