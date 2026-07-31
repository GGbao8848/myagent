"""ToolManager — Agent 的唯一 Tool 入口。

单例模式，统一管理所有 ToolProvider 的注册、发现、转换。
Agent factory 和 API routes 都通过 ToolManager 获取 Tool。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from src.tool_manager.providers.base import provider_to_langchain_tools
from src.tool_manager.registry import ToolRegistry

if TYPE_CHECKING:
    from src.tool_manager.providers.base import ToolProvider

logger = logging.getLogger(__name__)


class ToolManager:
    """工具管理器单例。

    职责：
      1. 持有 ToolRegistry，管理 Provider 生命周期
      2. 将 Provider 的 Tool 转换为 LangChain Tool
      3. 管理 LangChain Tool 缓存
      4. 提供 Agent 重建回调

    用法：
        tm = ToolManager.get_instance()
        tm.init_defaults(sandbox_backend=None, mcp_manager=None)
        tools = tm.get_langchain_tools()
        agent = create_deep_agent(tools=tools, ...)
    """

    _instance: "ToolManager | None" = None

    def __init__(self) -> None:
        self._registry = ToolRegistry()
        self._on_change_callbacks: list = []
        self._tools_cache: list | None = None
        self._remote_provider = None  # 由 init_defaults() 设置

    @classmethod
    def get_instance(cls) -> "ToolManager":
        """获取或创建单例实例。"""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        """重置单例（测试用）。"""
        cls._instance = None

    # ══════════════════════════════════════════════════════════
    # 初始化
    # ══════════════════════════════════════════════════════════

    def init_defaults(
        self,
        sandbox_backend=None,
        mcp_manager=None,
    ) -> None:
        """注册所有内置 Provider。

        按顺序注册：
          1. SandboxProvider    — 沙箱执行能力
          2. SkillProvider      — 技能系统
          3. MCPProvider        — 外部 MCP 服务器（可选，含 ToolGateway 保护）
          4. RemoteToolProvider — 远程 HTTP Tool 注册中心
        """
        from src.tool_manager.providers.sandbox import SandboxProvider
        from src.tool_manager.providers.skills import SkillProvider
        from src.tool_manager.providers.remote import RemoteToolProvider

        # 1. 沙箱
        sandbox_provider = SandboxProvider(sandbox_backend)
        self._registry.register(sandbox_provider)

        # 2. 技能
        self._registry.register(SkillProvider())

        # 3. MCP（如果有）— 通过 ToolGateway 调用
        if mcp_manager is not None:
            from src.tool_manager.gateway import ToolGateway
            from src.tool_manager.providers.mcp import MCPProvider

            gateway = ToolGateway()
            self._registry.register(MCPProvider(mcp_manager, gateway=gateway))
            logger.info("ToolManager: ToolGateway 已启用（MCP 调用保护）")

        # 4. 远程 Tool 注册中心
        remote_provider = RemoteToolProvider()
        remote_provider.set_on_change_callback(self._on_remote_tool_change)
        self._registry.register(remote_provider)
        self._remote_provider = remote_provider

        logger.info(
            "ToolManager: 初始化完成，%d 个 Provider，%d 个工具",
            len(self._registry.list_providers()),
            self._registry.total_tools,
        )

    async def start_health_polling(self) -> None:
        """启动远程 Tool 健康检查轮询（由 lifespan 调用）。"""
        provider = self._registry.get_provider("remote")
        if provider is not None and hasattr(provider, "start_health_polling"):
            await provider.start_health_polling()

    async def stop_health_polling(self) -> None:
        """停止远程 Tool 健康检查轮询（由 lifespan 调用）。"""
        provider = self._registry.get_provider("remote")
        if provider is not None and hasattr(provider, "stop_health_polling"):
            await provider.stop_health_polling()

    def _on_remote_tool_change(self) -> None:
        """远程 Tool 健康状态变化 → 刷新缓存 + 通知 Agent 重建。"""
        self._invalidate_cache()
        self._notify_change()

    def set_sandbox(self, sandbox_backend) -> None:
        """设置或更新沙箱后端。

        Agent 创建后才能拿到 sandbox 实例，所以需要延后注入。

        Args:
            sandbox_backend: LocalSandbox 或 DaytonaSandbox 实例。
        """
        provider = self._registry.get_provider("sandbox")
        if provider is not None:
            provider.set_sandbox(sandbox_backend)  # type: ignore[attr-defined]
            self._invalidate_cache()
            logger.info("ToolManager: 沙箱已注入 SandboxProvider")

    # ══════════════════════════════════════════════════════════
    # LangChain Tool 获取
    # ══════════════════════════════════════════════════════════

    def refresh(self) -> None:
        """刷新所有 Provider 缓存并通知 Agent 重建。

        远程 Tool 注册/注销/状态变更后调用。
        """
        self._invalidate_cache()
        self._notify_change()

    def get_langchain_tools(self) -> list:
        """获取所有已注册的 LangChain Tool。

        结果会被缓存，直到 _invalidate_cache() 被调用。
        直接传给 create_deep_agent(tools=...)。

        Returns:
            LangChain BaseTool 列表。
        """
        if self._tools_cache is not None:
            return list(self._tools_cache)

        all_tools = []
        for provider in self._registry.list_providers():
            try:
                provider_tools = provider_to_langchain_tools(provider)
                all_tools.extend(provider_tools)
            except Exception:
                logger.warning(
                    "ToolManager: Provider '%s' 转换为 LangChain Tool 失败",
                    provider.id,
                    exc_info=True,
                )

        self._tools_cache = list(all_tools)
        logger.info("ToolManager: 共 %d 个 LangChain Tool", len(all_tools))
        return all_tools

    # ══════════════════════════════════════════════════════════
    # 动态管理
    # ══════════════════════════════════════════════════════════

    def add_mcp_server(self, mcp_manager, server_id: str) -> int:
        """动态添加 MCP 服务器后刷新。

        Args:
            mcp_manager: MCPClientManager 实例
            server_id: 服务器 ID

        Returns:
            新增工具数量
        """
        provider = self._registry.get_provider("mcp")
        if provider is None:
            # MCP provider 尚未注册，自动创建一个
            from src.tool_manager.providers.mcp import MCPProvider
            provider = MCPProvider(mcp_manager)
            self._registry.register(provider)
        else:
            provider.refresh()

        self._invalidate_cache()
        self._notify_change()
        return self._registry.total_tools

    def remove_mcp_server(self, server_id: str) -> None:
        """移除 MCP 服务器后刷新。"""
        provider = self._registry.get_provider("mcp")
        if provider is not None:
            provider.refresh()
        self._invalidate_cache()
        self._notify_change()

    def refresh_skills(self) -> None:
        """刷新技能 Provider（安装/删除 Skill 后调用）。"""
        provider = self._registry.get_provider("skills")
        if provider is not None:
            provider.refresh()
        self._invalidate_cache()
        self._notify_change()

    # ══════════════════════════════════════════════════════════
    # 变更通知
    # ══════════════════════════════════════════════════════════

    def on_change(self, callback) -> None:
        """注册 Tool 变更回调（AgentManager 用来自动重建 Agent）。"""
        self._on_change_callbacks.append(callback)

    def _notify_change(self) -> None:
        for cb in self._on_change_callbacks:
            try:
                cb()
            except Exception:
                logger.exception("ToolManager 变更回调失败")

    # ══════════════════════════════════════════════════════════
    # 查询
    # ══════════════════════════════════════════════════════════

    def get_provider(self, provider_id: str) -> "ToolProvider | None":
        """获取指定 Provider。"""
        return self._registry.get_provider(provider_id)

    @property
    def registry(self) -> ToolRegistry:
        return self._registry

    @property
    def total_tools(self) -> int:
        return self._registry.total_tools

    # ══════════════════════════════════════════════════════════
    # 内部
    # ══════════════════════════════════════════════════════════

    def _invalidate_cache(self) -> None:
        self._tools_cache = None
