"""SandboxProvider — 持有沙箱引用，提供健康检查和未来的管理 API。

文件/执行工具（read_file, write_file, execute 等）由 deepagents
框架内置提供，此处不重复注册。
"""

from __future__ import annotations

import json
import logging

from src.tool_manager.providers.base import ToolInfo, ToolProvider

logger = logging.getLogger(__name__)


class SandboxProvider(ToolProvider):
    """持有沙箱后端引用，提供健康检查和未来的沙箱管理 API。

    文件/执行工具由 deepagents 框架内置提供，不在此注册。

    支持 local 和 daytona 两种沙箱，通过 set_sandbox() 注入。
    """

    def __init__(self, sandbox=None) -> None:
        self._sandbox = sandbox

    @property
    def id(self) -> str:
        return "sandbox"

    def set_sandbox(self, sandbox) -> None:
        """注入沙箱后端（LocalSandbox 或 DaytonaSandbox）。"""
        self._sandbox = sandbox

    def discover(self) -> list[ToolInfo]:
        """沙箱文件/执行工具由 deepagents 框架内置提供（ls, read_file,
        write_file, edit_file, glob, grep, execute），此处不重复注册。

        SandboxProvider 仅保留沙箱引用，供 health_check() 和未来
        的沙箱管理 API（重启、状态查询）使用。
        """
        return []

    def health_check(self) -> bool:
        """检测沙箱是否存活。"""
        if self._sandbox is None:
            return False
        try:
            result = self._sandbox.execute("echo ok", timeout=5)
            return result.exit_code == 0
        except Exception:
            return False

    def call(self, tool_name: str, arguments: dict) -> str:
        """当前无注册工具，不会被框架调用。预留给未来的沙箱管理 API。"""
        return json.dumps({"error": f"SandboxProvider 未注册工具: {tool_name}"})
