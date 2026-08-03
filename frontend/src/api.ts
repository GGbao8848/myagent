// API 请求封装：自动携带 Bearer token
import { getAccessToken, refreshToken } from "./auth";

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  let token = getAccessToken();

  if (!token) {
    // 无 token，尝试刷新
    const ok = await refreshToken();
    if (ok) token = getAccessToken();
  }

  if (!token) {
    throw new Error("未登录或登录已过期");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  const resp = await fetch(url, { ...options, headers });

  // token 过期 → 尝试刷新后重试一次
  if (resp.status === 401) {
    const refreshed = await refreshToken();
    if (refreshed) {
      const newToken = getAccessToken()!;
      const retryHeaders = new Headers(options.headers || {});
      retryHeaders.set("Authorization", `Bearer ${newToken}`);
      return fetch(url, { ...options, headers: retryHeaders });
    }
    // 刷新失败 → 跳转登录
    window.location.href = "/";
    throw new Error("登录已过期，请重新登录");
  }

  return resp;
}

// ── 会话 API ──

export interface SessionSummary {
  id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  last_message: string | null;
}

// ── 设置 / LLM Provider ──

export interface LLMProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxContextTokens?: number;
}

export interface SettingsData {
  llmProviders: LLMProvider[];
  activeProviderId: string;
  [key: string]: unknown;
}

export async function getSettings(): Promise<SettingsData> {
  const resp = await apiFetch("/api/settings");
  if (!resp.ok) throw new Error("获取设置失败");
  return resp.json();
}

// ── 技能 ──

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  disabled: boolean;
  is_custom?: boolean;
  owner?: string;
}

export async function listSkills(showAll = false): Promise<SkillInfo[]> {
  const resp = await apiFetch(`/api/skills?show_all=${showAll}`);
  if (!resp.ok) throw new Error("获取技能失败");
  return resp.json();
}

export async function uploadSkill(file: File): Promise<{ skill_id: string; skill: SkillInfo }> {
  const form = new FormData();
  form.append("file", file);
  const resp = await apiFetch("/api/skills/upload", {
    method: "POST",
    body: form,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(err || "上传技能失败");
  }
  return resp.json();
}

export async function toggleSkill(id: string, disabled: boolean): Promise<SkillInfo> {
  const resp = await apiFetch(`/api/skills/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ disabled }),
  });
  if (!resp.ok) throw new Error("切换技能失败");
  return resp.json();
}

export async function deleteSkillApi(id: string): Promise<void> {
  const resp = await apiFetch(`/api/skills/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error("删除技能失败");
}

// ── MCP 服务器 ──

export interface MCPServerInfo {
  id: string;
  name: string;
  type: string;
  url: string;
  enabled: boolean;
  connected: boolean;
  tool_count: number;
  tools: Array<{ name: string; description: string; parameters?: string[] }>;
  error: string;
}

export async function listMcpServers(): Promise<MCPServerInfo[]> {
  const resp = await apiFetch("/api/mcp/servers");
  if (!resp.ok) throw new Error("获取 MCP 服务器失败");
  return resp.json();
}

export async function addMcpServer(data: {
  id?: string;
  name?: string;
  type?: string;
  url?: string;
  config_json?: string;
}): Promise<MCPServerInfo[]> {
  const resp = await apiFetch("/api/mcp/servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(err || "添加 MCP 服务器失败");
  }
  return resp.json();
}

export async function deleteMcpServer(id: string): Promise<void> {
  const resp = await apiFetch(`/api/mcp/servers/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error("删除 MCP 服务器失败");
}

export async function toggleMcpServer(id: string): Promise<MCPServerInfo> {
  const resp = await apiFetch(`/api/mcp/servers/${id}/toggle`, { method: "POST" });
  if (!resp.ok) throw new Error("切换 MCP 服务器失败");
  return resp.json();
}

export interface MCPTestResult {
  server_id: string;
  connected: boolean;
  tools: Array<{ name: string; description: string; parameters?: string[] }>;
  tool_count: number;
  error: string;
}

export async function testMcpServer(id: string): Promise<MCPTestResult> {
  const resp = await apiFetch(`/api/mcp/servers/${id}/test`, { method: "POST" });
  if (!resp.ok) throw new Error("测试 MCP 服务器失败");
  return resp.json();
}

export interface MessageItem {
  id: number;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface SessionDetail extends SessionSummary {
  messages: MessageItem[];
}

export async function listSessions(): Promise<SessionSummary[]> {
  const resp = await apiFetch("/api/sessions");
  if (!resp.ok) throw new Error("获取会话列表失败");
  return resp.json();
}

export async function createSession(title?: string): Promise<SessionDetail> {
  const resp = await apiFetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!resp.ok) throw new Error("创建会话失败");
  return resp.json();
}

export async function getSession(id: string): Promise<SessionDetail> {
  const resp = await apiFetch(`/api/sessions/${id}`);
  if (!resp.ok) throw new Error("获取会话失败");
  return resp.json();
}

export async function deleteSession(id: string): Promise<void> {
  const resp = await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error("删除会话失败");
}

export async function updateSessionTitle(id: string, title: string): Promise<void> {
  const resp = await apiFetch(`/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!resp.ok) throw new Error("更新会话标题失败");
}

// ── SSE 对话：解析流式事件 ──

export type SSEEvent =
  | { event: "thinking"; content: string }
  | { event: "tool_call"; tool_name: string; args: string }
  | { event: "tool_result"; tool_name: string; content: string }
  | { event: "done"; message_id?: number; cancelled?: boolean }
  | { event: "error"; content: string }
  | { event: "context_usage"; used_tokens?: number; max_tokens?: number };

export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (evt: SSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getAccessToken();
  if (!token) throw new Error("未登录或登录已过期");

  const resp = await fetch(`/api/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(err || "对话请求失败");
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error("无法读取响应流");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // 按 \n\n 拆分 SSE 消息
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const lines = raw.split("\n").filter((l) => l.startsWith("data: "));
      for (const line of lines) {
        const payload = line.slice(6);
        try {
          const evt = JSON.parse(payload) as SSEEvent;
          onEvent(evt);
        } catch { /* 忽略无法解析的事件 */ }
      }
    }
  }
}
