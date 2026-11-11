"""3D digital twin API: a simulated network, reading scenarios scored by the served model, and observed customers for display."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.services import twin
from src.simulation import MAX_SEED

router = APIRouter(prefix="/api/twin", tags=["twin"])

Seed = Field(default=7, ge=0, le=MAX_SEED)


class ScenarioRequest(BaseModel):
    seed: int = Seed
    scenario: str = Field(min_length=1, max_length=64)
    params: Dict[str, Any] = Field(default_factory=dict)
    service_point: Optional[str] = Field(default=None, min_length=1, max_length=16)


class Assignment(BaseModel):
    service_point: str = Field(min_length=1, max_length=16)
    scenario: str = Field(min_length=1, max_length=64)
    params: Dict[str, Any] = Field(default_factory=dict)


class SimulateRequest(BaseModel):
    seed: int = Seed
    assignment: Optional[List[Assignment]] = Field(default=None, max_length=twin.MAX_ASSIGNMENTS)
    start_day: Optional[int] = Field(default=None, ge=0)
    end_day: Optional[int] = Field(default=None, ge=0)


def _checked(work, *args, **kwargs):
    try:
        return work(*args, **kwargs)
    except ValueError as exc:  # SimulationError: unknown scenario, parameter out of bounds, bad window
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/network")
def network(seed: int = Query(default=7, ge=0, le=MAX_SEED)):
    """The synthetic distribution network for a seed: nodes and edges, every one marked synthetic."""
    return _checked(twin.network, seed)


@router.get("/scenarios")
def scenarios():
    """The scenario catalogue with bounded parameters, the look-alike pairs and the calendar of the served series."""
    return twin.scenarios()


@router.post("/scenarios/score")
def score_scenario(request: ScenarioRequest):
    """One scenario series on a virtual meter, scored and explained by the model in service."""
    return _checked(twin.score_scenario, request.seed, request.scenario, request.params, request.service_point)


@router.post("/simulate")
def simulate(request: SimulateRequest):
    """The network over a window of days: meter readings, model scores, and supplied against metered energy."""
    assignment = None if request.assignment is None else [item.model_dump() for item in request.assignment]
    return _checked(twin.simulate, request.seed, assignment, request.start_day, request.end_day)


@router.get("/customers/{customer_id}")
def observed_customer(customer_id: str):
    """An operational SGCC customer's recorded readings and served score, for display on a virtual meter."""
    return twin.observed_customer(customer_id)
