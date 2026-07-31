"""MemoryAgent — LLM 驱动的用户画像提取器。

用轻量 LLM 从对话中语义理解用户特征，结构化输出观察结果，
再由 UserProfile 的置信度引擎去重合并。

注意：项目记忆（AGENTS.md）由 DeepAgents 内置 MemoryMiddleware 管理，
Agent 通过 edit_file 工具自主更新，不由 MemoryAgent 代写。
"""

from __future__ import annotations

import json
import logging

import os

from langchain.chat_models import init_chat_model

from src.memory.profile import Observation, UserProfile


def _get_active_model() -> str:
    """动态读取当前激活的 LLM model（支持前台切换即时生效）。"""
    try:
        from src.config.settings_store import get_active_provider
        provider = get_active_provider()
        if provider and provider.get("model"):
            return provider["model"]
    except Exception:
        pass
    return os.getenv("DEEPAGENTS_MODEL", "openai:gpt-4o")

logger = logging.getLogger(__name__)

# 记忆提取的 JSON Schema（强约束输出格式）
_EXTRACTION_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "user_observations",
        "description": "从对话中提取关于用户的可长期使用的观察事实",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "observations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "自然语言事实描述，如'用户偏好简洁的代码风格'",
                            },
                            "source": {
                                "type": "string",
                                "enum": ["explicit", "inferred"],
                                "description": "explicit=用户明确说出, inferred=从对话推断",
                            },
                            "confidence": {
                                "type": "number",
                                "minimum": 0.0,
                                "maximum": 1.0,
                                "description": "置信度。explicit 0.7-0.9，inferred 0.4-0.6",
                            },
                        },
                        "required": ["content", "source", "confidence"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["observations"],
            "additionalProperties": False,
        },
    },
}

_SYSTEM_PROMPT_EXTRACT = """你是一个用户画像分析器。从对话中提取关于用户的**长期有用**的事实。

## 规则
1. 只提取明确的、可复用的信息（偏好、身份、技能、习惯）
2. 忽略临时/一次性信息（"今晚有事"、"今天天气"）
3. **永远不要**提取密码、token、密钥等敏感信息
4. 中文输出，简洁准确
5. 如果没有有价值的信息，返回空数组

## 示例
用户说"我叫张三，在北京工作，平时喜欢用 Python"
→ [{"content": "用户名叫张三", "source": "explicit", "confidence": 0.85},
   {"content": "用户在北京工作", "source": "explicit", "confidence": 0.8},
   {"content": "用户偏好使用 Python", "source": "explicit", "confidence": 0.75}]"""


class MemoryAgent:
    """用 LLM 从对话中提取用户观察。

    用法:
        agent = MemoryAgent()
        new_obs = agent.run(
            user_msg="...",
            assistant_msg="...",
            profile=profile,
        )
    """

    def __init__(self, model: str | None = None) -> None:
        # 使用轻量模型降低成本；默认跟随当前激活的 provider
        self._model = init_chat_model(
            model or _get_active_model(), use_responses_api=False
        )

    # ------------------------------------------------------------------
    # 公共 API
    # ------------------------------------------------------------------

    def run(
        self,
        *,
        user_msg: str,
        assistant_msg: str,
        profile: UserProfile,
    ) -> list[Observation]:
        """执行一轮用户画像提取。

        从本轮对话中提取用户观察，合并到 UserProfile（自动去重 + 置信度更新）。

        Returns:
            new_observations — 本轮新产生（或置信度被提升）的观察列表
        """
        existing = profile.get_observations()
        observations = self._extract_observations(user_msg, assistant_msg, existing)
        return profile.merge_observations(observations)

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------

    def _extract_observations(
        self,
        user_msg: str,
        assistant_msg: str,
        existing: list[Observation],
    ) -> list[dict]:
        """用 LLM 从对话中提取用户观察。"""
        structured_model = self._model.bind(
            response_format=_EXTRACTION_SCHEMA
        )

        existing_text = ""
        if existing:
            items = [f"- [{o.source}] {o.content} (置信度:{o.confidence:.0%})" for o in existing[:10]]
            existing_text = "\n".join(items)

        prompt = f"""当前已有的观察：
{existing_text or "(尚无)"}

本轮对话：
用户：{user_msg}
助手：{assistant_msg[:1500]}

请提取本轮对话中新出现的、关于用户的有价值信息。"""

        try:
            response = structured_model.invoke([
                {"role": "system", "content": _SYSTEM_PROMPT_EXTRACT},
                {"role": "user", "content": prompt},
            ])
            result = json.loads(response.content)
            return result.get("observations", [])
        except (json.JSONDecodeError, AttributeError, KeyError) as e:
            logger.warning("MemoryAgent 提取失败: %s", e)
            return []
