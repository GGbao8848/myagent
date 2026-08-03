import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { 
  Upload, AlertCircle, LogIn, LogOut, Sparkles, TrendingUp, Link, Mail, Brain, 
  FileText, Terminal, ChevronUp, ChevronDown, Loader2, Play, ChevronRight, 
  Check, Layers, Paperclip, Image, Send, X 
} from "lucide-react";
import { Session, Skill, UserProfile, ModelConfig, Attachment, TimelineStep } from "../types";

interface DialogueViewProps {
  isDraggingFile: boolean;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  activeSession: Session | undefined;
  isLoggedIn: boolean;
  userProfile: UserProfile;
  setShowLoginModal: (show: boolean) => void;
  handleLogout: () => void;
  setInputMessage: (msg: string) => void;
  renderFormattedTextWithSkills: (text: string, isUserMessage?: boolean) => React.ReactNode;
  expandedThinking: Record<string, boolean>;
  setExpandedThinking: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  activeStreamingMessageId: string | null;
  copiedMsgId: string | null;
  handleCopyContent: (content: string, msgId: string) => void;
  preprocessMarkdown: (content: string) => string;
  isSending: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  pendingAttachments: Attachment[];
  setPendingAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  showSkillsDropdown: boolean;
  setShowSkillsDropdown: (show: boolean) => void;
  filteredSkillsForDropdown: Skill[];
  selectedDropdownIndex: number;
  setSelectedDropdownIndex: React.Dispatch<React.SetStateAction<number>>;
  selectSkillForInput: (skill: Skill) => void;
  inputMessage: string;
  setSearchSkillText: (query: string) => void;
  handleSendMessage: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  processFiles: (files: FileList) => void;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  modelConfigs: ModelConfig[];
}

// 安全渲染工具参数/结果：对象 → JSON，字符串原样，空值 → 占位
const renderToolPayload = (value: unknown): string => {
  if (value == null || value === "") return "无";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

// 打字机组件：把流式全文 text 逐字“打”出来
const TypewriterText: React.FC<{ text: string; isActive: boolean }> = ({ text, isActive }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // 结束后直接显示全文，停止打字
    if (!isActive) {
      setCount(text.length);
      return;
    }
  }, [isActive, text.length]);

  useEffect(() => {
    if (!isActive) return;
    // 每个 tick 推进 2 个字符；text 变化不重启，持续追赶目标
    const timer = setInterval(() => {
      setCount(prev => Math.min(prev + 2, text.length));
    }, 28);
    return () => clearInterval(timer);
  }, [isActive]);

  const shown = text.slice(0, count);
  const done = count >= text.length;

  return (
    <span className="whitespace-pre-wrap">
      {shown}
      {!done && (
        <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-indigo-500/70 animate-pulse rounded-sm" />
      )}
    </span>
  );
};

interface AgentFlowProps {
  timeline: TimelineStep[];
  isStreaming: boolean;
  collapsedThoughts: Record<string, boolean>;
  toggleThought: (key: string) => void;
  renderText: (text: string) => React.ReactNode;
  renderMarkdown: (content: string) => React.ReactNode;
}

// 智能体流水线：思考 → 工具 → 思考 → 工具 → ... → 正文
// 思考块：当前思考打字机展开；进入下一步骤后折叠成一行，点击可展开
// 工具块：默认折叠，展开显示参数/结果
const AgentFlowView: React.FC<AgentFlowProps> = ({
  timeline, isStreaming, collapsedThoughts, toggleThought, renderText, renderMarkdown,
}) => {
  // 识别正文：最后一个 thinking 段，其后没有 tool_call
  const finalAnswer = (() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].type === "tool_call") break;
      if (timeline[i].type === "thinking" && timeline[i].content) {
        return timeline[i].content || "";
      }
    }
    return "";
  })();
  // 无工具调用时的兜底：整段 thinking 即正文，但运行中先作为思考展示
  const hasTools = timeline.some(t => t.type === "tool_call");
  let stepsForFlow = timeline;
  let bodyAnswer = finalAnswer;
  if (hasTools) {
    // 正文是最后一段 thinking，流程部分去掉它
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].type === "tool_call") break;
      if (timeline[i].type === "thinking" && timeline[i].content) {
        stepsForFlow = timeline.slice(0, i);
        break;
      }
    }
  } else if (!isStreaming && !finalAnswer) {
    bodyAnswer = timeline.filter(t => t.type === "thinking").map(t => t.content || "").join("\n");
    stepsForFlow = [];
  }

  // 重建流程步骤：thinking 段聚合 + tool_call（携带其后 tool_result 的 content 作为结果）
  const flowSteps: { type: "thought" | "tool"; key: string; content: string; name?: string; args?: unknown; result?: string }[] = [];
  let thoughtBuf = "";

  const flushThought = () => {
    if (thoughtBuf.trim()) {
      flowSteps.push({ type: "thought", key: `t_${flowSteps.length}`, content: thoughtBuf.trim() });
      thoughtBuf = "";
    }
  };

  for (const step of stepsForFlow) {
    if (step.type === "thinking") {
      thoughtBuf += (step.content || "") + "\n";
    } else if (step.type === "tool_call") {
      flushThought();
      // 找配对的 tool_result（下一个 tool_result 的 content）
      const idx = stepsForFlow.indexOf(step);
      let result = "";
      for (let j = idx + 1; j < stepsForFlow.length; j++) {
        if (stepsForFlow[j].type === "tool_result") { result = stepsForFlow[j].content || ""; break; }
        if (stepsForFlow[j].type === "tool_call") break;
      }
      flowSteps.push({
        type: "tool", key: `tl_${flowSteps.length}`,
        content: step.name || "",
        name: step.name,
        args: step.args,
        result,
      });
    }
    // tool_result 单独出现则忽略（已并入 tool）
  }
  flushThought();

  if (flowSteps.length === 0 && !finalAnswer) return null;

  let thoughtIndex = 0;
  return (
    <div className="w-full flex flex-col gap-2">
      {flowSteps.map((step) => {
        if (step.type === "thought") {
          const idx = thoughtIndex++;
          const key = `${step.key}`;
          const isCurrent = isStreaming && idx === flowSteps.filter(f => f.type === "thought").length - 1;
          // 当前思考始终展开；已完成的思考默认折叠，点击展开
          const collapsed = !isCurrent && collapsedThoughts[key] !== false;

          return (
            <div key={key} className="rounded-lg border border-indigo-100/70 bg-indigo-50/40 overflow-hidden">
              <button
                onClick={() => toggleThought(key)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left cursor-pointer select-none"
              >
                <Brain className="w-3 h-3 text-indigo-400 shrink-0" />
                <span className="text-[10px] font-semibold text-indigo-500 font-sans uppercase tracking-wide shrink-0">思考 {idx + 1}</span>
                <ChevronDown className={`w-3 h-3 text-indigo-300 transition-transform shrink-0 ${collapsed || !isCurrent ? "" : "rotate-180"}`} />
              </button>
              {!collapsed && (
                <div className="px-3 pb-2.5 -mt-1">
                  {isStreaming && isCurrent ? (
                    <div className="text-[11px] text-indigo-700/80 font-sans italic leading-relaxed">
                      <TypewriterText text={step.content} isActive={true} />
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-600 font-sans italic leading-relaxed whitespace-pre-wrap">
                      {renderText(step.content)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        }

        // tool 步骤
        const key = step.key;
        return (
          <div key={key} className="rounded-lg border border-amber-200/60 bg-amber-50/40 overflow-hidden">
            <details className="group">
              <summary className="flex items-center gap-1.5 px-3 py-1.5 cursor-pointer select-none list-none">
                <Play className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
                <span className="font-mono text-[11px] font-bold text-slate-700">{step.name}</span>
                <span className="ml-auto px-1.5 py-0.5 text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full font-mono font-bold shrink-0">
                  执行成功
                </span>
                <ChevronRight className="w-3 h-3 text-slate-400 group-open:rotate-90 transition-transform shrink-0" />
              </summary>
              <div className="px-3 pb-2.5 space-y-2">
                <div className="pl-3 border-l-2 border-slate-200">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">输入参数</div>
                  <div className="font-mono text-[10px] text-slate-600 bg-slate-100/60 rounded-md p-2 overflow-x-auto whitespace-pre-wrap">
                    {renderToolPayload(step.args)}
                  </div>
                </div>
                {step.result && (
                  <div className="pl-3 border-l-2 border-emerald-200">
                    <div className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide mb-1">输出反馈</div>
                    <div className="font-mono text-[10px] text-emerald-800 bg-emerald-50/40 rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {renderToolPayload(step.result)}
                    </div>
                  </div>
                )}
              </div>
            </details>
          </div>
        );
      })}
      {bodyAnswer && bodyAnswer.trim() && (
        <div className="w-full bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden relative group/card hover:shadow-sm transition-shadow">
          <div className="p-6 prose-custom text-slate-800 leading-relaxed font-sans text-sm">
            {renderMarkdown(bodyAnswer)}
          </div>
        </div>
      )}
    </div>
  );
};

export const DialogueView: React.FC<DialogueViewProps> = ({
  isDraggingFile,
  handleDragEnter,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  activeSession,
  isLoggedIn,
  userProfile,
  setShowLoginModal,
  handleLogout,
  setInputMessage,
  renderFormattedTextWithSkills,
  expandedThinking,
  setExpandedThinking,
  activeStreamingMessageId,
  copiedMsgId,
  handleCopyContent,
  preprocessMarkdown,
  isSending,
  messagesEndRef,
  pendingAttachments,
  setPendingAttachments,
  showSkillsDropdown,
  setShowSkillsDropdown,
  filteredSkillsForDropdown,
  selectedDropdownIndex,
  setSelectedDropdownIndex,
  selectSkillForInput,
  inputMessage,
  setSearchSkillText,
  handleSendMessage,
  fileInputRef,
  imageInputRef,
  processFiles,
  selectedModelId,
  setSelectedModelId,
  modelConfigs,
}) => {
  return (
    <motion.div 
      key="dialogue-view"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.15 }}
      className="flex h-full w-full relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingFile && (
        <div className="absolute inset-0 bg-slate-900/65 backdrop-blur-xs z-50 flex flex-col items-center justify-center text-white p-6 transition-all pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-white/10 border border-white/20 flex items-center justify-center mb-4 animate-bounce">
            <Upload className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-lg font-semibold font-display">将文件拖拽到此处上传</h3>
          <p className="text-xs text-white/70 mt-1">支持拖拽图片、文本、PDF 等格式文件自动关联到本轮对话</p>
        </div>
      )}

      {/* Main Conversation Room */}
      <div className="flex-1 flex flex-col h-full bg-white relative">
        
        {/* Active Session Info Header */}
        <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white/80 backdrop-blur-xs">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-800">
              {activeSession ? activeSession.title : "开始探索"}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {isLoggedIn ? (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/80 rounded-full px-3 py-1 text-xs shadow-3xs">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="在线"></span>
                <span className="font-semibold text-slate-700">{userProfile.name}</span>
                <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">({userProfile.role})</span>
                <button 
                  onClick={() => setShowLoginModal(true)}
                  className="ml-1 text-[11px] text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                  title="切换账号"
                >
                  切换
                </button>
                <span className="text-slate-300">|</span>
                <button 
                  onClick={handleLogout}
                  className="text-[11px] text-slate-500 hover:text-rose-600 font-medium cursor-pointer flex items-center gap-0.5"
                  title="退出登录"
                >
                  <LogOut className="w-3 h-3" />
                  <span>退出</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200/80 px-2.5 py-1 rounded-full font-medium flex items-center gap-1 shadow-3xs">
                  <AlertCircle className="w-3 h-3 text-amber-500" />
                  未登录
                </span>
                <button 
                  onClick={() => setShowLoginModal(true)}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-full shadow-2xs transition-all flex items-center gap-1 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>立即登录</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Message Bubble Field */}
        <div className="flex-1 overflow-y-auto px-6 pt-4 pb-36 space-y-6">
          {!activeSession || activeSession.messages.length === 0 ? (
            <div className="max-w-2xl mx-auto py-12 flex flex-col items-center justify-center">
              <div className="w-12 h-12 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center text-slate-700 mb-4 shadow-xs">
                <Sparkles className="w-6 h-6 animate-pulse" />
              </div>
              <h2 className="font-display font-semibold text-base text-slate-900">我是企业办公自动化助手</h2>
              <p className="text-xs text-slate-500 text-center mt-1.5 max-w-md">
                我可以整合您的画像记忆、调动已安装的自动化技能包或查询外部 MCP 数据库。点击下方精选卡片一键下达自动化任务：
              </p>

              <div className="grid grid-cols-2 gap-3.5 w-full mt-8">
                
                <button 
                  onClick={() => {
                    setInputMessage("帮我把本周测试的3个技能组件、对接的MCP接口以及画像起效的成果，整理成一份标准的运营周报汇总。");
                  }}
                  className="p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/50 text-left transition-all shadow-xs cursor-pointer"
                >
                  <div className="text-indigo-600 font-semibold text-xs flex items-center gap-1.5 mb-1">
                    <TrendingUp className="w-3.5 h-3.5 text-indigo-500" /> 周报计划极速生成
                  </div>
                  <p className="text-[11px] text-slate-500 leading-normal">
                    聚合我的工作记录，根据画像偏好一键整理标准周报和下周计划。
                  </p>
                </button>

                <button 
                  onClick={() => {
                    setInputMessage("检查当前 MCP 服务器连接状态，并调用 saas_db_analytical_portal 工具查询今日接口错误指标。");
                  }}
                  className="p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/50 text-left transition-all shadow-xs cursor-pointer"
                >
                  <div className="text-emerald-600 font-semibold text-xs flex items-center gap-1.5 mb-1">
                    <Link className="w-3.5 h-3.5 text-emerald-500" /> 连通 MCP 工具检索
                  </div>
                  <p className="text-[11px] text-slate-500 leading-normal">
                    穿透本地中继通道，调用已注册的外部系统数据库或 API 获得实时日志。
                  </p>
                </button>

                <button 
                  onClick={() => {
                    setInputMessage("调用文档智能解析技能，帮我拟一封符合中高层汇报调性的邮件草稿，解释系统正常连通。");
                  }}
                  className="p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/50 text-left transition-all shadow-xs cursor-pointer"
                >
                  <div className="text-amber-600 font-semibold text-xs flex items-center gap-1.5 mb-1">
                    <Mail className="w-3.5 h-3.5 text-amber-500" /> 智能商务邮件拟写
                  </div>
                  <p className="text-[11px] text-slate-500 leading-normal">
                    使用极简文字一键扩展出礼貌、谦逊的职场商务邮件回复，一键拟好。
                  </p>
                </button>

                <button 
                  onClick={() => {
                    setInputMessage("告诉我关于你记住的‘我的画像和认知事实’，我可以怎么调整？");
                  }}
                  className="p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/50 text-left transition-all shadow-xs cursor-pointer"
                >
                  <div className="text-slate-700 font-semibold text-xs flex items-center gap-1.5 mb-1">
                    <Brain className="w-3.5 h-3.5 text-slate-500" /> 自定义画像与事实调整
                  </div>
                  <p className="text-[11px] text-slate-500 leading-normal">
                    核实 AI 是否记住了我的专业背景，以及如何在此基础上定制写作规则。
                  </p>
                </button>

              </div>
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl mx-auto">
              {activeSession.messages.map((msg) => {
                const isUser = msg.role === "user";
                return (
                  <div 
                    key={msg.id}
                    className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                  >
                    <div className="flex items-center gap-2 mb-1.5 text-[10px] text-slate-400">
                      <span>{isUser ? userProfile.name : "Office AI 助理"}</span>
                      <span>•</span>
                      <span>{msg.timestamp}</span>
                    </div>

                    {isUser ? (
                      <div className="flex flex-col items-end gap-2 max-w-3xl">
                        <div className="p-4 rounded-2xl leading-relaxed text-sm bg-slate-900 text-white rounded-tr-none shadow-sm whitespace-pre-wrap">
                          {renderFormattedTextWithSkills(msg.content, true)}
                        </div>
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 justify-end mt-1">
                            {msg.attachments.map((file, fIdx) => (
                              <div key={fIdx} className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 flex items-center gap-2.5 max-w-xs text-xs text-slate-700 shadow-3xs">
                                {file.isImage ? (
                                  <a href={file.url} target="_blank" rel="noopener noreferrer" className="relative group cursor-zoom-in shrink-0">
                                    <img src={file.url} alt={file.name} className="w-12 h-12 object-cover rounded-lg border border-slate-200" referrerPolicy="no-referrer" />
                                  </a>
                                ) : (
                                  <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                                    <FileText className="w-5 h-5" />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold truncate text-[11px] text-slate-800" title={file.name}>{file.name}</p>
                                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">{file.size}</p>
                                </div>
                                {!file.isImage && file.url && (
                                  <a 
                                    href={file.url} 
                                    download={file.name}
                                    className="p-1 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors shrink-0 cursor-pointer"
                                    title="下载"
                                  >
                                    <Upload className="w-3.5 h-3.5 rotate-180" />
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-full max-w-3xl flex flex-col gap-3.5">
                        {(msg.timeline || (msg.thinking && msg.thinking.trim()) || (msg.toolsUsed && msg.toolsUsed.length > 0) || msg.id === activeStreamingMessageId) && (
                          <AgentFlowView
                            timeline={msg.timeline || []}
                            isStreaming={msg.id === activeStreamingMessageId}
                            collapsedThoughts={expandedThinking}
                            toggleThought={(key) => setExpandedThinking(prev => ({ ...prev, [key]: !prev[key] }))}
                            renderText={renderFormattedTextWithSkills}
                            renderMarkdown={(content) => (
                              <Markdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  a: ({ href, children }) => {
                                    if (href && href.startsWith("skill:")) {
                                      return (
                                        <span className="text-emerald-600 font-extrabold bg-emerald-50 border border-emerald-200/80 px-1.5 py-0.5 rounded-md mx-1 shadow-3xs inline-flex items-center gap-1.5 align-baseline select-all">
                                          <Layers className="w-3.5 h-3.5 text-emerald-500 inline animate-pulse" />
                                          {children}
                                        </span>
                                      );
                                    }
                                    return <a href={href} className="text-indigo-600 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>;
                                  }
                                }}
                              >
                                {preprocessMarkdown(content)}
                              </Markdown>
                            )}
                          />
                        )}

                        {!msg.timeline && (
                        <div className="w-full bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden relative group/card hover:shadow-sm transition-shadow max-w-3xl">
                          <div className="absolute top-3 right-3 opacity-0 group-hover/card:opacity-100 transition-opacity duration-200 z-10">
                            <button
                              onClick={() => handleCopyContent(msg.content, msg.id)}
                              className="p-1.5 bg-white border border-slate-200/80 hover:bg-slate-50 text-slate-400 hover:text-slate-700 rounded-lg shadow-2xs hover:shadow-xs transition-all flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                              title="复制文本"
                            >
                              {copiedMsgId === msg.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  <span className="text-emerald-700 font-semibold font-sans">已复制</span>
                                </>
                              ) : (
                                <>
                                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                                  <span>复制</span>
                                </>
                              )}
                            </button>
                          </div>

                          <div className="p-6 prose-custom text-slate-800 leading-relaxed font-sans text-sm">
                            <Markdown 
                              remarkPlugins={[remarkGfm]}
                              components={{
                                a: ({ href, children }) => {
                                  if (href && href.startsWith("skill:")) {
                                    return (
                                      <span className="text-emerald-600 font-extrabold bg-emerald-50 border border-emerald-200/80 px-1.5 py-0.5 rounded-md mx-1 shadow-3xs inline-flex items-center gap-1.5 align-baseline select-all">
                                        <Layers className="w-3.5 h-3.5 text-emerald-500 inline animate-pulse" />
                                        {children}
                                      </span>
                                    );
                                  }
                                  return <a href={href} className="text-indigo-600 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>;
                                }
                              }}
                            >
                              {preprocessMarkdown(msg.content)}
                            </Markdown>
                          </div>
                        </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {isSending && (
                <div className="flex flex-col items-start">
                  <div className="flex items-center gap-2 mb-1.5 text-[10px] text-slate-400">
                    <span>Office AI 助理</span>
                    <span>•</span>
                    <span>思考中...</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 rounded-tl-none shadow-xs">
                    <div className="flex gap-1.5 items-center justify-center py-1">
                      <div className="w-2.5 h-2.5 bg-slate-400 rounded-full animate-pulse-dot"></div>
                      <div className="w-2.5 h-2.5 bg-slate-400 rounded-full animate-pulse-dot" style={{ animationDelay: "0.2s" }}></div>
                      <div className="w-2.5 h-2.5 bg-slate-400 rounded-full animate-pulse-dot" style={{ animationDelay: "0.4s" }}></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Box Footer */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white/90 to-transparent pt-12 pb-6 px-6 shrink-0 z-30 pointer-events-none">
          <div className="max-w-4xl mx-auto pointer-events-auto">
            <div className="relative border border-slate-200/90 focus-within:border-slate-400 focus-within:shadow-md rounded-2xl transition-all shadow-md flex flex-col bg-white/95 backdrop-blur-md">
              
              {pendingAttachments.length > 0 && (
                <div className="px-3.5 pt-3.5 pb-2 border-b border-slate-100 flex flex-wrap gap-2">
                  {pendingAttachments.map((file, idx) => (
                    <div key={idx} className="relative bg-slate-50 border border-slate-200 rounded-lg p-2 pr-8 flex items-center gap-2 text-xs text-slate-700 shadow-3xs max-w-xs">
                      {file.isImage ? (
                        <img src={file.url} alt={file.name} className="w-8 h-8 object-cover rounded-md border border-slate-200" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-8 h-8 rounded-md bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate text-[11px] text-slate-800" title={file.name}>{file.name}</p>
                        <p className="text-[9px] text-slate-400 font-mono mt-0.5">{file.size}</p>
                      </div>
                      <button 
                        onClick={() => {
                          setPendingAttachments(prev => prev.filter((_, i) => i !== idx));
                        }}
                        className="absolute top-1 right-1 p-0.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 cursor-pointer transition-colors"
                        title="移除"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showSkillsDropdown && (
                <div className="absolute bottom-full mb-2 left-0 right-0 bg-white border border-slate-200/95 rounded-xl shadow-lg overflow-hidden max-h-60 overflow-y-auto z-40 flex flex-col divide-y divide-slate-100">
                  <div className="px-3.5 py-1.5 bg-slate-50/80 text-[10px] font-semibold text-slate-400 flex items-center justify-between shrink-0">
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>显式引用自动化技能 (键盘上下键选择，回车确认)</span>
                    </span>
                    <span>{filteredSkillsForDropdown.length} 项可用</span>
                  </div>
                  {filteredSkillsForDropdown.length > 0 ? (
                    filteredSkillsForDropdown.map((skill, idx) => (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => selectSkillForInput(skill)}
                        className={`w-full text-left px-3.5 py-2 flex items-start gap-3 transition-colors cursor-pointer ${
                          idx === selectedDropdownIndex 
                            ? "bg-slate-50 text-slate-900 font-semibold" 
                            : "text-slate-600 hover:bg-slate-50/50"
                        }`}
                      >
                        <div className={`p-1 rounded-md shrink-0 mt-0.5 ${
                          skill.enabled 
                            ? "bg-emerald-50 text-emerald-600 border border-emerald-100" 
                            : "bg-slate-50 text-slate-400 border border-slate-100"
                        }`}>
                          <Layers className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0 flex-1 py-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-800">{skill.name}</span>
                            {skill.enabled ? (
                              <span className="px-1 py-0.2 text-[8px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-100/50 rounded-sm">已就绪</span>
                            ) : (
                              <span className="px-1 py-0.2 text-[8px] font-medium bg-slate-100 text-slate-400 border border-slate-200/50 rounded-sm">未开启</span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">{skill.description}</p>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-4 text-center text-xs text-slate-400 bg-white">
                      未找到匹配的自动化技能
                    </div>
                  )}
                </div>
              )}

              <textarea 
                id="chat-textarea"
                value={inputMessage}
                onChange={(e) => {
                  const value = e.target.value;
                  setInputMessage(value);
                  
                  const lastSlashIndex = value.lastIndexOf("/");
                  if (lastSlashIndex !== -1 && (lastSlashIndex === 0 || value[lastSlashIndex - 1] === " " || value[lastSlashIndex - 1] === "\n")) {
                    const query = value.slice(lastSlashIndex + 1);
                    if (!query.includes(" ")) {
                      setShowSkillsDropdown(true);
                      setSearchSkillText(query);
                      setSelectedDropdownIndex(0);
                      return;
                    }
                  }
                  setShowSkillsDropdown(false);
                }}
                onKeyDown={(e) => {
                  if (showSkillsDropdown) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSelectedDropdownIndex(prev => 
                        prev < filteredSkillsForDropdown.length - 1 ? prev + 1 : 0
                      );
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSelectedDropdownIndex(prev => 
                        prev > 0 ? prev - 1 : filteredSkillsForDropdown.length - 1
                      );
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      if (filteredSkillsForDropdown[selectedDropdownIndex]) {
                        selectSkillForInput(filteredSkillsForDropdown[selectedDropdownIndex]);
                      }
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setShowSkillsDropdown(false);
                    }
                  } else {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }
                }}
                placeholder="输入自动化任务指令，如‘帮我写周报草稿’。输入 '/' 可以呼出自动化技能包列表..."
                rows={2}
                className="w-full px-3.5 pt-3.5 pb-2 text-sm focus:outline-hidden resize-none placeholder-slate-400 border-none bg-transparent min-h-[60px]"
              />

              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                multiple 
                onChange={(e) => {
                  if (e.target.files) processFiles(e.target.files);
                  e.target.value = '';
                }} 
              />
              <input 
                type="file" 
                ref={imageInputRef} 
                className="hidden" 
                accept="image/*" 
                multiple 
                onChange={(e) => {
                  if (e.target.files) processFiles(e.target.files);
                  e.target.value = '';
                }} 
              />

              <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-slate-100 bg-slate-50/35 rounded-b-xl">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-all flex items-center gap-1 text-xs font-medium cursor-pointer"
                    title="上传文档/文件"
                  >
                    <Paperclip className="w-4 h-4" />
                    <span className="hidden sm:inline">文档</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-all flex items-center gap-1 text-xs font-medium cursor-pointer"
                    title="上传图片"
                  >
                    <Image className="w-4 h-4" />
                    <span className="hidden sm:inline">图片</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchSkillText("");
                      setShowSkillsDropdown(!showSkillsDropdown);
                    }}
                    className={`p-1.5 rounded-lg transition-all flex items-center gap-1.5 text-xs font-medium cursor-pointer ${
                      showSkillsDropdown 
                        ? "text-emerald-600 bg-emerald-50 border border-emerald-200/50" 
                        : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                    }`}
                    title="插入/引用技能"
                  >
                    <Layers className="w-4 h-4 text-emerald-500" />
                    <span className="hidden sm:inline">技能</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-white border border-slate-200/85 hover:bg-slate-50 hover:border-slate-300 rounded-lg px-2.5 py-1.5 shadow-3xs transition-all">
                    <Brain className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <select 
                      value={selectedModelId}
                      onChange={(e) => setSelectedModelId(e.target.value)}
                      className="bg-transparent border-none text-[11px] font-medium text-slate-600 hover:text-slate-800 cursor-pointer focus:ring-0 focus:outline-hidden py-0 pl-0 pr-1.5 select-none leading-none"
                    >
                      {modelConfigs.filter(m => m.enabled).map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>

                  <button 
                    type="button"
                    onClick={() => handleSendMessage()}
                    disabled={(!inputMessage.trim() && pendingAttachments.length === 0) || isSending}
                    className={`p-1.5 px-3 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      (inputMessage.trim() || pendingAttachments.length > 0) && !isSending 
                        ? "bg-slate-900 text-white hover:bg-slate-800" 
                        : "bg-slate-100 text-slate-400 border border-slate-200/40 cursor-not-allowed"
                    }`}
                    title="发送"
                  >
                    <span>发送</span>
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>

      </div>
    </motion.div>
  );
};
