"""目录白名单校验：防止文件操作越界（``..`` 与符号链接逃逸）。

所有文件读写/列目录在真实路径（realpath）层面校验是否落在允许目录内，
即使传入符号链接或 ``..`` 也会被解析后拦截。
"""
from __future__ import annotations

import os
from pathlib import Path


class PathPolicyError(PermissionError):
    """路径越界错误。"""


class PathPolicy:
    def __init__(self, allowed_dirs: list[str]) -> None:
        # 预先归一化（展开变量、~，解析真实路径），Windows 大小写不敏感
        self.allowed_dirs = [
            os.path.normcase(os.path.realpath(os.path.expandvars(os.path.expanduser(d))))
            for d in allowed_dirs
        ]
        # 相对路径的基准目录：优先取第一个允许目录，否则当前目录
        self._base = self.allowed_dirs[0] if self.allowed_dirs else os.path.normcase(os.getcwd())

    @property
    def base_dir(self) -> str:
        """相对路径的解析基准目录。"""
        return self._base

    def is_allowed(self, real_path: str) -> bool:
        norm = os.path.normcase(real_path)
        for d in self.allowed_dirs:
            if norm == d or norm.startswith(d + os.sep):
                return True
        return False

    def resolve(self, path: str) -> str:
        """将用户请求的路径解析为允许目录内的真实绝对路径。

        相对路径基于第一个允许目录；符号链接与 ``..`` 会被 realpath 归一化后再校验。
        越界时抛出 :class:`PathPolicyError`。
        """
        raw = os.path.expandvars(os.path.expanduser(path))
        if not os.path.isabs(raw):
            raw = os.path.join(self._base, raw)

        real = os.path.realpath(raw)
        if not self.is_allowed(real):
            raise PathPolicyError(
                f"拒绝访问：路径 {path!r} 超出允许目录范围（解析后为 {real!r}）"
            )
        return real
