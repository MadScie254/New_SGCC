"""The digital twin: seeded simulation, the served model's score on simulated series, and evidence labelling.

These tests use the committed operational population and model; they do not need the labelled dataset.
"""

import inspect
import json

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.services import twin as twin_service
from backend.services.data import get_wide_data
from src import simulation
from src.simulation import SimulationError

DATES = simulation.sgcc_calendar()
SEED = 7


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def series(scenario, params=None, seed=SEED, index=3):
    return simulation.build_series(scenario, params, DATES, seed, index)


# ---------------------------------------------------------------------------
# Calendar, network and determinism
# ---------------------------------------------------------------------------

def test_calendar_is_the_sgcc_calendar_of_the_served_series(client):
    assert len(DATES) == 1034
    assert DATES[0] == pd.Timestamp("2014-01-01") and DATES[-1] == pd.Timestamp("2016-10-31")
    assert pd.Timestamp("2016-09-18") not in DATES
    assert twin_service.calendar().equals(pd.DatetimeIndex(get_wide_data().columns))
    assert len(twin_service.calendar()) == get_wide_data().shape[1]


def test_network_is_deterministic_and_within_the_stated_sizes():
    first, again, other = simulation.generate_network(SEED), simulation.generate_network(SEED), simulation.generate_network(SEED + 1)
    assert json.dumps(first, sort_keys=True) == json.dumps(again, sort_keys=True)
    assert json.dumps(first, sort_keys=True) != json.dumps(other, sort_keys=True)
    for seed in range(12):
        counts = simulation.generate_network(seed)["counts"]
        assert counts["bulk_supply"] == 1 and counts["operations_centre"] == 1
        assert 2 <= counts["substation"] <= 3
        assert 12 <= counts["transformer"] <= 20
        assert 150 <= counts["service_point"] <= 300


def test_network_is_a_radial_tree_with_every_object_marked_synthetic():
    network = simulation.generate_network(SEED)
    nodes = {node["id"]: node for node in network["nodes"]}
    assert len(nodes) == len(network["nodes"])
    assert all(node["synthetic"] is True for node in network["nodes"]) and all(edge["synthetic"] is True for edge in network["edges"])
    for node in network["nodes"]:
        if node["kind"] in ("bulk_supply", "operations_centre"):
            assert node["parent"] is None
            continue
        steps, current = 0, node
        while current["parent"] is not None:  # every asset reaches the bulk supply point, with no cycle
            current = nodes[current["parent"]]
            steps += 1
            assert steps < 10
        assert current["id"] == "BSP"
    for edge in network["edges"]:
        assert edge["from"] in nodes and edge["to"] in nodes and edge["level"] in ("hv", "mv", "lv") and edge["length_m"] > 0
    positions = {(n["position"]["x"], n["position"]["z"]) for n in network["nodes"] if n["kind"] == "service_point"}
    assert len(positions) == network["counts"]["service_point"]  # no two buildings share a plot
    meters = [n["meter_id"] for n in network["nodes"] if n["kind"] == "service_point"]
    assert len(set(meters)) == len(meters) and all(m.startswith("VM-") for m in meters)


@pytest.mark.parametrize("scenario", [s["id"] for s in simulation.scenario_catalogue()])
def test_every_scenario_is_deterministic_and_on_the_calendar(scenario):
    a, b, c = series(scenario), series(scenario), series(scenario, seed=SEED + 1)
    assert a["registered"].shape == (1034,) == a["delivered"].shape == a["unmetered"].shape
    np.testing.assert_array_equal(a["registered"], b["registered"])
    assert not np.array_equal(np.nan_to_num(a["registered"]), np.nan_to_num(c["registered"]))
    assert np.nanmin(a["registered"]) >= 0 and np.isfinite(a["delivered"]).all()


def test_catalogue_states_other_causes_and_marks_false_positive_examples():
    catalogue = simulation.scenario_catalogue()
    assert {s["category"] for s in catalogue} == {"baseline", "anomalous-readings", "legitimate-change", "data-quality"}
    for spec in catalogue:
        assert spec["readings_show"] and spec["other_causes"] and spec["delivery_assumption"]
        assert isinstance(spec["false_positive_example"], bool)
        for p in spec["parameters"]:
            if p["type"] in ("int", "float", "day"):
                assert p["minimum"] <= p["default"] <= p["maximum"]
    assert all(s["false_positive_example"] for s in catalogue if s["category"] == "legitimate-change")
    assert not any(s["false_positive_example"] for s in catalogue if s["category"] == "anomalous-readings")


# ---------------------------------------------------------------------------
# Each scenario's defining property
# ---------------------------------------------------------------------------

def test_normal_has_a_weekly_and_a_seasonal_pattern():
    values = simulation.baseline_series(DATES, SEED, 3, 10.0, "commercial", noise=0.05)
    weekend = DATES.dayofweek >= 5
    assert values[weekend].mean() < 0.85 * values[~weekend].mean()
    assert values[DATES.month == 7].mean() > 1.15 * values[DATES.month == 4].mean()


def test_sudden_reduction_is_a_step_of_the_stated_size():
    base, drop = series("normal")["registered"], series("sudden_reduction", {"onset_day": 500, "magnitude": 0.6})["registered"]
    np.testing.assert_array_equal(drop[:500], base[:500])
    np.testing.assert_allclose(drop[500:], base[500:] * 0.4, atol=0.006)


def test_prolonged_zero_and_disconnection_are_exact_zeros():
    zero = series("prolonged_zero", {"onset_day": 400, "duration_days": 100})["registered"]
    assert (zero[400:500] == 0).all() and (zero[:400] > 0).all() and (zero[500:] > 0).all()
    off = series("meter_disconnection", {"onset_day": 600})["registered"]
    assert (off[600:] == 0).all() and (off[:600] > 0).all()
    back = series("meter_disconnection", {"onset_day": 600, "reconnect_after_days": 50})["registered"]
    assert (back[600:650] == 0).all() and (back[650:] > 0).all()


def test_missing_telemetry_is_runs_of_nan_while_energy_is_still_delivered():
    out = series("missing_telemetry", {"onset_day": 300, "duration_days": 20, "runs": 3})
    missing = np.isnan(out["registered"])
    assert missing.sum() == 60 and missing[300:320].all() and not missing[:300].any()
    starts = np.flatnonzero(missing & ~np.r_[False, missing[:-1]])
    assert len(starts) == 3
    assert np.isfinite(out["delivered"]).all() and (out["delivered"][300:320] > 0).all()


def test_meter_fault_modes():
    base = series("normal")["registered"]
    stuck = series("meter_fault", {"onset_day": 500, "duration_days": 40, "mode": "stuck"})["registered"]
    assert (stuck[500:540] == base[499]).all()
    spikes = series("meter_fault", {"onset_day": 500, "duration_days": 40, "mode": "spikes", "spike_multiplier": 10})["registered"]
    assert spikes[500:540].max() > 5 * base[500:540].max() and np.array_equal(spikes[:500], base[:500])
    gaps = series("meter_fault", {"onset_day": 500, "duration_days": 40, "mode": "intermittent"})["registered"]
    assert 0 < np.isnan(gaps[500:540]).sum() < 40 and not np.isnan(gaps[:500]).any()


def test_bypass_under_registers_while_delivery_is_unchanged():
    base = series("normal")["registered"]
    out = series("bypass_partial", {"onset_day": 500, "magnitude": 0.5})
    np.testing.assert_allclose(out["registered"][500:], base[500:] * 0.5, atol=0.006)
    np.testing.assert_array_equal(out["delivered"], base)
    peak = series("bypass_partial", {"onset_day": 500, "magnitude": 0.5, "peak_days_only": True})["registered"]
    changed = peak[500:] != base[500:]
    assert 0.2 < changed.mean() < 0.4 and base[500:][changed].min() > np.median(base[500:])


def test_unmetered_load_is_invisible_to_the_meter_and_visible_at_the_transformer():
    out = series("unmetered_network_load", {"onset_day": 700, "magnitude": 2.0})
    np.testing.assert_array_equal(out["registered"], series("normal")["registered"])
    assert (out["unmetered"][:700] == 0).all() and (out["unmetered"][700:] > 0).all()

    network = simulation.generate_network(SEED)
    point = simulation.service_points(network)[10]
    sim = simulation.simulate_network(network, [{"service_point": point["id"], "scenario": "unmetered_network_load",
                                                 "params": {"onset_day": 700, "magnitude": 2.0}}], DATES)
    own, other = sim["balance"][point["transformer"]], next(v for k, v in sim["balance"].items() if k.startswith("T") and "-" not in k and k != point["transformer"])
    assert np.abs(own["gap"][:700]).max() < 1e-9 and (own["gap"][700:] > 0).all()
    assert (own["supplied"][700:] > own["metered"][700:] * 1.045).all()
    assert np.abs(other["gap"]).max() < 1e-9
    np.testing.assert_allclose(other["supplied"], other["metered"] * 1.03 * 1.015)   # only the assumed technical losses
    np.testing.assert_allclose(sim["balance"]["BSP"]["gap"], sim["unmetered"].sum(axis=0), atol=1e-9)


def test_legitimate_look_alikes_reproduce_the_anomalous_readings():
    # The false-positive point: a lawful cause and an anomalous-readings scenario give the same series.
    for pair in simulation.COMPARE_PAIRS[:2]:
        a = series(pair["anomalous"]["scenario"], pair["anomalous"]["params"])["registered"]
        b = series(pair["legitimate"]["scenario"], pair["legitimate"]["params"])["registered"]
        np.testing.assert_array_equal(a, b)
    vacation = series("legitimate_demand_change", {"variant": "vacation", "onset_day": 500, "duration_days": 30})["registered"]
    base = series("normal")["registered"]
    assert vacation[500:530].mean() < 0.06 * base[500:530].mean() and np.array_equal(vacation[530:], base[530:])
    seasonal = series("unusual_nonfraud", {"variant": "seasonal_business"})["registered"]
    assert seasonal[DATES.month == 1].mean() < 0.1 * seasonal[DATES.month == 7].mean()
    solar = series("unusual_nonfraud", {"variant": "solar_install", "onset_day": 400, "magnitude": 1.0})["registered"]
    assert np.array_equal(solar[:400], base[:400]) and (solar[400:] <= base[400:]).all() and (solar[400:] == 0).any()


@pytest.mark.parametrize("scenario,params", [
    ("no_such_scenario", {}), ("sudden_reduction", {"magnitude": 1.5}), ("sudden_reduction", {"onset_day": 5}),
    ("sudden_reduction", {"onset_day": 500.5}), ("sudden_reduction", {"unknown": 1}), ("meter_fault", {"mode": "exploded"}),
    ("bypass_partial", {"peak_days_only": "yes"}), ("normal", {"noise": float("nan")}),
])
def test_bad_scenarios_and_parameters_are_refused(scenario, params):
    with pytest.raises(SimulationError):
        series(scenario, params)


@pytest.mark.parametrize("seed", [-1, 2**31, 1.5, "7", True])
def test_bad_seeds_are_refused(seed):
    with pytest.raises(SimulationError):
        simulation.generate_network(seed)


# ---------------------------------------------------------------------------
# API: the served model scores simulated series
# ---------------------------------------------------------------------------

def test_scoring_uses_the_served_model(client):
    body = {"seed": SEED, "scenario": "prolonged_zero", "params": {"onset_day": 600, "duration_days": 200}}
    payload = client.post("/api/twin/scenarios/score", json=body).json()
    model = payload["model"]
    assert 0.0 <= model["probability"] <= 1.0 and model["flagged"] == (model["probability"] >= model["threshold"])
    assert [p["name"] for p in model["parts"]] == ["xgboost", "wide_deep_cnn"]
    assert all(0.0 <= p["probability"] <= 1.0 for p in model["parts"])
    assert len(model["reasons"]) == twin_service.TOP_REASONS and model["sequence"]["weeks"]
    points = payload["series"]["points"]
    assert len(points) == 1034 and points[0]["date"] == "2014-01-01" and points[-1]["date"] == "2016-10-31"
    assert all(p["kwh"] == 0 for p in points[600:800]) and payload["series"]["zero_days"] == 200
    assert "trained on SGCC customers" in payload["provenance"]["note"]

    # The probability is the serving path's own: rebuild the row and score it with the service's functions.
    from backend.services import data as data_service, model as model_service
    values = simulation.build_series("prolonged_zero", body["params"], twin_service.calendar(), SEED)["registered"]
    wide = pd.DataFrame(values[None, :].astype("float32"), index=["x"], columns=get_wide_data().columns)
    expected = model_service.score(data_service.build_model_input(wide), wide)["probability"].iloc[0]
    assert model["probability"] == pytest.approx(float(expected), abs=1e-9)
    assert client.post("/api/twin/scenarios/score", json=body).json() == payload  # deterministic


def test_the_model_reacts_to_patterns_and_cannot_see_network_side_load(client):
    def probability(scenario, params=None, point="SP010"):
        response = client.post("/api/twin/scenarios/score", json={"seed": SEED, "scenario": scenario, "params": params or {}, "service_point": point})
        assert response.status_code == 200, response.text
        return response.json()["model"]["probability"]

    normal = probability("normal")
    assert probability("unmetered_network_load") == normal            # identical readings, identical score
    pair = simulation.COMPARE_PAIRS[0]
    assert probability(pair["anomalous"]["scenario"], pair["anomalous"]["params"]) == pytest.approx(
        probability(pair["legitimate"]["scenario"], pair["legitimate"]["params"]), abs=1e-12)


def test_simulation_endpoint_balances_energy(client):
    payload = client.post("/api/twin/simulate", json={"seed": SEED}).json()
    network = client.get("/api/twin/network", params={"seed": SEED}).json()
    days = len(payload["window"]["dates"])
    assert days == twin_service.DEFAULT_WINDOW_DAYS and payload["window"]["dates"][-1] == "2016-10-31"
    assert len(payload["meters"]) == network["counts"]["service_point"]
    assert all(len(m["kwh"]) == days and 0 <= m["probability"] <= 1 for m in payload["meters"])
    assert payload["model"]["flagged"] == sum(m["flagged"] for m in payload["meters"])
    categories = {a["category"] for a in payload["assignment"]}
    assert categories == {"anomalous-readings", "legitimate-change", "data-quality"}
    assert any(a["false_positive_example"] for a in payload["assignment"])

    by_id = {a["id"]: a for a in payload["aggregates"]}
    kinds = {n["id"]: n for n in network["nodes"]}
    for aggregate in payload["aggregates"]:
        assert len(aggregate["supplied"]) == days == len(aggregate["metered"]) == len(aggregate["gap"])
    # A transformer's metered energy is the sum of its meters' readings (missing readings add nothing).
    meters = {m["id"]: m for m in payload["meters"]}
    transformer = next(n for n in network["nodes"] if n["kind"] == "transformer")
    below = [n["id"] for n in network["nodes"] if n.get("transformer") == transformer["id"] and n["kind"] == "service_point"]
    total = np.sum([[v or 0.0 for v in meters[i]["kwh"]] for i in below], axis=0)
    np.testing.assert_allclose(by_id[transformer["id"]]["metered"], total, atol=0.11)
    # The transformer of the unmetered load shows a gap between supplied and metered energy.
    unmetered = next(a for a in payload["assignment"] if a["scenario"] == "unmetered_network_load")
    assert max(by_id[kinds[unmetered["service_point"]]["transformer"]]["gap"]) > 0
    assert payload["assumptions"]["technical_loss"]["transformer"] == simulation.TECHNICAL_LOSS["transformer"]
    assert len(payload["system"]["dates"]) == len(payload["system"]["supplied"]) == 148

    custom = client.post("/api/twin/simulate", json={"seed": SEED, "start_day": 0, "end_day": 29, "assignment": [
        {"service_point": "SP001", "scenario": "missing_telemetry", "params": {"onset_day": 30, "duration_days": 5}}]}).json()
    assert [a["service_point"] for a in custom["assignment"]] == ["SP001"] and custom["default_assignment"] is False
    assert len(custom["window"]["dates"]) == 30 and custom["window"]["dates"][0] == "2014-01-01"
    assert client.post("/api/twin/simulate", json={"seed": SEED, "assignment": []}).json()["assignment"] == []


# ---------------------------------------------------------------------------
# Evidence labelling: synthetic stays synthetic, observed stays observed
# ---------------------------------------------------------------------------

SIMULATED_KEYS = {"nodes", "edges", "meters", "aggregates", "series", "system", "assignment", "meter"}


def walk(value, path="$"):
    """Every (path, dict) in a JSON document."""
    if isinstance(value, dict):
        yield path, value
        for key, child in value.items():
            yield from walk(child, f"{path}.{key}")
    elif isinstance(value, list):
        for i, child in enumerate(value):
            yield from walk(child, f"{path}[{i}]")


def assert_simulated(payload):
    assert payload["provenance"]["status"] == "synthetic", "a response with simulated content must say so"
    assert payload["synthetic"] is True
    checked = 0
    for path, item in walk(payload):
        for key in SIMULATED_KEYS & item.keys():
            objects = item[key] if isinstance(item[key], list) else [item[key]]
            for obj in objects:
                assert obj["synthetic"] is True, f"{path}.{key} holds a simulated object without synthetic: true"
                checked += 1
        assert item.get("status") != "observed", f"{path} calls simulated content observed"
    return checked


def test_every_simulated_response_is_labelled_synthetic(client):
    network = client.get("/api/twin/network", params={"seed": SEED}).json()
    assert assert_simulated(network) == len(network["nodes"]) + len(network["edges"])
    assert "not SGCC infrastructure" in network["provenance"]["note"]
    assert_simulated(client.get("/api/twin/scenarios").json())
    for spec in simulation.scenario_catalogue():
        scored = client.post("/api/twin/scenarios/score", json={"seed": SEED, "scenario": spec["id"], "service_point": "SP002"}).json()
        assert assert_simulated(scored) >= 2
        assert "not the probability that such a pattern is theft" in scored["provenance"]["note"]
    simulated = client.post("/api/twin/simulate", json={"seed": SEED}).json()
    assert assert_simulated(simulated) >= len(simulated["meters"]) + len(simulated["aggregates"])


def test_observed_customer_is_never_labelled_synthetic_and_carries_no_label(client):
    customer_id = str(get_wide_data().index[0])
    payload = client.get(f"/api/twin/customers/{customer_id}").json()
    assert payload["provenance"]["status"] == "observed" and payload["readings"]["provenance"]["status"] == "observed"
    assert payload["attachment"] == "illustrative" and "arbitrary" in payload["attachment_note"]
    for path, item in walk(payload):
        assert "synthetic" not in item, f"{path} marks observed content synthetic"
        assert item.get("status") != "synthetic", path
        assert not {"FLAG", "flag", "theft_label", "is_theft", "ground_truth"} & item.keys(), f"{path} carries a label"
    recorded = get_wide_data().loc[customer_id].to_numpy()
    points = payload["readings"]["points"]
    assert len(points) == len(recorded)
    assert all((p["kwh"] is None and np.isnan(v)) or p["kwh"] == pytest.approx(float(v)) for p, v in zip(points, recorded))
    served = client.post("/api/predict/single", json={"customer_id": customer_id}).json()
    assert payload["model"]["probability"] == served["probability"]
    assert "research_data" not in inspect.getsource(twin_service)      # operations never see labels
    assert client.get("/api/twin/customers/not-a-customer").status_code == 404


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("method,url,kwargs", [
    ("get", "/api/twin/network", {"params": {"seed": -1}}),
    ("get", "/api/twin/network", {"params": {"seed": 2**31}}),
    ("get", "/api/twin/network", {"params": {"seed": "abc"}}),
    ("post", "/api/twin/scenarios/score", {"json": {"seed": SEED, "scenario": "no_such_scenario"}}),
    ("post", "/api/twin/scenarios/score", {"json": {"seed": SEED, "scenario": "sudden_reduction", "params": {"magnitude": 7}}}),
    ("post", "/api/twin/scenarios/score", {"json": {"seed": SEED, "scenario": "sudden_reduction", "params": {"onset_day": 99999}}}),
    ("post", "/api/twin/scenarios/score", {"json": {"seed": SEED, "scenario": "normal", "params": {"bogus": 1}}}),
    ("post", "/api/twin/scenarios/score", {"json": {"seed": SEED, "scenario": "normal", "service_point": "SP999"}}),
    ("post", "/api/twin/scenarios/score", {"json": {"seed": -3, "scenario": "normal"}}),
    ("post", "/api/twin/scenarios/score", {"json": {"seed": SEED}}),
    ("post", "/api/twin/simulate", {"json": {"seed": SEED, "start_day": 0, "end_day": 500}}),
    ("post", "/api/twin/simulate", {"json": {"seed": SEED, "start_day": 50, "end_day": 10}}),
    ("post", "/api/twin/simulate", {"json": {"seed": SEED, "end_day": 5000}}),
    ("post", "/api/twin/simulate", {"json": {"seed": SEED, "assignment": [{"service_point": "nowhere", "scenario": "normal"}]}}),
    ("post", "/api/twin/simulate", {"json": {"seed": SEED, "assignment": [{"service_point": "SP001", "scenario": "nope"}]}}),
    ("post", "/api/twin/simulate", {"json": {"seed": SEED, "assignment": [
        {"service_point": "SP001", "scenario": "normal"}, {"service_point": "SP001", "scenario": "prolonged_zero"}]}}),
])
def test_bad_input_is_a_client_error(client, method, url, kwargs):
    response = getattr(client, method)(url, **kwargs)
    assert 400 <= response.status_code < 500, response.text
    assert response.json()["detail"]
