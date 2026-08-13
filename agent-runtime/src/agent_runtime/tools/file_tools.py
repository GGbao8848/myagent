"""文件操作工具：读取、写入、列目录（均经目录白名单校验）。"""
from __future__ import annotations

import os
from datetime import datetime

from agent_runtime.security.path_policy import PathPolicy


def _format_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def read_file(path_policy: PathPolicy, path: str, max_size: int) -> str:
    real = path_policy.resolve(path)  # 可能抛 PathPolicyError

    if not os.path.isfile(real):
        return f"错误：{path!r} 不是文件"

    size = os.path.getsize(real)
    if size > max_size:
        return f"错误：文件过大（{_format_size(size)} > 上限 {_format_size(max_size)}），拒绝读取"

    with open(real, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def write_file(path_policy: PathPolicy, path: str, content: str) -> str:
    real = path_policy.resolve(path)  # 可能抛 PathPolicyError

    # 确保父目录存在
    parent = os.path.dirname(real)
    if parent and not os.path.isdir(parent):
        return f"错误：目录不存在（{parent}），无法写入"

    with open(real, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    return f"已写入 {real}（{len(content)} 字符）"


def list_files(path_policy: PathPolicy, path: str) -> str:
    real = path_policy.resolve(path)  # 可能抛 PathPolicyError

    if not os.path.isdir(real):
        return f"错误：{path!r} 不是目录"

    entries = []
    with os.scandir(real) as it:
        for entry in sorted(it, key=lambda e: e.name.lower()):
            try:
                stat = entry.stat()
            except OSError:
                continue
            kind = "DIR" if entry.is_dir() else "FILE"
            mtime = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            entries.append(f"{kind}\t{_format_size(stat.st_size)}\t{mtime}\t{entry.name}")

    if not entries:
        return f"{real}（空目录）"

    header = f"{real}（{len(entries)} 项）\n类型\t大小\t修改时间\t名称"
    return header + "\n" + "\n".join(entries)
