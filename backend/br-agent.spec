# -*- mode: python ; coding: utf-8 -*-
import os
from pathlib import Path

_PROJECT_ROOT = Path(os.path.abspath(os.path.dirname(SPEC)))

datas = [
    (str(_PROJECT_ROOT / "skills"), "skills"),
    (str(_PROJECT_ROOT / ".deepagents"), ".deepagents"),
]

hiddenimports = [
    "deepagents", "deepagents.graph", "deepagents.middleware",
    "deepagents.middleware.memory", "deepagents.middleware.filesystem",
    "deepagents.middleware.subagents",
    "deepagents.backends", "deepagents.backends.protocol",
    "deepagents.backends.sandbox", "deepagents.backends.filesystem",
    "deepagents.backends.state", "deepagents.backends.store",
    "langchain", "langchain.chat_models", "langchain.agents",
    "langchain_core", "langchain_openai", "langgraph",
    "langgraph.checkpoint", "langgraph.checkpoint.memory",
    "src", "src.api", "src.api.app", "src.api.deps",
    "src.api.routes", "src.api.routes.chat", "src.api.routes.mcp",
    "src.api.routes.profile", "src.api.routes.sessions",
    "src.api.routes.skills", "src.api.routes.settings",
    "src.agent", "src.agent.factory", "src.agent.skills",
    "src.config", "src.config.paths", "src.config.llm",
    "src.config.sandbox", "src.config.settings_store",
    "src.mcp", "src.mcp.adapters", "src.mcp.client", "src.mcp.config",
    "src.memory", "src.memory.agent", "src.memory.profile", "src.memory.store",
    "src.models", "src.sandbox", "src.sandbox.executor", "src.sandbox.guard",
    "yaml", "dotenv",
    "uvicorn", "uvicorn.logging", "uvicorn.loops",
    "uvicorn.protocols.http", "fastapi", "starlette",
    "Crypto", "pydantic", "pydantic_core",
    "jsonpatch", "jsonpointer", "requests", "multipart", "psutil", "mcp",
]

exclude_modules = [
    "tkinter", "matplotlib", "numpy", "pandas", "scipy", "PIL",
    "cv2", "tensorflow", "torch", "jupyter", "IPython", "notebook",
]

a = Analysis(
    [str(_PROJECT_ROOT / "main.py")],
    pathex=[str(_PROJECT_ROOT)],
    binaries=[], datas=datas,
    hiddenimports=hiddenimports, hookspath=[], hooksconfig={}, runtime_hooks=[],
    excludes=exclude_modules, noarchive=False, optimize=0,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas,
          name='br-agent', debug=False, strip=False, upx=True,
          console=True, icon=None)
