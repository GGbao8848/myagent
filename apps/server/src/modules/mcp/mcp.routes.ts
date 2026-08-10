// MCP 服务器模块：路由
import type { FastifyInstance } from "fastify";
import {
  listMcpServers,
  createMcpServer,
  updateMcpServer,
  testConnection,
  setMcpEnabled,
  deleteMcpServer,
  type CreateMcpServerInput,
} from "./mcp.service.js";

export function registerMcpRoutes(app: FastifyInstance): void {
  // 服务器列表（公共 + 当前用户私有）
  app.get("/api/mcp/servers", async (request) => {
    const user = request.authUser!;
    return listMcpServers(user.username);
  });

  // 添加服务器（configJson 或逐字段）
  app.post<{ Body: CreateMcpServerInput }>("/api/mcp/servers", async (request, reply) => {
    const user = request.authUser!;
    try {
      return await createMcpServer(user.username, request.body ?? {});
    } catch (e) {
      reply.code(400).send({ error: (e as Error).message });
      return;
    }
  });

  // 编辑服务器（configJson 或逐字段；私有仅本人、公共仅管理员）
  app.patch<{ Params: { id: string }; Body: CreateMcpServerInput }>(
    "/api/mcp/servers/:id",
    async (request, reply) => {
      const user = request.authUser!;
      try {
        return await updateMcpServer(request.params.id, user.username, user.isAdmin, request.body ?? {});
      } catch (e) {
        const code = (e as { code?: number }).code === 403 ? 403 : 400;
        reply.code(code).send({ error: (e as Error).message });
        return;
      }
    }
  );

  // 连接测试，返回工具列表
  app.post<{ Params: { id: string } }>("/api/mcp/servers/:id/test", async (request, reply) => {
    const user = request.authUser!;
    try {
      return await testConnection(request.params.id, user.username);
    } catch (e) {
      reply.code(404).send({ error: (e as Error).message });
      return;
    }
  });

  // 启停
  app.post<{ Params: { id: string }; Body: { enabled?: boolean } }>(
    "/api/mcp/servers/:id/toggle",
    async (request, reply) => {
      const user = request.authUser!;
      if (typeof request.body?.enabled !== "boolean") {
        reply.code(400).send({ error: "缺少 enabled" });
        return;
      }
      await setMcpEnabled(request.params.id, user.username, request.body.enabled);
      return { ok: true };
    }
  );

  // 删除（仅自己的私有服务器）
  app.delete<{ Params: { id: string } }>("/api/mcp/servers/:id", async (request, reply) => {
    const user = request.authUser!;
    try {
      await deleteMcpServer(request.params.id, user.username);
      return { ok: true };
    } catch (e) {
      reply.code(404).send({ error: (e as Error).message });
      return;
    }
  });
}
