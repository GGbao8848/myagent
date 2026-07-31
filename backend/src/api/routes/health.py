"""健康检查路由 — 组件状态探测。"""

from __future__ import annotations

from fastapi import APIRouter

from src.api.deps import get_manager, get_mcp_manager, get_tool_manager

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
async def health():
    """综合健康检查 — 探测所有核心组件状态。

    Returns:
        {
            "status": "ok" | "degraded" | "down",
            "components": {
                "api": {"status": "ok"},
                "agent": {"status": "ok" | "down"},
                "mcp": {
                    "status": "ok" | "degraded" | "no_servers",
                    "servers": [{"id": "...", "connected": true}, ...]
                },
                "sandbox": {"status": "ok" | "down"}
            }
        }
    """
    components: dict[str, dict] = {}

    # ── API ──
    components["api"] = {"status": "ok"}

    # ── Agent ──
    try:
        from src.app import AgentManager
        agent_ok = AgentManager._instance is not None
    except Exception:
        agent_ok = False
    components["agent"] = {"status": "ok" if agent_ok else "down"}

    # ── MCP ──
    mcp_mgr = get_mcp_manager()
    if mcp_mgr is None:
        components["mcp"] = {"status": "no_servers", "servers": []}
    else:
        servers = []
        connected = 0
        for s in mcp_mgr.servers:
            servers.append({"id": s.config.id, "connected": s.connected})
            if s.connected:
                connected += 1
        total = len(servers)
        if total == 0:
            mcp_status = "no_servers"
        elif connected == total:
            mcp_status = "ok"
        elif connected > 0:
            mcp_status = "degraded"
        else:
            mcp_status = "down"
        components["mcp"] = {"status": mcp_status, "servers": servers}

    # ── Sandbox ──
    tm = get_tool_manager()
    sandbox_ok = False
    if tm is not None:
        provider = tm.get_provider("sandbox")
        if provider is not None:
            try:
                sandbox_ok = provider.health_check()
            except Exception:
                sandbox_ok = False
    components["sandbox"] = {"status": "ok" if sandbox_ok else "down"}

    # ── Remote Tools ──
    remote_tools = []
    if tm is not None:
        provider = tm.get_provider("remote")
        if provider is not None:
            remote_tools = provider.list_tools()
    components["remote_tools"] = {
        "status": "ok" if all(t["healthy"] for t in remote_tools) else "degraded" if remote_tools else "no_tools",
        "count": len(remote_tools),
        "tools": remote_tools,
    }

    # ── 综合判定 ──
    statuses = [c.get("status", "ok") for c in components.values()]
    if "down" in statuses:
        overall = "degraded"
    else:
        overall = "ok"

    return {"status": overall, "components": components}
