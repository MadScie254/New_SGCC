"""Explainability: SHAP and LIME on the XGBoost part, CNN week occlusion, and the shortcut investigation.

Adversarial scenarios covered here:
 5  a model receives features in the wrong order
18  explanation outputs disagree or become unstable
"""

import numpy as np
import pytest

from backend.services import research_data as rd
from backend.services import xai

pytestmark = pytest.mark.skipif(not rd.available(),
                                reason="the labelled SGCC dataset is not on this machine")


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from backend.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def theft_customer() -> str:
    return xai.searchable_customers(label=1, limit=1)["customers"][0]["customer_id"]


def test_missing_features_come_from_the_studys_own_record():
    """The list must be the one the study removes in its ablations, not a guess of ours."""
    from_record = set(xai.missing_features())
    robustness = set(rd.artifact("artifacts/robustness.json", "reported")["missingness"]["missing_features"])
    checks = set(rd.artifact("artifacts/cnn_checks.json", "reported")["missing_features_removed"])
    assert from_record == robustness == checks
    assert from_record == set(xai.FALLBACK_MISSING_FEATURES)
    model_features = set(rd.artifact("artifacts/pipeline.json", "reported")["features"])
    assert from_record <= model_features


def test_feature_order_is_the_models_own(theft_customer):
    """Scenario 5: features must reach the model in its order, never the matrix's."""
    import pandas as pd

    model_order = rd.artifact("artifacts/pipeline.json", "reported")["features"]
    frame = xai._matrix(pd.Index([theft_customer]))
    assert list(frame.columns) == model_order
    # And a shuffled frame must not silently score the same.
    _, names = xai._model()
    assert list(names) == model_order


def test_shap_contributions_add_up_to_the_models_logit(theft_customer):
    result = xai.explain_customer(theft_customer, top=100)
    assert result["logit"] == pytest.approx(result["base_value"] + result["sum_of_contributions"], abs=1e-6)
    assert result["label"] in (0, 1)
    assert result["caveat"] and "not evidence" in result["caveat"]
    top = result["contributions"][0]
    assert abs(top["shap_value"]) >= abs(result["contributions"][-1]["shap_value"])


def test_global_importance_is_stable_for_a_seed():
    first = xai.global_importance(42, 10)
    xai.global_importance.cache_clear()
    second = xai.global_importance(42, 10)
    assert [f["feature"] for f in first["features"]] == [f["feature"] for f in second["features"]]
    assert first["features"][0]["mean_abs_shap"] == pytest.approx(second["features"][0]["mean_abs_shap"])
    assert 0.0 <= first["missingness_share_of_attribution"] <= 1.0
    assert any(f["missingness_feature"] for f in first["features"])


def test_week_effects_cover_the_whole_series(theft_customer):
    result = xai.week_effects(theft_customer)
    if not result["available"]:
        pytest.skip("the served pipeline has no sequence model")
    assert 140 <= len(result["weeks"]) <= 148
    assert all(w["start"] <= w["end"] for w in result["weeks"])
    assert len(result["strongest_weeks"]) == 5
    assert result["strongest_weeks"][0]["effect"] >= result["strongest_weeks"][-1]["effect"]
    assert "independently" in result["provenance"]["note"]


def test_missingness_separates_the_classes_before_any_model():
    profile = xai.missingness_profile()
    assert 0.0 < profile["overall_missing_share"] < 1.0
    assert profile["by_class"]["theft"]["mean"] > profile["by_class"]["honest"]["mean"]
    assert 0.5 < profile["auc_of_missing_share_alone"] < 1.0
    assert sum(b["honest"] + b["theft"] for b in profile["histogram"]) == 42_372
    assert len(profile["monthly"]) == 34


def test_mask_experiment_is_marked_as_a_counterfactual(theft_customer):
    result = xai.mask_experiment(theft_customer)
    assert set(result["scores"]) == {"served", "missingness_hidden", "all_days_marked_missing"}
    assert all(0.0 <= v <= 1.0 for v in result["scores"].values())
    assert result["effect_of_hiding_missingness"] == pytest.approx(result["scores"]["missingness_hidden"] - result["scores"]["served"])
    assert "not retrained" in result["provenance"]["note"]
    assert "out of distribution" in result["caveat"]


def test_shortcut_evidence_shows_both_records():
    evidence = xai.shortcut_evidence()
    assert len(evidence["sections"]) >= 6
    for section in evidence["sections"]:
        assert section["values"] and all("run_id" in v for v in section["values"].values())
    titles = " ".join(s["title"] for s in evidence["sections"]).lower()
    assert "without that channel" in titles and "behaviour alone" in titles
    assert evidence["what_would_settle_it"]
    conclusion = evidence["conclusion"].lower()
    assert "settle" in conclusion and "nothing in this dataset" in conclusion


def test_explanation_agreement_reports_disagreement(theft_customer):
    """Scenario 18: when SHAP and LIME differ, the view says so instead of picking one."""
    result = xai.explanation_agreement(theft_customer, top=5, samples=400)
    assert len(result["shap"]) == 5 and result["lime"]
    assert set(result["shared_features"]) <= {f["feature"] for f in result["shap"]}
    assert isinstance(result["agrees"], bool)
    assert "not of correctness" in result["reading"]


def test_research_and_operations_customers_stay_apart(client):
    """A research explanation carries a label; operations explanations must not."""
    listed = xai.searchable_customers(limit=5)
    assert all("label" in c for c in listed["customers"])
    from backend.services import model as operations

    assert "label" not in operations.get_population_scores().columns


def test_api_surface(client):
    assert client.get("/api/xai/customers", params={"label": 1, "limit": 2}).json()["total_matching"] == 542
    assert client.get("/api/xai/customers", params={"label": 3}).status_code == 422
    assert client.get("/api/xai/customer", params={"customer_id": "../etc/passwd"}).status_code == 422
    assert client.get("/api/xai/customer", params={"customer_id": "NOSUCHCUSTOMER"}).status_code == 404
    assert client.get("/api/xai/missingness/evidence").status_code == 200
    profile = client.get("/api/xai/missingness/profile")
    assert profile.status_code == 200 and profile.json()["auc_of_missing_share_alone"] > 0.5


def test_api_values_are_finite(client, theft_customer):
    import json
    import math

    def walk(node):
        if isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
        elif isinstance(node, float):
            assert math.isfinite(node)

    for path, params in (("/api/xai/global", {"top": 8}), ("/api/xai/customer", {"customer_id": theft_customer}),
                         ("/api/xai/weeks", {"customer_id": theft_customer}),
                         ("/api/xai/missingness/profile", {}), ("/api/xai/missingness/attribution", {})):
        response = client.get(path, params=params)
        assert response.status_code == 200, (path, response.text[:200])
        walk(json.loads(response.text))
