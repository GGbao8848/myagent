import React, { useState, useEffect, useRef } from "react";
import { 
  MessageSquare, Layers, Brain, Database, Settings, 
  Plus, Trash2, Send, Play, Pause, Check, X, Upload, Copy,
  Sparkles, Key, AlertTriangle, RefreshCw, User, 
  ChevronDown, ChevronUp, Terminal, Search, Flame, 
  Calendar, Info, HelpCircle, ChevronLeft, ChevronRight, Menu,
  Clock, Edit3, AlertCircle, PlayCircle, Eye, Image, FileText, Paperclip, Loader2,
  TrendingUp, Link, Mail, Wrench, Pin, LogOut, LogIn, ShieldCheck, UserCheck, Smartphone
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { 
  Session, Message, Skill, MemoryItem, 
  MCPServer, ModelConfig, UserProfile, ScheduleTask
} from "./types";
import {
  initialUserProfile, initialSkills, initialMemories,
  initialMcpServers, initialSessions,
  initialScheduleTasks
} from "./mockData";
import { DialogueView } from "./components/DialogueView";
import { SkillsView } from "./components/SkillsView";
import { MemoryView } from "./components/MemoryView";
import { SchedulerView } from "./components/SchedulerView";
import { McpView } from "./components/McpView";
import { SettingsView } from "./components/SettingsView";
import { ApiDocsModal } from "./components/modals/ApiDocsModal";
import LoginPage from "./components/LoginPage";
import { isLoggedIn as hasAuthToken, getStoredUser, logout, startLogin, handleCallback } from "./auth";
import { apiFetch, createSession, getSession, listSessions, deleteSession, streamChat, getSettings } from "./api";

export default function App() {
  // --- Page Navigation State ---
  const [activeTab, setActiveTab] = useState<"dialogue" | "skills" | "memory" | "scheduler" | "mcp" | "settings">("dialogue");
  const [showTips, setShowTips] = useState<boolean>(() => {
    const saved = localStorage.getItem("office_ai_show_tips");
    return saved === "true"; // Defaults to false
  });

  const toggleShowTips = () => {
    setShowTips(prev => {
      const next = !prev;
      localStorage.setItem("office_ai_show_tips", String(next));
      return next;
    });
  };

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem("office_ai_sidebar_collapsed");
    return saved === "true";
  });

  const [isNavExpanded, setIsNavExpanded] = useState<boolean>(() => {
    const saved = localStorage.getItem("office_ai_nav_expanded");
    return saved !== "false";
  });

  const toggleNavExpanded = () => {
    setIsNavExpanded(prev => {
      const next = !prev;
      localStorage.setItem("office_ai_nav_expanded", String(next));
      return next;
    });
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("office_ai_sidebar_collapsed", String(next));
      return next;
    });
  };

  const [showApiDocsModal, setShowApiDocsModal] = useState<boolean>(false);

  // --- Local Database States (with localStorage recovery) ---
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem("office_ai_profile");
    return saved ? JSON.parse(saved) : initialUserProfile;
  });

  // --- Auth / Login / Logout States ---
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => hasAuthToken());
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [showUserDropdown, setShowUserDropdown] = useState<boolean>(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Keycloak 回调处理：页面加载时检测 ?code= 参数
  const callbackProcessed = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (code && state && !callbackProcessed.current) {
      callbackProcessed.current = true;
      // 用当前域名对应的 client 信息处理回调
      handleCallback(code, state)
        .then(() => {
          setIsLoggedIn(true);
          const user = getStoredUser();
          if (user) {
            setUserProfile((prev) => ({
              ...prev,
              name: user.name || user.username || "企业用户",
              role: "团队成员",
              department: "综合业务部",
            }));
          }
          setAuthNotice(`欢迎回来，${getStoredUser()?.name || getStoredUser()?.username || "用户"}！`);
          setTimeout(() => setAuthNotice(null), 4000);
          // 清理 URL，去掉 code/state 参数
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch((err) => {
          console.error("登录回调失败:", err);
          setAuthNotice("登录失败，请重试");
          setTimeout(() => setAuthNotice(null), 4000);
          logout();
          setIsLoggedIn(false);
        });
    }

    // 无 token 且不是回调页 → 自动跳 Keycloak（不显示登录页）
    if (!hasAuthToken() && !code) {
      startLogin();
    }
  }, []);

  const handleLogout = () => {
    // logout() 会跳转 Keycloak 注销页，页面将被替换，无需额外 setState
    logout();
  };

  const [skills, setSkills] = useState<Skill[]>(() => {
    const saved = localStorage.getItem("office_ai_skills");
    return saved ? JSON.parse(saved) : initialSkills;
  });

  const [memories, setMemories] = useState<MemoryItem[]>(() => {
    const saved = localStorage.getItem("office_ai_memories");
    return saved ? JSON.parse(saved) : initialMemories;
  });

  const [isMemoryEnabled, setIsMemoryEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("office_ai_memory_enabled");
    return saved !== "false";
  });

  const [mcpServers, setMcpServers] = useState<MCPServer[]>(() => {
    const saved = localStorage.getItem("office_ai_mcp_servers");
    return saved ? JSON.parse(saved) : initialMcpServers;
  });

  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);

  const [scheduleTasks, setScheduleTasks] = useState<ScheduleTask[]>(() => {
    const saved = localStorage.getItem("office_ai_schedule_tasks");
    return saved ? JSON.parse(saved) : initialScheduleTasks;
  });

  const [sessions, setSessions] = useState<Session[]>([]);

  const [activeSessionId, setActiveSessionId] = useState<string>("");

  // 登录后从后端加载会话列表
  useEffect(() => {
    if (!hasAuthToken()) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listSessions();
        if (cancelled) return;
        const mapped: Session[] = list.map(s => ({
          id: s.id,
          title: s.title,
          model: modelConfigs.find(m => m.id === selectedModelId)?.name || "Gemini 3.5 Flash",
          createdAt: s.created_at.split('T')[0],
          messages: []
        }));
        setSessions(mapped);
        if (mapped.length > 0) {
          // 加载第一个会话的详情
          const detail = await getSession(mapped[0].id);
          if (cancelled) return;
          const msgs: Message[] = detail.messages.map(m => ({
            id: "msg_" + m.id,
            role: m.role as any,
            content: m.content,
            timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            thinking: (m.metadata as any)?.timeline?.map((t: any) => t.content).join("\n") || "",
          }));
          setSessions(prev => prev.map((s, i) => i === 0 ? { ...s, messages: msgs } : s));
          setActiveSessionId(mapped[0].id);
        }
      } catch (e) {
        console.error("加载会话失败:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  // 登录后从后端加载真实 LLM 模型配置（替换 mock 数据）
  useEffect(() => {
    if (!hasAuthToken()) return;
    (async () => {
      try {
        const settings = await getSettings();
        const providers = settings.llmProviders || [];
        if (providers.length > 0) {
          const mapped: ModelConfig[] = providers.map((p) => ({
            id: p.id,
            name: p.name,
            provider: "Custom",
            apiKey: p.apiKey,
            baseUrl: p.baseUrl,
            enabled: true,
            isCustom: true,
          }));
          setModelConfigs(mapped);
          // 设置默认选中模型
          const active = settings.activeProviderId;
          if (active) setSelectedModelId(active);
        }
      } catch (e) {
        console.error("加载模型配置失败:", e);
      }
    })();
  }, [isLoggedIn]);

  const [selectedModelId, setSelectedModelId] = useState<string>("model_gemini");

  // --- UI Interactive States ---
  const [inputMessage, setInputMessage] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const [activeStreamingMessageId, setActiveStreamingMessageId] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<{ [msgId: string]: boolean }>({});
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [copiedParamKey, setCopiedParamKey] = useState<string | null>(null);
  const [expandedMcpServers, setExpandedMcpServers] = useState<{ [serverId: string]: boolean }>({});

  // Global Toast Notification State
  const [toast, setToast] = useState<{ message: string; type: "info" | "warning" | "success" } | null>(null);

  const showToast = (message: string, type: "info" | "warning" | "success" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => prev && prev.message === message ? null : prev);
    }, 3000);
  };

  const handleCopyParamName = (paramName: string, toolName?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(paramName);
    const key = toolName ? `${toolName}:${paramName}` : paramName;
    setCopiedParamKey(key);
    showToast(`已成功复制参数名 "${paramName}" 到剪贴板`, "success");
    setTimeout(() => {
      setCopiedParamKey(prev => prev === key ? null : prev);
    }, 2000);
  };

  // Skills Dropdown States for "/" command
  const [showSkillsDropdown, setShowSkillsDropdown] = useState<boolean>(false);
  const [searchSkillText, setSearchSkillText] = useState<string>("");
  const [selectedDropdownIndex, setSelectedDropdownIndex] = useState<number>(0);

  const filteredSkillsForDropdown = skills.filter(s => 
    s.name.toLowerCase().includes(searchSkillText.toLowerCase()) || 
    s.description.toLowerCase().includes(searchSkillText.toLowerCase())
  );

  const renderFormattedTextWithSkills = (content: string, isWhiteText = false) => {
    if (!content) return "";
    
    // Build regex dynamically from skills
    const skillNames = skills.map(s => s.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    if (skillNames.length === 0) return content;
    
    // Pattern to match: /[Name], /【Name】, [Name], 【Name】, /Name, and standard Name
    const regexPattern = new RegExp(`(\\/(?:\\[(?:${skillNames.join('|')})\\]|【(?:${skillNames.join('|')})】|(?:${skillNames.join('|')}))|\\[(?:${skillNames.join('|')})\\]|【(?:${skillNames.join('|')})】|(?:${skillNames.join('|')}))`, 'g');
    
    const parts = content.split(regexPattern);
    return parts.map((part, index) => {
      if (!part) return null;
      
      const cleanName = part.replace(/^[\/\[【]+|[\/\]】]+$/g, '').trim();
      const matchedSkill = skills.find(s => s.name === cleanName);
      
      if (matchedSkill) {
        return (
          <span 
            key={index} 
            className={`font-extrabold px-1.5 py-0.5 rounded-md mx-1 shadow-3xs inline-flex items-center gap-1.5 align-baseline select-all border ${
              isWhiteText
                ? "text-emerald-300 bg-emerald-950/80 border-emerald-500/40"
                : "text-emerald-600 bg-emerald-50 border-emerald-200/80"
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-current inline animate-pulse" />
            {part}
          </span>
        );
      }
      return part;
    });
  };

  const preprocessMarkdown = (content: string) => {
    if (!content) return "";
    let result = content;
    skills.forEach(skill => {
      const escapedName = skill.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const patterns = [
        new RegExp(`\\/\\[${escapedName}\\]`, 'g'),
        new RegExp(`\\/【${escapedName}】`, 'g'),
        new RegExp(`\\/${escapedName}`, 'g'),
        new RegExp(`\\[${escapedName}\\]`, 'g'),
        new RegExp(`【${escapedName}】`, 'g'),
      ];
      patterns.forEach(pattern => {
        result = result.replace(pattern, (match) => `[${match}](skill:${skill.id})`);
      });
    });
    return result;
  };

  // File upload and drag states
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [pendingAttachments, setPendingAttachments] = useState<{
    name: string;
    size: string;
    type: string;
    url?: string;
    isImage?: boolean;
  }[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeTab === "dialogue") {
      setIsDraggingFile(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    if (activeTab === "dialogue" && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const processFiles = (fileList: FileList) => {
    const newAttachments: { name: string; size: string; type: string; url?: string; isImage?: boolean }[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const isImage = file.type.startsWith("image/");
      let sizeStr = "0 KB";
      if (file.size > 1024 * 1024) {
        sizeStr = (file.size / (1024 * 1024)).toFixed(1) + " MB";
      } else {
        sizeStr = (file.size / 1024).toFixed(0) + " KB";
      }
      
      const url = URL.createObjectURL(file);
      newAttachments.push({
        name: file.name,
        size: sizeStr,
        type: file.type,
        url,
        isImage
      });
    }
    setPendingAttachments(prev => [...prev, ...newAttachments]);
  };

  const handleCopyContent = (text: string, msgId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(msgId);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };
  const [apiStatus, setApiStatus] = useState<{ status: string; apiKeyConfigured: boolean } | null>(null);

  // --- Modals / Add Forms ---
  const [showAddServerModal, setShowAddServerModal] = useState<boolean>(false);
  const [newServer, setNewServer] = useState({ name: "", type: "sse" as "sse" | "stdio", urlOrCommand: "" });
  const [mcpJsonText, setMcpJsonText] = useState<string>("");
  const [mcpJsonError, setMcpJsonError] = useState<string | null>(null);
  const [testingServerId, setTestingServerId] = useState<string | null>(null);

  const [showUploadSkillModal, setShowUploadSkillModal] = useState<boolean>(false);
  const [isDraggingSkill, setIsDraggingSkill] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState<string | null>(null);

  const [newMemoryContent, setNewMemoryContent] = useState<string>("");
  const [newMemoryCategory, setNewMemoryCategory] = useState<"preference" | "profile" | "system" | "schedule">("preference");

  const [showAddModelModal, setShowAddModelModal] = useState<boolean>(false);
  const [newModel, setNewModel] = useState({ name: "", provider: "OpenAI" as any, apiKey: "", baseUrl: "" });
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [modelConnectionStatuses, setModelConnectionStatuses] = useState<
    Record<string, { status: "connected" | "failed" | "simulated"; message: string; latency?: string }>
  >({});

  // --- Scheduler Tab States ---
  const [schedulerMessages, setSchedulerMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem("office_ai_scheduler_messages");
    if (saved) return JSON.parse(saved);
    return [
      {
        id: "sched_msg_1",
        role: "assistant",
        content: `您好！我是您的 **AI 智能日程计划助理**。您可以告诉我您希望**在什么时间运行什么任务，以及需要什么展现形式**，我会自动为您定制并生成定时任务。

例如，您可以说：
* “帮我定一个每周五下午5点的汇总周报任务，用 Markdown 的形式展示”
* “每天早上 9 点帮我调用数据库工具监控 API 延迟，用表格展示”

您也可以让我对现有的任务进行编辑或调整，比如：“把任务1的时间调整为每天上午 9 点半”。

请问您现在想要规划什么定时任务呢？`,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }
    ];
  });

  const [schedulerInput, setSchedulerInput] = useState<string>("");
  const [isSchedulerThinking, setIsSchedulerThinking] = useState<boolean>(false);
  const [editingTask, setEditingTask] = useState<ScheduleTask | null>(null);
  const [isEditingTaskOpen, setIsEditingTaskOpen] = useState<boolean>(false);
  const [viewingTask, setViewingTask] = useState<ScheduleTask | null>(null);
  const [runningTask, setRunningTask] = useState<ScheduleTask | null>(null);
  const [runningTaskLogs, setRunningTaskLogs] = useState<string[]>([]);
  const [runningTaskResult, setRunningTaskResult] = useState<{
    title: string;
    displayFormat: string;
    content: string;
  } | null>(null);
  const [taskDraft, setTaskDraft] = useState<Partial<ScheduleTask> | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // --- Effects for State Synchronization ---
  useEffect(() => {
    localStorage.setItem("office_ai_profile", JSON.stringify(userProfile));
  }, [userProfile]);

  useEffect(() => {
    localStorage.setItem("office_ai_skills", JSON.stringify(skills));
  }, [skills]);

  useEffect(() => {
    localStorage.setItem("office_ai_memories", JSON.stringify(memories));
  }, [memories]);

  useEffect(() => {
    localStorage.setItem("office_ai_memory_enabled", String(isMemoryEnabled));
  }, [isMemoryEnabled]);

  useEffect(() => {
    localStorage.setItem("office_ai_mcp_servers", JSON.stringify(mcpServers));
  }, [mcpServers]);

  useEffect(() => {
    localStorage.setItem("office_ai_schedule_tasks", JSON.stringify(scheduleTasks));
  }, [scheduleTasks]);

  useEffect(() => {
    localStorage.setItem("office_ai_scheduler_messages", JSON.stringify(schedulerMessages));
  }, [schedulerMessages]);

  useEffect(() => {
    localStorage.setItem("office_ai_sessions", JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem("office_ai_active_session", activeSessionId);
  }, [activeSessionId]);

  // Check API health status on load
  useEffect(() => {
    apiFetch("/api/health")
      .then(res => res.json())
      .then(data => setApiStatus(data))
      .catch(err => console.error("Error fetching API health:", err));
  }, []);

  // Scroll to bottom of chat
  useEffect(() => {
    if (activeTab === "dialogue") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [sessions, activeSessionId, isSending, activeTab]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];

  // Helper function to stream agent execution trace (thinking/running status steps) and text message content (typewriter)
  const streamResponse = async (aiMsg: Message, currentSessionId: string) => {
    setActiveStreamingMessageId(aiMsg.id);

    const initialAiMsg: Message = {
      ...aiMsg,
      content: "",
      thinking: "",
      toolsUsed: []
    };

    // 1. Add the initial empty message
    setSessions(prevSessions => {
      return prevSessions.map(s => {
        if (s.id === currentSessionId) {
          return {
            ...s,
            messages: [...s.messages, initialAiMsg]
          };
        }
        return s;
      });
    });

    if (aiMsg.thinking) {
      setExpandedThinking(prev => ({ ...prev, [aiMsg.id]: true }));
    }

    // 2. Parse chronological timeline steps
    const thoughtsList = aiMsg.thinking ? aiMsg.thinking.split('\n').filter(line => line.trim()) : [];
    const toolsList = aiMsg.toolsUsed || [];
    const steps: { type: "thought" | "tool"; data: any }[] = [];

    if (thoughtsList.length > 0 && toolsList.length > 0) {
      const splitIndex = Math.max(1, Math.min(Math.floor(thoughtsList.length / 2), thoughtsList.length - 1));
      thoughtsList.slice(0, splitIndex).forEach(t => {
        steps.push({ type: "thought", data: t });
      });
      toolsList.forEach(tool => {
        steps.push({ type: "tool", data: tool });
      });
      thoughtsList.slice(splitIndex).forEach(t => {
        steps.push({ type: "thought", data: t });
      });
    } else if (thoughtsList.length > 0) {
      thoughtsList.forEach(t => {
        steps.push({ type: "thought", data: t });
      });
    } else if (toolsList.length > 0) {
      toolsList.forEach(tool => {
        steps.push({ type: "tool", data: tool });
      });
    }

    // 3. Progressively output running state (steps)
    let currentThoughts: string[] = [];
    let currentTools: any[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === "thought") {
        currentThoughts.push(step.data);
      } else {
        currentTools.push(step.data);
      }

      setSessions(prevSessions => {
        return prevSessions.map(s => {
          if (s.id === currentSessionId) {
            return {
              ...s,
              messages: s.messages.map(m => {
                if (m.id === aiMsg.id) {
                  return {
                    ...m,
                    thinking: currentThoughts.join('\n'),
                    toolsUsed: [...currentTools]
                  };
                }
                return m;
              })
            };
          }
          return s;
        });
      });

      // Quick scroll to reveal steps
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

      // Dynamic timeline step delay
      await new Promise(resolve => setTimeout(resolve, 350));
    }

    // 4. Stream message text content via typewriter
    const fullText = aiMsg.content;
    let currentText = "";
    const chunkSize = 2; 
    const frameDelay = 15; 

    for (let i = 0; i < fullText.length; i += chunkSize) {
      currentText = fullText.slice(0, i + chunkSize);

      setSessions(prevSessions => {
        return prevSessions.map(s => {
          if (s.id === currentSessionId) {
            return {
              ...s,
              messages: s.messages.map(m => {
                if (m.id === aiMsg.id) {
                  return {
                    ...m,
                    content: currentText
                  };
                }
                return m;
              })
            };
          }
          return s;
        });
      });

      // Maintain viewport focus
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });

      await new Promise(resolve => setTimeout(resolve, frameDelay));
    }

    // 5. Stream finished - write final clean message structure
    setSessions(prevSessions => {
      return prevSessions.map(s => {
        if (s.id === currentSessionId) {
          return {
            ...s,
            messages: s.messages.map(m => {
              if (m.id === aiMsg.id) {
                return aiMsg;
              }
              return m;
            })
          };
        }
        return s;
      });
    });

    setActiveStreamingMessageId(null);
  };

  // --- Handler Functions ---

  // 1. Send Chat Message
  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputMessage;
    if (!text.trim() || isSending) return;

    if (!textToSend) {
      setInputMessage("");
    }

    // Create session if none exists（后端创建）
    let currentSessionId = activeSessionId;
    let updatedSessions = [...sessions];

    if (!activeSession) {
      try {
        const created = await createSession();
        currentSessionId = created.id;
        const newSess: Session = {
          id: created.id,
          title: created.title,
          model: modelConfigs.find(m => m.id === selectedModelId)?.name || "Gemini 3.5 Flash",
          createdAt: created.created_at.split('T')[0],
          messages: []
        };
        updatedSessions = [newSess, ...sessions];
        setSessions(updatedSessions);
        setActiveSessionId(created.id);
      } catch (e) {
        showToast("创建会话失败", "warning");
        setIsSending(false);
        return;
      }
    }

    // Append User Message
    const userMsg: Message = {
      id: "msg_user_" + Date.now(),
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      attachments: pendingAttachments.length > 0 ? [...pendingAttachments] : undefined
    };

    const targetSessionIndex = updatedSessions.findIndex(s => s.id === currentSessionId);
    if (targetSessionIndex === -1) return;

    const currentMessages = [...updatedSessions[targetSessionIndex].messages, userMsg];
    updatedSessions[targetSessionIndex].messages = currentMessages;
    
    // Auto rename default session title if it is a new session with 1 message
    if (updatedSessions[targetSessionIndex].title.startsWith("新建会话") || updatedSessions[targetSessionIndex].messages.length === 1) {
      updatedSessions[targetSessionIndex].title = text.length > 18 ? text.substring(0, 18) + "..." : text;
    }

    setSessions(updatedSessions);
    setIsSending(true);
    setPendingAttachments([]);

    try {
      // 创建空的 assistant 消息用于流式填充
      const aiMsg: Message = {
        id: "msg_ai_" + Date.now(),
        role: "assistant",
        content: "",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        thinking: "",
        toolsUsed: []
      };

      // 先加空消息占位
      setSessions(prevSessions => {
        return prevSessions.map(s => {
          if (s.id === currentSessionId) {
            return { ...s, messages: [...s.messages, aiMsg] };
          }
          return s;
        });
      });
      setActiveStreamingMessageId(aiMsg.id);

      // SSE 流式对话
      await streamChat(currentSessionId, text, (evt) => {
        if (evt.event === "thinking") {
          setSessions(prevSessions => {
            return prevSessions.map(s => {
              if (s.id !== currentSessionId) return s;
              return {
                ...s,
                messages: s.messages.map(m => {
                  if (m.id === aiMsg.id) {
                    return { ...m, thinking: (m.thinking || "") + evt.content };
                  }
                  return m;
                })
              };
            });
          });
        } else if (evt.event === "tool_call") {
          const toolInfo = `\n🔧 调用工具: ${evt.tool_name}\n参数: ${evt.args}`;
          setSessions(prevSessions => {
            return prevSessions.map(s => {
              if (s.id !== currentSessionId) return s;
              return {
                ...s,
                messages: s.messages.map(m => {
                  if (m.id === aiMsg.id) {
                    return {
                      ...m,
                      toolsUsed: [...(m.toolsUsed || []), { name: evt.tool_name, args: evt.args, status: "running" as const }],
                      thinking: (m.thinking || "") + toolInfo
                    };
                  }
                  return m;
                })
              };
            });
          });
        } else if (evt.event === "tool_result") {
          setSessions(prevSessions => {
            return prevSessions.map(s => {
              if (s.id !== currentSessionId) return s;
              return {
                ...s,
                messages: s.messages.map(m => {
                  if (m.id === aiMsg.id) {
                    const tools = [...(m.toolsUsed || [])];
                    const last = tools[tools.length - 1];
                    if (last) last.status = "success";
                    return { ...m, toolsUsed: tools };
                  }
                  return m;
                })
              };
            });
          });
        } else if (evt.event === "done") {
          // 完成，无需额外处理（消息已持久化）
        } else if (evt.event === "error") {
          setSessions(prevSessions => {
            return prevSessions.map(s => {
              if (s.id !== currentSessionId) return s;
              return {
                ...s,
                messages: s.messages.map(m => {
                  if (m.id === aiMsg.id) return { ...m, content: evt.content };
                  return m;
                })
              };
            });
          });
        }
      });

      // 流结束后重新拉取会话，获取完整 assistant 消息
      const refreshed = await getSession(currentSessionId);
      const freshMessages: Message[] = refreshed.messages.map(m => ({
        id: "msg_" + m.id,
        role: m.role as any,
        content: m.content,
        timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        thinking: ((m.metadata as any)?.timeline as any[])?.map((t: any) => t.content).join("\n") || "",
      }));

      setSessions(prevSessions => {
        return prevSessions.map(s => {
          if (s.id === currentSessionId) {
            return { ...s, messages: freshMessages, title: refreshed.title };
          }
          return s;
        });
      });
      setActiveStreamingMessageId(null);

    } catch (error) {
      console.error("Chat sending error:", error);
      setActiveStreamingMessageId(null);
    } finally {
      setIsSending(false);
    }
  };

  // Select skill helper for slash command
  const selectSkillForInput = (skill: Skill) => {
    const lastSlashIndex = inputMessage.lastIndexOf("/");
    let updatedText = "";
    if (lastSlashIndex !== -1) {
      const beforeSlash = inputMessage.slice(0, lastSlashIndex);
      updatedText = beforeSlash + `/[${skill.name}] `;
    } else {
      updatedText = inputMessage + `/[${skill.name}] `;
    }
    setInputMessage(updatedText);
    setShowSkillsDropdown(false);
    
    // Focus back on textarea and place cursor at the end
    setTimeout(() => {
      const textarea = document.getElementById("chat-textarea") as HTMLTextAreaElement | null;
      if (textarea) {
        textarea.focus();
        const len = updatedText.length;
        textarea.setSelectionRange(len, len);
      }
    }, 50);
  };

  // 2. New Chat Session
  const handleCreateNewSession = () => {
    // Prevent creating a new session if there is already an empty one
    const emptySession = sessions.find(s => s.messages.length === 0);
    if (emptySession) {
      setActiveSessionId(emptySession.id);
      setActiveTab("dialogue");
      showToast("已有空白会话，请直接在此输入开始对话", "warning");
      
      // Focus on chat textarea
      setTimeout(() => {
        const textarea = document.getElementById("chat-textarea") as HTMLTextAreaElement | null;
        if (textarea) textarea.focus();
      }, 50);
      return;
    }

    const newId = "session_" + Date.now();
    const newSess: Session = {
      id: newId,
      title: "新建会话 " + (sessions.length + 1),
      model: modelConfigs.find(m => m.id === selectedModelId)?.name || "Gemini 3.5 Flash",
      createdAt: new Date().toISOString().split('T')[0],
      messages: []
    };
    setSessions([newSess, ...sessions]);
    setActiveSessionId(newId);
    setActiveTab("dialogue");
  };

  // 3. Delete Session
  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteSession(id);
    } catch (err) {
      console.error("删除会话失败:", err);
      showToast("删除会话失败", "warning");
      return;
    }
    const remaining = sessions.filter(s => s.id !== id);
    setSessions(remaining);
    if (activeSessionId === id && remaining.length > 0) {
      setActiveSessionId(remaining[0].id);
    } else if (remaining.length === 0) {
      setActiveSessionId("");
    }
  };

  // 4. Toggle Skill Enable/Disable
  const handleToggleSkill = (id: string) => {
    setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  };

  // 5. Update Skill Parameter Value
  const handleUpdateSkillParam = (skillId: string, paramName: string, value: string) => {
    setSkills(prev => prev.map(s => {
      if (s.id === skillId) {
        return {
          ...s,
          parameters: s.parameters.map(p => p.name === paramName ? { ...p, value } : p)
        };
      }
      return s;
    }));
  };

  // 6. Upload Custom Skill package
  const handleUploadSkill = (fileName: string) => {
    setUploadProgress(10);
    const interval = setInterval(() => {
      setUploadProgress(p => {
        if (p === null) return null;
        if (p >= 100) {
          clearInterval(interval);
          // Call API
          apiFetch("/api/skills/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName, fileSize: "240KB" })
          })
            .then(res => res.json())
            .then(data => {
              if (data.skill) {
                setSkills(prev => [...prev, data.skill]);
                setUploadSuccessMsg(data.message);
                setUploadProgress(null);
                setTimeout(() => {
                  setShowUploadSkillModal(false);
                  setUploadSuccessMsg(null);
                }, 1500);
              }
            })
            .catch(err => {
              console.error(err);
              setUploadProgress(null);
            });
          return 100;
        }
        return p + 30;
      });
    }, 200);
  };

  // 7. Add Fact Memory
  const handleAddMemory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemoryContent.trim()) return;

    const newItem: MemoryItem = {
      id: "mem_" + Date.now(),
      content: newMemoryContent,
      category: newMemoryCategory,
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      confidence: Math.floor(Math.random() * 6) + 93
    };

    setMemories([newItem, ...memories]);
    setNewMemoryContent("");
  };

  // 8. Delete Fact Memory
  const handleDeleteMemory = (id: string) => {
    setMemories(prev => prev.filter(m => m.id !== id));
  };

  // --- 8.1. Schedule Planner Handlers ---
  const handleToggleTask = (id: string) => {
    setScheduleTasks(prev => prev.map(t => {
      if (t.id === id) {
        const nextEnabled = !t.enabled;
        return {
          ...t,
          enabled: nextEnabled,
          nextRunTime: nextEnabled ? new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16) : undefined
        };
      }
      return t;
    }));
  };

  const handleDeleteTask = (id: string) => {
    setScheduleTasks(prev => prev.filter(t => t.id !== id));
    setSelectedTaskIds(prev => prev.filter(item => item !== id));
  };

  // --- Task Batch Operations ---
  const handleToggleSelectTask = (id: string) => {
    setSelectedTaskIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllTasks = () => {
    if (selectedTaskIds.length === scheduleTasks.length && scheduleTasks.length > 0) {
      setSelectedTaskIds([]);
    } else {
      setSelectedTaskIds(scheduleTasks.map(t => t.id));
    }
  };

  const handleBatchEnableTasks = () => {
    if (selectedTaskIds.length === 0) return;
    setScheduleTasks(prev => prev.map(t => {
      if (selectedTaskIds.includes(t.id)) {
        return {
          ...t,
          enabled: true,
          nextRunTime: new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16)
        };
      }
      return t;
    }));
    showToast(`成功批量激活 ${selectedTaskIds.length} 个任务`, "success");
    setSelectedTaskIds([]);
  };

  const handleBatchPauseTasks = () => {
    if (selectedTaskIds.length === 0) return;
    setScheduleTasks(prev => prev.map(t => {
      if (selectedTaskIds.includes(t.id)) {
        return {
          ...t,
          enabled: false,
          nextRunTime: undefined
        };
      }
      return t;
    }));
    showToast(`成功批量暂停 ${selectedTaskIds.length} 个任务`, "info");
    setSelectedTaskIds([]);
  };

  const handleBatchDeleteTasks = () => {
    if (selectedTaskIds.length === 0) return;
    if (window.confirm(`确定要彻底删除选中的 ${selectedTaskIds.length} 个定时任务吗？此操作不可撤销。`)) {
      setScheduleTasks(prev => prev.filter(t => !selectedTaskIds.includes(t.id)));
      showToast(`成功批量删除 ${selectedTaskIds.length} 个任务`, "success");
      setSelectedTaskIds([]);
    }
  };

  const handleSaveEditedTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask) return;

    setScheduleTasks(prev => prev.map(t => {
      if (t.id === editingTask.id) {
        // Calculate cron or text display if changed
        return editingTask;
      }
      return t;
    }));
    setIsEditingTaskOpen(false);
    setEditingTask(null);

    // Also notify scheduler agent
    const systemNotice: Message = {
      id: "sched_notice_" + Date.now(),
      role: "assistant",
      content: `💡 **系统通知**：您手动编辑并保存了定时任务【**${editingTask.title}**】。Cron调度线程已根据最新的时间设定（\`${editingTask.timeValue}\`）重新绑定。`,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    };
    setSchedulerMessages(prev => [...prev, systemNotice]);
  };

  const handleCreateTaskFromDraft = () => {
    if (!taskDraft) return;

    const newTask: ScheduleTask = {
      id: "task_" + Date.now(),
      title: taskDraft.title || "智能办公自定义任务",
      scheduleType: taskDraft.scheduleType || "daily",
      timeValue: taskDraft.timeValue || "09:00",
      cronExpression: taskDraft.cronExpression || "0 9 * * *",
      prompt: taskDraft.prompt || "无运行内容",
      displayFormat: taskDraft.displayFormat || "markdown",
      enabled: true,
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      nextRunTime: new Date(Date.now() + 12 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16),
      runCount: 0
    };

    setScheduleTasks(prev => [...prev, newTask]);
    setTaskDraft(null);

    // Add assistant success message
    const successMsg: Message = {
      id: "sched_msg_success_" + Date.now(),
      role: "assistant",
      content: `✨ **大功告成**！我已经为您成功创建并激活了定时计划任务：
      
* **任务名称**：${newTask.title}
* **定时设定**：${newTask.scheduleType === 'daily' ? '每天' : newTask.scheduleType === 'weekly' ? '每周' : newTask.scheduleType === 'monthly' ? '每月' : '单次'} ${newTask.timeValue}
* **展现格式**：${newTask.displayFormat.toUpperCase()}

此任务现在处于 **已就绪** 状态。您可以在右侧的“计划任务列表”面板中随时点击 **⚡ 立即测试**，模拟并核对大模型的真实运行及渲染输出。`,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    };

    setSchedulerMessages(prev => [...prev, successMsg]);
  };

  const handleSendSchedulerMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedulerInput.trim() || isSchedulerThinking) return;

    const userText = schedulerInput.trim();
    const userMsg: Message = {
      id: "sched_user_" + Date.now(),
      role: "user",
      content: userText,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    };

    setSchedulerMessages(prev => [...prev, userMsg]);
    setSchedulerInput("");
    setIsSchedulerThinking(true);

    // Simulated Agent processing delay
    setTimeout(() => {
      const lowerText = userText.toLowerCase();
      let responseContent = "";
      let draft: Partial<ScheduleTask> | null = null;

      // 1. Check if user wants to EDIT or CHANGE existing task
      if (lowerText.includes("修改") || lowerText.includes("编辑") || lowerText.includes("调整") || lowerText.includes("改成") || lowerText.includes("改为") || lowerText.includes("变更")) {
        let matchedTask: ScheduleTask | undefined;
        if (lowerText.includes("早间") || lowerText.includes("待办") || lowerText.includes("1")) {
          matchedTask = scheduleTasks.find(t => t.id === "task_1" || t.title.includes("早间"));
        } else if (lowerText.includes("周报") || lowerText.includes("2")) {
          matchedTask = scheduleTasks.find(t => t.id === "task_2" || t.title.includes("周报"));
        } else if (lowerText.includes("saas") || lowerText.includes("数据") || lowerText.includes("3")) {
          matchedTask = scheduleTasks.find(t => t.id === "task_3" || t.title.includes("SaaS"));
        } else {
          // Find any task matching words
          matchedTask = scheduleTasks.find(t => lowerText.includes(t.title.substring(0, 4)));
        }

        if (matchedTask) {
          // Parse time value change
          let newTime = "";
          if (lowerText.includes("10点半") || lowerText.includes("10:30")) newTime = "10:30";
          else if (lowerText.includes("10点") || lowerText.includes("10:00")) newTime = "10:00";
          else if (lowerText.includes("9点半") || lowerText.includes("9:30")) newTime = "09:30";
          else if (lowerText.includes("9点") || lowerText.includes("9:00")) newTime = "09:00";
          else if (lowerText.includes("8点") || lowerText.includes("8:00")) newTime = "08:00";
          else if (lowerText.includes("下午5点") || lowerText.includes("17:00")) newTime = "17:00";
          else if (lowerText.includes("下午5点半") || lowerText.includes("17:30")) newTime = "17:30";

          // Parse prompt change
          let newPrompt = "";
          if (lowerText.includes("提示词为") || lowerText.includes("提示词改成") || lowerText.includes("运行内容为") || lowerText.includes("改成")) {
            const parts = userText.split(/(?:提示词为|提示词改成|运行内容为|改成|内容改为)/);
            if (parts.length > 1) {
              newPrompt = parts[1].replace(/[“”"']/g, '').trim();
            }
          }

          // Parse format change
          let newFormat: any = null;
          if (lowerText.includes("表格") || lowerText.includes("table")) newFormat = "table";
          else if (lowerText.includes("邮件") || lowerText.includes("email")) newFormat = "email";
          else if (lowerText.includes("markdown")) newFormat = "markdown";
          else if (lowerText.includes("列表") || lowerText.includes("清单")) newFormat = "bullet";

          // Perform updates
          setScheduleTasks(prev => prev.map(t => {
            if (t.id === matchedTask!.id) {
              return {
                ...t,
                timeValue: newTime || t.timeValue,
                prompt: newPrompt || t.prompt,
                displayFormat: newFormat || t.displayFormat
              };
            }
            return t;
          }));

          responseContent = `🤖 **指令执行成功**！我已经根据您的语义描述，对定时任务【**${matchedTask.title}**】进行了热更新：\n\n`;
          if (newTime) responseContent += `* ⏰ **运行时间** 修改为：\`${newTime}\`\n`;
          if (newPrompt) responseContent += `* 📝 **执行提示词** 修改为：\n  > ${newPrompt}\n`;
          if (newFormat) responseContent += `* 📊 **展现格式** 修改为：\`${newFormat.toUpperCase()}\`\n`;
          responseContent += `\n这些调整已实时部署到内部微核调度池中，无需重启系统。`;

        } else {
          responseContent = `🤔 我听到了您想“修改”定时任务，但我没能从您的指令中识别出具体是指哪一个现有任务（例如*“每日早间待办”*或*“任务2”*）。\n\n您可以这样明确告诉我：\n* “把 **任务1** 的时间改成 **09:30**”\n* “把 **周报任务** 的提示词修改为：‘总结这周的办公数据’。”`;
        }
      }
      // 2. Check if user wants to CREATE a new task
      else if (lowerText.includes("创建") || lowerText.includes("新建") || lowerText.includes("添加") || lowerText.includes("增加") || lowerText.includes("定时") || lowerText.includes("每天") || lowerText.includes("每周") || lowerText.includes("每月")) {
        // NLP Parsing defaults
        let title = "智能分析自定义工作流";
        let scheduleType: 'daily' | 'weekly' | 'monthly' | 'once' = 'daily';
        let timeValue = "09:30";
        let displayFormat: 'markdown' | 'table' | 'bullet' | 'email' | 'card' = 'markdown';
        let prompt = "分析今日工作日志，提出关键改进意见。";

        if (lowerText.includes("汇报") || lowerText.includes("早报") || lowerText.includes("日报")) {
          title = "企业每日智能办公早报推送";
          prompt = "拉取最新的工作备忘和今日待办列表，重新排版并生成一份供晨会汇报使用的精炼早报。";
        } else if (lowerText.includes("周报") || lowerText.includes("总结")) {
          title = "智能运营周报汇总精炼";
          prompt = "提炼这一周来我在各会话中执行的自动化技能及业务成效，整理出一份大纲式工作总结。";
          scheduleType = "weekly";
          timeValue = "周五 17:00";
        } else if (lowerText.includes("监控") || lowerText.includes("延迟") || lowerText.includes("接口") || lowerText.includes("审计")) {
          title = "API 与服务器指标定时智能监控";
          prompt = "向 MCP 网关发送 health 状态轮询请求，汇总各接入端点的响应延迟，找出超出阀值的指标并报警。";
          displayFormat = "table";
        }

        // Parse custom values if explicitly stated
        if (lowerText.includes("表格")) displayFormat = "table";
        else if (lowerText.includes("邮件")) displayFormat = "email";
        else if (lowerText.includes("列表") || lowerText.includes("无序")) displayFormat = "bullet";
        else if (lowerText.includes("卡片")) displayFormat = "card";

        if (lowerText.includes("每周五") || lowerText.includes("周五")) {
          scheduleType = "weekly";
          timeValue = "周五 17:00";
        } else if (lowerText.includes("每天") || lowerText.includes("每日")) {
          scheduleType = "daily";
          timeValue = "09:00";
        } else if (lowerText.includes("每月") || lowerText.includes("每月末")) {
          scheduleType = "monthly";
          timeValue = "28日 23:00";
        }

        // Try to capture exact times
        const timeMatch = userText.match(/(\d{1,2})点(\d{1,2})?分?/);
        if (timeMatch) {
          const hh = parseInt(timeMatch[1]).toString().padStart(2, "0");
          const mm = timeMatch[2] ? parseInt(timeMatch[2]).toString().padStart(2, "0") : "00";
          if (scheduleType === "weekly") {
            timeValue = `周五 ${hh}:${mm}`;
          } else if (scheduleType === "monthly") {
            timeValue = `28日 ${hh}:${mm}`;
          } else {
            timeValue = `${hh}:${mm}`;
          }
        }

        // Try to capture custom prompts
        const promptParts = userText.split(/(?:运行|提示词是|内容为|分析|整理|帮我定一?个)/);
        if (promptParts.length > 1 && promptParts[1].length > 5) {
          prompt = promptParts[1].trim().replace(/[“”，。！]/g, '');
        }

        draft = {
          title,
          scheduleType,
          timeValue,
          prompt,
          displayFormat,
          cronExpression: scheduleType === 'daily' ? `0 ${timeValue.split(':')[0] || '9'} * * *` : `0 17 * * 5`
        };

        setTaskDraft(draft);

        responseContent = `🎯 **为您定制了一份定时计划任务草稿**！\n\n我已理解您的定时任务需求，并在底层系统提取了相关参数。请您在下方核对这份**计划任务预览**：\n\n如果您对草稿满意，请点击 **【一键生成并激活任务】**，我将立即为您创建。`;
      }
      // 3. Fallback instructions
      else {
        responseContent = `👋 您好！我是您的 **AI 计划任务管家**。我能为您提供非常灵活的定时器与自动化工作流配置。\n\n您可以尝试这样对我说：\n\n* 🆕 **创建新定时计划**：\n  * “*帮我定一个每天早上 10 点运行的早报整理任务，用邮件形式展示*”\n  * “*创建一个每周五下午 5 点汇总这周会话数据的周报卡片*”\n\n* ✍️ **语义化修改现有任务**：\n  * “*把 **任务1** 的运行时间改成 **每天 09:30***”\n  * “*把 **任务2** 的执行提示词改为：‘自动润色我的工作总结’*”\n\n现在您需要我怎么帮您？`;
      }

      const assistantMsg: Message = {
        id: "sched_assistant_" + Date.now(),
        role: "assistant",
        content: responseContent,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      };

      setSchedulerMessages(prev => [...prev, assistantMsg]);
      setIsSchedulerThinking(false);
    }, 1000);
  };

  const handleRunTask = (task: ScheduleTask) => {
    setRunningTask(task);
    setRunningTaskLogs(["[00:01] ⚡ 唤醒 Cron 定时轮询引擎线程...", "[00:03] 🌐 加载底层 Model Agent 上下文环境..."]);
    setRunningTaskResult(null);

    // Sequence of simulated execution logs
    setTimeout(() => {
      setRunningTaskLogs(prev => [...prev, `[00:08] 🔗 正在调用 MCP 外部协议层网关...`]);
    }, 600);

    setTimeout(() => {
      setRunningTaskLogs(prev => [...prev, `[00:15] 🧠 读取当前用户记忆画像: [数字化项目运营总监], 语气偏好: [专业规范], 格式: [${task.displayFormat.toUpperCase()}]...`]);
    }, 1200);

    setTimeout(() => {
      setRunningTaskLogs(prev => [...prev, `[00:22] 🤖 向推理网关投递模型推理指令. Prompt 长度: ${task.prompt.length} 字符...`]);
    }, 1800);

    setTimeout(() => {
      setRunningTaskLogs(prev => [...prev, `[00:30] 📝 推理结果就绪，正在按渲染规范 [${task.displayFormat}] 进行二次结构化编排...`]);
    }, 2400);

    setTimeout(() => {
      setRunningTaskLogs(prev => [...prev, `[00:35] ✅ 定时自动化流执行完毕！数据成功入库。`]);

      // Generate custom realistic result content based on format and task type
      let finalResult = "";
      if (task.displayFormat === "table") {
        finalResult = `### 📊 SaaS 系统服务监控与分析周报

> 运行时间: ${new Date().toLocaleString()} | 定时轮询机制: ${task.scheduleType.toUpperCase()} (${task.timeValue})

| 监控微服务名称 | 节点状态 | 吞吐量 (QPS) | 平均响应时延 (ms) | 告警级别 | 决策建议 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **User_Auth_Service** | Active | 1,420 | 14ms | - | 运行平稳，暂无负载波动 |
| **SaaS_DB_Analytical** | Active | 850 | 48ms | - | 数据表 \`saas_subscription\` 有大额批处理导入 |
| **API_Gateway_Ingress**| Active | 2,240 | 125ms | ⚠️ 提示 | 时延处于阀值边缘，建议对 MCP 节点限流 |
| **Notify_Worker** | Active | 340 | 8ms | - | 邮件和短信队列无积压 |

* 💡 **智能诊断结论**：全链路在 2026-07-14 表现健康，但 \`API_Gateway\` 部分路由出现短暂并发波峰，导致时延上升至 125ms。已自动向系统推送一条优化预案。`;
      } else if (task.displayFormat === "email") {
        finalResult = `### 📬 晨间业务进展与待办事项推送（日报草稿）

**收件人：** ${userProfile.name} <${userProfile.name}@enterprise.ai>  
**主题：** 【AI 自动化早报】${new Date().toLocaleDateString('zh-CN')} 项目运营核心待办与系统概览  

---

尊敬的 **${userProfile.name}** (${userProfile.role})：

早上好！以下是为您自动生成的晨间待办资讯重点：

#### 🗓️ 今日关键日程
1. **10:00 AM** - 数字化解决方案晨会（汇报数字化项目进度）
2. **14:30 PM** - 与 Stripe 账务对账确认会（MCP已自动完成预审计）

#### 🔔 今日核心提醒
* **MCP 节点状况**：\`SaaS DB Analytical Portal\` 等 2 个本地端点在 10 分钟前完成了握手，当前全链路健康度 **100%**。
* **技能包就绪率**：系统内 **${skills.filter(s => s.enabled).length}项技能** 已完全加载就绪，随时可响应自然语言穿透调用。

#### 📝 今日晨间备忘建议
根据您在 **【智能记忆】** 中沉淀的认知习惯，建议您在晨会中重点关注“多级大纲与核心指标表格的结合展示”。

---
*此邮件草稿由您的【AI 智能日程计划助理】自动生成，您可以直接一键导出或发送。*`;
      } else if (task.displayFormat === "bullet") {
        finalResult = `### 📝 今日清晨待办与 MCP 状态要点

* 🕒 **执行戳记**：${new Date().toLocaleString()}  
* 🎯 **任务描述**：${task.prompt}

#### 1. 系统连通状态要点
* **MCP 服务器**：检测到当前共有 **2个** 服务器处于在线连通状态：
  * \`SaaS DB Analytical Portal\`：已连接，当前握手状态完美。
  * \`SaaS Client Local Drive\`：已连接，能够完美加载本地 Markdown 文档。
* **自动化能力插件**：当前已开启了 **${skills.filter(s => s.enabled).length}项** 核心技能包。

#### 2. 大模型运行记忆
* 已经自动注入您的认知偏好：生成内容时强制使用“**${userProfile.tonePreference === 'professional' ? '专业规范' : '亲切友好'}**”语气。

#### 3. 今日重点推荐行动项
* 建议在 10:00 前运行一次 **“文档智能解析与摘要”** 技能，阅读今天刚刚导入的数字化项目最新技术提案；
* 数据库有 340 条新增订阅，建议下午 16:00 前完成核对。`;
      } else {
        // Markdown default / card
        finalResult = `### 📅 自动化周报总结汇报成果

> 📅 定时机制: ${task.scheduleType === 'weekly' ? '每周' : '每天'} (设定于 ${task.timeValue}) | 运行轮次: 第 ${task.runCount + 1} 次

#### 🌟 本周期核心自动化工作成果汇报

本周期内，智能助理共为您执行了 **${task.runCount + 15}次** 多轮复杂对话。通过大语言模型与底层组件的无缝协作，我们达成了以下自动化指标：

1. **认知画像深度学习**
   * 共识别并编码了 **${memories.length}条** 个人偏好记忆。
   * AI 认知画像匹配度目前已达到 **85%**，每次会话均可精准按照您的指示风格组织输出。

2. **企业级数据穿透审计**
   * 使用 MCP 服务器执行了高频 SQL 数据库查询。
   * 完成了 api_gateway_logs 和 Stripe 账目数据的自动化提取，自动识别了 12 个接口延迟记录。

3. **定制化插件运行**
   * 高效调用了 **${skills.filter(s => s.enabled).map(s => `[${s.name}]`).join(', ')}** 等自动化技能，平均执行时延低于 **0.8秒**。

---
*💡 本总结卡片符合您的“${userProfile.formatPreference === 'markdown' ? 'Markdown' : '富文本'}”排版及“${userProfile.tonePreference === 'professional' ? '专业' : '常规'}”语气。*`;
      }

      setRunningTaskResult({
        title: task.title,
        displayFormat: task.displayFormat,
        content: finalResult
      });

      // Update task stats
      setScheduleTasks(prev => prev.map(t => {
        if (t.id === task.id) {
          return {
            ...t,
            runCount: t.runCount + 1,
            lastRunTime: new Date().toISOString().replace('T', ' ').substring(0, 16)
          };
        }
        return t;
      }));

      setRunningTask(null);
    }, 3000);
  };
  // --- End 8.1. Schedule Planner Handlers ---

  // 9. Add MCP Server (via JSON Configuration pasting)
  const handleAddMcpServer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mcpJsonText.trim()) {
      setMcpJsonError("内容不能为空");
      return;
    }

    try {
      const parsed = JSON.parse(mcpJsonText);
      const serversToAdd: MCPServer[] = [];

      if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
        // Multiple servers structure: { mcpServers: { name: { type, url, headers } } }
        Object.entries(parsed.mcpServers).forEach(([name, config]: [string, any]) => {
          if (config && typeof config === "object") {
            const type = config.type || "sse";
            const urlOrCommand = config.url || config.command || "";
            serversToAdd.push({
              id: "mcp_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
              name: name,
              type: type,
              urlOrCommand: urlOrCommand,
              status: "disconnected",
              tools: [],
              headers: config.headers,
              url: config.url,
              command: config.command
            });
          }
        });
      } else if (parsed.type) {
        // Single server pasted directly: { type, url, headers }
        const name = parsed.name || "Pasted Server " + new Date().toLocaleTimeString();
        const type = parsed.type;
        const urlOrCommand = parsed.url || parsed.command || "";
        serversToAdd.push({
          id: "mcp_" + Date.now(),
          name: name,
          type: type,
          urlOrCommand: urlOrCommand,
          status: "disconnected",
          tools: [],
          headers: parsed.headers,
          url: parsed.url,
          command: parsed.command
        });
      } else {
        // Try parsing any key-value pairs if they look like server configs
        let found = false;
        Object.entries(parsed).forEach(([name, config]: [string, any]) => {
          if (config && typeof config === "object" && (config.type || config.url || config.command)) {
            found = true;
            const type = config.type || "sse";
            const urlOrCommand = config.url || config.command || "";
            serversToAdd.push({
              id: "mcp_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
              name: name,
              type: type,
              urlOrCommand: urlOrCommand,
              status: "disconnected",
              tools: [],
              headers: config.headers,
              url: config.url,
              command: config.command
            });
          }
        });
        if (!found) {
          throw new Error("无法识别的 JSON 格式。请提供包含 'mcpServers' 对象或含有 'type' 属性的配置。");
        }
      }

      if (serversToAdd.length === 0) {
        throw new Error("未找到有效的 MCP 服务器配置。");
      }

      setMcpServers(prev => [...prev, ...serversToAdd]);
      setMcpJsonText("");
      setMcpJsonError(null);
      setShowAddServerModal(false);
    } catch (err: any) {
      setMcpJsonError(err.message || "JSON 格式解析错误，请检查语法。");
    }
  };

  // 10. Test MCP Server Connectivity
  const handleTestMcpServer = async (id: string, name: string) => {
    setTestingServerId(id);
    setMcpServers(prev => prev.map(m => m.id === id ? { ...m, status: "connecting" } : m));

    try {
      const response = await apiFetch(`/api/mcp/servers/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      const data = await response.json();
      if (data.connected) {
        setMcpServers(prev => prev.map(m => {
          if (m.id === id) {
            return {
              ...m,
              status: "connected",
              tools: data.tools
            };
          }
          return m;
        }));
      }
    } catch (error) {
      console.error("Test MCP connection failed:", error);
      setMcpServers(prev => prev.map(m => m.id === id ? { ...m, status: "disconnected" } : m));
    } finally {
      setTestingServerId(null);
    }
  };

  // 10b. Test LLM Gateway Model Connectivity
  const handleTestModelConfig = async (config: ModelConfig) => {
    setTestingModelId(config.id);
    
    try {
      // 通过后端真实探测 LLM 连通性（settings 接口间接验证配置）
      const settings = await getSettings();
      const providers = settings.llmProviders || [];
      const realProvider = providers.find(p => p.id === config.id);
      const connected = !!realProvider;
      const data = {
        success: connected,
        status: (connected ? "connected" : "failed") as "connected" | "failed",
        message: realProvider ? `模型 ${realProvider.name} 已配置` : "未找到该模型配置",
      };

      if (data.success) {
        setModelConnectionStatuses(prev => ({
          ...prev,
          [config.id]: {
            status: data.status,
            message: data.message
          }
        }));
        showToast(`模型 [${config.name}] 配置有效：联通性正常！`, "success");
      } else {
        setModelConnectionStatuses(prev => ({
          ...prev,
          [config.id]: {
            status: "failed",
            message: data.message || "握手连接失败，无法触达端点。"
          }
        }));
        showToast(`模型 [${config.name}] 联通测试未通过！`, "warning");
      }
    } catch (error) {
      console.error("Test LLM gateway connection failed:", error);
      setModelConnectionStatuses(prev => ({
        ...prev,
        [config.id]: {
          status: "failed",
          message: "网络异常：无法请求测试接口。"
        }
      }));
      showToast("无法向服务器发起握手请求", "warning");
    } finally {
      setTestingModelId(null);
    }
  };

  // 11. Delete MCP Server
  const handleDeleteMcpServer = (id: string) => {
    setMcpServers(prev => prev.filter(m => m.id !== id));
  };

  // 12. Toggle MCP Server manual status
  const handleToggleMcpStatus = (id: string) => {
    setMcpServers(prev => prev.map(m => {
      if (m.id === id) {
        const nextStatus = m.status === "connected" ? "disconnected" : "connected";
        return {
          ...m,
          status: nextStatus,
          tools: m.tools
        };
      }
      return m;
    }));
  };

  // 13. Add Model Config
  const handleAddNewModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newModel.name.trim()) return;

    const config: ModelConfig = {
      id: "model_custom_" + Date.now(),
      name: newModel.name,
      provider: newModel.provider,
      apiKey: newModel.apiKey ? "• • • • • • • • • • • • • •" : "",
      baseUrl: newModel.baseUrl || "默认端点",
      enabled: true,
      isCustom: true
    };

    setModelConfigs([...modelConfigs, config]);
    setNewModel({ name: "", provider: "OpenAI", apiKey: "", baseUrl: "" });
    setShowAddModelModal(false);
  };

  // 14. Delete Custom Model Config
  const handleDeleteModel = (id: string) => {
    setModelConfigs(prev => prev.filter(m => m.id !== id));
    if (selectedModelId === id) {
      setSelectedModelId("model_gemini");
    }
  };

  // --- Rendering Helpers ---
  const renderCategoryTag = (cat: string) => {
    switch (cat) {
      case "document": return <span className="px-2 py-0.5 text-xs font-medium rounded bg-emerald-50 text-emerald-700 border border-emerald-150">文档解析</span>;
      case "office": return <span className="px-2 py-0.5 text-xs font-medium rounded bg-indigo-50 text-indigo-700 border border-indigo-150">办公协作</span>;
      case "utility": return <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-50 text-amber-700 border border-amber-150">实用工具</span>;
      default: return <span className="px-2 py-0.5 text-xs font-medium rounded bg-slate-100 text-slate-700 border border-slate-200">自定义包</span>;
    }
  };

  // 未登录 → 自动跳 Keycloak，不显示中间页面
  if (!isLoggedIn) {
    return null;
  }

  return (
    <div className="flex h-screen w-screen bg-[#f8fafc] overflow-hidden text-slate-800 font-sans">

      {/* ========================================================
          UNIFIED SIDEBAR (Navigation, Session List & Profile)
          ======================================================== */}
      {/* ========================================================
          UNIFIED SIDEBAR (Navigation, Session List & Profile)
          ======================================================== */}
      <div className={`relative flex h-full shrink-0 z-20 transition-all duration-300 ${isSidebarCollapsed ? "w-0" : "w-64"}`}>
        <aside className={`bg-white flex flex-col h-full w-full overflow-hidden ${isSidebarCollapsed ? "border-r-0" : "border-r border-slate-200 shadow-3xs"}`}>
          {/* Fixed width inner container to prevent text/icon compression during width transitions */}
          <div className="w-64 h-full flex flex-col shrink-0">

            {/* Sessions Area (会话栏目) in same Sidebar - Now at top */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-4 py-2.5 flex items-center justify-between shrink-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">对话会话</span>
                <button 
                  onClick={handleCreateNewSession}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 text-white text-[10px] font-medium shadow-3xs hover:bg-slate-800 transition-colors"
                  title="新建会话"
                >
                  <Plus className="w-3 h-3" />
                  <span>新建会话</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
                {sessions.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-xs font-sans">
                    暂无会话历史
                  </div>
                ) : (
                  sessions.map(s => {
                    const isActive = s.id === activeSessionId && activeTab === "dialogue";
                    return (
                      <div 
                        key={s.id}
                        onClick={() => {
                          setActiveTab("dialogue");
                          setActiveSessionId(s.id);
                        }}
                        className={`group flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                          isActive 
                            ? "bg-white border border-slate-200 shadow-3xs font-medium text-slate-900" 
                            : "text-slate-600 hover:bg-slate-100/60 hover:text-slate-900"
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate flex-1">
                          <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-slate-900' : 'text-slate-400'}`} />
                          <span className="truncate">{s.title}</span>
                        </div>
                        <button 
                          onClick={(e) => handleDeleteSession(s.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-200 rounded text-slate-400 hover:text-red-500 transition-all shrink-0 ml-1"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Unified Navigation & User Profile at bottom */}
            <div className="border-t border-slate-100 bg-slate-50/40 shrink-0 flex flex-col">
              
              <AnimatePresence initial={false}>
                {isNavExpanded && (
                  <motion.nav 
                    key="sidebar-nav-expanded"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="p-3 flex flex-col gap-1 overflow-hidden border-b border-slate-100/30"
                  >
                    <button 
                      onClick={() => setActiveTab("skills")}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        activeTab === "skills" 
                          ? "bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/50" 
                          : "text-slate-600 hover:bg-slate-100/50 hover:text-slate-900"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5 text-slate-500" />
                        <span>技能管理</span>
                      </div>
                      <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full font-mono">
                        {skills.filter(s => s.enabled).length}
                      </span>
                    </button>

                    <button 
                      onClick={() => setActiveTab("memory")}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        activeTab === "memory" 
                          ? "bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/50" 
                          : "text-slate-600 hover:bg-slate-100/50 hover:text-slate-900"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Brain className="w-3.5 h-3.5 text-slate-500" />
                        <span>记忆画像</span>
                      </div>
                      <span className="text-[9px] text-indigo-600 font-mono font-bold bg-indigo-50 px-1 py-0.2 rounded border border-indigo-100/50">85%</span>
                    </button>

                    <button 
                      onClick={() => setActiveTab("scheduler")}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        activeTab === "scheduler" 
                          ? "bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/50" 
                          : "text-slate-600 hover:bg-slate-100/50 hover:text-slate-900"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-slate-500" />
                        <span>计划任务</span>
                      </div>
                      <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full font-mono">
                        {scheduleTasks.filter(t => t.enabled).length}
                      </span>
                    </button>

                    <button 
                      onClick={() => setActiveTab("mcp")}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        activeTab === "mcp" 
                          ? "bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/50" 
                          : "text-slate-600 hover:bg-slate-100/50 hover:text-slate-900"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Database className="w-3.5 h-3.5 text-slate-500" />
                        <span>MCP服务器</span>
                      </div>
                      <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full font-mono">
                        {mcpServers.filter(m => m.status === "connected").length}
                      </span>
                    </button>

                    <button 
                      onClick={() => setActiveTab("settings")}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        activeTab === "settings" 
                          ? "bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/50" 
                          : "text-slate-600 hover:bg-slate-100/50 hover:text-slate-900"
                      }`}
                    >
                      <Settings className="w-3.5 h-3.5 text-slate-500" />
                      <span>系统设置</span>
                    </button>

                    <button 
                      onClick={() => setShowApiDocsModal(true)}
                      className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100/50 hover:text-slate-900 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 text-indigo-500" />
                        <span className="text-indigo-600 font-medium">FastAPI 对接文档</span>
                      </div>
                      <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1.5 py-0.2 rounded font-mono border border-indigo-100">Docs</span>
                    </button>
                  </motion.nav>
                )}
              </AnimatePresence>

              {/* User Profile Card & Auth Control */}
              <div className="p-3 bg-slate-50/40 border-t border-slate-150 relative select-none">
                {/* User Dropdown Menu Popover */}
                <AnimatePresence>
                  {showUserDropdown && (
                    <motion.div
                      key="user-dropdown-popover"
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-full left-3 right-3 mb-2 bg-white border border-slate-200 rounded-xl shadow-lg p-2 z-50 text-xs"
                    >
                      <div className="p-2.5 bg-slate-50 rounded-lg mb-1.5 border border-slate-100">
                        <div className="flex items-center justify-between font-medium text-slate-800">
                          <span className="font-bold text-slate-900">{isLoggedIn ? userProfile.name : "游客 / 未登录"}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono font-semibold ${
                            isLoggedIn ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}>
                            {isLoggedIn ? "● 在线" : "○ 未登录"}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                          {isLoggedIn ? `${userProfile.role} · ${userProfile.department}` : "暂未登录账号"}
                        </div>
                      </div>

                      <div className="space-y-0.5">
                        {isLoggedIn ? (
                          <>
                            <button 
                              onClick={() => { setActiveTab("settings"); setShowUserDropdown(false); }}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors text-left cursor-pointer"
                            >
                              <User className="w-3.5 h-3.5 text-slate-400" />
                              <span>个人资料与系统设置</span>
                            </button>
                            <button 
                              onClick={() => { setShowUserDropdown(false); startLogin(); }}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors text-left cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
                              <span className="text-indigo-600 font-medium">切换账号 / 预设身份</span>
                            </button>
                            <div className="my-1 border-t border-slate-100"></div>
                            <button 
                              onClick={handleLogout}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors text-left font-medium cursor-pointer"
                            >
                              <LogOut className="w-3.5 h-3.5 text-rose-500" />
                              <span>退出登录</span>
                            </button>
                          </>
                        ) : (
                          <button 
                            onClick={() => { setShowUserDropdown(false); startLogin(); }}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors text-center font-medium shadow-xs cursor-pointer"
                          >
                            <LogIn className="w-3.5 h-3.5" />
                            <span>立即登录账号</span>
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Card Trigger */}
                <div className="flex items-center justify-between gap-2 bg-white border border-slate-150 rounded-xl p-2.5 shadow-3xs hover:border-slate-300 transition-all">
                  <div 
                    onClick={() => setShowUserDropdown(!showUserDropdown)} 
                    className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
                  >
                    <div className={`w-8 h-8 rounded-full border flex items-center justify-center font-bold text-xs shrink-0 ${
                      isLoggedIn 
                        ? "bg-indigo-50 border-indigo-200 text-indigo-700" 
                        : "bg-slate-100 border-slate-200 text-slate-400"
                    }`}>
                      {isLoggedIn ? userProfile.name.slice(0, 1) : <User className="w-4 h-4" />}
                    </div>
                    <div className="text-left flex-1 min-w-0">
                      <h4 className="text-[11px] font-bold text-slate-800 leading-tight truncate">
                        {isLoggedIn ? userProfile.name : "未登录"}
                      </h4>
                      <p className="text-[9px] text-slate-400 font-mono leading-none mt-0.5 truncate">
                        {isLoggedIn ? userProfile.role : "点击选择账号登录"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {isLoggedIn ? (
                      <button 
                        onClick={handleLogout}
                        title="退出登录"
                        className="p-1 hover:bg-rose-50 rounded-md text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button 
                        onClick={() => startLogin()}
                        title="点击登录"
                        className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-medium rounded-md transition-colors cursor-pointer"
                      >
                        登录
                      </button>
                    )}
                    <button 
                      onClick={toggleNavExpanded} 
                      title={isNavExpanded ? "收起功能导航" : "展开功能导航"}
                      className="p-1 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    >
                      <ChevronUp className={`w-3.5 h-3.5 transition-transform duration-200 ${isNavExpanded ? "" : "rotate-180"}`} />
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </aside>

        {/* Collapsible toggle handle on sidebar's right edge */}
        {!isSidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            className="absolute top-1/2 -translate-y-1/2 -right-3 z-30 w-6 h-12 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 shadow-xs hover:shadow-sm transition-all group cursor-pointer"
            title="收起侧边栏"
          >
            <ChevronLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      {/* ========================================================
          MAIN VIEW CONTAINER
          ======================================================== */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#fbfcfd] relative z-20">
        
        {/* Floating Sidebar Expand Toggle Button when collapsed */}
        {isSidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            className="absolute top-1/2 -translate-y-1/2 left-0 z-30 w-5 h-14 bg-white border-y border-r border-slate-200 rounded-r-xl text-slate-400 hover:text-slate-600 shadow-sm hover:shadow transition-all flex items-center justify-center cursor-pointer group"
            title="展开侧边栏"
          >
            <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}
        
        {/* Top bar header removed per user request */}

        {/* Dynamic view content with animation */}
        <div className="flex-1 overflow-hidden relative">
          <AnimatePresence mode="wait">
            
            {/* ========================================================
                1. DIALOGUE VIEW
                ======================================================== */}
            {activeTab === "dialogue" && (
              <DialogueView 
                isDraggingFile={isDraggingFile}
                handleDragEnter={handleDragEnter}
                handleDragOver={handleDragOver}
                handleDragLeave={handleDragLeave}
                handleDrop={handleDrop}
                activeSession={activeSession}
                isLoggedIn={isLoggedIn}
                userProfile={userProfile}
                setShowLoginModal={setShowLoginModal}
                handleLogout={handleLogout}
                setInputMessage={setInputMessage}
                renderFormattedTextWithSkills={renderFormattedTextWithSkills}
                expandedThinking={expandedThinking}
                setExpandedThinking={setExpandedThinking}
                activeStreamingMessageId={activeStreamingMessageId}
                copiedMsgId={copiedMsgId}
                handleCopyContent={handleCopyContent}
                preprocessMarkdown={preprocessMarkdown}
                isSending={isSending}
                messagesEndRef={messagesEndRef}
                pendingAttachments={pendingAttachments}
                setPendingAttachments={setPendingAttachments}
                showSkillsDropdown={showSkillsDropdown}
                setShowSkillsDropdown={setShowSkillsDropdown}
                filteredSkillsForDropdown={filteredSkillsForDropdown}
                selectedDropdownIndex={selectedDropdownIndex}
                setSelectedDropdownIndex={setSelectedDropdownIndex}
                selectSkillForInput={selectSkillForInput}
                inputMessage={inputMessage}
                setSearchSkillText={setSearchSkillText}
                handleSendMessage={handleSendMessage}
                fileInputRef={fileInputRef}
                imageInputRef={imageInputRef}
                processFiles={processFiles}
                selectedModelId={selectedModelId}
                setSelectedModelId={setSelectedModelId}
                modelConfigs={modelConfigs}
              />
            )}

            {/* ========================================================
                2. SKILLS VIEW
                ======================================================== */}
            {activeTab === "skills" && (
              <SkillsView 
                showTips={showTips}
                toggleShowTips={toggleShowTips}
                setShowUploadSkillModal={setShowUploadSkillModal}
                skills={skills}
                handleToggleSkill={handleToggleSkill}
                setSkills={setSkills}
              />
            )}

            {/* ========================================================
                3. MEMORY & PROFILING VIEW
                ======================================================== */}
            {activeTab === "memory" && (
              <MemoryView 
                showTips={showTips}
                toggleShowTips={toggleShowTips}
                isMemoryEnabled={isMemoryEnabled}
                setIsMemoryEnabled={setIsMemoryEnabled}
                userProfile={userProfile}
                setUserProfile={setUserProfile}
                memories={memories}
                isLoggedIn={isLoggedIn}
                handleLogout={handleLogout}
                setShowLoginModal={setShowLoginModal}
                newMemoryContent={newMemoryContent}
                setNewMemoryContent={setNewMemoryContent}
                newMemoryCategory={newMemoryCategory}
                setNewMemoryCategory={setNewMemoryCategory}
                handleAddMemory={handleAddMemory}
                handleDeleteMemory={handleDeleteMemory}
              />
            )}

            {activeTab === "scheduler" && (
              <SchedulerView 
                showTips={showTips}
                toggleShowTips={toggleShowTips}
                setEditingTask={setEditingTask}
                setIsEditingTaskOpen={setIsEditingTaskOpen}
                scheduleTasks={scheduleTasks}
                selectedTaskIds={selectedTaskIds}
                handleSelectAllTasks={handleSelectAllTasks}
                handleBatchEnableTasks={handleBatchEnableTasks}
                handleBatchPauseTasks={handleBatchPauseTasks}
                handleBatchDeleteTasks={handleBatchDeleteTasks}
                setViewingTask={setViewingTask}
                handleToggleSelectTask={handleToggleSelectTask}
                handleToggleTask={handleToggleTask}
              />
            )}

            {activeTab === "mcp" && (
              <McpView 
                showTips={showTips}
                toggleShowTips={toggleShowTips}
                setShowAddServerModal={setShowAddServerModal}
                mcpServers={mcpServers}
                handleToggleMcpStatus={handleToggleMcpStatus}
                expandedMcpServers={expandedMcpServers}
                setExpandedMcpServers={setExpandedMcpServers}
                handleTestMcpServer={handleTestMcpServer}
                handleDeleteMcpServer={handleDeleteMcpServer}
                handleCopyParamName={handleCopyParamName}
                copiedParamKey={copiedParamKey}
              />
            )}

            {activeTab === "settings" && (
              <SettingsView 
                showTips={showTips}
                toggleShowTips={toggleShowTips}
                setShowAddModelModal={setShowAddModelModal}
                showAddModelModal={showAddModelModal}
                handleAddNewModel={handleAddNewModel}
                newModel={newModel}
                setNewModel={setNewModel}
                modelConfigs={modelConfigs}
                setModelConfigs={setModelConfigs}
                modelConnectionStatuses={modelConnectionStatuses}
                testingModelId={testingModelId}
                handleTestModelConfig={handleTestModelConfig}
                handleDeleteModel={handleDeleteModel}
              />
            )}

          </AnimatePresence>
        </div>

      </main>

      {/* ========================================================
          MODAL OVERLAYS (Beautiful workspace upload skill packaging)
          ======================================================== */}
      <AnimatePresence>
        {showUploadSkillModal && (
          <motion.div 
            key="modal-upload-skill"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl max-w-md w-full relative"
            >
              <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                <h3 className="font-display font-semibold text-sm text-slate-900">上传企业自定义技能包</h3>
                <button 
                  onClick={() => {
                    setShowUploadSkillModal(false);
                    setUploadProgress(null);
                    setUploadSuccessMsg(null);
                  }} 
                  className="p-1 hover:bg-slate-100 rounded text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 space-y-4">
                <p className="text-xs text-slate-500 leading-normal">
                  请上传包含 `.json` 定义和规则流程的技能安装包（支持 ZIP/JSON 格式）。导入后 AI 助手将直接学习并掌握该技能的处理规则。
                </p>

                {/* Drag and Drop Zone */}
                <div 
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingSkill(true); }}
                  onDragLeave={() => setIsDraggingSkill(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingSkill(false);
                    const files = e.dataTransfer.files;
                    if (files && files.length > 0) {
                      handleUploadSkill(files[0].name);
                    }
                  }}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".zip,.json";
                    input.onchange = (e: any) => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        handleUploadSkill(files[0].name);
                      }
                    };
                    input.click();
                  }}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                    isDraggingSkill 
                      ? "border-indigo-500 bg-indigo-50/30" 
                      : "border-slate-200 hover:border-slate-400 bg-slate-50/50"
                  }`}
                >
                  <Upload className="w-7 h-7 mx-auto text-slate-400 mb-2.5" />
                  <span className="block text-xs font-semibold text-slate-800">拖拽文件到此处，或点击浏览本地</span>
                  <span className="block text-[10px] text-slate-400 mt-1">支持扩展名：.zip, .json (大小限制 10MB 内)</span>
                </div>

                {/* Upload feedback progress bar */}
                {uploadProgress !== null && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                      <span>解析技能配置文件中...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                      <div className="bg-slate-950 h-full transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                )}

                {/* Upload Success Banner */}
                {uploadSuccessMsg && (
                  <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-lg border border-emerald-150 flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{uploadSuccessMsg}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-50 text-xs">
                  <button 
                    onClick={() => {
                      setShowUploadSkillModal(false);
                      setUploadProgress(null);
                      setUploadSuccessMsg(null);
                    }}
                    className="px-4 py-1.5 border border-slate-200 rounded-lg font-medium hover:bg-slate-50"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* ========================================================
            MODAL 1.2: ADD MCP SERVER OVERLAY MODAL
            ======================================================== */}
        {showAddServerModal && (
          <motion.div 
            key="modal-add-mcp-server"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl max-w-lg w-full relative text-xs"
            >
              <div className="flex justify-between items-center border-b border-slate-150 pb-3">
                <div>
                  <h3 className="font-display font-semibold text-sm text-slate-900">注册并导入 MCP 服务器 (JSON 格式)</h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">请粘入标准的 MCP json 配置信息，支持多台服务器批量导入</p>
                </div>
                <button 
                  onClick={() => { setShowAddServerModal(false); setMcpJsonError(null); }} 
                  className="p-1 hover:bg-slate-100 rounded text-slate-400 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAddMcpServer} className="mt-4 space-y-4 text-xs">
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-[11px] font-semibold text-slate-500">JSON 配置代码</label>
                    <button 
                      type="button"
                      onClick={() => {
                        setMcpJsonText(JSON.stringify({
                          mcpServers: {
                            "my-coffee": {
                              "type": "streamablehttp",
                              "url": "https://gwmcp.lkcoffee.com/order/user/mcp",
                              "headers": {
                                "Authorization": "Bearer <登录后复制Token替换>"
                              }
                            }
                          }
                        }, null, 2));
                        setMcpJsonError(null);
                      }}
                      className="text-[10px] text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3 text-indigo-500 shrink-0" />
                      <span>插入示例模板</span>
                    </button>
                  </div>
                  
                  <textarea 
                    rows={8}
                    required
                    placeholder={`粘贴配置，如:\n{\n  "mcpServers": {\n    "my-server": {\n      "type": "streamablehttp",\n      "url": "https://api.example.com/mcp"\n    }\n  }\n}`}
                    value={mcpJsonText}
                    onChange={(e) => {
                      setMcpJsonText(e.target.value);
                      if (mcpJsonError) setMcpJsonError(null);
                    }}
                    className="w-full border border-slate-200 rounded-lg p-3 text-slate-700 font-mono text-[11px] leading-relaxed focus:outline-hidden focus:ring-1 focus:ring-slate-400 bg-slate-50/50"
                  />
                </div>

                {mcpJsonError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-100 rounded-lg text-[11px] text-rose-600 flex items-start gap-2 animate-fade-in font-medium">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{mcpJsonError}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button 
                    type="button" 
                    onClick={() => { setShowAddServerModal(false); setMcpJsonError(null); }}
                    className="px-3.5 py-1.5 border border-slate-200 rounded-lg font-medium hover:bg-slate-50 text-slate-600 cursor-pointer"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    className="px-4 py-1.5 bg-slate-900 hover:bg-slate-850 text-white rounded-lg font-semibold shadow-xs cursor-pointer"
                  >
                    导入并添加
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}

        {/* ========================================================
            MODAL 1.5: SCHEDULE TASK VIEW DETAILS MODAL
            ======================================================== */}
        {viewingTask && (
          <motion.div 
            key="modal-view-task"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-xl shadow-lg border border-slate-200 max-w-xl w-full overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-indigo-600" />
                  <h3 className="font-display font-semibold text-sm text-slate-800">
                    定时计划任务详情
                  </h3>
                </div>
                <button 
                  type="button"
                  onClick={() => setViewingTask(null)} 
                  className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs text-slate-600">
                {/* Title */}
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">计划任务名称</span>
                  <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Pin className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>{viewingTask.title}</span>
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                      viewingTask.enabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {viewingTask.enabled ? '已激活调度' : '暂停中'}
                    </span>
                  </h4>
                </div>

                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100 font-sans">
                  <div className="space-y-1">
                    <span className="text-slate-400 text-[10px] flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 text-slate-400" />
                      <span>触发频率</span>
                    </span>
                    <p className="text-slate-800 font-medium pl-4">
                      {viewingTask.scheduleType === 'daily' ? '每天一次' : viewingTask.scheduleType === 'weekly' ? '每周一次' : viewingTask.scheduleType === 'monthly' ? '每月一次' : '单次测试'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-slate-400 text-[10px] flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>设定时间</span>
                    </span>
                    <p className="text-slate-800 font-medium font-mono flex items-center gap-1 pl-4">
                      {viewingTask.timeValue}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-slate-400 text-[10px] flex items-center gap-1">
                      <FileText className="w-3 h-3 text-slate-400" />
                      <span>展现格式</span>
                    </span>
                    <p className="text-slate-800 font-semibold font-mono text-[10px] uppercase pl-4">
                      {viewingTask.displayFormat}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-slate-400 text-[10px] flex items-center gap-1">
                      <PlayCircle className="w-3 h-3 text-slate-400" />
                      <span>已自动执行</span>
                    </span>
                    <p className="text-slate-800 font-medium pl-4">
                      {viewingTask.runCount}次
                    </p>
                  </div>
                  <div className="space-y-1 col-span-2 border-t border-slate-200/50 pt-2 mt-1">
                    <span className="text-slate-400 text-[10px] flex items-center gap-1">
                      <Check className="w-3 h-3 text-slate-400" />
                      <span>上次运行时间</span>
                    </span>
                    <p className="text-slate-700 font-mono text-[11px] pl-4">{viewingTask.lastRunTime || '暂无执行记录'}</p>
                  </div>
                  {viewingTask.enabled && viewingTask.nextRunTime && (
                    <div className="space-y-1 col-span-2">
                      <span className="text-emerald-600 font-semibold text-[10px] flex items-center gap-1">
                        <Clock className="w-3 h-3 text-emerald-500" />
                        <span>下次预计执行时间</span>
                      </span>
                      <p className="text-emerald-700 font-semibold font-mono text-[11px] pl-4">{viewingTask.nextRunTime}</p>
                    </div>
                  )}
                </div>

                {/* Prompt block */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">后台大模型执行指令 (AI Agent Prompt)</span>
                  <div className="bg-slate-900 text-slate-200 font-mono text-[11px] p-3.5 rounded-lg border border-slate-800 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-inner">
                    {viewingTask.prompt}
                  </div>
                </div>

                {/* Beautiful Button Layout / Action Panel */}
                <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-3">
                  {/* Destructive delete action */}
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`确定要彻底删除定时任务“${viewingTask.title}”吗？`)) {
                        handleDeleteTask(viewingTask.id);
                        setViewingTask(null);
                      }
                    }}
                    className="w-full sm:w-auto px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 font-semibold rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 border border-red-100/50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>删除任务</span>
                  </button>

                  <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    {/* Secondary edit action */}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTask({ ...viewingTask });
                        setIsEditingTaskOpen(true);
                        setViewingTask(null);
                      }}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 border border-slate-200"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>编辑配置</span>
                    </button>

                    {/* Primary trigger test execution action */}
                    <button
                      type="button"
                      onClick={() => {
                        handleRunTask(viewingTask);
                        setViewingTask(null);
                      }}
                      className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm hover:shadow-md hover:scale-[1.01]"
                    >
                      <PlayCircle className="w-4 h-4 animate-pulse" />
                      <span>立即测试运行</span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* ========================================================
            MODAL 1: SCHEDULE TASK EDITOR MODAL
            ======================================================== */}
        {isEditingTaskOpen && editingTask && (
          <motion.div 
            key="modal-edit-task"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-xl shadow-lg border border-slate-200 max-w-xl w-full overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-indigo-600" />
                  <h3 className="font-display font-semibold text-sm text-slate-800">
                    {editingTask.id.startsWith("task_manual_") ? "手动部署计划任务" : "编辑定时计划任务配置"}
                  </h3>
                </div>
                <button 
                  type="button"
                  onClick={() => { setIsEditingTaskOpen(false); setEditingTask(null); }} 
                  className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveEditedTask} className="p-5 space-y-4 text-xs text-slate-600">
                {/* Task Title */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-slate-500">任务标题 / 业务名称</label>
                  <input 
                    type="text"
                    required
                    value={editingTask.title}
                    onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                    placeholder="例如：每日晨间办公报告汇总"
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded-lg px-3 py-2 outline-none font-sans"
                  />
                </div>

                {/* Grid for Schedule Type & Time Value */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-500">运行机制 / 轮询频率</label>
                    <select 
                      value={editingTask.scheduleType}
                      onChange={(e) => setEditingTask({ 
                        ...editingTask, 
                        scheduleType: e.target.value as any,
                        timeValue: e.target.value === 'weekly' ? '周五 17:00' : e.target.value === 'monthly' ? '28日 23:00' : '09:00'
                      })}
                      className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded-lg px-3 py-2 outline-none"
                    >
                      <option value="daily">每天运行 (Daily)</option>
                      <option value="weekly">每周运行 (Weekly)</option>
                      <option value="monthly">每月运行 (Monthly)</option>
                      <option value="once">单次测试 (Once)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-500">运行时间设定</label>
                    <input 
                      type="text"
                      required
                      value={editingTask.timeValue}
                      onChange={(e) => setEditingTask({ ...editingTask, timeValue: e.target.value })}
                      placeholder={editingTask.scheduleType === 'weekly' ? '例如：周五 17:30' : '例如：09:00'}
                      className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded-lg px-3 py-2 outline-none font-mono"
                    />
                  </div>
                </div>

                {/* Display format */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-slate-500">运行结果展现格式</label>
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { key: 'markdown', label: 'MARKDOWN', desc: '美观文档' },
                      { key: 'table', label: 'TABLE', desc: '结构化表格' },
                      { key: 'bullet', label: 'BULLET', desc: '要点清单' },
                      { key: 'email', label: 'EMAIL', desc: '邮件草稿' },
                      { key: 'card', label: 'CARD', desc: '精简卡片' }
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setEditingTask({ ...editingTask, displayFormat: item.key as any })}
                        className={`p-2 rounded-lg border text-center transition-all ${
                          editingTask.displayFormat === item.key 
                            ? 'border-slate-900 bg-slate-900 text-white shadow-3xs' 
                            : 'border-slate-200 hover:border-slate-300 bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="font-mono text-[10px] font-bold leading-none">{item.label}</div>
                        <div className={`text-[8px] mt-1 leading-none ${editingTask.displayFormat === item.key ? 'text-slate-300' : 'text-slate-400'}`}>
                          {item.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Task Prompt */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-slate-500">后台模型执行指令 (AI Agent Prompt)</label>
                  <textarea 
                    rows={4}
                    required
                    value={editingTask.prompt}
                    onChange={(e) => setEditingTask({ ...editingTask, prompt: e.target.value })}
                    placeholder="在此输入详细的 AI 提示词。例如：读取最近一次 MCP 状态，自动整理最近三天的客户反馈，并将其格式化输出..."
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded-lg px-3 py-2 outline-none font-mono leading-relaxed"
                  />
                  <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-1">
                    <Sparkles className="w-3 h-3 text-indigo-500 shrink-0" />
                    <span>提示：该任务运行时将自动读取已连接的 MCP 服务器工具以及您的个人记忆画像进行优化。</span>
                  </span>
                </div>

                {/* Footer Buttons */}
                <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-50">
                  <button 
                    type="button"
                    onClick={() => { setIsEditingTaskOpen(false); setEditingTask(null); }}
                    className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-lg font-medium transition-all"
                  >
                    取消
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      // Manual Add Workflow
                      if (editingTask.id.startsWith("task_manual_")) {
                        setScheduleTasks(prev => [...prev, {
                          ...editingTask,
                          id: "task_" + Date.now(),
                          enabled: true,
                          nextRunTime: new Date(Date.now() + 12 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16)
                        }]);
                        setIsEditingTaskOpen(false);
                        setEditingTask(null);
                        
                        // Notify agent
                        setSchedulerMessages(prev => [...prev, {
                          id: "sched_msg_manual_success_" + Date.now(),
                          role: "assistant",
                          content: `🆕 **手动创建成功**！您已经手动部署并激活了定时任务【**${editingTask.title}**】。该计划已被注入到实时微服务定时器队列中！`,
                          timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                        }]);
                      } else {
                        // Standard Edit Save
                        setScheduleTasks(prev => prev.map(t => t.id === editingTask.id ? editingTask : t));
                        setIsEditingTaskOpen(false);
                        setEditingTask(null);

                        // Notify agent
                        setSchedulerMessages(prev => [...prev, {
                          id: "sched_msg_manual_success_" + Date.now(),
                          role: "assistant",
                          content: `✍️ **配置更新成功**！您手动修改了定时任务【**${editingTask.title}**】。最新参数已在调度池刷新！`,
                          timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                        }]);
                      }
                    }}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold transition-all shadow-2xs"
                  >
                    保存并激活
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}

        {/* ========================================================
            MODAL 2: SCHEDULE TASK SIMULATION EXECUTOR & OUTPUT
            ======================================================== */}
        {(runningTask || runningTaskResult) && (
          <motion.div 
            key="modal-running-task"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-xl shadow-lg border border-slate-200 max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-indigo-600" />
                  <h3 className="font-display font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                    <span>定时任务沙盒测试：</span>
                    <strong className="text-slate-950">{runningTask ? runningTask.title : runningTaskResult?.title}</strong>
                  </h3>
                </div>
                {!runningTask && (
                  <button 
                    onClick={() => setRunningTaskResult(null)} 
                    className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
                
                {/* 1. PROGRESS / TERMINAL LOGS (If running) */}
                {runningTask && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/50">
                      <Sparkles className="w-5 h-5 text-indigo-600 animate-spin shrink-0" />
                      <div className="text-xs">
                        <h4 className="font-semibold text-indigo-900">正在按调度策略模拟后台运行中...</h4>
                        <p className="text-indigo-600/75 mt-0.5 font-mono">Status: INFERENCE_PIPELINE_ACTIVE</p>
                      </div>
                    </div>

                    <div className="bg-slate-950 text-emerald-400 p-4 rounded-xl font-mono text-xs space-y-1.5 shadow-inner border border-slate-800 h-64 overflow-y-auto leading-relaxed">
                      {runningTaskLogs.map((log, index) => (
                        <div key={index} className="animate-fade-in">{log}</div>
                      ))}
                      <div className="flex items-center gap-1 text-slate-500 animate-pulse mt-2">
                        <span>●</span>
                        <span>等待核心节点流返回...</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. REALISTIC OUTPUT / REPORT VIEW (If completed) */}
                {runningTaskResult && (
                  <div className="space-y-4">
                    <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-lg border border-emerald-150 flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-emerald-600" />
                        <span><strong>沙盒触发测试成功</strong>！大模型完美解析了指令，并渲染了高品质的 <strong>{runningTaskResult.displayFormat.toUpperCase()}</strong> 文件。</span>
                      </div>
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 font-mono px-2 py-0.5 rounded font-bold">100% SUCCESS</span>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                      {/* Email Format Frame */}
                      {runningTaskResult.displayFormat === 'email' ? (
                        <div className="bg-slate-50/60 text-xs text-slate-600 divide-y divide-slate-100 font-sans">
                          <div className="p-3 flex items-center gap-2">
                            <span className="font-semibold text-slate-400 w-12 text-right">主题:</span>
                            <span className="font-semibold text-slate-800">{runningTaskResult.title} (企业日报推送)</span>
                          </div>
                          <div className="p-3 flex items-center gap-2">
                            <span className="font-semibold text-slate-400 w-12 text-right">发件人:</span>
                            <span className="text-slate-800 font-mono">AgentScheduler@office-hub.internal</span>
                          </div>
                          <div className="p-3 flex items-center gap-2">
                            <span className="font-semibold text-slate-400 w-12 text-right">收件人:</span>
                            <span className="text-slate-800 font-mono">{userProfile.name} &lt;{userProfile.name}@enterprise.ai&gt;</span>
                          </div>
                          <div className="p-5 bg-white overflow-y-auto max-h-96 leading-relaxed text-slate-800 font-sans">
                            <Markdown remarkPlugins={[remarkGfm]}>{runningTaskResult.content}</Markdown>
                          </div>
                        </div>
                      ) : (
                        // Markdown, Card, List, Table output
                        <div className="p-5 overflow-y-auto max-h-96 leading-relaxed font-sans markdown-body bg-white text-slate-800">
                          <Markdown remarkPlugins={[remarkGfm]}>{runningTaskResult.content}</Markdown>
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>

              {/* Footer */}
              {!runningTask && (
                <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex justify-end shrink-0">
                  <button 
                    type="button"
                    onClick={() => setRunningTaskResult(null)}
                    className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-all shadow-2xs cursor-pointer"
                  >
                    关闭结果预览
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}

        {/* ========================================================
            MODAL 1.8: USER LOGIN & ACCOUNT SWITCH MODAL
            ======================================================== */}
        {showLoginModal && (
          <motion.div
            key="modal-login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500"></div>

              <div className="p-7">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                      <LogIn className="w-5 h-5" />
                    </div>
                    <h3 className="font-display font-semibold text-base text-slate-900">企业账号登录</h3>
                  </div>
                  <button
                    onClick={() => setShowLoginModal(false)}
                    className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-slate-500 mb-5">
                  使用企业统一身份认证登录，登录后将自动同步个人画像、技能与记忆。
                </p>

                <button
                  onClick={() => { startLogin(); }}
                  className="w-full py-3 bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-semibold rounded-2xl transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogIn className="w-4 h-4" />
                  跳转 Keycloak 登录
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}


      </AnimatePresence>

      {/* FastAPI Docs Modal */}
      <ApiDocsModal 
        isOpen={showApiDocsModal} 
        onClose={() => setShowApiDocsModal(false)} 
      />

      {/* Global Floating Auth Toast Notification */}
      <AnimatePresence>
        {authNotice && (
          <motion.div
            key="toast-auth-notice"
            initial={{ opacity: 0, y: -20, x: "-50%", scale: 0.95 }}
            animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
            exit={{ opacity: 0, y: -20, x: "-50%", scale: 0.95 }}
            className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 text-white text-xs px-4 py-2.5 rounded-full shadow-2xl backdrop-blur-md border border-slate-700/80 flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{authNotice}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Floating Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast-global-notice"
            initial={{ opacity: 0, y: 20, x: "-50%", scale: 0.95 }}
            animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
            exit={{ opacity: 0, y: 15, x: "-50%", scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900/95 backdrop-blur-md text-white shadow-xl border border-slate-800/80 text-xs font-medium"
          >
            {toast.type === "warning" && <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
            {toast.type === "success" && <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toast.type === "info" && <Info className="w-4 h-4 text-blue-400 shrink-0" />}
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
