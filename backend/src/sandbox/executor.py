"""基于 subprocess 的本地沙箱，集成安全守卫。

安全层次（由外到内）：
  1. AST 审计   — 执行前静态扫描 Python 代码中的危险模式
  2. 资源监控   — 后台线程监控子进程内存/超时，超限终止
  3. 网络策略   — 可选的 HTTP 代理阻断
  4. 进程隔离   — subprocess 子进程执行
  5. 文件隔离   — 临时工作目录限定读写范围
  6. 超时保护   — 硬超时兜底

所有安全机制跨平台（Windows / macOS / Linux）。
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from deepagents.backends.protocol import (
    ExecuteResponse,
    FileDownloadResponse,
    FileUploadResponse,
)
from deepagents.backends.sandbox import BaseSandbox

from src.config import (
    PROJECT_ROOT,
    SANDBOX_AUDIT,
    SANDBOX_BLOCK_NETWORK,
    SANDBOX_MEMORY_MB,
    SANDBOX_PYTHON,
    SANDBOX_TIMEOUT,
    SANDBOX_WSL_DISTRO,
    SANDBOX_WSL_ENABLED,
    SKILLS_DIR,
)
from src.sandbox.guard import (
    AstAuditor,
    Finding,
    NetworkPolicy,
    ResourceMonitor,
    sniff_python_code,
)

logger = logging.getLogger(__name__)


class LocalSandbox(BaseSandbox):
    """带安全守卫的本地子进程沙箱。

    用法:
        sandbox = LocalSandbox()
        result = sandbox.execute("python -c 'print(1+1)'")
        print(result.output)  # "2"
        sandbox.cleanup()

    安全配置通过环境变量控制：
        SANDBOX_AUDIT=true       — 开启 AST 审计
        SANDBOX_MEMORY_MB=512    — 子进程内存上限（MB）
        SANDBOX_BLOCK_NETWORK=true — 阻断子进程网络访问
    """

    def __init__(
        self,
        python: str = SANDBOX_PYTHON,
        timeout: int = SANDBOX_TIMEOUT,
        *,
        audit: bool = SANDBOX_AUDIT,
        memory_mb: int = SANDBOX_MEMORY_MB,
        block_network: bool = SANDBOX_BLOCK_NETWORK,
    ) -> None:
        super().__init__()
        self._python_path = (PROJECT_ROOT / python).absolute()
        self._timeout = timeout
        self._workspace = Path(tempfile.mkdtemp(prefix="br-agent-"))

        # ---- 安全守卫配置 ----
        self._audit_enabled = audit
        self._memory_mb = memory_mb
        self._network_policy = NetworkPolicy.block() if block_network else NetworkPolicy.allow()

        if audit:
            logger.info("AST 审计已开启")
        if memory_mb:
            logger.info("内存限制: %dMB", memory_mb)
        if block_network:
            logger.info("网络已阻断")

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------

    @property
    def id(self) -> str:
        return f"local-{self._workspace.name}"

    @property
    def execution_context(self) -> str:
        """返回 Agent 需要的完整执行环境上下文。

        将此信息注入 system prompt 后，Agent 无需通过 pwd / which python / ls
        等命令自行探索环境——所有关键路径和约定在启动时就已经明确。

        返回的文本为中文 Markdown，可直接追加到 system prompt 末尾。
        """
        import platform
        import sys

        venv_python = str(self._python_path)
        skills_root = str(SKILLS_DIR.resolve())
        project_root = str(PROJECT_ROOT)
        os_name = platform.system()
        is_windows = sys.platform == "win32"

        # 在 Git Bash / MSYS2 下，所有路径统一用正斜杠
        is_msys = "MSYSTEM" in os.environ or "MINGW" in os.environ.get("MSYSTEM", "")
        if is_msys:
            skills_root = skills_root.replace("\\", "/")
            project_root = project_root.replace("\\", "/")
            venv_python = venv_python.replace("\\", "/")

        # 路径分隔符提示
        if is_msys:
            path_hint = "正斜杠 `/`（Git Bash / MSYS2）。不要使用反斜杠"
        elif is_windows:
            path_hint = "正斜杠 `/`（兼容 Git Bash / MSYS2）。避免使用反斜杠 `\\`"
        else:
            path_hint = "正斜杠 `/`"

        # Shell 提示
        if is_msys:
            shell_hint = "Git Bash (MinGW/MSYS) — 使用 Linux 风格路径和命令"
        elif is_windows:
            shell_hint = "PowerShell 或 cmd.exe"
        else:
            shell_hint = "bash (或兼容 shell)"

        return f"""## 执行环境（Execution Context）

在沙箱中执行命令前，请先了解以下环境信息——无需通过 `pwd`、`which python`、`ls` 等命令自行探索：

### 基础信息
- **操作系统**: {os_name}（{sys.platform}）
- **Shell**: {shell_hint}
- **当前工作目录 (cwd)**: `{project_root}`
- **项目根目录**: `{project_root}`

### Python
- **解释器路径**: `{venv_python}`
- **使用方式**: 直接使用 `python` 即可（已自动加入 PATH）
- **虚拟环境**: 已激活，第三方包可用

### 路径
- **Skills 目录**: `{skills_root}`
- **路径格式**: {path_hint}
- **相对路径基准**: `{project_root}`（即 `skills/xxx/scripts/yyy.py` 等价于 `{project_root}/skills/xxx/scripts/yyy.py`）

### 环境变量（沙箱自动注入）
- `BR_SKILLS` → `{skills_root}`
- `PYTHONPATH` → 已包含 skills 根目录及脚本所在目录
- `PATH` → 已包含 venv 的 `Scripts`/`bin` 目录
- `.env` 中的变量 → 已从项目根目录的 `.env` 文件加载

### 限制
- **超时**: 默认 {self._timeout}s（可通过 timeout 参数覆盖）
- **审计**: {"已开启" if self._audit_enabled else "未开启"}
- **网络**: {"已阻断" if self._network_policy.is_blocked else "正常"}

### 常用命令速查
```bash
# 执行 skill 脚本（推荐：用绝对路径，最可靠）
python {skills_root}/<skill-name>/scripts/<script>.py [args]

# 或先 cd 再执行
cd {skills_root}/<skill-name> && python scripts/<script>.py [args]

# 浏览 skills 目录
ls {skills_root}/
```"""

    def cleanup(self) -> None:
        """删除临时工作目录。"""
        if self._workspace.exists():
            shutil.rmtree(self._workspace, ignore_errors=True)

    def __del__(self) -> None:
        if hasattr(self, "_workspace"):
            self.cleanup()

    # ------------------------------------------------------------------
    # SandboxBackendProtocol 核心方法
    # ------------------------------------------------------------------

    def execute(
        self, command: str, *, timeout: int | None = None
    ) -> ExecuteResponse:
        """在子进程中执行 shell 命令，包含安全守卫。

        执行流程：
            1. AST 审计（如果开启）
            2. 构建受限环境变量
            3. 启动子进程
            4. 后台资源监控
            5. 等待完成/超时/违规
        """
        effective_timeout = timeout or self._timeout
        audit_report = ""

        # ---- 修复 Windows 上 python3 不存在的问题 ----
        # deepagents 内部模板（ls/read/glob/grep/edit）使用 python3，
        # 但 Windows venv 只有 python.exe。提前替换为正确的解释器路径。
        command = self._fix_python3(command)

        # ---- 修复 Linux 专用重定向 ----
        # deepagents 模板使用 2>/dev/null，Windows 需要 2>NUL
        command = command.replace("2>/dev/null", "2>NUL")

        # ---- 第 1 层：AST 审计 ----
        if self._audit_enabled:
            audit_report = self._run_audit(command)

        # ---- 解析执行目录 ----
        script_cwd = self._resolve_cwd(command)
        extra_pythonpath: list[str] = []
        if script_cwd != PROJECT_ROOT:
            # skill 脚本：将脚本目录追加到 PYTHONPATH，确保同目录导入可靠工作
            extra_pythonpath.append(str(script_cwd))

        # ---- 构建环境变量 ----
        env = self._build_env(extra_paths=extra_pythonpath)

        # ---- 第 2 层：网络阻断 ----
        env = self._network_policy.apply_to_env(env)

        # ---- 第 3 层：启动子进程 ----
        # Windows cmd.exe 不支持多行命令。deepagents 模板（glob/ls/read/grep
        # 等内部用 python3 -c "..." 的方式）是 bash 风格的多行字符串。
        # 解决方案：检测多行 python -c 命令，将代码写入临时 .py 文件后执行。
        command = self._fix_multiline_python_c(command)
        try:
            proc = subprocess.Popen(
                command,
                shell=True,
                cwd=str(script_cwd),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
            )
        except OSError as e:
            return ExecuteResponse(
                output=f"无法启动进程: {e}",
                exit_code=-1,  # type: ignore[arg-type]
            )

        # ---- 第 4 层：资源监控 ----
        monitor = ResourceMonitor(
            memory_mb=self._memory_mb,
            timeout_sec=effective_timeout,
        )
        monitor.start(proc.pid)

        # ---- 等待完成 ----
        try:
            stdout, stderr = proc.communicate(timeout=effective_timeout)
        except subprocess.TimeoutExpired:
            monitor.stop()
            self._kill_proc(proc)
            return ExecuteResponse(
                output=f"命令超时 ({effective_timeout}s)",
                exit_code=-1,  # type: ignore[arg-type]
            )

        violation = monitor.stop()

        # ---- 组装结果（Windows 优先 GBK，fallback UTF-8）----
        text = _safe_decode(stdout)
        if stderr:
            text += _safe_decode(stderr)

        if violation:
            text += f"\n\n[沙箱] {violation}"

        # 附加审计报告
        if audit_report:
            text = audit_report + "\n" + text

        return ExecuteResponse(output=text, exit_code=proc.returncode)  # type: ignore[arg-type]

    def upload_files(
        self, files: list[tuple[str, bytes]]
    ) -> list[FileUploadResponse]:
        """写入文件到工作目录。"""
        responses: list[FileUploadResponse] = []
        for path, content in files:
            file_path = self._resolve(path)
            try:
                file_path.parent.mkdir(parents=True, exist_ok=True)
                file_path.write_bytes(content)
                responses.append(FileUploadResponse(path=path, error=None))
            except Exception as e:
                responses.append(FileUploadResponse(path=path, error=str(e)))
        return responses

    def download_files(
        self, paths: list[str]
    ) -> list[FileDownloadResponse]:
        """读取工作目录中的文件。"""
        responses: list[FileDownloadResponse] = []
        for path in paths:
            file_path = self._resolve(path)
            try:
                content = file_path.read_bytes()
                responses.append(
                    FileDownloadResponse(path=path, content=content, error=None)
                )
            except Exception as e:
                responses.append(
                    FileDownloadResponse(path=path, content=None, error=str(e))
                )
        return responses

    # ------------------------------------------------------------------
    # 安全守卫集成
    # ------------------------------------------------------------------

    def _run_audit(self, command: str) -> str:
        """对命令中的 Python 代码执行 AST 审计。

        返回格式化的审计报告字符串；如果未发现 Python 代码或无需报告，返回空字符串。
        """
        # 跳过框架内部命令（deepagents 的 read/ls/glob/grep/edit 等模板）
        if _is_framework_command(command):
            return ""

        code, kind = sniff_python_code(command)

        if code is None:
            # 无法提取代码（如 python script.py），跳过审计
            return ""

        findings = AstAuditor.audit(code)

        # 过滤掉纯语法错误——语法错误的代码通常不是用户意图，如误匹配的模板
        findings = [f for f in findings if f.category != "syntax"]

        if not findings:
            return ""

        # 仅对 skill 脚本降低 danger 的报告级别（因为 skill 是可信代码）
        if self._is_skill_command(command):
            findings = [
                Finding(
                    severity="info" if f.severity == "danger" else f.severity,
                    category=f.category,
                    message=f.message + " [skill 脚本，已放行]",
                    line=f.line,
                )
                if f.severity == "danger"
                else f
                for f in findings
            ]
            # 如果全部降级为 info，且没有 warning，可以跳过报告
            if all(f.severity == "info" for f in findings):
                return ""

        report = AstAuditor.format_report(findings)
        return f"[沙箱审计]\n{report}\n"


    def _is_skill_command(self, command: str) -> bool:
        """判断命令是否在运行 skill 脚本。"""
        skills_path = str(SKILLS_DIR.resolve())
        return skills_path in command

    def _resolve_cwd(self, command: str) -> Path:
        """智能解析执行目录。

        从命令中提取 .py 脚本路径：
          - 脚本位于 SKILLS_DIR 下 → 返回 skill 根目录（SKILL.md 所在目录）
          - 否则 → 返回 PROJECT_ROOT（兜底）

        Skill 脚本约定以 skill 根目录为工作目录（``cd {skill_dir}
        && python scripts/xxx.py``），而非 scripts/ 子目录。
        """
        script_path = self._extract_script_path(command)
        if script_path is not None:
            skills_root = SKILLS_DIR.resolve()
            try:
                script_path = script_path.resolve()
                if script_path.is_relative_to(skills_root):
                    # 向上查找 skill 根目录（直接位于 SKILLS_DIR 下的目录）
                    return self._find_skill_root(script_path, skills_root)
            except (OSError, ValueError):
                pass
        return PROJECT_ROOT

    @staticmethod
    def _find_skill_root(script_path: Path, skills_root: Path) -> Path:
        """从脚本路径向上找到 skill 根目录。

        Skill 根目录 = SKILLS_DIR 的直接子目录（如 skills/bip-oa-automation）。
        """
        # 遍历祖先，找到 skills_root 的直接子目录
        for parent in script_path.parents:
            if parent.parent == skills_root:
                return parent
        # 兜底：返回脚本所在目录
        return script_path.parent

    @staticmethod
    def _extract_script_path(command: str) -> Path | None:
        """从 shell 命令中提取 .py 脚本的 Path。

        支持模式:
          - python /abs/path/to/script.py args...
          - python path/to/script.py args...
          - cd /some/dir && python script.py args...
        """
        import re

        # 匹配 python[3] 后面的脚本路径（可能带引号）
        # 支持: python "path.py", python 'path.py', python path.py
        for m in re.finditer(
            r"python(?:3(?:\.[0-9]+)?)?\s+(?:-c\s+\S+\s+)?"
            r"(['\"]?)(\S+\.py)\1",
            command,
        ):
            raw_path = m.group(2)
            p = Path(raw_path)
            if not p.is_absolute():
                # 尝试解析相对于 PROJECT_ROOT（因为命令中的相对路径以此为基准）
                p = PROJECT_ROOT / p
            return p
        return None

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------

    @staticmethod
    def _fix_python3(command: str) -> str:
        """将命令中的 ``python3`` 替换为 ``python``。

        deepagents 内部模板（ls/read/glob/grep/edit）使用 ``python3``，
        但 Windows venv 中只有 ``python.exe``。此方法在命令执行前完成替换，
        确保所有内部操作正常工作。

        不拼接完整 Python 路径——只替换为 ``python``，依赖 ``_build_env``
        已将 venv Scripts 目录注入 PATH 来找到正确的解释器。这样做也避免了
        ``cmd.exe`` 不兼容正斜杠路径的问题。

        同时处理 ``python3.xx`` 等带版本号的引用。
        """
        import re

        # python3 / python3.11 / python3.10 等 → python
        return re.sub(r"\bpython3(?:\.\d+)?\b", "python", command)

    @staticmethod
    def _fix_windows_path(path: str) -> str:
        """处理 Windows 绝对路径的表示形式。

        validate_path 补丁会将 ``E:\\br\\BR-agent`` 规范化为 ``/E:/br/BR-agent``
        （加前导 ``/``）。但 Python 的 ``os.scandir()`` 等函数不接受带前导 ``/``
        的 Windows 路径。此方法剥离前导 ``/``。

        >>> _fix_windows_path("/E:/br/BR-agent/skills")
        "E:/br/BR-agent/skills"
        >>> _fix_windows_path("/home/user")
        "/home/user"
        """
        import re

        m = re.match(r"^/([A-Za-z]:[/\\].*)$", path)
        if m:
            return m.group(1).replace("\\", "/")
        return path

    def _fix_multiline_python_c(self, command: str) -> str:
        """将多行 ``python -c "..."`` 改写为临时脚本文件执行。

        Windows cmd.exe 不支持多行命令，而 deepagents 的 ls / glob / read
        等内部模板生成的是多行 ``python3 -c "..."`` 命令。此方法检测多行
        ``-c`` 调用，提取代码写入工作目录的临时 .py 文件，用 ``python <file>``
        替代原始命令。
        """
        import re as _re

        # 只处理多行命令
        if "\n" not in command:
            return command

        # 匹配 python -c "code" 或 python -c 'code'，支持多行
        # 需要同时匹配 python 和 python3（_fix_python3 已将其替换为 python）
        m = _re.search(
            r"\bpython\s+-c\s+(\")",
            command,
        )
        if not m:
            return command

        quote_char = m.group(1)
        # 从引号之后开始，找到匹配的闭合引号
        start = m.end()  # 跳过 python -c "
        # 向后搜索匹配的引号（考虑转义）
        # 简化策略：找最后一个未被转义的引号，后跟可选的重定向
        depth = 1
        i = start
        while i < len(command) and depth > 0:
            if command[i] == "\\":
                i += 2  # 跳过转义字符
                continue
            if command[i] == quote_char:
                depth -= 1
                if depth == 0:
                    break
            i += 1

        if depth != 0:
            return command  # 引号不匹配，放弃

        code = command[start:i]
        if not code.strip():
            return command

        # 写入临时文件
        import uuid
        tmp_name = f"_deepagents_{uuid.uuid4().hex[:8]}.py"
        tmp_path = self._workspace / tmp_name
        tmp_path.write_text(code, encoding="utf-8")

        # 重建命令：python <tmp_path> 替换原来的 python -c "..."
        # 保留 -c 之后可能的重定向部分（如 2>&1）
        remaining = command[i + 1:].strip()
        python_exe = "python"
        new_cmd = f"{python_exe} {tmp_path}"
        if remaining:
            new_cmd += " " + remaining
        return new_cmd

    def ls(self, path: str) -> "LsResult":
        """重写以处理 Windows 绝对路径。"""
        return super().ls(self._fix_windows_path(path))

    def read(
        self,
        file_path: str,
        offset: int = 0,
        limit: int = 2000,
    ) -> "ReadResult":
        """重写以处理 Windows 绝对路径。"""
        return super().read(
            self._fix_windows_path(file_path),
            offset=offset,
            limit=limit,
        )

    def glob(
        self, pattern: str, path: str | None = None
    ) -> "GlobResult":
        """重写以处理 Windows 绝对路径。"""
        return super().glob(
            pattern,
            path=self._fix_windows_path(path) if path else None,
        )

    def grep(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
    ) -> "GrepResult":
        """重写以处理 Windows 绝对路径。"""
        return super().grep(
            pattern,
            path=self._fix_windows_path(path) if path else None,
            glob=glob,
        )

    def write(self, file_path: str, content: str) -> "WriteResult":
        """重写以处理 Windows 绝对路径。"""
        return super().write(
            self._fix_windows_path(file_path),
            content,
        )

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> "EditResult":
        """重写以处理 Windows 绝对路径。"""
        return super().edit(
            self._fix_windows_path(file_path),
            old_string,
            new_string,
            replace_all=replace_all,
        )

    def _resolve(self, path: str) -> Path:
        """将路径解析到工作目录内。"""
        p = Path(path)
        if p.is_absolute():
            p = Path(p.name)
        return self._workspace / p

    def _build_env(self, *, extra_paths: list[str] | None = None) -> dict[str, str]:
        """构建子进程环境变量，注入技能路径和 venv。

        Args:
            extra_paths: 额外追加到 PYTHONPATH 前端的路径（如 skill 脚本所在目录）。
        """
        env = os.environ.copy()
        skills_root = str(SKILLS_DIR.resolve())
        env["BR_SKILLS"] = skills_root

        # 收集所有需要加入 PYTHONPATH 的路径
        path_parts: list[str] = []
        if extra_paths:
            path_parts.extend(extra_paths)
        path_parts.append(skills_root)

        current = env.get("PYTHONPATH", "")
        if current:
            path_parts.append(current)

        # 使用平台正确的路径分隔符
        env["PYTHONPATH"] = os.pathsep.join(path_parts)

        venv_bin = str(self._python_path.parent)
        env["PATH"] = f"{venv_bin}{os.pathsep}{env.get('PATH', '')}"
        return env

    @staticmethod
    def _kill_proc(proc: subprocess.Popen) -> None:
        """强制终止进程及其子进程。"""
        try:
            proc.kill()
        except Exception:
            pass


class WslSandbox(LocalSandbox):
    """通过 WSL 在 Linux 环境中执行命令的沙箱。

    在 Windows 上运行时，将沙箱命令路由到 WSL 的 Linux 分发版中执行，
    使得 AI 能获得与 Linux 一致的文件操作、路径分隔符和系统调用行为。

    WSL 沙箱与 LocalSandbox 的区别：
      - 所有命令通过 ``wsl -d <distro> -- <command>`` 在 Linux 中执行
      - Windows 路径（如 ``E:\\...``）自动转换为 WSL 路径（``/mnt/e/...``）
      - 使用 WSL 内的 python3（而非 Windows 的 python.exe）
      - 命令在 Linux bash 中执行，无需处理 Windows cmd.exe 的兼容性问题

    用法：
        sandbox = WslSandbox()
        result = sandbox.execute("python3 -c 'print(1+1)'")
        print(result.output)  # "2"
    """

    def __init__(
        self,
        python: str = SANDBOX_PYTHON,
        timeout: int = SANDBOX_TIMEOUT,
        *,
        audit: bool = SANDBOX_AUDIT,
        memory_mb: int = SANDBOX_MEMORY_MB,
        block_network: bool = SANDBOX_BLOCK_NETWORK,
        distro: str | None = None,
    ) -> None:
        super().__init__(
            python=python,
            timeout=timeout,
            audit=audit,
            memory_mb=memory_mb,
            block_network=block_network,
        )
        self._distro = distro or SANDBOX_WSL_DISTRO
        if not self._distro:
            raise RuntimeError(
                "WSL 分发版未设置。请通过环境变量 SANDBOX_WSL_DISTRO 指定，"
                "或确认已安装 WSL 分发版。"
            )
        logger.info("WSL 沙箱模式已启用，分发版: %s", self._distro)

    # ------------------------------------------------------------------
    # 路径转换
    # ------------------------------------------------------------------

    @staticmethod
    def _win_to_wsl_path(win_path: str) -> str:
        """将 Windows 路径转换为 WSL 路径。

        >>> WslSandbox._win_to_wsl_path("E:\\\\br\\\\AI-Agent\\\\skills")
        "/mnt/e/br/AI-Agent/skills"
        >>> WslSandbox._win_to_wsl_path("C:\\\\Users\\\\kui.song")
        "/mnt/c/Users/kui.song"
        """
        path = win_path.replace("\\", "/")
        import re
        m = re.match(r"^([A-Za-z]):(/.*)$", path)
        if m:
            return f"/mnt/{m.group(1).lower()}{m.group(2)}"
        return path

    @staticmethod
    def _wsl_to_win_path(wsl_path: str) -> str:
        """将 WSL 路径转换回 Windows 路径（用于文件操作）。

        >>> WslSandbox._wsl_to_win_path("/mnt/e/br/AI-Agent/skills")
        "E:/br/AI-Agent/skills"
        """
        import re
        m = re.match(r"^/mnt/([a-z])/(.*)$", wsl_path)
        if m:
            return f"{m.group(1).upper()}:/{m.group(2)}"
        return wsl_path

    # ------------------------------------------------------------------
    # 环境上下文
    # ------------------------------------------------------------------

    @property
    def execution_context(self) -> str:
        """返回 WSL 环境上下文，注入 system prompt。"""
        skills_root = self._win_to_wsl_path(str(SKILLS_DIR.resolve()))
        project_root = self._win_to_wsl_path(str(PROJECT_ROOT))

        return f"""## 执行环境（Execution Context）— WSL 沙箱模式

在沙箱中执行命令前，请先了解以下环境信息——无需通过 `pwd`、`which python`、`ls` 等命令自行探索：

### 基础信息
- **操作系统**: Linux（通过 WSL 模拟）
- **Shell**: bash（WSL {self._distro}）
- **当前工作目录 (cwd)**: `{project_root}`
- **项目根目录**: `{project_root}`

### Python
- **解释器**: WSL 内的 python3
- **使用方式**: 直接使用 `python3` 或 `python`
- **包管理**: 使用 `pip`（若需安装依赖，请自行 `pip install`）

### 路径
- **Skills 目录**: `{skills_root}`
- **路径格式**: Linux 正斜杠 `/`
- **Windows 文件访问**: 通过 `/mnt/c/`、`/mnt/e/` 等挂载点访问
- **相对路径基准**: `{project_root}`

### 环境变量（沙箱自动注入）
- `BR_SKILLS` → `{skills_root}`
- `PYTHONPATH` → 已包含 skills 根目录
- `.env` 中的变量 → 已从项目根目录的 `.env` 文件加载

### 限制
- **超时**: 默认 {self._timeout}s（可通过 timeout 参数覆盖）
- **审计**: {"已开启" if self._audit_enabled else "未开启"}

### 常用命令速查
```bash
# 执行 skill 脚本
python3 {skills_root}/<skill-name>/scripts/<script>.py [args]

# 浏览 skills 目录
ls {skills_root}/

# 安装 Python 包
pip install <package>
```"""

    # ------------------------------------------------------------------
    # 核心执行方法
    # ------------------------------------------------------------------

    def execute(
        self, command: str, *, timeout: int | None = None
    ) -> ExecuteResponse:
        """通过 WSL 在 Linux 环境中执行命令。"""
        effective_timeout = timeout or self._timeout
        audit_report = ""

        # ---- 保留 python3 名称（WSL Linux 中就是 python3）----
        # 不调用 _fix_python3，因为 WSL 中原生支持 python3

        # ---- 保持 Linux 重定向语法 ----（WSL 用 bash，支持 2>/dev/null）
        # 不做替换

        # ---- 第 1 层：AST 审计 ----
        if self._audit_enabled:
            audit_report = self._run_audit(command)

        # ---- 解析执行目录 ----
        script_cwd = self._resolve_cwd(command)
        extra_pythonpath: list[str] = []
        if script_cwd != PROJECT_ROOT:
            extra_pythonpath.append(str(script_cwd))

        # ---- 构建环境变量 ----
        env = self._build_env(extra_paths=extra_pythonpath)

        # ---- 第 2 层：网络阻断 ----
        env = self._network_policy.apply_to_env(env)

        # ---- 第 3 层：通过 WSL 执行 ----
        # 将 Windows 路径转为 WSL 路径
        wsl_cwd = self._win_to_wsl_path(str(script_cwd))

        # 构建 WSL 环境变量（export 语句）
        # 注意：wsl.exe 需要正常的 Windows 环境才能运行，所以 Popen 的 env 传 None。
        # 但 WSL bash 会继承 Windows PATH（分号分隔），导致乱码。
        # 解决方案：用 env -i 清空环境，只设置需要的变量。
        br_skills = env.get("BR_SKILLS", "")
        pythonpath = env.get("PYTHONPATH", "")
        env_exports = "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
        if br_skills:
            wsl_skills = self._win_to_wsl_path(br_skills)
            env_exports += f"; export BR_SKILLS={wsl_skills}"
        if pythonpath:
            parts = [self._win_to_wsl_path(p) for p in pythonpath.split(os.pathsep)]
            wsl_pythonpath = ":".join(parts)
            env_exports += f"; export PYTHONPATH={wsl_pythonpath}"

        wsl_command = f"cd {wsl_cwd} && {env_exports} && {command}"

        # 用 env -i 清空继承的 Windows 环境变量，避免 PATH 被 Windows 路径污染
        wrapped = ["wsl", "-d", self._distro, "-u", "root", "--", "env", "-i",
                   f"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                   "HOME=/root", "USER=root",
                   "bash", "-c", wsl_command]

        try:
            proc = subprocess.Popen(
                wrapped,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except OSError as e:
            return ExecuteResponse(
                output=f"无法启动 WSL 进程: {e}",
                exit_code=-1,
            )

        # ---- 第 4 层：资源监控 ----
        from src.sandbox.guard import ResourceMonitor
        monitor = ResourceMonitor(
            memory_mb=self._memory_mb,
            timeout_sec=effective_timeout,
        )
        # WSL 子进程的 PID 是 wsl.exe 的进程，不是实际 Linux 进程的 PID
        # 这里仅监控 wsl.exe 本身的资源消耗
        monitor.start(proc.pid)

        # ---- 等待完成 ----
        try:
            stdout, stderr = proc.communicate(timeout=effective_timeout)
        except subprocess.TimeoutExpired:
            monitor.stop()
            self._kill_proc(proc)
            return ExecuteResponse(
                output=f"命令超时 ({effective_timeout}s)",
                exit_code=-1,
            )

        violation = monitor.stop()

        # ---- 组装结果 ----
        text = _safe_decode(stdout)
        if stderr:
            text += _safe_decode(stderr)

        if violation:
            text += f"\n\n[沙箱] {violation}"

        if audit_report:
            text = audit_report + "\n" + text

        return ExecuteResponse(output=text, exit_code=proc.returncode)

    # ------------------------------------------------------------------
    # 文件操作 — 路径转换
    # ------------------------------------------------------------------

    def _resolve(self, path: str) -> Path:
        """将路径解析到工作目录内（WSL 路径 → Windows 路径）。"""
        p = Path(path)
        if not p.is_absolute():
            return self._workspace / p
        # 尝试将 WSL 路径转为 Windows 路径
        win_path = self._wsl_to_win_path(path)
        return Path(win_path)

    def ls(self, path: str) -> "LsResult":
        """重写：通过 WSL 执行 ls 以获得正确的 Linux 风格输出。"""
        wsl_path = self._win_to_wsl_path(path) if ":" in path else path
        return super().ls(wsl_path)

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> "ReadResult":
        wsl_path = self._win_to_wsl_path(file_path) if ":" in file_path else file_path
        return super().read(wsl_path, offset=offset, limit=limit)

    def glob(self, pattern: str, path: str | None = None) -> "GlobResult":
        if path:
            path = self._win_to_wsl_path(path) if ":" in path else path
        return super().glob(pattern, path=path)

    def grep(self, pattern: str, path: str | None = None, glob: str | None = None) -> "GrepResult":
        if path:
            path = self._win_to_wsl_path(path) if ":" in path else path
        return super().grep(pattern, path=path, glob=glob)

    def write(self, file_path: str, content: str) -> "WriteResult":
        wsl_path = self._win_to_wsl_path(file_path) if ":" in file_path else file_path
        return super().write(wsl_path, content)

    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> "EditResult":
        wsl_path = self._win_to_wsl_path(file_path) if ":" in file_path else file_path
        return super().edit(wsl_path, old_string, new_string, replace_all=replace_all)


def _is_framework_command(command: str) -> bool:
    """判断命令是否是 deepagents 框架内部的模板命令。"""
    return any(marker in command for marker in (
        "MAX_OUTPUT_BYTES",
        "__DEEPAGENTS_EDIT_EOF__",
        "MAX_BINARY_BYTES",
    ))


def _safe_decode(data: bytes) -> str:
    """跨平台安全解码：Windows 优先 GBK，fallback UTF-8。"""
    import sys
    if sys.platform == "win32":
        try:
            return data.decode("gbk")
        except (UnicodeDecodeError, LookupError):
            pass
    return data.decode("utf-8", errors="replace")


# ==========================================================================
# Monkey-patch: 让 deepagents 的 validate_path 接受 Windows 绝对路径
# ==========================================================================
# deepagents 的文件系统工具（ls / read_file / glob / grep）默认拒绝
# "E:\..." 这样的 Windows 绝对路径。在本地沙箱场景下，沙箱就是主机
# 文件系统，Agent 拿到的是真实路径，需要让这些工具正常工作。
#
# 策略：
#   1. 检测 Windows 绝对路径（X:\... 或 X:/...）
#   2. 规范化为 /X:/path/to/file 格式（加前导 / 满足中间件要求）
#   3. LocalSandbox 的文件系统方法（ls/read/glob 等）会自动剥离前导 /
#   4. 非 Windows 路径原样放行
# ==========================================================================

def _install_validate_path_patch() -> None:
    """安装 validate_path 补丁（幂等，重复调用无副作用）。

    需要同时覆盖两个 import 路径：
      - ``deepagents.backends.utils.validate_path``  — 定义点
      - ``deepagents.middleware.filesystem.validate_path`` — ``from ... import`` 引用
    """
    import re as _re

    from deepagents.backends import utils as _backend_utils

    _original = _backend_utils.validate_path

    def _patched(path: str, *, allowed_prefixes=None) -> str:
        # 检测 Windows 绝对路径 (X:\... 或 X:/...)
        if _re.match(r"^[A-Za-z]:[/\\]", path):
            normalized = "/" + path.replace("\\", "/")
            parts = normalized.replace("\\", "/").split("/")
            if ".." in parts[1:]:
                raise ValueError(f"Path traversal not allowed: {path!r}")
            if path.startswith("~"):
                raise ValueError(f"Home directory expansion not allowed: {path!r}")
            return normalized
        return _original(path, allowed_prefixes=allowed_prefixes)

    # 1) 覆盖定义点
    _backend_utils.validate_path = _patched  # type: ignore[assignment]

    # 2) 覆盖 ``from ... import`` 的引用点
    try:
        from deepagents.middleware import filesystem as _fs_middleware

        _fs_middleware.validate_path = _patched  # type: ignore[assignment]
    except ImportError:
        pass

    # 3) 也覆盖 permissions 中间件（如果存在）
    try:
        from deepagents.middleware import permissions as _perm_middleware

        if hasattr(_perm_middleware, "validate_path"):
            _perm_middleware.validate_path = _patched  # type: ignore[assignment]
    except ImportError:
        pass


# 模块导入时自动安装补丁
_install_validate_path_patch()
