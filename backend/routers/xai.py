"""Explainable AI for research customers: SHAP, LIME, CNN week occlusion and the shortcut investigation.

These routes work on the labelled study split, so they are research views, not operations views.
A customer's explanation here carries their known label; the operations case pages never do.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from backend.services import xai as service

router = APIRouter(prefix="/api/xai", tags=["explainability"])

Customer = Query(max_length=64, pattern=r"^[A-Za-z0-9_.\-]{1,64}$")


def _guard(call, *args, **kwargs):
    try:
        return call(*args, **kwargs)
    except service.ExplainerUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/customers")
def customers(query: str = Query(default="", max_length=64), label: Optional[int] = Query(default=None, ge=0, le=1),
              limit: int = Query(default=40, ge=1, le=200)) -> Dict[str, Any]:
    return _guard(service.searchable_customers, query, label, limit)


@router.get("/global")
async def global_importance(seed: int = Query(default=42, ge=0, le=10_000), top: int = Query(default=25, ge=5, le=60)) -> Dict[str, Any]:
    return await run_in_threadpool(_guard, service.global_importance, seed, top)


@router.get("/beeswarm")
async def beeswarm(seed: int = Query(default=42, ge=0, le=10_000), top: int = Query(default=12, ge=4, le=24)) -> Dict[str, Any]:
    return await run_in_threadpool(_guard, service.beeswarm, seed, top)


@router.get("/customer")
async def customer(customer_id: str = Customer, top: int = Query(default=15, ge=5, le=40)) -> Dict[str, Any]:
    return await run_in_threadpool(_guard, service.explain_customer, customer_id, top)


@router.get("/weeks")
async def weeks(customer_id: str = Customer) -> Dict[str, Any]:
    return await run_in_threadpool(_guard, service.week_effects, customer_id)


@router.get("/agreement")
async def agreement(customer_id: str = Customer, top: int = Query(default=5, ge=3, le=12),
                    samples: int = Query(default=service.LIME_SAMPLES, ge=200, le=8000)) -> Dict[str, Any]:
    """SHAP against LIME for one customer. Disagreement is reported, not hidden."""
    return await run_in_threadpool(_guard, service.explanation_agreement, customer_id, top, samples)


@router.get("/missingness/profile")
async def missingness_profile() -> Dict[str, Any]:
    return await run_in_threadpool(_guard, service.missingness_profile)


@router.get("/missingness/attribution")
async def missingness_attribution(seed: int = Query(default=42, ge=0, le=10_000)) -> Dict[str, Any]:
    return await run_in_threadpool(_guard, service.missingness_attribution, seed)


@router.get("/missingness/evidence")
def missingness_evidence() -> Dict[str, Any]:
    return _guard(service.shortcut_evidence)


@router.get("/missingness/mask-experiment")
async def mask_experiment(customer_id: str = Customer) -> Dict[str, Any]:
    """One customer's CNN score with the missing-reading channel hidden. A counterfactual input, not a new model."""
    return await run_in_threadpool(_guard, service.mask_experiment, customer_id)
