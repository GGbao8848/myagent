"""Keycloak 认证配置 — 从环境变量加载。"""

from __future__ import annotations

import os

# Keycloak 单点登录
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://127.0.0.1:6543")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "br-platform")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "br-agent")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET", "")
