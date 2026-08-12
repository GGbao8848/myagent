// 渲染进程 API 封装：经 window.electronAPI 代理到主进程（带 token + 401 刷新）
import type {
  LlmProviderDto,
  LlmProviderInput,
  LlmProviderListDto,
  McpServerDto,
  McpTestResultDto,
  SessionDetailDto,
  SessionDto,
  SkillDto,
} from "@br-agent/shared";

function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return window.electronAPI!.apiRequest<T>({ method, path, body });
}

export const api = {
  // 会话
  listSessions: () => request<SessionDto[]>("GET", "/api/sessions"),
  createSession: () => request<SessionDto>("POST", "/api/sessions", {}),
  getSession: (id: string) => request<SessionDetailDto>("GET", `/api/sessions/${id}`),
  renameSession: (id: string, title: string) => request<{ ok: boolean }>("PATCH", `/api/sessions/${id}`, { title }),
  deleteSession: (id: string) => request<{ ok: boolean }>("DELETE", `/api/sessions/${id}`),
  listTrashSessions: () => request<SessionDto[]>("GET", "/api/sessions/trash"),
  restoreSession: (id: string) => request<{ ok: boolean }>("POST", `/api/sessions/${id}/restore`, {}),
  batchRestoreSessions: (ids: string[]) => request<{ ok: boolean }>("POST", "/api/sessions/batch-restore", { ids }),
  batchDeleteSessions: (ids: string[]) => request<{ ok: boolean }>("DELETE", "/api/sessions/batch", { ids }),
  emptyTrash: () => request<{ ok: boolean }>("DELETE", "/api/sessions/trash"),

  // 技能
  listSkills: () => request<SkillDto[]>("GET", "/api/skills"),
  uploadSkill: (zipBase64: string, isPublic = false) =>
    request<SkillDto>("POST", "/api/skills/upload", { zip: zipBase64, public: isPublic }),
  toggleSkill: (id: string, enabled: boolean) =>
    request<{ ok: boolean }>("PATCH", `/api/skills/${id}`, { enabled }),
  deleteSkill: (id: string) => request<{ ok: boolean }>("DELETE", `/api/skills/${id}`),

  // MCP 服务器
  listMcpServers: () => request<McpServerDto[]>("GET", "/api/mcp/servers"),
  createMcpServer: (body: Record<string, unknown>) => request<McpServerDto>("POST", "/api/mcp/servers", body),
  updateMcpServer: (id: string, body: Record<string, unknown>) =>
    request<McpServerDto>("PATCH", `/api/mcp/servers/${id}`, body),
  testMcpServer: (id: string) => request<McpTestResultDto>("POST", `/api/mcp/servers/${id}/test`, {}),
  toggleMcpServer: (id: string, enabled: boolean) =>
    request<{ ok: boolean }>("POST", `/api/mcp/servers/${id}/toggle`, { enabled }),
  deleteMcpServer: (id: string) => request<{ ok: boolean }>("DELETE", `/api/mcp/servers/${id}`),

  // LLM Provider
  listLlmProviders: () => request<LlmProviderListDto>("GET", "/api/llm/providers"),
  createLlmProvider: (body: LlmProviderInput) => request<LlmProviderDto>("POST", "/api/llm/providers", body),
  updateLlmProvider: (id: string, body: Partial<LlmProviderInput>) =>
    request<LlmProviderDto>("PATCH", `/api/llm/providers/${id}`, body),
  deleteLlmProvider: (id: string) => request<{ ok: boolean }>("DELETE", `/api/llm/providers/${id}`),
  activateLlmProvider: (id: string) =>
    request<{ ok: boolean }>("POST", `/api/llm/providers/${id}/activate`, {}),
  resetLlmDefault: () => request<{ ok: boolean }>("POST", "/api/llm/providers/reset", {}),
  setGlobalDefault: (id: string) =>
    request<{ ok: boolean }>("POST", `/api/llm/providers/${id}/global-default`, {}),
  testLlmProvider: (id: string) =>
    request<{ ok: boolean; error?: string }>("POST", `/api/llm/providers/${id}/test`, {}),
};

// 本地 agent 对话（agent 在主进程跑，事件经 onAgentEvent 回传渲染）
export function startLocalChat(
  sessionId: string,
  content: string,
  securityMode = "auto"
): Promise<{ ok: boolean; error?: string }> {
  return window.electronAPI!.chat(sessionId, content, securityMode);
}

export function stopLocalChat(sessionId: string): Promise<{ ok: boolean }> {
  return window.electronAPI!.stop(sessionId);
}
