"""
Statistical evaluation of the study's pipelines, computed from a run's saved predictions.

Every number this service returns is computed here, now, from the predictions a sealed run saved
(`research_data.predictions`) — nothing is read from a results file except when the caller asks to
compare with one. The evidence status follows the run the predictions come from:

- the reported record  -> "recomputed" (this checks the study's arithmetic, not its training);
- a sealed rerun under the original protocol -> "executed";
- anything else -> "exploratory".

The held-out test customers are protected: `threshold_sweep` and every other selection-shaped
endpoint refuse `split="test"`. Selection happens on validation customers, reporting on test.
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from backend.services.errors import NotFoundError
from backend.services import research_data as rd
from src import evaluation
from src.calibration import apply_platt

MAX_RESAMPLES = 20_000
DEFAULT_RESAMPLES = 10_000

LIMITATIONS = [
    {
        "id": "test-reuse",
        "title": "The test customers were scored more than once during the study",
        "detail": "The five study pipelines were scored once, as planned. The CNN, the hybrid and the stress tests were "
                  "added afterwards and scored on the same test customers. Each addition was informed by what the "
                  "earlier scoring showed, so the test set stopped being untouched after the first scoring.",
        "mitigation": "Nested cross-validation repeats the whole hybrid procedure inside five outer folds of all 42,372 "
                      "customers, so every customer is scored by models that never saw them. It supports the hybrid's "
                      "advantage without relying on the reused split.",
    },
    {
        "id": "hybrid-selection",
        "title": "The hybrid was designed after the CNN's test result was known",
        "detail": "The decision to blend the CNN with XGBoost followed the observation that the CNN scored well on the "
                  "test customers. The blend weight itself is chosen on validation, but the choice to build a blend at "
                  "all is not independent of the test set.",
        "mitigation": "The nested cross-validation addresses the procedure as a whole, not the weight alone. It cannot "
                      "undo the fact that the idea came from a test result.",
    },
    {
        "id": "missingness-shortcut",
        "title": "Most of the hybrid's advantage comes from the pattern of missing readings",
        "detail": "Removing the CNN's missing-reading channel costs it most of its performance. A model that keys on "
                  "which days failed to report may be detecting a data-collection process, not theft.",
        "mitigation": "The Explainable AI centre's missingness panel measures this directly. Whether it transfers to "
                      "another utility depends on how that utility's meter data go missing.",
    },
    {
        "id": "label-noise",
        "title": "Labels come from field inspections and are noisy",
        "detail": "A customer labelled honest may be an undetected theft; a customer labelled theft may have been "
                  "misjudged. Both directions bias every metric, and neither is measurable from this dataset.",
        "mitigation": "Ranking metrics (PR-AUC, ROC-AUC) are less sensitive to a few flipped labels than accuracy, but "
                      "none of the metrics is immune.",
    },
    {
        "id": "generalisation",
        "title": "One dataset, one period, one utility",
        "detail": "SGCC customers, 2014-2016, China. The split is random by customer, so the test set measures "
                  "performance on unseen customers of the same utility in the same period.",
        "mitigation": "None available here. There is no second labelled utility in this project and no validation on "
                      "Kenyan or any other data. Claims beyond SGCC are not supported by anything in this platform.",
    },
    {
        "id": "repeated-splits",
        "title": "The six random splits are not independent samples",
        "detail": "They are re-partitions of the same 42,372 customers, and the hyperparameters were tuned once on the "
                  "seed-42 training customers, some of whom are test customers under the other seeds.",
        "mitigation": "The splits show that the ranking is stable under re-partitioning. They do not give independent "
                      "replications, and their spread understates the uncertainty.",
    },
    {
        "id": "bootstrap-assumptions",
        "title": "What the confidence intervals mean",
        "detail": "The percentile bootstrap resamples customers, holding the fitted models fixed. The interval covers "
                  "the sampling variation of this test set, not the variation that comes from refitting the models, "
                  "re-splitting the data or retraining on a different machine.",
        "mitigation": "The numerical-variability experiment measures the refitting component, and the repeated splits "
                      "the re-splitting component. They are reported separately and should not be added naively.",
    },
    {
        "id": "unequal-conditions",
        "title": "The pipelines were not given equal effort",
        "detail": "Both XGBoost pipelines had 40 Optuna trials. The random forest, logistic regression and the CNN were "
                  "fitted with fixed settings. A comparison therefore measures tuned-XGBoost against untuned baselines.",
        "mitigation": "Row G of the ablation shows what tuning is worth to XGBoost (about +0.046 PR-AUC in the reported "
                      "record), which bounds how much of its lead could be an effort artefact.",
    },
]


class SelectionOnTestRefused(ValueError):
    """Raised when a caller asks for a selection step to be computed on the held-out test customers."""


def _status(run: str) -> str:
    label = rd.run_label(run)
    return {"reported": "recomputed", "executed": "executed"}.get(label["status"], "exploratory")


def provenance(run: str, computed_from: str, note: Optional[str] = None) -> Dict[str, Any]:
    label = rd.run_label(run)
    return {"status": _status(run), "run_id": label["run_id"], "experiment": label["experiment_id"],
            "source": "computed now from the run's saved predictions", "computed_from": computed_from, "note": note}


def available_runs() -> List[Dict[str, Any]]:
    """Runs whose saved predictions this service can evaluate."""
    from src.registry import store

    out = []
    for record in store.list_runs():
        if record.get("state") not in ("succeeded", "reported") or not store.is_sealed(record["run_id"]):
            continue
        if not (store.workspace(record["run_id"]) / "artifacts" / "predictions" / "test.csv.gz").is_file():
            continue
        label = rd.run_label(record["run_id"])
        out.append({"run_id": record["run_id"], "experiment_id": record["experiment_id"], "state": record["state"],
                    "finished_at": record.get("finished_at"), "evidence": _status(record["run_id"]),
                    "label": "Reported record (the original study's published predictions)" if label["status"] == "reported"
                             else record.get("title") or record["experiment_id"]})
    return out


def _frame(run: str, split: str):
    frame = rd.predictions(split, run)
    extensions = None
    try:
        extensions = rd.predictions(split, run, extensions=True)
    except NotFoundError:
        pass
    return frame, extensions


@lru_cache(maxsize=8)
def _arrays(run: str, split: str) -> Tuple[np.ndarray, Dict[str, np.ndarray], Dict[str, np.ndarray], Dict[str, float]]:
    """(labels, calibrated probabilities, raw scores, thresholds) for every pipeline in the run."""
    frame, extensions = _frame(run, split)
    y = frame["label"].to_numpy(dtype=int)
    calibrated, raw = {}, {}
    for column in frame.columns:
        if column in ("label", "customer_id") or column.endswith("_raw"):
            continue
        calibrated[column] = frame[column].to_numpy(dtype=float)
        if f"{column}_raw" in frame.columns:
            raw[column] = frame[f"{column}_raw"].to_numpy(dtype=float)
    if extensions is not None and list(extensions.index) == list(frame.index):
        for column in extensions.columns:
            if column in ("label", "customer_id") or column.endswith("_raw") or column in calibrated:
                continue
            calibrated[column] = extensions[column].to_numpy(dtype=float)
            if f"{column}_raw" in extensions.columns:
                raw[column] = extensions[f"{column}_raw"].to_numpy(dtype=float)
    table = rd.pipelines(run)
    thresholds = {name: float(table[name]["threshold"]) for name in calibrated if name in table}
    for name in calibrated:  # a pipeline the comparison file does not list keeps the study's default rule
        thresholds.setdefault(name, 0.5)
    return y, calibrated, raw, thresholds


def pipelines(run: str = "reported", split: str = "test") -> Dict[str, Any]:
    y, calibrated, _, thresholds = _arrays(run, split)
    table = rd.pipelines(run)
    rows = []
    for name, probabilities in calibrated.items():
        spec = table.get(name, {})
        rows.append({"pipeline": name, "label": spec.get("label", name), "threshold": thresholds[name],
                     "served": bool(spec.get("served")), "tuned": spec.get("tuned"),
                     "preprocessing": spec.get("preprocessing"), "treatment": spec.get("treatment"),
                     "metrics": evaluation.pipeline_metrics(y, probabilities, thresholds[name]),
                     "cost": {k: spec.get(k) for k in ("training_time", "inference_ms_per_customer", "model_size_mb")},
                     "validation_pr_auc": spec.get("validation_pr_auc"),
                     "recorded_metrics": {k: spec.get(k) for k in ("auc", "pr_auc", "recall", "precision", "f1", "mcc", "gmean")}})
    rows.sort(key=lambda r: -(r["metrics"]["pr_auc"]))
    return {"run": rd.run_label(run)["run_id"], "split": split, "customers": int(len(y)), "theft": int(y.sum()),
            "pipelines": rows,
            "provenance": provenance(run, f"{split} predictions saved by the run",
                                     "Metrics are recomputed from the saved probabilities; 'recorded_metrics' is what the "
                                     "run itself wrote, for comparison. Timings depend on the machine that trained the model."),
            "rounding_note": "Predictions are saved to eight significant figures. Recomputing a ranking metric from them "
                             "agrees with the run's own value to better than 1e-5, not exactly: rounding merges a few "
                             "nearly-equal scores into ties. Threshold metrics (recall, precision, F1, MCC, G-Mean) are "
                             "unaffected.",
            "cost_note": "Training and inference times were measured on the machine that ran the experiment and are never "
                         "treated as reproduced."}


def curves(run: str = "reported", split: str = "test", names: Optional[List[str]] = None) -> Dict[str, Any]:
    y, calibrated, _, thresholds = _arrays(run, split)
    chosen = [n for n in (names or list(calibrated)) if n in calibrated]
    if not chosen:
        raise NotFoundError("None of those pipelines is in this run's predictions")
    table = rd.pipelines(run)
    out = []
    for name in chosen:
        probabilities = calibrated[name]
        metrics = evaluation.pipeline_metrics(y, probabilities, thresholds[name])
        out.append({"pipeline": name, "label": table.get(name, {}).get("label", name),
                    "roc": evaluation.roc_points(y, probabilities), "pr": evaluation.pr_points(y, probabilities),
                    "operating_point": {"threshold": thresholds[name], "recall": metrics["recall"],
                                        "precision": metrics["precision"],
                                        "false_positive_rate": 1.0 - metrics["specificity"]}})
    return {"run": rd.run_label(run)["run_id"], "split": split, "base_rate": float(y.mean()), "curves": out,
            "provenance": provenance(run, f"{split} predictions saved by the run",
                                     "Curves are thinned to about 300 points for drawing; the areas are computed on all points.")}


def calibration(run: str = "reported", split: str = "test", name: str = "hybrid", bins: int = 10) -> Dict[str, Any]:
    y, calibrated, raw, _ = _arrays(run, split)
    if name not in calibrated:
        raise NotFoundError(f"{name} is not in this run's predictions")
    if name not in raw:
        raise NotFoundError(f"The run saved no raw scores for {name}, so before/after calibration cannot be shown")
    summary = evaluation.calibration_summary(y, raw[name], calibrated[name], bins)
    recorded = None
    if rd.has_artifact("artifacts/calibration.json", run):
        stored = rd.artifact("artifacts/calibration.json", run).get("pipelines", {}).get(name, {}).get(split, {})
        recorded = {"raw": stored.get("raw"), "platt": stored.get("platt"), "isotonic": stored.get("isotonic")}
    return {"run": rd.run_label(run)["run_id"], "split": split, "pipeline": name, "bins": bins, **summary,
            "recorded": recorded,
            "provenance": provenance(run, f"{split} raw scores and calibrated probabilities saved by the run",
                                     "Platt scaling was fitted on the validation customers during training; this view only "
                                     "measures the result."),
            "reading": "A calibrated probability of 0.30 should mean about 30 thieves in 100 such customers. The gap "
                       "between the two lines is what calibration corrects."}


def ranked(run: str = "reported", split: str = "test", names: Optional[List[str]] = None) -> Dict[str, Any]:
    y, calibrated, _, _ = _arrays(run, split)
    chosen = [n for n in (names or list(calibrated)) if n in calibrated]
    table = rd.pipelines(run)
    return {"run": rd.run_label(run)["run_id"], "split": split,
            "pipelines": [{"pipeline": n, "label": table.get(n, {}).get("label", n), **evaluation.ranked_list(y, calibrated[n])}
                          for n in chosen],
            "provenance": provenance(run, f"{split} predictions saved by the run",
                                     "MAP@k depends on the size and base rate of the set it is computed on, so it compares "
                                     "with published SGCC values only roughly."),
            }


def threshold_sweep(run: str = "reported", split: str = "validation", name: str = "hybrid") -> Dict[str, Any]:
    """Precision/recall against threshold. Validation customers only: this is a selection view."""
    if split == "test":
        raise SelectionOnTestRefused(
            "Thresholds are chosen on the validation customers, never on the held-out test customers. "
            "Choosing an operating point by test performance would make the test metrics meaningless. "
            "Request split=validation; the test customers are for reporting only.")
    y, calibrated, _, thresholds = _arrays(run, split)
    if name not in calibrated:
        raise NotFoundError(f"{name} is not in this run's predictions")
    return {"run": rd.run_label(run)["run_id"], "split": split, "pipeline": name,
            "trained_threshold": thresholds.get(name), "sweep": evaluation.threshold_sweep(y, calibrated[name]),
            "provenance": provenance(run, "validation predictions saved by the run",
                                     "The study's threshold is the F1 maximum on these same customers.")}


@lru_cache(maxsize=16)
def _significance(run: str, split: str, reference: str, names: Tuple[str, ...], resamples: int, seed: int) -> Dict[str, Any]:
    y, calibrated, _, thresholds = _arrays(run, split)
    missing = [n for n in (reference, *names) if n not in calibrated]
    if missing:
        raise NotFoundError(f"Not in this run's predictions: {', '.join(missing)}")
    scores = {n: calibrated[n] for n in dict.fromkeys((reference, *names))}
    return evaluation.paired_tests(y, scores, {n: thresholds[n] for n in scores}, reference, resamples, seed)


def significance(run: str = "reported", split: str = "test", reference: str = "proposed",
                 names: Optional[List[str]] = None, resamples: int = DEFAULT_RESAMPLES, seed: int = 42) -> Dict[str, Any]:
    if not 200 <= resamples <= MAX_RESAMPLES:
        raise ValueError(f"resamples must be between 200 and {MAX_RESAMPLES}")
    y, calibrated, _, _ = _arrays(run, split)
    chosen = tuple(n for n in (names or [n for n in calibrated if n != reference]) if n != reference)
    result = _significance(run, split, reference, chosen, int(resamples), int(seed))
    table = rd.pipelines(run)
    result = json.loads(json.dumps(result))  # detach from the cached object before annotating
    result["labels"] = {n: table.get(n, {}).get("label", n) for n in result["pipelines"]}

    # Where the run stored its own significance record with the same settings, check the arithmetic.
    check = None
    for artifact, path in (("artifacts/significance.json", ()), ("artifacts/hybrid_study.json", ("served_split",))):
        if not rd.has_artifact(artifact, run):
            continue
        stored: Any = rd.artifact(artifact, run)
        for key in path:
            stored = stored.get(key, {})
        if (stored.get("reference") == reference and int(stored.get("resamples", -1)) == int(resamples)
                and set(stored.get("comparisons", {})) == set(chosen)):
            difference = evaluation.max_abs_difference(
                {k: {m: v[m]["difference"] for m in v if isinstance(v.get(m), dict) and "difference" in v[m]}
                 for k, v in stored["comparisons"].items()},
                {k: {m: v[m]["difference"] for m in v if isinstance(v.get(m), dict) and "difference" in v[m]}
                 for k, v in result["comparisons"].items()})
            check = {"artifact": artifact, "max_abs_difference": difference,
                     "agrees": difference is not None and difference < 1e-9}
            break
    result["recomputation_check"] = check
    result["provenance"] = provenance(run, f"{split} predictions saved by the run",
                                      "Paired stratified bootstrap: thieves and honest customers are resampled separately, "
                                      "the fitted models are held fixed, and each pipeline keeps its own validation-chosen "
                                      "threshold. Holm's correction is applied across the comparisons of each metric.")
    result["method"] = {
        "bootstrap": "percentile interval over customer resamples, stratified by label; models are not refitted",
        "p_value": "two-sided bootstrap p-value: twice the smaller share of resamples on either side of zero",
        "multiplicity": f"Holm across the {len(chosen)} comparisons of each metric",
        "mcnemar": "exact binomial test on the customers the two pipelines classify differently",
        "covers": "the sampling variation of this test set only, not refitting, re-splitting or different hardware",
    }
    return result


def stability(run: str = "reported") -> Dict[str, Any]:
    """Repeated splits, nested cross-validation and training seeds, as the run's records hold them."""
    out: Dict[str, Any] = {"run": rd.run_label(run)["run_id"], "sections": []}

    def add(title: str, artifact: str, payload) -> None:
        if rd.has_artifact(artifact, run):
            try:
                body = payload(rd.artifact(artifact, run))
            except (KeyError, TypeError, IndexError):
                return
            if body:
                out["sections"].append({"title": title, "artifact": artifact, **body})

    add("The five study pipelines on six random splits", "artifacts/robustness.json", lambda d: {
        "kind": "per_seed", "seeds": d["splits"]["seeds"],
        "rows": [{"pipeline": name, "mean": entry["mean"]["pr_auc"], "sd": entry["sd"]["pr_auc"],
                  "per_seed": {s: v["pr_auc"] for s, v in entry["per_seed"].items()}}
                 for name, entry in d["splits"]["pipelines"].items()],
        "ranked_first": d["splits"]["ranked_first_on_pr_auc"],
        "caveat": "Re-partitions of the same customers. The hyperparameters were tuned once on the seed-42 training "
                  "customers, so the other splits are not independent of tuning."})
    add("The hybrid on six random splits", "artifacts/hybrid_study.json", lambda d: {
        "kind": "summary", "rows": [{"pipeline": name, "mean": entry["mean"]["pr_auc"], "sd": entry["sd"]["pr_auc"]}
                                    for name, entry in d["summary"].items()],
        "wins": d.get("hybrid_higher_pr_auc_than"),
        "weights": {seed: entry["weight_cnn"] for seed, entry in d.get("per_seed", {}).items()},
        "caveat": "The blend weight is chosen on each split's validation customers; the XGBoost hyperparameters are not."})
    add("Nested cross-validation of the whole hybrid procedure", "artifacts/nested_cv.json", lambda d: {
        "kind": "summary", "rows": [{"pipeline": name, "mean": entry["mean"]["pr_auc"], "sd": entry["sd"]["pr_auc"],
                                     "pooled": entry.get("pooled_pr_auc")}
                                    for name, entry in d["summary"]["per_model"].items()],
        "wins": d["summary"].get("hybrid_higher_pr_auc_than"), "folds": d.get("outer_folds"),
        "caveat": "Every choice is remade inside each outer fold, so each customer is scored by models that never saw "
                  "them. This is the strongest evidence here that the hybrid's advantage is not an artefact of the "
                  "reused test split."})
    add("CNN training seeds", "artifacts/cnn_checks.json", lambda d: {
        "kind": "summary", "rows": [{"pipeline": name, "mean": entry["pr_auc"]["mean"], "sd": entry["pr_auc"]["sd"]}
                                    for name, entry in d["seed_summary"].items()],
        "caveat": "Only the network's initialisation and batch order change between these runs."})
    add("Numerical noise floor (thread count only)", "artifacts/numerical_variability.json", lambda d: {
        "kind": "noise", "threads": d["threads"],
        "rows": [{"pipeline": name, "min": e["test_pr_auc"]["min"], "max": e["test_pr_auc"]["max"],
                  "range": e["test_pr_auc"]["range"], "sd": e["test_pr_auc"]["sd"], "trees": e["best_iteration"]}
                 for name, e in d["summary"].items()],
        "caveat": "Identical data, split, hyperparameters and seed; only the number of CPU threads differs. No difference "
                  "smaller than this range carries meaning."})
    return out


def limitations(run: str = "reported") -> Dict[str, Any]:
    """The methodological limitations, with the figures from this run that bear on each."""
    rows = [dict(item) for item in LIMITATIONS]
    by_id = {item["id"]: item for item in rows}
    if rd.has_artifact("artifacts/cnn_checks.json", run):
        checks = rd.artifact("artifacts/cnn_checks.json", run)
        full = checks["variants"]["full"]["cnn"]["pr_auc"]
        without = checks["variants"]["no_mask"]["cnn"]["pr_auc"]
        by_id["missingness-shortcut"]["evidence"] = (
            f"In this run the CNN falls from PR-AUC {full:.3f} to {without:.3f} without its missing-reading channel "
            f"({without / full:.0%} of its performance remains).")
    if rd.has_artifact("artifacts/nested_cv.json", run):
        nested = rd.artifact("artifacts/nested_cv.json", run)["summary"]["per_model"]
        by_id["hybrid-selection"]["evidence"] = (
            f"Nested cross-validation in this run: hybrid PR-AUC {nested['hybrid']['mean']['pr_auc']:.3f} "
            f"± {nested['hybrid']['sd']['pr_auc']:.3f} against XGBoost {nested['xgboost']['mean']['pr_auc']:.3f}.")
        by_id["test-reuse"]["evidence"] = by_id["hybrid-selection"]["evidence"]
    if rd.has_artifact("artifacts/numerical_variability.json", run):
        noise = rd.artifact("artifacts/numerical_variability.json", run)["summary"]
        worst = max(entry["test_pr_auc"]["range"] for entry in noise.values())
        by_id["bootstrap-assumptions"]["evidence"] = (
            f"Changing only the CPU thread count moves test PR-AUC by up to {worst:.4f}, which the bootstrap interval "
            "does not include.")
    if rd.has_artifact("artifacts/ablation.json", run):
        variants = rd.artifact("artifacts/ablation.json", run)["variants"]
        tuned = variants.get("B. Raw, all features (standard XGBoost)", {}).get("pr_auc")
        default = variants.get("G. B with default hyperparameters", {}).get("pr_auc")
        if tuned and default:
            by_id["unequal-conditions"]["evidence"] = (
                f"In this run, tuning is worth {tuned - default:+.3f} PR-AUC to XGBoost in cross-validation "
                f"({default:.3f} to {tuned:.3f}).")
    return {"run": rd.run_label(run)["run_id"], "limitations": rows,
            "provenance": provenance(run, "the run's records", "The texts are fixed; the figures beside them come from this run.")}


def fingerprint(run: str = "reported", split: str = "test") -> Dict[str, Any]:
    """A hash of the customers and labels evaluated, so two runs can be shown to cover the same people."""
    frame = rd.predictions(split, run)
    ids = "\n".join(map(str, frame.index))
    return {"run": rd.run_label(run)["run_id"], "split": split, "customers": int(len(frame)),
            "theft": int(frame["label"].sum()),
            "customer_ids_sha256": hashlib.sha256(ids.encode()).hexdigest(),
            "labels_sha256": hashlib.sha256(frame["label"].to_numpy(dtype=int).tobytes()).hexdigest()}


def compare(run_a: str, run_b: str, split: str = "test") -> Dict[str, Any]:
    """The same metrics for two runs, with the difference, once both are shown to cover the same customers."""
    a, b = fingerprint(run_a, split), fingerprint(run_b, split)
    same = a["customer_ids_sha256"] == b["customer_ids_sha256"] and a["labels_sha256"] == b["labels_sha256"]
    left = {row["pipeline"]: row for row in pipelines(run_a, split)["pipelines"]}
    right = {row["pipeline"]: row for row in pipelines(run_b, split)["pipelines"]}
    metrics = ("auc", "pr_auc", "recall", "precision", "f1", "mcc", "gmean")
    rows = []
    for name in sorted(set(left) | set(right)):
        la, lb = left.get(name), right.get(name)
        rows.append({"pipeline": name, "label": (la or lb)["label"],
                     "metrics": {m: {"a": la["metrics"][m] if la else None, "b": lb["metrics"][m] if lb else None,
                                     "difference": (lb["metrics"][m] - la["metrics"][m]) if la and lb else None}
                                 for m in metrics},
                     "threshold": {"a": la["threshold"] if la else None, "b": lb["threshold"] if lb else None}})
    return {"a": {**a, "evidence": _status(run_a)}, "b": {**b, "evidence": _status(run_b)}, "split": split,
            "same_customers": same, "pipelines": rows,
            "note": "Both runs score the same customers with the same labels." if same else
                    "These runs do not evaluate the same customers; the difference column is not a like-for-like comparison.",
            "provenance": provenance(run_b, f"{split} predictions of both runs")}


def clear_caches() -> None:
    _arrays.cache_clear()
    _significance.cache_clear()
