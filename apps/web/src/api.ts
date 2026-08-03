// API 层：fetch 封装（自动带 token、401 刷新重试）+ SSE 消费
import type { ChatRequestDto, MessageDto, SessionDetailDto, SessionDto, SkillDto, SSEChatEvent } from "@br-agent/shared";
import { getTokens, refreshAccessToken } from "./auth";

async function request(path: string, options: RequestInit = {}, retry = true): Promise<Response> {
  const { access } = getTokens();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  // 仅在有请求体时设置 JSON Content-Type，避免空 body（DELETE/POST）触发
  // Fastify 的 FST_ERR_CTP_EMPTY_JSON_BODY 400
  if (options.body != null) headers["Content-Type"] = "application/json";
  if (access) headers.Authorization = `Bearer ${access}`;

  const resp = await fetch(path, { ...options, headers });
  if (resp.status === 401 && retry) {
    const ok = await refreshAccessToken();
    if (ok) return request(path, options, false);
  }
  return resp;
}

async function json<T>(path: string, options: RequestInit = {}): Promise<T> {
  const resp = await request(path, options);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(body || `HTTP ${resp.status}`);
  }
  return resp.json();
}

export const api = {
  // 会话
  listSessions: () => json<SessionDto[]>("/api/sessions"),
  createSession: () =>
    json<SessionDto>("/api/sessions", { method: "POST", body: JSON.stringify({}) }),
  getSession: (id: string) => json<SessionDetailDto>(`/api/sessions/${id}`),
  renameSession: (id: string, title: string) =>
    json(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteSession: (id: string) => json(`/api/sessions/${id}`, { method: "DELETE" }),
  stop: (id: string) => json(`/api/sessions/${id}/stop`, { method: "POST" }),

  // 技能
  listSkills: () => json<SkillDto[]>("/api/skills"),
  uploadSkill: (zipBase64: string) =>
    json<SkillDto>("/api/skills/upload", {
      method: "POST",
      body: JSON.stringify({ zip: zipBase64 }),
    }),
  toggleSkill: (id: string, enabled: boolean) =>
    json(`/api/skills/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
  deleteSkill: (id: string) => json(`/api/skills/${id}`, { method: "DELETE" }),
};

/** 发送消息并消费 SSE 事件流 */
export async function chatStream(
  sessionId: string,
  content: string,
  onEvent: (evt: SSEChatEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const { access } = getTokens();
  const resp = await fetch(`/api/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
    body: JSON.stringify({ content } satisfies ChatRequestDto),
    signal,
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text();
    throw new Error(text || `HTTP ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 按 \n\n 切分 SSE 帧
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.trim().split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        try {
          const data = JSON.parse(line.slice(5).trim()) as SSEChatEvent;
          onEvent(data);
        } catch {
          /* 忽略解析失败的帧 */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
