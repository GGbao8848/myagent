"""MCP 服务器管理路由（配置存 PG，连接管理保持运行时）。"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException

from src.api.auth import get_current_user
from src.api.deps import get_db, get_mcp_manager, get_manager
from src.mcp.config import (
    MCPServerConfig,
    parse_mcp_servers_json,
)
from src.mcp.client import MCPClientManager
from src.models import MCPServerAddRequest, MCPServerItem, MCPTestResult

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/mcp", tags=["mcp"])


def _username(user: dict) -> str:
    return user.get("username", user.get("sub", ""))


def _db_server_to_config(row: dict) -> MCPServerConfig:
    """把 PG 行转成运行时 MCPServerConfig。"""
    return MCPServerConfig(
        id=row["id"],
        name=row["name"],
        type=row["type"],
        url=row["url"],
        command=row["command"],
        args=row["args"],
        headers=row["headers"],
        enabled=row["enabled"],
    )


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
        error=status.error or "",
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
async def list_servers(user: dict = Depends(get_current_user)):
    """列出 MCP 服务器（公共 + 当前用户私有）及其连接状态。"""
    owner = _username(user)
    db = get_db()
    rows = db.list_mcp_servers(owner)
    mgr = _get_shared_manager()
    items = []
    for row in rows:
        # 找运行时的连接状态
        status = next((s for s in mgr.servers if s.config.id == row["id"]), None)
        if status:
            items.append(_status_to_item(status))
        else:
            # PG 有但运行时未连接 → 显示未连接
            items.append(MCPServerItem(
                id=row["id"], name=row["name"], type=row["type"],
                url=row["url"], enabled=row["enabled"],
                connected=False, tool_count=0, tools=[], error="",
            ))
    return items


@router.post("/servers", response_model=list[MCPServerItem])
async def add_server(body: MCPServerAddRequest, user: dict = Depends(get_current_user)):
    """添加 MCP 服务器（存 PG，公共或当前用户私有）。

    支持两种方式：
    1. 粘贴完整 JSON（config_json 字段），自动解析 mcpServers
    2. 逐字段填写（id, url, headers 等）
    """
    owner = _username(user)
    db = get_db()
    new_servers: list[MCPServerConfig] = []

    if body.config_json:
        try:
            new_servers = parse_mcp_servers_json(body.config_json)
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

    # 存入 PG（带 owner）
    for ns in new_servers:
        # 公共配置（config_json 里的）存为公共，逐字段添加的存为当前用户私有
        item_owner = "" if body.config_json else owner
        db.save_mcp_server({
            "id": ns.id, "name": ns.name or ns.id, "type": ns.type,
            "url": ns.url or "", "command": ns.command or "", "args": ns.args or [],
            "headers": ns.headers or {}, "owner": item_owner, "enabled": ns.enabled,
        })

    # 同步到运行中的共享管理器（只加配置，不自动连接，避免失败破坏请求）
    mgr = _get_shared_manager()
    for ns in new_servers:
        try:
            mgr.add_server(ns)
        except Exception:
            logger.warning("MCP 服务器 %s 注册到运行时失败", ns.id)

    # 动态注入新工具到 Agent
    try:
        _resync_agent_tools(mgr)
    except Exception:
        logger.warning("MCP 工具同步失败", exc_info=True)

    return [_status_to_item(s) for s in mgr.servers]


@router.delete("/servers/{server_id}")
async def delete_server(server_id: str, user: dict = Depends(get_current_user)):
    """删除 MCP 服务器（仅能删自己的私有配置）。"""
    owner = _username(user)
    db = get_db()
    if not db.delete_mcp_server(server_id, owner):
        raise HTTPException(404, f"MCP 服务器 '{server_id}' 不存在或无权删除")

    # 同步到共享管理器
    mgr = _get_shared_manager()
    await mgr.close_session(server_id)
    mgr.remove_server(server_id)

    # 动态更新 Agent 工具
    _resync_agent_tools(mgr)

    return {"deleted": True}


@router.post("/servers/{server_id}/test", response_model=MCPTestResult)
async def test_server(server_id: str, user: dict = Depends(get_current_user)):
    """测试 MCP 服务器连接并返回工具列表。"""
    owner = _username(user)
    db = get_db()
    rows = db.list_mcp_servers(owner)
    row = next((r for r in rows if r["id"] == server_id), None)
    if not row:
        raise HTTPException(404, f"MCP 服务器 '{server_id}' 不存在")

    cfg = _db_server_to_config(row)

    mgr = _get_shared_manager()
    # 确保管理器中有该服务器配置
    mgr.add_server(cfg)

    status = await mgr.test_connection(server_id)

    return MCPTestResult(
        server_id=server_id,
        connected=status.connected,
        tools=[_simplify_tool(t) for t in status.tools],
        tool_count=len(status.tools),
        error=status.error or "",
    )


@router.post("/servers/{server_id}/toggle", response_model=MCPServerItem)
async def toggle_server(server_id: str, user: dict = Depends(get_current_user)):
    """启用或禁用 MCP 服务器。"""
    owner = _username(user)
    db = get_db()
    rows = db.list_mcp_servers(owner)
    row = next((r for r in rows if r["id"] == server_id), None)
    if not row:
        raise HTTPException(404, f"MCP 服务器 '{server_id}' 不存在")

    new_enabled = not row["enabled"]
    db.update_mcp_server(server_id, owner, enabled=new_enabled)
    row["enabled"] = new_enabled
    cfg = _db_server_to_config(row)

    # 同步到共享管理器
    mgr = _get_shared_manager()
    try:
        mgr.add_server(cfg)
    except Exception:
        logger.warning("MCP 服务器 %s 注册到运行时失败", server_id)
    if new_enabled:
        try:
            await mgr.connect_and_keep(server_id)
        except Exception:
            logger.warning("MCP 服务器 %s 连接失败", server_id)
    else:
        try:
            await mgr.close_session(server_id)
        except Exception:
            pass

    # 动态更新 Agent 工具
    _resync_agent_tools(mgr)

    return _status_to_item(mgr.get_status(server_id))
