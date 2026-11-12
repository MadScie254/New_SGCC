"""
Explainable AI for the research side: SHAP and LIME on the XGBoost part, week occlusion on the CNN
part, and the shortcut-learning investigation.

The operations console already explains a *flagged customer in service* (`backend/services/model.py`,
unlabelled population). This service explains a *research customer* of the labelled study split, so
explanations can be set beside the truth and compared across the two classes. The two never mix:
nothing here is reachable from the operations pages, and nothing there imports this module.

The shortcut-learning panel is the reason this service exists. The study's own checks show that
most of the CNN's advantage disappears when its missing-reading channel is removed. That is
consistent with a model that has learned a data-collection artefact rather than theft, and the
panel measures it directly: how separable the classes are from missingness alone, how much of a
customer's score the missing days carry, and what happens when the missingness is masked away.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from backend.services import research_data as rd
from backend.services.errors import NotFoundError
from src import sequence
from src.feature_catalog import CORE_FEATURES, feature_group, feature_label

# The eight features the study itself removes when it asks what missingness is worth
# (artifacts/robustness.json -> missingness.missing_features, and cnn_checks.json ->
# missing_features_removed). Taken from the record rather than guessed, and verified by a test,
# so this view and the study's own ablation always mean the same thing by "missingness feature".
FALLBACK_MISSING_FEATURES = ("missing_ratio", "missing_ratio_first_third", "missing_ratio_middle_third",
                             "missing_ratio_last_third", "longest_missing_run", "missing_sequences_count",
                             "first_obs_frac", "last_obs_frac")
EXPLAIN_SAMPLE = 1500
LIME_SAMPLES = 2000


class ExplainerUnavailable(RuntimeError):
    """SHAP, LIME or the served model is not usable in this environment."""


@lru_cache(maxsize=1)
def missing_features() -> Tuple[str, ...]:
    """The study's own list of missing-reading features, read from its records."""
    for artifact, path in (("artifacts/robustness.json", ("missingness", "missing_features")),
                           ("artifacts/cnn_checks.json", ("missing_features_removed",))):
        if not rd.has_artifact(artifact, "reported"):
            continue
        node: Any = rd.artifact(artifact, "reported")
        try:
            for key in path:
                node = node[key]
            if isinstance(node, list) and node:
                return tuple(str(n) for n in node)
        except (KeyError, TypeError, IndexError):
            continue
    return FALLBACK_MISSING_FEATURES


# ---------------------------------------------------------------------------
# The model being explained
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _model() -> Tuple[Any, List[str]]:
    from backend.services.model import get_feature_names, get_trained_model

    return get_trained_model(), list(get_feature_names())


@lru_cache(maxsize=1)
def _explainer():
    import shap

    model, _ = _model()
    return shap.TreeExplainer(model)


def _matrix(customers: pd.Index) -> pd.DataFrame:
    """The served model's features for these research customers, in the model's own column order."""
    _, names = _model()
    spec = rd.artifact("artifacts/pipeline.json", "reported")
    features = rd.features(spec.get("preprocessing", "raw") if spec.get("preprocessing") in ("raw", "clean") else "raw")
    missing = [n for n in names if n not in features.columns]
    if missing:
        raise ExplainerUnavailable(f"The research feature matrix is missing {len(missing)} of the model's features")
    return features.loc[customers, names]


def _shap(frame: pd.DataFrame) -> np.ndarray:
    values = _explainer().shap_values(frame)
    if isinstance(values, list):
        values = values[-1]
    return np.asarray(values, dtype=float).reshape(len(frame), -1)


def _sample(seed: int = 42, size: int = EXPLAIN_SAMPLE) -> pd.Index:
    """A seeded sample of test customers, stratified by label, used for every global view."""
    labels = rd.dataset().labels.loc[rd.split()["test"]]
    rng = np.random.default_rng(seed)
    take = []
    for value in (0, 1):
        members = labels.index[labels == value]
        n = max(1, int(round(size * len(members) / len(labels))))
        take.append(rng.choice(members, size=min(n, len(members)), replace=False))
    return pd.Index(np.concatenate(take))


def _provenance(what: str, note: Optional[str] = None) -> Dict[str, Any]:
    label = rd.run_label("reported")
    return {"status": "executed", "run_id": label["run_id"], "experiment": "explainability",
            "source": "computed now from the served model and the labelled study data",
            "computed_from": what, "note": note}


# ---------------------------------------------------------------------------
# Global explanation
# ---------------------------------------------------------------------------

@lru_cache(maxsize=4)
def global_importance(seed: int = 42, top: int = 25) -> Dict[str, Any]:
    """Mean |SHAP| per feature over a seeded sample of test customers, with the class split."""
    customers = _sample(seed)
    frame = _matrix(customers)
    values = _shap(frame)
    labels = rd.dataset().labels.loc[customers].to_numpy()
    mean_abs = np.abs(values).mean(axis=0)
    order = np.argsort(-mean_abs)[:top]
    rows = []
    for i in order:
        name = frame.columns[i]
        column = frame.iloc[:, i].to_numpy(dtype=float)
        finite = np.isfinite(column)
        rows.append({
            "feature": name, "label": feature_label(name), "group": feature_group(name),
            "core": name in CORE_FEATURES, "missingness_feature": name in missing_features(),
            "mean_abs_shap": float(mean_abs[i]),
            "mean_shap_theft": float(values[labels == 1, i].mean()),
            "mean_shap_honest": float(values[labels == 0, i].mean()),
            "value_median_theft": float(np.nanmedian(column[(labels == 1) & finite])) if (labels == 1).any() else None,
            "value_median_honest": float(np.nanmedian(column[(labels == 0) & finite])) if (labels == 0).any() else None,
            "direction": "higher value raises the score" if np.corrcoef(column[finite], values[finite, i])[0, 1] > 0 else "higher value lowers the score",
        })
    share = sum(r["mean_abs_shap"] for r in rows if r["missingness_feature"]) / max(mean_abs.sum(), 1e-12)
    return {"customers": int(len(customers)), "theft": int(labels.sum()), "features": rows,
            "missingness_share_of_attribution": float(share),
            "provenance": _provenance(f"SHAP over {len(customers)} sampled test customers",
                                      "SHAP values are in log-odds of the XGBoost part, not of the served blend."),
            "reading": "Mean |SHAP| is how much a feature moves this model's score on average. It is not a measure of how "
                       "much that feature causes theft."}


@lru_cache(maxsize=4)
def beeswarm(seed: int = 42, top: int = 12, per_feature: int = 300) -> Dict[str, Any]:
    """Per-customer SHAP values for the strongest features, thinned for drawing."""
    customers = _sample(seed)
    frame = _matrix(customers)
    values = _shap(frame)
    labels = rd.dataset().labels.loc[customers].to_numpy()
    order = np.argsort(-np.abs(values).mean(axis=0))[:top]
    rng = np.random.default_rng(seed)
    pick = rng.choice(len(frame), size=min(per_feature, len(frame)), replace=False)
    rows = []
    for i in order:
        name = frame.columns[i]
        column = frame.iloc[pick, i].to_numpy(dtype=float)
        finite = column[np.isfinite(column)]
        low, high = (np.percentile(finite, [5, 95]) if finite.size else (0.0, 1.0))
        spread = high - low or 1.0
        rows.append({
            "feature": name, "label": feature_label(name), "group": feature_group(name),
            "missingness_feature": name in missing_features(),
            "points": [{"shap": float(values[j, i]),
                        "normalised_value": None if not np.isfinite(frame.iloc[j, i]) else float(np.clip((frame.iloc[j, i] - low) / spread, 0, 1)),
                        "label": int(labels[j])}
                       for j in pick],
        })
    return {"features": rows, "customers": int(len(pick)),
            "provenance": _provenance(f"SHAP over {len(pick)} sampled test customers"),
            "reading": "Each dot is one customer. Horizontal position is that feature's push on the score; colour is the "
                       "feature's own value from low to high."}


# ---------------------------------------------------------------------------
# One customer
# ---------------------------------------------------------------------------

def _scores(customer_id: str) -> Dict[str, Any]:
    frame = rd.predictions("test", "reported")
    if customer_id not in frame.index:
        frame = rd.predictions("validation", "reported")
        if customer_id not in frame.index:
            raise NotFoundError(f"{customer_id} is not among the study's validation or test customers")
        split = "validation"
    else:
        split = "test"
    row = frame.loc[customer_id]
    return {"split": split, "label": int(row["label"]),
            "probabilities": {name: float(row[name]) for name in frame.columns
                              if name not in ("label",) and not name.endswith("_raw")}}


def explain_customer(customer_id: str, top: int = 15) -> Dict[str, Any]:
    """SHAP for the XGBoost part, CNN week effects, and the saved probability of every pipeline."""
    customer_id = str(customer_id)
    scores = _scores(customer_id)
    frame = _matrix(pd.Index([customer_id]))
    values = _shap(frame)[0]
    base = float(np.asarray(_explainer().expected_value).ravel()[-1])
    order = np.argsort(-np.abs(values))[:top]
    contributions = [{
        "feature": frame.columns[i], "label": feature_label(frame.columns[i]), "group": feature_group(frame.columns[i]),
        "value": None if not np.isfinite(frame.iloc[0, i]) else float(frame.iloc[0, i]),
        "shap_value": float(values[i]), "missingness_feature": frame.columns[i] in missing_features(),
    } for i in order]
    return {"customer_id": customer_id, **scores, "base_value": base,
            "sum_of_contributions": float(values.sum()), "logit": float(base + values.sum()),
            "contributions": contributions,
            "provenance": _provenance("the served XGBoost model and the study's saved predictions",
                                      "SHAP contributions explain the XGBoost part in log-odds. The hybrid's probability "
                                      "also contains the CNN part, which SHAP does not cover; its weeks are shown separately."),
            "caveat": "A model attribution says what moved this model's score. It is not evidence that this customer took "
                      "electricity, and must never be recorded as a finding against them."}


@lru_cache(maxsize=64)
def week_effects(customer_id: str) -> Dict[str, Any]:
    """How much each week of readings raised the CNN's score, by occlusion (the study's method)."""
    from backend.services.model import get_sequence_network, is_hybrid

    if not is_hybrid():
        return {"customer_id": customer_id, "available": False, "weeks": [],
                "detail": "The served pipeline has no sequence model."}
    data = rd.dataset()
    if customer_id not in data.wide.index:
        raise NotFoundError(f"Unknown customer: {customer_id}")
    row = data.wide.loc[[customer_id]]
    spec = rd.artifact("artifacts/pipeline.json", "reported")
    cleaning = spec.get("components", {}).get("wide_deep_cnn", {}).get("cleaning")
    values, mask = sequence.prepare(row, cleaning)
    effects = sequence.week_effects(get_sequence_network(), values[0], mask[0])
    days = sequence.day_index(row.shape[1])
    dates = pd.DatetimeIndex(row.columns)
    weeks = []
    for item in effects:
        positions = [int(d) for d in days[item["week"] * 7:(item["week"] + 1) * 7] if d >= 0]
        if not positions:
            continue
        window = row.iloc[0, positions]
        weeks.append({"week": item["week"], "effect": item["effect"],
                      "start": dates[positions[0]].strftime("%Y-%m-%d"), "end": dates[positions[-1]].strftime("%Y-%m-%d"),
                      "missing_days": int(window.isna().sum()), "days": len(positions),
                      "mean_kwh": None if window.notna().sum() == 0 else float(window.mean())})
    strongest = sorted(weeks, key=lambda w: -w["effect"])[:5]
    missing_in_top = sum(w["missing_days"] for w in strongest)
    return {"customer_id": customer_id, "available": True, "weeks": weeks,
            "strongest_weeks": strongest,
            "missing_days_in_strongest_weeks": missing_in_top,
            "provenance": _provenance("occlusion of the served CNN, one week at a time",
                                      "Each week is replaced by the customer's typical observed day and marked observed; "
                                      "the effect is the fall in the log-odds. Occlusion assumes the weeks act independently, "
                                      "which they do not, so the effects do not add up to the score."),
            "reading": "A week with a large effect is one the network relies on. Weeks that are mostly missing readings and "
                       "still carry a large effect are the clearest sign of the shortcut this platform warns about."}


def explanation_agreement(customer_id: str, top: int = 5, samples: int = LIME_SAMPLES, seed: int = 42) -> Dict[str, Any]:
    """
    SHAP against LIME on the XGBoost part of one customer. Disagreement is shown, never hidden:
    the study's own protocol flags a case for human review when the two explanations differ.
    """
    try:
        from lime.lime_tabular import LimeTabularExplainer
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise ExplainerUnavailable("LIME is not installed") from exc

    model, names = _model()
    background = _matrix(_sample(seed, 800))
    filled = background.fillna(background.median())
    explainer = LimeTabularExplainer(filled.to_numpy(dtype=float), feature_names=list(names),
                                     class_names=["honest-labelled", "theft-labelled"], discretize_continuous=True,
                                     random_state=seed, mode="classification")
    row = _matrix(pd.Index([str(customer_id)]))
    filled_row = row.fillna(background.median()).to_numpy(dtype=float)[0]
    local = explainer.explain_instance(filled_row, lambda x: model.predict_proba(pd.DataFrame(x, columns=names)),
                                       num_features=top, num_samples=int(samples))
    lime_weights = {names[i]: float(w) for i, w in local.as_map()[1]}
    shap_values = _shap(row)[0]
    shap_top = {row.columns[i]: float(shap_values[i]) for i in np.argsort(-np.abs(shap_values))[:top]}
    shared = set(shap_top) & set(lime_weights)
    same_direction = [n for n in shared if np.sign(shap_top[n]) == np.sign(lime_weights[n])]
    strongest = max(shap_top, key=lambda n: abs(shap_top[n]))
    agrees = len(shared) >= 3 and (strongest in lime_weights and np.sign(shap_top[strongest]) == np.sign(lime_weights[strongest]))
    return {"customer_id": str(customer_id), "top": top, "samples": int(samples),
            "shap": [{"feature": n, "label": feature_label(n), "weight": v} for n, v in shap_top.items()],
            "lime": [{"feature": n, "label": feature_label(n), "weight": v} for n, v in lime_weights.items()],
            "shared_features": sorted(shared), "same_direction": sorted(same_direction),
            "agrees": bool(agrees),
            "provenance": _provenance("SHAP and a LIME local surrogate of the XGBoost part"),
            "reading": "Agreement means the two methods describe this model's behaviour the same way. It is a check of "
                       "stability, not of correctness, and it says nothing about causation. Disagreement is a reason for "
                       "a person to look at the case, not to distrust the customer."}


# ---------------------------------------------------------------------------
# The shortcut-learning investigation
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def missingness_profile() -> Dict[str, Any]:
    """How far the two labelled groups differ in missing readings alone, before any model."""
    data = rd.dataset()
    missing = data.wide.isna()
    share = missing.mean(axis=1)
    labels = data.labels
    by_class = {}
    for name, value in (("honest", 0), ("theft", 1)):
        column = share[labels == value]
        by_class[name] = {"customers": int(len(column)), "mean": float(column.mean()), "median": float(column.median()),
                          "p10": float(column.quantile(0.1)), "p90": float(column.quantile(0.9)),
                          "complete_records": int((column == 0).sum())}
    edges = np.linspace(0, 1, 26)
    histogram = []
    for i in range(len(edges) - 1):
        in_bin = (share >= edges[i]) & (share < edges[i + 1] if i < len(edges) - 2 else share <= edges[i + 1])
        histogram.append({"low": float(edges[i]), "high": float(edges[i + 1]),
                          "honest": int((in_bin & (labels == 0)).sum()), "theft": int((in_bin & (labels == 1)).sum())})
    # How well missingness alone separates the two groups: the AUC of "more missing days = theft".
    from sklearn.metrics import roc_auc_score

    auc = float(roc_auc_score(labels.to_numpy(), share.to_numpy()))
    per_day = missing.mean(axis=0)
    dates = pd.DatetimeIndex(data.wide.columns)
    monthly = pd.Series(per_day.to_numpy(), index=dates).resample("MS").mean()
    theft_monthly = pd.Series(missing[labels == 1].mean(axis=0).to_numpy(), index=dates).resample("MS").mean()
    honest_monthly = pd.Series(missing[labels == 0].mean(axis=0).to_numpy(), index=dates).resample("MS").mean()
    return {
        "overall_missing_share": float(missing.to_numpy().mean()),
        "by_class": by_class, "histogram": histogram,
        "auc_of_missing_share_alone": auc,
        "monthly": [{"month": str(m.date()), "all": float(v), "theft": float(theft_monthly[m]), "honest": float(honest_monthly[m])}
                    for m, v in monthly.items()],
        "provenance": _provenance("the labelled SGCC release", None),
        "reading": f"Ranking customers by nothing but their share of missing readings separates the two labelled groups "
                   f"with an AUC of {auc:.3f}. A model that reads missingness is therefore picking up a real difference in "
                   "the data — but a difference in how the meters reported, which need not be a difference in behaviour.",
    }


def missingness_attribution(seed: int = 42) -> Dict[str, Any]:
    """How much of the model's attribution sits on missing-reading features, by class."""
    importance = global_importance(seed)
    rows = [f for f in importance["features"] if f["missingness_feature"]]
    return {"share_of_total_attribution": importance["missingness_share_of_attribution"],
            "features": rows, "customers": importance["customers"],
            "provenance": importance["provenance"],
            "reading": "This is the XGBoost part only. The study's own checks show the CNN part depends on missingness "
                       "far more: without its missing-reading channel it loses most of its advantage."}


@lru_cache(maxsize=1)
def shortcut_evidence() -> Dict[str, Any]:
    """The recorded experiments that bear on the shortcut question, with what each one shows."""
    sections = []
    reported, latest = "reported", "latest"

    def pair(artifact: str, path, title: str, reading: str) -> None:
        values = {}
        for run in (reported, latest):
            if not rd.has_artifact(artifact, run):
                continue
            node: Any = rd.artifact(artifact, run)
            try:
                for key in path:
                    node = node[key]
            except (KeyError, TypeError, IndexError):
                continue
            values[rd.run_label(run)["status"]] = {"value": float(node), "run_id": rd.run_label(run)["run_id"]}
        if values:
            sections.append({"title": title, "artifact": artifact, "values": values, "reading": reading})

    pair("artifacts/cnn_checks.json", ("variants", "full", "cnn", "pr_auc"), "CNN with its missing-reading channel",
         "The served network, reading both the consumption values and which days failed to report.")
    pair("artifacts/cnn_checks.json", ("variants", "no_mask", "cnn", "pr_auc"), "CNN without that channel",
         "The same architecture and training, with the channel removed. The fall is the part of its performance that "
         "depended on knowing which readings were missing.")
    pair("artifacts/cnn_checks.json", ("variants", "no_mask_no_september", "cnn", "pr_auc"),
         "CNN without the channel, September 2016 replaced",
         "September 2016 contains the release's absent date. Replacing it as well tests whether that one gap explains the effect.")
    pair("artifacts/cnn_checks.json", ("variants", "no_mask_no_september", "hybrid_behaviour_only", "pr_auc"),
         "Hybrid on consumption behaviour alone",
         "Neither part can see missingness. What remains is detection from consumption behaviour only.")
    pair("artifacts/cnn_checks.json", ("xgboost_behaviour_only", "pr_auc"), "XGBoost on consumption behaviour alone",
         "The feature-based model with its eight missing-reading features removed.")
    pair("artifacts/robustness.json", ("missingness", "variants", "All features (served model's inputs)", "pr_auc"),
         "XGBoost in cross-validation, all features", "Five-fold cross-validation on the development customers.")
    pair("artifacts/robustness.json", ("missingness", "variants", "Without missing-reading features", "pr_auc"),
         "XGBoost without the missing-reading features", "Same folds, eight features removed.")
    pair("artifacts/robustness.json", ("missingness", "variants", "Consumption behaviour only", "pr_auc"),
         "Consumption behaviour only", "Gaps filled first, so no trace of missingness remains.")
    pair("artifacts/robustness.json", ("missingness", "variants", "Missing-reading features only", "pr_auc"),
         "Missing-reading features only", "The eight features on their own, against a base rate of 0.085.")
    return {"sections": sections,
            "provenance": {"status": "reported", "run_id": rd.run_label("reported")["run_id"], "experiment": "cnn.checks / robustness.splits",
                           "source": "records of the sealed runs", "computed_from": "artifacts/cnn_checks.json, artifacts/robustness.json",
                           "note": "Both the reported value and the rerun value are shown where both exist."},
            "conclusion": "Missing readings carry a large part of the hybrid's advantage, and consumption behaviour alone "
                          "still detects theft far above chance. Neither finding settles whether the models would work at a "
                          "utility whose meters fail differently; nothing in this dataset can settle that.",
            "what_would_settle_it": [
                "Labelled data from a second utility with a different meter estate and a different failure pattern.",
                "A record of why each SGCC reading is missing (communication fault, meter fault, disconnection, tampering). "
                "The release does not contain one.",
                "An experiment in which missingness is held constant between the two groups by design rather than by masking.",
            ]}


def mask_experiment(customer_id: str) -> Dict[str, Any]:
    """
    What happens to one customer's CNN score when the missing-reading channel is taken away.

    This is a controlled change to the *input*, not to the study: the trained network is unchanged
    and nothing is refitted, so the result is a sensitivity of the served model, not a new result.
    """
    from backend.services.model import get_sequence_network, is_hybrid

    if not is_hybrid():
        raise ExplainerUnavailable("The served pipeline has no sequence model")
    data = rd.dataset()
    if customer_id not in data.wide.index:
        raise NotFoundError(f"Unknown customer: {customer_id}")
    row = data.wide.loc[[customer_id]]
    spec = rd.artifact("artifacts/pipeline.json", "reported")
    cleaning = spec.get("components", {}).get("wide_deep_cnn", {}).get("cleaning")
    values, mask = sequence.prepare(row, cleaning)
    network = get_sequence_network()
    variants = {
        "served": (values, mask),
        "missingness_hidden": (values, np.zeros_like(mask)),
        "all_days_marked_missing": (values, np.ones_like(mask)),
    }
    out = {}
    for name, (v, m) in variants.items():
        out[name] = float(sequence.sigmoid(network.logits(v, m))[0])
    return {"customer_id": customer_id, "label": int(data.labels.loc[customer_id]),
            "missing_share": float(row.isna().to_numpy().mean()),
            "scores": out,
            "effect_of_hiding_missingness": out["missingness_hidden"] - out["served"],
            "provenance": _provenance("the served CNN with its missing-reading channel changed",
                                      "The network is not retrained. Hiding the channel tells the network every reading was "
                                      "observed, which is a counterfactual input, not a different model."),
            "caveat": "The network never saw an input like this during training, so a large change may reflect the input "
                      "being out of distribution as much as a reliance on missingness. The retrained comparison in "
                      "cnn.checks is the sound version of this question; this view is for one customer at a time."}


def searchable_customers(query: str = "", label: Optional[int] = None, limit: int = 40) -> Dict[str, Any]:
    """Study customers to explain, by id prefix and label."""
    frame = rd.predictions("test", "reported")
    index = frame.index.astype(str)
    keep = index.str.startswith(query.strip()) if query.strip() else np.ones(len(index), dtype=bool)
    if label is not None:
        keep = keep & (frame["label"].to_numpy() == int(label))
    chosen = frame[keep].head(int(limit))
    served = "hybrid" if "hybrid" in frame.columns else frame.columns[-1]
    return {"customers": [{"customer_id": str(i), "label": int(r["label"]), "probability": float(r[served])}
                          for i, r in chosen.iterrows()],
            "total_matching": int(keep.sum()), "served_pipeline": served,
            "note": "These are the study's test customers, so their labels are known. Operations customers are unlabelled "
                    "and are explained on the case pages instead."}


def clear_caches() -> None:
    for cached in (global_importance, beeswarm, week_effects, missingness_profile, shortcut_evidence, _model,
                   _explainer, missing_features):
        cached.cache_clear()


def fingerprint() -> str:
    _, names = _model()
    return hashlib.sha256("\n".join(names).encode()).hexdigest()[:16]
