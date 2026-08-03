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
const mcpClients = new Map<string, { signature: string; client: MultiServerMCPClient }>();

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
    entry.client.close().catch(() => {});
    mcpClients.delete(owner);
  }
}

async function getMcpClient(owner: string): Promise<MultiServerMCPClient | null> {
  const servers = await prisma.mcpServer.findMany({
    where: { enabled: true, OR: [{ owner: "" }, { owner }] },
  });
  if (servers.length === 0) return null;
  const signature = serverSignature(servers);
  const cached = mcpClients.get(owner);
  if (cached && cached.signature === signature) return cached.client;
  if (cached) {
    cached.client.close().catch(() => {});
    mcpClients.delete(owner);
  }
  const config: Record<string, Connection> = {};
  for (const s of servers) config[s.name] = toConnection(s);
  const client = new MultiServerMCPClient(config);
  try {
    await client.getTools(); // 预加载工具，连接失败在此抛错
  } catch (e) {
    client.close().catch(() => {});
    throw e;
  }
  mcpClients.set(owner, { signature, client });
  return client;
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
    const client = await getMcpClient(owner);
    if (!client) return [];
    return await client.getTools();
  } catch (e) {
    console.error(`[mcp] ${owner} 加载 MCP 工具失败:`, (e as Error).message);
    return [];
  }
}
