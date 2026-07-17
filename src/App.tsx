import React, { useState, useEffect, useRef } from "react";
import { 
  MessageSquare, Layers, Brain, Database, Settings, 
  Plus, Trash2, Send, Play, Pause, Check, X, Upload, 
  Sparkles, Key, AlertTriangle, RefreshCw, User, 
  ChevronDown, ChevronUp, Terminal, Search, Flame, 
  Calendar, Info, HelpCircle, ChevronLeft, ChevronRight, Menu,
  Clock, Edit3, AlertCircle, PlayCircle, Eye, Image, FileText, Paperclip, Loader2
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
  initialMcpServers, initialModelConfigs, initialSessions,
  initialScheduleTasks
} from "./mockData";

export default function App() {
  // --- Page Navigation State ---
  const [activeTab, setActiveTab] = useState<"dialogue" | "skills" | "memory" | "scheduler" | "mcp" | "settings">("dialogue");
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

  // --- Local Database States (with localStorage recovery) ---
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem("office_ai_profile");
    return saved ? JSON.parse(saved) : initialUserProfile;
  });

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

  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>(() => {
    const saved = localStorage.getItem("office_ai_models");
    return saved ? JSON.parse(saved) : initialModelConfigs;
  });

  const [scheduleTasks, setScheduleTasks] = useState<ScheduleTask[]>(() => {
    const saved = localStorage.getItem("office_ai_schedule_tasks");
    return saved ? JSON.parse(saved) : initialScheduleTasks;
  });

  const [sessions, setSessions] = useState<Session[]>(() => {
    const saved = localStorage.getItem("office_ai_sessions");
    return saved ? JSON.parse(saved) : initialSessions;
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const saved = localStorage.getItem("office_ai_active_session");
    if (saved) return saved;
    return initialSessions[0]?.id || "";
  });

  const [selectedModelId, setSelectedModelId] = useState<string>("model_gemini");

  // --- UI Interactive States ---
  const [inputMessage, setInputMessage] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const [activeStreamingMessageId, setActiveStreamingMessageId] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<{ [msgId: string]: boolean }>({});
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [expandedMcpServers, setExpandedMcpServers] = useState<{ [serverId: string]: boolean }>({});

  // Global Toast Notification State
  const [toast, setToast] = useState<{ message: string; type: "info" | "warning" | "success" } | null>(null);

  const showToast = (message: string, type: "info" | "warning" | "success" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => prev && prev.message === message ? null : prev);
    }, 3000);
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
  const [modelConnectionStatuses, setModelConnectionStatuses] = useState<{ 
    [modelId: string]: { status: "connected" | "disconnected" | "simulated"; latency?: string; message?: string } 
  }>({});

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
    localStorage.setItem("office_ai_models", JSON.stringify(modelConfigs));
  }, [modelConfigs]);

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
    fetch("/api/health")
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

    // Create session if none exists
    let currentSessionId = activeSessionId;
    let updatedSessions = [...sessions];

    if (!activeSession) {
      const newSessId = "session_" + Date.now();
      const newSess: Session = {
        id: newSessId,
        title: text.length > 15 ? text.substring(0, 15) + "..." : text,
        model: modelConfigs.find(m => m.id === selectedModelId)?.name || "Gemini 3.5 Flash",
        createdAt: new Date().toISOString().split('T')[0],
        messages: []
      };
      updatedSessions = [newSess, ...sessions];
      setSessions(updatedSessions);
      setActiveSessionId(newSessId);
      currentSessionId = newSessId;
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
      // Send API request
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: currentMessages,
          profile: isMemoryEnabled ? userProfile : null,
          memories: isMemoryEnabled ? memories : [],
          skills: skills,
          mcpServers: mcpServers,
          activeModel: modelConfigs.find(m => m.id === selectedModelId)
        })
      });

      if (!response.ok) {
        throw new Error("服务器返回异常");
      }

      const aiMsg: Message = await response.json();

      // Stream the assistant message instead of appending it instantly
      await streamResponse(aiMsg, currentSessionId);

    } catch (error) {
      console.error("Chat sending error:", error);
      // Append fallback offline simulated message
      const errorFallbackMsg: Message = {
        id: "msg_err_" + Date.now(),
        role: "assistant",
        content: `### ⚠️ 操作未完全执行成功

在与 AI 模型通信时遇到网络瓶颈。

**排查建议：**
1. 检查环境变量 \`GEMINI_API_KEY\` 是否在 AI Studio Secrets 面板中正确注入。
2. 检查本地网络与服务端的连接状态。
3. 您可以继续在“设置”页中测试不同的模型供应商。`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        thinking: "请求出错，生成故障排查建议..."
      };

      // Stream the error fallback message as well for unified fluid user experience
      await streamResponse(errorFallbackMsg, currentSessionId);
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
  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
          fetch("/api/skills/upload", {
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
      const response = await fetch("/api/mcp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: id, serverName: name })
      });

      const data = await response.json();
      if (data.success) {
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
      const response = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: config.id,
          modelName: config.name,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setModelConnectionStatuses(prev => ({
          ...prev,
          [config.id]: {
            status: data.status || "connected",
            latency: data.latency,
            message: data.message
          }
        }));
        showToast(`模型 [${config.name}] 握手成功：联通性正常！`, "success");
      } else {
        setModelConnectionStatuses(prev => ({
          ...prev,
          [config.id]: {
            status: "disconnected",
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
          status: "disconnected",
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
          tools: nextStatus === "connected" ? m.tools : []
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
                  </motion.nav>
                )}
              </AnimatePresence>

              {/* User Profile Card acts as the toggle header */}
              <div 
                onClick={toggleNavExpanded}
                className="p-3 bg-slate-50/30 cursor-pointer hover:bg-slate-100/40 select-none transition-colors"
                title={isNavExpanded ? "点击收起功能导航" : "点击展开功能导航"}
              >
                <div className="flex items-center gap-2.5 bg-white border border-slate-150 rounded-lg p-2.5 shadow-3xs hover:border-slate-300 transition-colors">
                  <div className="w-7 h-7 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-600 shrink-0">
                    <User className="w-4 h-4" />
                  </div>
                  <div className="text-left flex-1 min-w-0">
                    <h4 className="text-[11px] font-bold text-slate-800 leading-tight">{userProfile.name}</h4>
                    <p className="text-[9px] text-slate-400 font-mono leading-none mt-0.5 truncate">{userProfile.role}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-sm shadow-emerald-200" title="在线"></span>
                    {isNavExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5 transition-transform duration-200 rotate-180" />
                    ) : (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400 ml-0.5 transition-transform duration-200 rotate-180" />
                    )}
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
      <main className="flex-1 flex flex-col overflow-hidden bg-[#fbfcfd] relative">
        
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
                  <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <div>
                      <h3 className="font-display font-semibold text-sm text-slate-800">
                        {activeSession ? activeSession.title : "开始探索"}
                      </h3>
                    </div>
                  </div>

                  {/* Message Bubble Field */}
                  <div className="flex-1 overflow-y-auto px-6 pt-4 pb-36 space-y-6">
                    {!activeSession || activeSession.messages.length === 0 ? (
                      /* Chat Empty State / Quick automation prompts */
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
                            className="p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/50 text-left transition-all shadow-xs"
                          >
                            <div className="text-indigo-600 font-semibold text-xs flex items-center gap-1.5 mb-1">
                              <span>📊</span> 周报计划极速生成
                            </div>
                            <p className="text-[11px] text-slate-500 leading-normal">
                              聚合我的工作记录，根据画像偏好一键整理标准周报和下周计划。
                            </p>
                          </button>

                          <button 
                            onClick={() => {
                              setInputMessage("检查当前 MCP 服务器连接状态，并调用 saas_db_analytical_portal 工具查询今日接口错误指标。");
                            }}
                            className="p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/50 text-left transition-all shadow-xs"
                          >
                            <div className="text-emerald-600 font-semibold text-xs flex items-center gap-1.5 mb-1">
                              <span>🔗</span> 连通 MCP 工具检索
                            </div>
                            <p className="text-[11px] text-slate-500 leading-normal">
                              穿透本地中继通道，调用已注册的外部系统数据库或 API 获得实时日志。
                            </p>
                          </button>

                          <button 
                            onClick={() => {
                              setInputMessage("调用文档智能解析技能，帮我拟一封符合中高层汇报调性的邮件草稿，解释系统正常连通。");
                            }}
                            className="p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/50 text-left transition-all shadow-xs"
                          >
                            <div className="text-amber-600 font-semibold text-xs flex items-center gap-1.5 mb-1">
                              <span>✉️</span> 智能商务邮件拟写
                            </div>
                            <p className="text-[11px] text-slate-500 leading-normal">
                              使用极简文字一键扩展出礼貌、谦逊的职场商务邮件回复，一键拟好。
                            </p>
                          </button>

                          <button 
                            onClick={() => {
                              setInputMessage("告诉我关于你记住的‘我的画像和认知事实’，我可以怎么调整？");
                            }}
                            className="p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50/50 text-left transition-all shadow-xs"
                          >
                            <div className="text-slate-700 font-semibold text-xs flex items-center gap-1.5 mb-1">
                              <span>🧠</span> 自定义画像与事实调整
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
                                              className="p-1 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors shrink-0"
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
                                  {/* Collapsible Agent Execution Trace Panel */}
                                  {(msg.thinking || (msg.toolsUsed && msg.toolsUsed.length > 0)) && (
                                    <div className="w-full bg-slate-50/70 border border-slate-200/60 rounded-xl overflow-hidden transition-all duration-200 hover:border-slate-300 shadow-3xs">
                                      {/* Banner Bar */}
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

                                      {/* Detailed Logs as a chronological step-by-step timeline */}
                                      {expandedThinking[msg.id] && (
                                        <div className="p-5 bg-white border-t border-slate-100 space-y-4">
                                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                                            <Brain className="w-3.5 h-3.5 text-indigo-500" />
                                            <span>时序链路执行轨迹 (Chronological Execution Path)</span>
                                          </div>

                                          {(() => {
                                            const thoughts = msg.thinking ? msg.thinking.split('\n').filter(line => line.trim()) : [];
                                            const tools = msg.toolsUsed || [];
                                            const timeline: { type: "thought" | "tool"; text: string; tool?: any }[] = [];

                                            if (thoughts.length > 0 && tools.length > 0) {
                                              // Split preparatory thoughts to put tool calls in the middle logically
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
                                                      {/* Circle Bullet on Timeline Line */}
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
                                                      
                                                      {/* Step details */}
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
                                                          
                                                          {/* Expanded JSON details for parameters & output */}
                                                          <div className="space-y-2 pt-2 border-t border-slate-200/30 text-[11px] text-slate-600">
                                                            <details className="group" open={isCurrentActiveStep}>
                                                              <summary className="list-none flex items-center gap-1.5 cursor-pointer text-slate-500 hover:text-slate-800 font-medium select-none">
                                                                <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform text-slate-400" />
                                                                <span>输入参数 (Parameters)</span>
                                                              </summary>
                                                              <div className="mt-1.5 pl-3 border-l-2 border-slate-200 py-1 font-mono text-[10px] text-slate-600 overflow-x-auto whitespace-pre-wrap bg-slate-100/50 rounded-md p-2">
                                                                {event.tool.args}
                                                              </div>
                                                            </details>
                                                            
                                                            {event.tool.result && (
                                                              <details className="group">
                                                                <summary className="list-none flex items-center gap-1.5 cursor-pointer text-slate-500 hover:text-slate-800 font-medium select-none mt-1">
                                                                  <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform text-slate-400" />
                                                                  <span>输出反馈 (Result Context)</span>
                                                                </summary>
                                                                <div className="mt-1.5 pl-3 border-l-2 border-emerald-200 py-1 font-mono text-[10px] text-emerald-800 overflow-x-auto bg-emerald-50/40 rounded-md p-2">
                                                                  {event.tool.result}
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
                                                
                                                {/* Status indicator bullet indicating completion or active pipeline state */}
                                                {msg.id === activeStreamingMessageId ? (
                                                  <div className="relative group/step animate-pulse">
                                                    <div className="absolute -left-[32px] top-1 w-3 h-3 flex items-center justify-center bg-white rounded-full">
                                                      <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                                                    </div>
                                                    <div className="flex flex-col gap-0.5 pl-1">
                                                      <span className="text-xs text-indigo-600 font-bold font-sans">
                                                        AI Agent 自动化流水线流式响应中...
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

                                  {/* The Core Deliverable Report Card / Main Text Response */}
                                  <div className="w-full bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden relative group/card hover:shadow-sm transition-shadow max-w-3xl">
                                    
                                    {/* Hover Copy Action Utility */}
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

                                    {/* Main Prose Content */}
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

                        {/* Sending indicator */}
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
                        
                        {/* 1. Pending Attachments List Preview */}
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

                        {/* 0. Slash Command Skills Dropdown Panel */}
                        {showSkillsDropdown && (
                          <div className="absolute bottom-full mb-2 left-0 right-0 bg-white border border-slate-200/95 rounded-xl shadow-lg overflow-hidden max-h-60 overflow-y-auto z-40 flex flex-col divide-y divide-slate-100">
                            <div className="px-3.5 py-1.5 bg-slate-50/80 text-[10px] font-semibold text-slate-400 flex items-center justify-between shrink-0">
                              <span className="flex items-center gap-1">💡 显式引用自动化技能 (键盘上下键选择，回车确认)</span>
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

                        {/* 2. Textarea input */}
                        <textarea 
                          id="chat-textarea"
                          value={inputMessage}
                          onChange={(e) => {
                            const value = e.target.value;
                            setInputMessage(value);
                            
                            // Check if slash command is typed
                            const lastSlashIndex = value.lastIndexOf("/");
                            if (lastSlashIndex !== -1 && (lastSlashIndex === 0 || value[lastSlashIndex - 1] === " " || value[lastSlashIndex - 1] === "\n")) {
                              const query = value.slice(lastSlashIndex + 1);
                              // Slash query shouldn't contain a space
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

                        {/* Hidden inputs for uploading */}
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          className="hidden" 
                          multiple 
                          onChange={(e) => {
                            if (e.target.files) processFiles(e.target.files);
                            e.target.value = ''; // Reset to allow re-upload of same file
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
                            e.target.value = ''; // Reset to allow re-upload of same file
                          }} 
                        />

                        {/* 3. Bottom actions bar */}
                        <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-slate-100 bg-slate-50/35 rounded-b-xl">
                          {/* Left: Upload Buttons */}
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

                          {/* Right: Model dropdown select & Send button */}
                          <div className="flex items-center gap-2">
                            {/* Model Select dropdown adjacent to Send button */}
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

                            {/* Send Button */}
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
            )}

            {/* ========================================================
                2. SKILLS VIEW
                ======================================================== */}
            {activeTab === "skills" && (
              <motion.div 
                key="skills-view"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="p-6 overflow-y-auto h-full"
              >
                <div className="max-w-5xl mx-auto space-y-6">
                  
                  {/* Page Header banner */}
                  <div className="flex justify-between items-start border-b border-slate-100 pb-5">
                    <div>
                      <h2 className="text-xl font-display font-semibold text-slate-900">🛠️ 办公技能包管理中心</h2>
                      <p className="text-xs text-slate-500 mt-1">
                        启用、禁用或调试大模型的自动化工具库。支持直接上传打包好的 `.zip` 或 `.json` 自定义技能模板。
                      </p>
                    </div>

                    <button 
                      onClick={() => setShowUploadSkillModal(true)}
                      className="flex items-center gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg shadow-sm transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>上传自定义技能包</span>
                    </button>
                  </div>

                  {/* Skills Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {skills.map((skill) => (
                      <div 
                        key={skill.id}
                        className={`bg-white border rounded-xl p-5 shadow-2xs relative flex flex-col justify-between transition-all ${
                          skill.enabled 
                            ? "border-slate-200" 
                            : "border-slate-100 opacity-75"
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="font-display font-semibold text-sm text-slate-800">{skill.name}</h3>
                            <div className="flex items-center gap-2">
                              {renderCategoryTag(skill.category)}
                              
                              {/* Toggle switch */}
                              <button 
                                onClick={() => handleToggleSkill(skill.id)}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                                  skill.enabled ? "bg-slate-900" : "bg-slate-200"
                                }`}
                              >
                                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                  skill.enabled ? "translate-x-4" : "translate-x-0"
                                }`} />
                              </button>
                            </div>
                          </div>

                          <p className="text-xs text-slate-500 leading-normal mb-2">
                            {skill.description}
                          </p>
                        </div>

                        {/* Custom skill trash option */}
                        {skill.isCustom && (
                          <div className="mt-3 text-right">
                            <button 
                              onClick={() => setSkills(prev => prev.filter(s => s.id !== skill.id))}
                              className="text-[10px] text-red-500 hover:underline inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>卸载此自定义技能</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Skills hint */}
                  <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-100 text-xs text-slate-500 flex gap-3.5">
                    <HelpCircle className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-slate-700 mb-0.5">如何使技能在会话中生效？</h4>
                      <p className="leading-relaxed">
                        当您在 **智能对话** 中下达指令时，AI 会自动读取当前状态为“已开启”的技能描述。如果您的指令属于该技能处理的范畴（例如周报整理或文档阅读），AI 将在后台调用底层规则引擎，自动为您注入定制的参数。
                      </p>
                    </div>
                  </div>

                </div>
              </motion.div>
            )}

            {/* ========================================================
                3. MEMORY & PROFILING VIEW
                ======================================================== */}
            {activeTab === "memory" && (
              <motion.div 
                key="memory-view"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="p-6 overflow-y-auto h-full"
              >
                <div className="max-w-5xl mx-auto space-y-6">
                  
                  {/* Page header banner */}
                  <div className="border-b border-slate-100 pb-5">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                      <div>
                        <h2 className="text-xl font-display font-semibold text-slate-900">🧠 记忆与认知画像</h2>
                        <p className="text-xs text-slate-500 mt-1">
                          查看并管理大模型对您的偏好认知事实（Persona & Memories）。这些设定会被永久编码到 AI 的系统指令里，从而让其提供越用越懂您的极致服务。
                        </p>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-4 shrink-0">
                        {/* Memory Load Switch */}
                        <div className="flex items-center gap-2.5 bg-white border border-slate-200 px-3.5 py-2 rounded-xl shadow-2xs">
                          <div className="text-right">
                            <span className="block text-xs font-semibold text-slate-800">大模型加载记忆</span>
                            <span className={`text-[9px] block ${isMemoryEnabled ? "text-emerald-600 font-semibold" : "text-slate-400"}`}>
                              {isMemoryEnabled ? "已启用加载" : "已暂停加载"}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsMemoryEnabled(!isMemoryEnabled)}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                              isMemoryEnabled ? "bg-emerald-500" : "bg-slate-200"
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                isMemoryEnabled ? "translate-x-5" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>

                        {/* Dynamic intelligence progress bar */}
                        <div className="bg-white border border-slate-150 p-2.5 rounded-xl flex items-center gap-3 shadow-2xs">
                          <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-bold bg-emerald-50/50 transition-colors ${
                            isMemoryEnabled ? "border-emerald-500 text-emerald-600" : "border-slate-300 text-slate-400 bg-slate-50/50"
                          }`}>
                            {isMemoryEnabled ? "85%" : "0%"}
                          </div>
                          <div>
                            <h4 className={`text-xs font-semibold leading-tight transition-colors ${isMemoryEnabled ? "text-slate-800" : "text-slate-400"}`}>认知匹配度</h4>
                            <p className="text-[10px] text-slate-400 leading-tight">
                              {isMemoryEnabled ? `已记录 ${memories.length} 条核心偏好事实` : "AI 账本加载已禁用"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Warning banner when memory is disabled */}
                  {!isMemoryEnabled && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-amber-50/80 border border-amber-200 rounded-xl p-4 flex items-start gap-3 shadow-2xs"
                    >
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-xs font-semibold text-amber-800">AI 记忆与画像处于关闭状态</h4>
                        <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                          当前已手动关闭大模型记忆加载。与 AI 会话时，系统<strong>不会</strong>将您的“用户基础画像”以及“事实习惯条目”注入到 AI 的系统指令中，智能体将退回至通用默认状态，从而不加载任何您的专属偏好。
                        </p>
                      </div>
                    </motion.div>
                  )}

                  <div className={`grid grid-cols-1 lg:grid-cols-12 gap-6 transition-all duration-300 ${!isMemoryEnabled ? "opacity-60 saturate-50" : "opacity-100"}`}>
                    
                    {/* Column 1: Profile form config (5 cols) */}
                    <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-2xs self-start">
                      <div className="flex items-center gap-2 mb-4 border-b border-slate-50 pb-3">
                        <User className="w-4 h-4 text-slate-400" />
                        <h3 className="font-display font-semibold text-sm text-slate-800">用户基础画像配置</h3>
                      </div>

                      <div className="space-y-4 text-xs">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">姓名 / 呼称</label>
                          <input 
                            type="text" 
                            value={userProfile.name}
                            onChange={(e) => setUserProfile({ ...userProfile, name: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-slate-50/30 focus:bg-white focus:outline-hidden"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">职级 / 核心角色</label>
                          <input 
                            type="text" 
                            value={userProfile.role}
                            onChange={(e) => setUserProfile({ ...userProfile, role: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-slate-50/30 focus:bg-white focus:outline-hidden"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">归属部门 / 业务线</label>
                          <input 
                            type="text" 
                            value={userProfile.department}
                            onChange={(e) => setUserProfile({ ...userProfile, department: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-slate-50/30 focus:bg-white focus:outline-hidden"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">文本输出偏好语气</label>
                          <select 
                            value={userProfile.tonePreference}
                            onChange={(e) => setUserProfile({ ...userProfile, tonePreference: e.target.value as any })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-slate-50/30 focus:bg-white focus:outline-hidden cursor-pointer"
                          >
                            <option value="professional">专业严谨 (Corporate Standard)</option>
                            <option value="friendly">热情温和 (Collaborative & Warm)</option>
                            <option value="concise">极其精炼 (Concise & Bullet points)</option>
                            <option value="detailed">极尽详实 (Exhaustive Analysis)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">默认排版格式</label>
                          <select 
                            value={userProfile.formatPreference}
                            onChange={(e) => setUserProfile({ ...userProfile, formatPreference: e.target.value as any })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-slate-50/30 focus:bg-white focus:outline-hidden cursor-pointer"
                          >
                            <option value="markdown">标准多级标题 Markdown 格式</option>
                            <option value="bullet">扁平化项目符号列表 (Bullet points)</option>
                            <option value="plain">纯文本流式段落 (Plain paragraphs)</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Column 2: Cognitive facts checklist (7 cols) */}
                    <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
                      
                      {/* Section Title */}
                      <div className="flex items-center justify-between mb-4 border-b border-slate-50 pb-3">
                        <h3 className="font-display font-semibold text-sm text-slate-800">AI 学习记住的事实习惯</h3>
                        <span className="text-[10px] text-slate-400 font-mono">COUNT: {memories.length}</span>
                      </div>

                      {/* Add memory form inline */}
                      <form onSubmit={handleAddMemory} className="flex gap-2.5 mb-5">
                        <div className="flex-1 relative">
                          <input 
                            type="text"
                            placeholder="手动向 AI 账本注入新的偏好或偏好事实（例: “用户出差目的地偏向上海”）"
                            value={newMemoryContent}
                            onChange={(e) => setNewMemoryContent(e.target.value)}
                            className="w-full border border-slate-200 text-xs rounded-lg pl-3 pr-20 py-2 text-slate-700 bg-slate-50/50 focus:bg-white focus:outline-hidden"
                          />
                          <select 
                            value={newMemoryCategory}
                            onChange={(e) => setNewMemoryCategory(e.target.value as any)}
                            className="absolute right-1.5 top-1.5 bg-slate-200 text-slate-600 rounded text-[9px] px-1 py-0.5 border-none cursor-pointer focus:outline-hidden"
                          >
                            <option value="preference">习惯偏好</option>
                            <option value="profile">工作背景</option>
                            <option value="schedule">流程排期</option>
                            <option value="system">集成环境</option>
                          </select>
                        </div>
                        <button 
                          type="submit"
                          className="px-3.5 py-1.5 bg-slate-900 text-white text-xs rounded-lg font-medium hover:bg-slate-850 transition-colors"
                        >
                          添加认知条目
                        </button>
                      </form>

                      {/* Memories List */}
                      <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
                        {memories.length === 0 ? (
                          <div className="text-center py-12 text-slate-400 text-xs">
                            暂无记忆条目。您可以在上方手动键入添加，或者在与 AI 的多轮会话中，由其自动归纳习得。
                          </div>
                        ) : (
                          memories.map((m) => (
                            <div 
                              key={m.id}
                              className="group flex items-start justify-between p-3 rounded-lg bg-slate-50 hover:bg-slate-100/50 border border-slate-100 transition-all text-xs"
                            >
                              <div className="flex items-start gap-3 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 shrink-0 mt-0.5">
                                  <span className={`px-1.5 py-0.5 text-[9px] font-semibold font-mono rounded shrink-0 ${
                                    m.category === "preference" ? "bg-amber-100 text-amber-800" :
                                    m.category === "profile" ? "bg-indigo-100 text-indigo-800" :
                                    m.category === "schedule" ? "bg-emerald-100 text-emerald-800" :
                                    "bg-slate-200 text-slate-800"
                                  }`}>
                                    {m.category === "preference" && "个人偏好"}
                                    {m.category === "profile" && "工作背景"}
                                    {m.category === "schedule" && "工作时间"}
                                    {m.category === "system" && "环境设置"}
                                  </span>
                                  <span className="px-1.5 py-0.5 text-[9px] font-medium font-mono rounded bg-slate-100 text-slate-500 border border-slate-200 shrink-0">
                                    置信度: {m.confidence || 95}%
                                  </span>
                                </div>
                                <p className="text-slate-700 leading-relaxed font-sans">{m.content}</p>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 ml-4">
                                <span className="text-[9px] text-slate-400 font-mono whitespace-nowrap">
                                  {m.createdAt}
                                </span>
                                <button 
                                  onClick={() => handleDeleteMemory(m.id)}
                                  className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-red-500 transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                    </div>
                  </div>

                </div>
              </motion.div>
            )}

            {/* ========================================================
                3.1. SCHEDULE & CRON PLANNER VIEW (NEW MAJOR MODULE)
                ======================================================== */}
            {activeTab === "scheduler" && (
              <motion.div 
                key="scheduler-view"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="p-6 overflow-hidden h-full flex flex-col"
              >
                <div className="max-w-7xl mx-auto w-full flex flex-col h-full space-y-4 overflow-hidden">
                  
                  {/* Header banner */}
                  <div className="border-b border-slate-100 pb-3.5 shrink-0 flex justify-between items-center">
                    <div>
                      <h2 className="text-lg font-display font-semibold text-slate-900 flex items-center gap-2">
                        <span>📅 智能日程与计划任务</span>
                        <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-mono border border-indigo-100/50">Enterprise Scheduler v2.1</span>
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        通过与专属 Agent 规划助理对话或手动配置，让 AI 定期自动运行复杂提示词指令，拉取多端 MCP 服务器工具并生成高品质报告。
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        setEditingTask({
                          id: "task_manual_" + Date.now(),
                          title: "未命名自定义定时任务",
                          scheduleType: "daily",
                          timeValue: "09:00",
                          prompt: "拉取最新的已关联数据，并总结今日核心改进建议。",
                          displayFormat: "markdown",
                          enabled: true,
                          createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
                          runCount: 0
                        });
                        setIsEditingTaskOpen(true);
                      }}
                      className="px-3.5 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-all shadow-2xs flex items-center gap-1.5 animate-fade-in"
                    >
                      <Plus className="w-3.5 h-3.5" /> 手动创建任务
                    </button>
                  </div>

                  {/* Single Full-width Panel: Scheduled Tasks List */}
                  <div className="flex-1 flex flex-col min-h-0 overflow-hidden mt-2">
                    <div className="mb-3.5 shrink-0 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">计划任务列表 ({scheduleTasks.length})</span>
                      <span className="text-[10px] text-slate-400 font-mono">定时调度线程就绪 ●</span>
                    </div>

                    {scheduleTasks.length > 0 && (
                      <div className="mb-3 bg-slate-50/70 border border-slate-150 rounded-xl p-2 px-3 flex flex-wrap items-center justify-between gap-2.5 shadow-3xs animate-fade-in text-xs">
                        <div className="flex items-center gap-2">
                          <input 
                            type="checkbox"
                            checked={scheduleTasks.length > 0 && selectedTaskIds.length === scheduleTasks.length}
                            onChange={handleSelectAllTasks}
                            className="w-3.5 h-3.5 accent-indigo-600 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            id="batch-select-all"
                          />
                          <label htmlFor="batch-select-all" className="font-medium text-slate-600 select-none cursor-pointer">
                            全选
                          </label>
                          {selectedTaskIds.length > 0 && (
                            <span className="px-2 py-0.5 text-[10px] font-bold bg-indigo-100 text-indigo-700 rounded-full font-mono">
                              已选 {selectedTaskIds.length} 项
                            </span>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleBatchEnableTasks}
                            disabled={selectedTaskIds.length === 0}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                              selectedTaskIds.length > 0 
                                ? "bg-white hover:bg-emerald-50 text-emerald-600 border border-emerald-200/50 hover:border-emerald-300 shadow-3xs" 
                                : "text-slate-400 bg-slate-100/50 border border-transparent cursor-not-allowed"
                            }`}
                          >
                            <Play className="w-3 h-3" />
                            <span>批量激活</span>
                          </button>
                          
                          <button
                            type="button"
                            onClick={handleBatchPauseTasks}
                            disabled={selectedTaskIds.length === 0}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                              selectedTaskIds.length > 0 
                                ? "bg-white hover:bg-amber-50 text-amber-600 border border-amber-200/50 hover:border-amber-300 shadow-3xs" 
                                : "text-slate-400 bg-slate-100/50 border border-transparent cursor-not-allowed"
                            }`}
                          >
                            <Pause className="w-3 h-3" />
                            <span>批量暂停</span>
                          </button>
                          
                          <button
                            type="button"
                            onClick={handleBatchDeleteTasks}
                            disabled={selectedTaskIds.length === 0}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                              selectedTaskIds.length > 0 
                                ? "bg-red-50 hover:bg-red-100 text-red-600 border border-red-100/50 hover:border-red-200 shadow-3xs" 
                                : "text-slate-400 bg-slate-100/50 border border-transparent cursor-not-allowed"
                            }`}
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>批量删除</span>
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex-1 overflow-y-auto pr-1.5 pb-6">
                      {scheduleTasks.length === 0 ? (
                        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-10 text-center space-y-3">
                          <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 mx-auto">
                            <Calendar className="w-6 h-6" />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-slate-700">暂无任何计划任务</h4>
                            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                              点击右上角 “手动创建任务” 即可将复杂工作流绑定为定期自动执行的计划。
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {scheduleTasks.map((task) => (
                            <div 
                              key={task.id}
                              onClick={() => setViewingTask(task)}
                              className={`bg-white border rounded-xl p-4 transition-all duration-200 hover:border-indigo-300 hover:shadow-xs cursor-pointer relative group flex flex-col justify-between ${
                                selectedTaskIds.includes(task.id)
                                  ? "border-indigo-400 bg-indigo-50/10 shadow-xs"
                                  : task.enabled ? "border-slate-200 shadow-3xs" : "border-slate-150 bg-slate-50/30 opacity-75"
                              }`}
                            >
                              <div className="flex flex-col space-y-3">
                                {/* Header: Title & Switch */}
                                <div className="flex justify-between items-start gap-3">
                                  <div className="flex items-start gap-2.5 min-w-0">
                                    <div onClick={(e) => e.stopPropagation()} className="flex items-center shrink-0 mt-0.5">
                                      <input 
                                        type="checkbox"
                                        checked={selectedTaskIds.includes(task.id)}
                                        onChange={() => handleToggleSelectTask(task.id)}
                                        className="w-3.5 h-3.5 accent-indigo-600 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                      />
                                    </div>
                                    <h3 className="font-semibold text-slate-800 text-xs truncate max-w-[150px] group-hover:text-indigo-600 transition-colors" title={task.title}>
                                      📌 {task.title}
                                    </h3>
                                  </div>
                                  
                                  {/* Toggle Switch */}
                                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                    <span className={`text-[9px] font-medium font-mono ${task.enabled ? "text-emerald-600" : "text-slate-400"}`}>
                                      {task.enabled ? "已激活" : "暂停"}
                                    </span>
                                    <button 
                                      onClick={() => handleToggleTask(task.id)}
                                      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                        task.enabled ? "bg-slate-900" : "bg-slate-200"
                                      }`}
                                    >
                                      <span
                                        className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                                          task.enabled ? "translate-x-3" : "translate-x-0"
                                        }`}
                                      />
                                    </button>
                                  </div>
                                </div>

                                {/* Meta details row: Badges and Schedule time */}
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                    task.displayFormat === 'table' ? 'bg-amber-50 text-amber-700 border border-amber-100/50' :
                                    task.displayFormat === 'email' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100/50' :
                                    task.displayFormat === 'bullet' ? 'bg-teal-50 text-teal-700 border border-teal-100/50' :
                                    'bg-slate-50 text-slate-600 border border-slate-200/50'
                                  }`}>
                                    {task.displayFormat.toUpperCase()}
                                  </span>

                                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                    task.scheduleType === 'daily' ? 'bg-sky-50 text-sky-700' :
                                    task.scheduleType === 'weekly' ? 'bg-indigo-50 text-indigo-700' :
                                    task.scheduleType === 'monthly' ? 'bg-purple-50 text-purple-700' :
                                    'bg-slate-100 text-slate-600'
                                  }`}>
                                    {task.scheduleType === 'daily' ? '每天' : task.scheduleType === 'weekly' ? '每周' : task.scheduleType === 'monthly' ? '每月' : '单次'}
                                  </span>

                                  <span className="flex items-center gap-0.5 text-indigo-600 font-medium font-mono text-[10px]">
                                    <Clock className="w-3 h-3 text-indigo-500" />
                                    {task.timeValue}
                                  </span>
                                </div>

                                {/* Bottom meta details: Click hints and execution info */}
                                <div className="flex items-center justify-between pt-2.5 border-t border-slate-50 text-[10px] text-slate-400 font-mono mt-2">
                                  <div className="flex items-center gap-2">
                                    <span>已运行: <strong className="text-slate-600 font-semibold">{task.runCount}次</strong></span>
                                    {task.lastRunTime && (
                                      <span className="opacity-75">| 上次: {task.lastRunTime.split(' ')[1] || task.lastRunTime}</span>
                                    )}
                                  </div>
                                  <span className="text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity font-semibold flex items-center gap-0.5">
                                    查看 ➔
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </motion.div>
            )}

            {/* ========================================================
                4. MCP SERVERS VIEW
                ======================================================== */}
            {activeTab === "mcp" && (
              <motion.div 
                key="mcp-view"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="p-6 overflow-y-auto h-full"
              >
                <div className="max-w-5xl mx-auto space-y-6">
                  
                  {/* Page header banner */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-xl font-display font-semibold text-slate-900">🔗 MCP 协议服务器连通面板</h2>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        通过 Model Context Protocol (MCP) 让 AI 穿透沙箱，安全调用本地或第三方应用数据与系统接口，实现强大的真自动化办公。
                      </p>
                    </div>

                    <button 
                      onClick={() => setShowAddServerModal(true)}
                      className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg shadow-sm transition-colors shrink-0 whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>添加 MCP 服务器</span>
                    </button>
                  </div>

                  {/* Add server modal overlay form */}
                  {showAddServerModal && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-5 border border-slate-200 bg-white rounded-xl shadow-xs space-y-4 max-w-xl"
                    >
                      <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                        <div>
                          <h3 className="font-display font-semibold text-sm text-slate-800">注册并导入 MCP 服务器 (JSON 格式)</h3>
                          <p className="text-[10px] text-slate-400 mt-0.5">请粘入标准的 MCP json 配置信息，支持多台服务器批量导入</p>
                        </div>
                        <button onClick={() => { setShowAddServerModal(false); setMcpJsonError(null); }} className="p-1 hover:bg-slate-100 rounded text-slate-400">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <form onSubmit={handleAddMcpServer} className="space-y-3.5 text-xs">
                        <div>
                          <div className="flex justify-between items-center mb-1.5">
                            <label className="block text-[11px] font-medium text-slate-500">JSON 配置代码</label>
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
                              className="text-[10px] text-indigo-600 hover:text-indigo-700 font-medium"
                            >
                              💡 插入示例模板
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

                        <div className="flex justify-end gap-2 pt-2 border-t border-slate-50">
                          <button 
                            type="button" 
                            onClick={() => { setShowAddServerModal(false); setMcpJsonError(null); }}
                            className="px-3.5 py-1.5 border border-slate-200 rounded-lg font-medium hover:bg-slate-50 text-slate-600"
                          >
                            取消
                          </button>
                          <button 
                            type="submit"
                            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-850 text-white rounded-lg font-medium shadow-xs"
                          >
                            导入并添加
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  )}

                  {/* Server Row List */}
                  <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden shadow-2xs">
                    {mcpServers.length === 0 ? (
                      <div className="text-center py-12 text-slate-400 text-xs">
                        目前未注册任何 MCP 协议服务，请点击右上方按钮导入。
                      </div>
                    ) : (
                      mcpServers.map((server) => {
                        const isConnected = server.status === "connected";
                        const isConnecting = server.status === "connecting";
                        
                        return (
                          <div 
                            key={server.id}
                            className="flex flex-col md:flex-row md:items-center justify-between p-4 gap-4 hover:bg-slate-50/50 transition-colors"
                          >
                            {/* Name & Connection Point */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-display font-semibold text-xs text-slate-900 truncate">{server.name}</h3>
                                <span className="px-1.5 py-0.2 text-[9px] font-mono rounded bg-slate-100 text-slate-600 border border-slate-150 uppercase shrink-0 whitespace-nowrap">
                                  {server.type}
                                </span>
                              </div>
                              <p className="text-[10px] font-mono text-slate-400 mt-1 truncate" title={server.urlOrCommand}>
                                {server.urlOrCommand}
                              </p>
                            </div>

                            {/* Controls: Switch, Status, Test Button, Delete Button */}
                            <div className="flex items-center gap-3 shrink-0 justify-between md:justify-end flex-wrap sm:flex-nowrap">
                              {/* Switch & Status */}
                              <div className="flex items-center gap-3 bg-slate-100/60 rounded-lg p-1 px-2 border border-slate-100 shrink-0 whitespace-nowrap">
                                {/* Status indicator */}
                                <div className="flex items-center gap-1.5 text-[10px]">
                                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                    isConnected ? "bg-emerald-500 animate-pulse" :
                                    isConnecting ? "bg-amber-500 animate-spin" :
                                    "bg-slate-300"
                                  }`}></span>
                                  <span className="font-medium text-slate-600 whitespace-nowrap">
                                    {isConnected ? "已联通" : isConnecting ? "正在连接" : "离线"}
                                  </span>
                                </div>

                                {/* Separator line */}
                                <span className="h-3 w-px bg-slate-200 shrink-0"></span>

                                {/* Manual state toggle */}
                                <button 
                                  onClick={() => handleToggleMcpStatus(server.id)}
                                  title={isConnected ? "关闭连接" : "开启连接"}
                                  className="relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden bg-slate-200"
                                  style={{ backgroundColor: isConnected ? "#0f172a" : "#e2e8f0" }}
                                >
                                  <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                    isConnected ? "translate-x-3" : "translate-x-0"
                                  }`} />
                                </button>
                              </div>

                              {/* Test Connectivity */}
                              <button 
                                onClick={() => handleTestMcpServer(server.id, server.name)}
                                disabled={isConnecting}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-[10px] font-medium transition-colors shrink-0 whitespace-nowrap ${
                                  isConnected 
                                    ? "bg-white hover:bg-slate-50 text-slate-700 border-slate-200" 
                                    : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-150"
                                }`}
                              >
                                <RefreshCw className={`w-3 h-3 shrink-0 ${isConnecting ? 'animate-spin' : ''}`} />
                                <span>{isConnected ? "测试联通" : "连通测试"}</span>
                              </button>

                              {/* Delete Button */}
                              <button 
                                onClick={() => handleDeleteMcpServer(server.id)}
                                title="注销此服务器"
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                </div>
              </motion.div>
            )}

            {/* ========================================================
                5. SETTINGS VIEW (Settings + Analytics Grid Heatmap matching screenshot)
                ======================================================== */}
            {activeTab === "settings" && (
              <motion.div 
                key="settings-view"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="p-6 overflow-y-auto h-full"
              >
                <div className="max-w-5xl mx-auto space-y-7">
                  
                  {/* Page header banner */}
                  <div className="border-b border-slate-100 pb-5">
                    <h2 className="text-xl font-display font-semibold text-slate-900">⚙️ 大模型连接管理与运行看板</h2>
                    <p className="text-xs text-slate-500 mt-1">
                      在这里注册并管理可用于智能助理调度的底层 LLM 模型供应商（OpenAI 兼容端点），并监控核心运行调用数据。
                    </p>
                  </div>

                  {/* ==========================================
                      STUNNING ANALYTICS WIDGETS (Matching 1st Screenshot)
                      ========================================== */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Flame className="w-4 h-4 text-orange-500" />
                      <h3 className="font-display font-semibold text-sm text-slate-800">智能网关运行统计仪表盘 (What's up next?)</h3>
                    </div>

                    {/* Stats summary row */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      
                      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
                        <span className="text-[10px] text-slate-400 font-medium">会话总数 / Sessions</span>
                        <h4 className="text-xl font-display font-semibold text-slate-900 mt-1">53</h4>
                        <div className="text-[9px] text-emerald-600 mt-1 font-semibold flex items-center gap-1">
                          <span>↑ 12%</span>
                          <span className="text-slate-400 font-normal">本周活跃</span>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
                        <span className="text-[10px] text-slate-400 font-medium">消息交互 / Messages</span>
                        <h4 className="text-xl font-display font-semibold text-slate-900 mt-1">16,479</h4>
                        <div className="text-[9px] text-slate-400 mt-1">
                          平均会话消息数: <span className="font-mono">12.5条</span>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
                        <span className="text-[10px] text-slate-400 font-medium">累计消耗 / Total tokens</span>
                        <h4 className="text-xl font-display font-semibold text-slate-900 mt-1">100.9M</h4>
                        <div className="text-[9px] text-slate-400 mt-1">
                          折合约为 134.5 万个中文字符
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
                        <span className="text-[10px] text-slate-400 font-medium">最长连续工作天数 / Streak</span>
                        <h4 className="text-xl font-display font-semibold text-slate-900 mt-1">15 天</h4>
                        <div className="text-[9px] text-orange-600 font-semibold mt-1">
                          最高活跃记录：4天连续
                        </div>
                      </div>

                    </div>

                    {/* Heatmap Contribution Calendar-style Widget */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span>AI 每日协同调用热力图 (最近45周)</span>
                        </h4>
                        <div className="flex gap-1.5 items-center text-[10px] text-slate-400">
                          <span>少</span>
                          <span className="w-2.5 h-2.5 bg-slate-100 rounded"></span>
                          <span className="w-2.5 h-2.5 bg-blue-100 rounded"></span>
                          <span className="w-2.5 h-2.5 bg-blue-300 rounded"></span>
                          <span className="w-2.5 h-2.5 bg-blue-500 rounded"></span>
                          <span className="w-2.5 h-2.5 bg-blue-700 rounded"></span>
                          <span>多</span>
                        </div>
                      </div>

                      {/* Heatmap Grid of blue blocks representing calendar contributions */}
                      <div className="flex gap-1 overflow-x-auto py-2">
                        {Array.from({ length: 45 }).map((_, weekIdx) => (
                          <div key={weekIdx} className="flex flex-col gap-1 shrink-0">
                            {Array.from({ length: 7 }).map((_, dayIdx) => {
                              // Simulate custom weighting for a beautiful look: more intense toward bottom-right
                              const weight = Math.random();
                              let bgClass = "bg-slate-100";
                              if (weekIdx > 28) {
                                if (weight > 0.8) bgClass = "bg-blue-700";
                                else if (weight > 0.5) bgClass = "bg-blue-500";
                                else if (weight > 0.25) bgClass = "bg-blue-300";
                                else bgClass = "bg-blue-100";
                              } else if (weekIdx > 15) {
                                if (weight > 0.85) bgClass = "bg-blue-500";
                                else if (weight > 0.6) bgClass = "bg-blue-300";
                                else if (weight > 0.3) bgClass = "bg-blue-100";
                              } else {
                                if (weight > 0.95) bgClass = "bg-blue-300";
                                else if (weight > 0.85) bgClass = "bg-blue-100";
                              }

                              return (
                                <div 
                                  key={dayIdx} 
                                  className={`w-2.5 h-2.5 rounded-sm transition-colors ${bgClass}`} 
                                  title={`调用周数 ${weekIdx + 1}, 星期 ${dayIdx + 1}`}
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-2 font-mono text-center">
                        数据来源：Local Model Gateway Operations Tracker (2026年)
                      </p>
                    </div>
                  </div>

                  {/* ==========================================
                      MODEL CONFIGURATIONS FORM & LIST
                      ========================================== */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-50">
                      <h3 className="font-display font-semibold text-sm text-slate-800 flex items-center gap-2">
                        <Key className="w-4 h-4 text-slate-400" />
                        <span>大语言模型接入与密钥库 (LLM Gateways)</span>
                      </h3>
                      
                      <button 
                        onClick={() => setShowAddModelModal(true)}
                        className="px-2.5 py-1.5 border border-slate-200 hover:border-slate-350 text-slate-700 rounded-lg text-xs font-medium bg-white shadow-3xs transition-colors"
                      >
                        + 注册新模型
                      </button>
                    </div>

                    {/* New model inline configuration form */}
                    {showAddModelModal && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 border border-slate-200 bg-slate-50/50 rounded-xl space-y-4 max-w-lg text-xs"
                      >
                        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                          <span className="font-semibold text-slate-700">配置自定义兼容 API 节点</span>
                          <button onClick={() => setShowAddModelModal(false)} className="text-slate-400 hover:text-slate-600">
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <form onSubmit={handleAddNewModel} className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-medium text-slate-500 mb-1">模型商业名称</label>
                              <input 
                                type="text" 
                                required
                                placeholder="如: Claude 3.5 (专属中继)"
                                value={newModel.name}
                                onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
                                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-slate-500 mb-1">后端框架标准</label>
                              <select 
                                value={newModel.provider}
                                onChange={(e) => setNewModel({ ...newModel, provider: e.target.value as any })}
                                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden bg-white cursor-pointer"
                              >
                                <option value="OpenAI">OpenAI Compatible (兼容端点)</option>
                                <option value="DeepSeek">DeepSeek API</option>
                                <option value="Claude">Anthropic SDK</option>
                                <option value="Custom">其他自定义网关</option>
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">API 基准请求地址 (Base URL)</label>
                            <input 
                              type="text" 
                              placeholder="https://api.openai.com/v1"
                              value={newModel.baseUrl}
                              onChange={(e) => setNewModel({ ...newModel, baseUrl: e.target.value })}
                              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono focus:outline-hidden bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">自定义验证凭证 (API KEY)</label>
                            <input 
                              type="password" 
                              placeholder="sk-................................"
                              value={newModel.apiKey}
                              onChange={(e) => setNewModel({ ...newModel, apiKey: e.target.value })}
                              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono focus:outline-hidden bg-white"
                            />
                          </div>

                          <div className="flex justify-end gap-2 pt-2 border-t border-slate-150">
                            <button 
                              type="button" 
                              onClick={() => setShowAddModelModal(false)}
                              className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-medium"
                            >
                              取消
                            </button>
                            <button 
                              type="submit"
                              className="px-4 py-1 bg-slate-900 text-white rounded-lg font-medium shadow-2xs hover:bg-slate-800"
                            >
                              保存模型
                            </button>
                          </div>
                        </form>
                      </motion.div>
                    )}

                    {/* Model Configs Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {modelConfigs.map((config) => {
                        const testStatus = modelConnectionStatuses[config.id];
                        const isTesting = testingModelId === config.id;
                        
                        return (
                          <div 
                            key={config.id}
                            className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-3xs flex flex-col justify-between hover:shadow-2xs transition-shadow duration-200"
                          >
                            <div>
                              <div className="flex items-center justify-between mb-2.5">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-semibold text-xs text-slate-900">{config.name}</h4>
                                  <span className="px-1.5 py-0.2 text-[8px] font-bold uppercase rounded bg-slate-100 text-slate-500 font-mono">
                                    {config.provider}
                                  </span>
                                </div>

                                {/* Toggle switch config enable */}
                                <button 
                                  onClick={() => {
                                    setModelConfigs(prev => prev.map(m => m.id === config.id ? { ...m, enabled: !m.enabled } : m));
                                  }}
                                  className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                                    config.enabled ? "bg-slate-900" : "bg-slate-200"
                                  }`}
                                >
                                  <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                    config.enabled ? "translate-x-3" : "translate-x-0"
                                  }`} />
                                </button>
                              </div>

                              <div className="space-y-1 text-[10px] font-mono text-slate-500 mb-3">
                                <p className="truncate">端点: <span className="text-slate-600">{config.baseUrl}</span></p>
                                <p>密钥: <span className="text-slate-400">{config.apiKey ? "••••••••••••••••" : "（未注入）"}</span></p>
                              </div>

                              {/* Connection status badge/details */}
                              {testStatus && (
                                <div className={`p-2 rounded-lg text-[10px] leading-relaxed mb-3 font-sans border ${
                                  testStatus.status === "connected" 
                                    ? "bg-emerald-50 border-emerald-100 text-emerald-800" 
                                    : testStatus.status === "simulated"
                                    ? "bg-amber-50/50 border-amber-100 text-amber-800"
                                    : "bg-rose-50 border-rose-100 text-rose-800"
                                }`}>
                                  <div className="flex items-center gap-1.5 font-semibold">
                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                      testStatus.status === "connected" ? "bg-emerald-500 animate-pulse" :
                                      testStatus.status === "simulated" ? "bg-amber-500" : "bg-rose-500"
                                    }`} />
                                    <span>
                                      {testStatus.status === "connected" ? `已联通 (${testStatus.latency || "正常"})` :
                                       testStatus.status === "simulated" ? "本地仿真" : "离线 / 联通失败"}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-slate-500 font-mono text-[9px] leading-tight">{testStatus.message}</p>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center justify-between mt-1 pt-2.5 border-t border-slate-50">
                              <button 
                                onClick={() => handleTestModelConfig(config)}
                                disabled={isTesting}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded border text-[10px] font-medium transition-all ${
                                  isTesting 
                                    ? "bg-slate-50 text-slate-400 border-slate-200" 
                                    : testStatus?.status === "connected"
                                    ? "bg-emerald-50/50 hover:bg-emerald-50 text-emerald-700 border-emerald-200/50"
                                    : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200"
                                }`}
                              >
                                <RefreshCw className={`w-2.5 h-2.5 shrink-0 ${isTesting ? "animate-spin" : ""}`} />
                                <span>{isTesting ? "正在检测..." : "连通测试"}</span>
                              </button>

                              {config.isCustom && (
                                <button 
                                  onClick={() => handleDeleteModel(config.id)}
                                  className="text-[10px] text-red-500 hover:underline flex items-center gap-1 transition-all"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                  <span>卸载</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* API security hint */}
                    <div className="p-3.5 bg-amber-50/50 rounded-xl border border-amber-200/40 text-[11px] text-amber-800 leading-relaxed flex gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <strong>API 密钥与连接安全：</strong>
                        <p className="mt-0.5 text-slate-600">
                          本平台采用<strong>全栈双端安全架构</strong>，您在前端配置的所有供应商凭证将仅保存在浏览器本地加密层。在发送对话时，通过 `/api/chat` 进行安全服务器转发代理，绝不在客户端暴露密钥。
                        </p>
                      </div>
                    </div>
                  </div>

                </div>
              </motion.div>
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
            MODAL 1.5: SCHEDULE TASK VIEW DETAILS MODAL
            ======================================================== */}
        {viewingTask && (
          <motion.div 
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
                    <span>📌 {viewingTask.title}</span>
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                      viewingTask.enabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {viewingTask.enabled ? '已激活调度' : '暂停中'}
                    </span>
                  </h4>
                </div>

                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100 font-sans">
                  <div className="space-y-0.5">
                    <span className="text-slate-400 text-[10px]">🔄 触发频率</span>
                    <p className="text-slate-800 font-medium">
                      {viewingTask.scheduleType === 'daily' ? '每天一次' : viewingTask.scheduleType === 'weekly' ? '每周一次' : viewingTask.scheduleType === 'monthly' ? '每月一次' : '单次测试'}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-slate-400 text-[10px]">⏰ 设定时间</span>
                    <p className="text-slate-800 font-medium font-mono flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-indigo-500" />
                      {viewingTask.timeValue}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-slate-400 text-[10px]">📊 展现格式</span>
                    <p className="text-slate-800 font-semibold font-mono text-[10px] uppercase">
                      {viewingTask.displayFormat}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-slate-400 text-[10px]">📊 已自动执行</span>
                    <p className="text-slate-800 font-medium">
                      {viewingTask.runCount}次
                    </p>
                  </div>
                  <div className="space-y-0.5 col-span-2 border-t border-slate-200/50 pt-2 mt-1">
                    <span className="text-slate-400 text-[10px]">🟢 上次运行时间</span>
                    <p className="text-slate-700 font-mono text-[11px]">{viewingTask.lastRunTime || '暂无执行记录'}</p>
                  </div>
                  {viewingTask.enabled && viewingTask.nextRunTime && (
                    <div className="space-y-0.5 col-span-2">
                      <span className="text-emerald-600 font-semibold text-[10px]">🔵 下次预计执行时间</span>
                      <p className="text-emerald-700 font-semibold font-mono text-[11px]">{viewingTask.nextRunTime}</p>
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
                      <span>⚡ 立即测试运行</span>
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
                  <span className="text-[10px] text-slate-400 block">💡 提示：该任务运行时将自动读取已连接的 MCP 服务器工具以及您的个人记忆画像进行优化。</span>
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
                    className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-all shadow-2xs"
                  >
                    关闭结果预览
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Floating Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
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
