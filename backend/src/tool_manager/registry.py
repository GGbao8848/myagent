"""ToolRegistry — 工具注册中心。

管理所有 ToolProvider，聚合 Tool 定义，支持动态注册/注销。
Stage 3 为进程内注册（dict），Stage 4 可替换为网络 RegistryClient。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.tool_manager.providers.base import ToolInfo, ToolProvider

logger = logging.getLogger(__name__)


class ToolRegistry:
    """工具注册中心 — 管理 ToolProvider 生命周期。

    线程安全：写操作仅在启动或管理 API 调用时发生（低频率），
    读操作使用 copy-on-read 避免锁竞争。
    """

    def __init__(self) -> None:
        self._providers: dict[str, "ToolProvider"] = {}

    # ── 注册 / 注销 ──────────────────────────────────────────

    def register(self, provider: "ToolProvider") -> None:
        """注册 Provider（同名覆盖）。"""
        self._providers[provider.id] = provider
        logger.info("ToolRegistry: 注册 Provider '%s'", provider.id)

    def unregister(self, provider_id: str) -> None:
        """注销 Provider。"""
        if provider_id in self._providers:
            del self._providers[provider_id]
            logger.info("ToolRegistry: 注销 Provider '%s'", provider_id)

    # ── 查询 ──────────────────────────────────────────────────

    def get_provider(self, provider_id: str) -> "ToolProvider | None":
        """获取指定 Provider。"""
        return self._providers.get(provider_id)

    def list_providers(self) -> list["ToolProvider"]:
        """返回所有已注册 Provider 的列表。"""
        return list(self._providers.values())

    # ── Tool 发现 ────────────────────────────────────────────

    def discover_all(self) -> dict[str, list["ToolInfo"]]:
        """从所有 Provider 发现 Tool 定义。

        Returns:
            {provider_id: [ToolInfo, ...]}，失败的 Provider 返回空列表。
        """
        result: dict[str, list["ToolInfo"]] = {}
        for pid, provider in self._providers.items():
            try:
                tools = provider.discover()
                result[pid] = tools
                if tools:
                    logger.debug(
                        "ToolRegistry: Provider '%s' 发现 %d 个工具", pid, len(tools)
                    )
            except Exception:
                logger.warning(
                    "ToolRegistry: Provider '%s' discover() 失败", pid, exc_info=True
                )
                result[pid] = []
        return result

    def call_tool(self, tool_name: str, arguments: dict) -> str:
        """在所有 Provider 中查找并调用指定 Tool。

        遍历所有 Provider 的 discover() 结果，找到第一个匹配的 Tool
        后委托给对应 Provider 的 call()。

        Args:
            tool_name: Tool 名称
            arguments: 参数字典

        Returns:
            Tool 执行结果字符串

        Raises:
            ValueError: 找不到对应的 Tool
        """
        for provider in self._providers.values():
            try:
                for tool in provider.discover():
                    if tool["name"] == tool_name:
                        return provider.call(tool_name, arguments)
            except Exception:
                logger.debug(
                    "ToolRegistry: Provider '%s' 查找失败", provider.id, exc_info=True
                )

        raise ValueError(f"Tool '{tool_name}' 未在任何 Provider 中注册")

    # ── 生命周期 ──────────────────────────────────────────────

    def refresh_all(self) -> None:
        """刷新所有 Provider 的 Tool 列表。"""
        for provider in self._providers.values():
            try:
                provider.refresh()
            except Exception:
                logger.warning(
                    "ToolRegistry: Provider '%s' refresh() 失败",
                    provider.id,
                    exc_info=True,
                )

    @property
    def total_tools(self) -> int:
        """所有 Provider 提供的 Tool 总数。"""
        return sum(
            len(tools)
            for tools in self.discover_all().values()
        )
