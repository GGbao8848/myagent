"""Agent 工厂 — 创建配置好的 Deep Agent。

v4: 通过 ToolManager 插件化加载 Tool，不再硬编码 Tool 列表。
    支持 local / daytona 两种沙箱 provider。
"""

from __future__ import annotations

import logging
import os

from src.config import (
    DAYTONA_API_KEY,
    DAYTONA_SANDBOX_CPU,
    DAYTONA_SANDBOX_MEMORY_MB,
    DAYTONA_SANDBOX_SNAPSHOT,
    PROJECT_ROOT,
    SANDBOX_PROVIDER,
    SANDBOX_WSL_ENABLED,
    SANDBOX_WSL_DISTRO,
    SYSTEM_PROMPT,
)

from deepagents import create_deep_agent
from langchain.chat_models import init_chat_model

logger = logging.getLogger(__name__)


def _get_model_string() -> str:
    """动态读取当前激活的 LLM provider 的模型配置（支持前台切换即时生效）。"""
    try:
        from src.config.settings_store import get_active_provider
        provider = get_active_provider()
        if provider and provider.get("model"):
            return provider["model"]
    except Exception:
        pass
    return os.getenv("DEEPAGENTS_MODEL", "openai:gpt-4o")


# ────────────────────────────────────────────────────────────────
# 沙箱工厂
# ────────────────────────────────────────────────────────────────

def _create_local_sandbox():
    """创建本地子进程沙箱（默认）。"""
    from src.sandbox import LocalSandbox  # ← 触发 validate_path Windows 补丁
    return LocalSandbox()


def _create_wsl_sandbox():
    """创建 WSL 沙箱——在 Windows 上通过 WSL 模拟 Linux 执行环境。

    WSL 沙箱将 AI 的 Python 代码路由到 WSL Linux 分发版中执行，
    实现 Windows 上写一次、Linux 一样运行的体验。

    创建前会自动检测 WSL 环境，不可用时给出引导提示。
    """
    from src.sandbox.wsl_check import check_wsl, guide_install

    result = check_wsl()
    if not result.ok:
        guide = guide_install()
        logger.error("WSL 环境不可用，无法创建 WSL 沙箱:\n%s", guide)
        raise RuntimeError(
            "WSL 环境不可用。请在设置中查看安装引导，或关闭 WSL 沙箱模式。"
        )

    logger.info("WSL 环境检测通过: %s", result.summary)
    from src.sandbox import WslSandbox
    return WslSandbox(distro=SANDBOX_WSL_DISTRO)


def _create_daytona_sandbox():
    """创建 Daytona 云端沙箱。

    通过 langchain-daytona 集成包，返回实现了 SandboxBackendProtocol
    的 DaytonaSandbox 实例，可直接作为 create_deep_agent 的 backend。

    返回的 backend 会被附加一个 cleanup() 方法，用于统一生命周期管理。
    """
    from daytona import Daytona, DaytonaConfig, CreateSandboxParams

    if not DAYTONA_API_KEY:
        raise RuntimeError(
            "DAYTONA_API_KEY 未设置，无法使用 Daytona 云端沙箱。\n"
            "请在 .env 中添加: DAYTONA_API_KEY=dtn_..."
        )

    config = DaytonaConfig(api_key=DAYTONA_API_KEY)
    daytona = Daytona(config)

    params = CreateSandboxParams(
        cpu=DAYTONA_SANDBOX_CPU,
        memory=DAYTONA_SANDBOX_MEMORY_MB,
    )

    if DAYTONA_SANDBOX_SNAPSHOT:
        params.snapshot = DAYTONA_SANDBOX_SNAPSHOT
        logger.info("使用 Daytona 快照: %s", DAYTONA_SANDBOX_SNAPSHOT)

    sandbox = daytona.create(params)

    from langchain_daytona import DaytonaSandbox
    backend = DaytonaSandbox(sandbox=sandbox)

    # ── 注入 cleanup() 以统一 LocalSandbox / DaytonaSandbox 接口 ──
    def _cleanup():
        logger.info("清理 Daytona 沙箱: %s", sandbox.id)
        try:
            daytona.delete(sandbox)
        except Exception as exc:
            logger.warning("Daytona 沙箱清理失败: %s", exc)

    backend.cleanup = _cleanup  # type: ignore[attr-defined]

    logger.info(
        "Daytona 沙箱已创建: id=%s cpu=%d memory=%dMB",
        sandbox.id,
        DAYTONA_SANDBOX_CPU,
        DAYTONA_SANDBOX_MEMORY_MB,
    )

    return backend


def _build_execution_context(backend) -> str:
    """构建执行环境上下文文本。

    LocalSandbox 自带 execution_context 属性；
    DaytonaSandbox 没有，需要手动构建。
    """
    if hasattr(backend, "execution_context"):
        return backend.execution_context

    # Daytona 云端沙箱 — 手动构建环境说明
    timeout = os.getenv("SANDBOX_TIMEOUT", "60")
    return f"""## 执行环境（Execution Context）

在沙箱中执行命令前，请先了解以下环境信息：

### 基础信息
- **沙箱类型**: Daytona 云端沙箱（Linux x86_64）
- **Shell**: bash（兼容 sh）
- **当前工作目录 (cwd)**: `/home/daytona`
- **项目根目录**: `/home/daytona`

### Python
- **解释器**: `python`（系统默认 Python 3）
- **使用方式**: 直接使用 `python` / `python3` 均可

### 路径
- **路径格式**: 正斜杠 `/`（Linux 标准路径）
- **临时目录**: `/tmp`

### 可用工具
- **execute_command**: 执行 Shell 命令
- **execute_python**: 执行 Python 代码
- **read_file / write_file / edit_file**: 文件操作
- **list_files / grep_files / glob_files**: 文件搜索

### 限制
- **超时**: 默认 {timeout}s
- **网络**: 正常访问

### 常用命令速查
```bash
# 安装依赖（按需）
pip install <package-name>

# 执行 Python 脚本
python /path/to/script.py

# 浏览目录
ls -la /home/daytona/
```"""


# ────────────────────────────────────────────────────────────────
# 主入口
# ────────────────────────────────────────────────────────────────

def build_agent(tool_manager=None):
    """创建并返回一个配置好的 Deep Agent。

    沙箱 provider 由环境变量 SANDBOX_PROVIDER 控制：
      - "local"（默认）→ 本地子进程沙箱
      - "daytona" → Daytona 云端沙箱

    Tool 通过 ToolManager 插件化加载（不再硬编码）。

    Args:
        tool_manager: ToolManager 实例。为 None 时 Agent 不含外部 Tool。

    返回:
        (agent, sandbox): DeepAgent 实例和沙箱后端。
    """
    # 确保当前激活的 provider 已同步到环境变量
    try:
        from src.config.settings_store import get_active_provider
        get_active_provider()
    except Exception:
        pass

    model = init_chat_model(_get_model_string(), use_responses_api=False)

    # ── 创建沙箱 ──
    logger.info("沙箱 provider: %s", SANDBOX_PROVIDER)

    if SANDBOX_PROVIDER == "daytona":
        sandbox = _create_daytona_sandbox()
    elif SANDBOX_WSL_ENABLED:
        sandbox = _create_wsl_sandbox()
    else:
        sandbox = _create_local_sandbox()

    # ── 项目记忆：将 .deepagents/AGENTS.md 注入沙箱 ──
    memory_src = PROJECT_ROOT / ".deepagents" / "AGENTS.md"
    if memory_src.exists():
        sandbox.upload_files([(".deepagents/AGENTS.md", memory_src.read_bytes())])
        memory_paths = [".deepagents/AGENTS.md"]
    else:
        memory_paths = []

    # ── 注入执行环境上下文 ──
    exec_ctx = _build_execution_context(sandbox)
    full_prompt = SYSTEM_PROMPT + "\n\n" + exec_ctx

    # ── 组装 Tools — 通过 ToolManager 插件化加载 ──
    if tool_manager is not None:
        # 注入沙箱引用 — 当前不注册工具（文件/执行工具由框架内置提供），
        # 预留给未来的健康检查 / 状态监控 / 沙箱管理 API
        tool_manager.set_sandbox(sandbox)
        tools = tool_manager.get_langchain_tools()
        logger.info("从 ToolManager 加载了 %d 个工具", len(tools))
    else:
        tools = []
        logger.info("未提供 ToolManager，Agent 不包含外部工具")

    # ── 创建 Agent ──
    agent = create_deep_agent(
        model=model,
        backend=sandbox,
        system_prompt=full_prompt,
        tools=tools,
        memory=memory_paths or None,
    )

    logger.info("Agent 创建完成 (provider=%s, tools=%d)", SANDBOX_PROVIDER, len(tools))
    return agent, sandbox
