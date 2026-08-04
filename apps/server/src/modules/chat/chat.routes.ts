// 对话模块：SSE 流式对话 + 停止
import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/index.js";
import { runAgent } from "../../agent/runner.js";
import { createAgentTools } from "../../agent/tool-manager.js";
import { createChatModel } from "../../agent/factory.js";
import { loadConfig } from "../../config.js";
import { getActiveProvider } from "../llm/llm.service.js";
import { decryptKey } from "../llm/llm.crypto.js";
import { buildSkillPromptAsync } from "../skills/skills.service.js";
import { getProfilePrompt, extractObservationsAsync } from "../profile/profile.service.js";
import type { TimelineEntry } from "../../agent/runner.js";

// 进行中的生成（用于停止）
const inFlight = new Map<string, AbortController>();

// 全局并发上限：同时进行的对话生成数（防并发请求打挂服务），env 可配 MAX_CONCURRENT_GENERATIONS
const MAX_CONCURRENT_GENERATIONS = loadConfig().maxConcurrentGenerations;
const activeGenerations = new Set<string>();

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

      // 校验会话归属（回收站中的会话不可对话）
      const session = await prisma.session.findFirst({
        where: { id: sessionId, userId: user.username, deletedAt: null },
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

      // 全局并发上限：超过同时生成数时拒绝，防过载
      if (activeGenerations.size >= MAX_CONCURRENT_GENERATIONS) {
        reply.code(503).send({ error: "系统繁忙，请稍后再试" });
        return;
      }
      activeGenerations.add(sessionId);

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

      // 技能 + 用户画像注入 system prompt
      const [skillPromptResult, profilePrompt] = await Promise.all([
        buildSkillPromptAsync(user.username),
        getProfilePrompt(user.username),
      ]);
      const systemPrompt =
        "你是一个简洁的企业级 AI 助手，用中文回答。需要时使用提供的工具。" +
        skillPromptResult.prompt +
        profilePrompt;

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
        // 注入完整工具集：内置沙箱工具 + 用户启用 MCP 工具（ToolManager 统一注册）
        const tools = await createAgentTools(user.username);
        // 解析当前用户实际使用的 provider（用户私有默认 → 公共全局默认），无则报错
        const active = await getActiveProvider(user.username);
        if (!active) {
          reply.raw.write(
            sseFrame({ event: "error", content: "未配置可用模型，请在模型配置页设置默认模型" })
          );
          reply.raw.end();
          return;
        }
        const model = createChatModel({
          model: active.model,
          baseUrl: active.baseUrl,
          apiKey: active.apiKeyEnc ? decryptKey(active.apiKeyEnc) : undefined,
        });
        const result = await runAgent({
          systemPrompt,
          tools,
          model,
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
        activeGenerations.delete(sessionId);
        // 对话结束后异步提取用户偏好观察（fire-and-forget，不阻塞响应）
        if (!controller.signal.aborted) {
          void extractObservationsAsync(
            user.username,
            llmMessages.map((m) => ({ role: m.role, content: m.content }))
          );
        }
      }
    }
  );
}
