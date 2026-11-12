"""The deep model and the ensemble (proposal section 3.11).

A research router: it reads the sealed run's record and its saved predictions on the study's
labelled split. The blend weight is swept on validation customers only.
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from backend.services import deeplab as service

router = APIRouter(prefix="/api/deeplab", tags=["deep learning"])


def _guard(call, *args, **kwargs):
    try:
        return call(*args, **kwargs)
    except service.DeepArtifactsMissing as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/network")
async def network() -> Dict[str, Any]:
    """What was trained, for how long, and what it cost."""
    return await run_in_threadpool(_guard, service.network)


@router.get("/against-features")
async def against_features() -> Dict[str, Any]:
    return await run_in_threadpool(_guard, service.against_features)


@router.get("/hybrid")
async def hybrid() -> Dict[str, Any]:
    return await run_in_threadpool(_guard, service.hybrid)


@router.get("/weight-sweep")
async def weight_sweep(step: float = Query(default=0.05, ge=0.01, le=0.25)) -> Dict[str, Any]:
    """Blend weight against validation PR-AUC, recomputed from the run's saved predictions."""
    return await run_in_threadpool(_guard, service.weight_sweep, step)


@router.get("/learning-curves")
async def learning_curves() -> Dict[str, Any]:
    return await run_in_threadpool(_guard, service.learning_curves)
