"""依赖注入 — 打破 api/app.py ↔ routes 循环导入。"""

from __future__ import annotations

from fastapi import HTTPException

from src.app import AgentManager
from src.memory import UserProfile

# MCP 管理器（由 lifespan 初始化后设置）
_mcp_manager = None

# ToolManager（由 lifespan 初始化后设置）
_tool_manager = None


def get_mcp_manager():
    """获取共享的 MCP 客户端管理器（供路由使用）。"""
    return _mcp_manager


def get_tool_manager():
    """获取共享的 ToolManager（供路由使用）。"""
    return _tool_manager


def get_manager() -> AgentManager:
    """获取 AgentManager 单例。lifespan 保证调用前已初始化。"""
    manager = AgentManager.get_instance()
    if AgentManager._instance is None:
        raise HTTPException(503, "服务尚未就绪")
    return manager


def get_db():
    return get_manager().db


def get_profile() -> UserProfile:
    return get_manager().profile
