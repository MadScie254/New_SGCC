"""
The deep model and the ensemble: what the Wide & Deep CNN is, whether it beats the feature
model, and what blending the two actually buys.

The study's claim here is an ensemble claim, and ensemble claims are easy to make badly: a
single seed, a weight chosen on the data you report on, or a comparison against an untuned
reference. This service keeps the three apart —

- the network itself and its training, read from the sealed run;
- the CNN against standard XGBoost across six seeds, with the bootstrap the run recorded;
- the blend: how often the hybrid beat each part, and the weight-choice landscape recomputed
  from the run's own saved validation predictions, which is where the weight was chosen.

The weight sweep is recomputed on validation customers, never test. That is not a detail: the
weight is a fitted parameter, and fitting it on the customers you then report on would inflate
every number downstream.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, List, Optional

import numpy as np
from sklearn.metrics import average_precision_score

from backend.services import research_data as rd
from backend.services.errors import NotFoundError

SEQUENCE = "wide_deep_cnn"
FEATURES = "xgboost"
HYBRID = "hybrid"


class DeepArtifactsMissing(RuntimeError):
    """The sealed run has no deep-learning record (the pipeline was trained without one)."""


def _reported(what: str, note: Optional[str] = None) -> Dict[str, Any]:
    label = rd.run_label("reported")
    return {"status": label["status"], "run_id": label["run_id"], "experiment": "deep.baseline",
            "source": "the sealed run's record", "computed_from": what, "note": note}


def _recomputed(what: str, note: Optional[str] = None) -> Dict[str, Any]:
    label = rd.run_label("reported")
    return {"status": "recomputed", "run_id": label["run_id"], "experiment": "deep.hybrid",
            "source": "the sealed run's saved predictions", "computed_from": what, "note": note}


def _artifact(name: str) -> Dict[str, Any]:
    if not rd.has_artifact(f"artifacts/{name}.json", "reported"):
        raise DeepArtifactsMissing(f"The sealed run has no artifacts/{name}.json")
    return rd.artifact(f"artifacts/{name}.json", "reported")


# ---------------------------------------------------------------------------
# The network
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def network() -> Dict[str, Any]:
    """What was trained, for how long, and what it cost."""
    baseline = _artifact("deep_baseline")
    sequence = _artifact("sequence")
    training = baseline.get("training") or {}
    result = baseline.get("result") or {}
    history = [{"epoch": int(h["epoch"]), "train_loss": float(h["train_loss"]),
                "validation_pr_auc": float(h["validation_pr_auc"])}
               for h in (training.get("history") or sequence.get("history") or [])]
    best_epoch = training.get("best_epoch")
    settings = sequence.get("settings") or {}

    return {
        "pipeline": baseline.get("pipeline", SEQUENCE),
        "label": baseline.get("label", "Wide & Deep CNN"),
        "architecture": baseline.get("architecture") or {},
        "settings": settings,
        "parameters": (baseline.get("architecture") or {}).get("parameters") or sequence.get("parameters"),
        "training": {
            "epochs_run": training.get("epochs_run"),
            "best_epoch": best_epoch,
            "device": training.get("device"),
            "torch": training.get("torch"),
            "seconds": sequence.get("seconds"),
            "patience": settings.get("patience"),
            "max_epochs": settings.get("max_epochs"),
        },
        "history": history,
        "cost": {
            "training_time": result.get("training_time"),
            "inference_ms_per_customer": result.get("inference_ms_per_customer"),
            "model_size_mb": result.get("model_size_mb"),
        },
        "validation_pr_auc": sequence.get("validation_pr_auc") or {},
        "provenance": _reported("artifacts/deep_baseline.json and artifacts/sequence.json of the sealed run",
                                "Training stopped early on validation PR-AUC, so the last epoch is not the best one."),
        "reading": "The wide branch reads the engineered features; the deep branch reads the daily readings as weeks, "
                   "with a second channel marking which days are missing. Early stopping watched validation PR-AUC, "
                   f"and the weights kept are epoch {best_epoch}'s, not the last.",
    }


# ---------------------------------------------------------------------------
# Does the network beat the feature model?
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def against_features() -> Dict[str, Any]:
    """Six seeds, and the bootstrap the sealed run recorded on the served split."""
    baseline = _artifact("deep_baseline")
    splits = baseline.get("splits") or {}
    bootstrap = baseline.get("bootstrap") or {}

    per_seed = splits.get("per_seed") or {}
    if isinstance(per_seed, list):
        per_seed = {str(i): row for i, row in enumerate(per_seed)}
    differences = splits.get("difference_from_standard_xgboost") or {}
    pr_auc_differences = [float(d) for d in (differences.get("pr_auc") or [])]

    seeds = [str(s) for s in (splits.get("seeds") or list(per_seed))]
    rows = []
    for i, seed in enumerate(seeds):
        entry = per_seed.get(seed) or {}
        rows.append({
            "seed": seed,
            "pr_auc": entry.get("pr_auc"),
            "auc": entry.get("auc"),
            "recall": entry.get("recall"),
            "precision": entry.get("precision"),
            "mcc": entry.get("mcc"),
            "difference_from_xgboost": pr_auc_differences[i] if i < len(pr_auc_differences) else None,
        })

    return {
        "seeds": seeds,
        "per_seed": rows,
        "mean": splits.get("mean") or {},
        "sd": splits.get("sd") or {},
        "higher_than_xgboost": splits.get("higher_pr_auc_than_standard_xgboost"),
        "runs": len(seeds),
        "note": splits.get("note"),
        "bootstrap": {
            "reference": bootstrap.get("reference"),
            "resamples": bootstrap.get("resamples"),
            "comparisons": bootstrap.get("comparisons") or {},
        },
        "provenance": _reported("artifacts/deep_baseline.json of the sealed run",
                                "Each seed retrains the network from scratch on the same split; the spread is the "
                                "network's own run-to-run variation, not sampling noise in the test set."),
        "reading": "A deep model that wins on one seed has shown nothing. The question is whether it wins on every "
                   "seed, and by how much against the spread of its own retraining.",
    }


# ---------------------------------------------------------------------------
# The blend
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def hybrid() -> Dict[str, Any]:
    """What the ensemble is worth, across seeds, and on the served split."""
    study = _artifact("hybrid_study")
    summary = study.get("summary") or {}
    per_seed_raw = study.get("per_seed") or {}
    served = study.get("served_split") or {}

    # Keep the record's own seed order (the primary seed first), not a string sort, which would
    # file seed 42 between 4 and 5.
    order = [str(s) for s in (study.get("seeds") or list(per_seed_raw))]
    rows = []
    for seed in order:
        entry = per_seed_raw.get(seed) or per_seed_raw.get(int(seed) if seed.isdigit() else seed) or {}
        rows.append({
            "seed": str(seed),
            "weight_cnn": entry.get("weight_cnn"),
            "threshold": entry.get("threshold"),
            "hybrid": (entry.get("hybrid") or {}).get("pr_auc"),
            "xgboost": (entry.get("xgboost") or {}).get("pr_auc"),
            "cnn": (entry.get("cnn") or {}).get("pr_auc"),
        })

    return {
        "seeds": [str(s) for s in (study.get("seeds") or [])],
        "weights_grid": [float(w) for w in (study.get("weights_grid") or [])],
        "per_seed": rows,
        "summary": {name: {"mean": (body or {}).get("mean") or {}, "sd": (body or {}).get("sd") or {}}
                    for name, body in summary.items()},
        "higher_than": study.get("hybrid_higher_pr_auc_than") or {},
        "served": {
            "weight_sequence": served.get("weight_sequence"),
            "customers": served.get("customers"),
            "theft": served.get("theft"),
            "resamples": served.get("resamples"),
            "thresholds": served.get("thresholds") or {},
            "confusion_matrix": served.get("confusion_matrix") or {},
            "comparisons": served.get("comparisons") or {},
        },
        "provenance": _reported("artifacts/hybrid_study.json of the sealed run",
                                "Each seed retrains the network, re-chooses the blend weight on validation customers "
                                "and re-scores the test customers once."),
        "reading": "An ensemble that only beats its parts on average is worth less than one that beats them every "
                   "time. The per-seed column is the one that settles it.",
    }


@lru_cache(maxsize=4)
def weight_sweep(step: float = 0.05) -> Dict[str, Any]:
    """
    Precision–recall area across the blend weight, recomputed from the run's saved predictions.

    This repeats the study's own selection: it blends the two calibrated probabilities on the
    validation customers and takes the weight with the highest PR-AUC. It is computed on
    validation and never on test, because the weight is fitted here.
    """
    frame = rd.predictions("validation", "reported")
    for column in ("label", SEQUENCE, FEATURES):
        if column not in frame.columns:
            raise NotFoundError(f"The saved validation predictions have no {column} column")

    y = frame["label"].to_numpy().astype(int)
    cnn = frame[SEQUENCE].to_numpy(dtype=float)
    features = frame[FEATURES].to_numpy(dtype=float)

    grid = np.round(np.arange(0.0, 1.0 + 1e-9, float(step)), 4)
    points = []
    for weight in grid:
        blended = weight * cnn + (1 - weight) * features
        points.append({"weight": float(weight), "pr_auc": float(average_precision_score(y, blended))})

    best = max(points, key=lambda p: p["pr_auc"])
    served = (_artifact("hybrid_study").get("served_split") or {}).get("weight_sequence")
    at_zero = points[0]["pr_auc"]
    at_one = points[-1]["pr_auc"]

    return {
        "points": points,
        "best": best,
        "served_weight": served,
        "features_only": at_zero,
        "cnn_only": at_one,
        "gain_over_best_part": best["pr_auc"] - max(at_zero, at_one),
        "customers": int(len(y)),
        "theft": int(y.sum()),
        "provenance": _recomputed(
            "the sealed run's saved validation predictions, blended across the weight grid",
            "The same arithmetic the run used to pick the weight. It checks the choice, not the training."),
        "reading": "Weight 0 is the feature model alone and weight 1 is the network alone. A flat peak means the "
                   "blend is not sensitive to the weight; a sharp one means the chosen weight is doing real work "
                   "and would need re-fitting on any new data.",
        "caveat": "Computed on validation customers, which is where the weight was chosen. Reading it off the test "
                  "customers would be choosing a parameter on the data the result is reported on.",
    }


@lru_cache(maxsize=1)
def learning_curves() -> Dict[str, Any]:
    """Training against validation score, for the boosted models and for the network."""
    curves = _artifact("learning_curves")
    out = []
    for name, body in curves.items():
        train = [float(v) for v in (body.get("train_pr_auc") or [])]
        validation = [float(v) for v in (body.get("validation_pr_auc") or [])]
        out.append({
            "pipeline": name,
            "best_iteration": body.get("best_iteration"),
            "train_pr_auc": train,
            "validation_pr_auc": validation,
            "final_gap": (train[-1] - validation[-1]) if train and validation else None,
        })
    return {
        "curves": out,
        "provenance": _reported("artifacts/learning_curves.json of the sealed run"),
        "reading": "The gap between the two lines is how much the model has learned that does not generalise. A gap "
                   "that keeps widening after the best iteration is the reason early stopping exists.",
    }


def available() -> bool:
    return rd.has_artifact("artifacts/deep_baseline.json", "reported")
