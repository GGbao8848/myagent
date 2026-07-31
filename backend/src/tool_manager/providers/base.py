"""ToolProvider 抽象基类 — 所有 Tool Provider 的统一接口。

每个 Provider 代表一种 Tool 来源（沙箱、技能、MCP 服务器等），
负责发现 Tool 定义、响应 Tool 调用。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TypedDict


class ToolInfo(TypedDict):
    """单个 Tool 的定义（MCP 标准格式）。"""
    name: str
    description: str
    inputSchema: dict  # JSON Schema


class ToolProvider(ABC):
    """Tool Provider 抽象基类。

    每个 Provider 代表一种 Tool 来源：
      - SandboxProvider: 沙箱执行能力
      - SkillProvider: 文件系统技能
      - MCPProvider: 外部 MCP 服务器

    子类需要实现:
      - id: Provider 唯一标识
      - discover(): 返回可用 Tool 列表
      - call(): 实际调用 Tool
    """

    @property
    @abstractmethod
    def id(self) -> str:
        """Provider 唯一标识，如 'sandbox' / 'skills' / 'mcp'。"""
        ...

    def discover(self) -> list[ToolInfo]:
        """扫描并返回此 Provider 提供的所有 Tool 定义。

        默认返回空列表。子类应重写以自动发现 Tool。
        """
        return []

    @abstractmethod
    def call(self, tool_name: str, arguments: dict) -> str:
        """调用指定 Tool，返回结果字符串。

        Args:
            tool_name: Tool 名称
            arguments: Tool 参数（dict）

        Returns:
            Tool 执行结果的字符串表示。
        """
        ...

    def health_check(self) -> bool:
        """健康检查。默认返回 True。"""
        return True

    def refresh(self) -> None:
        """刷新 Tool 列表（重新发现）。

        默认不执行任何操作。子类可重写以支持动态刷新。
        """
        pass


def provider_to_langchain_tools(provider: ToolProvider) -> list:
    """将 Provider 的所有 Tool 转换为 LangChain @tool 装饰的函数。

    复用 mcp/adapters.py 中的 Pydantic args_schema 生成逻辑。

    Args:
        provider: ToolProvider 实例

    Returns:
        LangChain BaseTool 列表，可直接传给 create_deep_agent(tools=[...])。
    """
    import json

    from langchain_core.tools import tool as lc_tool

    def _make_tool(name: str, desc: str, schema):
        """工厂函数 — 每个 Tool 创建独立闭包，避免循环变量延迟绑定。"""

        @lc_tool(name_or_callable=name, description=desc, args_schema=schema)
        def _wrapper(**kwargs) -> str:
            """Provider tool wrapper — 委托给对应 Provider 执行。"""
            try:
                return provider.call(name, kwargs)
            except Exception as exc:
                return json.dumps({
                    "error": str(exc),
                    "tool": name,
                    "provider": provider.id,
                })

        _wrapper.metadata = {
            "provider_id": provider.id,
            "tool_name": name,
        }
        return _wrapper

    langchain_tools = []

    for tool_info in provider.discover():
        tool_name = tool_info["name"]
        description = tool_info["description"]
        input_schema = tool_info.get("inputSchema", {})

        # ── 从 inputSchema 生成 Pydantic args_schema ──
        args_schema = None
        if input_schema and input_schema.get("properties"):
            args_schema = _build_args_schema(tool_name, input_schema)

        # 工厂函数确保每个 Tool 有独立的闭包
        langchain_tools.append(
            _make_tool(tool_name, description, args_schema)
        )

    return langchain_tools


def _build_args_schema(tool_name: str, input_schema: dict):
    """从 JSON Schema 构建 Pydantic BaseModel 作为 LangChain tool 的参数模型。

    与 mcp/adapters.py 中的逻辑一致，提取为独立函数以便复用。
    """
    from pydantic import BaseModel, Field, create_model

    fields = {}
    props = input_schema.get("properties", {})
    required = input_schema.get("required", [])

    for prop_name, prop_info in props.items():
        prop_type = _json_type_to_python(prop_info.get("type", "string"))
        prop_desc = prop_info.get("description", "")
        is_required = prop_name in required
        default = ... if is_required else None
        fields[prop_name] = (
            prop_type if is_required else prop_type | None,
            Field(default, description=prop_desc),
        )

    if not fields:
        return None

    model_name = f"{tool_name}_args".replace("-", "_").replace(".", "_").title()
    try:
        return create_model(model_name, **fields)
    except Exception:
        return None


def _json_type_to_python(json_type: str) -> type:
    """JSON Schema type → Python type。"""
    mapping = {
        "string": str,
        "integer": int,
        "number": float,
        "boolean": bool,
        "array": list,
        "object": dict,
    }
    return mapping.get(json_type, str)
