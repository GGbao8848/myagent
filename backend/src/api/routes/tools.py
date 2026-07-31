"""远程 Tool 注册与管理路由 — Tool Registry 的 HTTP 接口。

外部 Tool 通过此 API 注册到 Agent，自动被发现和调用。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from src.api.deps import get_manager, get_tool_manager
from src.models import DeleteResult, RemoteToolInput, RemoteToolItem

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tools", tags=["tools"])


def _get_remote_provider():
    """获取 RemoteToolProvider 实例。未注册时返回 None。"""
    tm = get_tool_manager()
    if tm is None:
        return None
    return tm.get_provider("remote")


def _resync_agent() -> None:
    """刷新 ToolManager 缓存并重建 Agent。"""
    tm = get_tool_manager()
    if tm is not None:
        tm.refresh()


@router.get("", response_model=list[RemoteToolItem])
async def list_tools():
    """列出所有已注册的远程 Tool（含健康状态）。"""
    provider = _get_remote_provider()
    if provider is None:
        return []
    return provider.list_tools()


@router.post("/register", response_model=RemoteToolItem)
async def register_tool(body: RemoteToolInput):
    """注册一个外部 Tool。

    外部 Tool 调用此端点后，Agent 自动发现该 Tool 并在后续对话中使用。

    请求格式:
        {
            "name": "query_erp_order",
            "description": "查询 ERP 工单",
            "endpoint": "http://localhost:8080/call",
            "version": "1.0.0",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "工单号"}
                },
                "required": ["order_id"]
            }
        }

    Tool 规范要求:
      - 必须实现 POST endpoint 接收 JSON 参数，返回字符串结果
      - 建议实现 GET /health 端点用于健康检查（返回 200 = 健康）
    """
    provider = _get_remote_provider()
    if provider is None:
        raise HTTPException(503, "Tool Registry 尚未初始化")

    # 检查是否已注册
    existing = provider.get_tool(body.name)
    if existing is not None:
        raise HTTPException(409, f"Tool '{body.name}' 已注册，请先注销后再重新注册")

    provider.register(body.model_dump())
    _resync_agent()

    return RemoteToolItem(
        name=body.name,
        description=body.description,
        endpoint=body.endpoint,
        version=body.version,
        enabled=True,
        healthy=True,
    )


@router.delete("/{tool_name}", response_model=DeleteResult)
async def unregister_tool(tool_name: str):
    """注销一个远程 Tool。"""
    provider = _get_remote_provider()
    if provider is None:
        raise HTTPException(503, "Tool Registry 尚未初始化")

    if not provider.unregister(tool_name):
        raise HTTPException(404, f"Tool '{tool_name}' 不存在")
    _resync_agent()
    return DeleteResult(deleted=True)


@router.put("/{tool_name}/toggle", response_model=RemoteToolItem)
async def toggle_tool(tool_name: str):
    """启用或禁用一个远程 Tool。"""
    provider = _get_remote_provider()
    if provider is None:
        raise HTTPException(503, "Tool Registry 尚未初始化")

    info = provider.get_tool(tool_name)
    if info is None:
        raise HTTPException(404, f"Tool '{tool_name}' 不存在")

    new_enabled = not info.get("enabled", True)
    provider.set_enabled(tool_name, new_enabled)
    _resync_agent()
    return RemoteToolItem(
        name=tool_name,
        description=info.get("description", ""),
        endpoint=info.get("endpoint", ""),
        version=info.get("version", "1.0.0"),
        enabled=new_enabled,
        healthy=info.get("healthy", True),
    )


@router.get("/{tool_name}", response_model=RemoteToolItem)
async def get_tool(tool_name: str):
    """获取单个远程 Tool 的详细信息。"""
    provider = _get_remote_provider()
    if provider is None:
        raise HTTPException(503, "Tool Registry 尚未初始化")

    info = provider.get_tool(tool_name)
    if info is None:
        raise HTTPException(404, f"Tool '{tool_name}' 不存在")

    return RemoteToolItem(
        name=tool_name,
        description=info.get("description", ""),
        endpoint=info.get("endpoint", ""),
        version=info.get("version", "1.0.0"),
        enabled=info.get("enabled", True),
        healthy=info.get("healthy", True),
    )
