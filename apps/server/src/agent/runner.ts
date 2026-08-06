// Agent 运行器：手动 ReAct 循环（替代 langchain createAgent + streamEvents v3）
// 背景：createAgent 的 streamEvents v3 投影在部分 OpenAI 兼容 provider（如 tokenrhythm 中转站）
//       上会把 tool_call 的 id/name 解析成空串 —— 中转站按规范把后续增量 chunk 的 id/name
//       发成空串 ""，compat 累积逻辑 `if (toolChunk.id != null)` 用空串覆盖了首个 chunk 的
//       完整值，导致多轮请求里 assistant tool_calls / tool 消息的 tool_call_id 为空 → 400。
//       内网 qwen 后续 chunk 省略字段/null，所以不触发。
// 重构方案：用 model.bindTools().stream() 逐 chunk 手动 concat 聚合（concat 的 _mergeDicts
//       用 `if(value)` 判断，空串不覆盖 → id/name 保留），自己构造多轮消息、解析 tool_calls，
//       对 qwen / 中转站 / 官网 行为一致，彻底绕开 v3 投影 bug。
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { AIMessage, AIMessageChunk, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

export type AgentEvent =
  | { event: "thinking"; content: string }
  | { event: "content"; content: string }
  | { event: "tool_call"; tool_name: string; args: Record<string, unknown>; id: string }
  | { event: "tool_result"; tool_name: string; content: string; is_error?: boolean }
  | { event: "error"; content: string };

export interface TimelineEntry {
  type: "thinking" | "tool_call" | "tool_result";
  content?: string;
  name?: string;
  args?: Record<string, unknown>;
  id?: string;
  isError?: boolean;
}

export interface RunAgentResult {
  thinking: string;
  content: string;
  timeline: TimelineEntry[];
}

export interface RunAgentOptions {
  model?: BaseChatModel;
  tools?: StructuredToolInterface[];
  systemPrompt: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  signal?: AbortSignal;
  recursionLimit?: number;
  onEvent: (evt: AgentEvent) => void | Promise<void>;
}

/** 从消息文本中剥离 <think>/</think> 标签 */
export function splitThink(text: string): { thinking: string; content: string } {
  const end = text.indexOf("</think>");
  if (end >= 0) {
    const thinking = text.substring(0, end).replace(/<think>/g, "").trim();
    const content = text.substring(end + "</think>".length).trim();
    return { thinking, content };
  }
  return { thinking: "", content: text };
}

/** 工具调用 id 兜底：极少数 provider 首个 chunk 也无 id 时生成占位，避免 tool 消息 tool_call_id 为空 */
function ensureCallId(id: string | undefined): string {
  if (id && id.trim()) return id;
  return `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const model = opts.model;
  if (!model) throw new Error("runAgent: 缺少 model");
  const tools = opts.tools ?? [];
  const maxIterations = opts.recursionLimit ?? 30;
  // bindTools 只绑定工具 schema，可跨轮复用（ChatOpenAI 等模型必有此方法）
  const bindFn = (model as unknown as { bindTools?: (t: StructuredToolInterface[]) => unknown }).bindTools;
  if (typeof bindFn !== "function") throw new Error("runAgent: 模型不支持 bindTools");
  const bound = (await bindFn.call(model, tools)) as { stream: (m: never, c?: never) => AsyncIterable<AIMessageChunk> };

  const timeline: TimelineEntry[] = [];
  let thinkingOut = "";
  let contentOut = "";
  let currentThinking = "";
  const emit = async (evt: AgentEvent) => {
    await opts.onEvent(evt);
  };

  const messages: (BaseMessage | { role: string; content: string })[] = [
    { role: "system", content: opts.systemPrompt },
    ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  for (let iter = 0; iter < maxIterations; iter++) {
    if (opts.signal?.aborted) break;

    // 调用模型并逐 chunk 流式聚合（打字机效果 + id/name 保留）
    const stream = await bound.stream(messages as never, { signal: opts.signal } as never);
    let acc: AIMessageChunk | null = null;
    let reasoningSeen = false; // 出现过 reasoning_content（deepseek 类：text 即正文）
    // qwen <think> 跨 chunk 切分状态
    let buf = "";
    let thinkSeen = false;
    let boundary = -1;

    for await (const chunk of stream) {
      if (opts.signal?.aborted) break;
      const c = chunk as AIMessageChunk & { additional_kwargs?: { reasoning_content?: string } };
      acc = acc ? acc.concat(c) : c;

      // deepseek/中转站：思考在 reasoning_content，逐 chunk emit
      const rc = c.additional_kwargs?.reasoning_content;
      if (typeof rc === "string" && rc.trim()) {
        reasoningSeen = true;
        const cleaned = rc.replace(/<\/?think>/g, "");
        if (cleaned) {
          thinkingOut += cleaned;
          currentThinking += cleaned;
          await emit({ event: "thinking", content: cleaned });
        }
      }

      // 正文/思考：qwen 用 <think> 标签，deepseek 无标签 text 即正文
      const ct = typeof c.content === "string" ? c.content : "";
      if (!ct) continue;
      buf += ct;
      if (!thinkSeen && buf.includes("<think")) thinkSeen = true;
      if (boundary < 0) {
        const idx = buf.indexOf("</think>");
        if (idx >= 0) boundary = idx + "</think>".length;
      }
      const chunkStart = buf.length - ct.length;

      let thinkPart = "";
      let contentPart = "";
      if (reasoningSeen) {
        contentPart = ct;
      } else if (!thinkSeen) {
        contentPart = ct;
      } else if (boundary < 0) {
        thinkPart = ct;
      } else if (chunkStart >= boundary) {
        contentPart = ct;
      } else {
        thinkPart = ct.slice(0, boundary - chunkStart);
        contentPart = ct.slice(boundary - chunkStart).replace(/^\s+/, "");
      }

      if (thinkPart) {
        const cleaned = thinkPart.replace(/<\/?think>/g, "");
        if (cleaned) {
          thinkingOut += cleaned;
          currentThinking += cleaned;
          await emit({ event: "thinking", content: cleaned });
        }
      }
      if (contentPart) {
        contentOut += contentPart;
        await emit({ event: "content", content: contentPart });
      }
    }

    if (opts.signal?.aborted) break;
    if (!acc) throw new Error("模型无响应");

    const toolCalls = acc.tool_calls ?? [];
    if (toolCalls.length === 0) {
      // 最终轮：无工具调用，闭合思考段
      if (currentThinking.trim()) {
        timeline.push({ type: "thinking", content: currentThinking.trim() });
        currentThinking = "";
      }
      break;
    }

    // 工具轮：闭合思考段，执行工具，构造下一轮消息
    if (currentThinking.trim()) {
      timeline.push({ type: "thinking", content: currentThinking.trim() });
      currentThinking = "";
    }
    for (const tc of toolCalls) {
      if (opts.signal?.aborted) break;
      const name = tc.name;
      const id = ensureCallId(tc.id);
      const input = (tc.args ?? {}) as Record<string, unknown>;

      await emit({ event: "tool_call", tool_name: name, args: input, id });
      timeline.push({ type: "tool_call", name, args: input, id });

      let outputText: string;
      let isError = false;
      try {
        const t = tools.find((x) => x.name === name);
        if (!t) throw new Error(`工具不存在：${name}，可用工具：[${tools.map((x) => x.name).join(", ")}]`);
        const output = await t.invoke({ ...tc, type: "tool_call" } as never);
        outputText = typeof output === "string" ? output : JSON.stringify(output ?? null);
      } catch (e) {
        outputText = (e as Error).message;
        isError = true;
      }
      await emit({ event: "tool_result", tool_name: name, content: outputText, is_error: isError });
      timeline.push({ type: "tool_result", name, content: outputText, isError });

      // 追加 assistant(tool_calls) + tool(result) 到历史，供下一轮模型调用
      messages.push(new AIMessage({ content: typeof acc.content === "string" ? acc.content : "", tool_calls: [{ ...tc, id }] }));
      messages.push(new ToolMessage({ tool_call_id: id, content: outputText, name }));
    }
    if (opts.signal?.aborted) break;
  }

  // 收尾兜底：qwen 偶发把整段回复包在 <think> 内且未闭合，content 为空时取思考最后一段
  let content = contentOut;
  if (!content.trim() && thinkingOut.trim()) {
    const segments = thinkingOut
      .split(/\n\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    content = segments[segments.length - 1] ?? "";
  }

  return { thinking: thinkingOut, content, timeline };
}
