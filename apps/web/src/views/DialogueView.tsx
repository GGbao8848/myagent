// 对话页：会话列表 + 消息流水线 + SSE 流式（每会话独立运行，切换不中断）
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, chatStream } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MessagesSquare, Trash2, ChevronRight } from "lucide-react";
import type { FormColumn, FormDto, FormFieldOption, MessageDto, SessionDto, SSEChatEvent, TimelineEntry } from "@br-agent/shared";

interface LocalMessage {
  id: string; // 本地临时 id 或服务端 id
  role: "user" | "assistant";
  content: string;
  createdAt?: string; // ISO 时间戳（历史消息来自服务端，本地新增为空）
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

/** 格式化消息时间戳：当天显示 HH:mm，跨天显示 MM-DD HH:mm（用本地时区，避免 UTC 偏移 8 小时） */
function formatMsgTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true); // 用户是否停留在底部附近（距底 < 100px）
  const pendingJumpRef = useRef(false); // 切会话后待执行的无动画跳底标记

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
        // 历史加载完成：无动画定位到底部（避免从顶部平滑滑过整个会话）
        pendingJumpRef.current = true;
        const flow = flowsRef.current.get(activeSessionId);
        const base = statesRef.current[activeSessionId] ?? emptySessionState();
        const persisted = detail.messages.map((m) => ({
          id: String(m.id),
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
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

  // 自动滚动：切会话后无动画定位到底部；流式更新仅在用户停留在底部附近时平滑跟随，
  // 用户向上滚动查看中间内容时暂停自动滚动，不打扰
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pendingJumpRef.current) {
      pendingJumpRef.current = false;
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
      return;
    }
    if (nearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // 跟踪用户是否停留在底部附近（距底 < 100px 视为在底部）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

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

    const finish = (messageId?: string | number, createdAt?: string) => {
      flowsRef.current.delete(sessionId);
      controllersRef.current.delete(sessionId);
      setStateFor(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => {
          if (m.id !== flow.id) return m;
          const finalId = messageId != null ? String(messageId) : flow.id;
          // 优先用服务端补发的准确时间戳，兜底本地时间
          const ts = createdAt ?? m.createdAt ?? new Date().toISOString();
          return { ...m, id: finalId, content: flow.content, thinking: flow.thinking, timeline: flow.timeline, error: flow.error, createdAt: ts, streaming: false };
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
        finish(e.message_id, e.created_at);
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
      <div className="w-56 border-r border-border bg-muted/50 flex flex-col">
        <div className="p-3 space-y-2">
          <Button onClick={newSession} disabled={trashMode} className="w-full">
            + 新建会话
          </Button>
          <Button
            onClick={toggleTrashMode}
            variant={trashMode ? "default" : "outline"}
            className="w-full"
          >
            {trashMode ? "← 返回会话列表" : "🗑 回收站"}
          </Button>
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
              className={`group px-3 py-2 cursor-pointer text-sm border-b border-border ${
                activeSessionId === s.id ? "bg-primary/10" : "hover:bg-muted"
              }`}
              onClick={() => onSelectSession(s.id)}
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-foreground">
                  {s.title}
                  {states[s.id]?.streaming ? (
                    <span className="ml-1 text-primary animate-pulse">●</span>
                  ) : null}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 px-1 text-muted-foreground hover:text-destructive"
                >
                  删
                </Button>
              </div>
            </div>
          )))}
        </div>
      </div>

      {/* 消息区 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {!activeSessionId ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
              <MessagesSquare className="size-8 text-muted-foreground/50" />
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
        <div className="border-t border-border p-4 bg-white">
          {state.streaming ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground animate-pulse">
                {activeSessionId ? "正在生成…" : "后台任务运行中…"}
              </span>
              {activeSessionId ? (
                <Button
                  variant="destructive"
                  onClick={() => stop(activeSessionId)}
                >
                  ■ 停止
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">切回原会话查看/停止</span>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder="输入消息，Enter 发送"
                className="flex-1"
              />
              <Button onClick={handleSend} disabled={!input.trim() || state.streaming}>
                发送
              </Button>
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
      <div className="px-4 py-8 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
        <Trash2 className="size-6 text-muted-foreground/50" />
        回收站是空的
      </div>
    );
  }
  const allSelected = selected.size === sessions.length;
  return (
    <div className="text-xs">
      <div className="px-3 py-2 bg-muted border-b border-border space-y-1.5">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={allSelected} onCheckedChange={onToggleAll} />
          <span className="text-muted-foreground">全选</span>
          <span className="text-muted-foreground">（{selected.size}/{sessions.length}）</span>
        </label>
        <div className="flex gap-1.5">
          <Button size="sm" onClick={onRestoreSelected} disabled={selected.size === 0}>
            恢复({selected.size})
          </Button>
          <Button size="sm" variant="destructive" onClick={onDeleteSelected} disabled={selected.size === 0}>
            彻底删除({selected.size})
          </Button>
          <Button size="sm" variant="outline" onClick={onEmpty}>
            清空
          </Button>
        </div>
      </div>
      {sessions.map((s) => (
        <div
          key={s.id}
          className="group flex items-center gap-2 px-3 py-2 border-b border-border"
        >
          <Checkbox
            checked={selected.has(s.id)}
            onCheckedChange={() => onToggle(s.id)}
          />
          <span className="flex-1 truncate text-foreground">{s.title}</span>
          <Button variant="ghost" size="sm" onClick={() => onRestore(s.id)} className="opacity-0 group-hover:opacity-100 px-1 text-primary">
            恢复
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(s.id)} className="opacity-0 group-hover:opacity-100 px-1 text-destructive">
            彻底删
          </Button>
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
        <div className="max-w-[75%]">
          <div className="bg-primary text-primary-foreground rounded-xl px-4 py-2 text-sm whitespace-pre-wrap">
            {message.content}
          </div>
          {message.createdAt ? (
            <div className="text-right text-[11px] text-muted-foreground mt-1">{formatMsgTime(message.createdAt)}</div>
          ) : null}
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
          <div className="w-fit max-w-full md-content bg-white border border-border rounded-xl px-4 py-3">
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
          <Alert variant="destructive" className="w-fit max-w-full">
            <AlertDescription>错误：{message.error}</AlertDescription>
          </Alert>
        ) : null}
        {message.streaming && !message.content ? (
          <div className="w-fit max-w-full text-muted-foreground text-sm bg-white border border-border rounded-xl px-4 py-3 animate-pulse">
            思考中…
          </div>
        ) : null}
        {message.createdAt ? (
          <div className="text-[11px] text-muted-foreground">{formatMsgTime(message.createdAt)}</div>
        ) : null}
      </div>
    </div>
  );
}

// 思考块（默认折叠，点击展开）
function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="text-xs">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="xs" className="w-full justify-start gap-1.5 px-1 text-muted-foreground hover:text-foreground">
          <ChevronRight className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <span>思考过程</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="ml-5 max-h-60 overflow-y-auto border-l border-border py-0.5 pl-3 text-muted-foreground whitespace-pre-wrap">
          {text}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

// 工具块（默认折叠，点击展开）
function ToolBlock({ entry }: { entry: Extract<TimelineEntry, { type: "tool_call" }> | Extract<TimelineEntry, { type: "tool_result" }> }) {
  const [open, setOpen] = useState(false);
  const isCall = entry.type === "tool_call";
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="text-xs">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="xs" className="w-full justify-start gap-1.5 px-1 text-muted-foreground hover:text-foreground">
          <ChevronRight className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className={isCall ? "text-primary" : "text-green-700"}>
            {isCall ? `调用工具：${entry.name}` : `工具结果：${entry.name}`}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="ml-5 max-h-40 overflow-y-auto border-l border-border py-0.5 pl-3 text-muted-foreground whitespace-pre-wrap">
          {isCall ? JSON.stringify(entry.args, null, 2) : entry.content}
        </pre>
      </CollapsibleContent>
    </Collapsible>
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
    <div className="bg-muted/50 border border-border rounded-xl p-4 space-y-3 max-w-lg">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">{form.title}</h3>
        {disabled ? <span className="text-xs text-green-600">✓ 已提交</span> : null}
      </div>
      {form.description ? <p className="text-xs text-muted-foreground">{form.description}</p> : null}
      {(form.fields ?? []).map((f) => (
        <div key={f.key}>
          <Label className="!block text-xs text-muted-foreground mb-1">
            {f.label}
            {f.required ? <span className="text-destructive"> *</span> : null}
          </Label>
          {f.type === "select" ? (
            <SearchSelect
              options={f.options}
              value={values[f.key] ?? ""}
              onChange={(v) => setField(f.key, v)}
              placeholder={f.placeholder}
              disabled={disabled}
            />
          ) : f.type === "textarea" ? (
            <Textarea
              rows={3}
              className="min-h-0"
              value={values[f.key] ?? ""}
              onChange={(e) => setField(f.key, e.target.value)}
              placeholder={f.placeholder}
              disabled={disabled}
            />
          ) : (
            <Input
              type={f.type === "number" ? "number" : "text"}
              value={values[f.key] ?? ""}
              onChange={(e) => setField(f.key, e.target.value)}
              placeholder={f.placeholder}
              disabled={disabled}
            />
          )}
          {errors[f.key] ? <p className="text-xs text-destructive mt-0.5">{errors[f.key]}</p> : null}
        </div>
      ))}
      <Button onClick={handleSubmit} disabled={disabled} className="w-full">
        {form.submitLabel ?? "确认提交"}
      </Button>
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
          className="w-full border border-input rounded-md px-2 py-1.5 text-sm disabled:bg-muted focus:outline-none focus:border-ring"
        />
      ) : (
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openMenu())}
          className="w-full text-left border border-input rounded-md px-2 py-1.5 text-sm bg-background disabled:bg-muted flex items-center justify-between focus:outline-none focus:border-ring"
          disabled={disabled}
        >
          <span className={selected ? "" : "text-muted-foreground"}>
            {selected ? selected.label : placeholder ?? "请选择"}
          </span>
          <span className="text-muted-foreground text-xs">{open ? "▲" : "▼"}</span>
        </button>
      )}
      {open && pos ? (
        <div
          ref={listRef}
          className="fixed z-50 bg-popover border border-border rounded-md shadow-md overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          {!allowCustom ? (
            <input
              autoFocus
              className="w-full px-2 py-1.5 text-sm border-b border-border outline-none"
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
                  className={`w-full text-left px-2 py-1.5 text-sm hover:bg-muted ${
                    o.value === value ? "bg-muted text-primary" : "text-foreground"
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
                  className="w-full text-left px-2 py-1.5 text-sm text-primary hover:bg-muted"
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
              <li className="px-2 py-1.5 text-xs text-muted-foreground">
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

  // 工时拆分组：同 date + work_type + project_id 的行视为一组（拆分产物）；不含 phase_id，允许拆分后改任务仍合并/守恒
  const groupKey = (r: Record<string, string>) =>
    `${r.date ?? ""}|${r.work_type ?? ""}|${r.project_id ?? ""}`;
  const num = (v?: string): number => {
    const n = parseFloat(v ?? "");
    return Number.isFinite(n) ? n : 0;
  };
  const fmt = (n: number): string => String(Math.round(n * 100) / 100);

  const setCell = (ri: number, key: string, v: string) => {
    setRows((prev) => {
      const isHours = key === "std_hours" || key === "ovt_hours";
      const src = prev[ri] ?? {};
      // 工时列：边界 [0, 24 - 另一列]（标准+加班合计 ≤ 24h/天）；拆分组内该列总和不变、其余行均分剩余
      if (isHours) {
        const otherKey = key === "std_hours" ? "ovt_hours" : "std_hours";
        const boundary = 24 - num(src[otherKey]);
        const raw = parseFloat(v);
        const k = groupKey(src);
        const others = prev.map((r, i) => ({ r, i })).filter((x) => x.i !== ri && groupKey(x.r) === k);
        if (others.length > 0) {
          const sum = others.reduce((acc, x) => acc + num(x.r[key]), 0) + num(src[key]);
          const newVal = Number.isFinite(raw) ? Math.max(0, Math.min(raw, boundary, sum)) : 0;
          const per = (sum - newVal) / others.length;
          return prev.map((r, i) => {
            if (i === ri) {
              const next = { ...r, [key]: String(newVal) };
              for (const c of cols) if (c.dependsOn?.includes(key)) next[c.key] = "";
              return next;
            }
            return others.some((x) => x.i === i) ? { ...r, [key]: fmt(per) } : r;
          });
        }
        // 单行：clamp 到 [0, 24 - 另一列]
        const newVal = Number.isFinite(raw) ? Math.max(0, Math.min(raw, boundary)) : 0;
        const next = { ...src, [key]: String(newVal) };
        return prev.map((r, i) => (i === ri ? next : r));
      }
      // 工作类别切换：层级联动（部门工作 → 清空项目/任务；项目类 → 默认选中最近项目，任务随项目联动）
      if (key === "work_type") {
        const projectOptions = cols.find((c) => c.key === "project_id")?.options ?? [];
        return prev.map((r, i) => {
          if (i !== ri) return r;
          const next: Record<string, string> = { ...r, work_type: v };
          if (v === "部门工作") {
            next.project_id = "";
            next.phase_id = "";
          } else {
            next.project_id = projectOptions[0]?.value ?? "";
            next.phase_id = "";
          }
          return next;
        });
      }
      // 普通设置 + 父列变化清空子列
      return prev.map((r, i) => {
        if (i !== ri) return r;
        const next = { ...r, [key]: v };
        for (const c of cols) if (c.dependsOn?.includes(key)) next[c.key] = "";
        return next;
      });
    });
  };

  // 拆分某行：标准工时对半（8 → 4+4），加班工时保留在原行（新行加班 0）；任务/项目相同；内容留空
  const splitRow = (ri: number) => {
    setRows((prev) => {
      const src = prev[ri] ?? {};
      const std = num(src.std_hours);
      if (std <= 0) return prev;
      const half = fmt(std / 2);
      const first = { ...src, std_hours: half };
      const newRow: Record<string, string> = {
        date: src.date ?? "",
        work_type: src.work_type ?? "部门工作",
        project_id: src.project_id ?? "",
        phase_id: src.phase_id ?? "",
        content: "",
        std_hours: half,
        ovt_hours: "0",
      };
      return [...prev.slice(0, ri), first, newRow, ...prev.slice(ri + 1)];
    });
  };

  // 删除行：若存在同组行（拆分产物），被删行的标准/加班工时合并到同组第一条剩余行，保持组内总和不变
  const removeRow = (ri: number) => {
    setRows((prev) => {
      if (prev.length <= 1) return prev;
      const target = prev[ri] ?? {};
      const k = groupKey(target);
      const others = prev.map((r, i) => ({ r, i })).filter((x) => x.i !== ri && groupKey(x.r) === k);
      if (others.length === 0) return prev.filter((_, i) => i !== ri);
      const mergeTo = others[0].i;
      return prev
        .map((r, i) => {
          if (i !== mergeTo) return r;
          return {
            ...r,
            std_hours: fmt(num(r.std_hours) + num(target.std_hours)),
            ovt_hours: fmt(num(r.ovt_hours) + num(target.ovt_hours)),
          };
        })
        .filter((_, i) => i !== ri);
    });
  };

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
    });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    // 报工内容留空自动填「日常工作」
    const payload = rows.map((r) => ({ ...r, content: (r.content ?? "").trim() || "日常工作" }));
    onSubmit(payload);
  };

  return (
    <div className="bg-muted/50 border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">{form.title}</h3>
        {disabled ? <span className="text-xs text-green-600">✓ 已提交</span> : null}
      </div>
      {form.description ? <p className="text-xs text-muted-foreground">{form.description}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[600px]">
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className="border border-border bg-muted px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                >
                  {c.label}
                </th>
              ))}
              {!disabled ? <th className="border border-border bg-muted px-2 py-1.5 w-10" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {cols.map((col) => {
                  // 日期列：只读 + 同日期多行合并单元格（拆分产物只显示首行日期）
                  if (col.key === "date") {
                    const prevDate = ri > 0 ? rows[ri - 1].date : undefined;
                    const isDateStart = row.date !== prevDate;
                    if (!isDateStart) return null;
                    let dateSpan = 1;
                    for (let j = ri + 1; j < rows.length && rows[j].date === row.date; j++) dateSpan++;
                    return (
                      <td key={col.key} rowSpan={dateSpan} className="border border-border px-1 py-1 align-middle">
                        <input
                          type="text"
                          value={row.date ?? ""}
                          readOnly
                          className="w-28 bg-transparent border-0 px-2 py-1.5 text-sm text-foreground focus:outline-none cursor-default"
                        />
                      </td>
                    );
                  }
                  // 项目列：部门工作时占位隐藏（仅项目类显示）
                  const hideProject = col.key === "project_id" && (row.work_type ?? "") === "部门工作";
                  return (
                    <td key={col.key} className="border border-border px-1 py-1">
                      {hideProject ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground/40">—</div>
                      ) : col.type === "select" ? (
                        <SearchSelect
                          options={resolveOptions(col, row)}
                          value={row[col.key] ?? ""}
                          onChange={(v) => setCell(ri, col.key, v)}
                          placeholder={col.label}
                          disabled={disabled}
                        />
                      ) : (
                        <input
                          type={col.type === "number" ? "number" : "text"}
                          value={row[col.key] ?? ""}
                          onChange={(e) => setCell(ri, col.key, e.target.value)}
                          placeholder={col.key === "content" ? "留空将自动填「日常工作」" : col.label}
                          min={col.type === "number" ? 0 : undefined}
                          max={col.type === "number" ? 24 : undefined}
                          step={col.type === "number" ? "any" : undefined}
                          disabled={disabled}
                          className={`${
                            col.key === "std_hours" || col.key === "ovt_hours" ? "w-14" : "w-full"
                          } border border-input rounded px-2 py-1.5 text-sm disabled:bg-muted focus:outline-none focus:border-ring`}
                        />
                      )}
                      {errors[`${ri}.${col.key}`] ? <p className="text-xs text-destructive mt-0.5">必填</p> : null}
                    </td>
                  );
                })}
                {!disabled ? (
                  <td className="border border-border px-1 py-1 text-center whitespace-nowrap">
                    <Button variant="ghost" size="xs" className="px-1 text-primary" onClick={() => splitRow(ri)}>
                      拆
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="px-1 text-destructive"
                      onClick={() => removeRow(ri)}
                      disabled={rows.length <= 1}
                    >
                      删
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled ? (
        <Button onClick={handleSubmit} size="sm">
          {form.submitLabel ?? "确认提交"}
        </Button>
      ) : null}
    </div>
  );
}
