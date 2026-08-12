// 会话模块：CRUD + 回收站（软删除）
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
  // ── 静态路径需在 /:id 之前注册，避免被 :id 吞掉 ──

  // 回收站列表
  app.get("/api/sessions/trash", async (request) => {
    const user = request.authUser!;
    const sessions = await prisma.session.findMany({
      where: { userId: user.username, deletedAt: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return sessions.map(toDto);
  });

  // 清空回收站（彻底删除全部回收站会话，消息级联）
  app.delete("/api/sessions/trash", async (request) => {
    const user = request.authUser!;
    await prisma.session.deleteMany({
      where: { userId: user.username, deletedAt: { not: null } },
    });
    return { ok: true };
  });

  // 批量恢复回收站会话
  app.post<{ Body: { ids?: string[] } }>("/api/sessions/batch-restore", async (request, reply) => {
    const user = request.authUser!;
    const ids = request.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      reply.code(400).send({ error: "缺少 ids" });
      return;
    }
    await prisma.session.updateMany({
      where: { id: { in: ids }, userId: user.username, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    return { ok: true };
  });

  // 批量彻底删除（消息级联）
  app.delete<{ Body: { ids?: string[] } }>("/api/sessions/batch", async (request, reply) => {
    const user = request.authUser!;
    const ids = request.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      reply.code(400).send({ error: "缺少 ids" });
      return;
    }
    await prisma.session.deleteMany({
      where: { id: { in: ids }, userId: user.username },
    });
    return { ok: true };
  });

  // ── 带参数路由 ──

  // 会话列表（正常，不含回收站）
  app.get("/api/sessions", async (request) => {
    const user = request.authUser!;
    const sessions = await prisma.session.findMany({
      where: { userId: user.username, deletedAt: null },
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
      where: { id: request.params.id, userId: user.username, deletedAt: null },
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
        form: m.form as SessionDetailDto["messages"][0]["form"],
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
        where: { id: request.params.id, userId: user.username, deletedAt: null },
        data: { title: title.trim() },
      });
      if (session.count === 0) {
        reply.code(404).send({ error: "会话不存在" });
        return;
      }
      return { ok: true };
    }
  );

  // 删除会话（软删除 → 进回收站）
  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    const user = request.authUser!;
    const result = await prisma.session.updateMany({
      where: { id: request.params.id, userId: user.username, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      reply.code(404).send({ error: "会话不存在" });
      return;
    }
    return { ok: true };
  });

  // 本地 agent 桌面客户端：写入一条消息（user/assistant），与 web 端共享
  app.post<{
    Params: { id: string };
    Body: {
      role?: string;
      content?: string;
      thinking?: string | null;
      timeline?: unknown;
      form?: unknown;
    };
  }>("/api/sessions/:id/messages", async (request, reply) => {
    const user = request.authUser!;
    const sessionId = request.params.id;
    const body = request.body ?? {};
    const role = body.role;
    const content = body.content?.trim() ?? "";
    if (role !== "user" && role !== "assistant") {
      reply.code(400).send({ error: "role 必须为 user 或 assistant" });
      return;
    }
    if (!content) {
      reply.code(400).send({ error: "消息内容不能为空" });
      return;
    }
    const session = await prisma.session.findFirst({
      where: { id: sessionId, userId: user.username, deletedAt: null },
    });
    if (!session) {
      reply.code(404).send({ error: "会话不存在" });
      return;
    }
    const msg = await prisma.message.create({
      data: {
        sessionId,
        role,
        content,
        thinking: body.thinking ?? null,
        timeline: body.timeline as never,
        form: body.form as never,
      },
    });
    // 首条用户消息后自动改标题（与 chat.routes 一致）
    if (role === "user" && session.title === "新对话") {
      const title = content.length > 20 ? content.slice(0, 20) + "…" : content;
      await prisma.session.update({ where: { id: sessionId }, data: { title } });
    }
    reply.code(201).send({ id: msg.id, createdAt: msg.createdAt.toISOString() });
  });

  // 恢复回收站会话
  app.post<{ Params: { id: string } }>("/api/sessions/:id/restore", async (request, reply) => {
    const user = request.authUser!;
    const result = await prisma.session.updateMany({
      where: { id: request.params.id, userId: user.username, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (result.count === 0) {
      reply.code(404).send({ error: "回收站中不存在该会话" });
      return;
    }
    return { ok: true };
  });
}
