"""Statistical evaluation: known-answer checks, recomputation of the study's own numbers, and the holdout guard.

Adversarial scenarios covered here:
 7  probability calibration applied using the wrong split (the calibration view never refits)
17  a new result appears to beat the baseline because of leakage (selection on test is refused)
18  explanation and result outputs that disagree (recomputed against recorded metrics)
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sklearn.metrics import average_precision_score, matthews_corrcoef, roc_auc_score

from backend.services import statistics as service
from src import evaluation
from src.registry import store

REPORTED = "run-reported-sgcc-081e814"
PIPELINES = ("proposed", "xgboost", "xgboost_default", "random_forest_smote", "logistic_regression_smote",
             "wide_deep_cnn", "hybrid")

pytestmark = pytest.mark.skipif(not (store.runs_dir() / REPORTED).is_dir(),
                                reason="the reported record is not imported (python -m src.registry.baseline)")


@pytest.fixture(scope="module")
def client():
    from backend.main import app

    with TestClient(app) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# Known answers, independent of any run
# ---------------------------------------------------------------------------

def test_curves_and_areas_match_scikit_learn():
    rng = np.random.default_rng(0)
    y = rng.binomial(1, 0.1, 600)
    score = np.clip(0.3 * y + rng.normal(0.3, 0.2, 600), 0, 1)
    assert evaluation.roc_points(y, score)["auc"] == pytest.approx(roc_auc_score(y, score))
    assert evaluation.pr_points(y, score)["average_precision"] == pytest.approx(average_precision_score(y, score))
    assert evaluation.pr_points(y, score)["no_skill"] == pytest.approx(y.mean())
    roc = evaluation.roc_points(y, score, points=50)
    assert len(roc["fpr"]) <= 52 and roc["fpr"][0] == 0.0 and roc["fpr"][-1] == 1.0


def test_metrics_against_hand_computed_values():
    y = np.array([1, 1, 1, 0, 0, 0, 0, 0, 0, 0])
    p = np.array([0.9, 0.8, 0.2, 0.7, 0.4, 0.3, 0.1, 0.1, 0.1, 0.1])
    m = evaluation.pipeline_metrics(y, p, 0.5)
    # flagged: 0.9, 0.8 (theft) and 0.7 (honest) -> tp 2, fp 1, fn 1, tn 6
    assert m["confusion_matrix"] == {"tn": 6, "fp": 1, "fn": 1, "tp": 2}
    assert m["recall"] == pytest.approx(2 / 3) and m["precision"] == pytest.approx(2 / 3)
    assert m["f1"] == pytest.approx(2 / 3) and m["specificity"] == pytest.approx(6 / 7)
    assert m["gmean"] == pytest.approx(np.sqrt((2 / 3) * (6 / 7)))
    assert m["mcc"] == pytest.approx(matthews_corrcoef(y, p >= 0.5))


def test_expected_calibration_error_by_hand():
    # two full bins: 100 at p=0.05 with 10% theft, 100 at p=0.95 with 90% theft -> ECE = 0.05
    p = np.r_[np.full(100, 0.05), np.full(100, 0.95)]
    y = np.r_[np.zeros(90), np.ones(10), np.zeros(10), np.ones(90)].astype(int)
    assert evaluation.expected_calibration_error(y, p, bins=10) == pytest.approx(0.05)
    assert evaluation.expected_calibration_error(y, p, bins=2, strategy="mass") == pytest.approx(0.05)
    perfect = np.r_[np.full(100, 0.1), np.full(100, 0.9)]
    y2 = np.r_[np.zeros(90), np.ones(10), np.zeros(10), np.ones(90)].astype(int)
    assert evaluation.expected_calibration_error(y2, perfect, bins=10) == pytest.approx(0.0, abs=1e-12)


def test_reliability_bins():
    p = np.linspace(0.0, 1.0, 1001)
    y = (p > 0.5).astype(int)
    width = evaluation.reliability_table(y, p, bins=10, strategy="width")
    assert len(width) == 10 and sum(r["count"] for r in width) == 1001
    mass = evaluation.reliability_table(y, p, bins=10, strategy="mass")
    assert max(r["count"] for r in mass) - min(r["count"] for r in mass) <= 2
    with pytest.raises(ValueError):
        evaluation.reliability_table(y, p, strategy="nonsense")


def test_ranked_list_by_hand():
    y = np.array([1, 0, 1, 0, 0, 0, 0, 0, 0, 0])
    score = np.array([0.9, 0.85, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1])
    result = evaluation.ranked_list(y, score, ks=(2, 5), shares=())
    rows = {row["k"]: row for row in result["rows"]}
    assert rows[2]["found"] == 1 and rows[2]["precision"] == pytest.approx(0.5) and rows[2]["recall"] == pytest.approx(0.5)
    assert rows[5]["found"] == 2 and rows[5]["precision"] == pytest.approx(0.4) and rows[5]["recall"] == pytest.approx(1.0)
    assert rows[5]["lift"] == pytest.approx(0.4 / 0.2)
    assert result["map_at_100"] == pytest.approx((1 / 1 + 2 / 3) / 2)


def test_threshold_sweep_is_monotone_in_recall():
    rng = np.random.default_rng(1)
    y = rng.binomial(1, 0.2, 400)
    p = np.clip(0.4 * y + rng.normal(0.3, 0.2, 400), 0, 1)
    rows = evaluation.threshold_sweep(y, p, steps=50)
    recalls = [r["recall"] for r in rows]
    assert recalls == sorted(recalls, reverse=True)
    assert [r["flagged"] for r in rows] == sorted((r["flagged"] for r in rows), reverse=True)


def test_paired_tests_find_a_real_difference_and_ignore_a_copy():
    rng = np.random.default_rng(3)
    y = rng.binomial(1, 0.15, 1500)
    good = np.clip(0.6 * y + rng.normal(0.2, 0.15, 1500), 0, 1)
    poor = np.clip(0.1 * y + rng.normal(0.3, 0.3, 1500), 0, 1)
    result = evaluation.paired_tests(y, {"good": good, "poor": poor, "twin": good.copy()},
                                     {"good": 0.5, "poor": 0.5, "twin": 0.5}, "good", resamples=400, seed=7)
    assert result["comparisons"]["poor"]["pr_auc"]["difference"] > 0
    assert result["comparisons"]["poor"]["pr_auc"]["p_holm"] < 0.05
    twin = result["comparisons"]["twin"]["pr_auc"]
    assert twin["difference"] == pytest.approx(0.0, abs=1e-12) and twin["p_holm"] == pytest.approx(1.0)
    assert result["comparisons"]["twin"]["mcnemar"]["p_value"] == pytest.approx(1.0)


def test_paired_tests_are_reproducible_and_validated():
    rng = np.random.default_rng(5)
    y = rng.binomial(1, 0.2, 300)
    a, b = rng.random(300), rng.random(300)
    kwargs = dict(scores={"a": a, "b": b}, thresholds={"a": 0.5, "b": 0.5}, reference="a", resamples=200, seed=11)
    first = evaluation.paired_tests(y, **kwargs)
    second = evaluation.paired_tests(y, **kwargs)
    assert first["comparisons"]["b"]["pr_auc"] == second["comparisons"]["b"]["pr_auc"]
    with pytest.raises(ValueError):
        evaluation.paired_tests(y, {"a": a}, {"a": 0.5}, "a")
    with pytest.raises(ValueError):
        evaluation.paired_tests(y, {"a": a, "b": b}, {"a": 0.5, "b": 0.5}, "missing")


def test_max_abs_difference():
    assert evaluation.max_abs_difference({"a": 1.0, "b": [2.0, 3.0]}, {"a": 1.0, "b": [2.0, 3.25]}) == pytest.approx(0.25)
    assert evaluation.max_abs_difference({"a": 1.0}, {"b": 1.0}) is None


# ---------------------------------------------------------------------------
# Against the reported record
# ---------------------------------------------------------------------------

def test_recomputed_metrics_equal_the_studys_own_table():
    """
    Scenario 18: our arithmetic and the study's agree, for every pipeline and metric.

    Not to the last bit, and the reason is worth stating. Training writes the saved predictions with
    ``float_format="%.8g"``, so the file holds each probability to eight significant figures while the
    recorded metrics were computed on the full float64 values. Rounding merges pairs of
    nearly-equal scores into ties, which moves a ranking metric a little. The random forest is the
    worst case because it already produces many tied probabilities (its ensemble votes are coarse):
    1,142 of its 6,356 test customers share a value with another. The effect is below 1e-5 on every
    metric, which is four orders of magnitude smaller than the numerical noise between two training
    runs, but it is not zero and the saved predictions are therefore a rounded record, not the
    original one.
    """
    result = service.pipelines(REPORTED, "test")
    assert result["customers"] == 6356 and result["theft"] == 542
    seen, worst = set(), 0.0
    for row in result["pipelines"]:
        recorded = row["recorded_metrics"]
        if recorded.get("pr_auc") is None:
            continue
        seen.add(row["pipeline"])
        for metric, value in recorded.items():
            difference = abs(row["metrics"][metric] - value)
            worst = max(worst, difference)
            assert difference < 1e-5, f"{row['pipeline']}.{metric}: {difference:.2e}"
    assert seen == set(PIPELINES)
    # Threshold metrics are exact: rounding cannot move a score across the threshold at this scale.
    for row in result["pipelines"]:
        for metric in ("recall", "precision", "f1", "mcc", "gmean"):
            if row["recorded_metrics"].get(metric) is not None:
                assert row["metrics"][metric] == pytest.approx(row["recorded_metrics"][metric], abs=1e-9)
    assert worst < 1e-5


def test_evidence_status_of_the_reported_record_is_recomputed():
    assert service.pipelines(REPORTED, "test")["provenance"]["status"] == "recomputed"
    assert "recomputed" in {r["evidence"] for r in service.available_runs()}


def test_significance_reproduces_the_studys_record():
    """The same settings as scripts/significance.py must give the same differences."""
    result = service.significance(REPORTED, "test", "proposed",
                                  ["xgboost", "xgboost_default", "random_forest_smote", "logistic_regression_smote"],
                                  resamples=10_000, seed=42)
    check = result["recomputation_check"]
    assert check is not None and check["agrees"], check
    assert result["comparisons"]["xgboost"]["pr_auc"]["difference"] == pytest.approx(-0.051, abs=0.001)
    assert result["comparisons"]["xgboost"]["pr_auc"]["p_holm"] < 0.05
    assert result["comparisons"]["xgboost"]["recall"]["p_holm"] > 0.05  # the reported non-significant recall gain


def test_selection_on_the_test_customers_is_refused():
    """Scenario 17: no way to pick an operating point by test performance."""
    with pytest.raises(service.SelectionOnTestRefused):
        service.threshold_sweep(REPORTED, "test", "hybrid")
    sweep = service.threshold_sweep(REPORTED, "validation", "hybrid")
    assert sweep["split"] == "validation" and len(sweep["sweep"]) == 99


def test_calibration_view_reports_both_states(client):
    result = service.calibration(REPORTED, "test", "hybrid")
    assert result["raw"]["ece"] > result["calibrated"]["ece"]
    assert result["recorded"]["raw"]["ece"] == pytest.approx(result["raw"]["ece"], abs=1e-9)
    assert result["recorded"]["platt"]["ece"] == pytest.approx(result["calibrated"]["ece"], abs=1e-9)
    assert sum(b["count"] for b in result["calibrated"]["reliability"]) == 6356


def test_fingerprint_detects_the_same_customers():
    a = service.fingerprint(REPORTED, "test")
    assert a["customers"] == 6356 and len(a["customer_ids_sha256"]) == 64
    assert service.compare(REPORTED, REPORTED, "test")["same_customers"] is True


def test_stability_and_limitations_quote_this_run():
    sections = {s["title"] for s in service.stability(REPORTED)["sections"]}
    assert any("nested" in t.lower() for t in sections)
    limitations = service.limitations(REPORTED)["limitations"]
    assert {item["id"] for item in limitations} >= {"test-reuse", "missingness-shortcut", "generalisation"}
    assert all(item["detail"] and item["mitigation"] for item in limitations)
    assert any("evidence" in item for item in limitations)


def test_no_endpoint_claims_external_validation():
    """The limitations must state plainly that there is no Kenyan or second-utility validation."""
    text = " ".join(f"{i['title']} {i['detail']} {i['mitigation']}" for i in service.limitations(REPORTED)["limitations"]).lower()
    assert "no second labelled utility" in text or "no validation on" in text
    assert "kenyan" in text


# ---------------------------------------------------------------------------
# Through the API
# ---------------------------------------------------------------------------

def test_api_surface(client):
    assert client.get("/api/statistics/pipelines").json()["theft"] == 542
    assert client.get("/api/statistics/curves", params={"names": ["hybrid", "xgboost"]}).json()["curves"][0]["pipeline"]
    assert client.get("/api/statistics/ranked", params={"names": ["hybrid"]}).json()["pipelines"][0]["map_at_100"] > 0
    refused = client.get("/api/statistics/threshold-sweep", params={"split": "test"})
    assert refused.status_code == 400 and "validation" in refused.json()["detail"]
    assert client.get("/api/statistics/threshold-sweep", params={"split": "validation"}).status_code == 200
    assert client.get("/api/statistics/significance", params={"resamples": 100}).status_code == 422
    assert client.get("/api/statistics/significance", params={"resamples": 99_999}).status_code == 422
    assert client.get("/api/statistics/curves", params={"run": "run-does-not-exist-9"}).status_code == 404
    assert client.get("/api/statistics/calibration", params={"name": "no_such_pipeline"}).status_code == 404
    assert client.get("/api/statistics/pipelines", params={"split": "nonsense"}).status_code == 422


def test_api_returns_only_finite_numbers(client):
    import json
    import math

    def walk(node):
        if isinstance(node, dict):
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
        elif isinstance(node, float):
            assert math.isfinite(node)

    for path, params in (("/api/statistics/pipelines", {}), ("/api/statistics/curves", {}),
                         ("/api/statistics/calibration", {"name": "hybrid"}), ("/api/statistics/ranked", {}),
                         ("/api/statistics/stability", {}), ("/api/statistics/limitations", {})):
        response = client.get(path, params=params)
        assert response.status_code == 200, path
        walk(json.loads(response.text))
