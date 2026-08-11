# BR-Agent 系统架构

> 本文档描述 BR-Agent 当前（TypeScript 全栈版）的系统架构：技术栈、数据模型、API 契约、SSE 协议与关键设计约定。
> 以代码为准，代码变更时请同步更新。

## 一、概览

BR-Agent 是企业级 AI Agent 平台：用户在对话中调用 Agent（含自定义技能、MCP 工具、沙箱代码执行），由本地/外部大模型驱动。前端单页应用 + 后端 SSE 流式对话，Keycloak 统一 SSO。

```
┌───────────────────────────────────────────────┐
│  前端 apps/web（React 19 + Vite + Tailwind）    │
│  侧边栏：对话 / 技能 / 连接管理(MCP) / 模型配置  │
└──────────────┬────────────────────────────────┘
               │ HTTP/JSON + SSE 流式
┌──────────────▼────────────────────────────────┐
│  后端 apps/server（Fastify 5 + Node + TS）       │
│  认证：Keycloak JWT 校验（realm br-platform）     │
│  Agent：langchain createAgent + deepagents 内核 │
│  存储：PostgreSQL（Prisma 6）                    │
└────────────────────────────────────────────────┘
```

## 二、技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 19 · Vite · Tailwind · shadcn/ui | 单页应用，SSE 流式渲染 |
| 后端 | Fastify 5 · TypeScript · tsx | SSE 流式对话、REST API |
| 数据库 | PostgreSQL · Prisma 6 | 业务数据 |
| 认证 | Keycloak（realm `br-platform`，client `br-agent`，public + PKCE） | JWT `access_token` 校验 |
| Agent | `@langchain/openai` + `deepagents` | createAgent 内核，工具编排 |
| 大模型 | vLLM（内网）或用户自配 provider | 模型由 DB 配置决定 |

## 三、目录结构

```
BR-Agent/
  apps/
    server/                 # 后端
      prisma/schema.prisma  # 数据模型
      src/
        index.ts            # 入口：Fastify 装配 + 路由注册
        auth/jwt.ts         # Keycloak JWT 校验中间件
        agent/              # Agent 内核封装（runner / factory / tools / sandbox）
        modules/            # 业务模块：sessions / chat / skills / mcp / llm
        scripts/            # smoke 冒烟脚本等
      python-env/           # 沙箱 Python 环境
    web/                    # 前端（React + Vite）
      src/
        App.tsx             # 登录态 + 视图切换
        views/              # DialogueView / SkillsView / McpView / LlmView
        api.ts / auth.ts    # fetch 封装 / Keycloak 登录
        components/ui/      # shadcn 组件
  packages/shared/          # 共享类型（SSE 事件、DTO）
  docs/                     # 项目文档
```

## 四、数据模型（Prisma 7 张表）

用户隔离统一约定：`owner` 字段，公共记录 `""`，私有 = userId；查询 `OR: [{owner:""}, {owner}]`。

| 表 | 关键字段 | 说明 |
|---|---|---|
| `Session` | id(cuid)、title、userId、createdAt/updatedAt、deletedAt | 会话；`deletedAt` 非空 = 回收站 |
| `Message` | id(auto)、sessionId、role、content、thinking?、timeline(Json)?、form(Json)? | `timeline` 完整执行轨迹；`form` 表单卡片（刷新后重渲染） |
| `Skill` | id、name、description、category、owner、enabled、isCustom | 技能元数据（技能本体在文件系统，见下） |
| `McpServer` | id、name、type(http/stdio)、url、command、args、headers、owner、enabled | MCP 服务器配置 |
| `LlmProvider` | id、name、model、baseUrl、apiKeyEnc、owner、isGlobalDefault、maxTokens | 模型 provider；API key AES-256 加密 |
| `UserDefaultModel` | owner(id)、providerId、updatedAt | 每个用户独立的默认模型选择 |
| `Setting` | key、value | 键值配置 |

技能目录：公共 `apps/server/data/skills/<id>/SKILL.md`，私有 `apps/server/data/skills/<owner>/<id>/SKILL.md`（上传 zip 解包，须含 SKILL.md）。

## 五、API 一览（全部带 `Authorization: Bearer <token>`，health 除外）

### 会话 sessions
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sessions` | 当前用户会话列表 |
| POST | `/api/sessions` | 新建会话 |
| GET | `/api/sessions/:id` | 会话详情（含 messages，assistant 带 timeline/form） |
| PATCH | `/api/sessions/:id` | 改标题 |
| DELETE | `/api/sessions/:id` | 移入回收站 |
| POST | `/api/sessions/:id/restore` | 从回收站恢复 |
| GET | `/api/sessions/trash` | 回收站列表 |
| DELETE | `/api/sessions/trash` | 清空回收站 |
| DELETE | `/api/sessions/batch` | 批量删除 |
| POST | `/api/sessions/batch-restore` | 批量恢复 |

### 对话 chat
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/sessions/:id/chat` | **SSE 流式对话**（协议见第六节） |
| POST | `/api/sessions/:id/stop` | 停止生成 |

### 技能 skills
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/skills` | 列表（公共 + 当前用户私有） |
| POST | `/api/skills/upload` | zip 上传安装 |
| PATCH | `/api/skills/:id` | 启停 |
| DELETE | `/api/skills/:id` | 删除私有技能 |

### MCP 连接 mcp
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mcp/servers` | 列表（公共/私有） |
| POST | `/api/mcp/servers` | 添加服务器 |
| PATCH | `/api/mcp/servers/:id` | 编辑 |
| POST | `/api/mcp/servers/:id/test` | 连接测试，返回工具列表 |
| POST | `/api/mcp/servers/:id/toggle` | 启停 |
| DELETE | `/api/mcp/servers/:id` | 删除（管理员可删公共） |

### 模型配置 llm
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/llm/providers` | provider 列表（含用户默认、全局默认） |
| POST | `/api/llm/providers` | 新增 provider |
| PATCH | `/api/llm/providers/:id` | 编辑 |
| DELETE | `/api/llm/providers/:id` | 删除 |
| POST | `/api/llm/providers/:id/activate` | 设为用户私有默认 |
| POST | `/api/llm/providers/:id/global-default` | 设为公共全局默认（管理员） |
| POST | `/api/llm/providers/:id/test` | 连通性测试 |
| POST | `/api/llm/providers/reset` | 重置用户默认 |

### 其他
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（免认证） |

## 六、SSE 对话协议（POST /api/sessions/:id/chat）

响应为 `text/event-stream`，每行事件 payload 为 JSON：

```json
{"event":"thinking","content":"思考过程文本"}
{"event":"content","content":"最终正文 markdown"}     // 与 thinking 分开，解决了"正文混在思考流"的痛点
{"event":"tool_call","tool_name":"queryShopList","args":{},"id":"call_xx"}
{"event":"tool_result","tool_name":"queryShopList","content":"工具返回","is_error":false}
{"event":"form","form":{"id":"report","title":"报工单","columns":[...]}}
{"event":"done","message_id":28,"created_at":"..."}
{"event":"error","content":"错误信息"}
```

### timeline（Message 内，刷新后还原整条执行轨迹）
```json
[
  {"type":"thinking","content":"思考"},
  {"type":"tool_call","name":"queryShopList","args":{},"id":"call_xx"},
  {"type":"tool_result","name":"queryShopList","content":"..."},
  {"type":"thinking","content":"下一段思考..."}
]
```

### 思考 / 正文划分
- **qwen**：`<think>` 标签划分思考与正文
- **deepseek**：思考走投影流 `msg.reasoning`，正文走 `msg.text`（runner 已兼容两者）

## 七、前端结构

单页 + 侧边栏 4 视图（`App.tsx`），**所有视图保持挂载、切换仅隐藏**，避免对话流式状态/SSE 连接随卸载丢失：

| 视图 | 组件 | 说明 |
|---|---|---|
| 对话 | `DialogueView` | 流水线渲染（思考→工具→正文→表单卡片），SSE 流式 |
| 技能 | `SkillsView` | 技能卡片 + 启停 |
| 连接管理 | `McpView` | MCP 服务器列表 + 连接测试 |
| 模型配置 | `LlmView` | provider 增删改、切换默认 |

登录：Keycloak 授权码 + PKCE（`auth.ts`），`/callback` 兑换 token；过期/刷新失败自动回登录页。

## 八、关键设计约定

- **用户隔离**：业务表 `owner` 字段（公共 `""`，私有 = userId）。
- **管理员**：JWT `realm_access.roles` 含 `admin` → 可管理公共资源（公共技能/MCP/全局默认模型）。
- **默认模型解析顺序**：用户私有默认 → 公共全局默认（`isGlobalDefault`）→ 都没有则对话报错。**不读 env**（env 仅作诊断/冒烟兜底）。
- **API key 加密**：LlmProvider 的 key 存 DB 时 AES-256 加密（密钥 `ENCRYPTION_KEY`）。
- **沙箱**：AI 生成代码用 `run_python` 工具执行，Python AST 危险检查 + 内存监控 + 超时。
- **表单式交互**：智能体可输出可编辑表单（`FormDto`），用户核对后提交回传，走业务流程。
