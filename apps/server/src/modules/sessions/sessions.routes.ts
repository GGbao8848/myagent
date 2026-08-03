// 会话模块：CRUD
import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/index.js";
import type { SessionDetailDto, SessionDto } from "@br-agent/shared";

function toDto(s: { id: string; title: string; createdAt: Date; updatedAt: Date }): SessionDto {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function registerSessionRoutes(app: FastifyInstance): void {
  // 会话列表
  app.get("/api/sessions", async (request) => {
    const user = request.authUser!;
    const sessions = await prisma.session.findMany({
      where: { userId: user.username },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return sessions.map(toDto);
  });

  // 新建会话
  app.post("/api/sessions", async (request) => {
    const user = request.authUser!;
    const session = await prisma.session.create({
      data: { userId: user.username, title: "新对话" },
    });
    return toDto(session);
  });

  // 会话详情（含消息）
  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    const user = request.authUser!;
    const session = await prisma.session.findFirst({
      where: { id: request.params.id, userId: user.username },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!session) {
      reply.code(404).send({ error: "会话不存在" });
      return;
    }
    const detail: SessionDetailDto = {
      ...toDto(session),
      messages: session.messages.map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        role: m.role as "user" | "assistant",
        content: m.content,
        thinking: m.thinking,
        timeline: m.timeline as SessionDetailDto["messages"][0]["timeline"],
        createdAt: m.createdAt.toISOString(),
      })),
    };
    return detail;
  });

  // 改标题
  app.patch<{ Params: { id: string }; Body: { title?: string } }>(
    "/api/sessions/:id",
    async (request, reply) => {
      const user = request.authUser!;
      const title = request.body?.title;
      if (!title?.trim()) {
        reply.code(400).send({ error: "标题不能为空" });
        return;
      }
      const session = await prisma.session.updateMany({
        where: { id: request.params.id, userId: user.username },
        data: { title: title.trim() },
      });
      if (session.count === 0) {
        reply.code(404).send({ error: "会话不存在" });
        return;
      }
      return { ok: true };
    }
  );

  // 删除会话
  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    const user = request.authUser!;
    const result = await prisma.session.deleteMany({
      where: { id: request.params.id, userId: user.username },
    });
    if (result.count === 0) {
      reply.code(404).send({ error: "会话不存在" });
      return;
    }
    return { ok: true };
  });
}
