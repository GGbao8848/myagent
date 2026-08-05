// API 层：fetch 封装（自动带 token、401 刷新重试）+ SSE 消费
import type { ChatRequestDto, LlmProviderDto, LlmProviderInput, LlmProviderListDto, McpServerDto, McpTestResultDto, MessageDto, ProfileObservationDto, SessionDetailDto, SessionDto, SkillDto, SSEChatEvent } from "@br-agent/shared";
import { getTokens, refreshAccessToken, handleSessionExpired } from "./auth";

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
    // 刷新失败：会话已过期，清 token 并切回登录页
    handleSessionExpired();
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

  // 会话回收站
  listTrashSessions: () => json<SessionDto[]>("/api/sessions/trash"),
  restoreSession: (id: string) =>
    json(`/api/sessions/${id}/restore`, { method: "POST", body: JSON.stringify({}) }),
  batchRestoreSessions: (ids: string[]) =>
    json("/api/sessions/batch-restore", { method: "POST", body: JSON.stringify({ ids }) }),
  batchDeleteSessions: (ids: string[]) =>
    json("/api/sessions/batch", { method: "DELETE", body: JSON.stringify({ ids }) }),
  emptyTrash: () => json("/api/sessions/trash", { method: "DELETE" }),

  // 技能
  listSkills: () => json<SkillDto[]>("/api/skills"),
  uploadSkill: (zipBase64: string, isPublic: boolean = false) =>
    json<SkillDto>("/api/skills/upload", {
      method: "POST",
      body: JSON.stringify({ zip: zipBase64, public: isPublic }),
    }),
  toggleSkill: (id: string, enabled: boolean) =>
    json(`/api/skills/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
  deleteSkill: (id: string) => json(`/api/skills/${id}`, { method: "DELETE" }),

  // MCP 服务器
  listMcpServers: () => json<McpServerDto[]>("/api/mcp/servers"),
  createMcpServer: (body: Record<string, unknown>) =>
    json<McpServerDto>("/api/mcp/servers", { method: "POST", body: JSON.stringify(body) }),
  testMcpServer: (id: string) =>
    json<McpTestResultDto>(`/api/mcp/servers/${id}/test`, { method: "POST", body: JSON.stringify({}) }),
  toggleMcpServer: (id: string, enabled: boolean) =>
    json(`/api/mcp/servers/${id}/toggle`, { method: "POST", body: JSON.stringify({ enabled }) }),
  deleteMcpServer: (id: string) => json(`/api/mcp/servers/${id}`, { method: "DELETE" }),

  // LLM Provider
  listLlmProviders: () => json<LlmProviderListDto>("/api/llm/providers"),
  createLlmProvider: (body: LlmProviderInput) =>
    json<LlmProviderDto>("/api/llm/providers", { method: "POST", body: JSON.stringify(body) }),
  updateLlmProvider: (id: string, body: Partial<LlmProviderInput>) =>
    json<LlmProviderDto>(`/api/llm/providers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteLlmProvider: (id: string) => json(`/api/llm/providers/${id}`, { method: "DELETE" }),
  activateLlmProvider: (id: string) =>
    json(`/api/llm/providers/${id}/activate`, { method: "POST", body: JSON.stringify({}) }),
  resetLlmDefault: () =>
    json(`/api/llm/providers/reset`, { method: "POST", body: JSON.stringify({}) }),
  setGlobalDefault: (id: string) =>
    json(`/api/llm/providers/${id}/global-default`, { method: "POST", body: JSON.stringify({}) }),
  testLlmProvider: (id: string) =>
    json<{ ok: boolean; error?: string }>(`/api/llm/providers/${id}/test`, { method: "POST", body: JSON.stringify({}) }),

  // 记忆画像
  listProfileObservations: () => json<ProfileObservationDto[]>("/api/profile/observations"),
  createProfileObservation: (content: string) =>
    json<ProfileObservationDto>("/api/profile/observations", { method: "POST", body: JSON.stringify({ content }) }),
  updateProfileObservation: (id: string, patch: { content?: string; confidence?: number; enabled?: boolean }) =>
    json<ProfileObservationDto>(`/api/profile/observations/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteProfileObservation: (id: string) => json(`/api/profile/observations/${id}`, { method: "DELETE" }),
};

/** 发送消息并消费 SSE 事件流（401 时刷新 token 重试一次，与普通 API 请求一致） */
export async function chatStream(
  sessionId: string,
  content: string,
  onEvent: (evt: SSEChatEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const doStream = async (): Promise<void> => {
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
  };

  try {
    await doStream();
  } catch (e) {
    // 401：token 过期，刷新后重试一次
    if ((e as Error).message.includes("401") || String((e as Error).message).includes("未授权")) {
      const ok = await refreshAccessToken();
      if (ok) {
        await doStream();
        return;
      }
      // 刷新失败：会话已过期，清 token 并切回登录页
      handleSessionExpired();
    }
    throw e;
  }
}
