"""SSE 流式聊天路由。"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from src.api.deps import get_db, get_manager
from src.models import ChatRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sessions", tags=["chat"])


@router.post("/{session_id}/chat")
async def chat(session_id: str, body: ChatRequest):
    """发送消息并流式返回 Agent 回复 (SSE)。

    SSE 事件: token, done, error, profile_update
    """
    if not get_db().session_exists(session_id):
        raise HTTPException(404, "会话不存在")

    manager = get_manager()

    async def event_stream():
        loop = asyncio.get_running_loop()
        q: asyncio.Queue[dict | None] = asyncio.Queue()

        def _run_sync() -> None:
            try:
                for event in manager.stream_chat(session_id, body.message):
                    loop.call_soon_threadsafe(q.put_nowait, event)
            except Exception as exc:
                loop.call_soon_threadsafe(
                    q.put_nowait, {"event": "error", "content": str(exc)}
                )
            finally:
                loop.call_soon_threadsafe(q.put_nowait, None)

        task = loop.run_in_executor(None, _run_sync)

        try:
            while True:
                event = await q.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except (asyncio.CancelledError, GeneratorExit):
            # 客户端断开连接 → 取消后台 agent 生成
            manager.cancel_stream(session_id)
            # 等待线程池任务结束
            try:
                await asyncio.wait_for(task, timeout=5.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
            logger.info("SSE: 会话 %s 客户端断开，已取消生成", session_id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{session_id}/stop")
async def stop_chat(session_id: str):
    """主动中断指定会话的流式生成（由前端停止按钮触发）。"""
    manager = get_manager()
    if not get_db().session_exists(session_id):
        raise HTTPException(404, "会话不存在")

    cancelled = manager.cancel_stream(session_id)
    return {"cancelled": cancelled, "session_id": session_id}
