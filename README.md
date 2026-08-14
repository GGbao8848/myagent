# BR-Agent

企业级 AI Agent 平台——**B/S 在线对话 + C/S 本地 Agent 桌面客户端**双形态（类似 ChatGPT + Codex 的定位）。

## 功能特性

- **在线对话平台（B/S）**：多用户、Keycloak 单点登录、管理员统一管理模型/技能/MCP，会话数据存库、多人共享
- **本地 Agent 客户端（C/S，Codex 式）**：agent 核心（LLM 推理 + ReAct + 工具）在用户本机运行，不占服务器计算；数据经服务器 API 存库，与 web 端完全共享
- **技能（skill）本地化**：公开 skill 同步到客户端本地，内置 Python 环境本地执行（打包 embed Python，无需用户装环境）
- **MCP 集成**：支持 streamablehttp / sse / stdio 型 MCP 服务器，配置存库按用户隔离，客户端经服务器复用 MCP 工具
- **三态安全模式**：完全自动 / 危险操作确认 / 每次确认，本地工具执行前可弹窗确认
- **企业内网友好**：内网 vLLM 对话、局域网客户端完全可用、不依赖外网

## 快速开始

```bash
npm install
npm run dev          # 后端 → http://localhost:9004
npm run dev:web      # 前端 → http://localhost:9005
```

### 桌面客户端

```bash
cd apps/desktop
npm run build:main && npm run build:renderer
npx electron .       # 本地 Agent 客户端
# 打包安装包：npm run build:desktop（需先构建，产物在 apps/desktop/release/）
```

## 架构概览

```
[apps/server]  Fastify 5 + langchain agent + Prisma/PostgreSQL + Keycloak JWT
[apps/web]     React 19 + Vite + Tailwind（B/S 在线对话平台）
[apps/desktop] Electron 本地 Agent（LLM+ReAct+工具在本机跑，数据经服务器 API 存库）
[packages/shared] 共享类型
```

- 对话默认模型由 DB 决定（用户私有默认 → 公共全局默认），API key 加密存储
- 技能/MCP 配置存库，按用户隔离（`owner` 字段）
- 客户端 skill 用内置 Python 本地执行；MCP 工具经服务器复用连接

## 外部服务

| 服务 | 地址 | 说明 |
|---|---|---|
| PostgreSQL | localhost:5432 | 业务数据（库 br_agent） |
| Keycloak | 127.0.0.1:6543 | SSO 认证（realm br-platform） |
| vLLM | 10.10.10.146:8000 | 内网对话模型 |
| agent-runtime（MCP） | 127.0.0.1:18544 | 桌面客户端本机执行运行时（独立仓库维护，运行目录 `E:\br\MCP\agent-runtime`），客户端本地直连其 `mcp_local_*` 工具（白名单 + 审计日志） |

## 文档

详见 [docs/](docs/)：系统架构、局域网部署、部署指南、桌面客户端说明、服务启动排障、MCP 复用迁移指南、UI 组件设计、[Agent×MCP 联调排障记录](docs/agent-mcp-联调排障记录.md)（本机执行链路问题与修复实战）。
