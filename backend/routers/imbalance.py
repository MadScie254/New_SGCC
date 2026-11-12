"""Class imbalance and the proposal's SMOTE+ENN framework (section 3.9).

A research router: it reads labelled training customers. Nothing here touches test customers,
and the interactive resample fits on training rows only.
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from backend.services import imbalance as service
from backend.services.errors import NotFoundError

router = APIRouter(prefix="/api/imbalance", tags=["imbalance"])


@router.get("/overview")
async def overview() -> Dict[str, Any]:
    """The class ratio, and what it does to accuracy as a measure of this problem."""
    return await run_in_threadpool(service.overview)


@router.get("/treatment")
async def treatment() -> Dict[str, Any]:
    return await run_in_threadpool(service.treatment_effect)


@router.get("/sensitivity")
async def sensitivity() -> Dict[str, Any]:
    return await run_in_threadpool(service.sensitivity)


@router.get("/fair-test")
async def fair_test() -> Dict[str, Any]:
    return await run_in_threadpool(service.fair_test)


@router.get("/treatments")
def treatments() -> List[Dict[str, str]]:
    return service.treatments()


@router.get("/try")
async def try_treatment(
    kind: str = Query(default="smote_enn", max_length=32),
    sampling_strategy: float = Query(default=0.5, gt=0.0, le=1.0),
    smote_k_neighbors: int = Query(default=5, ge=1, le=20),
    enn_n_neighbors: int = Query(default=3, ge=1, le=20),
    sample: int = Query(default=service.DEFAULT_SAMPLE, ge=service.MIN_SAMPLE, le=service.MAX_SAMPLE),
    feature: str = Query(default="", max_length=64, pattern=r"^[A-Za-z0-9_.\-]{0,64}$"),
) -> Dict[str, Any]:
    """Apply one treatment to a sample of training rows. Exploratory: outside the study's protocol."""
    try:
        return await run_in_threadpool(service.try_treatment, kind, sampling_strategy, smote_k_neighbors,
                                       enn_n_neighbors, sample, feature)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
