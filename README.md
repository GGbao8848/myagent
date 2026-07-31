# 🤖 AI 智能体企业办公自动化平台 - 前后端对接文档 (FastAPI Backend Integration Guide)

本文档为前端 (React 18 + Vite + Tailwind CSS) 对接 Python **FastAPI 智能体后端** 的完整接口规范与数据流协议说明。

---

## 项目结构

```
BR-Agent/
├── frontend/          # 前端（React 19 + Vite + Tailwind + Express dev server）
│   ├── src/           # React 源码
│   ├── server.ts      # Express 开发服务器（含 /api 代理与 JWT 校验）
│   └── auth.ts        # 后端 JWT 校验中间件（Keycloak JWKS）
└── backend/           # Python Agent 内核（deepagents + FastAPI）
    ├── src/           # 核心源码（agent/api/mcp/memory/sandbox...）
    ├── skills/        # 技能包
    └── main.py
```

前端通过 Keycloak OIDC 登录（与 BR Platform 统一 SSO），后端验证 JWT。

---

## 目录
- [1. 整体架构与数据流图](#1-整体架构与数据流图)
- [2. 核心流式传输协议 (WebSocket & SSE Token 逐字返回)](#2-核心流式传输协议-websocket--sse-token-逐字返回)
  - [2.1 SSE (Server-Sent Events) 协议规范](#21-sse-server-sent-events-协议规范)
  - [2.2 WebSocket 协议规范](#22-websocket-协议规范)
- [3. RESTful 功能接口列表与数据 Structure](#3-restful-功能接口列表与数据-structure)
  - [3.1 会话管理 (Sessions & Messages)](#31-会话管理-sessions--messages)
  - [3.2 用户画像与认知记忆 (Profile & Memories)](#32-用户画像与认知记忆-profile--memories)
  - [3.3 技能组件与插件 (Skills Management)](#33-技能组件与插件-skills-management)
  - [3.4 MCP 服务器协议集成 (Model Context Protocol)](#34-mcp-服务器协议集成-model-context-protocol)
  - [3.5 智能日程与定时任务 (Scheduler & Cron Tasks)](#35-智能日程与定时任务-scheduler--cron-tasks)
  - [3.6 大模型网关管理 (LLM Models & Health)](#36-大模型网关管理-llm-models--health)
- [4. FastAPI 后端参考实现代码 (Ready-to-Run `main.py`)](#4-fastapi-后端参考实现代码-ready-to-run-mainpy)
- [5. 前端环境变量与联调配置](#5-前端环境变量与联调配置)

---

## 1. 整体架构与数据流图

```text
+------------------+         HTTP / REST        +-----------------------+
|                  | -------------------------> |                       |
|   React 前端应用  |                            |   FastAPI 后端服务    |
| (Vite + Tailwind)| <------------------------- | (Python Agent Runtime)|
|                  |      WebSocket / SSE       |                       |
+------------------+ (Streaming Token 逐字返回)  +-----------------------+
                                                            |
                                                            | Agent 编排 / Tool Call
                                                            v
                                                +-----------------------+
                                                |  MCP / 本地工具 / 技能  |
                                                +-----------------------+
                                                            |
                                                            v
                                                +-----------------------+
                                                |  大模型 API (LLM)     |
                                                | (OpenAI/Gemini/Claude)|
                                                +-----------------------+
```

---

## 2. 核心流式传输协议 (WebSocket & SSE Token 逐字返回)

为了实现类似 ChatGPT / Claude 的打字机逐字输出（Streaming Tokens）、思维链推理过程（Thinking process）以及工具调用状态（Tool execution status），推荐使用 **SSE** 或 **WebSocket** 协议。

### 2.1 SSE (Server-Sent Events) 协议规范

- **请求 Endpoint:** `POST /api/chat/stream`
- **Header 要求:** `Content-Type: application/json`, `Accept: text/event-stream`

#### 请求 Payload (Request Body)
```json
{
  "session_id": "session_1722000000",
  "messages": [
    {
      "id": "msg_001",
      "role": "user",
      "content": "请结合数据库和周报技能，整理一份本周销售总结"
    }
  ],
  "profile": {
    "name": "张经理",
    "role": "高级业务分析师",
    "department": "华东销售部",
    "tonePreference": "professional",
    "formatPreference": "markdown"
  },
  "memories": [
    {
      "category": "preference",
      "content": "用户偏好使用 Markdown 列表展示核心指标"
    }
  ],
  "skills": [
    {
      "id": "skill_report_generator",
      "name": "周报月报生成器",
      "enabled": true
    }
  ],
  "mcp_servers": [
    {
      "id": "mcp_db",
      "name": "Corporate Database",
      "status": "connected"
    }
  ],
  "model_id": "model_gemini"
}
```

#### SSE 流式 Event 帧数据类型 (Server -> Client)

FastAPI 返回 `text/event-stream`，每一帧格式为 `data: <JSON_STRING>\n\n`：

1. **思维链 / 思考阶段 (`thinking`)**
```http
data: {"type": "thinking", "content": "正在解析用户指令并匹配数据源...\n抽取华东销售部本周核心数据..."}
```

2. **工具调用中 (`tool_call`)**
```http
data: {"type": "tool_call", "tool": "mcp_db.query_sales_records", "args": "{\"region\":\"East\",\"limit\":100}", "status": "running"}
```

3. **工具执行结果 (`tool_result`)**
```http
data: {"type": "tool_result", "tool": "mcp_db.query_sales_records", "status": "success", "result": "{\"total_sales\": 1280000, \"order_count\": 450}"}
```

4. **文本 Token 逐字流 (`token`)**
```http
data: {"type": "token", "delta": "根据"}
data: {"type": "token", "delta": "数据库"}
data: {"type": "token", "delta": "查询"}
data: {"type": "token", "delta": "结果"}
```

5. **生成结束信号 (`done`)**
```http
data: {"type": "done", "message_id": "msg_assistant_101", "finish_reason": "stop"}
```

6. **异常错误信号 (`error`)**
```http
data: {"type": "error", "message": "大模型 Token 限流或 API Key 验证失败"}
```

---

### 2.2 WebSocket 协议规范

- **Endpoint:** `ws://<your-backend-host>/ws/chat`

#### 客户端发送消息包 (Client -> Server)
```json
{
  "action": "chat",
  "session_id": "session_1722000000",
  "message": {
    "id": "msg_001",
    "role": "user",
    "content": "帮我运行排期任务"
  },
  "profile": { ... },
  "memories": [ ... ]
}
```

#### 服务端响应数据帧 (Server -> Client)
格式与 SSE 的 JSON 类似：
```json
{ "type": "thinking", "content": "思考中..." }
{ "type": "token", "delta": "你好，" }
{ "type": "token", "delta": "我是" }
{ "type": "done", "message_id": "msg_002" }
```

---

## 3. RESTful 功能接口列表与数据 Structure

除了实时对话，前端的 **技能管理、MCP 注册、计划任务、用户记忆、模型配置** 等模块需要后端提供 RESTful CRUD 接口支持持久化：

### 3.1 会话管理 (Sessions & Messages)

| HTTP 方法 | 接口路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/sessions` | 获取当前用户的历史会话列表 |
| `POST` | `/api/sessions` | 创建新空白会话 |
| `GET` | `/api/sessions/{session_id}/messages` | 获取指定会话的所有历史消息 |
| `DELETE` | `/api/sessions/{session_id}` | 删除特定会话 |

#### Session 数据结构 (TypeScript 映射)
```json
{
  "id": "session_001",
  "title": "华东销售周报整理",
  "model": "Gemini 2.5 Flash",
  "createdAt": "2026-07-28 10:00",
  "messages": []
}
```

---

### 3.2 用户画像与认知记忆 (Profile & Memories)

#### 读取/更新用户画像 (`GET/PUT /api/user/profile`)
```json
// Profile Schema
{
  "name": "张经理",
  "role": "产品专家",
  "department": "数字化创新中心",
  "tonePreference": "professional", // 'professional' | 'friendly' | 'concise' | 'detailed'
  "formatPreference": "markdown"    // 'markdown' | 'bullet' | 'plain'
}
```

#### 记忆列表 (`GET /api/user/memories`, `POST /api/user/memories`, `DELETE /api/user/memories/{id}`)
```json
// Memory Item Schema
{
  "id": "mem_001",
  "content": "用户出差目的省份主要是浙江和上海",
  "category": "preference", // 'preference' | 'profile' | 'system' | 'schedule'
  "createdAt": "2026-07-28 09:30",
  "confidence": 95
}
```

---

### 3.3 技能组件与插件 (Skills Management)

| HTTP 方法 | 接口路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/skills` | 拉取已安装技能库列表 |
| `POST` | `/api/skills/upload` | 上传 Skill ZIP / YAML 文件并解析安装 |
| `POST` | `/api/skills/{id}/toggle` | 切换技能启用/禁用状态 |
| `DELETE` | `/api/skills/{id}` | 卸载自定义技能 |

#### Skill Schema
```json
{
  "id": "skill_001",
  "name": "智能文档结构化解析",
  "description": "自动提取 PDF/Word 中的关键条款与表格",
  "category": "document", // 'document' | 'coding' | 'office' | 'utility' | 'custom'
  "enabled": true,
  "parameters": [
    { "name": "extract_tables", "type": "boolean", "description": "是否导出表格", "value": "true" }
  ],
  "isCustom": true
}
```

---

### 3.4 MCP 服务器协议集成 (Model Context Protocol)

| HTTP 方法 | 接口路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/mcp/servers` | 获取已注册的 MCP 工具服务器 |
| `POST` | `/api/mcp/servers` | 注册新 MCP 服务器 (stdio 或 sse) |
| `POST` | `/api/mcp/test` | 测试与 MCP 服务器握手并获取开放 Tools |
| `DELETE` | `/api/mcp/servers/{id}` | 注销 MCP 服务器 |

#### MCP Test Response Schema
```json
{
  "success": true,
  "message": "握手成功！获取 3 个工具",
  "tools": [
    {
      "name": "query_records",
      "description": "查询企业数据库记录",
      "inputSchema": {
        "type": "object",
        "properties": {
          "tableName": { "type": "string", "description": "目标数据表" }
        },
        "required": ["tableName"]
      }
    }
  ]
}
```

---

### 3.5 智能日程与定时任务 (Scheduler & Cron Tasks)

| HTTP 方法 | 接口路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/scheduler/tasks` | 获取所有的自动化计划任务 |
| `POST` | `/api/scheduler/tasks` | 创建新的计划任务 (Cron / 定时) |
| `PUT` | `/api/scheduler/tasks/{id}` | 更新计划任务状态或执行时间 |
| `DELETE` | `/api/scheduler/tasks/{id}` | 删除定时任务 |

#### ScheduleTask Schema
```json
{
  "id": "task_001",
  "title": "每日晨间数据快报",
  "scheduleType": "daily", // 'daily' | 'weekly' | 'monthly' | 'custom_cron' | 'once'
  "timeValue": "08:30",
  "cronExpression": "30 8 * * *",
  "prompt": "自动连接 ERP 抓取昨日新增订单数，输出摘要 markdown",
  "displayFormat": "markdown",
  "enabled": true,
  "createdAt": "2026-07-28 10:00",
  "runCount": 12
}
```

---

### 3.6 大模型网关管理 (LLM Models & Health)

| HTTP 方法 | 接口路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/models` | 获取注册的 LLM 模型网关配置 |
| `POST` | `/api/models/test` | 测试 LLM 节点连通性与响应延时 |

#### Model Config Schema
```json
{
  "id": "model_openai_custom",
  "name": "GPT-4o 内部专线",
  "provider": "OpenAI",
  "baseUrl": "https://api.yourcompany.com/v1",
  "apiKey": "sk-your-internal-key",
  "enabled": true
}
```

---

## 4. FastAPI 后端参考实现代码 (Ready-to-Run `main.py`)

您可以在 Python 后端中使用以下 FastAPI 模板代码快速搭建对齐前端 SSE/WebSocket 协议的智能体接口：

```python
import json
import asyncio
from typing import AsyncGenerator
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="Agentic Office Automation FastAPI Backend", version="1.0.0")

# 配置 CORS 跨域，允许前端连接
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境请修改为实际前端域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    session_id: str | None = None
    messages: list[dict]
    profile: dict | None = None
    memories: list[dict] | None = None
    skills: list[dict] | None = None
    mcp_servers: list[dict] | None = None
    model_id: str | None = "model_gemini"

# 1. 核心 SSE 流式输出接口
@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    async def event_generator() -> AsyncGenerator[str, None]:
        # Step 1: 推送思维链 (Thinking)
        yield f"data: {json.dumps({'type': 'thinking', 'content': '正在解析需求...比对用户画像与预设偏好'})}\n\n"
        await asyncio.sleep(0.3)
        
        yield f"data: {json.dumps({'type': 'thinking', 'content': '已匹配激活技能组件与 MCP 数据通道...'})}\n\n"
        await asyncio.sleep(0.3)

        # Step 2: 模拟 Tool Call (如调用 MCP 数据库)
        if req.mcp_servers:
            yield f"data: {json.dumps({'type': 'tool_call', 'tool': 'mcp_db.query', 'args': '{\"limit\": 10}', 'status': 'running'})}\n\n"
            await asyncio.sleep(0.5)
            yield f"data: {json.dumps({'type': 'tool_result', 'tool': 'mcp_db.query', 'status': 'success', 'result': 'Fetched 10 items'})}\n\n"

        # Step 3: 模拟 LLM 大模型 Streaming Tokens 逐字输出
        sample_response = f"尊敬的 {req.profile.get('name', '用户') if req.profile else '用户'}：\n\n已根据您的需求和历史偏好处理完成。系统已成功加载数据并按规范 Markdown 格式排版整理完毕！"
        
        for char in sample_response:
            yield f"data: {json.dumps({'type': 'token', 'delta': char})}\n\n"
            await asyncio.sleep(0.02) # 模拟打字延迟

        # Step 4: 发送完成标记
        yield f"data: {json.dumps({'type': 'done', 'message_id': 'msg_' + str(asyncio.get_event_loop().time()), 'finish_reason': 'stop'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# 2. WebSocket 长连接交互接口
@app.websocket("/ws/chat")
async def websocket_chat_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            raw_data = await websocket.receive_text()
            payload = json.loads(raw_data)
            
            # 发送思考中
            await websocket.send_text(json.dumps({"type": "thinking", "content": "WebSocket 接收成功，Agent 思考中..."}))
            await asyncio.sleep(0.3)
            
            # 逐字返回
            reply = "这是来自于 FastAPI 后端 WebSocket 的流式响应令牌。"
            for token in reply.split():
                await websocket.send_text(json.dumps({"type": "token", "delta": token + " "}))
                await asyncio.sleep(0.05)
                
            await websocket.send_text(json.dumps({"type": "done", "status": "completed"}))
            
    except WebSocketDisconnect:
        print("WebSocket Client disconnected")

# 3. 基础 HealthCheck
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "FastAPI Agent Engine", "version": "1.0.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## 5. 前端环境变量与联调配置

在本项目根目录下的 `.env` 文件中，可以配置 Python 后端的访问地址：

```env
# FastAPI 后端 REST / SSE 服务地址
VITE_API_BASE_URL=http://localhost:8000

# FastAPI 后端 WebSocket 服务地址
VITE_WS_URL=ws://localhost:8000/ws/chat
```

启动前端开发服务器：
```bash
npm run dev
```

启动 FastAPI 后端服务器：
```bash
uvicorn main:app --reload --port 8000
```

恭喜！前端与 FastAPI 后端即刻完成**低延迟、打字机逐字返回**的智能体联调试验！
