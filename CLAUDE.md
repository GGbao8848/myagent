# CLAUDE.md

本文件供 Claude Code 在本仓库工作时参考（详细文档见 `docs/`，README 见项目根）。

## 项目概览

BR-Agent：企业级 AI Agent（TypeScript monorepo，npm workspaces）。
- `apps/server`：Fastify 5 后端（SSE 对话、Keycloak JWT、Prisma+PostgreSQL、langchain agent）
- `apps/web`：React 19 + Vite + Tailwind 前端（B/S 在线对话平台）
- `apps/desktop`：Electron 本地 Agent 客户端（Codex 式——agent 核心在本机运行，数据经服务器 API 存库）
- `packages/shared`：共享类型（DTO、SSE 事件）

## 启动

```bash
npm run dev        # 后端 server → http://localhost:9004（tsx watch 自动重载）
npm run dev:web    # 前端 web    → http://localhost:9005
# 桌面客户端（本地 agent）：
cd apps/desktop && npm run build:main && npm run build:renderer && npx electron .
```

## 网络使用（重要）

本机访问外网（GitHub 等）需走本地代理 **`127.0.0.1:7890`**。直连 github.com 不通，经代理可达。

**git 推拉走代理**：
```bash
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push origin main
```
> origin：`https://github.com/GGbao8848/myagent.git`

## 本地大模型（LLM）

env 指向内网 vLLM（无需代理）：`OPENAI_BASE_URL=http://10.10.10.146:8000/v1`、`DEFAULT_MODEL=/models/Qwen3.5-27B-FP8`。
**对话默认模型由 DB 决定，不读 env**：用户私有默认 → 公共全局默认（管理员维护）。API key 存 DB 时 AES-256 加密（密钥 `ENCRYPTION_KEY`）。

## 关键约定

- **用户隔离**：业务表 `owner` 字段（公共 `""`，私有 = userId），查询统一 `OR: [{owner:""},{owner}]`
- **管理员**：JWT `realm_access.roles` 含 `admin`
- **思考/正文**：qwen 用 `<think>` 标签；deepseek 思考在 `msg.reasoning`（runner 已兼容两者）
- **数据库变更**：改 `schema.prisma` 后 `npm run db:push -w apps/server`（server 运行中会锁 Prisma DLL，需先停 server）

## 开发注意

- server 用 `tsx watch` 自动重载；端口被旧进程占用时 `taskkill //PID <pid> //F` 清理
- typecheck：后端 `cd apps/server && npx tsc --noEmit`；前端 `cd apps/web && npx tsc --noEmit`

## 文档索引（docs/）

| 文档 | 内容 |
|---|---|
| [系统架构](docs/architecture-系统架构.md) | 整体架构 |
| [局域网部署](docs/network-access-局域网部署.md) | 部署网络要求 |
| [部署指南](docs/部署指南.md) | PM2 部署 + 外部服务自启动 |
| [桌面客户端](docs/客户端说明.md) | 本地 Agent 客户端架构与构建 |
| [服务启动排障](docs/troubleshooting-服务启动排查.md) | 服务无法启动排查 |
| [MCP 复用迁移](docs/mcp-复用迁移指南.md) | MCP 系统集成与迁移 |
| [UI 组件设计](docs/ui-design-UI组件设计.md) | 前端 UI 设计约定 |
