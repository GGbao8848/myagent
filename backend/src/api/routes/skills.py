"""技能列表与管理路由（公共 + 私有）。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from src.api.auth import get_current_user
from src.agent.skills import delete_skill, install_skill_from_zip, list_skills_raw, set_skill_disabled
from src.models import DeleteResult, SkillInfo, SkillToggleRequest, SkillUploadResult

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/skills", tags=["skills"])


def _username(user: dict) -> str:
    return user.get("username", user.get("sub", ""))


def _notify_tool_manager():
    """通知 ToolManager 刷新技能 Provider 缓存并重建 Agent。"""
    from src.api.deps import get_tool_manager, get_manager

    tm = get_tool_manager()
    if tm is not None:
        tm.refresh_skills()
        manager = get_manager()
        try:
            manager.sync_mcp_tools([])
        except Exception:
            pass


@router.get("", response_model=list[SkillInfo])
async def get_skills(show_all: bool = False, user: dict = Depends(get_current_user)):
    """列出技能（公共 + 当前用户私有）。show_all=true 含已禁用。"""
    owner = _username(user)
    return list_skills_raw(show_all=show_all, owner=owner)


@router.post("/upload", response_model=SkillUploadResult)
async def upload_skill(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """上传并安装技能（zip 包）到当前用户私有目录。

    zip 内必须包含 SKILL.md，可嵌套在一层目录中。

    示例: zip 包含 `my-skill/SKILL.md` + `my-skill/scripts/` → 安装为 `my-skill`
    """
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(400, "仅支持 .zip 格式的压缩包")

    owner = _username(user)
    try:
        zip_data = await file.read()
        skill_id, info = install_skill_from_zip(zip_data, owner=owner)
        _notify_tool_manager()
        return SkillUploadResult(skill_id=skill_id, skill=info)
    except FileExistsError as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"安装失败: {e}")


@router.patch("/{skill_id}", response_model=SkillInfo)
async def toggle_skill(skill_id: str, body: SkillToggleRequest, user: dict = Depends(get_current_user)):
    """启用或禁用一个技能。"""
    owner = _username(user)
    if not set_skill_disabled(skill_id, body.disabled):
        raise HTTPException(404, "技能不存在")
    _notify_tool_manager()
    skills = list_skills_raw(show_all=True, owner=owner)
    for s in skills:
        if s["id"] == skill_id:
            return s
    raise HTTPException(404, "技能不存在")


@router.delete("/{skill_id}", response_model=DeleteResult)
async def remove_skill(skill_id: str, user: dict = Depends(get_current_user)):
    """删除一个技能（仅能删自己的私有技能）。"""
    owner = _username(user)
    if not delete_skill(skill_id, owner=owner):
        raise HTTPException(404, "技能不存在或无权删除")
    _notify_tool_manager()
    return DeleteResult(deleted=True)
