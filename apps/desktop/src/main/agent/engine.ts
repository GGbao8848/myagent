// 本地 Agent 引擎：agent 核心（LLM + ReAct + 工具）在本机跑，数据经服务器 API 持久化（与 web 共享）
import type { BrowserWindow } from "electron";
import { tool } from "langchain";
import { z } from "zod";
import { MultiServerMCPClient, type Connection } from "@langchain/mcp-adapters";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { runAgent, type AgentEvent } from "./runner.js";
import { createChatModel } from "./factory.js";
import { apiClient } from "../api.js";
import { ConfirmQueue } from "./confirm.js";
import { syncSkillsToLocal, runLocalSkillScript, type LocalSkill } from "../skill-sync.js";
import type { McpServerDto, TimelineEntry } from "@br-agent/shared";

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
    // 本轮本地 MCP 连接（finally 关闭）
    const mcpClients: MultiServerMCPClient[] = [];
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
      // MCP 工具（客户端本地直连：拉取服务端配置清单 → 本地建 MCP 连接 → 注册 mcp_* 工具；
      // 服务端只做配置下发，不再代理执行。某服务器连不上则跳过该服务器，不阻断对话）
      const mcpServerList = await apiClient.get<McpServerDto[]>("/api/mcp/servers");
      const mcpTools: StructuredToolInterface[] = [];
      for (const s of mcpServerList) {
        if (!s.enabled) continue;
        const conn: Connection =
          s.type === "stdio"
            ? { type: "stdio", command: s.command, args: s.args }
            : {
                type: (s.type === "sse" ? "sse" : "http") as "http" | "sse",
                url: s.url,
                ...(Object.keys(s.headers).length > 0 ? { headers: s.headers } : {}),
              };
        // defaultToolTimeout：单次 MCP 工具调用超时（底层 60s 协议默认过短，显式给 120s），
        // 与 runner 的工具超时护栏一致；工具包装时透传 config（含 timeout）不丢弃。
        const client = new MultiServerMCPClient({ mcpServers: { [s.name]: conn }, defaultToolTimeout: 120_000 });
        try {
          const serverTools = await client.getTools();
          for (const t of serverTools) {
            mcpTools.push(
              tool(async (args, config) => t.invoke(args, config), {
                name: `mcp_${t.name}`,
                description: t.description,
                schema: (t.schema ?? z.object({}).passthrough()) as never,
              })
            );
          }
          mcpClients.push(client);
        } catch (e) {
          console.error(`[mcp] 服务器 ${s.name} 本地直连失败:`, (e as Error).message);
          client.close().catch(() => {});
        }
      }
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

      // 5. 存 assistant 消息（用户主动停止时不落库，避免留「(无回答)」或半截内容）
      if (!controller.signal.aborted) {
        await apiClient.post(`/api/sessions/${sessionId}/messages`, {
          role: "assistant",
          content: result.content || "(无回答)",
          thinking: result.thinking || null,
          timeline: result.timeline as unknown as TimelineEntry[],
        });
      }
      this.push(sessionId, { event: "done" });
    } catch (e) {
      if (!controller.signal.aborted) {
        this.push(sessionId, { event: "error", content: (e as Error).message });
        // 失败路径落库错误占位，与 web 端共享历史可见（避免会话只有 user 消息造成困惑）
        try {
          await apiClient.post(`/api/sessions/${sessionId}/messages`, {
            role: "assistant",
            content: `⚠️ ${(e as Error).message}`,
          });
        } catch {
          /* 落库失败不再二次报错 */
        }
      }
    } finally {
      // 关闭本轮本地 MCP 连接（下次对话重新建连，保证配置变更/服务器重启即时生效）
      for (const c of mcpClients) c.close().catch(() => {});
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
