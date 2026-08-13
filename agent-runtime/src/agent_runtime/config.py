"""配置加载：从 YAML 读取 AgentRuntime 配置，提供合理默认值。

配置文件查找顺序（取第一个存在的）：
1. 环境变量 ``AGENTRUNTIME_CONFIG`` 指定的路径
2. 当前工作目录下的 ``config.yaml``
3. ``%PROGRAMDATA%\\AgentRuntime\\config.yaml``（安装后）

找不到配置文件时使用内置默认值（仅 localhost、无任何授权目录与命令，
需显式配置后才能执行实际操作）。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

_ENV_CONFIG = "AGENTRUNTIME_CONFIG"
_DEFAULT_CONFIG_NAME = "config.yaml"


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 18544
    path: str = "/mcp"


@dataclass
class SecurityConfig:
    allowed_dirs: list[str] = field(default_factory=list)
    allowed_commands: list[str] = field(default_factory=list)
    exec_timeout_seconds: int = 30
    max_file_size_bytes: int = 1_048_576  # 1 MiB


@dataclass
class LoggingConfig:
    log_dir: str = "./logs"
    audit_file: str = "audit.log"
    max_bytes: int = 10_485_760  # 10 MiB
    backup_count: int = 5


@dataclass
class AppConfig:
    server: ServerConfig = field(default_factory=ServerConfig)
    security: SecurityConfig = field(default_factory=SecurityConfig)
    logging: LoggingConfig = field(default_factory=LoggingConfig)


def _default_config_path() -> Path | None:
    env = os.environ.get(_ENV_CONFIG)
    if env:
        return Path(env)

    cwd = Path.cwd() / _DEFAULT_CONFIG_NAME
    if cwd.is_file():
        return cwd

    program_data = os.environ.get("PROGRAMDATA")
    if program_data:
        installed = Path(program_data) / "AgentRuntime" / _DEFAULT_CONFIG_NAME
        if installed.is_file():
            return installed

    return None


def _as_int(value, name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:  # pragma: no cover - 防御性
        raise ValueError(f"配置项 {name} 必须是整数，实际为 {value!r}") from exc


def load_config(path: str | os.PathLike[str] | None = None) -> AppConfig:
    """加载配置。优先使用传入的 path，其次按默认查找顺序。"""
    cfg = AppConfig()

    config_path = Path(path) if path else _default_config_path()
    if config_path is None:
        return cfg

    with open(config_path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    server = raw.get("server") or {}
    if "host" in server:
        cfg.server.host = str(server["host"])
    if "port" in server:
        cfg.server.port = _as_int(server["port"], "server.port")
    if "path" in server:
        cfg.server.path = str(server["path"])

    security = raw.get("security") or {}
    if "allowed_dirs" in security:
        cfg.security.allowed_dirs = [str(d) for d in security["allowed_dirs"]]
    if "allowed_commands" in security:
        cfg.security.allowed_commands = [str(c) for c in security["allowed_commands"]]
    if "exec_timeout_seconds" in security:
        cfg.security.exec_timeout_seconds = _as_int(
            security["exec_timeout_seconds"], "security.exec_timeout_seconds"
        )
    if "max_file_size_bytes" in security:
        cfg.security.max_file_size_bytes = _as_int(
            security["max_file_size_bytes"], "security.max_file_size_bytes"
        )

    logging = raw.get("logging") or {}
    if "log_dir" in logging:
        cfg.logging.log_dir = str(logging["log_dir"])
    if "audit_file" in logging:
        cfg.logging.audit_file = str(logging["audit_file"])
    if "max_bytes" in logging:
        cfg.logging.max_bytes = _as_int(logging["max_bytes"], "logging.max_bytes")
    if "backup_count" in logging:
        cfg.logging.backup_count = _as_int(logging["backup_count"], "logging.backup_count")

    return cfg
