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
  let thinkingOut = ""; // 累计思考（用于返回/存储）
  let contentOut = ""; // 最终正文
  let currentThinking = ""; // 当前思考段（未闭合，工具调用时闭合入 timeline）

  const emit = async (evt: AgentEvent) => {
    await opts.onEvent(evt);
  };

  try {
    const run = await agent.streamEvents(
      { messages: opts.messages as never },
      { version: "v3", signal: opts.signal, recursionLimit: opts.recursionLimit ?? 30 } as never
    );

    // 阶段一：交错推进 messages 与 toolCalls 两个投影流，实现"思考→工具→正文"实时弹出。
    // run.messages 每条消息先增量 emit 文本（思考/正文）；run.toolCalls 在工具一执行完
    // 就 yield（诊断证实），交错消费让工具块在工具执行完立即出现，而非攒到最后。
    const msgIter = (run.messages as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    const tcIter = (run.toolCalls as AsyncIterable<{
      name: string;
      callId: string;
      input: unknown;
      output: Promise<unknown> | unknown;
    }>)[Symbol.asyncIterator]();

    let msgDone = false;
    let tcDone = false;
    let msgNext: Promise<IteratorResult<unknown>> | null = null;
    let tcNext: Promise<
      IteratorResult<{ name: string; callId: string; input: unknown; output: Promise<unknown> | unknown }>
    > | null = null;

    const emitText = async (msg: unknown) => {
      if (opts.signal?.aborted) return;
      const m = msg as {
        toolCalls?: AsyncIterable<unknown>;
        reasoning?: AsyncIterable<string>;
        text: AsyncIterable<string>;
      };
      // 探测本消息是否携带工具调用（可重复迭代）
      let hasTool = false;
      try {
        if (m.toolCalls) {
          for await (const _tc of m.toolCalls) {
            hasTool = true;
            break;
          }
        }
      } catch {
        /* 忽略 */
      }

      // deepseek 等模型：思考在 reasoning 投影里（无 <think> 标签），text 是纯正文
      // qwen：无 reasoning，text 含 <think>...</think>，按 boundary 划分
      let reasoningConsumed = false;
      try {
        if (m.reasoning) {
          for await (const chunk of m.reasoning) {
            if (opts.signal?.aborted) break;
            if (!chunk) continue;
            reasoningConsumed = true;
            // 工具轮次：思考归 thinking；否则也归 thinking（reasoning 就是思考）
            const cleaned = chunk.replace(/<\/?think>/g, "");
            if (cleaned) {
              thinkingOut += cleaned;
              currentThinking += cleaned;
              await emit({ event: "thinking", content: cleaned });
            }
          }
        }
      } catch {
        /* 忽略 */
      }

      let buf = "";
      let thinkSeen = false; // text 中是否出现过 <think 标签（决定是否按 qwen 切分）
      let boundary = -1; // buf 中 "</think>" 结束位置；-1 = 尚未出现
      for await (const chunk of m.text) {
        if (opts.signal?.aborted) break;
        if (!chunk) continue;
        buf += chunk;
        if (!thinkSeen && buf.includes("<think")) thinkSeen = true;
        if (boundary < 0) {
          const idx = buf.indexOf("</think>");
          if (idx >= 0) boundary = idx + "</think>".length;
        }
        const chunkStart = buf.length - chunk.length;

        let thinkPart = "";
        let contentPart = "";
        if (hasTool) {
          // 工具轮次：模型文本全当思考（该轮不产生正文）
          thinkPart = chunk;
        } else if (reasoningConsumed) {
          // deepseek：思考已在 reasoning 投影消费，text 全当正文
          contentPart = chunk;
        } else if (!thinkSeen) {
          // 模型不用 <think> 标签（如中转 deepseek/OpenAI 兼容）：text 就是正文
          contentPart = chunk;
        } else if (boundary < 0) {
          // qwen：已见 <think> 但 </think> 未闭合 → 思考段
          thinkPart = chunk;
        } else if (chunkStart >= boundary) {
          // qwen：已闭合，此段在边界后 → 正文
          contentPart = chunk;
        } else {
          // qwen chunk 跨越 </think> 边界：前半思考、后半正文（去掉正文前导空白）
          thinkPart = chunk.slice(0, boundary - chunkStart);
          contentPart = chunk.slice(boundary - chunkStart).replace(/^\s+/, "");
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
    };

    const emitTool = async (tc: {
      name: string;
      callId: string;
      input: unknown;
      output: Promise<unknown> | unknown;
    }) => {
      if (opts.signal?.aborted) return;
      // 闭合当前思考段：工具调用前已产生的思考入 timeline，与工具交叉展示
      if (currentThinking.trim()) {
        timeline.push({ type: "thinking", content: currentThinking.trim() });
        currentThinking = "";
      }
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
    };

    // 确保两流都有 next() 在途；未 done 且未拉取时发起
    const start = (): void => {
      if (!msgDone && msgNext === null) msgNext = msgIter.next();
      if (!tcDone && tcNext === null) tcNext = tcIter.next();
    };

    start();
    while (!msgDone || !tcDone) {
      if (opts.signal?.aborted) break;
      start();
      const m = msgNext as Promise<IteratorResult<unknown>> | null;
      const t = tcNext as Promise<
        IteratorResult<{ name: string; callId: string; input: unknown; output: Promise<unknown> | unknown }>
      > | null;
      const jobs: Promise<
        | { which: "msg"; r: IteratorResult<unknown> }
        | {
            which: "tc";
            r: IteratorResult<{ name: string; callId: string; input: unknown; output: Promise<unknown> | unknown }>;
          }
      >[] = [];
      if (!msgDone && m) jobs.push(m.then((r) => ({ which: "msg", r })));
      if (!tcDone && t) jobs.push(t.then((r) => ({ which: "tc", r })));
      const won = await Promise.race(jobs);
      if (won.which === "msg") {
        msgNext = null;
        if (won.r.done) msgDone = true;
        else await emitText(won.r.value);
      } else {
        tcNext = null;
        if (won.r.done) tcDone = true;
        else await emitTool(won.r.value);
      }
    }

    // 阶段三：收尾 —— 闭合最后一段思考（若还有未闭合的）
    if (currentThinking.trim()) {
      timeline.push({ type: "thinking", content: currentThinking.trim() });
    }

    // 收尾兜底：qwen 偶发把整段回复包在 <think> 内且未闭合，导致 content 为空。
    // 此时把思考的最后一整段作为正文返回，避免前端出现"(无回答)"。
    let content = contentOut;
    if (!content.trim() && thinkingOut.trim()) {
      const segments = thinkingOut
        .split(/\n\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      content = segments[segments.length - 1] ?? "";
    }

    return { thinking: thinkingOut, content, timeline };
  } catch (e) {
    if (opts.signal?.aborted) {
      return { thinking: thinkingOut, content: contentOut, timeline };
    }
    const message = (e as Error).message;
    await emit({ event: "error", content: message });
    throw e;
  }
}
