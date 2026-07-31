"""运行时配置存储 — 前端可配置项的热更新。

优先级：data/settings.json > .env > 硬编码默认值。
前端修改后调用 save() 写入 JSON + 更新 os.environ，无需重启。

v2: 支持多 LLM 配置（llmProviders 列表），前端可随意切换。
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any

from src.config.paths import PROJECT_ROOT

logger = logging.getLogger(__name__)

_SETTINGS_PATH = PROJECT_ROOT / "data" / "settings.json"

# 非 LLM 的托管 key（BIP 凭证等）
_NON_LLM_KEYS = [
    "BIP_USERNAME",
    "BIP_PASSWORD",
]

# 脱敏 key（GET 时返回掩码值）
_MASKED_KEYS = {"apiKey", "BIP_PASSWORD"}

# ── LLM Provider 数据模型 ────────────────────────────

_REQUIRED_PROVIDER_FIELDS = ["id", "name", "apiKey", "baseUrl", "model"]


def _make_provider_id() -> str:
    """生成简短的唯一 provider ID。"""
    return uuid.uuid4().hex[:8]


def _validate_provider(p: dict) -> dict:
    """校验并补全 provider 字段。"""
    if "id" not in p or not p["id"]:
        p["id"] = _make_provider_id()
    p.setdefault("name", "未命名")
    p.setdefault("apiKey", "")
    p.setdefault("baseUrl", "")
    p.setdefault("model", "")
    p.setdefault("maxContextTokens", 32768)
    return p


# ── 默认值 ───────────────────────────────────────────


def _defaults() -> dict[str, str]:
    """聚合 .env 中的非 LLM 默认值。"""
    defaults: dict[str, str] = {}
    for key in _NON_LLM_KEYS:
        val = os.getenv(key, "")
        if val:
            defaults[key] = val
    return defaults


def _default_providers() -> list[dict]:
    """从 .env 生成默认的 LLM provider（首次启动 / 迁移时使用）。"""
    api_key = os.getenv("OPENAI_API_KEY", "")
    base_url = os.getenv("OPENAI_BASE_URL", "")
    model = os.getenv("DEEPAGENTS_MODEL", "openai:gpt-4o")
    if api_key or base_url or model:
        return [{
            "id": "default",
            "name": "默认配置",
            "apiKey": api_key,
            "baseUrl": base_url,
            "model": model,
        }]
    return []


# ── 加载 / 保存 ──────────────────────────────────────


def load() -> dict[str, Any]:
    """加载完整配置（含 llmProviders + BIP 凭证）。

    向后兼容：旧格式（扁平 OPENAI_* key）自动迁移为新格式。
    """
    if not _SETTINGS_PATH.exists():
        # 首次：写入默认值
        defaults = _defaults()
        providers = _default_providers()
        data = {**defaults, "llmProviders": providers, "activeProviderId": providers[0]["id"] if providers else ""}
        _write_full(data)
        return data

    try:
        raw = json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("settings.json 损坏，回退到 .env: %s", e)
        defaults = _defaults()
        providers = _default_providers()
        return {**defaults, "llmProviders": providers, "activeProviderId": providers[0]["id"] if providers else ""}

    # ── 向后兼容：旧格式迁移 ──
    if "llmProviders" not in raw:
        logger.info("检测到旧格式 settings.json，自动迁移到多 LLM 配置格式")
        old_api_key = raw.pop("OPENAI_API_KEY", os.getenv("OPENAI_API_KEY", ""))
        old_base_url = raw.pop("OPENAI_BASE_URL", os.getenv("OPENAI_BASE_URL", ""))
        old_model = raw.pop("DEEPAGENTS_MODEL", os.getenv("DEEPAGENTS_MODEL", "openai:gpt-4o"))
        raw["llmProviders"] = [{
            "id": "default",
            "name": "默认配置",
            "apiKey": old_api_key,
            "baseUrl": old_base_url,
            "model": old_model,
        }]
        raw["activeProviderId"] = "default"
        _write_full(raw)

    # 确保 providers 列表中每个元素都有必需字段
    providers = raw.get("llmProviders", [])
    raw["llmProviders"] = [_validate_provider(p) for p in providers]

    # 确保 activeProviderId 存在且有效
    if not raw.get("activeProviderId") and raw["llmProviders"]:
        raw["activeProviderId"] = raw["llmProviders"][0]["id"]

    # 合并 BIP 默认值
    defaults = _defaults()
    for key in _NON_LLM_KEYS:
        if key not in raw:
            raw[key] = defaults.get(key, "")

    return raw


def save(updates: dict[str, str]) -> dict[str, Any]:
    """更新非 LLM 配置项（BIP 凭证等），持久化到 settings.json。

    Returns:
        更新后的完整配置字典。
    """
    current = load()
    for key, value in updates.items():
        if key in _NON_LLM_KEYS:
            current[key] = value
    _write_full(current)
    return current


# ── LLM Provider 操作 ────────────────────────────────


def load_providers() -> list[dict]:
    """加载所有 LLM 配置列表。"""
    return load().get("llmProviders", [])


def save_providers(providers: list[dict]) -> dict[str, Any]:
    """批量保存 LLM 配置列表。

    会校验每个 provider，并确保 activeProviderId 仍然有效。
    """
    current = load()
    validated = [_validate_provider(p) for p in providers]
    current["llmProviders"] = validated

    # 确保 activeProviderId 指向存在的 provider
    active_id = current.get("activeProviderId", "")
    if not any(p["id"] == active_id for p in validated):
        current["activeProviderId"] = validated[0]["id"] if validated else ""

    _write_full(current)

    # 同步当前激活的 provider 到环境变量
    _sync_active_to_env(current)
    return current


def get_active_provider() -> dict | None:
    """获取当前激活的 LLM 配置，并同步到 os.environ。"""
    data = load()
    active_id = data.get("activeProviderId", "")
    providers = data.get("llmProviders", [])
    for p in providers:
        if p["id"] == active_id:
            _sync_provider_to_env(p)
            return p
    # fallback: 返回第一个
    if providers:
        _sync_provider_to_env(providers[0])
        data["activeProviderId"] = providers[0]["id"]
        _write_full(data)
        return providers[0]
    return None


def set_active_provider(provider_id: str) -> dict[str, Any]:
    """切换激活的 LLM 配置，同步环境变量，返回更新后的配置。"""
    current = load()
    providers = current.get("llmProviders", [])
    if not any(p["id"] == provider_id for p in providers):
        raise ValueError(f"Provider '{provider_id}' 不存在")

    current["activeProviderId"] = provider_id
    _write_full(current)

    # 同步到环境变量
    for p in providers:
        if p["id"] == provider_id:
            _sync_provider_to_env(p)
            break

    return current


# ── 公共展示 / 脱敏 ──────────────────────────────────


def get_public() -> dict[str, Any]:
    """返回前端可展示的配置（敏感字段脱敏）。"""
    current = load()
    providers = current.get("llmProviders", [])

    # 脱敏 providers 中的 apiKey
    public_providers = []
    for p in providers:
        pp = dict(p)
        if pp.get("apiKey"):
            pp["apiKey"] = _mask(pp["apiKey"])
        public_providers.append(pp)

    result: dict[str, Any] = {
        "llmProviders": public_providers,
        "activeProviderId": current.get("activeProviderId", ""),
    }
    for key in _NON_LLM_KEYS:
        val = current.get(key, "")
        if key in _MASKED_KEYS and val:
            result[key] = _mask(val)
        else:
            result[key] = val

    return result


def get_model_keys_changed(old_providers: list[dict], new_providers: list[dict],
                           old_active: str, new_active: str) -> bool:
    """判断模型相关配置是否变更（需重建 Agent）。"""
    if old_active != new_active:
        return True

    def _key(p: dict) -> tuple:
        return (p.get("apiKey", ""), p.get("baseUrl", ""), p.get("model", ""))

    old_map = {p["id"]: _key(p) for p in old_providers if "id" in p}
    new_map = {p["id"]: _key(p) for p in new_providers if "id" in p}

    return old_map != new_map


# ── 内部 ────────────────────────────────────────────


def _write_full(data: dict[str, Any]) -> None:
    _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _sync_provider_to_env(p: dict) -> None:
    """将 provider 配置同步到 os.environ（LangChain 需要）。"""
    os.environ["OPENAI_API_KEY"] = p.get("apiKey", "")
    os.environ["OPENAI_BASE_URL"] = p.get("baseUrl", "")
    os.environ["DEEPAGENTS_MODEL"] = p.get("model", "")


def _sync_active_to_env(data: dict) -> None:
    """根据 activeProviderId 同步环境变量。"""
    active_id = data.get("activeProviderId", "")
    providers = data.get("llmProviders", [])
    for p in providers:
        if p["id"] == active_id:
            _sync_provider_to_env(p)
            return


def _mask(value: str, visible: int = 4) -> str:
    """保留前 visible 位，其余用 ● 替代。"""
    if len(value) <= visible:
        return "●" * min(len(value), 8)
    return value[:visible] + "●" * min(len(value) - visible, 12)
