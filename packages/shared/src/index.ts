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

// ── SSE 事件（POST /api/sessions/:id/chat 响应流）──
export type SSEChatEvent =
  | { event: "thinking"; content: string }
  | { event: "content"; content: string }
  | { event: "tool_call"; tool_name: string; args: Record<string, unknown>; id: string }
  | { event: "tool_result"; tool_name: string; content: string; is_error?: boolean }
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
  maxTokens: number;
  createdAt: string;
}

export interface LlmProviderListDto {
  providers: LlmProviderDto[];
  activeProviderId: string | null; // null = 使用 env 内置模型
}

export interface LlmProviderInput {
  name: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  public?: boolean;
  maxTokens?: number;
}

export interface ChatRequestDto {
  content: string;
}

export interface ChatResponse {
  messageId: number;
}
