"""
GridSentinel X - Digital twin simulation: a synthetic distribution network and reading scenarios

The SGCC dataset has no customer locations and no network topology. Everything this module
produces is therefore *simulated for illustration*: a seeded radial distribution network (one
bulk supply point, primary substations, medium-voltage feeders, distribution transformers,
low-voltage laterals and service points with a virtual smart meter each) and seeded daily-kWh
series that show what a pattern of *readings* looks like.

A scenario describes readings, never a cause. Several different causes produce the same
readings, and each scenario lists them. Scenarios of legitimate behaviour that looks suspicious
stand beside the others on equal footing.

The module is pure: no file, network or database access, and the same seed always gives the
same network and the same series. Callers pass the calendar (the dates of the served series).
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

MAX_SEED = 2**31 - 1
GENERIC_METER_INDEX = 100_000  # the seed stream of a meter that is not on the network

# Seed streams, so the network, a meter's baseline and a scenario's effect never share draws.
_NETWORK, _BASELINE, _EFFECT, _ASSIGNMENT = 7, 11, 13, 17

# Technical losses assumed at each level, as a fraction of the energy passing through it.
TECHNICAL_LOSS = {"lateral": 0.030, "transformer": 0.015, "feeder": 0.020, "substation": 0.005, "bulk_supply": 0.0}
LOSS_ASSUMPTION = (
    "Technical losses are assumed, not measured: 3.0% in low-voltage conductors, 1.5% in each distribution "
    "transformer, 2.0% in medium-voltage feeders and 0.5% in each primary substation, as fixed shares of the "
    "energy passing through. Real losses vary with load, temperature and conductor length."
)


class SimulationError(ValueError):
    """A seed, scenario or parameter outside what the simulation accepts."""


def sgcc_calendar() -> pd.DatetimeIndex:
    """The 1,034 days of the SGCC series: 2014-01-01 to 2016-10-31 without 2016-09-18."""
    days = pd.date_range("2014-01-01", "2016-10-31", freq="D")
    return days[days != pd.Timestamp("2016-09-18")]


def check_seed(seed: Any) -> int:
    if isinstance(seed, bool) or not isinstance(seed, (int, np.integer)) or not 0 <= int(seed) <= MAX_SEED:
        raise SimulationError(f"seed must be a whole number between 0 and {MAX_SEED}")
    return int(seed)


def _rng(seed: int, stream: int, index: int = 0) -> np.random.Generator:
    return np.random.default_rng(np.random.SeedSequence([int(seed), stream, int(index)]))


# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------

COLUMN = 84.0   # distance between feeder streets
ROW = 46.0      # distance between transformers along a feeder
TRANSFORMER_KVA = (100, 160, 250, 315, 400)


def _node(node_id: str, kind: str, label: str, x: float, z: float, parent: Optional[str], rating: float, unit: str,
          voltage: str, **extra: Any) -> Dict[str, Any]:
    return {"id": node_id, "kind": kind, "label": label, "position": {"x": round(float(x), 2), "y": 0.0, "z": round(float(z), 2)},
            "parent": parent, "rating": {"value": float(rating), "unit": unit, "voltage": voltage}, "synthetic": True, **extra}


def _edge(source: Dict[str, Any], target: Dict[str, Any], level: str, role: str,
          via: Optional[Sequence[Tuple[float, float]]] = None) -> Dict[str, Any]:
    start = (source["position"]["x"], source["position"]["z"])
    end = (target["position"]["x"], target["position"]["z"])
    points = [start, *(via or []), end]
    length = sum(math.dist(a, b) for a, b in zip(points, points[1:]))
    return {"id": f"{source['id']}>{target['id']}", "from": source["id"], "to": target["id"], "level": level, "role": role,
            "length_m": round(length, 1), "points": [[round(float(x), 2), 0.0, round(float(z), 2)] for x, z in points],
            "synthetic": True}


def generate_network(seed: int) -> Dict[str, Any]:
    """
    A synthetic radial distribution network laid out on a street grid. Positions are schematic
    metres on a flat plane (x east, z south). Nothing here corresponds to a real place.
    """
    seed = check_seed(seed)
    rng = _rng(seed, _NETWORK)
    n_substations = int(rng.integers(2, 4))
    feeders_per = [int(rng.integers(2, 4)) for _ in range(n_substations)]
    n_feeders = sum(feeders_per)
    n_transformers = int(rng.integers(12, 21))
    per_feeder = [n_transformers // n_feeders + (1 if i < n_transformers % n_feeders else 0) for i in range(n_feeders)]

    spacing = 2 * COLUMN
    offset = -((n_substations - 1) * spacing + COLUMN) / 2
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

    bulk = _node("BSP", "bulk_supply", "Bulk supply point", offset - 120, 0, None, 120, "MVA", "110/35 kV")
    centre = _node("OPS", "operations_centre", "Utility operations centre", offset - 120, -78, None, 0, "", "",
                   note="Receives simulated telemetry only. It is connected to no real system and sends no commands.")
    nodes += [bulk, centre]

    upstream = bulk
    feeder_no = transformer_no = meter_no = 0
    for s in range(n_substations):
        sub = _node(f"SS{s + 1}", "substation", f"Primary substation {s + 1}", offset + s * spacing, 0, upstream["id"],
                    int(rng.choice([20, 31.5, 40])), "MVA", "35/10 kV", substation=f"SS{s + 1}")
        nodes.append(sub)
        edges.append(_edge(upstream, sub, "hv", "line"))
        upstream = sub
        for j in range(feeders_per[s]):
            side = 1 if j % 2 == 0 else -1            # south, then north
            x = sub["position"]["x"] + (j // 2) * COLUMN
            feeder_id = f"F{feeder_no + 1}"
            feeder = _node(feeder_id, "feeder", f"Feeder {feeder_no + 1}", x, side * 16, sub["id"],
                           int(rng.choice([300, 400])), "A", "10 kV", substation=sub["id"], feeder=feeder_id)
            nodes.append(feeder)
            edges.append(_edge(sub, feeder, "mv", "line", via=[(x, 0)] if j // 2 else None))
            previous = feeder
            for k in range(per_feeder[feeder_no]):
                transformer_no += 1
                kva = int(rng.choice(TRANSFORMER_KVA, p=[0.15, 0.25, 0.3, 0.2, 0.1]))
                tz = side * (44 + k * ROW)
                tid = f"T{transformer_no:02d}"
                transformer = _node(tid, "transformer", f"Transformer {transformer_no:02d}", x, tz, feeder_id, kva, "kVA",
                                    "10/0.4 kV", substation=sub["id"], feeder=feeder_id, mount="pole" if kva <= 160 else "pad")
                nodes.append(transformer)
                edges.append(_edge(previous, transformer, "mv", "line"))
                previous = transformer
                n_points = int(rng.integers(13, 16))
                east = (n_points + 1) // 2
                for direction, count, tag in ((1, east, "E"), (-1, n_points - east, "W")):
                    reach = 9 + ((count - 1) // 2) * 8 + 4
                    lateral = _node(f"{tid}-{tag}", "lateral", f"LV lateral {tid} {'east' if direction > 0 else 'west'}",
                                    x + direction * reach, tz, tid, 250, "A", "0.4 kV", substation=sub["id"], feeder=feeder_id,
                                    transformer=tid)
                    nodes.append(lateral)
                    edges.append(_edge(transformer, lateral, "lv", "lateral"))
                    for i in range(count):
                        meter_no += 1
                        commercial = bool(rng.random() < 0.15)
                        base = float(np.clip(rng.lognormal(math.log(45 if commercial else 8), 0.5 if commercial else 0.45),
                                             15 if commercial else 2, 200 if commercial else 30))
                        px = x + direction * (9 + (i // 2) * 8)
                        pz = tz + (6.5 if i % 2 == 0 else -6.5)
                        point = _node(
                            f"SP{meter_no:03d}", "service_point", f"Service point {meter_no:03d}", px, pz, lateral["id"],
                            int(rng.choice([40, 63, 80])) if commercial else int(rng.choice([6, 8, 10])), "kVA", "0.4 kV",
                            substation=sub["id"], feeder=feeder_id, transformer=tid, index=meter_no - 1,
                            building="commercial" if commercial else "residential", meter_id=f"VM-{meter_no:04d}",
                            base_kwh=round(base, 2),
                            footprint={"w": round(float(rng.uniform(5.2, 6.4) if commercial else rng.uniform(3.6, 5.0)), 2),
                                       "d": round(float(rng.uniform(4.6, 5.6) if commercial else rng.uniform(3.6, 4.8)), 2),
                                       "h": round(float(rng.uniform(7, 13) if commercial else rng.uniform(2.8, 5.6)), 2)},
                        )
                        nodes.append(point)
                        edges.append(_edge(lateral, point, "lv", "service", via=[(px, tz)]))
            feeder_no += 1

    counts: Dict[str, int] = {}
    for node in nodes:
        counts[node["kind"]] = counts.get(node["kind"], 0) + 1
    return {"seed": seed, "synthetic": True, "units": "schematic metres on a flat plane; x east, z south",
            "counts": counts, "nodes": nodes, "edges": edges}


def service_points(network: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [node for node in network["nodes"] if node["kind"] == "service_point"]


# ---------------------------------------------------------------------------
# Scenario catalogue
# ---------------------------------------------------------------------------

def _param(name: str, label: str, kind: str, default: Any, minimum: Optional[float] = None, maximum: Optional[float] = None,
           unit: Optional[str] = None, choices: Optional[List[Dict[str, str]]] = None, help: Optional[str] = None) -> Dict[str, Any]:
    return {"name": name, "label": label, "type": kind, "default": default, "minimum": minimum, "maximum": maximum,
            "unit": unit, "choices": choices, "help": help}


def _common(n_days: int, *, onset: bool = True, duration: Optional[int] = None, duration_label: str = "Duration",
            duration_min: int = 7) -> List[Dict[str, Any]]:
    params = []
    if onset:
        params.append(_param("onset_day", "Onset date", "day", min(900, max(30, n_days - 134)), 30, max(31, n_days - 15), None,
                             help="Day of the series on which the pattern starts."))
    if duration is not None:
        params.append(_param("duration_days", duration_label, "int", min(duration, n_days), duration_min, n_days, "days",
                             help="Clipped at the end of the series."))
    return params


NOISE = _param("noise", "Day-to-day noise", "float", 0.15, 0.0, 0.6, None, help="Spread of the meter's ordinary daily variation.")


def _magnitude(label: str, default: float, minimum: float = 0.1, maximum: float = 0.95, help: Optional[str] = None) -> Dict[str, Any]:
    return _param("magnitude", label, "float", default, minimum, maximum, None, help=help)


def scenario_catalogue(n_days: int = 1034) -> List[Dict[str, Any]]:
    """Every scenario: what the readings show, the causes that produce the same readings, and its bounded parameters."""
    whole = n_days
    return [
        {
            "id": "normal", "title": "Normal daily consumption", "category": "baseline", "false_positive_example": False,
            "network_side": False,
            "readings_show": "A weekly rhythm, a summer and a winter peak, slow drift and day-to-day noise.",
            "other_causes": ["This is the reference pattern. A customer with ordinary readings can still be theft-labelled "
                             "in SGCC, and the reverse: readings alone do not settle it."],
            "delivery_assumption": "Energy delivered equals the readings.",
            "parameters": [NOISE],
        },
        {
            "id": "sudden_reduction", "title": "Sudden consumption reduction", "category": "anomalous-readings",
            "false_positive_example": False, "network_side": False,
            "readings_show": "Readings fall by a fixed share on one day and stay at the lower level.",
            "other_causes": ["Fewer occupants or a tenant moving out", "A large appliance replaced or retired",
                             "Fuel switching, for example electric heating replaced by gas", "A business cutting its hours",
                             "A meter that started under-registering after a fault or a replacement",
                             "Tampering that hides part of the load"],
            "delivery_assumption": "The simulation takes the readings as true: energy delivered falls with them.",
            "parameters": [*_common(whole, duration=whole, duration_label="Lasts"), _magnitude("Share of consumption lost", 0.6), NOISE],
        },
        {
            "id": "prolonged_zero", "title": "Prolonged zero readings", "category": "anomalous-readings",
            "false_positive_example": False, "network_side": False,
            "readings_show": "A long unbroken run of exactly 0 kWh, with ordinary readings before and after.",
            "other_causes": ["An empty property between tenants", "A long absence with the main switch off",
                             "Renovation or a seasonal closure", "A disconnection for non-payment",
                             "A meter that stopped registering", "A supply taken around the meter"],
            "delivery_assumption": "The simulation takes the readings as true: nothing is delivered during the run.",
            "parameters": [*_common(whole, duration=120), NOISE],
        },
        {
            "id": "meter_disconnection", "title": "Meter disconnection", "category": "anomalous-readings",
            "false_positive_example": False, "network_side": False,
            "readings_show": "Zeros from one date onward; optionally ordinary readings return after a reconnection.",
            "other_causes": ["A disconnection the utility ordered itself (non-payment, safety, account closed)",
                             "Demolition or a change of use", "A property left empty", "A meter removed for testing",
                             "A supply reconnected without authorisation, which the readings cannot show"],
            "delivery_assumption": "The simulation takes the readings as true: a disconnected service draws nothing.",
            "parameters": [*_common(whole),
                           _param("reconnect_after_days", "Reconnected after", "int", 0, 0, 600, "days", help="0 means never reconnected."),
                           NOISE],
        },
        {
            "id": "missing_telemetry", "title": "Missing telemetry", "category": "data-quality",
            "false_positive_example": True, "network_side": False,
            "readings_show": "Runs of days with no reading at all (not zero: absent), then readings resume.",
            "other_causes": ["A communication outage between meter and head-end", "A failed data concentrator",
                             "Readings lost in a system migration", "A meter powered down", "A meter deliberately disabled"],
            "delivery_assumption": "The customer keeps consuming while readings are absent, so the transformer's supplied "
                                   "energy exceeds the metered sum for those days. A balance gap is not evidence of theft.",
            "parameters": [*_common(whole, duration=21, duration_label="Length of each outage", duration_min=1),
                           _param("runs", "Number of outages", "int", 1, 1, 8, None), NOISE],
        },
        {
            "id": "meter_fault", "title": "Meter reporting fault", "category": "data-quality",
            "false_positive_example": True, "network_side": False,
            "readings_show": "A repeated identical value, isolated implausible spikes, or readings that come and go.",
            "other_causes": ["A stuck register or frozen firmware", "Unit or multiplier errors in the reading chain",
                             "Estimated readings filled in by the billing system", "Electrical interference",
                             "Interference with the meter"],
            "delivery_assumption": "The customer consumes as usual; only the reported values are wrong.",
            "parameters": [*_common(whole, duration=60),
                           _param("mode", "Fault", "choice", "stuck", choices=[
                               {"value": "stuck", "label": "Stuck value"}, {"value": "spikes", "label": "Spikes"},
                               {"value": "intermittent", "label": "Intermittent readings"}, {"value": "mixed", "label": "All three in turn"}]),
                           _param("spike_multiplier", "Spike size", "float", 8.0, 3.0, 30.0, "x usual"), NOISE],
        },
        {
            "id": "bypass_partial", "title": "Illustrative under-registration (meter bypass)", "category": "anomalous-readings",
            "false_positive_example": False, "network_side": False,
            "readings_show": "From one date the meter registers a fixed share less than before, on every day or only on the "
                             "customer's highest-consumption days.",
            "other_causes": ["A genuine reduction in demand of the same size", "Rooftop solar offsetting part of the load",
                             "A current transformer of the wrong ratio after maintenance", "A degraded meter that under-registers",
                             "Part of the load moved to a second, separately metered supply"],
            "delivery_assumption": "By construction of this illustration, energy delivered stays at the earlier level, so the "
                                   "difference appears in the transformer balance. SGCC has no transformer metering to check this.",
            "parameters": [*_common(whole, duration=whole, duration_label="Lasts"), _magnitude("Share not registered", 0.5, 0.1, 0.9),
                           _param("peak_days_only", "Only on peak days", "bool", False,
                                  help="Affects only days above the customer's 70th percentile."), NOISE],
        },
        {
            "id": "unmetered_network_load", "title": "Unauthorised consumption seen from the network", "category": "anomalous-readings",
            "false_positive_example": False, "network_side": True,
            "readings_show": "Nothing. This meter's readings stay ordinary; the extra energy appears only as a gap between what "
                             "the transformer supplies and what its meters register.",
            "other_causes": ["An unmetered but authorised load such as street lighting", "Higher technical losses than assumed",
                             "A neighbouring meter with missing or faulty readings", "A meter assigned to the wrong transformer in the records",
                             "A connection taken ahead of the meters"],
            "delivery_assumption": "An unmetered load is added at this service point's transformer. Seeing it needs transformer "
                                   "metering, which the SGCC dataset does not have; no model trained on SGCC readings can observe it.",
            "parameters": [*_common(whole, duration=whole, duration_label="Lasts"),
                           _magnitude("Unmetered load", 2.0, 0.5, 6.0, help="As a multiple of this meter's mean daily consumption."), NOISE],
        },
        {
            "id": "legitimate_demand_change", "title": "Change in legitimate demand", "category": "legitimate-change",
            "false_positive_example": True, "network_side": False,
            "readings_show": "A step down, a step up, a few weeks near zero, or a permanent fall to a standby level.",
            "other_causes": ["Occupancy change, a new appliance, a vacation or a business closing: all lawful",
                             "The same readings arise from under-registration or tampering", "A meter exchange with a different multiplier"],
            "delivery_assumption": "Energy delivered equals the readings: the customer really uses less or more.",
            "parameters": [*_common(whole, duration=28, duration_label="Length of the vacation"),
                           _param("variant", "What changed", "choice", "occupancy_change", choices=[
                               {"value": "occupancy_change", "label": "Occupancy change (step down)"},
                               {"value": "new_appliance", "label": "New appliance (step up)"},
                               {"value": "vacation", "label": "Vacation (weeks at standby)"},
                               {"value": "business_closure", "label": "Business closure (standby from then on)"}]),
                           _magnitude("Size of the step", 0.6, help="Used by the occupancy and appliance variants."), NOISE],
        },
        {
            "id": "unusual_nonfraud", "title": "Unusual but non-fraudulent consumption", "category": "legitimate-change",
            "false_positive_example": True, "network_side": False,
            "readings_show": "Months near zero every year, net consumption that falls to zero on sunny days, or a long run of zeros.",
            "other_causes": ["A seasonal business, a solar installation or a long holiday: all lawful",
                             "The same readings arise from a bypass used part of the time", "A meter fault"],
            "delivery_assumption": "Energy delivered equals the readings.",
            "parameters": [*_common(whole, duration=90, duration_label="Length of the holiday"),
                           _param("variant", "Behaviour", "choice", "seasonal_business", choices=[
                               {"value": "seasonal_business", "label": "Seasonal business (active May to September)"},
                               {"value": "solar_install", "label": "Solar installation (net metering)"},
                               {"value": "long_holiday", "label": "Long holiday (main switch off)"}]),
                           _magnitude("Solar output", 0.5, 0.1, 1.5, help="Mean daily generation as a multiple of mean consumption (solar variant)."),
                           NOISE],
        },
    ]


# An anomalous-readings scenario beside a lawful look-alike, on the same virtual meter.
COMPARE_PAIRS: List[Dict[str, Any]] = [
    {"id": "step-down", "title": "A step down",
     "point": "Both series are generated with the same step on the same day. The readings are identical, so any model "
              "that sees only readings must give them the same score.",
     "anomalous": {"scenario": "sudden_reduction", "params": {"magnitude": 0.6}},
     "legitimate": {"scenario": "legitimate_demand_change", "params": {"variant": "occupancy_change", "magnitude": 0.6}}},
    {"id": "zeros", "title": "Three months of zeros",
     "point": "A property switched off for a long holiday and a meter that stopped registering produce the same zeros.",
     "anomalous": {"scenario": "prolonged_zero", "params": {"duration_days": 90}},
     "legitimate": {"scenario": "unusual_nonfraud", "params": {"variant": "long_holiday", "duration_days": 90}}},
    {"id": "under-registration", "title": "Less energy registered",
     "point": "Under-registration and a rooftop solar installation both lower the readings from one date. Their shapes "
              "differ (solar follows the season), but neither shape proves its cause.",
     "anomalous": {"scenario": "bypass_partial", "params": {"magnitude": 0.5}},
     "legitimate": {"scenario": "unusual_nonfraud", "params": {"variant": "solar_install", "magnitude": 0.5}}},
]


def scenario_spec(scenario_id: str, n_days: int = 1034) -> Dict[str, Any]:
    for spec in scenario_catalogue(n_days):
        if spec["id"] == scenario_id:
            return spec
    raise SimulationError(f"Unknown scenario: {scenario_id!r}")


def validate_params(scenario_id: str, params: Optional[Dict[str, Any]], n_days: int = 1034) -> Dict[str, Any]:
    """Defaults filled in and every value checked against its bounds; unknown names are refused."""
    spec = scenario_spec(scenario_id, n_days)
    given = dict(params or {})
    resolved: Dict[str, Any] = {}
    for p in spec["parameters"]:
        name = p["name"]
        value = given.pop(name, p["default"])
        if p["type"] == "choice":
            allowed = [c["value"] for c in p["choices"]]
            if value not in allowed:
                raise SimulationError(f"{name} must be one of {', '.join(allowed)}")
        elif p["type"] == "bool":
            if not isinstance(value, (bool, np.bool_)):
                raise SimulationError(f"{name} must be true or false")
            value = bool(value)
        else:
            if isinstance(value, bool) or not isinstance(value, (int, float, np.integer, np.floating)) or not math.isfinite(float(value)):
                raise SimulationError(f"{name} must be a number")
            if p["type"] in ("int", "day"):
                if float(value) != int(value):
                    raise SimulationError(f"{name} must be a whole number")
                value = int(value)
            else:
                value = float(value)
            if not p["minimum"] <= value <= p["maximum"]:
                raise SimulationError(f"{name} must be between {p['minimum']} and {p['maximum']}")
        resolved[name] = value
    if given:
        raise SimulationError(f"Unknown parameter for {scenario_id}: {', '.join(sorted(given))}")
    return resolved


# ---------------------------------------------------------------------------
# Series
# ---------------------------------------------------------------------------

def baseline_series(dates: pd.DatetimeIndex, seed: int, meter_index: int, base_kwh: float = 8.0,
                    building: str = "residential", noise: float = 0.15) -> np.ndarray:
    """A meter's ordinary daily kWh: weekly and seasonal pattern, slow drift and autocorrelated noise."""
    rng = _rng(seed, _BASELINE, meter_index)
    n = len(dates)
    doy = dates.dayofyear.to_numpy(dtype=float)
    weekend = dates.dayofweek.to_numpy() >= 5
    summer = np.exp(-0.5 * ((doy - 205 + rng.uniform(-10, 10)) / 28) ** 2)
    winter = np.exp(-0.5 * ((((doy + 182) % 365) - 198) / 30) ** 2)
    seasonal = 1 + rng.uniform(0.25, 0.6) * summer + rng.uniform(0.1, 0.35) * winter
    weekly = np.where(weekend, 1 - rng.uniform(0.25, 0.5) if building == "commercial" else 1 + rng.uniform(0.03, 0.15), 1.0)
    drift = 1 + rng.uniform(-0.05, 0.10) * np.arange(n) / max(n - 1, 1)
    shocks = rng.standard_normal(n)
    correlated = np.empty(n)
    state = 0.0
    for i in range(n):  # AR(1), so a high day tends to follow a high day
        state = 0.5 * state + math.sqrt(0.75) * shocks[i]
        correlated[i] = state
    values = base_kwh * seasonal * weekly * drift * np.exp(noise * correlated - noise ** 2 / 2)
    return np.round(np.maximum(values, 0.0), 2)


def _window(p: Dict[str, Any], n: int) -> Tuple[int, int]:
    start = min(int(p.get("onset_day", 0)), n)
    return start, min(n, start + int(p.get("duration_days", n)))


def _normal(base, p, rng, dates):
    return base.copy(), base.copy(), np.zeros(len(base))


def _sudden_reduction(base, p, rng, dates):
    a, b = _window(p, len(base))
    registered = base.copy()
    registered[a:b] *= 1 - p["magnitude"]
    return registered, registered.copy(), np.zeros(len(base))


def _prolonged_zero(base, p, rng, dates):
    a, b = _window(p, len(base))
    registered = base.copy()
    registered[a:b] = 0.0
    return registered, registered.copy(), np.zeros(len(base))


def _meter_disconnection(base, p, rng, dates):
    n = len(base)
    a = min(p["onset_day"], n)
    b = n if p["reconnect_after_days"] == 0 else min(n, a + p["reconnect_after_days"])
    registered = base.copy()
    registered[a:b] = 0.0
    return registered, registered.copy(), np.zeros(n)


def _missing_telemetry(base, p, rng, dates):
    n = len(base)
    registered = base.copy()
    start = p["onset_day"]
    for _ in range(p["runs"]):
        if start >= n:
            break
        registered[start:min(n, start + p["duration_days"])] = np.nan
        start += p["duration_days"] + int(rng.integers(5, 40))
    return registered, base.copy(), np.zeros(n)


def _meter_fault(base, p, rng, dates):
    n = len(base)
    a, b = _window(p, n)
    registered = base.copy()
    third = max((b - a) // 3, 1)
    spans = {"stuck": (a, b), "spikes": (a, b), "intermittent": (a, b)}
    if p["mode"] == "mixed":
        spans = {"stuck": (a, min(b, a + third)), "spikes": (min(b, a + third), min(b, a + 2 * third)), "intermittent": (min(b, a + 2 * third), b)}
    for mode, (lo, hi) in spans.items():
        if p["mode"] not in (mode, "mixed") or hi <= lo:
            continue
        if mode == "stuck":
            registered[lo:hi] = base[lo - 1] if lo > 0 else base[0]
        elif mode == "spikes":
            hit = rng.random(hi - lo) < 0.08
            hit[0] = True  # at least one spike, so the pattern is always present
            registered[lo:hi] = np.where(hit, base[lo:hi] * p["spike_multiplier"], base[lo:hi])
        else:
            lost = rng.random(hi - lo) < 0.35
            lost[0] = True
            registered[lo:hi] = np.where(lost, np.nan, base[lo:hi])
    return np.round(registered, 2), base.copy(), np.zeros(n)


def _bypass_partial(base, p, rng, dates):
    n = len(base)
    a, b = _window(p, n)
    affected = np.zeros(n, dtype=bool)
    affected[a:b] = True
    if p["peak_days_only"] and b > a:
        affected &= base > np.quantile(base[a:b], 0.7)
    registered = np.where(affected, base * (1 - p["magnitude"]), base)
    return np.round(registered, 2), base.copy(), np.zeros(n)


def _unmetered_network_load(base, p, rng, dates):
    n = len(base)
    a, b = _window(p, n)
    unmetered = np.zeros(n)
    unmetered[a:b] = p["magnitude"] * float(base.mean()) * np.exp(0.12 * rng.standard_normal(b - a))
    return base.copy(), base.copy(), np.round(unmetered, 2)


def _legitimate_demand_change(base, p, rng, dates):
    n = len(base)
    a = min(p["onset_day"], n)
    registered = base.copy()
    if p["variant"] == "occupancy_change":
        registered[a:] *= 1 - p["magnitude"]
    elif p["variant"] == "new_appliance":
        registered[a:] *= 1 + p["magnitude"]
    elif p["variant"] == "vacation":
        registered[a:min(n, a + p["duration_days"])] *= 0.05
    else:  # business_closure
        registered[a:] *= 0.04
    registered = np.round(registered, 2)
    return registered, registered.copy(), np.zeros(n)


def _unusual_nonfraud(base, p, rng, dates):
    n = len(base)
    a = min(p["onset_day"], n)
    registered = base.copy()
    if p["variant"] == "seasonal_business":
        months = dates.month.to_numpy()
        registered = np.where((months >= 5) & (months <= 9), base, base * 0.04)
    elif p["variant"] == "solar_install":
        doy = dates.dayofyear.to_numpy(dtype=float)
        sun = 0.55 + 0.75 * np.exp(-0.5 * ((doy - 180) / 60) ** 2)            # more generation in summer
        weather = np.clip(1 + 0.35 * rng.standard_normal(n), 0.1, 1.6)
        generation = p["magnitude"] * float(base.mean()) * sun * weather
        registered[a:] = np.maximum(base[a:] - generation[a:], 0.0)
    else:  # long_holiday: the main switch is off, so the readings are exactly zero
        registered[a:min(n, a + p["duration_days"])] = 0.0
    registered = np.round(registered, 2)
    return registered, registered.copy(), np.zeros(n)


_GENERATORS: Dict[str, Callable[..., Tuple[np.ndarray, np.ndarray, np.ndarray]]] = {
    "normal": _normal, "sudden_reduction": _sudden_reduction, "prolonged_zero": _prolonged_zero,
    "meter_disconnection": _meter_disconnection, "missing_telemetry": _missing_telemetry, "meter_fault": _meter_fault,
    "bypass_partial": _bypass_partial, "unmetered_network_load": _unmetered_network_load,
    "legitimate_demand_change": _legitimate_demand_change, "unusual_nonfraud": _unusual_nonfraud,
}


def build_series(scenario_id: str, params: Optional[Dict[str, Any]], dates: pd.DatetimeIndex, seed: int,
                 meter_index: int = GENERIC_METER_INDEX, base_kwh: float = 8.0, building: str = "residential") -> Dict[str, Any]:
    """
    One virtual meter's simulated days under a scenario.

    ``registered`` is what the meter reports (NaN = no reading), ``delivered`` the energy the
    simulation assumes reached the customer, ``unmetered`` an extra load at the transformer
    that no meter registers. The baseline depends only on (seed, meter), so two scenarios on
    the same meter differ only by the scenario's effect.
    """
    seed = check_seed(seed)
    resolved = validate_params(scenario_id, params, len(dates))
    base = baseline_series(dates, seed, meter_index, base_kwh, building, resolved["noise"])
    registered, delivered, unmetered = _GENERATORS[scenario_id](base, resolved, _rng(seed, _EFFECT, meter_index), dates)
    # Meters report to 0.01 kWh; rounding here also makes look-alike scenarios agree to the last digit.
    return {"scenario": scenario_id, "params": resolved, "registered": np.round(registered, 2),
            "delivered": np.round(delivered, 2), "unmetered": np.round(unmetered, 2)}


# ---------------------------------------------------------------------------
# Network simulation
# ---------------------------------------------------------------------------

_DEFAULT_MIX: List[Tuple[str, Dict[str, Any]]] = [
    ("sudden_reduction", {}), ("prolonged_zero", {"duration_days": 75}), ("bypass_partial", {}),
    ("bypass_partial", {"peak_days_only": True, "magnitude": 0.7}), ("meter_disconnection", {}),
    ("legitimate_demand_change", {"variant": "occupancy_change"}), ("legitimate_demand_change", {"variant": "vacation"}),
    ("unusual_nonfraud", {"variant": "solar_install"}), ("unusual_nonfraud", {"variant": "long_holiday", "duration_days": 75}),
    ("missing_telemetry", {}), ("meter_fault", {"mode": "mixed"}), ("unmetered_network_load", {}),
]


def default_assignment(network: Dict[str, Any], n_days: int = 1034) -> List[Dict[str, Any]]:
    """A few seeded anomalous-reading, legitimate-change and data-quality meters; every other meter is normal."""
    points = service_points(network)
    rng = _rng(network["seed"], _ASSIGNMENT)
    chosen = rng.choice(len(points), size=min(len(_DEFAULT_MIX), len(points)), replace=False)
    onset = scenario_spec("sudden_reduction", n_days)["parameters"][0]
    assignment = []
    for index, (scenario, params) in zip(chosen, _DEFAULT_MIX):
        day = int(np.clip(onset["default"] + int(rng.integers(-20, 41)), onset["minimum"], onset["maximum"]))
        assignment.append({"service_point": points[int(index)]["id"], "scenario": scenario,
                           "params": {**params, "onset_day": day}, "synthetic": True})
    return sorted(assignment, key=lambda item: item["service_point"])


def simulate_network(network: Dict[str, Any], assignment: Sequence[Dict[str, Any]], dates: pd.DatetimeIndex) -> Dict[str, Any]:
    """
    Every virtual meter's series and the energy balance of every upstream asset.

    Returns ``ids`` (service points in order), the matrices ``registered``, ``delivered`` and
    ``unmetered`` (service points x days), ``scenarios`` (id -> resolved assignment) and
    ``balance``: per upstream node, arrays ``supplied``, ``metered``, ``technical_loss`` and
    ``gap`` (energy supplied that is neither registered by a meter nor an assumed technical loss).
    """
    points = service_points(network)
    by_id = {p["id"]: p for p in points}
    chosen: Dict[str, Dict[str, Any]] = {}
    for item in assignment:
        if item["service_point"] not in by_id:
            raise SimulationError(f"Unknown service point: {item['service_point']!r}")
        if item["service_point"] in chosen:
            raise SimulationError(f"Service point assigned twice: {item['service_point']}")
        chosen[item["service_point"]] = item
    n = len(dates)
    registered, delivered, unmetered = (np.zeros((len(points), n)) for _ in range(3))
    scenarios: Dict[str, Dict[str, Any]] = {}
    for row, point in enumerate(points):
        item = chosen.get(point["id"], {"scenario": "normal", "params": {}})
        series = build_series(item["scenario"], item.get("params"), dates, network["seed"], point["index"],
                              point["base_kwh"], point["building"])
        registered[row], delivered[row], unmetered[row] = series["registered"], series["delivered"], series["unmetered"]
        scenarios[point["id"]] = {"scenario": item["scenario"], "params": series["params"]}

    children: Dict[str, List[str]] = {}
    for node in network["nodes"]:
        if node["parent"]:
            children.setdefault(node["parent"], []).append(node["id"])
    row_of = {p["id"]: i for i, p in enumerate(points)}
    kinds = {node["id"]: node["kind"] for node in network["nodes"]}
    balance: Dict[str, Dict[str, np.ndarray]] = {}

    def visit(node_id: str) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """(supplied, metered, consumed, meters without a reading) below a node."""
        if node_id in row_of:
            row = row_of[node_id]
            consumed = delivered[row] + unmetered[row]
            return consumed, np.nan_to_num(registered[row], nan=0.0), consumed, np.isnan(registered[row]).astype(float)
        totals = [np.zeros(n) for _ in range(4)]
        for child in children.get(node_id, []):
            for total, part in zip(totals, visit(child)):
                total += part
        supplied = totals[0] * (1 + TECHNICAL_LOSS.get(kinds[node_id], 0.0))
        balance[node_id] = {"supplied": supplied, "metered": totals[1], "technical_loss": supplied - totals[2],
                            "gap": totals[2] - totals[1], "missing_meters": totals[3]}
        return supplied, totals[1], totals[2], totals[3]

    for node in network["nodes"]:
        if node["parent"] is None and node["kind"] != "operations_centre":
            visit(node["id"])
    return {"ids": [p["id"] for p in points], "registered": registered, "delivered": delivered, "unmetered": unmetered,
            "scenarios": scenarios, "balance": balance}
