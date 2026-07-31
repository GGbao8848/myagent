"""Tool Gateway — 统一的外部 Tool 调用网关。

位于 ToolManager 和外部 Tool Provider 之间，提供：
  - 超时控制
  - 重试（指数退避）
  - 熔断（连续失败后暂停调用，保护下游）
  - 调用统计

当前集成点：MCPProvider.call() → 通过 gateway 调用远程 MCP 工具。
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Awaitable

logger = logging.getLogger(__name__)

# ── 默认参数 ──────────────────────────────────────────

DEFAULT_TIMEOUT = 30.0          # 单次调用超时（秒）
DEFAULT_MAX_RETRIES = 2         # 最大重试次数
DEFAULT_BACKOFF_BASE = 0.5      # 退避基础间隔（秒）
CIRCUIT_BREAKER_THRESHOLD = 5   # 连续失败 N 次后熔断
CIRCUIT_HALF_OPEN_AFTER = 30.0  # 熔断后 N 秒进入半开状态
CIRCUIT_HALF_OPEN_MAX = 1       # 半开状态最多允许 N 次试探调用


@dataclass
class CallStats:
    """单个 Tool 的调用统计。"""
    total: int = 0
    success: int = 0
    failure: int = 0
    timeout: int = 0
    last_call_at: float = 0.0
    last_error: str = ""
    avg_latency_ms: float = 0.0

    @property
    def success_rate(self) -> float:
        if self.total == 0:
            return 1.0
        return self.success / self.total


class ToolGateway:
    """外部 Tool 调用网关。

    用法:
        gateway = ToolGateway()
        result = await gateway.call(
            "mcp:my_server:my_tool",
            lambda: mcp_manager.call_tool(server_id, tool_name, args),
        )
    """

    def __init__(
        self,
        default_timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        backoff_base: float = DEFAULT_BACKOFF_BASE,
    ) -> None:
        self._default_timeout = default_timeout
        self._max_retries = max_retries
        self._backoff_base = backoff_base

        self._stats: dict[str, CallStats] = {}
        self._circuit_state: dict[str, str] = {}        # "closed" | "open" | "half_open"
        self._circuit_failures: dict[str, int] = {}      # 连续失败计数
        self._circuit_opened_at: dict[str, float] = {}   # 熔断触发时间

    # ── 公共接口 ───────────────────────────────────────

    async def call(
        self,
        tool_key: str,
        call_fn: Callable[[], Awaitable[str]],
        *,
        timeout: float | None = None,
        max_retries: int | None = None,
    ) -> str:
        """通过网关调用 Tool。

        Args:
            tool_key: 工具唯一标识（如 "mcp:server_id:tool_name"）
            call_fn: 实际调用函数（async callable，返回 str）
            timeout: 单次调用超时，None 使用默认值
            max_retries: 最大重试次数，None 使用默认值

        Returns:
            Tool 执行结果（JSON 字符串）

        Raises:
            CircuitBreakerOpenError: 熔断器打开，拒绝调用
        """
        effective_timeout = timeout or self._default_timeout
        effective_retries = max_retries if max_retries is not None else self._max_retries

        # ── 熔断检查 ──
        self._check_circuit(tool_key)

        # ── 调用（含重试）──
        stats = self._get_stats(tool_key)
        last_error = ""

        for attempt in range(effective_retries + 1):
            start = time.monotonic()
            try:
                result = await asyncio.wait_for(call_fn(), timeout=effective_timeout)
                elapsed = (time.monotonic() - start) * 1000

                # 成功 — 更新统计 & 重置熔断
                stats.success += 1
                stats.total += 1
                stats.last_call_at = start
                stats.avg_latency_ms = (
                    stats.avg_latency_ms * (stats.total - 1) + elapsed
                ) / stats.total

                self._on_success(tool_key)
                return result

            except asyncio.TimeoutError:
                elapsed = (time.monotonic() - start) * 1000
                last_error = f"Timeout after {effective_timeout}s"
                stats.timeout += 1
                logger.warning("Gateway: %s 超时 (attempt %d/%d, %.0fms)",
                               tool_key, attempt + 1, effective_retries + 1, elapsed)

            except Exception as exc:
                elapsed = (time.monotonic() - start) * 1000
                last_error = str(exc)
                logger.warning("Gateway: %s 失败 (attempt %d/%d, %.0fms): %s",
                               tool_key, attempt + 1, effective_retries + 1, elapsed, exc)

            # 重试前退避
            if attempt < effective_retries:
                wait = self._backoff_base * (2 ** attempt)
                await asyncio.sleep(wait)

        # 全部重试耗尽
        stats.failure += 1
        stats.total += 1
        stats.last_call_at = start if 'start' in dir() else time.monotonic()
        stats.last_error = last_error

        self._on_failure(tool_key)
        import json
        return json.dumps({"error": last_error, "tool": tool_key})

    # ── 查询 ──────────────────────────────────────────

    def get_stats(self, tool_key: str) -> CallStats:
        return self._get_stats(tool_key)

    def get_all_stats(self) -> dict[str, CallStats]:
        return dict(self._stats)

    def is_circuit_open(self, tool_key: str) -> bool:
        return self._circuit_state.get(tool_key, "closed") == "open"

    # ── 熔断逻辑 ──────────────────────────────────────

    def _check_circuit(self, tool_key: str) -> None:
        """检查熔断状态，必要时拒绝调用或进入半开。"""
        state = self._circuit_state.get(tool_key, "closed")

        if state == "closed":
            return

        if state == "open":
            elapsed = time.monotonic() - self._circuit_opened_at.get(tool_key, 0)
            if elapsed >= CIRCUIT_HALF_OPEN_AFTER:
                # 进入半开状态，允许试探
                self._circuit_state[tool_key] = "half_open"
                self._circuit_failures[tool_key] = 0
                logger.info("Gateway: %s 熔断器进入半开状态", tool_key)
            else:
                raise CircuitBreakerOpenError(
                    f"Tool '{tool_key}' 已熔断，"
                    f"剩余 {CIRCUIT_HALF_OPEN_AFTER - elapsed:.0f}s"
                )

        # half_open: 允许通过（试探调用）

    def _on_success(self, tool_key: str) -> None:
        self._circuit_failures[tool_key] = 0
        self._circuit_state[tool_key] = "closed"

    def _on_failure(self, tool_key: str) -> None:
        current = self._circuit_failures.get(tool_key, 0) + 1
        self._circuit_failures[tool_key] = current

        if current >= CIRCUIT_BREAKER_THRESHOLD:
            self._circuit_state[tool_key] = "open"
            self._circuit_opened_at[tool_key] = time.monotonic()
            logger.warning(
                "Gateway: %s 连续失败 %d 次，熔断器打开",
                tool_key, current,
            )

    # ── 内部 ──────────────────────────────────────────

    def _get_stats(self, tool_key: str) -> CallStats:
        if tool_key not in self._stats:
            self._stats[tool_key] = CallStats()
        return self._stats[tool_key]


class CircuitBreakerOpenError(Exception):
    """熔断器打开时拒绝调用。"""
    pass
