// 对话页：会话列表 + 消息流水线 + SSE 流式（每会话独立运行，切换不中断）
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, chatStream } from "../api";
import type { FormColumn, FormDto, FormFieldOption, MessageDto, SessionDto, SSEChatEvent, TimelineEntry } from "@br-agent/shared";

interface LocalMessage {
  id: string; // 本地临时 id 或服务端 id
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  timeline?: TimelineEntry[];
  streaming?: boolean;
  error?: string;
  form?: FormDto; // 表单卡片（agent 通过 request_form 输出，不持久化）
  formSubmitted?: boolean; // 本地标记：该表单已提交（禁用卡片）
}

// 会话视图状态：可见消息 + 是否在生成（流式内容由占位 assistant 消息承载）
interface SessionState {
  messages: LocalMessage[];
  streaming: boolean; // 该会话是否正在生成（有活跃流）
  runningError?: string;
}

function emptySessionState(): SessionState {
  return { messages: [], streaming: false };
}

// 每个进行中会话的流式控制状态（与 React 渲染分离，ref 保存）
interface FlowState {
  id: string;
  content: string;
  thinking: string;
  timeline: TimelineEntry[]; // 完整交叉时间线：thinking 段与 tool_call/tool_result 按顺序交替
  error: string;
  form?: FormDto; // 待渲染的表单卡片
}

/** 把段追加进完整时间线：thinking 段连续时累积，工具段直接新开（实现思考/工具交叉） */
function appendSegment(flow: FlowState, seg: TimelineEntry): void {
  if (seg.type === "thinking") {
    const last = flow.timeline[flow.timeline.length - 1];
    if (last && last.type === "thinking") {
      last.content += seg.content;
    } else {
      flow.timeline.push({ type: "thinking", content: seg.content });
    }
  } else {
    flow.timeline.push(seg);
  }
}

interface Props {
  activeSessionId: string | null;
  onSelectSession: (id: string | null) => void;
}

export default function DialogueView({ activeSessionId, onSelectSession }: Props) {
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [states, setStates] = useState<Record<string, SessionState>>({});
  const [input, setInput] = useState("");
  const [trashMode, setTrashMode] = useState(false);
  const [trashSessions, setTrashSessions] = useState<SessionDto[]>([]);
  const [trashSelected, setTrashSelected] = useState<Set<string>>(new Set());

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
          form: m.form ?? undefined,
        }));
        if (flow) {
          // 该会话有后台流：保留内存态（含正在生成的占位消息与已生成部分），
          // 只同步实时进度，避免用服务端快照覆盖导致整条回复消失
          const current = statesRef.current[activeSessionId] ?? emptySessionState();
          setStateFor(activeSessionId, () => ({
            ...current,
            streaming: true,
            runningError: flow.error,
          }));
        } else {
          setStateFor(activeSessionId, () => ({
            ...base,
            messages: persisted,
            streaming: false,
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
  }, [messages]);

  // 新建会话：总是切换到干净会话（若已有未发消息的空会话则复用它，避免堆积空会话）；返回会话 id 供发送复用
  const newSession = async (): Promise<string> => {
    const existingEmpty = sessions.find((s) => s.title === "新对话");
    if (existingEmpty) {
      onSelectSession(existingEmpty.id);
      return existingEmpty.id;
    }
    const s = await api.createSession();
    setSessions((prev) => [s, ...prev]);
    onSelectSession(s.id);
    return s.id;
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

  // ── 回收站操作 ──
  const loadTrash = useCallback(() => {
    api.listTrashSessions().then(setTrashSessions).catch(console.error);
  }, []);

  const toggleTrashMode = () => {
    const next = !trashMode;
    setTrashMode(next);
    setTrashSelected(new Set());
    if (next) loadTrash();
  };

  const toggleTrashSelect = (id: string) => {
    setTrashSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTrashSelectAll = () => {
    setTrashSelected((prev) => {
      const all = trashSessions.map((s) => s.id);
      const isAll = prev.size === all.length && all.length > 0;
      return isAll ? new Set<string>() : new Set(all);
    });
  };

  const restoreOne = async (id: string) => {
    await api.restoreSession(id);
    loadTrash();
    api.listSessions().then(setSessions).catch(() => {});
  };

  const restoreSelected = async () => {
    if (trashSelected.size === 0) return;
    await api.batchRestoreSessions([...trashSelected]);
    setTrashSelected(new Set());
    loadTrash();
    api.listSessions().then(setSessions).catch(() => {});
  };

  const deleteTrashOne = async (id: string) => {
    if (!confirm("彻底删除该会话？此操作不可恢复。")) return;
    await api.batchDeleteSessions([id]);
    loadTrash();
  };

  const deleteTrashSelected = async () => {
    if (trashSelected.size === 0) return;
    if (!confirm(`彻底删除选中的 ${trashSelected.size} 个会话？此操作不可恢复。`)) return;
    await api.batchDeleteSessions([...trashSelected]);
    setTrashSelected(new Set());
    loadTrash();
  };

  const emptyTrashAll = async () => {
    if (trashSessions.length === 0) return;
    if (!confirm(`清空回收站（${trashSessions.length} 个会话）？此操作不可恢复。`)) return;
    await api.emptyTrash();
    setTrashSelected(new Set());
    loadTrash();
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
            ? { ...m, content: flow.content, thinking: flow.thinking, timeline: flow.timeline, error: flow.error, form: flow.form, streaming: true }
            : m
        ),
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
        runningError: undefined,
      }));
      // 刷新会话列表（标题可能已改）
      api.listSessions().then(setSessions).catch(() => {});
    };

    const eventHandlers: Record<string, (evt: any) => void> = {
      thinking: (e) => {
        flow.thinking += e.content;
        // 思考段追加到交叉时间线（与工具交叉展示）
        appendSegment(flow, { type: "thinking", content: e.content });
        apply();
      },
      content: (e) => {
        flow.content += e.content;
        apply();
      },
      form: (e) => {
        flow.form = e.form;
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
        finish(); // 错误事件后流结束（无 done），结束流式状态
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

  // 表单提交：标记卡片已提交 → 将字段值/表格行作为一条消息发出（agent 据此执行）
  const submitForm = (sessionId: string, formId: string, payload: Record<string, string> | Array<Record<string, string>>) => {
    setStateFor(sessionId, (s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.form && m.form.id === formId ? { ...m, formSubmitted: true } : m
      ),
    }));
    const message = `【表单提交：${formId}】\n${JSON.stringify(Array.isArray(payload) ? { rows: payload } : payload)}`;
    void send(sessionId, message);
  };

  const stop = (sessionId: string) => {
    const controller = controllersRef.current.get(sessionId);
    if (controller) {
      controller.abort();
      api.stop(sessionId).catch(() => {});
    }
  };

  // 输入框发送：无活动会话时先自动新建（复用空会话或创建）再发送
  const handleSend = async () => {
    const content = input.trim();
    if (!content || state.streaming) return;
    let sessionId = activeSessionId;
    if (!sessionId) sessionId = await newSession();
    setInput("");
    send(sessionId, content);
  };

  return (
    <div className="flex flex-1 min-w-0 h-full">
      {/* 会话列表 */}
      <div className="w-56 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="p-3 space-y-2">
          <button
            onClick={newSession}
            disabled={trashMode}
            className="w-full px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-40"
          >
            + 新建会话
          </button>
          <button
            onClick={toggleTrashMode}
            className={`w-full px-3 py-2 rounded-md text-sm border ${
              trashMode
                ? "bg-gray-800 text-white border-gray-800"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {trashMode ? "← 返回会话列表" : "🗑 回收站"}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {trashMode ? (
            <TrashView
              sessions={trashSessions}
              selected={trashSelected}
              onToggle={toggleTrashSelect}
              onToggleAll={toggleTrashSelectAll}
              onRestore={restoreOne}
              onRestoreSelected={restoreSelected}
              onDelete={deleteTrashOne}
              onDeleteSelected={deleteTrashSelected}
              onEmpty={emptyTrashAll}
            />
          ) : (
            sessions.map((s) => (
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
          )))}
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
                <MessageBubble
                  key={m.id}
                  message={m}
                  sessionId={activeSessionId!}
                  onSubmitForm={submitForm}
                />
              ))}
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
                disabled={!input.trim() || state.streaming}
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

// 回收站视图：多选 + 恢复/彻底删除/清空
function TrashView({
  sessions,
  selected,
  onToggle,
  onToggleAll,
  onRestore,
  onRestoreSelected,
  onDelete,
  onDeleteSelected,
  onEmpty,
}: {
  sessions: SessionDto[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onRestore: (id: string) => void;
  onRestoreSelected: () => void;
  onDelete: (id: string) => void;
  onDeleteSelected: () => void;
  onEmpty: () => void;
}) {
  if (sessions.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-gray-400">
        回收站是空的
      </div>
    );
  }
  const allSelected = selected.size === sessions.length;
  return (
    <div className="text-xs">
      <div className="px-3 py-2 bg-gray-100 border-b border-gray-200 space-y-1.5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
          <span className="text-gray-600">全选</span>
          <span className="text-gray-400">（{selected.size}/{sessions.length}）</span>
        </label>
        <div className="flex gap-1.5">
          <button
            onClick={onRestoreSelected}
            disabled={selected.size === 0}
            className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-40"
          >
            恢复({selected.size})
          </button>
          <button
            onClick={onDeleteSelected}
            disabled={selected.size === 0}
            className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600 disabled:opacity-40"
          >
            彻底删除({selected.size})
          </button>
          <button
            onClick={onEmpty}
            className="px-2 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-600"
          >
            清空
          </button>
        </div>
      </div>
      {sessions.map((s) => (
        <div
          key={s.id}
          className="group flex items-center gap-2 px-3 py-2 border-b border-gray-100"
        >
          <input
            type="checkbox"
            checked={selected.has(s.id)}
            onChange={() => onToggle(s.id)}
          />
          <span className="flex-1 truncate text-gray-700">{s.title}</span>
          <button
            onClick={() => onRestore(s.id)}
            className="opacity-0 group-hover:opacity-100 text-blue-500 hover:text-blue-700"
          >
            恢复
          </button>
          <button
            onClick={() => onDelete(s.id)}
            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600"
          >
            彻底删
          </button>
        </div>
      ))}
    </div>
  );
}

// 消息气泡
function MessageBubble({
  message,
  sessionId,
  onSubmitForm,
}: {
  message: LocalMessage;
  sessionId: string;
  onSubmitForm: (sessionId: string, formId: string, payload: Record<string, string> | Array<Record<string, string>>) => void;
}) {
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
  // 交叉渲染：thinking 段与工具段按真实执行顺序交替（多段思考 + 工具穿插）
  const crossBlocks: Array<{ kind: "thinking"; text: string; idx: number } | { kind: "tool"; entry: TimelineEntry; idx: number }> =
    [];
  timeline.forEach((t, i) => {
    if (t.type === "thinking") {
      crossBlocks.push({ kind: "thinking", text: t.content ?? "", idx: i });
    } else if (t.type === "tool_call" || t.type === "tool_result") {
      crossBlocks.push({ kind: "tool", entry: t, idx: i });
    }
  });
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        {crossBlocks.length > 0 ? (
          crossBlocks.map((b) =>
            b.kind === "thinking" ? (
              <ThinkingBlock key={`th-${b.idx}`} text={b.text} />
            ) : (
              <ToolBlock key={`tl-${b.idx}`} entry={b.entry as Extract<TimelineEntry, { type: "tool_call" | "tool_result" }>} />
            )
          )
        ) : message.thinking ? (
          <ThinkingBlock text={message.thinking} />
        ) : null}
        {message.content ? (
          <div className="md-content bg-white border border-gray-200 rounded-xl px-4 py-3">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        ) : null}
        {message.form ? (
          <FormCard
            form={message.form}
            disabled={message.formSubmitted}
            onSubmit={(values) => onSubmitForm(sessionId, message.form!.id, values)}
          />
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

// 可编辑表单卡片：表格模式（横向表头+联动+多行）或垂直字段模式
export function FormCard({
  form,
  disabled,
  onSubmit,
}: {
  form: FormDto;
  disabled?: boolean;
  onSubmit: (payload: Record<string, string> | Array<Record<string, string>>) => void;
}) {
  // 表格模式
  if (form.columns && form.columns.length) {
    return <FormTable form={form} disabled={disabled} onSubmit={onSubmit} />;
  }
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries((form.fields ?? []).map((f) => [f.key, f.value ?? ""]))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setField = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const handleSubmit = () => {
    const errs: Record<string, string> = {};
    for (const f of form.fields ?? []) {
      if (f.required && !(values[f.key] ?? "").trim()) errs[f.key] = "必填";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSubmit(values);
  };

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3 max-w-lg">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">{form.title}</h3>
        {disabled ? <span className="text-xs text-green-600">✓ 已提交</span> : null}
      </div>
      {form.description ? <p className="text-xs text-gray-500">{form.description}</p> : null}
      {(form.fields ?? []).map((f) => (
        <div key={f.key}>
          <label className="block text-xs text-gray-500 mb-1">
            {f.label}
            {f.required ? <span className="text-red-500"> *</span> : null}
          </label>
          {f.type === "select" ? (
            <SearchSelect
              options={f.options}
              value={values[f.key] ?? ""}
              onChange={(v) => setField(f.key, v)}
              placeholder={f.placeholder}
              disabled={disabled}
            />
          ) : f.type === "textarea" ? (
            <textarea
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm disabled:bg-gray-50 focus:outline-none focus:border-blue-400"
              rows={3}
              value={values[f.key] ?? ""}
              onChange={(e) => setField(f.key, e.target.value)}
              placeholder={f.placeholder}
              disabled={disabled}
            />
          ) : (
            <input
              type={f.type === "number" ? "number" : "text"}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm disabled:bg-gray-50 focus:outline-none focus:border-blue-400"
              value={values[f.key] ?? ""}
              onChange={(e) => setField(f.key, e.target.value)}
              placeholder={f.placeholder}
              disabled={disabled}
            />
          )}
          {errors[f.key] ? <p className="text-xs text-red-500 mt-0.5">{errors[f.key]}</p> : null}
        </div>
      ))}
      <button
        onClick={handleSubmit}
        disabled={disabled}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {form.submitLabel ?? "确认提交"}
      </button>
    </div>
  );
}

// 带搜索框的下拉选择：选项可能很多，输入关键词实时过滤
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  allowCustom,
}: {
  options: FormFieldOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowCustom?: boolean; // 允许输入不在选项中的新值（如新项目/任务名）
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [display, setDisplay] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 浮层定位（fixed 视口坐标）：悬浮于表单上方，不被 overflow 容器裁剪、不撑出滚动条
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);

  // 同步显示文本：value 命中选项 → 显示自然语言 label；否则显示输入值（自定义）
  useEffect(() => {
    const o = options.find((x) => x.value === value);
    setDisplay(o ? o.label : value);
  }, [value, options]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    // 下拉内部滚动不关闭；外部任何滚动/窗口缩放关闭（fixed 浮层坐标会失效）
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const openMenu = () => {
    if (disabled) return;
    if (!open) {
      const el = ref.current?.firstElementChild as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left, width: r.width, up: false });
      }
      setQuery("");
    }
    setOpen(true);
  };

  // 渲染后按实际列表高度校准：视口放不下则向上展开（paint 前完成，无闪烁）
  useLayoutEffect(() => {
    if (!open || !pos) return;
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = listRef.current?.offsetHeight ?? 0;
    const up = r.bottom + h + 4 > window.innerHeight && r.top > h + 4;
    setPos((prev) => {
      const top = up ? r.top - h - 4 : r.bottom + 4;
      if (prev && prev.top === top && prev.left === r.left && prev.width === r.width && prev.up === up) return prev;
      return { top, left: r.left, width: r.width, up };
    });
  }, [open, pos, query]);

  const selected = options.find((o) => o.value === value);
  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));
  const matched = options.some((o) => o.value === query || o.label === query);

  return (
    <div ref={ref} className="relative">
      {allowCustom ? (
        <input
          type="text"
          value={display}
          onChange={(e) => {
            const v = e.target.value;
            setDisplay(v);
            onChange(v);
            setQuery(v);
          }}
          onFocus={openMenu}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm disabled:bg-gray-50 focus:outline-none focus:border-blue-400"
        />
      ) : (
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openMenu())}
          className="w-full text-left border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white disabled:bg-gray-50 flex items-center justify-between focus:outline-none focus:border-blue-400"
          disabled={disabled}
        >
          <span className={selected ? "" : "text-gray-400"}>
            {selected ? selected.label : placeholder ?? "请选择"}
          </span>
          <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
        </button>
      )}
      {open && pos ? (
        <div
          ref={listRef}
          className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          {!allowCustom ? (
            <input
              autoFocus
              className="w-full px-2 py-1.5 text-sm border-b border-gray-200 outline-none"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索…"
            />
          ) : null}
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  className={`w-full text-left px-2 py-1.5 text-sm hover:bg-blue-50 ${
                    o.value === value ? "bg-blue-50 text-blue-700" : "text-gray-700"
                  }`}
                  onClick={() => {
                    onChange(o.value);
                    setDisplay(o.label);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))}
            {allowCustom && query && !matched ? (
              <li>
                <button
                  type="button"
                  className="w-full text-left px-2 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
                  onClick={() => {
                    onChange(query);
                    setDisplay(query);
                    setOpen(false);
                  }}
                >
                  使用输入值：{query}
                </button>
              </li>
            ) : null}
            {filtered.length === 0 ? (
              <li className="px-2 py-1.5 text-xs text-gray-400">
                {allowCustom && !query ? "无选项" : "无匹配选项"}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// 表格型表单：横向表头 + 列联动（工作类别→任务）+ 多行（拆分报工）
function FormTable({
  form,
  disabled,
  onSubmit,
}: {
  form: FormDto;
  disabled?: boolean;
  onSubmit: (rows: Array<Record<string, string>>) => void;
}) {
  const cols = form.columns ?? [];
  const [rows, setRows] = useState<Array<Record<string, string>>>(() =>
    form.rows && form.rows.length
      ? form.rows.map((r) => ({ ...r }))
      : [{ date: "", work_type: "部门工作", project_id: "", phase_id: "", content: "", std_hours: "", ovt_hours: "0" }]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setCell = (ri: number, key: string, v: string) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== ri) return r;
        const next = { ...r, [key]: v };
        // 父列变化 → 清空子列值（联动）
        for (const c of cols) {
          if (c.dependsOn?.includes(key)) next[c.key] = "";
        }
        return next;
      })
    );
  };

  // 拆分某行：原行工时减半、新行取另一半（总和不变，如 8 → 4+4）；任务/项目相同；内容留空
  const splitRow = (ri: number) => {
    setRows((prev) => {
      const src = prev[ri] ?? {};
      const total = parseFloat(src.std_hours ?? "0") || 0;
      const half = total > 0 ? String(total / 2) : "";
      const first = { ...src, std_hours: half };
      const newRow: Record<string, string> = {
        date: src.date ?? "",
        work_type: src.work_type ?? "部门工作",
        project_id: src.project_id ?? "",
        phase_id: src.phase_id ?? "",
        content: "",
        std_hours: half,
        ovt_hours: src.ovt_hours ?? "0",
      };
      return [...prev.slice(0, ri), first, newRow, ...prev.slice(ri + 1)];
    });
  };

  const removeRow = (ri: number) => setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== ri) : prev));

  const resolveOptions = (col: FormColumn, row: Record<string, string>): FormFieldOption[] => {
    if (col.options) return col.options;
    if (col.optionsBy && col.dependsOn) {
      const key = col.dependsOn.filter((k) => (row[k] ?? "") !== "").map((k) => row[k]).join("|");
      return col.optionsBy[key] ?? [];
    }
    return [];
  };

  const handleSubmit = () => {
    const errs: Record<string, string> = {};
    rows.forEach((r, ri) => {
      if (!(r.phase_id ?? "").trim()) errs[`${ri}.phase_id`] = "必填";
      if (!(r.content ?? "").trim()) errs[`${ri}.content`] = "必填";
    });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSubmit(rows);
  };

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">{form.title}</h3>
        {disabled ? <span className="text-xs text-green-600">✓ 已提交</span> : null}
      </div>
      {form.description ? <p className="text-xs text-gray-500">{form.description}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[600px]">
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className="border border-gray-200 bg-gray-50 px-2 py-1.5 text-left text-xs font-medium text-gray-600 whitespace-nowrap"
                >
                  {c.label}
                </th>
              ))}
              {!disabled ? <th className="border border-gray-200 bg-gray-50 px-2 py-1.5 w-10" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {cols.map((col) => {
                  // 项目列：部门工作时占位隐藏（仅项目类显示）
                  const hideProject = col.key === "project_id" && (row.work_type ?? "") === "部门工作";
                  return (
                    <td key={col.key} className="border border-gray-200 px-1 py-1">
                      {hideProject ? (
                        <div className="px-2 py-1.5 text-xs text-gray-300">—</div>
                      ) : col.type === "select" ? (
                        <SearchSelect
                          options={resolveOptions(col, row)}
                          value={row[col.key] ?? ""}
                          onChange={(v) => setCell(ri, col.key, v)}
                          placeholder={col.label}
                          disabled={disabled}
                          allowCustom={col.key === "project_id" || col.key === "phase_id"}
                        />
                      ) : (
                        <input
                          type={col.type === "number" ? "number" : "text"}
                          value={row[col.key] ?? ""}
                          onChange={(e) => setCell(ri, col.key, e.target.value)}
                          placeholder={col.key === "date" ? "YYYY-MM-DD" : col.label}
                          disabled={disabled}
                          className={`${
                            col.key === "date" ? "w-28" : col.key === "std_hours" || col.key === "ovt_hours" ? "w-14" : "w-full"
                          } border border-gray-300 rounded px-2 py-1.5 text-sm disabled:bg-gray-50 focus:outline-none focus:border-blue-400`}
                        />
                      )}
                      {errors[`${ri}.${col.key}`] ? <p className="text-xs text-red-500 mt-0.5">必填</p> : null}
                    </td>
                  );
                })}
                {!disabled ? (
                  <td className="border border-gray-200 px-1 py-1 text-center whitespace-nowrap">
                    <button onClick={() => splitRow(ri)} className="text-xs text-blue-600 hover:underline mr-2">
                      拆
                    </button>
                    <button
                      onClick={() => removeRow(ri)}
                      disabled={rows.length <= 1}
                      className="text-xs text-red-500 hover:underline disabled:opacity-40"
                    >
                      删
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled ? (
        <button onClick={handleSubmit} className="px-4 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
          {form.submitLabel ?? "确认提交"}
        </button>
      ) : null}
    </div>
  );
}
