"""SkillProvider — 自动发现 skills/ 目录，将技能注册为 Tool。

替换 agent/factory.py 中硬编码的 list_skills / load_skill，
通过 ToolProvider 接口统一注册到 ToolManager。
"""

from __future__ import annotations

import json
import logging

from src.agent.skills import list_skills, load_skill
from src.tool_manager.providers.base import ToolInfo, ToolProvider

logger = logging.getLogger(__name__)


class SkillProvider(ToolProvider):
    """从 skills/ 目录自动发现技能并提供 Tool。

    Tool 名称保持 list_skills / load_skill 以兼容现有 Agent prompt。
    """

    def __init__(self) -> None:
        self._cache: list[ToolInfo] | None = None

    @property
    def id(self) -> str:
        return "skills"

    def discover(self) -> list[ToolInfo]:
        if self._cache is not None:
            return self._cache

        self._cache = [
            {
                "name": "list_skills",
                "description": (
                    "列出所有可用的技能。每个技能是一个可复用的自动化模块，"
                    "包含详细的操作说明和脚本。当用户提到某个任务时，"
                    "应先调用此工具查看是否有可用的技能。"
                ),
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "show_all": {
                            "type": "boolean",
                            "description": (
                                "为 True 时列出全部技能（含已禁用的）。"
                                "默认为 False，只列出启用的技能。"
                            ),
                        },
                    },
                },
            },
            {
                "name": "load_skill",
                "description": (
                    "加载指定技能的完整说明文档。"
                    "应先调用 list_skills 获取可用的 skill_id，"
                    "再按需调用此工具加载具体技能的操作指南和脚本信息。"
                ),
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "skill_id": {
                            "type": "string",
                            "description": "技能 ID，如 'file-organizer' 或 'bip-oa-automation'",
                        },
                    },
                    "required": ["skill_id"],
                },
            },
        ]
        return self._cache

    def call(self, tool_name: str, arguments: dict) -> str:
        if tool_name == "list_skills":
            show_all = arguments.get("show_all", False)
            return list_skills(show_all=show_all)
        elif tool_name == "load_skill":
            skill_id = arguments.get("skill_id", "")
            return load_skill(skill_id)
        else:
            return json.dumps({"error": f"未知的技能工具: {tool_name}"})

    def refresh(self) -> None:
        """刷新缓存（安装/删除 Skill 后调用）。"""
        self._cache = None
        logger.info("SkillProvider: 缓存已刷新")
