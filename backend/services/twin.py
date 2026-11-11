"""The 3D digital twin: a simulated network, simulated reading scenarios, and the served model's reaction to them.

SGCC has no customer locations and no network topology, so the network, its coordinates and
every scenario series are simulated (``src.simulation``) and labelled ``synthetic``. The one
authentic thing this service returns is an operational customer's recorded series, labelled
``observed``, for display on a virtual meter the user chooses; that attachment is arbitrary.

Simulated series are scored with the model in service through the same path as real
customers (``data.build_model_input`` then ``model.score``). Operations data are unlabelled:
this module never reads a label.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

from src import sequence, simulation
from src.simulation import SimulationError

from . import data as data_service
from . import model as model_service

MAX_WINDOW_DAYS = 180
DEFAULT_WINDOW_DAYS = 120
MAX_ASSIGNMENTS = 80
TOP_REASONS = 6

MODEL_STATEMENT = (
    "The model in service was trained on SGCC customers. Its score on a simulated series shows how the model "
    "reacts to a pattern of readings; it is not the probability that such a pattern is theft in the world."
)
NETWORK_STATEMENT = (
    "Simulated network, not SGCC infrastructure. The SGCC dataset has no customer locations and no network "
    "topology; every asset, coordinate, rating and connection here is generated from a seed for illustration."
)
ATTACHMENT_STATEMENT = (
    "These are the customer's recorded SGCC readings. Their attachment to a virtual meter is illustrative and "
    "arbitrary: SGCC does not say where this customer is or which transformer supplies them, and the readings "
    "take no part in the simulated network's energy balance."
)
BALANCE_STATEMENT = (
    "Supplied energy is simulated at each asset as the energy delivered below it plus assumed technical losses. "
    "A gap between supplied and metered energy has several causes (missing readings, a faulty meter, unmetered "
    "authorised loads, losses above the assumption, unauthorised consumption) and needs transformer metering "
    "to be seen at all. SGCC has none."
)


def _provenance(note: str, computed_from: str) -> Dict[str, Any]:
    return {"status": "synthetic", "source": "src.simulation (seeded generator)", "computed_from": computed_from, "note": note}


def calendar() -> pd.DatetimeIndex:
    """The days of the served series, so a simulated series can be scored by the model in service."""
    columns = data_service.get_wide_data().columns
    if isinstance(columns, pd.DatetimeIndex):
        return columns
    start, n_days = data_service.series_calendar()
    return pd.date_range(start, periods=n_days, freq="D")


def _dates(index: pd.DatetimeIndex) -> List[str]:
    return [day.strftime("%Y-%m-%d") for day in index]


def _numbers(values: np.ndarray, digits: int = 2) -> List[Optional[float]]:
    return [None if not np.isfinite(v) else round(float(v), digits) for v in values]


@lru_cache(maxsize=8)
def _network(seed: int) -> Dict[str, Any]:
    return simulation.generate_network(seed)


# ---------------------------------------------------------------------------
# Network and catalogue
# ---------------------------------------------------------------------------

def network(seed: int) -> Dict[str, Any]:
    return {**_network(simulation.check_seed(seed)),
            "provenance": _provenance(NETWORK_STATEMENT, f"seed {seed}; no SGCC data is used"),
            "statement": NETWORK_STATEMENT}


def scenarios() -> Dict[str, Any]:
    dates = calendar()
    threshold = model_service.get_decision_threshold()
    spec = data_service.get_pipeline_spec()
    return {
        "provenance": _provenance(MODEL_STATEMENT, "scenario definitions in src.simulation"),
        "synthetic": True,
        "calendar": {"start": dates[0].strftime("%Y-%m-%d"), "end": dates[-1].strftime("%Y-%m-%d"), "days": len(dates),
                     "dates": _dates(dates)},
        "window": {"default_days": min(DEFAULT_WINDOW_DAYS, len(dates)), "max_days": MAX_WINDOW_DAYS},
        "scenarios": simulation.scenario_catalogue(len(dates)),
        "compare_pairs": simulation.COMPARE_PAIRS,
        "model": {"pipeline": spec["name"], "label": spec["label"], "version": spec["model_version"], "threshold": threshold,
                  "statement": MODEL_STATEMENT},
        "statements": {"network": NETWORK_STATEMENT, "model": MODEL_STATEMENT, "balance": BALANCE_STATEMENT,
                       "attachment": ATTACHMENT_STATEMENT, "losses": simulation.LOSS_ASSUMPTION},
    }


# ---------------------------------------------------------------------------
# Scoring simulated series with the model in service
# ---------------------------------------------------------------------------

def _wide(rows: np.ndarray, ids: Sequence[str]) -> pd.DataFrame:
    """Simulated rows in the layout of the served readings (same day columns, float32)."""
    columns = data_service.get_wide_data().columns
    return pd.DataFrame(np.asarray(rows, dtype=np.float32), index=pd.Index(list(ids), name="customer_id"), columns=columns)


def _score(wide: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(scores, features) by the serving path: the features and the hybrid's parts are built as for a real customer."""
    features = data_service.build_model_input(wide).reindex(columns=model_service.get_feature_names())
    return model_service.score(features, wide if model_service.is_hybrid() else None), features


def _week_effects(row: pd.DataFrame) -> Dict[str, Any]:
    """The sequence model's week-by-week effects for one row of readings (as model.sequence_explanation, for a row that is not in the population)."""
    if not model_service.is_hybrid():
        return {"available": False, "weeks": []}
    part = data_service.get_pipeline_spec()["components"][model_service.SEQUENCE]
    values, mask = sequence.prepare(row, part.get("cleaning"))
    effects = sequence.week_effects(model_service.get_sequence_network(), values[0], mask[0])
    days = sequence.day_index(row.shape[1])
    dates = calendar()
    weeks = []
    for item in effects:
        positions = [int(d) for d in days[item["week"] * 7:(item["week"] + 1) * 7] if d >= 0]
        if positions:
            weeks.append({"week": item["week"], "effect": float(item["effect"]),
                          "start": dates[positions[0]].strftime("%Y-%m-%d"), "end": dates[positions[-1]].strftime("%Y-%m-%d")})
    return {"available": True, "label": part["label"], "weeks": weeks}


def _meter(seed: int, service_point: Optional[str]) -> Dict[str, Any]:
    if service_point is None:
        return {"id": None, "meter_id": "VM-generic", "index": simulation.GENERIC_METER_INDEX, "building": "residential",
                "base_kwh": 8.0, "transformer": None}
    for node in simulation.service_points(_network(seed)):
        if node["id"] == service_point:
            return node
    raise SimulationError(f"Unknown service point for seed {seed}: {service_point!r}")


def _scenario_summary(scenario: str, params: Dict[str, Any], n_days: int) -> Dict[str, Any]:
    spec = simulation.scenario_spec(scenario, n_days)
    return {key: spec[key] for key in ("id", "title", "category", "false_positive_example", "network_side", "readings_show",
                                       "other_causes", "delivery_assumption")} | {"params": params}


@lru_cache(maxsize=64)
def _scored_scenario(population_id: str, threshold: float, seed: int, service_point: Optional[str], scenario: str,
                     params_json: str) -> Dict[str, Any]:
    dates = calendar()
    meter = _meter(seed, service_point)
    series = simulation.build_series(scenario, json.loads(params_json), dates, seed, meter["index"], meter["base_kwh"], meter["building"])
    wide = _wide(series["registered"][None, :], ["virtual-meter"])
    scores, features = _score(wide)
    scored = scores.iloc[0]
    probability = float(scored["probability"])
    registered = series["registered"]
    return {
        "provenance": _provenance(MODEL_STATEMENT, f"seed {seed}, scenario {scenario}; scored by the model in service"),
        "synthetic": True,
        "seed": seed,
        "meter": {"service_point": meter["id"], "meter_id": meter["meter_id"], "building": meter["building"],
                  "base_kwh": meter["base_kwh"], "transformer": meter.get("transformer"), "synthetic": True},
        "scenario": _scenario_summary(scenario, series["params"], len(dates)),
        "series": {
            "synthetic": True, "unit": "kWh per day",
            "points": [{"date": day, "kwh": value} for day, value in zip(_dates(dates), _numbers(registered))],
            "days": int(len(registered)), "missing_days": int(np.isnan(registered).sum()),
            "zero_days": int((registered == 0).sum()),
            "registered_kwh": round(float(np.nansum(registered)), 1),
            "delivered_kwh": round(float(series["delivered"].sum()), 1),
            "unmetered_kwh": round(float(series["unmetered"].sum()), 1),
        },
        "model": {
            "probability": probability, "raw_score": float(scored["raw_score"]), "threshold": threshold,
            "flagged": bool(probability >= threshold), "risk_tier": model_service.risk_tier(probability, threshold),
            "parts": model_service.blend_parts(scored),
            "reasons": model_service._reasons(features.iloc[0], model_service._shap_matrix(features)[0], top_n=TOP_REASONS),
            "reasons_explain": "SHAP contributions to the XGBoost part's raw score (log-odds); positive raises it.",
            "sequence": _week_effects(wide),
            "statement": MODEL_STATEMENT,
        },
    }


def score_scenario(seed: int, scenario: str, params: Optional[Dict[str, Any]] = None, service_point: Optional[str] = None) -> Dict[str, Any]:
    """Build one scenario series on a virtual meter and score it with the model in service."""
    seed = simulation.check_seed(seed)
    resolved = simulation.validate_params(scenario, params, len(calendar()))
    return _scored_scenario(data_service.active_population()["id"], model_service.get_decision_threshold(), seed, service_point,
                            scenario, json.dumps(resolved, sort_keys=True))


# ---------------------------------------------------------------------------
# Network simulation over time
# ---------------------------------------------------------------------------

@lru_cache(maxsize=6)
def _simulation(population_id: str, seed: int, assignment_json: Optional[str]) -> Dict[str, Any]:
    net = _network(seed)
    dates = calendar()
    assignment = simulation.default_assignment(net, len(dates)) if assignment_json is None else json.loads(assignment_json)
    result = simulation.simulate_network(net, assignment, dates)
    scores, _ = _score(_wide(result["registered"], result["ids"]))
    return {**result, "probability": scores["probability"].to_numpy(dtype=float)}


def simulate(seed: int, assignment: Optional[List[Dict[str, Any]]] = None, start_day: Optional[int] = None,
             end_day: Optional[int] = None) -> Dict[str, Any]:
    """
    The simulated network over a window of days: each virtual meter's readings and model score,
    and supplied against metered energy at every upstream asset. ``assignment`` None uses the
    seeded default (a few anomalous-reading, legitimate-change and data-quality meters).
    """
    seed = simulation.check_seed(seed)
    dates = calendar()
    n = len(dates)
    end = n - 1 if end_day is None else end_day
    start = max(0, end - DEFAULT_WINDOW_DAYS + 1) if start_day is None else start_day
    if not 0 <= start <= end < n:
        raise SimulationError(f"The day window must satisfy 0 <= start_day <= end_day <= {n - 1}")
    if end - start + 1 > MAX_WINDOW_DAYS:
        raise SimulationError(f"The day window is limited to {MAX_WINDOW_DAYS} days")
    if assignment is not None and len(assignment) > MAX_ASSIGNMENTS:
        raise SimulationError(f"At most {MAX_ASSIGNMENTS} service points can be given a scenario")
    key = None if assignment is None else json.dumps(
        sorted(({"service_point": a["service_point"], "scenario": a["scenario"],
                 "params": simulation.validate_params(a["scenario"], a.get("params"), n)} for a in assignment),
               key=lambda a: a["service_point"]), sort_keys=True)
    sim = _simulation(data_service.active_population()["id"], seed, key)
    threshold = model_service.get_decision_threshold()
    window = slice(start, end + 1)
    net = _network(seed)
    kinds = {node["id"]: node["kind"] for node in net["nodes"]}

    meters = []
    for row, point_id in enumerate(sim["ids"]):
        chosen = sim["scenarios"][point_id]
        spec = simulation.scenario_spec(chosen["scenario"], n)
        probability = float(sim["probability"][row])
        meters.append({
            "id": point_id, "scenario": chosen["scenario"], "category": spec["category"], "probability": probability,
            "flagged": bool(probability >= threshold),
            "missing_days": int(np.isnan(sim["registered"][row, window]).sum()),
            "kwh": _numbers(sim["registered"][row, window]), "synthetic": True,
        })
    assigned = [
        {"service_point": point_id, "scenario": chosen["scenario"], "params": chosen["params"],
         **{k: simulation.scenario_spec(chosen["scenario"], n)[k] for k in ("title", "category", "false_positive_example", "network_side")},
         "synthetic": True}
        for point_id, chosen in sim["scenarios"].items() if chosen["scenario"] != "normal"
    ]
    aggregates = [
        {"id": node_id, "kind": kinds[node_id], "supplied": _numbers(parts["supplied"][window], 1),
         "metered": _numbers(parts["metered"][window], 1), "gap": _numbers(parts["gap"][window], 1),
         "missing_meter_days": int(parts["missing_meters"][window].sum()), "synthetic": True}
        for node_id, parts in sim["balance"].items()
    ]
    # System demand over the whole calendar, as weekly means of daily kWh (small enough to chart).
    root = sim["balance"]["BSP"]
    weeks = range(0, n, 7)
    system = {
        "synthetic": True, "resolution": "weekly mean of daily kWh", "unit": "kWh per day",
        "dates": [dates[i].strftime("%Y-%m-%d") for i in weeks],
        "supplied": [round(float(root["supplied"][i:i + 7].mean()), 1) for i in weeks],
        "metered": [round(float(root["metered"][i:i + 7].mean()), 1) for i in weeks],
        "gap": [round(float(root["gap"][i:i + 7].mean()), 1) for i in weeks],
    }
    return {
        "provenance": _provenance(MODEL_STATEMENT, f"seed {seed}; {len(assigned)} of {len(meters)} virtual meters carry a scenario"),
        "synthetic": True, "seed": seed,
        "window": {"start_day": start, "end_day": end, "dates": _dates(dates[window])},
        "assignment": assigned, "default_assignment": assignment is None,
        "meters": meters, "aggregates": aggregates, "system": system,
        "model": {"threshold": threshold, "flagged": int(sum(m["flagged"] for m in meters)), "meter_count": len(meters),
                  "scored_on": f"each meter's whole simulated series ({n} days)", "statement": MODEL_STATEMENT},
        "assumptions": {"technical_loss": simulation.TECHNICAL_LOSS, "losses": simulation.LOSS_ASSUMPTION, "balance": BALANCE_STATEMENT},
    }


# ---------------------------------------------------------------------------
# An authentic customer's readings, for display on a virtual meter
# ---------------------------------------------------------------------------

def observed_customer(customer_id: str) -> Dict[str, Any]:
    """An operational customer's recorded series and served score. Unlabelled: no ground truth exists here."""
    readings = data_service.get_customer_timeseries(customer_id)  # NotFoundError for an unknown id
    prediction = model_service.predict_customer(customer_id)
    population = data_service.active_population()
    observed = {"status": "observed", "source": f"operational population ({population['source']}: {population['filename']})",
                "computed_from": "recorded daily readings, unlabelled", "note": ATTACHMENT_STATEMENT}
    values = [p["kwh"] for p in readings["points"]]
    return {
        "customer_id": customer_id,
        "provenance": observed,
        "attachment": "illustrative",
        "attachment_note": ATTACHMENT_STATEMENT,
        "readings": {
            "provenance": {"status": "observed", "source": observed["source"], "computed_from": observed["computed_from"]},
            "unit": "kWh per day", "points": readings["points"], "days": len(values),
            "missing_days": sum(v is None for v in values), "zero_days": sum(v == 0 for v in values),
        },
        "model": {
            "probability": prediction["probability"], "raw_score": prediction["raw_score"], "threshold": prediction["threshold"],
            "flagged": bool(prediction["prediction"]), "risk_tier": prediction["risk_tier"], "parts": prediction["parts"],
            "reasons": prediction["reasons"],
            "reasons_explain": "SHAP contributions to the XGBoost part's raw score (log-odds); positive raises it.",
            "sequence": {k: v for k, v in model_service.sequence_explanation(customer_id).items() if k in ("available", "label", "weeks")},
            "statement": "A calibrated probability from the model in service. It flags a customer for inspection; it is not a finding of theft.",
        },
    }


CACHED = (_network, _scored_scenario, _simulation)
