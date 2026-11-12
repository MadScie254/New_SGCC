"""
The 87 engineered features: what they are, which ones the model leans on, and what each layer
of the pipeline actually buys.

The study turns 1,034 daily readings per customer into 87 features. Three questions follow, and
this service answers each from a different source, which is why they are kept apart:

- what the features are, and how much the served model used each one (the run's own record);
- what each layer buys: core features against all, raw against cleaned, and the resampling and
  tuning on top (the ablation the run recorded, five-fold on development customers);
- how much history you need at all (the run's history-length study);
- and, computed live from the release, what one feature's distribution looks like in each class.

A feature that separates the two labelled classes is not thereby a cause of theft, and several
of the strongest describe how a meter reported rather than how a customer used electricity.
"""

from __future__ import annotations

import warnings
from functools import lru_cache
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from backend.services import research_data as rd
from backend.services.errors import NotFoundError
from src.feature_catalog import CORE_FEATURES, FEATURE_GROUPS, feature_group, feature_label

IMPORTANCE_FILE = "artifacts/feature_importance.csv"


def _reported(what: str, note: Optional[str] = None) -> Dict[str, Any]:
    label = rd.run_label("reported")
    return {"status": label["status"], "run_id": label["run_id"], "experiment": "features",
            "source": "the sealed run's record", "computed_from": what, "note": note}


def _observed(what: str, note: Optional[str] = None) -> Dict[str, Any]:
    data = rd.dataset()
    return {"status": "observed", "run_id": "", "experiment": "features.distribution",
            "source": f"{data.path.name} (sha256 {data.sha256[:12]}…)", "computed_from": what, "note": note}


@lru_cache(maxsize=1)
def _importance() -> Dict[str, float]:
    path = rd.run_root("reported") / IMPORTANCE_FILE
    if not path.is_file():
        return {}
    frame = pd.read_csv(path)
    if "feature" not in frame.columns or "importance" not in frame.columns:
        return {}
    return {str(row.feature): float(row.importance) for row in frame.itertuples()}


# ---------------------------------------------------------------------------
# The catalog
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def catalog() -> Dict[str, Any]:
    """Every feature the model is given, with its group and how much the served model used it."""
    importance = _importance()
    names = sorted(importance) if importance else sorted(set(CORE_FEATURES))
    total = sum(importance.values()) or 1.0

    rows = []
    for name in names:
        weight = importance.get(name, 0.0)
        rows.append({
            "feature": name,
            "label": feature_label(name),
            "group": feature_group(name),
            "core": name in CORE_FEATURES,
            "importance": weight,
            "share": weight / total,
        })
    rows.sort(key=lambda r: -r["importance"])
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank

    groups = []
    for group in FEATURE_GROUPS:
        members = [r for r in rows if r["group"] == group]
        groups.append({
            "group": group,
            "features": len(members),
            "importance": sum(r["importance"] for r in members),
            "share": sum(r["share"] for r in members),
            "strongest": members[0]["label"] if members else None,
        })
    groups.sort(key=lambda g: -g["share"])

    return {
        "features": rows,
        "groups": groups,
        "total_features": len(rows),
        "core_features": sum(1 for r in rows if r["core"]),
        "provenance": _reported(
            f"{IMPORTANCE_FILE} of the sealed run, and the feature catalog in src/feature_catalog.py",
            "Importance is the served model's own gain-based score. It says what the model used, "
            "not what causes theft, and a feature can score highly because it records how a meter "
            "reported rather than how a customer behaved."),
        "reading": "The engineered features are the whole of what the gradient-boosted model sees: it never "
                   "reads a daily reading directly. Anything the features throw away is invisible to it.",
    }


# ---------------------------------------------------------------------------
# What each layer of the pipeline buys
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def ablation() -> Dict[str, Any]:
    """The run's component ablation: five-fold cross-validation on the development customers."""
    record = rd.artifact("artifacts/ablation.json", "reported")
    variants = []
    for name, body in (record.get("variants") or {}).items():
        variants.append({
            "name": name,
            "features": body.get("features"),
            "treatment": body.get("treatment"),
            "pr_auc": body.get("pr_auc"),
            "pr_auc_sd": body.get("pr_auc_sd"),
            "roc_auc": body.get("roc_auc"),
            "roc_auc_sd": body.get("roc_auc_sd"),
            "folds": (body.get("folds") or {}).get("pr_auc") or [],
        })
    variants.sort(key=lambda v: v["name"])  # A..G, the order the study defines

    best = max(variants, key=lambda v: v["pr_auc"] or 0) if variants else None
    core = next((v for v in variants if v["name"].startswith("A")), None)
    allf = next((v for v in variants if v["name"].startswith("B")), None)

    return {
        "customers": record.get("customers"),
        "base_rate": record.get("base_rate"),
        "variants": variants,
        "best": best,
        "core_only": core,
        "all_features": allf,
        "extra_features_buy": (allf["pr_auc"] - core["pr_auc"]) if (core and allf and core["pr_auc"] is not None and allf["pr_auc"] is not None) else None,
        "provenance": _reported("artifacts/ablation.json of the sealed run",
                                "Five-fold cross-validation on the development customers; the test customers are "
                                "not touched. Each variant changes one layer of the pipeline."),
        "reading": "Each row turns one layer of the pipeline on or off. The gap between two rows is what that "
                   "layer is worth, measured against the spread of the folds rather than asserted.",
    }


@lru_cache(maxsize=1)
def history_length() -> Dict[str, Any]:
    """How far back the readings have to go before the model stops improving."""
    record = rd.artifact("artifacts/history_length.json", "reported")
    windows = []
    for key, body in (record.get("windows") or {}).items():
        windows.append({
            "months": body.get("months", int(key) if str(key).isdigit() else None),
            "days": body.get("days"),
            "features": body.get("features"),
            "first_day": body.get("first_day"),
            "pr_auc": body.get("pr_auc"),
            "auc": body.get("auc"),
            "recall": body.get("recall"),
            "precision": body.get("precision"),
            "mcc": body.get("mcc"),
            "validation_pr_auc": body.get("validation_pr_auc"),
        })
    windows.sort(key=lambda w: w["months"] or 0)

    full = windows[-1] if windows else None
    # The shortest window that gets within a twentieth of the full record's score.
    enough = None
    if full and full["pr_auc"]:
        for window in windows:
            if window["pr_auc"] is not None and window["pr_auc"] >= full["pr_auc"] * 0.95:
                enough = window
                break

    return {
        "windows": windows,
        "full": full,
        "within_5_percent": enough,
        "end": record.get("end"),
        "pipeline": record.get("pipeline"),
        "test_customers": record.get("test_customers"),
        "base_rate": record.get("base_rate"),
        "provenance": _reported("artifacts/history_length.json of the sealed run",
                                "Each window keeps only the trailing months of readings, rebuilds the features from "
                                "them and retrains; the threshold is re-chosen on validation customers each time."),
        "reading": "A utility deciding how long to keep meter data needs this curve, not the headline score. Where "
                   "it flattens is the point beyond which more history buys nothing.",
    }


# ---------------------------------------------------------------------------
# One feature, measured from the release
# ---------------------------------------------------------------------------

@lru_cache(maxsize=64)
def distribution(feature: str, bins: int = 30) -> Dict[str, Any]:
    """One feature's distribution in each labelled class, computed from the release."""
    frame = rd.features("raw")
    if feature not in frame.columns:
        raise NotFoundError(f"Unknown feature: {feature}")

    values = frame[feature].to_numpy(dtype=float)
    labels = rd.dataset().labels.reindex(frame.index).to_numpy().astype(int)
    finite = np.isfinite(values)

    honest = values[finite & (labels == 0)]
    theft = values[finite & (labels == 1)]
    if honest.size == 0 and theft.size == 0:
        raise NotFoundError(f"{feature} has no finite values")

    pool = np.concatenate([honest, theft])
    low, high = float(np.percentile(pool, 1)), float(np.percentile(pool, 99))
    if not np.isfinite(low) or not np.isfinite(high) or high <= low:
        low, high = float(pool.min()), float(max(pool.max(), pool.min() + 1.0))
    edges = np.linspace(low, high, int(bins) + 1)
    honest_counts, _ = np.histogram(honest, bins=edges)
    theft_counts, _ = np.histogram(theft, bins=edges)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        separation = float((theft.mean() - honest.mean()) ** 2 / max(theft.var() + honest.var(), 1e-12)) \
            if honest.size and theft.size else 0.0

    def summary(column: np.ndarray) -> Dict[str, Any]:
        if column.size == 0:
            return {"rows": 0, "median": None, "mean": None, "p10": None, "p90": None}
        return {"rows": int(column.size), "median": float(np.median(column)), "mean": float(column.mean()),
                "p10": float(np.percentile(column, 10)), "p90": float(np.percentile(column, 90))}

    return {
        "feature": feature,
        "label": feature_label(feature),
        "group": feature_group(feature),
        "core": feature in CORE_FEATURES,
        "importance": _importance().get(feature),
        "edges": [float(e) for e in edges],
        "honest": [int(c) for c in honest_counts],
        "theft": [int(c) for c in theft_counts],
        "summary": {"honest": summary(honest), "theft": summary(theft)},
        "missing_values": int((~finite).sum()),
        "fisher_ratio": separation,
        "provenance": _observed(f"the value of {feature} for every customer in the release"),
        "caveat": "A feature that separates the two labelled groups is not thereby a cause of theft. Several of the "
                  "strongest describe how a meter reported rather than how a customer used electricity.",
    }


def feature_names() -> List[Dict[str, Any]]:
    """Every feature that can be charted, strongest first."""
    rows = catalog()["features"]
    return [{"feature": r["feature"], "label": r["label"], "group": r["group"], "rank": r["rank"]} for r in rows]
