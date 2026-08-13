"""命令白名单校验：防止任意命令执行。

命令先经 shlex 拆分为参数列表（不使用 shell），再取命令名（去扩展名、小写）
比对白名单；不在白名单内直接拒绝，从根本上杜绝 shell 注入。
"""
from __future__ import annotations

import os
import shlex

# Windows 可执行文件扩展名，比对白名单时忽略
_EXEC_EXTENSIONS = (".exe", ".bat", ".cmd", ".com", ".ps1")


class CommandPolicyError(PermissionError):
    """命令不允许执行错误。"""


def _normalize_name(command: str) -> str:
    name = os.path.basename(command).lower()
    for ext in _EXEC_EXTENSIONS:
        if name.endswith(ext):
            name = name[: -len(ext)]
            break
    return name


class CommandPolicy:
    def __init__(self, allowed_commands: list[str]) -> None:
        self.allowed = {_normalize_name(c) for c in allowed_commands if c}

    def validate(self, command: str) -> list[str]:
        """解析并校验命令，返回可直接交给 ``subprocess.run(..., shell=False)`` 的参数列表。

        Windows 下 ``shlex.split(posix=False)`` 会保留引号字符（如 ``python -c "code"``
        拆出 ``'"code"'``），若不剥掉，``-c``/``--eval`` 类参数会把代码当字符串字面量
        静默执行（无输出、无副作用），导致 agent 完全读不到命令结果。因此拆分后统一
        剥掉参数首尾的成对引号（含空格的路径参数由 subprocess 自行加回引号）。
        """
        try:
            # posix=False 更贴合 Windows 命令行的引号规则
            raw_args = shlex.split(command, posix=False)
        except ValueError as exc:
            raise CommandPolicyError(f"命令解析失败：{exc}") from exc

        if not raw_args:
            raise CommandPolicyError("命令为空")

        argv = [_unquote(a) for a in raw_args]
        name = _normalize_name(argv[0])
        if name not in self.allowed:
            raise CommandPolicyError(
                f"拒绝执行：命令 {argv[0]!r} 不在白名单内（已允许：{sorted(self.allowed)}）"
            )
        return argv


def _unquote(arg: str) -> str:
    """去掉 Windows 命令行参数首尾的成对引号（``'...'`` / ``"..."``）。"""
    if len(arg) >= 2 and arg[0] == arg[-1] and arg[0] in "\"'":
        return arg[1:-1]
    return arg
