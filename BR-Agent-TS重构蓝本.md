# BR-Agent 重构蓝本（TypeScript 全栈）

> 本文档整理当前 BR-Agent（Python + React）的功能、数据库、接口，作为 TypeScript 全栈重写（前后端都用 TS）的参考。粒度适中，细节以重新实现为准。

## 一、目标架构

```
┌─────────────────────────────────────────────┐
│  前端：React 19 + TypeScript + Vite + Tailwind │
│  页面：对话/技能/记忆/计划任务/MCP/设置          │
└───────────────┬─────────────────────────────┘
                │ HTTP/JSON + SSE 流式
┌───────────────▼─────────────────────────────┐
│  后端：Node.js + TypeScript（NestJS/Fastify） │
│  认证：Keycloak JWT 校验（realm: br-platform）│
│  Agent：deepagents 内核 / LangChain 工具编排   │
│  存储：PostgreSQL（业务表）+ 文件系统（画像/技能）│
└─────────────────────────────────────────────┘
```

**统一 SSO**：前端无 token 跳 Keycloak 官方登录页（`/realms/br-platform/protocol/openid-connect/auth`，client 为 `br-agent`，public + PKCE）；登录后存 `access_token`/`refresh_token` 到 localStorage；退出调 Keycloak logout 全局注销。与平台（9002）共用同一 realm，登录一次两应用互通。

## 二、数据模型（PostgreSQL，库 br_platform）

4 张 agent 业务表，全部按 `owner`/`user_id` 做用户隔离（公共记录 owner 为空字符串）。

### agent_sessions — 会话
| 列 | 类型 | 说明 |
|---|---|---|
| id | text PK | 后端生成的会话 ID |
| title | text | 标题（默认"新对话"，首条消息后自动改标题） |
| user_id | text | 归属用户（`preferred_username`） |
| created_at / updated_at | text | 时间 |
| message_count | int | 消息数（冗余） |
| metadata | text(JSON) | 扩展元数据 |

### agent_messages — 消息
| 列 | 类型 | 说明 |
|---|---|---|
| id | int PK 自增 | |
| session_id | text | 归属会话 |
| role | text | `user` / `assistant` |
| content | text | user=原文；assistant=thinking 文本拼接（见"流水线"） |
| created_at | text | 时间 |
| tokens | int | 上下文用量 |
| metadata | text(JSON) | **`timeline`**：完整执行轨迹数组，见下 |

**timeline 结构**（assistant 消息 metadata 内，按执行顺序交错）：
```json
[
  {"type": "thinking", "content": "思考过程文本"},
  {"type": "tool_call", "name": "queryShopList", "args": {}, "id": "call_xx"},
  {"type": "tool_result", "name": "queryShopList", "content": "工具返回 JSON"},
  {"type": "thinking", "content": "下一段思考..."},
  ...
]
```
> 最后一段 thinking（其后无 tool_call）= **最终正文**（含 markdown 表格），前端据此渲染正文卡片。

### agent_skills — 技能元数据（技能本体留文件系统）
| 列 | 类型 | 说明 |
|---|---|---|
| id | text PK | 技能 ID |
| name / description | text | 名称与描述 |
| category | text | 分类（document/custom 等） |
| owner | text | 公共=`''`，私有=用户 ID |
| enabled | bool | 启用开关 |
| is_custom | bool | 是否用户上传的私有技能 |
| created_at | text | |

技能目录：公共 `data/skills/<id>/SKILL.md`，私有 `data/skills/<owner>/<id>/SKILL.md`（上传 zip 解包，须含 SKILL.md）。

### agent_mcp_servers — MCP 服务器配置
| 列 | 类型 | 说明 |
|---|---|---|
| id | text PK | 服务器名（如 my-coffee） |
| name / type | text | type: streamablehttp / stdio |
| url | text | HTTP 端点 |
| command / args | text | stdio 用 |
| headers | text(JSON) | 认证头（如 Authorization Bearer） |
| owner | text | 公共 / 私有 |
| enabled | bool | |

### 用户画像（文件系统，非 PG）
每个用户一个 JSON 文件：`data/profile/<user_id>.json`
```json
{
  "observations": [
    {"id": "abc", "content": "用户偏好简洁回复", "confidence": 0.85, "source": "explicit", "created_at": "...", "last_seen_at": "...", "seen_count": 3}
  ],
  "summary": "自动生成的一句话摘要",
  "updated_at": "..."
}
```
规则：置信度随时间衰减（5%/天）、重复出现提升（10%）、相似去重（阈值 0.6）、最多 100 条、低于 0.3 不进摘要。

## 三、API 契约（全部带 `Authorization: Bearer <token>`）

### 会话
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sessions` | 当前用户会话列表 |
| POST | `/api/sessions` | 新建会话（返回含 id/title） |
| GET | `/api/sessions/{id}` | 会话详情（含 messages，assistant 带 timeline） |
| PATCH | `/api/sessions/{id}` | 改标题 |
| DELETE | `/api/sessions/{id}` | 删除 |
| POST | `/api/sessions/{id}/chat` | **SSE 流式对话**（见下） |
| POST | `/api/sessions/{id}/stop` | 停止生成 |

### 技能
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/skills?show_all=` | 列表（公共+当前用户私有） |
| POST | `/api/skills/upload` | zip 上传安装到私有目录 |
| PATCH | `/api/skills/{id}` | 启停 |
| DELETE | `/api/skills/{id}` | 删私有技能 |

### MCP
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mcp/servers` | 列表（含 owner 区分公共/私有） |
| POST | `/api/mcp/servers` | 添加（config_json 粘贴 mcpServers 或逐字段；普通用户存私有） |
| POST | `/api/mcp/servers/{id}/test` | 连接测试，返回工具列表 |
| POST | `/api/mcp/servers/{id}/toggle` | 启停 |
| DELETE | `/api/mcp/servers/{id}` | 删除（管理员可删公共，普通用户只删自己私有） |

### 画像
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/profile` | 画像数据 |
| GET | `/api/profile/stats` | 统计（置信度等） |
| GET | `/api/profile/observations` | 观察列表 |
| POST | `/api/profile/observations` | 新增观察（body: content/source/confidence） |
| PATCH | `/api/profile/observations/{id}` | 改置信度 |
| DELETE | `/api/profile/observations/{id}` | 删除 |

### 设置 / 工具 / 健康
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/PUT | `/api/settings` | 非 LLM 配置（BIP 凭证等，apiKey 脱敏） |
| GET/PUT | `/api/settings/providers` | LLM 配置列表（id/name/apiKey/baseUrl/model/maxContextTokens，apiKey 脱敏） |
| PUT | `/api/settings/providers/active` | 切换激活 provider |
| GET | `/api/tools` | 远程/沙箱工具列表 |
| GET | `/api/health` | 健康检查 |

## 四、SSE 对话协议（POST /api/sessions/{id}/chat）

响应为 `text/event-stream`，事件 payload 为 JSON：
```json
{"event": "context_usage", "used_tokens": 123, "max_tokens": 32768}
{"event": "thinking", "content": "逐 token 思考/正文流"}     // 思考与正文都走此事件
{"event": "tool_call", "tool_name": "queryShopList", "args": {}}
{"event": "tool_result", "tool_name": "queryShopList", "content": "工具结果 JSON"}
{"event": "done", "message_id": 28}
{"event": "error", "content": "错误信息"}
```
> 注意：当前 Python 版把 thinking 和最终正文混在一个流里（`thinking` 事件都发），前端靠"timeline 最后一段 thinking"区分正文。**TS 重构建议**：让 Agent 内核区分思考 vs 正文，分别发 `thinking` 和 `content` 事件，彻底解决这个痛点。

## 五、功能模块

1. **对话**：多步骤工具调用 agent，中间穿插思考。前端渲染为流水线：思考块（打字机逐字，进下一步自动折叠）→ 工具块（参数/结果默认折叠）→ 正文 markdown。
2. **技能管理**：公共 + 私有双层，上传 zip 安装，启停开关。
3. **记忆画像**：对话后台异步提取用户观察（LLM 抽取），注入下次对话 system prompt。按用户隔离。
4. **MCP 连接**：streamablehttp/stdio 客户端，连接测试、工具列表、工具调用路由。MCP 工具可被 agent 调用。
5. **LLM 配置**：多 provider（Qwen3.5-27B 生产/本地、9B 等），前端可切换，写入 settings。
6. **计划任务**：前端页面（mock 为主）。
7. **沙箱执行**：AI 生成代码在沙箱（WSL 或子进程）执行，带 AST 审计/内存/网络限制。
8. **ToolManager**：统一注册工具（沙箱/远程/MCP/技能），带网关（超时/重试/熔断）。

## 六、前端页面

| 页面 | 文件（参考） | 说明 |
|---|---|---|
| 对话 | DialogueView | 流水线渲染、SSE 流式 |
| 技能 | SkillsView | 卡片 + 公共/私有标签 + 上传 |
| 记忆 | MemoryView | 画像/观察展示 |
| 计划任务 | SchedulerView | |
| MCP | McpView | 服务器列表 + 工具展示 |
| 设置 | SettingsView | LLM provider 切换、BIP 凭证 |
| 登录 | LoginPage/auth.ts | Keycloak 授权码 + PKCE |

前端关键模块：`api.ts`（fetch 封装自动带 token、401 刷新重试）、`auth.ts`（Keycloak 登录/登出/token 管理）、`types.ts`（类型定义）。

## 七、TS 重构目录建议

```
BR-Agent/
  apps/
    web/          # React + Vite 前端
    server/       # Node + TS 后端（NestJS 或 Fastify）
      src/
        auth/     # Keycloak JWT 中间件
        modules/
          sessions/  chat/   # SSE
          skills/  mcp/  profile/  settings/  tools/
        agent/    # agent 内核封装（deepagents 或自研编排）
        db/       # Prisma/Drizzle + PostgreSQL
        sandbox/  # 代码执行沙箱
  packages/
    shared/       # 共享类型（API DTO、timeline 类型）
```
建议用 **Prisma/Drizzle + PostgreSQL**（复用现有 4 张表结构，数据可平滑迁移），**SSE 用原生或 `@microsoft/fetch-event-source`**，agent 内核可选 `deepagents` 的 JS 版或自研 LangChain.js 编排。

## 八、验证清单

- 登录互通：平台/agent 任一登录后另一应用免登录
- 多用户隔离：A 的会话/技能/画像/MCP 不被 B 看到
- 流水线对话：思考打字机 → 工具折叠 → 正文 markdown
- MCP 真实连接：瑞幸 coffee 服务器列工具、调用成功

## 九、重构决策与启动说明（2026-08-03 定）

- **重构原则**：简约、快速、稳定。**不添加任何花哨功能**（不要 mock 演示、花哨动画、演示文案等）。
- **保留范围**：仅保留 **skills**（全部公共技能，`backend/skills/` 下的 SKILL.md 文件及其格式规范）。其余功能模块（对话、记忆画像、MCP 管理、计划任务、设置、沙箱、ToolManager）全部删除，按本蓝本重新实现为 TS。
- **数据库**：暂不迁移旧数据，TS 版**新库新建**（schema 可参考第二节，按需简化）。现有 PostgreSQL 的 4 张 agent 表仅作参考。
- **Keycloak**：继续用现有 realm（br-platform）+ client（br-agent，public + PKCE），统一 SSO 方案保留。
- **本会话已完成**：确认 docs.langchain.com/mcp 是开发文档、非 MCP 端点，无需接入；工作区已还原为最近提交（32c81bd）的干净状态；本蓝本为唯一重构参考。
- **启动方式**：开新会话，依据本文档进行 TypeScript 全栈重构。旧 Python 代码仓库保留在 git 历史中，需要时可用 `git log` / `git checkout <commit>` 查阅。

## 十、重构待办（新会话启动清单）

1. 搭 TS monorepo：`apps/web`（React+Vite）+ `apps/server`（Node+TS）+ `packages/shared`（共享类型）
2. 后端：Keycloak JWT 中间件 → 会话/chat(SSE)/skills API → 数据库（新建 PG schema）
3. 前端：登录 → 对话页（流水线渲染）→ 技能页 → 基础设置
4. skills 保留：迁移公共 SKILL.md 到新结构，实现上传/列表/启停
5. 按第八节验证清单逐项验收

