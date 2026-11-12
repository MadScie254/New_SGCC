"""The dataset observatory: what the labelled SGCC release contains, before any model reads it.

These routes measure the file itself, so they are research views. They expose labels, which the
operations routers never do.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool

from backend.services import observatory as service

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
