"""Statistical evaluation of the study's pipelines (read-only).

Nothing here selects anything using the held-out test customers: the threshold sweep refuses
`split=test` with an explanation, and no endpoint returns a "best" threshold, weight or feature.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from backend.services import statistics as service

router = APIRouter(prefix="/api/statistics", tags=["statistics"])

Run = Query(default="reported", max_length=120, description='"reported", "latest", or a run id')
Split = Query(default="test", pattern="^(test|validation)$")
Names = Query(default=None, max_length=40)


def _guard(call, *args, **kwargs):
    try:
        return call(*args, **kwargs)
    except service.SelectionOnTestRefused as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/runs")
def runs() -> List[Dict[str, Any]]:
    return service.available_runs()


@router.get("/pipelines")
def pipelines(run: str = Run, split: str = Split) -> Dict[str, Any]:
    return _guard(service.pipelines, run, split)


@router.get("/curves")
def curves(run: str = Run, split: str = Split, names: Optional[List[str]] = Names) -> Dict[str, Any]:
    return _guard(service.curves, run, split, names)


@router.get("/calibration")
def calibration(run: str = Run, split: str = Split, name: str = Query(default="hybrid", max_length=60),
                bins: int = Query(default=10, ge=4, le=30)) -> Dict[str, Any]:
    return _guard(service.calibration, run, split, name, bins)


@router.get("/ranked")
def ranked(run: str = Run, split: str = Split, names: Optional[List[str]] = Names) -> Dict[str, Any]:
    return _guard(service.ranked, run, split, names)


@router.get("/threshold-sweep")
def threshold_sweep(run: str = Run, split: str = Query(default="validation", pattern="^(test|validation)$"),
                    name: str = Query(default="hybrid", max_length=60)) -> Dict[str, Any]:
    """Precision and recall against threshold, on validation customers. `split=test` is refused."""
    return _guard(service.threshold_sweep, run, split, name)


@router.get("/significance")
async def significance(run: str = Run, split: str = Split, reference: str = Query(default="proposed", max_length=60),
                       names: Optional[List[str]] = Names,
                       resamples: int = Query(default=service.DEFAULT_RESAMPLES, ge=200, le=service.MAX_RESAMPLES),
                       seed: int = Query(default=42, ge=0, le=100000)) -> Dict[str, Any]:
    return await run_in_threadpool(_guard, service.significance, run, split, reference, names, resamples, seed)


@router.get("/stability")
def stability(run: str = Run) -> Dict[str, Any]:
    return _guard(service.stability, run)


@router.get("/limitations")
def limitations(run: str = Run) -> Dict[str, Any]:
    return _guard(service.limitations, run)


@router.get("/compare")
def compare(a: str = Query(max_length=120), b: str = Query(max_length=120), split: str = Split) -> Dict[str, Any]:
    return _guard(service.compare, a, b, split)
