"""LLM 模型配置。"""

from __future__ import annotations

import os

MODEL_STRING = os.getenv("DEEPAGENTS_MODEL", "openai:gpt-4o")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL")
