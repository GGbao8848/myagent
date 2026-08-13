// 本地 Agent 引擎：agent 核心（LLM + ReAct + 工具）在本机跑，数据经服务器 API 持久化（与 web 共享）
import type { BrowserWindow } from "electron";
import { tool } from "langchain";
import { z } from "zod";
import { runAgent, type AgentEvent } from "./runner.js";
import { createChatModel } from "./factory.js";
import { apiClient } from "../api.js";
import { ConfirmQueue } from "./confirm.js";
import { syncSkillsToLocal, runLocalSkillScript, type LocalSkill } from "../skill-sync.js";
import type { TimelineEntry } from "@br-agent/shared";

export type SecurityMode = "auto" | "dangerous_confirm" | "always_confirm";

type LocalEvent = AgentEvent | { event: "done" };

export class LocalAgentEngine {
  private sessions = new Map<string, AbortController>();
  private confirmQueue: ConfirmQueue;

  constructor(private win: BrowserWindow) {
    this.confirmQueue = new ConfirmQueue(win);
  }

  async chat(sessionId: string, content: string, securityMode: SecurityMode = "auto"): Promise<void> {
    if (this.sessions.has(sessionId)) {
      this.push(sessionId, { event: "error", content: "该会话正在生成中" });
      return;
    }
    const controller = new AbortController();
    this.sessions.set(sessionId, controller);
    try {
      // 1. 存用户消息（与 web 端共享）
      await apiClient.post(`/api/sessions/${sessionId}/messages`, { role: "user", content });

      // 2. 拉历史
      const detail = await apiClient.get<{ messages: Array<{ role: string; content: string }> }>(
        `/api/sessions/${sessionId}`
      );
      const history = detail.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      // 3. 拉活动模型配置（复用服务器配置）
      const active = await apiClient.get<{ model: string; baseUrl: string; apiKey: string }>(
        "/api/llm/providers/active-key"
      );

      // 4. 本地 agent（LLM 在本机调用）
      const model = createChatModel({ model: active.model, baseUrl: active.baseUrl, apiKey: active.apiKey });
      // 本机操作统一走 mcp_local_*（经服务器代理，白名单+审计）；本地直连工具已移除，不再注入
      // 同步公开 skill 到本地并注册为本地执行工具（脚本在客户端本地 skills 目录）
      const localSkills = await syncSkillsToLocal().catch(() => [] as LocalSkill[]);
      const skillTools = localSkills
        .filter((ls) => ls.scripts.length > 0)
        .flatMap((ls) =>
          ls.scripts.map((script) => {
            const toolName = `skill_${ls.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_${script.replace(/\.py$/, "")}`;
            return tool(
              async ({ args }: { args?: string[] }) => runLocalSkillScript(ls.id, script, args ?? []),
              {
                name: toolName,
                description: `${ls.description}（技能：${ls.name}，脚本 ${script}，本机执行。运行时可加 --help 查看该脚本支持的参数）`,
                schema: z.object({ args: z.array(z.string()).optional() }),
              }
            );
          })
        );
      // MCP 工具（经服务器执行，复用服务器 MCP 连接；客户端无需直连外网/内网 MCP）
      const mcpToolsInfo = await apiClient.get<Array<{ name: string; description: string; schema?: unknown }>>(
        "/api/mcp/tools"
      );
      const mcpTools = mcpToolsInfo.map((mt) =>
        tool(
          async (args: Record<string, unknown>) => {
            const r = await apiClient.post<unknown>("/api/mcp/tools/call", { toolName: mt.name, args });
            return JSON.stringify(r);
          },
          {
            name: `mcp_${mt.name}`,
            // 把参数 schema 放进描述，让 LLM 知道必填参数（如 search_memories 需要 query）
            description: `${mt.description}\n参数说明: ${JSON.stringify(mt.schema ?? {})}`,
            schema: z.object({}).passthrough(),
          }
        )
      );
      const tools = [...skillTools, ...mcpTools];
      // SKILL.md 引导：把各技能的 SKILL.md 注入 systemPrompt，让 agent 知道正确入口/流程（如报工用 report.py）
      const skillPrompt = localSkills
        .filter((ls) => ls.skilMd)
        .map((ls) => `\n\n## 技能：${ls.name}\n${ls.skilMd}\n`)
        .join("");
      const systemPrompt =
        "你是一个简洁的企业级 AI 助手，用中文回答。需要时使用提供的工具。本机文件读写/命令执行统一使用 mcp_local_* 工具（mcp_local_write_file/mcp_local_read_file/mcp_local_list_files/mcp_local_exec，作用于本机工作区，受白名单约束）；技能脚本用 skill_* 工具。" +
        "当需要用户的个人信息（账号/密码/偏好/身份/项目背景等）时，优先调用 mcp_search_memories 从记忆系统查询，查不到再询问用户；" +
        "对话中明确了值得长期记住的信息时，用 mcp_add_memory 记录（先 mcp_search_memories 确认未记录，避免重复添加）。" +
        skillPrompt;
      const result = await runAgent({
        model,
        tools,
        systemPrompt,
        messages: history,
        signal: controller.signal,
        onEvent: (evt) => this.push(sessionId, evt),
      });

      // 5. 存 assistant 消息
      await apiClient.post(`/api/sessions/${sessionId}/messages`, {
        role: "assistant",
        content: result.content || "(无回答)",
        thinking: result.thinking || null,
        timeline: result.timeline as unknown as TimelineEntry[],
      });
      this.push(sessionId, { event: "done" });
    } catch (e) {
      if (!controller.signal.aborted) {
        this.push(sessionId, { event: "error", content: (e as Error).message });
      }
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  stop(sessionId: string): void {
    const controller = this.sessions.get(sessionId);
    if (controller) {
      controller.abort();
      // 主动结束事件流（runAgent 中止后可能不再触发 onEvent 结束）
      this.push(sessionId, { event: "done" });
    }
  }

  /** 工具确认响应（渲染进程用户点击后） */
  respondConfirm(callId: string, approved: boolean): void {
    this.confirmQueue.respond(callId, approved);
  }

  private push(sessionId: string, evt: LocalEvent): void {
    if (!this.win.isDestroyed()) this.win.webContents.send("agent:event", { sessionId, ...evt });
  }
}
