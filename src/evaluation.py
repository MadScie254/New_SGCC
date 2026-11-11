"""
GridSentinel X - Evaluation statistics for the research workspaces

Pure functions over (labels, scores): curves thinned for plotting, calibration tables with
equal-width or equal-mass bins, ranked-list metrics, threshold sweeps, and the paired tests of
``src.stats`` wrapped with their multiplicity correction. Nothing here reads a file or knows which
split it is given; the caller is responsible for never handing test labels to a selection step
(``threshold_sweep`` is used on validation customers only; the API refuses anything else).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score, roc_curve

from .calibration import calibration_metrics
from .eval import classification_metrics
from .stats import METRICS, map_at_k, paired_comparison


def _thin(*arrays: np.ndarray, points: int = 300) -> List[np.ndarray]:
    """Keep about ``points`` positions, always including the first and the last."""
    n = len(arrays[0])
    if n <= points:
        return [np.asarray(a) for a in arrays]
    keep = np.unique(np.r_[np.linspace(0, n - 1, points).round().astype(int), 0, n - 1])
    return [np.asarray(a)[keep] for a in arrays]


def roc_points(y, score, points: int = 300) -> Dict[str, Any]:
    fpr, tpr, _ = roc_curve(y, score)
    fpr, tpr = _thin(fpr, tpr, points=points)
    return {"fpr": fpr.tolist(), "tpr": tpr.tolist(), "auc": float(roc_auc_score(y, score))}


def pr_points(y, score, points: int = 300) -> Dict[str, Any]:
    precision, recall, _ = precision_recall_curve(y, score)
    precision, recall = _thin(precision[::-1], recall[::-1], points=points)  # recall ascending
    return {"recall": recall.tolist(), "precision": precision.tolist(),
            "average_precision": float(average_precision_score(y, score)), "no_skill": float(np.mean(y))}


def reliability_table(y, p, bins: int = 10, strategy: str = "width") -> List[Dict[str, float]]:
    """Mean prediction against observed rate per bin; ``strategy`` is "width" (equal width) or "mass" (equal count)."""
    y, p = np.asarray(y).astype(int), np.asarray(p, dtype=float)
    if strategy == "mass":
        edges = np.unique(np.quantile(p, np.linspace(0, 1, bins + 1)))
    elif strategy == "width":
        edges = np.linspace(0.0, 1.0, bins + 1)
    else:
        raise ValueError("strategy must be 'width' or 'mass'")
    which = np.clip(np.digitize(p, edges[1:-1], right=True), 0, len(edges) - 2)
    rows = []
    for b in range(len(edges) - 1):
        mask = which == b
        if mask.any():
            rows.append({"low": float(edges[b]), "high": float(edges[b + 1]), "count": int(mask.sum()),
                         "mean_predicted": float(p[mask].mean()), "observed_rate": float(y[mask].mean())})
    return rows


def expected_calibration_error(y, p, bins: int = 10, strategy: str = "width") -> float:
    table = reliability_table(y, p, bins, strategy)
    return float(sum(r["count"] * abs(r["mean_predicted"] - r["observed_rate"]) for r in table) / len(np.asarray(y)))


def calibration_summary(y, raw, calibrated, bins: int = 10) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for name, values in (("raw", raw), ("calibrated", calibrated)):
        out[name] = {**calibration_metrics(y, values, bins),
                     "ece_equal_mass": expected_calibration_error(y, values, bins, "mass"),
                     "reliability": reliability_table(y, values, bins, "width"),
                     "reliability_equal_mass": reliability_table(y, values, bins, "mass")}
    return out


def ranked_list(y, score, ks=(50, 100, 200, 500), shares=(0.01, 0.05, 0.10, 0.20)) -> Dict[str, Any]:
    """Precision, recall and lift at the top of the list, and MAP@k as the SGCC literature reports it."""
    y, score = np.asarray(y).astype(int), np.asarray(score, dtype=float)
    order = np.argsort(-score, kind="stable")
    hits = np.cumsum(y[order])
    base, total = float(y.mean()), int(y.sum())
    rows = []
    for k in [*ks, *[max(1, int(round(s * len(y)))) for s in shares]]:
        k = min(int(k), len(y))
        precision = float(hits[k - 1] / k)
        rows.append({"k": k, "share": k / len(y), "found": int(hits[k - 1]), "precision": precision,
                     "recall": float(hits[k - 1] / total) if total else 0.0, "lift": precision / base if base else 0.0})
    rows = sorted({r["k"]: r for r in rows}.values(), key=lambda r: r["k"])
    return {"rows": rows, "map_at_100": float(map_at_k(y, score, 100)), "map_at_200": float(map_at_k(y, score, 200)),
            "base_rate": base, "customers": int(len(y)), "theft": total}


def threshold_sweep(y, p, steps: int = 99) -> List[Dict[str, float]]:
    """Precision, recall, F1 and flags at each threshold. For validation customers only."""
    y, p = np.asarray(y).astype(int), np.asarray(p, dtype=float)
    rows = []
    for threshold in np.linspace(0.01, 0.99, steps):
        flags = p >= threshold
        tp = int((flags & (y == 1)).sum())
        flagged = int(flags.sum())
        precision = tp / flagged if flagged else 0.0
        recall = tp / int(y.sum()) if y.sum() else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        rows.append({"threshold": float(threshold), "precision": precision, "recall": recall, "f1": f1, "flagged": flagged, "true_positives": tp})
    return rows


def pipeline_metrics(y, calibrated, threshold: float) -> Dict[str, Any]:
    return classification_metrics(y, calibrated, threshold)


def paired_tests(y, scores: Dict[str, np.ndarray], thresholds: Dict[str, float], reference: str,
                 resamples: int = 10_000, seed: int = 42, alpha: float = 0.05) -> Dict[str, Any]:
    """
    Paired stratified bootstrap of the customers (thieves and honest customers resampled separately):
    a percentile interval for every metric of every pipeline and for each difference reference minus
    other, a two-sided bootstrap p-value, Holm's correction across the comparisons of each metric,
    and McNemar's exact test on the paired flag decisions (Holm-corrected as well).
    """
    if reference not in scores:
        raise ValueError(f"Unknown reference pipeline {reference!r}")
    if len(scores) < 2:
        raise ValueError("Choose at least one pipeline to compare with the reference")
    y = np.asarray(y).astype(int)
    scores = {name: np.asarray(values, dtype=float) for name, values in scores.items()}
    flags = {name: scores[name] >= thresholds[name] for name in scores}
    metrics, comparisons = paired_comparison(y, scores, flags, reference, int(resamples), int(seed), alpha)
    return {"reference": reference, "resamples": int(resamples), "seed": int(seed), "alpha": alpha, "metrics": list(METRICS),
            "customers": int(len(y)), "theft": int(y.sum()), "comparisons_per_metric": len(scores) - 1,
            "pipelines": metrics, "comparisons": comparisons}


def max_abs_difference(a: Any, b: Any) -> Optional[float]:
    """Largest absolute difference between the numbers of two nested structures with the same shape."""
    worst = [0.0]

    def walk(x: Any, y: Any) -> bool:
        if isinstance(x, dict) and isinstance(y, dict):
            return all(k in y and walk(v, y[k]) for k, v in x.items())
        if isinstance(x, (list, tuple)) and isinstance(y, (list, tuple)) and len(x) == len(y):
            return all(walk(i, j) for i, j in zip(x, y))
        if isinstance(x, bool) or isinstance(y, bool):
            return x == y
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            worst[0] = max(worst[0], abs(float(x) - float(y)))
            return True
        return x == y

    return worst[0] if walk(a, b) else None
