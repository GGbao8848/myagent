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
  fields: FormField[];
  submitLabel?: string;
}

// ── SSE 事件（POST /api/sessions/:id/chat 响应流）──
export type SSEChatEvent =
  | { event: "thinking"; content: string }
  | { event: "content"; content: string }
  | { event: "tool_call"; tool_name: string; args: Record<string, unknown>; id: string }
  | { event: "tool_result"; tool_name: string; content: string; is_error?: boolean }
  | { event: "form"; form: FormDto }
  | { event: "done"; message_id: number }
  | { event: "error"; content: string };

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

// ── 记忆画像 ──
export interface ProfileObservationDto {
  id: string;
  content: string;
  confidence: number;
  source: string; // explicit=手动 / auto=对话提取
  enabled: boolean;
  seenCount: number;
  createdAt: string;
  lastSeenAt: string;
}

export interface ChatRequestDto {
  content: string;
}

export interface ChatResponse {
  messageId: number;
}
