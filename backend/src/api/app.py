"""FastAPI 应用 — 生命周期、中间件、静态文件、ToolManager 初始化。"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.app import AgentManager
from src.config import WEBUI_DIR
from src.api import deps
from src.api.routes import chat, health, mcp, profile, sessions, settings, skills, tools
from src.mcp.config import load_config
from src.mcp.client import MCPClientManager
from src.tool_manager import ToolManager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── 1. 初始化 MCP 客户端管理器 ──────────────────
    mcp_config = load_config()
    deps._mcp_manager = MCPClientManager(mcp_config.servers)

    # ── 2. 连接所有启用的 MCP 服务器 ─────────────────
    try:
        await deps._mcp_manager.connect_all_keep()
        connected_count = sum(
            1 for s in deps._mcp_manager.servers if s.connected
        )
        if connected_count > 0:
            logger.info("MCP: 已连接 %d 个服务器", connected_count)
    except Exception as e:
        logger.warning("MCP 初始化失败（agent 仍可正常运行）: %s", e)

    # ── 3. 创建 ToolManager — 插件化注册所有 Tool ────
    deps._tool_manager = ToolManager.get_instance()
    deps._tool_manager.init_defaults(
        sandbox_backend=None,          # 延后：Agent 创建时才注入沙箱
        mcp_manager=deps._mcp_manager,
    )

    # ── 4. 启动远程 Tool 健康检查轮询 ─────────────
    await deps._tool_manager.start_health_polling()

    # ── 5. 创建 AgentManager — 通过 ToolManager 获取 Tool ──
    deps._manager = AgentManager.get_instance(
        tool_manager=deps._tool_manager,
    )

    yield

    # ── 6. 清理 ─────────────────────────────────────
    await deps._tool_manager.stop_health_polling()
    if deps._mcp_manager:
        try:
            await deps._mcp_manager.close_all_sessions()
        except Exception:
            pass
    if deps._manager:
        deps._manager.cleanup()


app = FastAPI(title="BR Agent", version="0.1.0", lifespan=lifespan)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request ID 中间件（纯 ASGI 版）─────────────────
# 不用 BaseHTTPMiddleware：它用 create_collapsing_task_group 包裹请求，
# 与 mcp SDK 的 httpx SSE 长连接在 anyio 4.x 下冲突，导致请求被取消(500)。
# 纯 ASGI 中间件不做任务组嵌套，长连接路由（MCP test / SSE chat）不受影响。
from starlette.types import ASGIApp, Receive, Scope, Send


class RequestIDMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        rid = scope["headers"] and next(
            (v.decode() for k, v in scope["headers"] if k == b"x-request-id"), None
        ) or uuid.uuid4().hex[:12]

        async def _send(message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", rid.encode()))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, _send)


app.add_middleware(RequestIDMiddleware)


# ── 路由注册 ──
# sessions / chat 在各自路由内通过 Depends(get_current_user) 做认证与用户隔离
app.include_router(health.router)
app.include_router(sessions.router)
app.include_router(chat.router)
app.include_router(skills.router)
app.include_router(profile.router)
app.include_router(mcp.router)
app.include_router(settings.router)
app.include_router(tools.router)

if WEBUI_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEBUI_DIR), html=True), name="webui")
