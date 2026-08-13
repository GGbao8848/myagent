"""AgentRuntime 入口：python -m agent_runtime 启动 MCP 服务。"""
from __future__ import annotations

from agent_runtime.config import load_config
from agent_runtime.server import build_server


def main() -> None:
    cfg = load_config()
    mcp = build_server(cfg)
    # 只监听 localhost（host 默认 127.0.0.1），SDK v2 自带 DNS-rebinding 防护
    mcp.run(
        transport="streamable-http",
        host=cfg.server.host,
        port=cfg.server.port,
        streamable_http_path=cfg.server.path,
    )


if __name__ == "__main__":
    main()
