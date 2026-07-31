"""MCP 客户端管理器 — 连接、测试、工具列表、持久会话、工具调用。"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field

from src.mcp.config import MCPServerConfig

logger = logging.getLogger(__name__)

# 工具调用默认超时（秒）
DEFAULT_TOOL_TIMEOUT = 30.0


@dataclass
class MCPServerStatus:
    """MCP 服务器运行时状态。"""
    config: MCPServerConfig
    connected: bool = False
    tools: list[dict] = field(default_factory=list)
    error: str = ""


@dataclass
class _MCPClientSession:
    """持久化的 MCP 客户端会话，用于跨多次工具调用保持连接。"""
    server_id: str
    session: object          # mcp.client.session.ClientSession
    read_stream: object      # read 流
    write_stream: object     # write 流
    transport_ctx: object    # streamablehttp_client / stdio_client 的 context manager
    # stdio 特有
    process: object | None = None  # asyncio.subprocess.Process


class MCPClientManager:
    """管理多个 MCP 服务器的连接、工具缓存和工具调用。"""

    def __init__(self, configs: list[MCPServerConfig]):
        self._configs: dict[str, MCPServerConfig] = {}
        self._states: dict[str, MCPServerStatus] = {}
        self._tools_cache: dict[str, list] = {}        # server_id -> list of MCP tool dicts
        self._sessions: dict[str, _MCPClientSession] = {}  # 持久会话
        self._lock = asyncio.Lock()                     # 保护并发访问

        for cfg in configs:
            self._configs[cfg.id] = cfg
            self._states[cfg.id] = MCPServerStatus(config=cfg)

    # ── 属性 / 查询 ────────────────────────────────────

    @property
    def servers(self) -> list[MCPServerStatus]:
        return list(self._states.values())

    def get_status(self, server_id: str) -> MCPServerStatus | None:
        return self._states.get(server_id)

    def add_server(self, config: MCPServerConfig):
        self._configs[config.id] = config
        self._states[config.id] = MCPServerStatus(config=config)

    def remove_server(self, server_id: str):
        self._configs.pop(server_id, None)
        self._states.pop(server_id, None)
        self._tools_cache.pop(server_id, None)
        self._sessions.pop(server_id, None)

    # ── 连接测试（一次性，用完即关）────────────────────

    async def test_connection(self, server_id: str) -> MCPServerStatus:
        """测试单个 MCP 服务器连接，获取工具列表后关闭连接。"""
        cfg = self._configs.get(server_id)
        if not cfg:
            raise ValueError(f"MCP 服务器 '{server_id}' 不存在")

        status = self._states.get(server_id) or MCPServerStatus(config=cfg)
        status.connected = False
        status.tools = []
        status.error = ""

        try:
            if cfg.type == "streamablehttp":
                result = await self._connect_http(cfg)
            elif cfg.type == "stdio":
                result = await self._connect_stdio(cfg)
            else:
                status.error = f"不支持的传输类型: {cfg.type}"
                return status

            status.connected = True
            status.tools = result
            self._tools_cache[server_id] = result
        except Exception as e:
            status.error = str(e)
            logger.warning("MCP 服务器 '%s' 连接测试失败: %s", server_id, e)

        self._states[server_id] = status
        return status

    # ── 持久连接（保持会话，用于后续工具调用）──────────

    async def connect_and_keep(self, server_id: str) -> bool:
        """连接到 MCP 服务器并保持会话存活。

        返回 True 表示连接成功，会话已缓存。
        """
        cfg = self._configs.get(server_id)
        if not cfg:
            return False

        # 如果已有活跃会话，先关闭
        await self.close_session(server_id)

        try:
            if cfg.type == "streamablehttp":
                session_data = await self._connect_http_keep(cfg, server_id)
            elif cfg.type == "stdio":
                session_data = await self._connect_stdio_keep(cfg, server_id)
            else:
                status = self._states.get(server_id)
                if status:
                    status.error = f"不支持的传输类型: {cfg.type}"
                return False

            self._sessions[server_id] = session_data

            # 初始化并获取工具列表（复用 _init_and_list）
            tools = await self._init_and_list(session_data)
            self._tools_cache[server_id] = tools

            # 更新状态
            status = self._states.get(server_id)
            if status:
                status.connected = True
                status.tools = tools
                status.error = ""

            return True
        except Exception as e:
            logger.warning("MCP 服务器 '%s' 持久连接失败: %s", server_id, e)
            status = self._states.get(server_id)
            if status:
                status.connected = False
                status.error = str(e)
            return False

    async def close_session(self, server_id: str):
        """关闭指定服务器的持久会话。"""
        session_data = self._sessions.pop(server_id, None)
        if not session_data:
            return
        try:
            if session_data.session:
                await session_data.session.__aexit__(None, None, None)
        except Exception:
            pass
        try:
            if session_data.transport_ctx:
                await session_data.transport_ctx.__aexit__(None, None, None)
        except Exception:
            pass

    async def close_all_sessions(self):
        """关闭所有持久会话。"""
        for sid in list(self._sessions.keys()):
            await self.close_session(sid)

    async def connect_all_keep(self) -> dict[str, list]:
        """连接所有启用的 MCP 服务器并保持会话。

        返回 {server_id: [tool_dicts]}。
        """
        results: dict[str, list] = {}
        for server_id, cfg in self._configs.items():
            if not cfg.enabled:
                continue
            try:
                ok = await self.connect_and_keep(server_id)
                if ok:
                    results[server_id] = self._tools_cache.get(server_id, [])
            except Exception as e:
                logger.warning("connect_all_keep: '%s' 失败: %s", server_id, e)
        return results

    async def connect_all_enabled(self) -> dict[str, list]:
        """连接所有启用的 MCP 服务器（一次性，用完即关，兼容旧接口）。"""
        results: dict[str, list] = {}
        for server_id, cfg in self._configs.items():
            if not cfg.enabled:
                continue
            try:
                status = await self.test_connection(server_id)
                if status.connected:
                    results[server_id] = self._tools_cache.get(server_id, [])
            except Exception:
                pass
        return results

    # ── 工具调用 ──────────────────────────────────────

    async def call_tool(
        self, server_id: str, tool_name: str, arguments: dict,
        timeout: float = DEFAULT_TOOL_TIMEOUT,
    ) -> str:
        """调用已连接 MCP 服务器上的工具，返回 JSON 字符串结果。"""
        async with self._lock:
            session_data = self._sessions.get(server_id)
            if not session_data:
                # 尝试按需连接
                ok = await self.connect_and_keep(server_id)
                if not ok:
                    return json.dumps({"error": f"MCP 服务器 '{server_id}' 未连接"})
                session_data = self._sessions.get(server_id)
                if not session_data:
                    return json.dumps({"error": f"MCP 服务器 '{server_id}' 会话创建失败"})

        try:
            result = await asyncio.wait_for(
                session_data.session.call_tool(tool_name, arguments),
                timeout=timeout,
            )

            # 将结果内容序列化为 JSON
            content_list = []
            for item in result.content:
                if hasattr(item, "model_dump"):
                    content_list.append(item.model_dump())
                elif hasattr(item, "text"):
                    content_list.append({"type": "text", "text": item.text})
                else:
                    content_list.append({"type": "text", "text": str(item)})

            return json.dumps({
                "content": content_list,
                "isError": getattr(result, "isError", False),
            }, ensure_ascii=False)
        except asyncio.TimeoutError:
            return json.dumps({"error": f"工具 '{tool_name}' 调用超时 ({timeout}s)"})
        except Exception as e:
            logger.warning("call_tool '%s' on '%s' 失败: %s", tool_name, server_id, e)
            return json.dumps({"error": str(e)})

    def get_all_tools(self) -> list:
        """获取所有已连接服务器的 MCP 工具（原始对象列表或 dict）。"""
        all_tools = []
        for tools in self._tools_cache.values():
            all_tools.extend(tools)
        return all_tools

    # ── 私有：一次性连接（测试用）────────────────────

    async def _connect_http(self, cfg: MCPServerConfig) -> list:
        """通过 StreamableHTTP 一次性连接并获取工具列表。

        内部复用 _connect_http_keep，完成后自动关闭连接。
        """
        session_data = await self._connect_http_keep(cfg, "temp-http")
        try:
            return await self._init_and_list(session_data)
        finally:
            await self._close_transport(session_data)

    async def _connect_stdio(self, cfg: MCPServerConfig) -> list:
        """通过 stdio 一次性连接并获取工具列表。

        内部复用 _connect_stdio_keep，完成后自动关闭连接。
        """
        session_data = await self._connect_stdio_keep(cfg, "temp-stdio")
        try:
            return await self._init_and_list(session_data)
        finally:
            await self._close_transport(session_data)

    # ── 私有：持久连接（保持 context manager 存活）────

    async def _connect_http_keep(self, cfg: MCPServerConfig, server_id: str) -> _MCPClientSession:
        """建立持久 StreamableHTTP 连接，返回未关闭的 session 数据。

        session 和 transport_ctx 由 connect_and_keep 负责初始化与清理。
        """
        from mcp.client.streamable_http import streamablehttp_client

        headers = dict(cfg.headers) if cfg.headers else {}
        ctx = streamablehttp_client(url=cfg.url, headers=headers)
        read, write, _ = await ctx.__aenter__()

        return _MCPClientSession(
            server_id=server_id,
            session=None,
            read_stream=read,
            write_stream=write,
            transport_ctx=ctx,
        )

    async def _connect_stdio_keep(self, cfg: MCPServerConfig, server_id: str) -> _MCPClientSession:
        """建立持久 stdio 连接，启动子进程并保持存活。

        session 和 transport_ctx 由 connect_and_keep 负责初始化与清理。
        """
        from mcp.client.stdio import stdio_client, StdioServerParameters

        server_params = StdioServerParameters(
            command=cfg.command,
            args=cfg.args if cfg.args else [],
        )
        ctx = stdio_client(server_params)
        read, write = await ctx.__aenter__()

        process = getattr(ctx, "process", None)

        return _MCPClientSession(
            server_id=server_id,
            session=None,
            read_stream=read,
            write_stream=write,
            transport_ctx=ctx,
            process=process,
        )

    async def _init_and_list(self, session_data: _MCPClientSession) -> list:
        """初始化 ClientSession 并获取工具列表。"""
        from mcp.client.session import ClientSession

        session_data.session = await ClientSession(
            session_data.read_stream, session_data.write_stream,
        ).__aenter__()
        await session_data.session.initialize()
        result = await session_data.session.list_tools()
        return [tool.model_dump() for tool in result.tools]

    @staticmethod
    async def _close_transport(session_data: _MCPClientSession) -> None:
        """安全关闭 transport context manager。"""
        try:
            if session_data.transport_ctx:
                await session_data.transport_ctx.__aexit__(None, None, None)
        except Exception:
            pass


# ── 便捷同步方法 ────────────────────────────────────

def test_connection_sync(server_id: str, config: MCPServerConfig) -> MCPServerStatus:
    """同步测试 MCP 连接（供 API 调用）。"""
    manager = MCPClientManager([config])
    return asyncio.run(manager.test_connection(server_id))
