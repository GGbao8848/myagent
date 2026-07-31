"""MCPProvider — 将外部 MCP 服务器 Tool 统一注册到 ToolManager。

封装现有的 MCPClientManager，复用其连接管理和工具发现逻辑。
每个启用的 MCP 服务器的工具会被自动聚合。

通过 ToolGateway 调用外部工具，获得超时/重试/熔断保护。
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from src.tool_manager.providers.base import ToolInfo, ToolProvider

if TYPE_CHECKING:
    from src.mcp.client import MCPClientManager
    from src.tool_manager.gateway import ToolGateway

logger = logging.getLogger(__name__)


class MCPProvider(ToolProvider):
    """将外部 MCP 服务器的 Tool 统一暴露给 Agent。

    工具发现会遍历所有已连接且启用的 MCP 服务器，聚合其工具列表。
    工具调用通过 ToolGateway 路由到正确的服务器，获得超时/重试/熔断保护。
    """

    def __init__(
        self,
        mcp_manager: "MCPClientManager",
        gateway: "ToolGateway | None" = None,
    ) -> None:
        self._mcp_manager = mcp_manager
        self._gateway = gateway
        self._tool_to_server: dict[str, str] = {}
        self._tools_cache: list[ToolInfo] | None = None

    @property
    def id(self) -> str:
        return "mcp"

    def discover(self) -> list[ToolInfo]:
        """从所有已连接且启用的 MCP 服务器聚合工具定义。"""
        self._tool_to_server = {}
        all_tools: list[ToolInfo] = []

        for status in self._mcp_manager.servers:
            if not status.connected or not status.config.enabled:
                continue
            sid = status.config.id
            for tool_dict in status.tools:
                name = tool_dict.get("name", "")
                if name:
                    self._tool_to_server[name] = sid

                tool_info: ToolInfo = {
                    "name": name,
                    "description": tool_dict.get("description", ""),
                    "inputSchema": tool_dict.get("inputSchema", {"type": "object", "properties": {}}),
                }
                all_tools.append(tool_info)

        self._tools_cache = all_tools
        logger.debug(
            "MCPProvider: 发现 %d 个工具，来自 %d 个已连接服务器",
            len(all_tools),
            len([s for s in self._mcp_manager.servers if s.connected]),
        )
        return all_tools

    def call(self, tool_name: str, arguments: dict) -> str:
        """将工具调用路由到正确的 MCP 服务器。

        通过 ToolGateway 调用（如果已配置），获得超时/重试/熔断保护。
        需要 asyncio.run() 桥接，因为 MCPClientManager.call_tool() 是 async 的。
        """
        import asyncio

        server_id = self._tool_to_server.get(tool_name)
        if not server_id:
            return json.dumps({
                "error": f"MCP 工具 '{tool_name}' 未在任何已连接的服务器上找到",
            })

        async def _call() -> str:
            return await self._mcp_manager.call_tool(server_id, tool_name, arguments)

        tool_key = f"mcp:{server_id}:{tool_name}"

        try:
            if self._gateway is not None:
                return asyncio.run(self._gateway.call(tool_key, _call))
            else:
                return asyncio.run(_call())
        except Exception as exc:
            logger.warning(
                "MCPProvider.call('%s') 失败 (server=%s): %s",
                tool_name, server_id, exc,
            )
            return json.dumps({
                "error": str(exc),
                "tool": tool_name,
                "server": server_id,
            })

    def health_check(self) -> bool:
        """检查至少有一个 MCP 服务器已连接。"""
        return any(s.connected for s in self._mcp_manager.servers)

    def refresh(self) -> None:
        """刷新 MCP 工具缓存。"""
        self._tools_cache = None
        self._tool_to_server = {}
        logger.info("MCPProvider: 缓存已刷新")
