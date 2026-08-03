// 对话页：会话列表 + 消息流水线 + SSE 流式（每会话独立运行，切换不中断）
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, chatStream } from "../api";
import type { MessageDto, SessionDto, SSEChatEvent, TimelineEntry } from "@br-agent/shared";

interface LocalMessage {
  id: string; // 本地临时 id 或服务端 id
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  timeline?: TimelineEntry[];
  streaming?: boolean;
  error?: string;
}

// 会话视图状态：可见消息 + 运行中的流式辅助状态（后台任务继续推进）
interface SessionState {
  messages: LocalMessage[];
  streaming: boolean; // 该会话是否正在生成（有活跃流）
  runningContent: string; // 后台运行时实时同步的正文（供切换查看）
  runningThinking: string;
  runningTimeline: TimelineEntry[];
  runningError?: string;
}

function emptySessionState(): SessionState {
  return { messages: [], streaming: false, runningContent: "", runningThinking: "", runningTimeline: [] };
}

// 每个进行中会话的流式控制状态（与 React 渲染分离，ref 保存）
interface FlowState {
  id: string;
  content: string;
  thinking: string;
  timeline: TimelineEntry[];
  error: string;
}

interface Props {
  activeSessionId: string | null;
  onSelectSession: (id: string | null) => void;
}

export default function DialogueView({ activeSessionId, onSelectSession }: Props) {
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [states, setStates] = useState<Record<string, SessionState>>({});
  const [input, setInput] = useState("");

  const flowsRef = useRef<Map<string, FlowState>>(new Map());
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);

  // states 的 ref 镜像：后台流回调与切换会话时读取最新基础状态，避免依赖过期
  const statesRef = useRef<Record<string, SessionState>>({});
  statesRef.current = states;

  const state = activeSessionId ? (states[activeSessionId] ?? emptySessionState()) : emptySessionState();
  const messages = state.messages;
  const streaming = state.streaming;

  const setStateFor = useCallback((id: string, updater: (s: SessionState) => SessionState) => {
    setStates((prev) => ({ ...prev, [id]: updater(prev[id] ?? emptySessionState()) }));
  }, []);

  // 加载会话列表
  useEffect(() => {
    api.listSessions().then(setSessions).catch(console.error);
  }, []);

  // 切换会话时加载历史消息（后台流由 ref 维护，不受影响）
  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    api
      .getSession(activeSessionId)
      .then((detail) => {
        if (cancelled) return;
        const flow = flowsRef.current.get(activeSessionId);
        const base = statesRef.current[activeSessionId] ?? emptySessionState();
        const persisted = detail.messages.map((m) => ({
          id: String(m.id),
          role: m.role,
          content: m.content,
          thinking: m.thinking ?? undefined,
          timeline: m.timeline ?? undefined,
        }));
        if (flow) {
          // 该会话有后台流：历史 + 实时已生成部分
          setStateFor(activeSessionId, () => ({
            messages: persisted,
            streaming: true,
            runningContent: flow.content,
            runningThinking: flow.thinking,
            runningTimeline: flow.timeline,
            runningError: flow.error,
          }));
        } else {
          setStateFor(activeSessionId, () => ({
            ...base,
            messages: persisted,
            streaming: false,
            runningContent: "",
            runningThinking: "",
            runningTimeline: [],
            runningError: undefined,
          }));
        }
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, setStateFor]);

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, state.runningContent]);

  // 智能新建会话：仅当没有正在使用的会话时创建空会话；否则直接聚焦已有会话
  const newSession = async () => {
    if (activeSessionId) {
      onSelectSession(activeSessionId);
      return;
    }
    const s = await api.createSession();
    setSessions((prev) => [s, ...prev]);
    onSelectSession(s.id);
  };

  const deleteSession = async (id: string) => {
    if (activeSessionId === id) {
      onSelectSession(null);
    }
    // 中止后端正在运行的生成（防止删除后任务继续空跑）
    api.stop(id).catch(() => {});
    await api.deleteSession(id);
    flowsRef.current.delete(id);
    controllersRef.current.delete(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setStates((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const send = async (sessionId: string, content: string) => {
    // 追加用户消息 + 空的 assistant 占位
    const userMsg: LocalMessage = { id: "u" + sessionId + Date.now(), role: "user", content };
    const assistantId = "a" + sessionId + Date.now();
    setStateFor(sessionId, (s) => ({
      ...s,
      messages: [
        ...s.messages,
        userMsg,
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ],
      streaming: true,
      runningContent: "",
      runningThinking: "",
      runningTimeline: [],
      runningError: undefined,
    }));

    // 注册流控制状态
    const flow: FlowState = { id: assistantId, content: "", thinking: "", timeline: [], error: "" };
    flowsRef.current.set(sessionId, flow);

    const controller = new AbortController();
    controllersRef.current.set(sessionId, controller);

    // 同步流进度到 React 态（后台运行也持续更新，供切换会话时查看）
    const apply = () => {
      setStateFor(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === flow.id
            ? { ...m, content: flow.content, thinking: flow.thinking, timeline: flow.timeline, error: flow.error, streaming: true }
            : m
        ),
        runningContent: flow.content,
        runningThinking: flow.thinking,
        runningTimeline: flow.timeline,
        runningError: flow.error,
        streaming: true,
      }));
    };

    const finish = (messageId?: string | number) => {
      flowsRef.current.delete(sessionId);
      controllersRef.current.delete(sessionId);
      setStateFor(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => {
          if (m.id !== flow.id) return m;
          const finalId = messageId != null ? String(messageId) : flow.id;
          return { ...m, id: finalId, content: flow.content, thinking: flow.thinking, timeline: flow.timeline, error: flow.error, streaming: false };
        }),
        streaming: false,
        runningContent: "",
        runningThinking: "",
        runningTimeline: [],
        runningError: undefined,
      }));
      // 刷新会话列表（标题可能已改）
      api.listSessions().then(setSessions).catch(() => {});
    };

    const eventHandlers: Record<string, (evt: any) => void> = {
      thinking: (e) => {
        flow.thinking += e.content;
        apply();
      },
      content: (e) => {
        flow.content += e.content;
        apply();
      },
      tool_call: (e) => {
        flow.timeline.push({ type: "tool_call", name: e.tool_name, args: e.args, id: e.id });
        apply();
      },
      tool_result: (e) => {
        flow.timeline.push({ type: "tool_result", name: e.tool_name, content: e.content, isError: e.is_error });
        apply();
      },
      error: (e) => {
        flow.error = e.content;
        apply();
      },
      done: (e) => {
        finish(e.message_id);
      },
    };

    try {
      await chatStream(sessionId, content, (evt) => {
        const h = eventHandlers[evt.event];
        if (h) h(evt);
      }, controller.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        flow.error = (err as Error).message;
        apply();
        finish();
      } else {
        finish();
      }
    }
  };

  const stop = (sessionId: string) => {
    const controller = controllersRef.current.get(sessionId);
    if (controller) {
      controller.abort();
      api.stop(sessionId).catch(() => {});
    }
  };

  // 输入框发送绑定当前活动会话
  const handleSend = () => {
    const content = input.trim();
    if (!content || !activeSessionId || state.streaming) return;
    setInput("");
    send(activeSessionId, content);
  };

  return (
    <div className="flex flex-1 min-w-0 h-full">
      {/* 会话列表 */}
      <div className="w-56 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="p-3">
          <button
            onClick={newSession}
            className="w-full px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
          >
            + 新建会话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group px-3 py-2 cursor-pointer text-sm border-b border-gray-100 ${
                activeSessionId === s.id ? "bg-blue-50" : "hover:bg-gray-100"
              }`}
              onClick={() => onSelectSession(s.id)}
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-gray-800">
                  {s.title}
                  {states[s.id]?.streaming ? (
                    <span className="ml-1 text-blue-500 animate-pulse">●</span>
                  ) : null}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-1"
                >
                  删
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 消息区 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!activeSessionId ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              请选择或新建一个会话开始对话
            </div>
          ) : (
            <>
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {/* 该会话正在运行：实时同步后台进度 */}
              {streaming ? (
                <StreamingProgress
                  content={state.runningContent}
                  thinking={state.runningThinking}
                  timeline={state.runningTimeline}
                  error={state.runningError}
                />
              ) : null}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 输入区：停止按钮常驻（该会话运行中时） */}
        <div className="border-t border-gray-200 p-4 bg-white">
          {state.streaming ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400 animate-pulse">
                {activeSessionId ? "正在生成…" : "后台任务运行中…"}
              </span>
              {activeSessionId ? (
                <button
                  onClick={() => stop(activeSessionId)}
                  className="px-3 py-1.5 bg-red-50 text-red-600 rounded-md text-sm hover:bg-red-100"
                >
                  ■ 停止
                </button>
              ) : (
                <span className="text-xs text-gray-400">切回原会话查看/停止</span>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder="输入消息，Enter 发送"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || !activeSessionId}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-40"
              >
                发送
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 该会话运行中的实时进度
function StreamingProgress({ content, thinking, timeline, error }: {
  content: string;
  thinking: string;
  timeline: TimelineEntry[];
  error?: string;
}) {
  return (
    <div className="space-y-2 opacity-90">
      {thinking ? <ThinkingBlock text={thinking} /> : null}
      {timeline
        .filter((t) => t.type === "tool_call" || t.type === "tool_result")
        .map((t, i) => (
          <ToolBlock key={i} entry={t} />
        ))}
      {content ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : null}
      {error ? (
        <div className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-2">
          错误：{error}
        </div>
      ) : null}
      {!content && !thinking ? (
        <div className="text-gray-400 text-sm bg-white border border-gray-200 rounded-xl px-4 py-3 animate-pulse">
          思考中…
        </div>
      ) : null}
    </div>
  );
}

// 消息气泡
function MessageBubble({ message }: { message: LocalMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-blue-600 text-white rounded-xl px-4 py-2 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  const timeline = message.timeline ?? [];
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        {message.thinking ? <ThinkingBlock text={message.thinking} /> : null}
        {timeline
          .filter((t) => t.type === "tool_call" || t.type === "tool_result")
          .map((t, i) => (
            <ToolBlock key={i} entry={t} />
          ))}
        {message.content ? (
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        ) : null}
        {message.error ? (
          <div className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-2">
            错误：{message.error}
          </div>
        ) : null}
        {message.streaming && !message.content ? (
          <div className="text-gray-400 text-sm bg-white border border-gray-200 rounded-xl px-4 py-3 animate-pulse">
            思考中…
          </div>
        ) : null}
      </div>
    </div>
  );
}

// 思考块（默认折叠，点击展开）
function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-1.5 flex items-center justify-between text-gray-500 hover:bg-gray-100"
      >
        <span>💭 思考过程</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <pre className="px-3 py-2 text-gray-600 whitespace-pre-wrap max-h-60 overflow-y-auto">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

// 工具块（默认折叠，点击展开）
function ToolBlock({ entry }: { entry: Extract<TimelineEntry, { type: "tool_call" }> | Extract<TimelineEntry, { type: "tool_result" }> }) {
  const [open, setOpen] = useState(false);
  if (entry.type === "tool_call") {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg overflow-hidden text-xs">
        <button
          onClick={() => setOpen(!open)}
          className="w-full px-3 py-1.5 flex items-center justify-between text-amber-700 hover:bg-amber-100"
        >
          <span>🔧 调用工具：{entry.name}</span>
          <span>{open ? "▲" : "▼"}</span>
        </button>
        {open ? (
          <pre className="px-3 py-2 text-amber-800 whitespace-pre-wrap max-h-40 overflow-y-auto">
            {JSON.stringify(entry.args, null, 2)}
          </pre>
        ) : null}
      </div>
    );
  }
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-1.5 flex items-center justify-between text-green-700 hover:bg-green-100"
      >
        <span>📦 工具结果：{entry.name}</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <pre className="px-3 py-2 text-green-800 whitespace-pre-wrap max-h-40 overflow-y-auto">
          {entry.content}
        </pre>
      ) : null}
    </div>
  );
}
