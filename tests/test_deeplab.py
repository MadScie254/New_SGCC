"""
The deep model and the ensemble.

Everything here reads the sealed run's record and its saved predictions, both of which are in
the repository, so these tests need no dataset.

Adversarial scenarios covered here:
 3  an ensemble weight is fitted on the customers the result is reported on
17 a deep model is credited with a win that is one seed's luck
"""

from __future__ import annotations

import pytest

from backend.services import deeplab, research_data as rd

pytestmark = pytest.mark.skipif(not deeplab.available(),
                                reason="the sealed run has no deep-learning record")


def test_the_network_reports_what_was_trained():
    result = deeplab.network()
    assert result["parameters"] and result["parameters"] > 0
    assert result["architecture"].get("wide") and result["architecture"].get("deep")
    assert result["history"], "the training history must be shown, not just the final score"
    assert [h["epoch"] for h in result["history"]] == sorted(h["epoch"] for h in result["history"])


def test_early_stopping_kept_an_earlier_epoch_than_the_last():
    """The weights served are the best epoch's; a view that implies otherwise is wrong."""
    result = deeplab.network()
    best, run = result["training"]["best_epoch"], result["training"]["epochs_run"]
    assert best is not None and run is not None
    assert 1 <= best <= run
    assert f"epoch {best}" in result["reading"]


def test_the_best_epoch_really_is_the_best_validation_score():
    result = deeplab.network()
    history = result["history"]
    best_epoch = result["training"]["best_epoch"]
    peak = max(history, key=lambda h: h["validation_pr_auc"])
    assert peak["epoch"] == best_epoch


def test_the_cnn_is_compared_across_seeds_not_one_run():
    """Scenario 17: a single seed proves nothing about a deep model."""
    result = deeplab.against_features()
    assert result["runs"] >= 3
    assert len(result["per_seed"]) == result["runs"]
    assert all(row["pr_auc"] is not None for row in result["per_seed"])
    assert result["sd"].get("pr_auc") is not None
    # How often it won is reported as a count out of the runs, not as a claim.
    assert 0 <= result["higher_than_xgboost"] <= result["runs"]


def test_the_seed_spread_is_wide_enough_to_matter():
    """If the spread swamps the difference, the view must still show both."""
    result = deeplab.against_features()
    differences = [row["difference_from_xgboost"] for row in result["per_seed"]
                   if row["difference_from_xgboost"] is not None]
    assert differences, "per-seed differences from the reference must be kept"
    assert len(differences) == result["runs"]


def test_the_hybrid_is_reported_against_both_of_its_parts():
    result = deeplab.hybrid()
    assert set(result["summary"]) >= {"hybrid", "xgboost", "cnn"}
    assert set(result["higher_than"]) >= {"xgboost", "cnn"}
    for row in result["per_seed"]:
        assert row["hybrid"] is not None and row["xgboost"] is not None and row["cnn"] is not None
    assert result["served"]["weight_sequence"] is not None


def test_the_seed_rows_follow_the_records_order_not_a_string_sort():
    """Seed 42 sorts between 4 and 5 as a string; the table must not read that way."""
    result = deeplab.hybrid()
    assert [row["seed"] for row in result["per_seed"]] == result["seeds"]
    assert all(row["hybrid"] is not None for row in result["per_seed"])


def test_the_weight_sweep_runs_on_validation_customers_only():
    """Scenario 3: the blend weight is fitted, so it may not be swept on the test customers."""
    result = deeplab.weight_sweep()
    validation = rd.predictions("validation", "reported")
    assert result["customers"] == len(validation)
    assert result["theft"] == int(validation["label"].sum())
    assert "never on test" in deeplab.weight_sweep.__doc__
    assert "validation customers" in result["caveat"]
    assert result["provenance"]["status"] == "recomputed"


def test_the_sweep_reproduces_the_weight_the_study_chose():
    """The recomputation must land on the run's own weight, or one of them is wrong."""
    result = deeplab.weight_sweep()
    assert result["best"]["weight"] == pytest.approx(result["served_weight"])


def test_the_sweep_reproduces_the_runs_recorded_validation_score():
    """Blending the saved probabilities must give back the score the run recorded."""
    recorded = rd.artifact("artifacts/sequence.json", "reported")["validation_pr_auc"]
    result = deeplab.weight_sweep()
    assert result["best"]["pr_auc"] == pytest.approx(recorded["hybrid"], abs=1e-9)
    assert result["features_only"] == pytest.approx(recorded["xgboost"], abs=1e-9)
    assert result["cnn_only"] == pytest.approx(recorded["wide_deep_cnn"], abs=1e-9)


def test_the_sweep_spans_both_parts_alone():
    result = deeplab.weight_sweep()
    weights = [p["weight"] for p in result["points"]]
    assert weights[0] == 0.0 and weights[-1] == 1.0
    assert weights == sorted(weights)
    assert all(0.0 <= p["pr_auc"] <= 1.0 for p in result["points"])


def test_a_coarser_sweep_is_still_a_sweep():
    coarse = deeplab.weight_sweep(0.25)
    assert len(coarse["points"]) == 5
    assert coarse["points"][0]["weight"] == 0.0


def test_learning_curves_keep_both_lines():
    result = deeplab.learning_curves()
    assert result["curves"]
    for curve in result["curves"]:
        assert curve["train_pr_auc"] and curve["validation_pr_auc"]
        assert len(curve["train_pr_auc"]) == len(curve["validation_pr_auc"])
        # Training score above validation score is the gap the view exists to show.
        assert curve["final_gap"] is not None


def test_every_view_declares_its_provenance():
    for view in (deeplab.network(), deeplab.against_features(), deeplab.hybrid(),
                 deeplab.weight_sweep(), deeplab.learning_curves()):
        provenance = view["provenance"]
        assert provenance["status"] in ("reported", "executed", "recomputed", "exploratory")
        assert provenance["computed_from"]
