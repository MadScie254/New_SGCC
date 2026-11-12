"""Thesis defence mode: the claims, the conclusions drawn from them, and the open questions.

A research router. It reads the predeclared findings ledger, the post-hoc conclusions register
and the recorded limitations, and keeps the three apart because they carry different weight.
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from backend.services import defense as service

router = APIRouter(prefix="/api/defense", tags=["defence"])


@router.get("/briefing")
async def briefing() -> Dict[str, Any]:
    """What was claimed, what survived a rerun, and what is still open."""
    return await run_in_threadpool(service.briefing)


@router.get("/claims")
async def claims() -> Dict[str, Any]:
    """The predeclared findings ledger, grouped by the objective each claim belongs to."""
    return await run_in_threadpool(service.claims)


@router.get("/conclusions")
async def conclusions() -> Dict[str, Any]:
    """The qualitative claims and whether each still holds. Post hoc, and labelled as such."""
    return await run_in_threadpool(service.conclusions)


@router.get("/questions")
async def questions() -> Dict[str, Any]:
    """Each recorded limitation as the question it invites, with whatever answers it."""
    return await run_in_threadpool(service.questions)
