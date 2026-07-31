"""Keycloak JWT 认证依赖 — 验证 Bearer token 并注入当前用户。

复用 Keycloak realm 的 JWKS 公钥验证 JWT 签名。
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwk, jwt
from jose.utils import base64url_decode

from src.config import KEYCLOAK_URL, KEYCLOAK_REALM

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)

# JWKS 缓存（公钥不常变，缓存 10 分钟）
_jwks_cache: list[dict[str, Any]] = []
_jwks_cache_time: float = 0.0
_JWKS_CACHE_TTL = 600


def _get_jwks_keys() -> list[dict[str, Any]]:
    global _jwks_cache, _jwks_cache_time
    now = time.time()
    if _jwks_cache and (now - _jwks_cache_time) < _JWKS_CACHE_TTL:
        return _jwks_cache

    url = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs"
    try:
        resp = httpx.get(url, timeout=10)
        resp.raise_for_status()
        _jwks_cache = resp.json().get("keys", [])
        _jwks_cache_time = now
    except Exception as e:
        logger.warning("拉取 Keycloak JWKS 失败: %s", e)
        _jwks_cache = []
    return _jwks_cache


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict[str, Any]:
    """验证 Bearer token，返回用户信息 {sub, username, email, roles}。"""
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少登录凭证，请先登录",
        )

    token = credentials.credentials
    try:
        headers = jwt.get_unverified_headers(token)
        kid = headers.get("kid")
        if not kid:
            raise ValueError("Token 缺少 kid")

        # 按 kid 匹配公钥
        key_data = None
        for k in _get_jwks_keys():
            if k.get("kid") == kid:
                key_data = k
                break

        if key_data is None:
            # 缓存里没有 → 强制刷新一次（应对 Keycloak 轮换密钥）
            global _jwks_cache
            _jwks_cache = []
            for k in _get_jwks_keys():
                if k.get("kid") == kid:
                    key_data = k
                    break

        if key_data is None:
            raise ValueError("找不到匹配的签名密钥")

        key = jwk.construct(key_data)
        message, signature = token.rsplit(".", 1)
        if not key.verify(message.encode(), base64url_decode(signature.encode())):
            raise ValueError("签名验证失败")

        payload = jwt.get_unverified_claims(token)
    except Exception as e:
        logger.warning("Token 验证失败: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录凭证无效或已过期",
        )

    return {
        "sub": payload.get("sub", ""),
        "username": payload.get("preferred_username", payload.get("sub", "")),
        "email": payload.get("email"),
        "roles": (payload.get("realm_access") or {}).get("roles", []),
    }
