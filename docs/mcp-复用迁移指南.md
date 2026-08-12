# MCP 系统复用/迁移指南

> 本指南说明 BR-Agent 的 MCP（Model Context Protocol）集成方式，供希望复用/迁移该系统的同事参考。核心代码在 `apps/server/src/modules/mcp/`。

## 一、MCP 系统在做什么

BR-Agent 把第三方 MCP 服务器（stdio / HTTP / SSE）连接能力集成进 AI Agent：

- 用户（或管理员）在「MCP 连接」页配置 MCP 服务器
- 配置存 PostgreSQL，按用户隔离（`owner` 字段）
- Agent 对话时，自动加载当前用户启用的 MCP 工具，供 LLM 调用

## 二、核心架构

```
McpServer 表（PostgreSQL，owner 隔离）
   ↓ 查询启用的
getMcpClient(owner)          ← mcp.service.ts
   ↓ @langchain/mcp-adapters 的 MultiServerMCPClient
getEnabledMcpTools(owner)    ← 返回 StructuredToolInterface[]
   ↓
createAgentTools(userId)     ← tool-manager.ts：内置工具 + MCP 工具 → 注入 agent
```

关键依赖：`@langchain/mcp-adapters`（加载 MCP 并转成 langchain 工具）、`zod`、Prisma（PostgreSQL）。

## 三、McpServer 表结构

| 字段 | 说明 |
|---|---|
| `id` | UUID |
| `name` | 服务器名称（唯一标识） |
| `type` | `http`（streamablehttp）/ `sse` / `stdio` |
| `url` | HTTP/SSE 的端点地址 |
| `command` | stdio 的可执行命令（如 `npx`、`python`） |
| `args` | stdio 命令参数（JSON 数组） |
| `headers` | 请求头（JSON，如 Authorization） |
| `owner` | `""`=公共（所有用户可见），否则=私有 userId |
| `enabled` | 是否启用 |

查询统一：`WHERE enabled = true AND (owner = '' OR owner = <当前用户>)`。

## 四、配置 MCP 服务器（API）

### 添加（表单字段或粘贴 JSON）

```
POST /api/mcp/servers
```

**表单方式**（body）：
```json
{
  "name": "my-server",
  "type": "streamablehttp",
  "url": "https://example.com/mcp",
  "headers": { "Authorization": "Bearer xxx" }
}
```

**粘贴 JSON 方式**（body.configJson，兼容 Claude Desktop 格式）：
```json
{
  "configJson": "{\"mcpServers\":{\"my-server\":{\"type\":\"streamablehttp\",\"url\":\"https://example.com/mcp\"}}}"
}
```

> 注意：`type` 归一化——`streamablehttp`/`http` → `http`；`sse` → `sse`；其余 → `stdio`。HTTP/SSE 必须有 `url`；stdio 必须有 `command`。

### 其他端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mcp/servers` | 列表（公共 + 当前用户私有） |
| PATCH | `/api/mcp/servers/:id` | 编辑 |
| POST | `/api/mcp/servers/:id/test` | 连接测试，返回工具列表 |
| POST | `/api/mcp/servers/:id/toggle` | 启停 `{ enabled: bool }` |
| DELETE | `/api/mcp/servers/:id` | 删除（仅自己的私有） |
| **GET** | `/api/mcp/tools` | 当前用户可用的 MCP 工具列表（供桌面客户端注册） |
| **POST** | `/api/mcp/tools/call` | 执行 MCP 工具 `{ toolName, args }`（桌面客户端经服务器调用） |

## 五、Agent 工具注入

`apps/server/src/agent/tool-manager.ts`：

```ts
export async function createAgentTools(userId: string) {
  const builtin = createBuiltinTools();
  const mcpTools = await getEnabledMcpTools(userId);  // 当前用户启用的 MCP 工具
  return [...builtin, ...mcpTools];
}
```

对话时 `createAgentTools(user.username)` → `runAgent({ tools, ... })` → LLM 可调用 MCP 工具。

## 六、容错设计（重要）

`getMcpClient` **按服务器逐个加载**：某一个 MCP 服务器连接失败（如地址不可达、服务下线），**只跳过该服务器**，不影响其他可用 MCP 工具（不会导致全部 MCP 工具消失）。加载失败会 `console.error` 记录。

## 七、桌面客户端（C/S）接入

桌面客户端（Electron，本地 agent）不直接连外网/内网 MCP，而是**经服务器执行**：
- 客户端拉 `GET /api/mcp/tools` → 注册为 `mcp_<工具名>` 工具
- 调用时 `POST /api/mcp/tools/call` → 服务器用已有的 MCP 连接执行 → 返回结果

这样客户端无需直连第三方 MCP（规避外网/局域网限制、凭据集中管理）。

## 八、快速迁移步骤（复用该 MCP 系统）

1. **建表**：复制 `McpServer` 模型到你的 Prisma schema，`npx prisma db push`
2. **装依赖**：`@langchain/mcp-adapters`（+ `@langchain/core`、`zod`）
3. **复制模块**：`apps/server/src/modules/mcp/`（service + routes）整体复制，注册路由
4. **接入 agent**：复制 `getEnabledMcpTools` 逻辑，在 `createAgentTools` 合并 MCP 工具
5. **配置管理界面**：可用前端 `McpView.tsx` 或直接调 API
6. **认证**：所有 API 走你的认证中间件（本仓库用 JWT，`request.authUser.username` 做 owner 隔离）

## 九、注意事项

- **stdio 型 MCP 在服务器进程内 spawn**：需要服务器有对应运行时（如 `npx`、`python`）
- **HTTP 认证**：需要在 `headers` 配 token 的 MCP，务必填对（如 `Authorization: Bearer xxx`）
- **owner 隔离**：公共（`owner=""`）所有用户可见可用；私有仅本人
- **工具名冲突**：多个 MCP 服务器的工具重名时，后加载的会覆盖同名工具（`@langchain/mcp-adapters` 行为）
- **MCP 服务可达性**：服务器要能访问到 MCP 的 URL（外网 MCP 需外网、内网 MCP 需内网可达）

## 十、常见问题

| 现象 | 原因/解决 |
|---|---|
| 连接测试失败 | MCP 服务不可达 / headers 认证错误 / 需要 `Accept: application/json, text/event-stream`（streamablehttp 协议要求） |
| 对话中 MCP 工具不出现 | 服务器未启用（`enabled=false`）、MCP 连接失败被跳过（见日志 `[mcp] ... 加载失败`）、owner 不是当前用户 |
| streamablehttp 无法连接 | 确认 URL 是 `/mcp` 端点、服务在运行；本机 `127.0.0.1` 指服务器自身而非用户电脑 |
