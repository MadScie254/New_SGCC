"""
The feature studio: the catalog, the component ablation, the history-length study, and one
feature's distribution measured from the release.

The record-backed views need no dataset. The distribution needs feature rows, so it uses a
small labelled fixture.

Adversarial scenarios covered here:
 9  an importance score is presented as evidence of a cause
12 a shorter history is claimed to be "enough" without the curve behind it
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd
import pytest

from backend.services import feature_lab, research_data as rd
from backend.services.errors import NotFoundError
from src.feature_catalog import CORE_FEATURES


def _clear() -> None:
    for cached in (rd.dataset, rd.features, rd.cleaned, rd.split, feature_lab.catalog,
                   feature_lab.ablation, feature_lab.history_length, feature_lab.distribution,
                   feature_lab._importance):
        cached.cache_clear()


@pytest.fixture(scope="module")
def fixture_release(tmp_path_factory):
    rng = np.random.default_rng(5)
    days, customers = 420, 300
    dates = pd.date_range("2014-01-01", periods=days, freq="D")
    labels = (rng.random(customers) < 0.1).astype(int)
    values = rng.lognormal(1.0, 0.6, size=(customers, days))
    missing = rng.random((customers, days)) < (0.03 + labels[:, None] * 0.08)
    values[missing] = np.nan

    frame = pd.DataFrame(values, columns=[f"{d.year}/{d.month}/{d.day}" for d in dates])
    frame.insert(0, "FLAG", labels)
    frame.insert(0, "CONS_NO", [f"C{i:04d}" for i in range(customers)])
    frame = frame[["CONS_NO", "FLAG"] + sorted(frame.columns[2:])]

    path = tmp_path_factory.mktemp("features") / "sgcc_fixture.csv"
    frame.to_csv(path, index=False)
    previous = os.environ.get("GSX_RESEARCH_DATA")
    os.environ["GSX_RESEARCH_DATA"] = str(path)
    _clear()
    try:
        yield labels
    finally:
        if previous is None:
            os.environ.pop("GSX_RESEARCH_DATA", None)
        else:
            os.environ["GSX_RESEARCH_DATA"] = previous
        _clear()


# ---------------------------------------------------------------------------
# The catalog
# ---------------------------------------------------------------------------

def test_the_catalog_covers_every_feature_the_model_was_given():
    result = feature_lab.catalog()
    assert result["total_features"] > 50
    assert len(result["features"]) == result["total_features"]
    assert result["core_features"] == sum(1 for r in result["features"] if r["core"])
    assert result["core_features"] <= len(CORE_FEATURES)


def test_the_catalog_is_ranked_and_the_shares_add_up():
    result = feature_lab.catalog()
    rows = result["features"]
    assert [r["rank"] for r in rows] == list(range(1, len(rows) + 1))
    assert rows == sorted(rows, key=lambda r: -r["importance"])
    assert sum(r["share"] for r in rows) == pytest.approx(1.0, abs=1e-6)


def test_importance_is_labelled_as_use_not_as_cause():
    """Scenario 9: a gain score says what the model leaned on, nothing more."""
    note = feature_lab.catalog()["provenance"]["note"] or ""
    assert "not what causes theft" in note


def test_the_groups_partition_the_features():
    result = feature_lab.catalog()
    assert sum(g["features"] for g in result["groups"]) == result["total_features"]
    assert sum(g["share"] for g in result["groups"]) == pytest.approx(1.0, abs=1e-6)


# ---------------------------------------------------------------------------
# The ablation and the history-length study
# ---------------------------------------------------------------------------

def test_the_ablation_keeps_every_variant_and_its_fold_spread():
    result = feature_lab.ablation()
    assert len(result["variants"]) >= 5
    for variant in result["variants"]:
        assert variant["pr_auc"] is not None
        assert variant["pr_auc_sd"] is not None
        assert variant["folds"], "the individual folds must be kept, not just the mean"
    assert result["core_only"] is not None and result["all_features"] is not None


def test_the_ablation_states_what_the_extra_features_buy():
    result = feature_lab.ablation()
    expected = result["all_features"]["pr_auc"] - result["core_only"]["pr_auc"]
    assert result["extra_features_buy"] == pytest.approx(expected)


def test_history_windows_are_ordered_and_the_full_record_is_the_longest():
    result = feature_lab.history_length()
    months = [w["months"] for w in result["windows"]]
    assert months == sorted(months)
    assert result["full"]["months"] == months[-1]
    for window in result["windows"]:
        assert window["features"] is not None and window["days"] is not None


def test_a_shorter_history_is_only_called_enough_against_the_full_record():
    """Scenario 12: "enough history" is a claim, so it must be derived, not asserted."""
    result = feature_lab.history_length()
    enough, full = result["within_5_percent"], result["full"]
    if enough is not None:
        assert enough["pr_auc"] >= full["pr_auc"] * 0.95
        # It must be the shortest such window.
        shorter = [w for w in result["windows"] if (w["months"] or 0) < (enough["months"] or 0)]
        assert all(w["pr_auc"] < full["pr_auc"] * 0.95 for w in shorter if w["pr_auc"] is not None)


# ---------------------------------------------------------------------------
# One feature, from the release
# ---------------------------------------------------------------------------

def test_a_features_distribution_is_measured_for_both_classes(fixture_release):
    labels = fixture_release
    frame = rd.features("raw")
    feature = str(frame.columns[0])
    result = feature_lab.distribution(feature)

    assert len(result["edges"]) == len(result["honest"]) + 1
    assert len(result["honest"]) == len(result["theft"])
    assert result["summary"]["theft"]["rows"] <= int(labels.sum())
    assert result["summary"]["honest"]["rows"] <= int((labels == 0).sum())
    assert result["provenance"]["status"] == "observed"
    assert "not thereby a cause of theft" in result["caveat"]


def test_a_distribution_counts_only_finite_values(fixture_release):
    frame = rd.features("raw")
    feature = str(frame.columns[0])
    result = feature_lab.distribution(feature)
    values = frame[feature].to_numpy(dtype=float)
    assert result["missing_values"] == int((~np.isfinite(values)).sum())


def test_an_unknown_feature_is_rejected(fixture_release):
    with pytest.raises(NotFoundError):
        feature_lab.distribution("not_a_feature")


def test_the_selectable_feature_list_matches_the_catalog(fixture_release):
    names = feature_lab.feature_names()
    catalog = feature_lab.catalog()["features"]
    assert [n["feature"] for n in names] == [r["feature"] for r in catalog]
    assert [n["rank"] for n in names] == list(range(1, len(catalog) + 1))
