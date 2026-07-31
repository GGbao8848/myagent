"""RemoteToolProvider — 管理通过 HTTP API 注册的外部 Tool。

每个 Tool 是独立部署的 HTTP 服务。Provider 负责：
  - 存储远程 Tool 定义
  - 将 Tool 注册到 Agent
  - 通过 HTTP POST 调用 Tool
  - 健康检查轮询（自动禁用不健康的 Tool）
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING

import httpx

from src.tool_manager.providers.base import ToolInfo, ToolProvider

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# 健康检查配置
HEALTH_CHECK_INTERVAL = 30.0     # 轮询间隔（秒）
HEALTH_CHECK_TIMEOUT = 5.0       # 单次健康检查超时
HEALTH_CHECK_MAX_FAILURES = 3    # 连续失败 N 次后自动禁用


class RemoteToolProvider(ToolProvider):
    """管理通过 HTTP API 注册的外部 Tool。

    外部 Tool 通过 POST /api/tools/register 注册到此 Provider，
    Agent 自动发现并可使用。

    用法:
        provider = RemoteToolProvider()
        provider.register({...})
        provider.start_health_polling()  # 异步启动
        ...
        provider.stop_health_polling()   # 异步停止
    """

    def __init__(self) -> None:
        self._tools: dict[str, dict] = {}            # tool_name → registration info
        self._health_failures: dict[str, int] = {}   # tool_name → 连续失败次数
        self._health_task: asyncio.Task | None = None
        self._on_change_callback: callable | None = None

    def set_on_change_callback(self, callback: callable) -> None:
        """设置 Tool 变更回调（由 ToolManager 注册，用于触发 Agent 重建）。"""
        self._on_change_callback = callback

    @property
    def id(self) -> str:
        return "remote"

    # ── 注册 / 注销 ────────────────────────────────────

    def register(self, info: dict) -> None:
        """注册一个远程 Tool。

        Args:
            info: Tool 注册信息，格式:
                {
                    "name": "query_erp_order",
                    "description": "查询ERP工单",
                    "endpoint": "http://localhost:8080/call",
                    "version": "1.0.0",
                    "inputSchema": {"type": "object", "properties": {...}}
                }
        """
        name = info["name"]
        info.setdefault("version", "1.0.0")
        info.setdefault("inputSchema", {"type": "object", "properties": {}})
        info.setdefault("enabled", True)
        self._tools[name] = info
        self._health_failures.pop(name, None)
        logger.info("RemoteToolProvider: 注册工具 '%s' (endpoint=%s)", name, info["endpoint"])

    def unregister(self, tool_name: str) -> bool:
        """注销一个远程 Tool。返回 True 表示成功。"""
        if tool_name in self._tools:
            del self._tools[tool_name]
            self._health_failures.pop(tool_name, None)
            logger.info("RemoteToolProvider: 注销工具 '%s'", tool_name)
            return True
        return False

    def set_enabled(self, tool_name: str, enabled: bool) -> bool:
        """启用或禁用一个 Tool。"""
        if tool_name in self._tools:
            self._tools[tool_name]["enabled"] = enabled
            if enabled:
                self._health_failures.pop(tool_name, None)
            return True
        return False

    # ── ToolProvider 接口 ──────────────────────────────

    def discover(self) -> list[ToolInfo]:
        """返回所有已注册且启用的远程 Tool 定义。"""
        result: list[ToolInfo] = []
        for name, info in self._tools.items():
            if not info.get("enabled", True):
                continue
            result.append({
                "name": name,
                "description": info.get("description", ""),
                "inputSchema": info.get("inputSchema", {"type": "object", "properties": {}}),
            })
        return result

    def call(self, tool_name: str, arguments: dict) -> str:
        """通过 HTTP POST 调用远程 Tool。

        需要 asyncio.run() 桥接，因为 agent 在同步上下文中运行。
        """
        if tool_name not in self._tools:
            return json.dumps({"error": f"远程工具 '{tool_name}' 未注册"})

        info = self._tools[tool_name]
        endpoint = info["endpoint"]

        async def _post() -> str:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.post(endpoint, json=arguments)
                    resp.raise_for_status()
                    return resp.text
            except httpx.HTTPError as exc:
                return json.dumps({"error": str(exc), "tool": tool_name, "endpoint": endpoint})

        try:
            return asyncio.run(_post())
        except Exception as exc:
            logger.warning("RemoteToolProvider.call('%s') 失败: %s", tool_name, exc)
            return json.dumps({"error": str(exc), "tool": tool_name})

    def health_check(self) -> bool:
        """同步探测：至少有一个已注册的远程 Tool 健康。"""
        if not self._tools:
            return True  # 没有远程 Tool 不算不健康
        enabled = [n for n, i in self._tools.items() if i.get("enabled", True)]
        if not enabled:
            return True
        healthy = [n for n in enabled if n not in self._health_failures]
        return len(healthy) > 0 or len(self._health_failures) < len(enabled)

    # ── 健康检查轮询（异步，由 lifespan 启动）──────────

    async def start_health_polling(self, interval: float = HEALTH_CHECK_INTERVAL) -> None:
        """启动后台健康检查轮询。"""
        if self._health_task is not None:
            return
        self._health_task = asyncio.create_task(self._poll_loop(interval))
        logger.info("RemoteToolProvider: 健康检查轮询已启动 (interval=%ss)", interval)

    async def stop_health_polling(self) -> None:
        """停止健康检查轮询。"""
        if self._health_task is not None:
            self._health_task.cancel()
            try:
                await self._health_task
            except asyncio.CancelledError:
                pass
            self._health_task = None
            logger.info("RemoteToolProvider: 健康检查轮询已停止")

    async def _poll_loop(self, interval: float) -> None:
        """后台轮询循环。"""
        while True:
            await asyncio.sleep(interval)
            await self._poll_all()

    async def _poll_all(self) -> None:
        """对所有已注册的远程 Tool 执行健康检查。"""
        for name, info in list(self._tools.items()):
            if not info.get("enabled", True):
                continue
            try:
                ok = await self._check_one(name, info["endpoint"])
                if ok:
                    self._health_failures.pop(name, None)
                else:
                    self._on_failure(name)
            except Exception:
                self._on_failure(name)

    async def _check_one(self, name: str, endpoint: str) -> bool:
        """探测单个 Tool 的 /health 端点。"""
        try:
            health_url = endpoint.rstrip("/") + "/health"
            async with httpx.AsyncClient(timeout=HEALTH_CHECK_TIMEOUT) as client:
                resp = await client.get(health_url)
                return resp.status_code == 200
        except Exception:
            return False

    def _on_failure(self, name: str) -> None:
        """处理健康检查失败，累计到阈值后自动禁用。"""
        failures = self._health_failures.get(name, 0) + 1
        self._health_failures[name] = failures

        if failures >= HEALTH_CHECK_MAX_FAILURES:
            self._tools[name]["enabled"] = False
            logger.warning(
                "RemoteToolProvider: '%s' 连续 %d 次健康检查失败，已自动禁用",
                name, failures,
            )
            # 触发 Agent 重建（通过 ToolManager 注册的回调）
            if self._on_change_callback is not None:
                self._on_change_callback()

    # ── 查询 ──────────────────────────────────────────

    def list_tools(self) -> list[dict]:
        """返回所有已注册的远程 Tool（含健康状态）。"""
        result = []
        for name, info in self._tools.items():
            result.append({
                "name": name,
                "description": info.get("description", ""),
                "endpoint": info.get("endpoint", ""),
                "version": info.get("version", "1.0.0"),
                "enabled": info.get("enabled", True),
                "healthy": name not in self._health_failures,
            })
        return result

    def get_tool(self, tool_name: str) -> dict | None:
        """获取单个远程 Tool 的注册信息。"""
        info = self._tools.get(tool_name)
        if info is None:
            return None
        return {
            **info,
            "healthy": tool_name not in self._health_failures,
        }
