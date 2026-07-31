"""沙箱配置 — 安全守卫开关与限制参数。"""

from __future__ import annotations

import os
import subprocess
import sys

from src.config.paths import PROJECT_ROOT


def _default_sandbox_python() -> str:
    """获取沙箱子进程的 Python 解释器默认路径。

    优先级（由高到低）：
      1. 环境变量 SANDBOX_PYTHON
      2. WSL 模式 → 自动检测 WSL 中的 python3
      3. PyInstaller 打包环境 → "python"（依赖系统 PATH 或捆绑便携 Python）
      4. Windows 开发环境 → .venv/Scripts/python.exe
      5. Unix 开发环境 → .venv/bin/python
    """
    if getattr(sys, "frozen", False):
        return "python"
    if sys.platform == "win32":
        return str(PROJECT_ROOT / ".venv" / "Scripts" / "python.exe")
    return str(PROJECT_ROOT / ".venv" / "bin" / "python")


def _detect_wsl() -> str:
    """检测 WSL 是否可用，返回分发版名称，不可用返回空字符串。"""
    try:
        result = subprocess.run(
            ["wsl", "-l", "-q"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            distros = [d.strip() for d in result.stdout.splitlines() if d.strip()]
            if distros:
                return distros[0]
    except Exception:
        pass
    return ""


SANDBOX_PYTHON = os.getenv("SANDBOX_PYTHON") or _default_sandbox_python()
SANDBOX_TIMEOUT = int(os.getenv("SANDBOX_TIMEOUT", "60"))

SANDBOX_AUDIT = os.getenv("SANDBOX_AUDIT", "false").lower() in ("1", "true", "yes")
"""开启 AST 静态审计，在执行 Python 代码前扫描危险模式。"""

SANDBOX_MEMORY_MB = int(os.getenv("SANDBOX_MEMORY_MB", "0"))
"""子进程内存上限（MB），0 = 不限制。需要 psutil。"""

SANDBOX_BLOCK_NETWORK = os.getenv("SANDBOX_BLOCK_NETWORK", "false").lower() in ("1", "true", "yes")
"""是否在子进程中阻断网络访问（通过 http_proxy 指向无效地址）。"""

# ── WSL 沙箱模式 ─────────────────────────────────────────────
# 启用后，AI 执行的 Python 代码实际运行在 WSL Linux 环境中，
# 实现 Windows 上模拟 Linux 执行效果。
# 需要先安装 WSL 并导入 Ubuntu 分发版。
SANDBOX_WSL_ENABLED = os.getenv("SANDBOX_WSL_ENABLED", "false").lower() in ("1", "true", "yes")
"""是否启用 WSL 沙箱模式（Windows → WSL Linux 执行）。"""

SANDBOX_WSL_DISTRO = os.getenv("SANDBOX_WSL_DISTRO") or _detect_wsl()
"""WSL 分发版名称，默认自动检测第一个可用分发版。"""

# ── 沙箱 provider ──────────────────────────────────────────────
# "local" → 本地子进程沙箱（默认，无需额外配置）
# "daytona" → Daytona 云端沙箱（需要 DAYTONA_API_KEY）
SANDBOX_PROVIDER = os.getenv("SANDBOX_PROVIDER", "local").lower()
"""沙箱提供方：local | daytona"""

DAYTONA_API_KEY = os.getenv("DAYTONA_API_KEY", "")
"""Daytona 云端沙箱 API Key。仅在 SANDBOX_PROVIDER=daytona 时需要。"""

DAYTONA_SANDBOX_SNAPSHOT = os.getenv("DAYTONA_SANDBOX_SNAPSHOT", "")
"""Daytona 沙箱快照名称（可选），用于预装依赖的定制环境。"""

DAYTONA_SANDBOX_CPU = int(os.getenv("DAYTONA_SANDBOX_CPU", "2"))
DAYTONA_SANDBOX_MEMORY_MB = int(os.getenv("DAYTONA_SANDBOX_MEMORY_MB", "4096"))
