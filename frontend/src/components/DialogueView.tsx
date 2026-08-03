import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { 
  Upload, AlertCircle, LogIn, LogOut, Sparkles, TrendingUp, Link, Mail, Brain, 
  FileText, Terminal, ChevronUp, ChevronDown, Loader2, Play, ChevronRight, 
  Check, Layers, Paperclip, Image, Send, X 
} from "lucide-react";
import { Session, Skill, UserProfile, ModelConfig, Attachment } from "../types";

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
                        {(msg.thinking || (msg.toolsUsed && msg.toolsUsed.length > 0) || msg.id === activeStreamingMessageId) && (
                          <div className="w-full bg-slate-50/70 border border-slate-200/60 rounded-xl overflow-hidden transition-all duration-200 hover:border-slate-300 shadow-3xs">
                            <div 
                              onClick={() => setExpandedThinking(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                              className="flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100/50 cursor-pointer select-none border-b border-slate-100"
                            >
                              <div className="flex items-center gap-2">
                                <div className="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center">
                                  <Terminal className="w-3 h-3 text-indigo-600 animate-pulse" />
                                </div>
                                <span className="text-xs font-semibold text-slate-700 font-sans flex items-center gap-1.5">
                                  <span>AI Agent 运行记录与链路分析</span>
                                  {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                                    <span className="px-1.5 py-0.2 bg-indigo-100 text-indigo-800 rounded text-[9px] font-mono font-bold">
                                      调用 {msg.toolsUsed.length} 个工具
                                    </span>
                                  )}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-400 font-sans font-medium">
                                  {expandedThinking[msg.id] ? "收起日志" : "展开执行路径"}
                                </span>
                                {expandedThinking[msg.id] ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                )}
                              </div>
                            </div>

                            {expandedThinking[msg.id] && (
                              <div className="p-5 bg-white border-t border-slate-100 space-y-4">
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                                  <Brain className="w-3.5 h-3.5 text-indigo-500" />
                                  <span>时序链路执行轨迹 (Chronological Execution Path)</span>
                                </div>

                                {(() => {
                                  const isStreaming = msg.id === activeStreamingMessageId;
                                  const thoughts = msg.thinking ? msg.thinking.split('\n').filter(line => line.trim()) : [];
                                  const tools = msg.toolsUsed || [];
                                  const timeline: { type: "thought" | "tool"; text: string; tool?: any }[] = [];

                                  // 运行中：thought 文字统一由末尾打字机流式展示，timeline 只放工具块，避免重复
                                  if (isStreaming) {
                                    tools.forEach(tool => {
                                      timeline.push({ type: "tool", text: `调用外部系统接口: ${tool.name}`, tool });
                                    });
                                  } else if (thoughts.length > 0 && tools.length > 0) {
                                    const splitIndex = Math.max(1, Math.min(Math.floor(thoughts.length / 2), thoughts.length - 1));

                                    thoughts.slice(0, splitIndex).forEach(t => {
                                      timeline.push({ type: "thought", text: t });
                                    });

                                    tools.forEach(tool => {
                                      timeline.push({ type: "tool", text: `调用外部系统接口: ${tool.name}`, tool });
                                    });

                                    thoughts.slice(splitIndex).forEach(t => {
                                      timeline.push({ type: "thought", text: t });
                                    });
                                  } else if (thoughts.length > 0) {
                                    thoughts.forEach(t => {
                                      timeline.push({ type: "thought", text: t });
                                    });
                                  } else if (tools.length > 0) {
                                    tools.forEach(tool => {
                                      timeline.push({ type: "tool", text: `调用外部系统接口: ${tool.name}`, tool });
                                    });
                                  }

                                  return (
                                    <div className="relative border-l border-slate-200 ml-4 pl-6 space-y-5 py-2">
                                      {timeline.map((event, idx) => {
                                        const isTool = event.type === "tool";
                                        const isCurrentActiveStep = msg.id === activeStreamingMessageId && idx === timeline.length - 1;
                                        
                                        return (
                                          <div key={idx} className="relative group/step">
                                            {isCurrentActiveStep ? (
                                              <div className="absolute -left-[32px] top-1 w-3 h-3 flex items-center justify-center bg-white rounded-full">
                                                <Loader2 className={`w-3.5 h-3.5 animate-spin ${isTool ? "text-amber-500" : "text-indigo-500"}`} />
                                              </div>
                                            ) : (
                                              <div className={`absolute -left-[31px] top-1.5 w-2.5 h-2.5 rounded-full border-2 transition-colors duration-200 ${
                                                isTool 
                                                  ? "bg-amber-500 border-white ring-4 ring-amber-50/50 group-hover/step:ring-amber-100" 
                                                  : "bg-indigo-500 border-white ring-4 ring-indigo-50/50 group-hover/step:ring-indigo-100"
                                              }`} />
                                            )}
                                            
                                            {isTool ? (
                                              <div className={`bg-slate-50/60 border rounded-xl p-3.5 space-y-2.5 shadow-3xs transition-all duration-200 ${
                                                isCurrentActiveStep 
                                                  ? "border-amber-400 bg-amber-50/10 shadow-xs ring-2 ring-amber-500/15" 
                                                  : "border-slate-200/60 hover:border-slate-300"
                                              }`}>
                                                <div className="flex items-center justify-between">
                                                  <div className="flex items-center gap-2">
                                                    <div className="w-5 h-5 rounded bg-amber-500/10 flex items-center justify-center text-amber-600">
                                                      <Play className={`w-3 h-3 fill-amber-600 ${isCurrentActiveStep ? "animate-pulse" : ""}`} />
                                                    </div>
                                                    <span className={`font-mono text-xs font-bold ${isCurrentActiveStep ? "text-amber-700" : "text-slate-800"}`}>
                                                      {event.tool.name}
                                                    </span>
                                                  </div>
                                                  {isCurrentActiveStep ? (
                                                    <span className="px-2 py-0.5 text-[9px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full font-mono font-bold animate-pulse">
                                                      工具执行中...
                                                    </span>
                                                  ) : (
                                                    <span className="px-2 py-0.5 text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full font-mono font-bold">
                                                      执行成功
                                                    </span>
                                                  )}
                                                </div>
                                                
                                                <div className="space-y-2 pt-2 border-t border-slate-200/30 text-[11px] text-slate-600">
                                                  <details className="group" open={isCurrentActiveStep}>
                                                    <summary className="list-none flex items-center gap-1.5 cursor-pointer text-slate-500 hover:text-slate-800 font-medium select-none">
                                                      <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform text-slate-400" />
                                                      <span>输入参数 (Parameters)</span>
                                                    </summary>
                                                    <div className="mt-1.5 pl-3 border-l-2 border-slate-200 py-1 font-mono text-[10px] text-slate-600 overflow-x-auto whitespace-pre-wrap bg-slate-100/50 rounded-md p-2">
                                                      {renderToolPayload(event.tool.args)}
                                                    </div>
                                                  </details>
                                                  
                                                  {event.tool.result && (
                                                    <details className="group">
                                                      <summary className="list-none flex items-center gap-1.5 cursor-pointer text-slate-500 hover:text-slate-800 font-medium select-none mt-1">
                                                        <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform text-slate-400" />
                                                        <span>输出反馈 (Result Context)</span>
                                                      </summary>
                                                      <div className="mt-1.5 pl-3 border-l-2 border-emerald-200 py-1 font-mono text-[10px] text-emerald-800 overflow-x-auto bg-emerald-50/40 rounded-md p-2">
                                                        {renderToolPayload(event.tool.result)}
                                                      </div>
                                                    </details>
                                                  )}
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="flex flex-col gap-0.5 pl-1">
                                                <span className={`text-xs font-medium leading-relaxed font-sans transition-all duration-200 ${
                                                  isCurrentActiveStep 
                                                    ? "text-indigo-600 font-bold bg-indigo-50/40 border-l-2 border-indigo-500 pl-2 py-0.5" 
                                                    : "text-slate-700"
                                                }`}>
                                                  {renderFormattedTextWithSkills(event.text)}
                                                </span>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                      
                                      {msg.id === activeStreamingMessageId ? (
                                        <div className="relative group/step">
                                          <div className="absolute -left-[32px] top-1 w-3 h-3 flex items-center justify-center bg-white rounded-full">
                                            <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                                          </div>
                                          <div className="flex flex-col gap-1 pl-1">
                                            <span className="text-xs font-medium text-slate-500 font-sans leading-relaxed">
                                              {msg.thinking && msg.thinking.trim() ? (
                                                <TypewriterText text={msg.thinking} isActive={msg.id === activeStreamingMessageId} />
                                              ) : (
                                                <>
                                                  正在理解任务并规划执行路径...
                                                  <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-indigo-500/70 animate-pulse rounded-sm" />
                                                </>
                                              )}
                                            </span>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="relative group/step">
                                          <div className="absolute -left-[31px] top-1.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-white ring-4 ring-emerald-50/50" />
                                          <div className="flex flex-col gap-0.5 pl-1">
                                            <span className="text-xs text-emerald-700 font-semibold font-sans">
                                              大模型成果整合就绪
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        )}

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
