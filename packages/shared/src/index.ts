// 共享类型：SSE 事件、timeline、API DTO

/** assistant 消息的执行轨迹（按执行顺序交错） */
export interface TimelineThinking {
  type: "thinking";
  content: string;
}

export interface TimelineToolCall {
  type: "tool_call";
  name: string;
  args: Record<string, unknown>;
  id: string;
}

export interface TimelineToolResult {
  type: "tool_result";
  name: string;
  content: string;
  isError?: boolean;
}

export type TimelineEntry = TimelineThinking | TimelineToolCall | TimelineToolResult;

// ── 表单式交互（智能体输出可编辑表单，用户核对提交）──
export interface FormFieldOption {
  label: string;
  value: string;
}

export type FormField =
  | { key: string; label: string; type: "text"; value?: string; placeholder?: string; required?: boolean }
  | { key: string; label: string; type: "number"; value?: string; placeholder?: string; required?: boolean }
  | { key: string; label: string; type: "textarea"; value?: string; placeholder?: string; required?: boolean }
  | { key: string; label: string; type: "select"; options: FormFieldOption[]; value?: string; required?: boolean; placeholder?: string };

export interface FormDto {
  id: string; // 表单标识（提交时回传），如 "report"
  title: string;
  description?: string;
  submitLabel?: string;
  // 表格模式（横向表头 + 多行 + 列联动），与 fields 二选一
  columns?: FormColumn[];
  rows?: Array<Record<string, string>>;
  addRowLabel?: string;
  // 垂直字段模式（兼容）
  fields?: FormField[];
}

/** 表格模式的一列（表头横向），支持父列联动（如 工作类别 → 项目 → 任务） */
export interface FormColumn {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: FormFieldOption[]; // 静态选项（无联动时）
  dependsOn?: string[]; // 联动父列 key；options 的 key = 非空父列值用 "|" 拼接（如 "项目工时|PID-A"）
  optionsBy?: Record<string, FormFieldOption[]>; // 拼接 key → 本列选项
}

// ── API DTO ──
export interface SessionDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDto {
  id: number;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string | null;
  timeline?: TimelineEntry[] | null;
  form?: FormDto | null; // 表单卡片（assistant 消息附带，刷新后重新渲染）
  createdAt: string;
}

export interface SessionDetailDto extends SessionDto {
  messages: MessageDto[];
}

export interface SkillDto {
  id: string;
  name: string;
  description: string;
  category: string;
  owner: string;
  enabled: boolean;
  isCustom: boolean;
  scripts: string[]; // skill 的 scripts 目录下可执行脚本（供客户端注册工具）
  createdAt: string;
}

// ── MCP 服务器 ──
export interface McpServerDto {
  id: string;
  name: string;
  type: string; // "http" | "stdio"
  url: string;
  command: string;
  args: string[];
  headers: Record<string, string>;
  owner: string;
  enabled: boolean;
  createdAt: string;
}

export interface McpToolInfo {
  name: string;
  description: string;
  schema?: unknown;
}

export interface McpTestResultDto {
  ok: boolean;
  tools: McpToolInfo[];
  error?: string;
}

// ── LLM Provider ──
export interface LlmProviderDto {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKeyMasked: string; // 脱敏展示，如 "sk-***abc"
  owner: string; // 公共=""，私有=userId
  isGlobalDefault: boolean; // 是否公共全局默认
  maxTokens: number;
  createdAt: string;
}

export interface LlmProviderListDto {
  providers: LlmProviderDto[];
  activeProviderId: string | null; // 用户私有默认
  globalDefaultId: string | null; // 公共全局默认
}

export interface LlmProviderInput {
  name: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  public?: boolean;
  maxTokens?: number;
}

// ── 桌面客户端（C/S）本机能力网关 ──
// Electron 主进程在用户本机加载 MCP/内置工具，经 WebSocket 注册到后端供 agent 调用；
// 渲染进程（远程 web）通过 window.desktopAPI 与主进程桥接。

export interface DesktopMcpServerEntry {
  name: string;
  type: "stdio" | "http" | "sse";
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface DesktopMcpConfig {
  servers: DesktopMcpServerEntry[];
}

export interface DesktopStatus {
  connected: boolean; // WS 是否已连上后端
  serverUrl: string;
  toolsCount: number; // 已注册的本机工具数
  mcpServers: DesktopMcpServerEntry[];
}

export interface DesktopReloadResult {
  toolsCount: number;
  errors: string[];
}

/** 客户端本地设置（服务器地址等） */
export interface DesktopSettings {
  serverUrl?: string; // 如 http://192.168.1.100:9005
}

/** preload 暴露到 window.desktopAPI 的桥接口（纯浏览器环境不存在） */
export interface DesktopAPI {
  syncToken(accessToken: string, refreshToken: string): Promise<{ ok: boolean }>;
  getStatus(): Promise<DesktopStatus>;
  getMcpConfig(): Promise<DesktopMcpConfig>;
  updateMcpConfig(config: DesktopMcpConfig): Promise<DesktopReloadResult>;
  reloadMcp(): Promise<DesktopReloadResult>;
  getSettings(): Promise<DesktopSettings>;
  saveSettings(settings: DesktopSettings): Promise<{ ok: boolean; error?: string }>;
}
