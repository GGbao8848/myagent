"""审计日志：记录每次 MCP 调用的关键信息，敏感内容脱敏。"""
from __future__ import annotations

import logging
import logging.handlers
import os
import time
from typing import Any


class AuditLogger:
    def __init__(self, log_dir: str, audit_file: str, max_bytes: int, backup_count: int) -> None:
        os.makedirs(log_dir, exist_ok=True)
        self.logger = logging.getLogger("agent_runtime.audit")
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False

        # 避免重复添加 handler（例如重复构建 server）
        if not any(isinstance(h, logging.handlers.RotatingFileHandler) for h in self.logger.handlers):
            handler = logging.handlers.RotatingFileHandler(
                os.path.join(log_dir, audit_file),
                maxBytes=max_bytes,
                backupCount=backup_count,
                encoding="utf-8",
            )
            handler.setFormatter(
                logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")
            )
            self.logger.addHandler(handler)

    @staticmethod
    def _redact(value: Any, limit: int = 200) -> str:
        """将参数值转为字符串并截断，避免把文件全文/大段内容写进审计日志。"""
        text = str(value)
        if len(text) > limit:
            text = text[:limit] + f"...（共 {len(str(value))} 字符）"
        return text.replace("\r", " ").replace("\n", " ")

    def log(
        self,
        tool: str,
        params: dict[str, Any],
        success: bool,
        duration_ms: int,
        message: str = "",
    ) -> None:
        summary = " ".join(f"{k}={self._redact(v)}" for k, v in params.items())
        self.logger.info(
            "tool=%s success=%s duration_ms=%d %s%s",
            tool,
            success,
            duration_ms,
            summary,
            f" message={message}" if message else "",
        )


class _Timer:
    """简单耗时统计上下文。"""

    def __init__(self) -> None:
        self.start = time.monotonic()

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.start) * 1000)
