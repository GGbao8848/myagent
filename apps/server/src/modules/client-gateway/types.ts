// 客户端能力网关：WebSocket 协议类型
// 桌面客户端（Electron）在本机加载 MCP 工具（及未来内置本机工具），
// 经此协议注册到后端、接收调用指令并回传结果。

/** 客户端上报的工具 schema */
export interface ClientToolSchema {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
}

/** 客户端 → 后端 */
export type ClientToServerMessage =
  | { type: "register"; clientId: string; tools: ClientToolSchema[] }
  | { type: "invoke_result"; callId: string; result?: unknown; error?: string }
  | { type: "ping" };

/** 后端 → 客户端 */
export type ServerToClientMessage =
  | { type: "invoke"; callId: string; toolName: string; args: Record<string, unknown> }
  | { type: "pong" }
  | { type: "error"; callId: string; message: string };
