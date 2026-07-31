"""用户画像路由。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.api.deps import get_profile
from src.models import (
    DeleteObservationRequest,
    ObservationItem,
    ProfileData,
    ProfileStats,
    ProfileUpdateSummary,
    UpdateObservationRequest,
    UpdateProfileRequest,
)

router = APIRouter(prefix="/api/profile", tags=["profile"])


@router.get("", response_model=ProfileData)
async def getget_profile():
    return get_profile().get_data()


@router.get("/stats", response_model=ProfileStats)
async def get_profile_stats():
    return get_profile().get_stats()


@router.get("/observations", response_model=list[ObservationItem])
async def list_observations(min_confidence: float = 0.0):
    return [o.to_dict() for o in get_profile().get_observations(min_confidence=min_confidence)]


@router.post("/observations", response_model=ProfileUpdateSummary)
async def add_observation(body: UpdateProfileRequest):
    obs = get_profile().observe(body.content, source=body.source, confidence=body.confidence)
    return ProfileUpdateSummary(
        new_observations=[obs.to_dict()] if obs else [],
        updated_count=1 if obs else 0,
        summary=get_profile().summary_text(),
    )


@router.patch("/observations/{obs_id}", response_model=ProfileUpdateSummary)
async def update_observation(obs_id: str, body: UpdateObservationRequest):
    ok = get_profile().set_observation_confidence(obs_id, body.confidence)
    if not ok:
        raise HTTPException(404, "观察不存在")
    return ProfileUpdateSummary(updated_count=1, summary=get_profile().summary_text())


@router.delete("/observations/{obs_id}")
async def delete_observation(obs_id: str):
    ok = get_profile().forget(obs_id)
    if not ok:
        raise HTTPException(404, "观察不存在")
    return {"deleted": True}
