// 对话模块：SSE 流式对话 + 停止
import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/index.js";
import { runAgent } from "../../agent/runner.js";
import { createBuiltinTools } from "../../agent/tools.js";
import { buildSkillPromptAsync } from "../skills/skills.service.js";
import type { TimelineEntry } from "../../agent/runner.js";

// 进行中的生成（用于停止）
const inFlight = new Map<string, AbortController>();

// 历史上下文裁剪：vLLM 32768 上下文，保留最近 N 轮
const MAX_HISTORY_MESSAGES = 20;

function sseFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function registerChatRoutes(app: FastifyInstance): void {
  // 停止生成
  app.post<{ Params: { id: string } }>("/api/sessions/:id/stop", async (request, reply) => {
    const controller = inFlight.get(request.params.id);
    if (controller) {
      controller.abort();
    }
    return { ok: true };
  });

  // SSE 流式对话
  app.post<{ Params: { id: string }; Body: { content?: string } }>(
    "/api/sessions/:id/chat",
    async (request, reply) => {
      const user = request.authUser!;
      const sessionId = request.params.id;
      const content = request.body?.content?.trim();
      if (!content) {
        reply.code(400).send({ error: "消息内容不能为空" });
        return;
      }

      // 校验会话归属
      const session = await prisma.session.findFirst({
        where: { id: sessionId, userId: user.username },
      });
      if (!session) {
        reply.code(404).send({ error: "会话不存在" });
        return;
      }

      // 如果该会话正在生成，拒绝新的请求
      if (inFlight.has(sessionId)) {
        reply.code(409).send({ error: "该会话正在生成中" });
        return;
      }

      const controller = new AbortController();
      inFlight.set(sessionId, controller);

      // 存用户消息
      await prisma.message.create({
        data: { sessionId, role: "user", content },
      });

      // 历史消息（裁剪）
      const history = await prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: "asc" },
        take: MAX_HISTORY_MESSAGES,
      });
      const llmMessages = history.map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));

      // 技能注入 system prompt
      const { prompt: skillPrompt } = await buildSkillPromptAsync(user.username);
      const systemPrompt =
        "你是一个简洁的企业级 AI 助手，用中文回答。需要时使用提供的工具。" + skillPrompt;

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let assistantContent = "";
      let assistantThinking = "";
      let assistantTimeline: TimelineEntry[] = [];

      try {
        const result = await runAgent({
          systemPrompt,
          tools: createBuiltinTools(),
          messages: llmMessages,
          signal: controller.signal,
          recursionLimit: 30,
          onEvent: (evt) => {
            reply.raw.write(sseFrame(evt));
          },
        });
        assistantContent = result.content;
        assistantThinking = result.thinking;
        assistantTimeline = result.timeline;

        // 自动改标题（首条消息后）
        const msgCount = await prisma.message.count({ where: { sessionId } });
        if (session.title === "新对话" && msgCount >= 1) {
          const title = content.length > 20 ? content.slice(0, 20) + "…" : content;
          await prisma.session.update({
            where: { id: sessionId },
            data: { title },
          });
        }

        // 持久化 assistant 消息
        const saved = await prisma.message.create({
          data: {
            sessionId,
            role: "assistant",
            content: assistantContent || "(无回答)",
            thinking: assistantThinking || null,
            timeline: assistantTimeline as never,
          },
        });
        // 补发 message_id
        reply.raw.write(sseFrame({ event: "done", message_id: saved.id }));
        reply.raw.end();
      } catch (e) {
        const message = (e as Error).message;
        if (!controller.signal.aborted) {
          // 错误时也尽量保存已生成内容
          if (assistantContent || assistantThinking) {
            await prisma.message.create({
              data: {
                sessionId,
                role: "assistant",
                content: assistantContent || "(生成中断)",
                thinking: assistantThinking || null,
                timeline: assistantTimeline as never,
              },
            });
          }
          reply.raw.write(sseFrame({ event: "error", content: message }));
        }
        reply.raw.end();
      } finally {
        inFlight.delete(sessionId);
      }
    }
  );
}
