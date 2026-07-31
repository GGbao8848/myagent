"""项目配置 — 从环境变量加载，按职责拆分到子模块。"""

from __future__ import annotations

from dotenv import load_dotenv

# 一次性加载 .env，子模块不再重复调用
load_dotenv()

from src.config.paths import (  # noqa: E402, F401
    DB_PATH,
    PROFILE_PATH,
    PROJECT_ROOT,
    SKILLS_DIR,
    SYSTEM_PROMPT,
    WEBUI_DIR,
    WEB_HOST,
    WEB_PORT,
)
from src.config.llm import (  # noqa: E402, F401
    MODEL_STRING,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
)
from src.config.sandbox import (  # noqa: E402, F401
    DAYTONA_API_KEY,
    DAYTONA_SANDBOX_CPU,
    DAYTONA_SANDBOX_MEMORY_MB,
    DAYTONA_SANDBOX_SNAPSHOT,
    SANDBOX_AUDIT,
    SANDBOX_BLOCK_NETWORK,
    SANDBOX_MEMORY_MB,
    SANDBOX_PROVIDER,
    SANDBOX_PYTHON,
    SANDBOX_TIMEOUT,
    SANDBOX_WSL_DISTRO,
    SANDBOX_WSL_ENABLED,
)
