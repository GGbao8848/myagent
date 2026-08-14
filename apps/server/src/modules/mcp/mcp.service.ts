// MCP 服务器服务（CS 模式）：纯配置管理——列表/创建/编辑/启停/删除/连接测试。
// MCP 连接由桌面客户端本地建立（直连），服务端不再维护连接池/代理执行。
import { MultiServerMCPClient, type Connection } from "@langchain/mcp-adapters";
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

/** McpServer 行 → 适配器 Connection（客户端本地直连用同一结构） */
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
  return rowToDto(updated);
}

// ── 连接测试（一次性连接，供管理页验证可达性）──

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
}

export async function deleteMcpServer(id: string, owner: string): Promise<void> {
  const row = await prisma.mcpServer.findFirst({ where: { id, owner } });
  if (!row) throw new Error("服务器不存在或无权限");
  await prisma.mcpServer.delete({ where: { id } });
}
