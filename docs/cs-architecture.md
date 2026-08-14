# CS 架构说明（cs-only 分支）

> 本分支从 main 拉出：**服务端清除 agent**（推理/对话/工具注入全部移除），服务端仅承担**数据服务 + MCP 连接代理 + 认证/单点登出**；**桌面客户端是完整的 agent**（LLM 调用、ReAct 循环、技能脚本执行全部在客户端本机），且**保持现状、不增删任何工具**；web 保留管理页、移除对话视图。
>
> 更新：2026-08-14

## 架构定位

```
┌─ 桌面客户端（Electron）───────────────┐     ┌─ BR-Agent Server ──────────────┐
│  agent 核心（本地）                    │     │  仅数据服务（无 agent）          │
│  ├─ LLM 直连 provider（active-key）    │     │  ├─ 会话/消息 CRUD（共享数据）   │
│  ├─ ReAct 循环（runner）               │     │  ├─ 技能 列表/上传/下载/启停      │
│  ├─ skill_* 本地脚本执行               │     │  ├─ MCP 服务器 CRUD + 连接代理   │
│  ├─ mcp_*（经服务端代理执行）          │     │  ├─ LLM Provider CRUD + 配置下发 │
│  └─ 本机操作 mcp_local_*（agent-runtime）│    │  ├─ Keycloak 认证（jwt 校验）    │
│  （能力：推理+工具编排，全部本地）       │     │  ├─ SLO：/api/auth/kc-logout     │
└───────────────┬───────────────────────┘     │       + /api/sse/logout + WS     │
                │ 经 REST/WS（Bearer token）   │  └─────────────────────────────┘
                └──────────────────────────────▶
web 管理页（技能/MCP/模型配置/会话查看）→ 同样只调数据接口
```

- **agent 不在服务器上跑**：`/api/sessions/:id/chat`（服务端 SSE 对话）已删除，服务端没有任何 LLM 推理、工具注入、ReAct 循环。
- **桌面客户端保持现状**：工具链 = `skill_*`（本地脚本）+ `mcp_*`/`mcp_local_*`（服务端 MCP 代理 → agent-runtime），未新增/删除任何工具。

## 服务端删除清单

| 项 | 说明 |
|---|---|
| `apps/server/src/agent/` | 整个删除：runner / factory / tool-manager / tools / sandbox |
| `apps/server/src/modules/chat/` | 整个删除：`/api/sessions/:id/chat`（SSE 对话）、`/stop`、`extractFormFromScript` |
| `apps/server/src/scripts/` | 删除诊断脚本（diag_* / smoke，依赖 agent 模块） |
| `skills.service.ts` | 删 `executeSkill`、`buildSkillPromptAsync`、对 `agent/tools.js` 的依赖 |
| `skills.routes.ts` | 删 `POST /api/skills/:id/run`（服务端执行技能，客户端已本地执行） |
| `mcp.service.ts` | 删 `getEnabledMcpTools`（仅服务端 agent 注入用） |
| `client-gateway/` | 删 `tool-adapter.ts`、`registry.ts` 的 `getClientToolsForUser` |
| `index.ts` | 移除 `registerChatRoutes` 注册 |
| `packages/shared` | 删 `SSEChatEvent`、`ChatRequestDto`、`ChatResponse` |
| web | 删 `DialogueView.tsx`、`api.ts` 的 `chatStream`/`stop`、App 的对话导航与挂载 |

## 服务端保留项（桌面客户端与 web 管理页依赖）

| 接口 | 用途 |
|---|---|
| `POST /api/sessions/:id/messages` | 桌面本地 agent 写入 user/assistant 消息（含 thinking/timeline/form） |
| `GET /api/sessions/:id` 等会话 CRUD/回收站 | 会话数据（桌面 + web 共用） |
| `GET /api/llm/providers/active-key` | **桌面本地 agent 取活动 provider（model/baseUrl/apiKey）** |
| `GET /api/mcp/tools` + `POST /api/mcp/tools/call` | **桌面本地 agent 的 MCP 工具注册与执行代理**（服务端复用 MCP 连接） |
| `GET /api/skills` + `GET /api/skills/:id/download` | 桌面客户端同步技能到本地 |
| `/api/mcp/servers` CRUD/test、`/api/llm/providers` CRUD | web 管理页 |
| Keycloak 认证（jwt）、`/api/auth/kc-logout`、`/api/sse/logout`、WS `/api/ws/client` | SSO/SLO（单点登录/登出） |

## 桌面客户端对服务端依赖一览（9 个端点，全部数据类）

见 [docs/单点登录-sso-slo.md](单点登录-sso-slo.md) 与 `apps/desktop/src/main/agent/engine.ts`：会话历史、消息写入、llm active-key、mcp tools/call、skills 列表/下载、SLO WS、kc-logout。**删除服务端 agent 后客户端零断裂**（已 tsc 验证）。

## 验证记录

- `tsc --noEmit`：server / web / desktop 三端通过
- web 构建通过（产物缩小，对话代码已移除）
- 桌面端未改任何代码（保持现状）

## 备注

- 本分支是**架构变更分支**，与 main 并行演进；后续服务端数据接口的优化在 main 上做、再合并/重拉本分支。
- agent-runtime（MCP 本机执行，`agent-runtime/` 目录）是独立服务，不在本次删除范围——桌面端 `mcp_local_*` 仍经服务端 MCP 代理调用它。
