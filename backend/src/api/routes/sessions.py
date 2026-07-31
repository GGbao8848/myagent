"""会话 CRUD 路由。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.api.deps import get_db, get_manager
from src.models import (
    CreateSessionRequest,
    DeleteResult,
    SessionDetail,
    SessionSummary,
    UpdateSessionRequest,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("", response_model=list[SessionSummary])
async def list_sessions():
    return get_db().list_sessions()


@router.post("", response_model=SessionDetail, status_code=201)
async def create_session(body: CreateSessionRequest | None = None):
    title = body.title if body and body.title else "新对话"
    sid = get_db().create_session(title)
    return get_db().get_session(sid)


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(session_id: str):
    result = get_db().get_session(session_id)
    if result is None:
        raise HTTPException(404, "会话不存在")
    return result


@router.patch("/{session_id}", response_model=SessionSummary)
async def update_session(session_id: str, body: UpdateSessionRequest):
    if not get_db().update_session(session_id, body.title):
        raise HTTPException(404, "会话不存在")
    return get_db().get_session(session_id)


@router.delete("/{session_id}", response_model=DeleteResult)
async def delete_session(session_id: str):
    if not get_db().delete_session(session_id):
        raise HTTPException(404, "会话不存在")
    get_manager().clear_buffer(session_id)
    return DeleteResult(deleted=True)
