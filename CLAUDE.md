# CLAUDE.md

本文件供 Claude Code 在本仓库工作时参考。

## 项目概览

BR-Agent：企业级 AI Agent（TypeScript monorepo，npm workspaces）。
- `apps/server`：Fastify 5 后端（SSE 流式对话、Keycloak JWT 认证、Prisma + PostgreSQL、langchain createAgent 内核）
- `apps/web`：React 19 + Vite + Tailwind 前端
- `packages/shared`：共享类型（DTO、SSE 事件）

## 启动

```bash
npm run dev        # 后端 server → http://localhost:9004（tsx watch 自动重载）
npm run dev:web    # 前端 web    → http://localhost:9005
```

## 网络使用（重要）

本机访问外网（GitHub 等）需走本地代理 **`127.0.0.1:7890`**。直连 github.com 不通（HTTP 000 / SSL 握手失败），但经代理可达（HTTP 200）。

**git 推拉代码走代理**：
```bash
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push origin main
```

**其他网络请求**（curl 等）也可加 `-x http://127.0.0.1:7890`。

> 仓库 `origin`：`https://github.com/GGbao8848/myagent.git`

## 本地大模型（LLM）

env 配置指向内网 vLLM（无需代理）：
```
OPENAI_API_KEY=brsys-2026
OPENAI_BASE_URL=http://10.10.10.146:8000/v1
DEFAULT_MODEL=/models/Qwen3.5-27B-FP8
```
**对话默认模型由 DB 决定，不读 env**：解析顺序 = 用户私有默认 → 公共全局默认（管理员在「模型配置」页维护，`isGlobalDefault` 标记）→ 都没有则对话报错。env 配置仅作诊断脚本/冒烟兜底。
用户在「模型配置」页可添加/切换自定义 provider（如 deepseek 官方 `api.deepseek.com` 或中转站 `tokenrhythm.studio`），API key 存 DB 时 AES-256 加密（密钥 `ENCRYPTION_KEY`）。

## 外部服务

| 服务 | 地址 | 说明 |
|---|---|---|
| PostgreSQL | localhost:5432（库 br_agent） | 业务数据 |
| Keycloak | 127.0.0.1:6543（realm br-platform，client br-agent，public+PKCE） | SSO 认证 |
| vLLM | 10.10.10.146:8000 | 本地大模型 |

## 关键约定

- **用户隔离**：业务表用 `owner` 字段（公共 `""`，私有 = userId），查询统一 `OR: [{owner:""},{owner}]`
- **管理员**：JWT `realm_access.roles` 含 `admin` → 管理员，可管理公共资源
- **思考/正文**：qwen 用 `<think>` 标签划分；deepseek 思考在投影流 `msg.reasoning`，正文在 `msg.text`（runner 已兼容两者）
- **沙箱**：AI 生成代码用 `run_python` 工具，Python AST 危险检查 + tasklist 内存监控 + 超时（Windows 无 resource 模块）
- **数据库变更**：`npm run db:push -w apps/server`（改 schema.prisma 后；server 运行中会锁 Prisma DLL，需先停 server）

## 开发注意事项

- server 用 `tsx watch`，改代码自动重载；但偶尔出现端口被旧进程占用（EADDRINUSE），需 `taskkill //PID <pid> //F` 清理
- 改 `apps/server/prisma/schema.prisma` 后需 `db:push` + 重启 server 才能用新模型
- 后端 typecheck：`cd apps/server && npx tsc --noEmit`；前端：`cd apps/web && npx tsc --noEmit`

## 生产部署（PM2，Windows Server）

配置文件：根目录 `ecosystem.config.js`（server 用 `npm.cmd run start`，web 用 `npm.cmd run preview`，带崩溃重启 + 日志到 `logs/`）。

```bash
# 1. 安装 PM2 + 开机自启
npm install -g pm2 pm2-windows-startup
pm2-startup install

# 2. 构建前端 + 启动
cd apps/web && npm run build        # 生成 dist（preview 服务静态产物）
cd <项目根> && pm2 start ecosystem.config.js
pm2 save                            # 保存进程列表，服务器重启后自动恢复

# 常用命令
pm2 status              # 查看状态
pm2 logs                # 查看日志
pm2 restart br-agent-server   # 重启后端
pm2 restart br-agent-web      # 重启前端
```

要点：
- **.env 加载**：server 入口 `index.ts` 用 dotenv 加载 `.env`（生产 `ENCRYPTION_KEY`、`MAX_CONCURRENT_GENERATIONS` 等必须配在 `.env`）
- **前端生产**：`npm run preview` 服务 build 产物，端口 9005 + `/api` 代理（vite preview 配置在 vite.config.ts）
- **并发上限**：`MAX_CONCURRENT_GENERATIONS`（默认 700）控制全局同时生成数，超限返回 503
- Windows 下 PM2 `script` 字段必须用 `npm.cmd`（不是 `npm`）
- 部署前确保：PostgreSQL、Keycloak、vLLM/外部模型可达；数据库已 `db:push`
