"""会话 CRUD 路由（用户级隔离）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from src.api.auth import get_current_user
from src.api.deps import get_db, get_manager
from src.models import (
    CreateSessionRequest,
    DeleteResult,
    SessionDetail,
    SessionSummary,
    UpdateSessionRequest,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _username(user: dict) -> str:
    return user.get("username", user.get("sub", ""))


@router.get("", response_model=list[SessionSummary])
async def list_sessions(user: dict = Depends(get_current_user)):
    return get_db().list_sessions(user_id=_username(user))


@router.post("", response_model=SessionDetail, status_code=201)
async def create_session(body: CreateSessionRequest | None = None,
                         user: dict = Depends(get_current_user)):
    title = body.title if body and body.title else "新对话"
    sid = get_db().create_session(title, user_id=_username(user))
    return get_db().get_session(sid, user_id=_username(user))


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(session_id: str, user: dict = Depends(get_current_user)):
    result = get_db().get_session(session_id, user_id=_username(user))
    if result is None:
        raise HTTPException(404, "会话不存在")
    return result


@router.patch("/{session_id}", response_model=SessionSummary)
async def update_session(session_id: str, body: UpdateSessionRequest,
                         user: dict = Depends(get_current_user)):
    if not get_db().update_session(session_id, body.title, user_id=_username(user)):
        raise HTTPException(404, "会话不存在")
    return get_db().get_session(session_id, user_id=_username(user))


@router.delete("/{session_id}", response_model=DeleteResult)
async def delete_session(session_id: str, user: dict = Depends(get_current_user)):
    if not get_db().delete_session(session_id, user_id=_username(user)):
        raise HTTPException(404, "会话不存在")
    get_manager().clear_buffer(session_id)
    return DeleteResult(deleted=True)
