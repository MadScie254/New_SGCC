"""The dataset observatory and the feature studio: the release, and what is built from it.

These routes measure the file itself and the features derived from it, so they are research
views. They expose labels, which the operations routers never do.

The feature-studio routes live here under /features because the console serves one extension
router per registered name and the two workspaces share a subject: what the data contains
before any model reads it.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from backend.services import feature_lab, observatory as service
from backend.services.errors import NotFoundError

router = APIRouter(prefix="/api/observatory", tags=["observatory"])

Customer = Query(max_length=64, pattern=r"^[A-Za-z0-9_.\-]{1,64}$")


@router.get("/release")
async def release() -> Dict[str, Any]:
    """Integrity, completeness and class balance, each set beside the proposal's own claim."""
    return await run_in_threadpool(service.release)


@router.get("/coverage")
async def coverage() -> Dict[str, Any]:
    return await run_in_threadpool(service.coverage)


@router.get("/gaps")
async def gaps() -> Dict[str, Any]:
    return await run_in_threadpool(service.gaps)


@router.get("/consumption")
async def consumption() -> Dict[str, Any]:
    return await run_in_threadpool(service.consumption)


@router.get("/cleaning")
async def cleaning() -> Dict[str, Any]:
    return await run_in_threadpool(service.cleaning)


@router.get("/customers")
async def customers(query: str = Query(default="", max_length=64), label: Optional[int] = Query(default=None, ge=0, le=1),
                    limit: int = Query(default=40, ge=1, le=200)) -> Dict[str, Any]:
    return await run_in_threadpool(service.searchable_customers, query, label, limit)


@router.get("/customer")
async def customer(customer_id: str = Customer) -> Dict[str, Any]:
    """One customer's released readings beside the same series after the study's cleaning step."""
    return await run_in_threadpool(service.customer, customer_id)


# ---------------------------------------------------------------------------
# Feature studio
# ---------------------------------------------------------------------------


@router.get("/features/catalog")
async def feature_catalog() -> Dict[str, Any]:
    """Every engineered feature, its group, and how much the served model used it."""
    return await run_in_threadpool(feature_lab.catalog)


@router.get("/features/ablation")
async def feature_ablation() -> Dict[str, Any]:
    return await run_in_threadpool(feature_lab.ablation)


@router.get("/features/history-length")
async def feature_history_length() -> Dict[str, Any]:
    return await run_in_threadpool(feature_lab.history_length)


@router.get("/features/names")
async def feature_names() -> Any:
    return await run_in_threadpool(feature_lab.feature_names)


@router.get("/features/distribution")
async def feature_distribution(
    feature: str = Query(max_length=64, pattern=r"^[A-Za-z0-9_.\-]{1,64}$"),
    bins: int = Query(default=30, ge=10, le=60),
) -> Dict[str, Any]:
    """One feature's distribution in each labelled class, measured from the release."""
    try:
        return await run_in_threadpool(feature_lab.distribution, feature, bins)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
