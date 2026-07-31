"""MCP 服务器管理路由。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from src.api.deps import get_mcp_manager, get_manager
from src.mcp.config import (
    MCPServerConfig,
    load_config,
    parse_mcp_servers_json,
    save_config,
)
from src.mcp.client import MCPClientManager
from src.models import MCPServerAddRequest, MCPServerItem, MCPTestResult

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/mcp", tags=["mcp"])


def _get_shared_manager() -> MCPClientManager:
    """获取共享的 MCP 管理器，未初始化时抛出 503。"""
    mgr = get_mcp_manager()
    if mgr is None:
        raise HTTPException(503, "MCP 服务尚未初始化，请稍后重试")
    return mgr


def _status_to_item(status) -> MCPServerItem:
    """将 MCPServerStatus 转为 API 响应模型。"""
    return MCPServerItem(
        id=status.config.id,
        name=status.config.name or status.config.id,
        type=status.config.type,
        url=status.config.url,
        enabled=status.config.enabled,
        connected=status.connected,
        tool_count=len(status.tools),
        tools=[_simplify_tool(t) for t in status.tools],
        error=status.error,
    )


def _simplify_tool(tool: dict) -> dict:
    """精简工具信息用于前端展示。"""
    return {
        "name": tool.get("name", ""),
        "description": tool.get("description", ""),
        "parameters": list(tool.get("inputSchema", {}).get("properties", {}).keys())
        if tool.get("inputSchema", {}).get("properties") else [],
    }


def _resync_agent_tools(mgr: MCPClientManager) -> int:
    """MCP 工具变更后刷新 ToolManager 缓存并重建 Agent。

    ToolManager 由 lifespan 保证初始化，此处只需刷新 MCP Provider
    并触发 Agent 重建。
    """
    from src.api.deps import get_tool_manager

    tm = get_tool_manager()
    if tm is not None:
        mcp_provider = tm.get_provider("mcp")
        if mcp_provider is not None:
            mcp_provider.refresh()
        tools = tm.get_langchain_tools()
        count = len(tools)
    else:
        count = 0

    manager = get_manager()
    manager.sync_mcp_tools([])
    logger.info("Agent 工具已同步: %d 个工具", count)
    return count


@router.get("/servers", response_model=list[MCPServerItem])
async def list_servers():
    """列出所有 MCP 服务器及其连接状态。"""
    mgr = _get_shared_manager()
    return [_status_to_item(s) for s in mgr.servers]


@router.post("/servers", response_model=list[MCPServerItem])
async def add_server(body: MCPServerAddRequest):
    """添加 MCP 服务器。

    支持两种方式：
    1. 粘贴完整 JSON（config_json 字段），自动解析 mcpServers
    2. 逐字段填写（id, url, headers 等）
    """
    mcp_config = load_config()
    new_servers: list[MCPServerConfig] = []

    if body.config_json:
        try:
            parsed = parse_mcp_servers_json(body.config_json)
            new_servers = parsed
        except Exception as e:
            raise HTTPException(400, f"JSON 解析失败: {e}")
    elif body.id and body.url:
        new_servers = [MCPServerConfig(
            id=body.id,
            name=body.name or body.id,
            type=body.type,
            url=body.url,
            headers=body.headers or {},
        )]
    else:
        raise HTTPException(400, "请提供 config_json 或 (id + url)")

    # 合并到已有配置（同名覆盖）
    existing_ids = {s.id for s in mcp_config.servers}
    for ns in new_servers:
        if ns.id in existing_ids:
            for i, s in enumerate(mcp_config.servers):
                if s.id == ns.id:
                    mcp_config.servers[i] = ns
                    break
        else:
            mcp_config.servers.append(ns)

    save_config(mcp_config)

    # 同步到运行中的共享管理器
    mgr = _get_shared_manager()
    for ns in new_servers:
        mgr.add_server(ns)
        # 异步连接并保持会话
        try:
            await mgr.connect_and_keep(ns.id)
        except Exception:
            pass

    # 动态注入新工具到 Agent
    _resync_agent_tools(mgr)

    return [_status_to_item(s) for s in mgr.servers]


@router.delete("/servers/{server_id}")
async def delete_server(server_id: str):
    """删除 MCP 服务器。"""
    mcp_config = load_config()
    mcp_config.servers = [s for s in mcp_config.servers if s.id != server_id]
    save_config(mcp_config)

    # 同步到共享管理器
    mgr = _get_shared_manager()
    await mgr.close_session(server_id)
    mgr.remove_server(server_id)

    # 动态更新 Agent 工具
    _resync_agent_tools(mgr)

    return {"deleted": True}


@router.post("/servers/{server_id}/test", response_model=MCPTestResult)
async def test_server(server_id: str):
    """测试 MCP 服务器连接并返回工具列表。"""
    mcp_config = load_config()
    cfg = None
    for s in mcp_config.servers:
        if s.id == server_id:
            cfg = s
            break

    if not cfg:
        raise HTTPException(404, f"MCP 服务器 '{server_id}' 不存在")

    mgr = _get_shared_manager()
    # 确保管理器中有该服务器配置
    mgr.add_server(cfg)

    status = await mgr.test_connection(server_id)

    return MCPTestResult(
        server_id=server_id,
        connected=status.connected,
        tools=[_simplify_tool(t) for t in status.tools],
        tool_count=len(status.tools),
        error=status.error,
    )


@router.post("/servers/{server_id}/toggle", response_model=MCPServerItem)
async def toggle_server(server_id: str):
    """启用或禁用 MCP 服务器。"""
    mcp_config = load_config()
    found = None
    for s in mcp_config.servers:
        if s.id == server_id:
            s.enabled = not s.enabled
            found = s
            break

    if not found:
        raise HTTPException(404, f"MCP 服务器 '{server_id}' 不存在")

    save_config(mcp_config)

    # 同步到共享管理器
    mgr = _get_shared_manager()
    mgr.add_server(found)
    if found.enabled:
        try:
            await mgr.connect_and_keep(server_id)
        except Exception:
            pass
    else:
        await mgr.close_session(server_id)

    # 动态更新 Agent 工具
    _resync_agent_tools(mgr)

    return _status_to_item(mgr.get_status(server_id))
