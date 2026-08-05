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
import type { FormColumn, FormDto } from "@br-agent/shared";

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

/** 从 run_script 输出中提取【表单数据】JSON，组装成表格型 FormDto（skill 查询数据 → 系统渲染表格表单） */
export function extractFormFromScript(content: string): FormDto | null {
  try {
    const wrapped = JSON.parse(content) as { stdout?: string };
    const stdout = typeof wrapped.stdout === "string" ? wrapped.stdout : "";
    const m = stdout.match(/【表单数据】([\s\S]*?)【表单数据结束】/);
    if (!m) return null;
    const data = JSON.parse(m[1].trim()) as {
      date?: string;
      hours?: string;
      workTypes?: string[];
      commonTasks?: Record<string, Array<{ label: string; value: string }>>;
      recentProjects?: Array<{ label: string; value: string }>;
      recent?: { work_type?: string; phase_id?: string; phase_label?: string; content?: string; std_hours?: string; ovt_hours?: string };
    };
    const workTypeOptions = (data.workTypes ?? ["部门工作", "项目工时", "销售支持"]).map((w) => ({ label: w, value: w }));
    const recent = data.recent ?? {};
    const columns: FormColumn[] = [
      { key: "date", label: "报工日期", type: "text" },
      { key: "work_type", label: "工作类别", type: "select", options: workTypeOptions },
      { key: "project_id", label: "项目", type: "select", options: data.recentProjects ?? [] },
      { key: "phase_id", label: "任务/阶段", type: "select", dependsOn: ["work_type"], optionsBy: data.commonTasks ?? {} },
      { key: "content", label: "报工内容", type: "text" },
      { key: "std_hours", label: "标准工时", type: "number" },
      { key: "ovt_hours", label: "加班工时", type: "number" },
    ];
    const rows: Array<Record<string, string>> = [
      {
        date: data.date ?? "",
        work_type: recent.work_type ?? "部门工作",
        project_id: "",
        phase_id: recent.phase_id ?? "",
        content: recent.content ?? "",
        std_hours: recent.std_hours ?? data.hours ?? "8",
        ovt_hours: recent.ovt_hours ?? "0",
      },
    ];
    return {
      id: "report",
      title: "报工单",
      description: "已按最近报工模式预填，请核对修改后确认提交（可按天拆分多行明细；项目/任务可输入名称）。",
      submitLabel: "确认提交",
      addRowLabel: "+ 拆分（同日多明细）",
      columns,
      rows,
    };
  } catch {
    return null;
  }
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
      // 文本表单标记缓冲：【表单】{json}【表单结束】→ 解析成 form 事件（兜底路径）
      let formTagBuf = "";
      // run_script 检测：记录 --form-data 调用，工具结果到达时自动渲染表单
      let pendingFormArgs: string[] | null = null;
      // 本轮回合提取到的表单（持久化到 assistant 消息，刷新后重新渲染）
      let lastForm: FormDto | null = null;

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
            // thinking 流式累积：runAgent 异常时 result 无返回值，需靠累积的 thinking 持久化中间过程
            if (evt.event === "thinking") {
              assistantThinking += evt.content;
              reply.raw.write(sseFrame(evt));
              return;
            }
            // 文本表单标记提取：content 流中匹配【表单】...【表单结束】→ 转 form 事件，标记本身不展示
            if (evt.event === "content") {
              formTagBuf += evt.content;
              let m = formTagBuf.match(/【表单】([\s\S]*?)【表单结束】/);
              while (m) {
                const before = formTagBuf.slice(0, m.index);
                if (before) reply.raw.write(sseFrame({ event: "content", content: before }));
                try {
                  // 容忍 markdown 围栏与多余文字：先剥围栏，失败再提取首个 {...}
                  let raw = m[1].trim();
                  const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
                  if (fence) raw = fence[1].trim();
                  let form: unknown;
                  try {
                    form = JSON.parse(raw);
                  } catch {
                    const obj = raw.match(/\{[\s\S]*\}/);
                    if (!obj) throw new Error("no json");
                    form = JSON.parse(obj[0]);
                  }
                  reply.raw.write(sseFrame({ event: "form", form }));
                  lastForm = form as FormDto;
                } catch {
                  reply.raw.write(sseFrame({ event: "content", content: m[0] }));
                }
                formTagBuf = formTagBuf.slice((m.index ?? 0) + m[0].length);
                m = formTagBuf.match(/【表单】([\s\S]*?)【表单结束】/);
              }
              // flush 剩余非标记内容（保留未完成的【表单】前缀，等标记完整再解析）
              if (formTagBuf && !formTagBuf.includes("【表单】")) {
                reply.raw.write(sseFrame({ event: "content", content: formTagBuf }));
                formTagBuf = "";
              }
              return;
            }
            // skill 数据渲染：检测 run_script 的 --form-data，工具结果到达时自动渲染表单
            if (evt.event === "tool_call" && evt.tool_name === "run_script") {
              const args = (evt.args as { args?: string[] } | undefined)?.args ?? [];
              pendingFormArgs = args.includes("--form-data") ? args : null;
              reply.raw.write(sseFrame(evt));
              return;
            }
            if (evt.event === "tool_result" && evt.tool_name === "run_script" && pendingFormArgs && !evt.is_error) {
              const form = extractFormFromScript(evt.content);
              pendingFormArgs = null;
              if (form) {
                reply.raw.write(sseFrame({ event: "form", form }));
                lastForm = form;
                reply.raw.write(sseFrame({ event: "tool_result", tool_name: "run_script", content: "✅ 已生成报工表单，请核对后点击「确认提交」", is_error: false }));
                return;
              }
            }
            pendingFormArgs = null;
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

        // 持久化 assistant 消息（先移除文本表单标记，避免刷新后显示标记原文）
        assistantContent = assistantContent.replace(/【表单】[\s\S]*?【表单结束】/g, "").trim();
        const saved = await prisma.message.create({
          data: {
            sessionId,
            role: "assistant",
            content: assistantContent || "(无回答)",
            thinking: assistantThinking || null,
            timeline: assistantTimeline as never,
            form: lastForm as never,
          },
        });
        // 补发 message_id
        reply.raw.write(sseFrame({ event: "done", message_id: saved.id }));
        reply.raw.end();
      } catch (e) {
        const message = (e as Error).message;
        if (!controller.signal.aborted) {
          // 错误时也保存已生成内容（含 thinking 与错误文本），保证刷新后中间过程/报错可见
          const errText = `⚠️ ${message}`;
          const savedContent = assistantContent.replace(/【表单】[\s\S]*?【表单结束】/g, "").trim() || errText;
          await prisma.message.create({
            data: {
              sessionId,
              role: "assistant",
              content: savedContent,
              thinking: assistantThinking || null,
              timeline: assistantTimeline as never,
              form: lastForm as never,
            },
          });
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
