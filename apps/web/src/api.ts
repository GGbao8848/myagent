// API 层：fetch 封装（自动带 token、401 刷新重试）
import type { LlmProviderDto, LlmProviderInput, LlmProviderListDto, McpServerDto, McpTestResultDto, SessionDetailDto, SessionDto, SkillDto } from "@br-agent/shared";
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
  updateMcpServer: (id: string, body: Record<string, unknown>) =>
    json<McpServerDto>(`/api/mcp/servers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
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
};
