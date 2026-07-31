"""BR-Agent 后端入口 — 仅 API 服务，不含静态文件。

Tauri sidecar 模式启动：br-agent.exe
开发模式启动：python main.py
"""

from __future__ import annotations

import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import uvicorn
from src.config import WEB_HOST, WEB_PORT


def main() -> None:
    print(f"BR-Agent API server starting at http://{WEB_HOST}:{WEB_PORT}")
    uvicorn.run(
        "src.api.app:app",
        host=WEB_HOST,
        port=WEB_PORT,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
