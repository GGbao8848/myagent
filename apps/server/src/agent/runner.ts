// Agent 运行器：把 langchain v3 投影流转换为 SSE 事件
// 思考/正文规则（用户确认）：所有 AI 文本当"思考"，只有最后一次工具调用之后的文本作为"正文"。
// 流式实现：model 开启 streaming 后 msg.text 逐 chunk 到达，本文件逐 chunk 增量 emit，
//           前端据此实现打字机效果。用 </think> 分隔思考/正文，标签本身不展示。
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createAgent } from "./factory.js";

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

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const agent = createAgent({
    model: opts.model,
    tools: opts.tools,
    systemPrompt: opts.systemPrompt,
  });

  const timeline: TimelineEntry[] = [];
  let thinkingOut = ""; // 累计思考
  let contentOut = ""; // 最终正文

  const emit = async (evt: AgentEvent) => {
    await opts.onEvent(evt);
  };

  try {
    const run = await agent.streamEvents(
      { messages: opts.messages as never },
      { version: "v3", signal: opts.signal, recursionLimit: opts.recursionLimit ?? 30 } as never
    );

    // 阶段一：逐 chunk 消费 messages，增量 emit thinking/content（打字机效果）。
    // 每条消息先探测 toolCalls（可重复迭代）：带工具调用 → 全部当思考；
    // 否则按 </think> 边界切分：标签前 = 思考，标签后 = 正文，标签本身丢弃。
    for await (const msg of run.messages) {
      if (opts.signal?.aborted) break;

      // 探测本消息是否携带工具调用
      let hasTool = false;
      try {
        for await (const _tc of msg.toolCalls as AsyncIterable<unknown>) {
          hasTool = true;
          break;
        }
      } catch {
        /* 忽略 */
      }

      let buf = "";
      let boundary = -1; // buf 中 "</think>" 结束位置；-1 = 尚未出现
      for await (const chunk of msg.text as AsyncIterable<string>) {
        if (opts.signal?.aborted) break;
        if (!chunk) continue;
        buf += chunk;
        if (boundary < 0) {
          const idx = buf.indexOf("</think>");
          if (idx >= 0) boundary = idx + "</think>".length;
        }
        const chunkStart = buf.length - chunk.length;

        let thinkPart = "";
        let contentPart = "";
        if (hasTool || boundary < 0) {
          thinkPart = chunk;
        } else if (chunkStart >= boundary) {
          contentPart = chunk;
        } else {
          // chunk 跨越 </think> 边界：前半思考、后半正文（去掉正文前导空白）
          thinkPart = chunk.slice(0, boundary - chunkStart);
          contentPart = chunk.slice(boundary - chunkStart).replace(/^\s+/, "");
        }

        if (thinkPart) {
          const cleaned = thinkPart.replace(/<\/?think>/g, "");
          if (cleaned) {
            thinkingOut += cleaned;
            await emit({ event: "thinking", content: cleaned });
          }
        }
        if (contentPart) {
          contentOut += contentPart;
          await emit({ event: "content", content: contentPart });
        }
      }
    }

    // 阶段二：消费 toolCalls 流，发 tool_call + tool_result
    const runToolCalls = run.toolCalls as AsyncIterable<{
      name: string;
      callId: string;
      input: unknown;
      output: Promise<unknown> | unknown;
    }>;
    for await (const tc of runToolCalls) {
      if (opts.signal?.aborted) break;
      const name = tc.name;
      const input = (tc.input ?? {}) as Record<string, unknown>;
      await emit({ event: "tool_call", tool_name: name, args: input, id: tc.callId });
      timeline.push({ type: "tool_call", name, args: input, id: tc.callId });

      let outputText: string;
      let isError = false;
      try {
        const output = await tc.output;
        outputText = typeof output === "string" ? output : JSON.stringify(output ?? null);
      } catch (e) {
        outputText = (e as Error).message;
        isError = true;
      }
      await emit({ event: "tool_result", tool_name: name, content: outputText, is_error: isError });
      timeline.push({ type: "tool_result", name, content: outputText, isError });
    }

    // 阶段三：收尾 —— thinking/content 已全程增量 emit；补一条思考时间线记录
    if (thinkingOut.trim()) {
      timeline.push({ type: "thinking", content: thinkingOut });
    }

    return { thinking: thinkingOut, content: contentOut, timeline };
  } catch (e) {
    if (opts.signal?.aborted) {
      return { thinking: thinkingOut, content: contentOut, timeline };
    }
    const message = (e as Error).message;
    await emit({ event: "error", content: message });
    throw e;
  }
}
