"""项目路径 & Agent 行为配置。

兼容两种运行环境：
- 开发环境：`python webui.py` → 基于 __file__ 向上查找
- 打包环境：PyInstaller frozen → 基于 sys.executable 所在目录
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _get_app_root() -> Path:
    """获取应用根目录（兼容 PyInstaller 打包环境）。"""
    if getattr(sys, "frozen", False):
        # PyInstaller: exe 所在目录即应用根（skills/ .deepagents/ data/ 位于同级）
        return Path(sys.executable).parent
    # 开发环境: 本文件向上三级（src/config/paths.py → 项目根）
    return Path(__file__).resolve().parent.parent.parent


def _resolve_data_path(relative: str) -> Path:
    """解析数据目录，兼容打包环境。

    - 优先查找 apps_root / relative（exe 同级目录，可写）
    - 打包环境 fallback 到 sys._MEIPASS / relative（只读捆绑资源）
    """
    root = _get_app_root()
    p = root / relative
    if p.exists():
        return p
    if getattr(sys, "frozen", False):
        meipass = Path(getattr(sys, "_MEIPASS", ""))
        p2 = meipass / relative
        if p2.exists():
            return p2
    return p  # 返回默认位置，由调用方处理


# 项目根目录
PROJECT_ROOT = _get_app_root()

# 技能目录（可编辑，打包时放在 exe 同级）
SKILLS_DIR = _resolve_data_path("skills")

# Web 前端目录（只读资源，打包时可能位于 _MEIPASS）
WEBUI_DIR = _resolve_data_path("webui")

# Web 服务
WEB_HOST = os.getenv("WEB_HOST", "127.0.0.1")
WEB_PORT = int(os.getenv("WEB_PORT", "6789"))

# 数据库
DB_PATH = os.getenv("DB_PATH", str(PROJECT_ROOT / "data" / "br-agent.db"))

# 用户画像
PROFILE_PATH = os.getenv("PROFILE_PATH", str(PROJECT_ROOT / "data" / "profile.json"))

# Agent 提示词（从 .deepagents/system-prompt.md 加载）
_SYSTEM_PROMPT_PATH = _resolve_data_path(".deepagents/system-prompt.md")
_SYSTEM_PROMPT_PATH.parent.mkdir(parents=True, exist_ok=True)
if _SYSTEM_PROMPT_PATH.exists():
    SYSTEM_PROMPT = _SYSTEM_PROMPT_PATH.read_text(encoding="utf-8").strip()
else:
    SYSTEM_PROMPT = "You are a helpful assistant."
