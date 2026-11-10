"""The experiment registry: registered experiments, immutable runs, live progress and the findings ledger.

Runs are created and never changed through the API: there is no route that edits a run, a result
file or a finding. Starting, retrying and withdrawing runs needs the supervisor role.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from backend.dependencies.auth import User, require_supervisor
from backend.services import db
from backend.services import experiments as service

router = APIRouter(prefix="/api", tags=["experiments"])


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    settings: Optional[Dict[str, Any]] = None
    seed_from: Optional[List[str]] = Field(default=None, max_length=8)
    retry_of: Optional[str] = Field(default=None, max_length=120)


@router.get("/experiments")
def list_experiments() -> List[Dict[str, Any]]:
    return service.experiments()


@router.get("/experiments/{experiment_id}")
def get_experiment(experiment_id: str) -> Dict[str, Any]:
    return service.experiment(experiment_id)


@router.post("/experiments/{experiment_id}/runs", status_code=202)
def start_run(experiment_id: str, payload: RunRequest, user: User = Depends(require_supervisor)) -> Dict[str, Any]:
    record = service.start_run(experiment_id, user.name, payload.settings, payload.seed_from, payload.retry_of)
    db.audit(user.name, user.role, "experiment.run", record["run_id"],
             f"experiment={experiment_id} settings={payload.settings} seed_from={payload.seed_from} retry_of={payload.retry_of}")
    return record


@router.get("/runs")
def list_runs(experiment_id: Optional[str] = Query(default=None, max_length=64)) -> List[Dict[str, Any]]:
    return service.list_runs(experiment_id)


@router.get("/runs/compare")
def compare(a: str = Query(max_length=120), b: str = Query(max_length=120)) -> Dict[str, Any]:
    return service.compare_runs(a, b)


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> Dict[str, Any]:
    return service.get_run(run_id)


@router.get("/runs/{run_id}/events")
def events(run_id: str, after: int = Query(default=0, ge=0), limit: int = Query(default=500, ge=1, le=2000)) -> Dict[str, Any]:
    return service.run_events(run_id, after, limit)


@router.get("/runs/{run_id}/file")
def run_file(run_id: str, path: str = Query(max_length=300)) -> Dict[str, Any]:
    return service.run_file(run_id, path)


@router.post("/runs/{run_id}/verify")
def verify(run_id: str, user: User = Depends(require_supervisor)) -> Dict[str, Any]:
    """Re-hash every file of a sealed run now and compare with its seal and the database's copy."""
    service.get_run(run_id)
    result = service.integrity(run_id, fresh=True)
    db.audit(user.name, user.role, "experiment.verify", run_id, "intact" if result["intact"] else "; ".join(result["problems"])[:500])
    return result


@router.delete("/runs/{run_id}", status_code=204)
def withdraw(run_id: str, user: User = Depends(require_supervisor)) -> None:
    """Withdraw a run that is still queued. Started and finished runs cannot be removed."""
    service.withdraw(run_id)
    db.audit(user.name, user.role, "experiment.withdraw", run_id)


@router.get("/findings")
def findings() -> Dict[str, Any]:
    return service.ledger()


@router.get("/registry/status")
def status() -> Dict[str, Any]:
    return service.status()
