"""
Class imbalance: what it does to this problem, and what the proposal's SMOTE+ENN does about it.

Theft-labelled customers are about one in twelve, which breaks accuracy as a measure and makes
the resampling choice the proposal's central methodological claim. This service serves four
things, and keeps them apart:

- the imbalance measured from the labelled release, and what it does to accuracy;
- what SMOTE+ENN did to the study's training rows, read from the sealed run's record;
- the sensitivity grid: thirteen treatments scored by five-fold cross-validation on the
  development customers, so the proposed setting can be seen against its alternatives;
- a bounded interactive resample, which fits on training customers only and is marked
  exploratory because it is outside the study's protocol.

Rule: resampled rows are feature vectors, never meter histories and never customers. Nothing
here resamples anything but training rows, and the test customers are not touched.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

from backend.services import research_data as rd
from backend.services.errors import NotFoundError
from src.feature_catalog import feature_label
from src.resampling import TREATMENTS, Treatment, diagnostics

# The interactive resample is bounded so it stays a request handler and not an experiment.
MIN_SAMPLE, MAX_SAMPLE, DEFAULT_SAMPLE = 500, 4000, 2000
DIAGNOSTIC_SAMPLE = 2000

TREATMENT_LABELS: Dict[str, str] = {
    "none": "No resampling",
    "smote": "SMOTE",
    "smote_enn": "SMOTE + ENN (the proposal's framework)",
    "smote_tomek": "SMOTE + Tomek links",
    "borderline_smote": "Borderline-SMOTE",
    "adasyn": "ADASYN",
    "undersample": "Random undersampling",
}


def _reported(what: str, note: Optional[str] = None) -> Dict[str, Any]:
    label = rd.run_label("reported")
    return {"status": label["status"], "run_id": label["run_id"], "experiment": "resampling",
            "source": "the sealed run's record", "computed_from": what, "note": note}


def _exploratory(what: str, note: Optional[str] = None) -> Dict[str, Any]:
    return {"status": "exploratory", "run_id": "", "experiment": "resampling.interactive",
            "source": "computed now on training customers", "computed_from": what, "note": note}


# ---------------------------------------------------------------------------
# The imbalance itself
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def overview() -> Dict[str, Any]:
    """The class ratio, and what it does to accuracy as a measure."""
    data = rd.dataset()
    y = data.labels.to_numpy().astype(int)
    base_rate = float(y.mean())

    pipelines = rd.pipelines("reported")
    rows = []
    for name, entry in pipelines.items():
        confusion = entry.get("confusion_matrix") or {}
        rows.append({
            "pipeline": name,
            "label": entry.get("label", name),
            "treatment": entry.get("treatment", "unknown"),
            "served": bool(entry.get("served")),
            "threshold": entry.get("threshold"),
            "accuracy": entry.get("accuracy"),
            "recall": entry.get("recall"),
            "precision": entry.get("precision"),
            "pr_auc": entry.get("pr_auc"),
            "mcc": entry.get("mcc"),
            "thefts_found": confusion.get("tp"),
            "thefts_missed": confusion.get("fn"),
        })
    rows.sort(key=lambda r: -(r["pr_auc"] or 0))

    # The paradox, stated as a number: a model that never flags anyone.
    support = next((p.get("support") for p in pipelines.values() if p.get("support")), None)
    test_customers = None
    test_theft = None
    if isinstance(support, dict):
        test_customers = support.get("customers") or support.get("n")
        test_theft = support.get("theft") or support.get("positives")

    return {
        "customers": int(len(y)),
        "theft": int(y.sum()),
        "honest": int((y == 0).sum()),
        "base_rate": base_rate,
        "imbalance_ratio": float((y == 0).sum() / max(y.sum(), 1)),
        "never_flag_anyone": {
            "accuracy": 1.0 - base_rate,
            "recall": 0.0,
            "precision": None,
            "thefts_found": 0,
            "thefts_missed": int(y.sum()),
        },
        "pipelines": rows,
        "test_customers": test_customers,
        "test_theft": test_theft,
        "provenance": _reported("the sealed run's pipeline comparison, and the labelled release",
                                "Class counts are measured from the release; every pipeline metric is the "
                                "sealed run's own, at the threshold it chose on validation customers."),
        "reading": f"A model that flags nobody is right about {(1 - base_rate) * 100:.1f}% of customers and finds no "
                   "theft at all. Accuracy cannot tell that model apart from a useful one, which is why this study "
                   "reports precision–recall area, recall at an operating threshold and MCC instead.",
    }


# ---------------------------------------------------------------------------
# What the study's own resampling did
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def treatment_effect() -> Dict[str, Any]:
    """The counts and the geometry before resampling, after SMOTE, and after ENN."""
    record = rd.artifact("artifacts/resampling.json", "reported")
    smote, smote_enn = record["smote"], record["smote_enn"]
    counts = smote_enn["counts"]

    stages = [
        {"stage": "before", "label": "Training rows as they are", "diagnostics": record["before"],
         "note": "The development customers' feature rows, before any treatment."},
        {"stage": "smote", "label": "After SMOTE", "diagnostics": smote["diagnostics"],
         "note": f"{counts['synthetic_created']:,} synthetic theft rows interpolated between real ones."},
        {"stage": "smote_enn", "label": "After SMOTE + ENN", "diagnostics": smote_enn["diagnostics"],
         "note": f"{counts['honest_removed_by_enn']:,} honest and {counts['theft_removed_by_enn']:,} real theft rows "
                 f"removed as boundary noise, along with {counts['synthetic_removed_by_enn']:,} of the synthetic rows."},
    ]

    return {
        "config": record["config"],
        "counts": counts,
        "stages": stages,
        "provenance": _reported("artifacts/resampling.json of the sealed run",
                                "Fitted on the study's training rows only, as the protocol requires."),
        "reading": "SMOTE interpolates new theft rows between existing ones; ENN then deletes rows whose neighbours "
                   "mostly carry the other label. The pair raises the theft share and lowers boundary noise, and it "
                   "deletes real honest customers to do it.",
        "caveat": "A synthetic row is a feature vector interpolated between two real ones. It is not a meter history "
                  "and it is not a customer; nothing synthetic is ever scored, inspected or reported as a person.",
    }


# ---------------------------------------------------------------------------
# The sensitivity grid
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def sensitivity() -> Dict[str, Any]:
    """Thirteen treatments under the same five-fold cross-validation on development customers."""
    study = rd.artifact("artifacts/resampling_study.json", "reported")
    grid = study["grid"]

    variants = []
    for name, body in grid["variants"].items():
        variants.append({
            "name": name,
            "treatment": body.get("treatment"),
            "config": body.get("config") or {},
            "pr_auc": body.get("pr_auc"),
            "pr_auc_sd": body.get("pr_auc_sd"),
            "roc_auc": body.get("roc_auc"),
            "roc_auc_sd": body.get("roc_auc_sd"),
            "folds": (body.get("folds") or {}).get("pr_auc") or [],
            "training_rows": body.get("training_rows"),
            "training_theft_share": body.get("training_theft_share"),
            "seconds": body.get("seconds"),
            "proposed": "proposed setting" in name.lower(),
        })
    variants.sort(key=lambda v: -(v["pr_auc"] or 0))

    baseline = next((v for v in variants if v["treatment"] == "none"), None)
    best = variants[0] if variants else None
    proposed = next((v for v in variants if v["proposed"]), None)

    return {
        "customers": grid.get("customers"),
        "base_rate": grid.get("base_rate"),
        "folds": grid.get("folds"),
        "hyperparameters": grid.get("hyperparameters") or {},
        "variants": variants,
        "baseline": baseline,
        "best": best,
        "proposed": proposed,
        "provenance": _reported("artifacts/resampling_study.json of the sealed run",
                                "Five-fold cross-validation on the development customers; each treatment is fitted "
                                "inside each fold, so no fold sees resampled rows from another. Test customers are "
                                "not touched."),
        "reading": "Every treatment here is scored the same way with the same fixed hyperparameters, so the column "
                   "compares the resampling choice and nothing else.",
    }


@lru_cache(maxsize=1)
def fair_test() -> Dict[str, Any]:
    """SMOTE+ENN tuned the way the other XGBoost pipelines were, so the comparison is like for like."""
    study = rd.artifact("artifacts/resampling_study.json", "reported")
    test = study.get("fair_test") or {}
    result = test.get("result") or {}
    bootstrap = test.get("bootstrap") or {}
    tuning = test.get("tuning") or {}

    return {
        "pipeline": test.get("pipeline"),
        "label": test.get("label"),
        "threshold": result.get("threshold"),
        "validation_pr_auc": result.get("validation_pr_auc"),
        "metrics": {k: v for k, v in (result.get("metrics") or {}).items() if k in
                    ("recall", "precision", "f1", "accuracy", "auc", "pr_auc", "gmean", "mcc", "confusion_matrix")},
        "training_time": result.get("training_time"),
        "tuning": {"trials": len(tuning.get("trials") or []),
                   "trial_scores": [float(t) for t in (tuning.get("trials") or [])],
                   "fold_scores": [float(f) for f in (tuning.get("fold_scores") or [])],
                   "cv_best_score": tuning.get("cv_best_score"),
                   "seconds": tuning.get("seconds"), "params": tuning.get("params") or {}},
        "reference": bootstrap.get("reference"),
        "resamples": bootstrap.get("resamples"),
        "comparisons": bootstrap.get("comparisons") or {},
        "provenance": _reported("artifacts/resampling_study.json of the sealed run, fair_test",
                                "Tuned with the same budget and scored once on the same test customers as the "
                                "pipelines it is compared with."),
        "reading": "The proposed pipeline differs from standard XGBoost in two ways at once: cleaned readings and "
                   "SMOTE+ENN. This test separates them by tuning SMOTE+ENN on raw readings under the same budget.",
    }


# ---------------------------------------------------------------------------
# A bounded interactive resample
# ---------------------------------------------------------------------------

@lru_cache(maxsize=8)
def _training_sample(size: int, seed: int) -> Tuple[pd.DataFrame, pd.Series]:
    """A stratified sample of training customers' feature rows. Training only, never test."""
    labels = rd.dataset().labels.loc[rd.split()["train"]]
    rng = np.random.default_rng(seed)
    take = []
    for value in (0, 1):
        members = labels.index[labels == value]
        n = max(2, int(round(size * len(members) / len(labels))))
        take.append(rng.choice(members, size=min(n, len(members)), replace=False))
    index = pd.Index(np.concatenate(take))
    features = rd.features("raw").loc[index]
    return features, labels.loc[index]


@lru_cache(maxsize=32)
def try_treatment(kind: str = "smote_enn", sampling_strategy: float = 0.5, smote_k_neighbors: int = 5,
                  enn_n_neighbors: int = 3, sample: int = DEFAULT_SAMPLE, feature: str = "",
                  seed: int = 42) -> Dict[str, Any]:
    """
    Apply one treatment to a sample of training rows and measure what it changed.

    Outside the study's protocol, so everything it returns is exploratory. It exists so the
    resampling choice can be felt rather than read: change the ratio and watch boundary noise move.
    """
    if kind not in TREATMENTS:
        raise NotFoundError(f"Unknown treatment: {kind}")
    size = int(min(max(sample, MIN_SAMPLE), MAX_SAMPLE))

    X, y = _training_sample(size, seed)
    config = {"sampling_strategy": float(sampling_strategy), "smote_k_neighbors": int(smote_k_neighbors),
              "enn_n_neighbors": int(enn_n_neighbors)}
    treatment = Treatment(kind, config, random_state=seed)
    X_res, y_res = treatment.fit_resample(X, y)

    # Diagnostics are measured in one standardised space, fitted on the untreated training rows,
    # so the before and after numbers are comparable.
    filled = X.fillna(X.median().fillna(0.0))
    scaler = StandardScaler().fit(filled)
    before = diagnostics(filled, y, scaler, sample_size=DIAGNOSTIC_SAMPLE, random_state=seed)
    after = diagnostics(X_res.fillna(0.0), y_res, scaler, sample_size=DIAGNOSTIC_SAMPLE, random_state=seed)

    # Which features separate the classes here, so the reader can look at one of them.
    Z = scaler.transform(filled)
    y_arr = np.asarray(y).astype(int)
    fisher = (Z[y_arr == 1].mean(axis=0) - Z[y_arr == 0].mean(axis=0)) ** 2 / np.maximum(
        Z[y_arr == 1].var(axis=0) + Z[y_arr == 0].var(axis=0), 1e-12)
    order = np.argsort(-fisher)[:12]
    choices = [{"feature": str(X.columns[i]), "label": feature_label(str(X.columns[i])),
                "fisher_ratio": float(fisher[i])} for i in order]

    chosen = feature if feature in set(X.columns) else choices[0]["feature"]
    histogram = _feature_histogram(X, y, X_res, y_res, chosen)

    return {
        "kind": kind,
        "label": TREATMENT_LABELS.get(kind, kind),
        "config": config,
        "sample": {"customers": int(len(y)), "theft": int(y.sum()), "requested": int(sample), "used": size},
        "counts": treatment.stats_,
        "diagnostics": {"before": before, "after": after},
        "features": choices,
        "feature": {"feature": chosen, "label": feature_label(chosen), **histogram},
        "provenance": _exploratory(
            f"{kind} on a stratified sample of {len(y):,} training customers",
            "Fitted on training rows only. The study's own result is the sealed run's; this is a demonstration of "
            "the mechanism, at a smaller size, and its numbers are not the study's."),
        "caveat": "Resampled rows are feature vectors. A synthetic theft row is interpolated between two real ones; "
                  "it has no meter history, no customer behind it, and is never scored or inspected as one.",
    }


def _feature_histogram(X: pd.DataFrame, y: pd.Series, X_res: pd.DataFrame, y_res: pd.Series,
                       feature: str, bins: int = 28) -> Dict[str, Any]:
    """One feature's distribution among theft rows, before the treatment and after it."""
    before = X.loc[np.asarray(y) == 1, feature].to_numpy(dtype=float)
    after = X_res.loc[np.asarray(y_res) == 1, feature].to_numpy(dtype=float)
    before, after = before[np.isfinite(before)], after[np.isfinite(after)]
    if before.size == 0 and after.size == 0:
        return {"edges": [], "before": [], "after": [], "before_rows": 0, "after_rows": 0}

    pool = np.concatenate([before, after]) if after.size else before
    low, high = float(np.percentile(pool, 1)), float(np.percentile(pool, 99))
    if not np.isfinite(low) or not np.isfinite(high) or high <= low:
        low, high = float(pool.min()), float(pool.max() if pool.max() > pool.min() else pool.min() + 1.0)
    edges = np.linspace(low, high, bins + 1)
    before_counts, _ = np.histogram(before, bins=edges)
    after_counts, _ = np.histogram(after, bins=edges)
    return {
        "edges": [float(e) for e in edges],
        "before": [int(c) for c in before_counts],
        "after": [int(c) for c in after_counts],
        "before_rows": int(before.size),
        "after_rows": int(after.size),
    }


def treatments() -> List[Dict[str, str]]:
    return [{"kind": kind, "label": TREATMENT_LABELS.get(kind, kind)} for kind in TREATMENTS]
