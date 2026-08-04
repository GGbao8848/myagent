// 记忆画像模块：路由
import type { FastifyInstance } from "fastify";
import {
  listObservations,
  createObservation,
  updateObservation,
  deleteObservation,
} from "./profile.service.js";

export function registerProfileRoutes(app: FastifyInstance): void {
  // 观察列表
  app.get("/api/profile/observations", async (request) => {
    const user = request.authUser!;
    return listObservations(user.username);
  });

  // 新增观察
  app.post<{ Body: { content?: string } }>("/api/profile/observations", async (request, reply) => {
    const user = request.authUser!;
    try {
      return await createObservation(user.username, request.body?.content ?? "");
    } catch (e) {
      const code = (e as { code?: number }).code ?? 400;
      reply.code(code).send({ error: (e as Error).message });
      return;
    }
  });

  // 更新（confidence / enabled / content）
  app.patch<{ Params: { id: string }; Body: { content?: string; confidence?: number; enabled?: boolean } }>(
    "/api/profile/observations/:id",
    async (request, reply) => {
      const user = request.authUser!;
      try {
        return await updateObservation(request.params.id, user.username, request.body ?? {});
      } catch (e) {
        const code = (e as { code?: number }).code ?? 400;
        reply.code(code).send({ error: (e as Error).message });
        return;
      }
    }
  );

  // 删除
  app.delete<{ Params: { id: string } }>("/api/profile/observations/:id", async (request, reply) => {
    const user = request.authUser!;
    try {
      await deleteObservation(request.params.id, user.username);
      return { ok: true };
    } catch (e) {
      const code = (e as { code?: number }).code ?? 400;
      reply.code(code).send({ error: (e as Error).message });
      return;
    }
  });
}
