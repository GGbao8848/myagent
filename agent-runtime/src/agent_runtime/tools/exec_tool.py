"""local_exec 工具：执行本地命令（经命令白名单校验）。"""
from __future__ import annotations

import os
import re
import subprocess

from agent_runtime.security.command_policy import CommandPolicy
from agent_runtime.security.path_policy import PathPolicy

# 参数中带路径值的 flag：该 flag 的下一个参数视为路径（如 --python、--config）
_PATH_VALUE_FLAGS = {
    "-C", "--cwd", "--directory", "--config", "--python", "--prefix",
    "--target", "--dest", "--output", "-o", "--file", "--log-file",
    "--project-dir", "--script-dir", "--install-dir",
}

# Windows 绝对路径：盘符 X:\... 或 UNC \\server\...（大小写不敏感）
_ABS_PATH_RE = re.compile(r"(?:[a-zA-Z]:[\\/]|\\\\[^\\/\\s]+)", re.IGNORECASE)


def _extract_abs_paths(text: str) -> list[str]:
    """从文本中提取形如 Windows 绝对路径的子串（覆盖引号内/代码字符串内嵌，如 python -c "...r'E:\\br\\...'"）。"""
    found: list[str] = []
    for m in re.finditer(r"[a-zA-Z]:[\\/][^\s'\"]+", text):
        found.append(m.group(0).rstrip(".,;"))
    for m in re.finditer(r"\\\\[^\\/\\s]+\\[^\s'\"]+", text):
        found.append(m.group(0).rstrip(".,;"))
    # 引号字符串整体：去掉首尾引号后仍是绝对路径的（如 r'E:\br\...'）
    for m in re.finditer(r"(?<![a-zA-Z0-9_])(?:r|b|br)?(['\"])([^'\"]*[a-zA-Z]:[\\/][^'\"]*|[^'\"]*\\\\[^'\"]*)\1", text):
        found.append(m.group(2))
    return found


def _iter_arg_paths(argv: list[str]):
    """遍历命令参数，产出其中的绝对路径候选（含 -c 代码块与 path-flag 的值）。"""
    for i, arg in enumerate(argv):
        # path-flag 的下一个参数视为路径
        if arg in _PATH_VALUE_FLAGS:
            if i + 1 < len(argv):
                yield argv[i + 1]
            continue
        # 代码执行参数（python -c / node -e）：代码内字符串里的绝对路径
        if arg in ("-c", "-e", "--command", "--eval"):
            code = argv[i + 1] if i + 1 < len(argv) else ""
            yield from _extract_abs_paths(code)
            continue
        # 其余参数：直接提取内嵌绝对路径
        yield from _extract_abs_paths(arg)


def _validate_arg_paths(argv: list[str], path_policy: PathPolicy) -> None:
    """命令参数中出现的绝对路径必须落在允许目录内，防止 python -c 等方式越权读写任意路径。"""
    for raw in _iter_arg_paths(argv):
        path = os.path.expandvars(os.path.expanduser(raw.strip().strip("'\"")))
        if not path or not _ABS_PATH_RE.match(path):
            continue
        try:
            real = os.path.realpath(path)
        except OSError:
            continue
        if not path_policy.is_allowed(real):
            raise PermissionError(
                f"拒绝访问：命令参数中的路径 {path!r} 超出允许目录范围（解析后为 {real!r}）"
            )


def exec_local_command(
    cmd_policy: CommandPolicy,
    path_policy: PathPolicy,
    command: str,
    timeout_seconds: int,
    cwd: str,
) -> str:
    """执行一条本地命令，返回 stdout/stderr/exit_code 的可读文本。

    命令名必须通过白名单校验；工作目录必须落在允许目录内；
    参数中出现的绝对路径也必须落在允许目录内（防 python -c 越权）。
    越界或不许执行的命令会抛出 PermissionError（由上层捕获）。
    """
    argv = cmd_policy.validate(command)  # 可能抛 CommandPolicyError
    workdir = path_policy.resolve(cwd)  # 可能抛 PathPolicyError
    _validate_arg_paths(argv, path_policy)  # 可能抛 PermissionError

    # 可执行文件绝对化：Windows 下 subprocess(CreateProcess) 查找可执行文件用的是
    # 父进程 cwd + PATH，而不是子进程 cwd 参数——相对路径（如 .venv\Scripts\python.exe）
    # 会被解析到 MCP 服务自己的目录/venv，导致跑错解释器、import 不到工作区 venv 的库。
    if not os.path.isabs(argv[0]):
        resolved_exe = os.path.join(workdir, argv[0])
        if os.path.exists(resolved_exe):
            argv = [resolved_exe, *argv[1:]]

    try:
        proc = subprocess.run(
            argv,
            cwd=workdir,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        return f"错误：命令执行超时（>{timeout_seconds} 秒），已终止"
    except OSError as exc:
        return f"错误：命令启动失败（{exc}）"

    stdout = proc.stdout or ""
    stderr = proc.stderr or ""

    lines = [
        f"exit_code: {proc.returncode}",
        f"cwd: {workdir}",
    ]
    if stdout:
        lines.append("stdout:")
        lines.append(stdout.rstrip())
    if stderr:
        lines.append("stderr:")
        lines.append(stderr.rstrip())
    return "\n".join(lines)
