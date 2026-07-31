"""MCP 工具 → LangChain 工具适配器。"""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

from langchain_core.tools import tool

if TYPE_CHECKING:
    from src.mcp.client import MCPClientManager


def mcp_tools_to_langchain(
    mcp_tools: list[dict],
    manager: "MCPClientManager | None" = None,
    server_id: str | None = None,
) -> list:
    """将 MCP Tool 字典列表转换为 LangChain @tool 装饰的函数。

    每个 MCP Tool 格式:
    {
        "name": "tool_name",
        "description": "...",
        "inputSchema": {"type": "object", "properties": {...}}
    }

    参数:
        mcp_tools: MCP 工具字典列表
        manager: MCPClientManager 实例（用于真实工具调用）
        server_id: 对应的 MCP 服务器 ID

    返回 LangChain BaseTool 列表，可直接传给 create_deep_agent(tools=[...])。
    """
    langchain_tools = []
    for mcp_tool in mcp_tools:
        lc_tool = _create_single_tool(mcp_tool, manager, server_id)
        if lc_tool:
            langchain_tools.append(lc_tool)
    return langchain_tools


def _create_single_tool(
    mcp_tool: dict,
    manager: "MCPClientManager | None" = None,
    server_id: str | None = None,
):
    """为单个 MCP 工具创建 LangChain tool。"""
    from src.tool_manager.providers.base import _build_args_schema

    tool_name = mcp_tool.get("name", "unknown")
    description = mcp_tool.get("description", "")
    input_schema = mcp_tool.get("inputSchema", {})

    # 保存 MCP 工具元数据
    tool_meta = {
        "mcp_name": tool_name,
        "mcp_server_id": server_id,
        "mcp_input_schema": input_schema,
    }

    # 从 inputSchema 生成 Pydantic args_schema（复用 base.py 的通用实现）
    args_schema = _build_args_schema(tool_name, input_schema) if input_schema else None

    # 根据是否有 manager 决定创建真正调用还是降级 stub
    if manager is not None and server_id is not None:
        # 真实 MCP 调用 — 通过 asyncio.run() 桥接（agent 在线程池中运行）
        @tool(name_or_callable=tool_name, description=description, args_schema=args_schema)
        def mcp_tool_wrapper(**kwargs) -> str:
            """通过 MCP 客户端调用远程工具。"""
            return asyncio.run(manager.call_tool(server_id, tool_name, kwargs))
    else:
        # 降级模式 — 返回占位结果（测试 / 离线场景）
        @tool(name_or_callable=tool_name, description=description, args_schema=args_schema)
        def mcp_tool_wrapper(**kwargs) -> str:
            """MCP 工具（未连接 MCP Manager，返回占位结果）。"""
            return json.dumps({
                "mcp_tool": tool_name,
                "arguments": kwargs,
                "status": "not_connected",
            })

    # 附加元数据
    mcp_tool_wrapper.metadata = tool_meta
    return mcp_tool_wrapper


