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

export interface ChatRequestDto {
  content: string;
}

export interface ChatResponse {
  messageId: number;
}
