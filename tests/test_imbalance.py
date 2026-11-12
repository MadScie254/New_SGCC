"""
Class imbalance and the proposal's SMOTE+ENN framework.

The views that read the sealed run's record need no dataset, so they run everywhere. The views
that resample need feature rows, so they use a small labelled fixture pointed at by
GSX_RESEARCH_DATA.

Adversarial scenarios covered here:
 4  resampling leaks out of the training rows it was fitted on
 6  synthetic rows are presented as if they were customers
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd
import pytest

from backend.services import imbalance, research_data as rd
from backend.services.errors import NotFoundError

DAYS, CUSTOMERS = 400, 400


def _clear() -> None:
    for cached in (rd.dataset, rd.features, rd.cleaned, rd.split, imbalance.overview,
                   imbalance.treatment_effect, imbalance.sensitivity, imbalance.fair_test,
                   imbalance.try_treatment, imbalance._training_sample):
        cached.cache_clear()


@pytest.fixture(scope="module")
def fixture_release(tmp_path_factory):
    rng = np.random.default_rng(3)
    dates = pd.date_range("2014-01-01", periods=DAYS, freq="D")
    labels = (rng.random(CUSTOMERS) < 0.12).astype(int)
    values = rng.lognormal(1.0, 0.6, size=(CUSTOMERS, DAYS))
    # Theft-labelled meters drop more readings, so the classes are not identical.
    missing = rng.random((CUSTOMERS, DAYS)) < (0.04 + labels[:, None] * 0.09)
    values[missing] = np.nan

    frame = pd.DataFrame(values, columns=[f"{d.year}/{d.month}/{d.day}" for d in dates])
    frame.insert(0, "FLAG", labels)
    frame.insert(0, "CONS_NO", [f"C{i:04d}" for i in range(CUSTOMERS)])
    frame = frame[["CONS_NO", "FLAG"] + sorted(frame.columns[2:])]

    path = tmp_path_factory.mktemp("imbalance") / "sgcc_fixture.csv"
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
# The sealed run's record (no dataset needed)
# ---------------------------------------------------------------------------

def test_the_resampling_counts_add_up():
    """Every row leaving the treatment is accounted for by one that entered or was created."""
    counts = imbalance.treatment_effect()["counts"]
    before, after_smote, after = counts["before"], counts["after_smote"], counts["after"]

    assert after_smote["honest"] == before["honest"]
    assert after_smote["theft"] == before["theft"] + counts["synthetic_created"]

    removed = counts["honest_removed_by_enn"] + counts["theft_removed_by_enn"] + counts["synthetic_removed_by_enn"]
    assert sum(after.values()) == sum(after_smote.values()) - removed


def test_enn_removes_real_customers_and_the_view_says_so():
    """ENN deletes real honest rows; the page must not quietly present that as cleaning."""
    result = imbalance.treatment_effect()
    assert result["counts"]["honest_removed_by_enn"] > 0
    assert "deletes real honest customers" in result["reading"]
    assert "not a meter history" in result["caveat"]


def test_treatment_stages_are_ordered_and_each_carries_its_diagnostics():
    stages = imbalance.treatment_effect()["stages"]
    assert [s["stage"] for s in stages] == ["before", "smote", "smote_enn"]
    for stage in stages:
        for key in ("silhouette", "boundary_noise", "theft_share", "rows"):
            assert key in stage["diagnostics"]
    # The treatment is supposed to raise the theft share of the training rows.
    assert stages[0]["diagnostics"]["theft_share"] < stages[2]["diagnostics"]["theft_share"]


def test_sensitivity_grid_ranks_every_treatment_on_the_same_folds():
    result = imbalance.sensitivity()
    variants = result["variants"]
    assert len(variants) >= 5
    assert all(v["pr_auc"] is not None for v in variants)
    assert variants == sorted(variants, key=lambda v: -(v["pr_auc"] or 0))
    assert result["baseline"] is not None and result["baseline"]["treatment"] == "none"
    assert result["proposed"] is not None
    for variant in variants:
        if variant["folds"]:
            assert len(variant["folds"]) == result["folds"]


def test_sensitivity_reports_the_proposed_setting_against_no_resampling():
    """The comparison the proposal rests on must be available, whichever way it comes out."""
    result = imbalance.sensitivity()
    assert result["proposed"]["pr_auc"] is not None
    assert result["baseline"]["pr_auc"] is not None
    # Both are read from the record, never adjusted to agree with the proposal's claim.
    assert result["provenance"]["status"] in ("reported", "executed", "exploratory")


def test_fair_test_reports_its_comparisons():
    result = imbalance.fair_test()
    assert result["pipeline"]
    assert result["metrics"].get("pr_auc") is not None
    assert isinstance(result["comparisons"], dict)


def test_the_tuning_trial_count_is_a_number_not_the_trial_scores():
    """The record stores every trial's score; a view that wants "how many trials" needs the count."""
    tuning = imbalance.fair_test()["tuning"]
    assert isinstance(tuning["trials"], int)
    assert tuning["trials"] == len(tuning["trial_scores"])
    assert tuning["trials"] > 1


# ---------------------------------------------------------------------------
# The interactive resample
# ---------------------------------------------------------------------------

def test_overview_states_the_accuracy_paradox_as_a_number(fixture_release):
    labels = fixture_release
    result = imbalance.overview()
    assert result["theft"] == int(labels.sum())
    assert result["never_flag_anyone"]["accuracy"] == pytest.approx(1 - float(labels.mean()))
    assert result["never_flag_anyone"]["recall"] == 0.0
    assert result["never_flag_anyone"]["thefts_missed"] == int(labels.sum())


def test_try_treatment_only_ever_resamples_training_customers(fixture_release):
    """Scenario 4: a resampled row must never come from a validation or test customer."""
    features, labels = imbalance._training_sample(imbalance.DEFAULT_SAMPLE, 42)
    train = set(rd.split()["train"].astype(str))
    assert set(features.index.astype(str)) <= train
    held_out = set(rd.split()["test"].astype(str)) | set(rd.split()["validation"].astype(str))
    assert not set(features.index.astype(str)) & held_out


def test_smote_creates_theft_rows_and_enn_removes_boundary_rows(fixture_release):
    result = imbalance.try_treatment("smote_enn", 0.5, 5, 3, 1000)
    counts = result["counts"]
    assert counts["synthetic_created"] > 0
    assert counts["after"]["theft"] > counts["before"]["theft"]
    assert counts["after"]["honest"] <= counts["before"]["honest"]  # ENN only ever removes
    assert result["diagnostics"]["after"]["theft_share"] > result["diagnostics"]["before"]["theft_share"]


def test_no_resampling_leaves_the_rows_exactly_as_they_were(fixture_release):
    result = imbalance.try_treatment("none", 0.5, 5, 3, 1000)
    assert result["counts"]["before"] == result["counts"]["after"]
    assert result["diagnostics"]["before"]["theft_share"] == pytest.approx(
        result["diagnostics"]["after"]["theft_share"], abs=1e-9)


def test_undersampling_removes_honest_rows_and_creates_nothing(fixture_release):
    result = imbalance.try_treatment("undersample", 0.5, 5, 3, 1000)
    counts = result["counts"]
    assert counts["after"]["theft"] == counts["before"]["theft"]
    assert counts["after"]["honest"] < counts["before"]["honest"]
    assert counts.get("synthetic_created", 0) == 0


def test_the_sampling_ratio_changes_how_many_rows_are_created(fixture_release):
    small = imbalance.try_treatment("smote", 0.25, 5, 3, 1000)
    large = imbalance.try_treatment("smote", 0.9, 5, 3, 1000)
    assert large["counts"]["synthetic_created"] > small["counts"]["synthetic_created"]


def test_the_interactive_view_is_marked_exploratory_and_says_what_a_synthetic_row_is(fixture_release):
    """Scenario 6: nothing may let a synthetic feature vector read as a customer."""
    result = imbalance.try_treatment("smote_enn", 0.5, 5, 3, 1000)
    assert result["provenance"]["status"] == "exploratory"
    assert "not the study's" in (result["provenance"]["note"] or "")
    assert "feature vectors" in result["caveat"]
    assert "never scored or inspected as one" in result["caveat"]


def test_an_unknown_treatment_is_rejected(fixture_release):
    with pytest.raises(NotFoundError):
        imbalance.try_treatment("magic", 0.5, 5, 3, 1000)


def test_the_feature_histogram_covers_both_sets_on_shared_bins(fixture_release):
    result = imbalance.try_treatment("smote", 0.5, 5, 3, 1000)
    feature = result["feature"]
    assert feature["feature"] in {c["feature"] for c in result["features"]}
    assert len(feature["edges"]) == len(feature["before"]) + 1
    assert len(feature["before"]) == len(feature["after"])
    assert feature["after_rows"] > feature["before_rows"]  # SMOTE added theft rows


def test_the_sample_size_is_bounded(fixture_release):
    huge = imbalance.try_treatment("none", 0.5, 5, 3, 10_000_000)
    assert huge["sample"]["used"] <= imbalance.MAX_SAMPLE
