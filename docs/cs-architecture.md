# CS 架构说明（cs-only 分支）

> 本分支从 main 拉出：**服务端清除 agent**（推理/对话/工具注入全部移除），服务端仅承担**数据服务 + MCP 配置管理 + 认证/单点登出**；**桌面客户端是完整的 agent**（LLM 调用、ReAct 循环、技能脚本执行、**MCP 本地直连**全部在客户端），且**保持现状、不增删任何工具**；**web 应用已整体移除**（纯 C/S：桌面客户端直连后端 9004）。
>
> 更新：2026-08-14

## 架构定位

```
┌─ 桌面客户端（Electron）───────────────┐     ┌─ BR-Agent Server ──────────────┐
│  agent 核心（本地）                    │     │  仅数据服务（无 agent）          │
│  ├─ LLM 直连 provider（active-key）    │     │  ├─ 会话/消息 CRUD（共享数据）   │
│  ├─ ReAct 循环（runner）               │     │  ├─ 技能 列表/上传/下载/启停      │
│  ├─ skill_* 本地脚本执行               │     │  ├─ MCP 配置下发（servers CRUD） │
│  ├─ mcp_*（本地直连 MCP）              │     │  ├─ LLM Provider CRUD + 配置下发 │
│  │   └─ aimemory / agent-runtime 等    │     │  ├─ Keycloak 认证（jwt 校验）    │
│  └─ 本机操作 mcp_local_*（agent-runtime）│    │  ├─ SLO：/api/auth/kc-logout     │
│  （能力：推理+工具编排+连接，全部本地）   │     │       + /api/sse/logout + WS     │
└───────────────┬───────────────────────┘     └─────────────────────────────┘
                │ 经 REST/WS（Bearer token）
                └──────────────────────────────▶
```

- **agent 不在服务器上跑**：`/api/sessions/:id/chat`（服务端 SSE 对话）已删除，服务端没有任何 LLM 推理、工具注入、ReAct 循环。
- **桌面客户端保持现状（工具不增删）**：工具链 = `skill_*`（本地脚本）+ `mcp_*`（**本地直连 MCP**）+ `mcp_local_*`（agent-runtime 本机执行）。
- **MCP 本地直连**：客户端拉取服务端 `GET /api/mcp/servers` 配置 → 本机 `MultiServerMCPClient` 建连执行（aimemory 记忆、agent-runtime 本机操作等）。服务端不再维护连接池/代理执行（`/api/mcp/tools`、`/api/mcp/tools/call` 已删）。
- **web 已整体移除**：桌面客户端直连后端 `http://<host>:9004`（`DEFAULT_SERVER_URL` / `default-settings.json` / `parseServerUrl` 均指向 9004），无 web 代理层。

## 服务端删除清单

| 项 | 说明 |
|---|---|
| `apps/server/src/agent/` | 整个删除：runner / factory / tool-manager / tools / sandbox |
| `apps/server/src/modules/chat/` | 整个删除：`/api/sessions/:id/chat`（SSE 对话）、`/stop`、`extractFormFromScript` |
| `apps/server/src/scripts/` | 删除诊断脚本（diag_* / smoke，依赖 agent 模块） |
| `skills.service.ts` | 删 `executeSkill`、`buildSkillPromptAsync`、对 `agent/tools.js` 的依赖 |
| `skills.routes.ts` | 删 `POST /api/skills/:id/run`（服务端执行技能，客户端已本地执行） |
| `mcp.service.ts` | 删 `getEnabledMcpTools`、`listMcpTools`、`callMcpTool`、连接缓存栈（mcpClients/getMcpClient/isConnectionError/invalidateMcpClient）；保留 servers CRUD + test |
| `mcp.routes.ts` | 删 `GET /api/mcp/tools`、`POST /api/mcp/tools/call`；保留 `/api/mcp/servers` CRUD + `/test` + `/toggle` |
| `client-gateway/` | 删 `tool-adapter.ts`、`registry.ts` 的 `getClientToolsForUser` |
| `index.ts` | 移除 `registerChatRoutes` 注册 |
| `apps/web/` | **整个应用移除**（含 DialogueView、管理页、chatStream） |
| `ecosystem.config.js` | 移除 `br-agent-web` 进程（PM2 只剩 server） |
| `packages/shared` | 删 `SSEChatEvent`、`ChatRequestDto`、`ChatResponse`、`DesktopAPI/DesktopMcp*` 桥类型（保留 `DesktopSettings`） |
| `apps/desktop/src/renderer/index.d.ts` | 删 `window.desktopAPI` 全局类型（web 嵌入桌面时代的残留） |

## 桌面端连接调整（CS 直连后端）

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/main/store.ts` | `DEFAULT_SERVER_URL = http://10.1.20.132:9004`（原 9005） |
| `apps/desktop/resources/default-settings.json` | `serverUrl: http://10.1.20.132:9004` |
| `apps/desktop/src/main/url.ts` | `parseServerUrl` 默认端口 9005→9004（直连后端，不再经 web 代理） |

Keycloak：`br-agent` client 清除 `frontchannel.logout.url`（指向已删的 9005 slo-logout 页），SLO 桌面端走 back-channel（server 广播 WS）。

## 服务端保留项（桌面客户端与 web 管理页依赖）

| 接口 | 用途 |
|---|---|
| `POST /api/sessions/:id/messages` | 桌面本地 agent 写入 user/assistant 消息（含 thinking/timeline/form） |
| `GET /api/sessions/:id` 等会话 CRUD/回收站 | 会话数据（桌面 + web 共用） |
| `GET /api/llm/providers/active-key` | **桌面本地 agent 取活动 provider（model/baseUrl/apiKey）** |
| `GET /api/mcp/tools` + `POST /api/mcp/tools/call` | **桌面本地 agent 的 MCP 工具注册与执行代理**（服务端复用 MCP 连接） |
| `GET /api/skills` + `GET /api/skills/:id/download` | 桌面客户端同步技能到本地 |
| `GET /api/mcp/servers` | **桌面本地 agent 的 MCP 配置下发源**（客户端直连服务器） |
| `/api/mcp/servers` CRUD/test、`/api/llm/providers` CRUD | web 管理页（desktop McpView 同用） |
| Keycloak 认证（jwt）、`/api/auth/kc-logout`、`/api/sse/logout`、WS `/api/ws/client` | SSO/SLO（单点登录/登出） |

## 桌面客户端对服务端依赖一览（9 个端点，全部数据类）

见 [docs/单点登录-sso-slo.md](单点登录-sso-slo.md) 与 `apps/desktop/src/main/agent/engine.ts`：会话历史、消息写入、llm active-key、mcp tools/call、skills 列表/下载、SLO WS、kc-logout。**删除服务端 agent 后客户端零断裂**（已 tsc 验证）。

## 验证记录

- `tsc --noEmit`：server / desktop 通过（web 已移除）
- server 启动正常（PM2），chat 路由已删（`/api/sessions/:id/chat` → 404），`/api/mcp/tools` 与 `/api/mcp/tools/call` 已删（→ 404），`/api/mcp/servers` 200（配置下发）
- 桌面端直连 9004 实测：会话列表/新建、user+assistant 消息写入（含 thinking/timeline）、会话详情、`active-key` 全部 200 ✅
- **MCP 本地直连实测**：`mcp_search_memories` 直连 aimemory 返回记忆 ✅；`mcp_local_exec` 直连 agent-runtime 执行 `echo` 成功 ✅
- 桌面端代码工具链保持现状（未增删工具）；`br-agent` client 已清 front-channel logout

## 备注

- 本分支是**架构变更分支**，与 main 并行演进；后续服务端数据接口的优化在 main 上做、再合并/重拉本分支。
- agent-runtime（MCP 本机执行，`agent-runtime/` 目录）是独立服务，桌面端直连其 `127.0.0.1:18544`。
- **MCP 服务器 URL 可达性**：客户端本地直连要求服务器地址在客户端可达——`localhost`/`127.0.0.1` 仅限与客户端同机的服务（如 agent-runtime）；内网 MCP（aimemory 等）需配置为客户端可达的内网地址。`McpServer.headers` 中凭证（如 `Token m0-xxx`）随配置明文下发到客户端本机（与 `active-key` 下发 apiKey 同理；属既有暴露面，后续可加 headers 脱敏）。
- web 移除后桌面端需**重新打包**（DEFAULT_SERVER_URL 已改 9004），见 `apps/desktop` 构建。
