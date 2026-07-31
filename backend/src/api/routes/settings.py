"""运行时配置路由 — 前端可配置项的读写。

v2: 支持多 LLM 配置（llmProviders 列表）。
Agent 重建在后台线程执行，避免阻塞 API 响应。
"""

from __future__ import annotations

import threading

from fastapi import APIRouter, HTTPException

from src.api.deps import get_manager
from src.config.settings_store import (
    get_model_keys_changed,
    get_public,
    load,
    load_providers,
    save,
    save_providers,
    set_active_provider,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _rebuild_agent_in_background() -> None:
    """在后台线程中重建 Agent，避免因模型连接超时阻塞 API 响应。

    ToolManager 初始化后 Agent 通过 ToolManager 获取所有工具，
    sync_mcp_tools 参数仅作为兼容保留，ToolManager 路径下会被忽略。
    """
    def _run() -> None:
        try:
            manager = get_manager()
            manager.sync_mcp_tools([])
        except Exception:
            pass  # 重建失败不抛给前端，下次对话时 build_agent 会重试
    threading.Thread(target=_run, daemon=True).start()


@router.get("")
async def get_settings():
    """返回当前配置（敏感字段脱敏，含 llmProviders 列表）。"""
    return get_public()


@router.put("")
async def update_settings(data: dict):
    """更新非 LLM 配置项（BIP 凭证等）。"""
    save(data)
    return {"ok": True}


# ── LLM Provider 路由 ────────────────────────────────


@router.get("/providers")
async def get_providers():
    """获取所有 LLM 配置列表（敏感字段脱敏）。"""
    pub = get_public()
    return {
        "llmProviders": pub.get("llmProviders", []),
        "activeProviderId": pub.get("activeProviderId", ""),
    }


@router.put("/providers")
async def update_providers(data: dict):
    """批量保存 LLM 配置列表，模型变更自动触发 Agent 重建。

    Body: { "llmProviders": [...], "activeProviderId": "xxx" }
    """
    old_providers = load_providers()
    old_data = load()
    old_active = old_data.get("activeProviderId", "")

    new_providers = data.get("llmProviders", [])
    new_active = data.get("activeProviderId", old_active)

    # 如果提供了新的 activeProviderId，先切换
    if new_active != old_active and new_active:
        try:
            set_active_provider(new_active)
        except ValueError:
            pass  # 无效 ID 忽略，后续 save_providers 会修正

    save_providers(new_providers)

    # 模型配置变更 → 后台重建 Agent（不阻塞响应）
    if get_model_keys_changed(old_providers, new_providers, old_active, new_active):
        _rebuild_agent_in_background()

    return {"ok": True}


@router.put("/providers/active")
async def activate_provider(data: dict):
    """切换激活的 LLM 配置，自动重建 Agent。

    Body: { "activeProviderId": "xxx" }
    """
    provider_id = data.get("activeProviderId", "")
    if not provider_id:
        raise HTTPException(status_code=400, detail="缺少 activeProviderId")

    old_data = load()
    old_active = old_data.get("activeProviderId", "")
    old_providers = old_data.get("llmProviders", [])

    try:
        set_active_provider(provider_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # 模型配置变更 → 后台重建 Agent（不阻塞响应）
    new_providers = load_providers()
    if old_active != provider_id or get_model_keys_changed(old_providers, new_providers, old_active, provider_id):
        _rebuild_agent_in_background()

    return {"ok": True}


# ── WSL 检测与引导 ──────────────────────────────────


@router.get("/wsl")
async def check_wsl_endpoint():
    """检测 WSL 环境状态，返回检测结果和引导说明。"""
    from src.sandbox.wsl_check import check_wsl, guide_install

    result = check_wsl()
    return {
        "ok": result.ok,
        "wslInstalled": result.wsl_installed,
        "distroInstalled": result.distro_installed,
        "distroName": result.distro_name,
        "wslVersion": result.wsl_version,
        "summary": result.summary,
        "errors": result.errors,
        "guide": guide_install() if not result.ok else "",
    }
