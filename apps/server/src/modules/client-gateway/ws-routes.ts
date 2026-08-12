// 客户端能力网关：WebSocket 路由（桌面客户端连接入口）
import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { verifyToken } from "../../auth/jwt.js";
import {
  registerClient,
  unregisterClient,
  resolveInvocation,
  rejectUserClientPending,
} from "./registry.js";
import type { ClientToServerMessage, ServerToClientMessage } from "./types.js";

export async function registerClientGatewayRoutes(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  app.get("/api/ws/client", { websocket: true }, async (socket, request) => {
    // 认证：优先用全局 onRequest 钩子已写入的 authUser；
    // 若 WS upgrade 未触发该钩子，fallback 用 query ?token= 手动校验。
    let user = request.authUser;
    if (!user) {
      const origin = `http://${request.headers.host ?? "localhost"}`;
      const token = new URL(request.url, origin).searchParams.get("token");
      if (!token) {
        socket.close(1008, "Unauthorized");
        return;
      }
      try {
        user = await verifyToken(token);
      } catch {
        socket.close(1008, "Unauthorized");
        return;
      }
    }
    const username = user.username;
    let clientId: string | null = null;

    socket.on("message", (raw) => {
      let msg: ClientToServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientToServerMessage;
      } catch {
        socket.send(
          JSON.stringify({ type: "error", callId: "", message: "消息不是合法 JSON" } satisfies ServerToClientMessage)
        );
        return;
      }
      try {
        switch (msg.type) {
          case "register":
            clientId = msg.clientId;
            registerClient(username, clientId, socket, msg.tools);
            break;
          case "invoke_result":
            resolveInvocation(msg.callId, msg.result, msg.error);
            break;
          case "ping":
            socket.send(JSON.stringify({ type: "pong" } satisfies ServerToClientMessage));
            break;
        }
      } catch (e) {
        socket.send(
          JSON.stringify({ type: "error", callId: "", message: (e as Error).message } satisfies ServerToClientMessage)
        );
      }
    });

    socket.on("close", () => {
      if (clientId) {
        rejectUserClientPending(username, clientId);
        unregisterClient(username, clientId);
      }
    });
  });
}
