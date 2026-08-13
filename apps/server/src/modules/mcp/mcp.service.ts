// MCP 服务器服务：列表/创建/连接测试/启停/删除 + 客户端缓存供对话注入工具
import { MultiServerMCPClient, type Connection } from "@langchain/mcp-adapters";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { randomUUID } from "node:crypto";
import { prisma } from "../../db/index.js";
import type { McpServerDto, McpTestResultDto, McpToolInfo } from "@br-agent/shared";

// type 归一化：常见写法 streamablehttp → http（适配器枚举 http | sse | stdio）
function normalizeType(t: string): string {
  const v = (t ?? "").trim().toLowerCase();
  if (v === "streamablehttp" || v === "http") return "http";
  if (v === "sse") return "sse";
  return "stdio";
}

interface ServerRow {
  id: string;
  name: string;
  type: string;
  url: string;
  command: string;
  args: unknown;
  headers: unknown;
  owner: string;
  enabled: boolean;
  createdAt: Date;
}

function rowToDto(s: ServerRow): McpServerDto {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    url: s.url,
    command: s.command,
    args: Array.isArray(s.args) ? (s.args as string[]) : [],
    headers: s.headers && typeof s.headers === "object" ? (s.headers as Record<string, string>) : {},
    owner: s.owner,
    enabled: s.enabled,
    createdAt: s.createdAt.toISOString(),
  };
}

/** McpServer 行 → 适配器 Connection */
function toConnection(s: ServerRow): Connection {
  if (s.type === "http" || s.type === "sse") {
    const conn: Connection = { type: s.type, url: s.url };
    const headers = s.headers && typeof s.headers === "object" ? (s.headers as Record<string, string>) : {};
    if (Object.keys(headers).length > 0) conn.headers = headers;
    return conn;
  }
  return {
    type: "stdio",
    command: s.command,
    args: Array.isArray(s.args) ? (s.args as string[]) : [],
  };
}

// ── 客户端缓存：同一用户启用服务器配置不变时复用连接，避免每次对话重连外部服务 ──
// 带 TTL：MCP 服务端重启（streamable-http session 失效）后能自动重建连接，避免缓存旧 session 持续报错
const MCP_CACHE_TTL_MS = 120_000;

interface McpClientEntry {
  signature: string;
  clients: MultiServerMCPClient[];
  tools: StructuredToolInterface[];
  createdAt: number;
}

const mcpClients = new Map<string, McpClientEntry>();

function serverSignature(servers: ServerRow[]): string {
  return JSON.stringify(
    servers.map((s) => ({
      id: s.id,
      type: s.type,
      url: s.url,
      command: s.command,
      args: Array.isArray(s.args) ? s.args : [],
      headers: s.headers && typeof s.headers === "object" ? s.headers : {},
    }))
  );
}

export function invalidateMcpClient(owner: string): void {
  const entry = mcpClients.get(owner);
  if (entry) {
    for (const c of entry.clients) c.close().catch(() => {});
    mcpClients.delete(owner);
  }
}

/** 判断错误是否属于「MCP 连接/会话失效」（服务端重启、连接被重置等），需要重建连接 */
function isConnectionError(e: unknown): boolean {
  const msg = (e as Error)?.message ?? "";
  return (
    msg.includes("Session not found") ||
    msg.includes("-32600") ||
    msg.includes("POSTing to endpoint") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("fetch failed") ||
    msg.includes("连接已关闭")
  );
}

/** 按服务器逐个加载 MCP 工具：单个服务器连接失败不影响其他（避免一个不可达导致全部 MCP 工具消失） */
async function getMcpClient(owner: string): Promise<{ clients: MultiServerMCPClient[]; tools: StructuredToolInterface[] } | null> {
  const servers = await prisma.mcpServer.findMany({
    where: { enabled: true, OR: [{ owner: "" }, { owner }] },
  });
  if (servers.length === 0) return null;
  const signature = serverSignature(servers);
  const cached = mcpClients.get(owner);
  if (cached && cached.signature === signature && Date.now() - cached.createdAt < MCP_CACHE_TTL_MS) {
    return cached;
  }
  if (cached) {
    for (const c of cached.clients) c.close().catch(() => {});
    mcpClients.delete(owner);
  }
  const clients: MultiServerMCPClient[] = [];
  const tools: StructuredToolInterface[] = [];
  for (const s of servers) {
    const client = new MultiServerMCPClient({ [s.name]: toConnection(s) });
    try {
      const t = await client.getTools();
      tools.push(...t);
      clients.push(client);
    } catch (e) {
      console.error(`[mcp] ${owner} 服务器 ${s.name} 加载失败:`, (e as Error).message);
      client.close().catch(() => {});
    }
  }
  mcpClients.set(owner, { signature, clients, tools, createdAt: Date.now() });
  return { clients, tools };
}

// ── 列表/创建 ──

export async function listMcpServers(owner: string): Promise<McpServerDto[]> {
  const rows = await prisma.mcpServer.findMany({
    where: { OR: [{ owner: "" }, { owner }] },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToDto);
}

function parseConfigJson(json: string): {
  name: string;
  type: string;
  url: string;
  command: string;
  args: string[];
  headers: Record<string, string>;
} {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("JSON 解析失败，请检查格式");
  }
  const servers =
    data && typeof data === "object" && "mcpServers" in data
      ? (data as { mcpServers: unknown }).mcpServers
      : data;
  if (!servers || typeof servers !== "object") {
    throw new Error("JSON 中未找到 mcpServers 配置");
  }
  const map = servers as Record<string, Record<string, unknown>>;
  const names = Object.keys(map);
  if (names.length === 0) throw new Error("JSON 中未配置任何服务器");
  const name = names[0];
  const s = map[name] ?? {};
  return {
    name,
    type: (typeof s.type === "string" && s.type) || (typeof s.command === "string" ? "stdio" : "http"),
    url: typeof s.url === "string" ? s.url : "",
    command: typeof s.command === "string" ? s.command : "",
    args: Array.isArray(s.args) ? (s.args as string[]) : [],
    headers: s.headers && typeof s.headers === "object" ? (s.headers as Record<string, string>) : {},
  };
}

export interface CreateMcpServerInput {
  configJson?: string;
  name?: string;
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
}

export async function createMcpServer(owner: string, input: CreateMcpServerInput): Promise<McpServerDto> {
  let name: string;
  let type: string;
  let url: string;
  let command: string;
  let args: string[];
  let headers: Record<string, string>;

  if (input.configJson) {
    const parsed = parseConfigJson(input.configJson);
    name = parsed.name;
    type = parsed.type;
    url = parsed.url;
    command = parsed.command;
    args = parsed.args;
    headers = parsed.headers;
  } else {
    name = input.name ?? "";
    type = input.type ?? "http";
    url = input.url ?? "";
    command = input.command ?? "";
    args = input.args ?? [];
    headers = input.headers ?? {};
  }

  const normType = normalizeType(type);
  if (!name.trim()) throw new Error("服务器名称不能为空");
  if ((normType === "http" || normType === "sse") && !url.trim()) {
    throw new Error("HTTP 服务器必须提供 url");
  }
  if (normType === "stdio" && !command.trim()) {
    throw new Error("stdio 服务器必须提供 command");
  }

  const row = await prisma.mcpServer.create({
    data: {
      id: randomUUID(),
      name: name.trim(),
      type: normType,
      url: url.trim(),
      command: command.trim(),
      args,
      headers,
      owner,
      enabled: true,
    },
  });
  return rowToDto(row);
}

// 编辑服务器：支持 configJson 整体覆盖或逐字段更新；私有仅本人、公共仅管理员
export async function updateMcpServer(
  id: string,
  owner: string,
  isAdmin: boolean,
  input: CreateMcpServerInput
): Promise<McpServerDto> {
  const row = await prisma.mcpServer.findFirst({ where: { id } });
  if (!row) throw new Error("服务器不存在");
  if (row.owner === "" && !isAdmin) {
    throw Object.assign(new Error("公共服务器仅管理员可修改"), { code: 403 });
  }
  if (row.owner !== "" && row.owner !== owner) {
    throw Object.assign(new Error("无权限修改该服务器"), { code: 403 });
  }

  let name = row.name;
  let type = row.type;
  let url = row.url;
  let command = row.command;
  let args: unknown = row.args;
  let headers: unknown = row.headers;

  if (input.configJson) {
    const parsed = parseConfigJson(input.configJson);
    name = parsed.name;
    type = parsed.type;
    url = parsed.url;
    command = parsed.command;
    args = parsed.args;
    headers = parsed.headers;
  } else {
    if (input.name !== undefined) name = input.name;
    if (input.type !== undefined) type = input.type;
    if (input.url !== undefined) url = input.url;
    if (input.command !== undefined) command = input.command;
    if (input.args !== undefined) args = input.args;
    if (input.headers !== undefined) headers = input.headers;
  }

  const normType = normalizeType(type);
  if (!String(name).trim()) throw new Error("服务器名称不能为空");
  if ((normType === "http" || normType === "sse") && !String(url).trim()) {
    throw new Error("HTTP 服务器必须提供 url");
  }
  if (normType === "stdio" && !String(command).trim()) {
    throw new Error("stdio 服务器必须提供 command");
  }

  const updated = await prisma.mcpServer.update({
    where: { id },
    data: {
      name: String(name).trim(),
      type: normType,
      url: String(url).trim(),
      command: String(command).trim(),
      args: Array.isArray(args) ? (args as string[]) : [],
      headers: headers && typeof headers === "object" ? (headers as Record<string, string>) : {},
    },
  });
  invalidateMcpClient(owner);
  return rowToDto(updated);
}

// ── 连接测试 ──

export async function testConnection(id: string, owner: string): Promise<McpTestResultDto> {
  const row = await prisma.mcpServer.findFirst({
    where: { id, OR: [{ owner: "" }, { owner }] },
  });
  if (!row) throw new Error("服务器不存在或无权限");
  const client = new MultiServerMCPClient({ [row.name]: toConnection(row) });
  try {
    const tools = await client.getTools();
    const infos: McpToolInfo[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: (t as unknown as { schema?: unknown }).schema,
    }));
    return { ok: true, tools: infos };
  } catch (e) {
    return { ok: false, tools: [], error: (e as Error).message };
  } finally {
    await client.close().catch(() => {});
  }
}

// ── 启停/删除 ──

export async function setMcpEnabled(id: string, owner: string, enabled: boolean): Promise<void> {
  await prisma.mcpServer.updateMany({
    where: { id, OR: [{ owner: "" }, { owner }] },
    data: { enabled },
  });
  invalidateMcpClient(owner);
}

export async function deleteMcpServer(id: string, owner: string): Promise<void> {
  const row = await prisma.mcpServer.findFirst({ where: { id, owner } });
  if (!row) throw new Error("服务器不存在或无权限");
  await prisma.mcpServer.delete({ where: { id } });
  invalidateMcpClient(owner);
}

// ── 供对话注入：返回当前用户启用的 MCP 工具 ──
// 容错：某服务器连接失败时降级返回 []（不阻断对话），错误写入日志
export async function getEnabledMcpTools(owner: string): Promise<StructuredToolInterface[]> {
  try {
    const r = await getMcpClient(owner);
    return r?.tools ?? [];
  } catch (e) {
    console.error(`[mcp] ${owner} 加载 MCP 工具失败:`, (e as Error).message);
    return [];
  }
}

/** 当前用户可用的 MCP 工具列表（供客户端本地 agent 注册工具） */
export async function listMcpTools(owner: string): Promise<Array<{ name: string; description: string; schema?: unknown }>> {
  const r = await getMcpClient(owner);
  if (!r) return [];
  return r.tools.map((t) => ({
    name: t.name,
    description: t.description,
    schema: (t as unknown as { schema?: unknown }).schema,
  }));
}

/** 执行 MCP 工具（客户端本地 agent 经服务器调用；复用服务器 MCP 连接，规避客户端无法直连外网/内网 MCP） */
export async function callMcpTool(owner: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const invokeOnce = async (): Promise<{ ok: boolean; value?: unknown; error?: string; connError?: boolean }> => {
    const r = await getMcpClient(owner);
    if (!r) return { ok: false, error: "没有可用的 MCP 工具" };
    const t = r.tools.find((tool) => tool.name === toolName);
    if (!t) return { ok: false, error: `MCP 工具 ${toolName} 不存在` };
    try {
      return { ok: true, value: await t.invoke(args) };
    } catch (e) {
      return { ok: false, error: (e as Error).message, connError: isConnectionError(e) };
    }
  };

  const first = await invokeOnce();
  if (first.ok) return first.value;
  // 会话/连接失效（如 MCP 服务端重启）：重建连接后重试一次
  if (first.connError) {
    invalidateMcpClient(owner);
    const retry = await invokeOnce();
    if (retry.ok) return retry.value;
    return { error: retry.error ?? `MCP 工具 ${toolName} 调用失败` };
  }
  return { error: first.error };
}
