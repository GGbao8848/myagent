"""Tool Manager — 插件化工具管理系统。

所有 Tool 通过 Provider 模式注册到 ToolManager，Agent 不再硬编码 Tool 列表。
新增 Tool 只需实现 ToolProvider 并注册即可，无需修改 Agent 代码。

用法:
    from src.tool_manager import ToolManager

    tm = ToolManager.get_instance()
    tm.init_defaults(sandbox_backend=my_sandbox)
    tools = tm.get_langchain_tools()
    agent = create_deep_agent(..., tools=tools, ...)
"""

from src.tool_manager.registry import ToolRegistry
from src.tool_manager.manager import ToolManager
from src.tool_manager.gateway import ToolGateway, CircuitBreakerOpenError

__all__ = ["ToolManager", "ToolRegistry", "ToolGateway", "CircuitBreakerOpenError"]
