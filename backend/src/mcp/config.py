"""MCP 服务器配置持久化 (data/mcp-servers.json)。"""

from __future__ import annotations

import json
from pathlib import Path
from dataclasses import dataclass, field, asdict

from src.config import PROJECT_ROOT

CONFIG_PATH = PROJECT_ROOT / "data" / "mcp-servers.json"


@dataclass
class MCPServerConfig:
    """单个 MCP 服务器的连接配置。"""
    id: str
    name: str = ""
    type: str = "streamablehttp"      # streamablehttp | stdio
    url: str = ""                      # HTTP URL（streamablehttp 类型）
    command: str = ""                  # 命令（stdio 类型）
    args: list[str] = field(default_factory=list)  # 命令参数（stdio 类型）
    headers: dict[str, str] = field(default_factory=dict)
    enabled: bool = True

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class MCPConfig:
    servers: list[MCPServerConfig] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"servers": [s.to_dict() for s in self.servers]}


def load_config() -> MCPConfig:
    """加载 MCP 服务器配置。"""
    if not CONFIG_PATH.exists():
        return MCPConfig()

    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        servers = []
        for entry in data.get("servers", []):
            servers.append(MCPServerConfig(
                id=entry.get("id", ""),
                name=entry.get("name", entry.get("id", "")),
                type=entry.get("type", "streamablehttp"),
                url=entry.get("url", ""),
                command=entry.get("command", ""),
                args=entry.get("args", []),
                headers=entry.get("headers", {}),
                enabled=entry.get("enabled", True),
            ))
        return MCPConfig(servers=servers)
    except Exception:
        return MCPConfig()


def save_config(config: MCPConfig) -> None:
    """保存 MCP 服务器配置。"""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        json.dumps(config.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def parse_mcp_servers_json(json_text: str) -> list[MCPServerConfig]:
    """解析 mcpServers JSON 格式，返回服务器配置列表。

    支持 Claude Desktop 格式：
    { "mcpServers": { "name": { "type": "streamablehttp", "url": "...", ... } } }
    """
    data = json.loads(json_text)

    # 支持两种格式
    if "mcpServers" in data:
        entries = data["mcpServers"]
    elif "servers" in data:
        entries = data["servers"]
    else:
        entries = data

    servers = []
    if isinstance(entries, dict):
        for sid, cfg in entries.items():
            if isinstance(cfg, dict):
                servers.append(MCPServerConfig(
                    id=sid,
                    name=cfg.get("name", sid),
                    type=cfg.get("type", "streamablehttp"),
                    url=cfg.get("url", ""),
                    command=cfg.get("command", ""),
                    args=cfg.get("args", []),
                    headers=cfg.get("headers", {}),
                ))
    elif isinstance(entries, list):
        for cfg in entries:
            if isinstance(cfg, dict):
                servers.append(MCPServerConfig(
                    id=cfg.get("id", cfg.get("name", "")),
                    name=cfg.get("name", cfg.get("id", "")),
                    type=cfg.get("type", "streamablehttp"),
                    url=cfg.get("url", ""),
                    command=cfg.get("command", ""),
                    args=cfg.get("args", []),
                    headers=cfg.get("headers", {}),
                ))

    return servers
