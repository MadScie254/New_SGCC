"""
How much do the tuned XGBoost pipelines move when nothing but the number of CPU threads changes?

    python scripts/numerical_variability.py [--threads 1 2 4 8 12]

GridSentinel X added this after its first rerun of the study (2026-11-10). Data, split, features,
SMOTE+ENN counts, the untuned XGBoost and the random forest reproduced bit for bit, but the two
tuned XGBoost pipelines did not, although library versions and seeds were the same. This script
isolates the cause: it refits both pipelines with the *same* hyperparameters (those of the
training run that seeds the workspace) and the same seed, once per thread count, each in a fresh
process, and reports the spread of the test metrics and of the per-customer scores.

Histogram-based tree building sums gradients in an order that depends on how rows are divided
among threads; with deep trees, minimum-loss thresholds and early stopping, differences in the
last floating-point digit change a split, then the trees after it. The spread measured here is
therefore the numerical noise floor of every result that depends on a tuned XGBoost fit.

The test customers are scored for reporting only; nothing is selected with them.
Writes artifacts/numerical_variability.json. Exploratory: not part of the original protocol.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.workspace import workspace_root  # noqa: E402

WORK = workspace_root()
PIPELINES = ("xgboost", "proposed")


def one(threads: int) -> None:
    """Fit both pipelines in this process (thread count fixed by the environment) and print JSON."""
    import numpy as np
    from sklearn.metrics import average_precision_score, roc_auc_score

    from src.calibration import apply_platt, fit_platt
    from src.experiment import CANDIDATES, fit_candidate
    from src.study import load_study

    study = load_study()
    tuning = json.loads((study.artifacts / "tuning.json").read_text())
    out = {}
    for name in PIPELINES:
        X, y = study.X_by[CANDIDATES[name]["preprocessing"]], study.y
        fitted = fit_candidate(name, X.loc[study.train_idx], y.loc[study.train_idx], params=tuning[name]["params"],
                               X_val=X.loc[study.val_idx], y_val=y.loc[study.val_idx],
                               resampling_config=study.config.get("resampling"),
                               early_stopping_rounds=int(study.config["evaluation"]["early_stopping_rounds"]),
                               random_state=int(study.config["random_state"]))
        raw_val = fitted.predict(X.loc[study.val_idx])
        raw_test = fitted.predict(X.loc[study.test_idx])
        cal_test = apply_platt(raw_test, fit_platt(raw_val, y.loc[study.val_idx]))
        out[name] = {"best_iteration": int(fitted.learning_curve["best_iteration"]),
                     "validation_pr_auc": float(average_precision_score(y.loc[study.val_idx], raw_val)),
                     "test_pr_auc": float(average_precision_score(y.loc[study.test_idx], raw_test)),
                     "test_auc": float(roc_auc_score(y.loc[study.test_idx], raw_test)),
                     "scores": np.round(cal_test, 6).tolist()}
    print("RESULT " + json.dumps({"threads": threads, "pipelines": out}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--threads", type=int, nargs="+", default=[1, 2, 4, 8, 12])
    parser.add_argument("--one", type=int, default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.one is not None:
        one(args.one)
        return

    import numpy as np

    runs = []
    for threads in args.threads:
        env = {**os.environ, "OMP_NUM_THREADS": str(threads), "MKL_NUM_THREADS": str(threads)}
        done = subprocess.run([sys.executable, __file__, "--one", str(threads)], env=env, capture_output=True, text=True, cwd=os.getcwd())
        line = next((l for l in done.stdout.splitlines() if l.startswith("RESULT ")), None)
        if line is None:
            raise SystemExit(f"threads={threads} failed:\n{done.stdout[-2000:]}\n{done.stderr[-2000:]}")
        runs.append(json.loads(line[7:]))
        print(f"threads {threads}: " + ", ".join(
            f"{n} PR-AUC {runs[-1]['pipelines'][n]['test_pr_auc']:.4f} ({runs[-1]['pipelines'][n]['best_iteration']} trees)"
            for n in PIPELINES), flush=True)

    summary = {}
    for name in PIPELINES:
        scores = np.array([r["pipelines"][name]["scores"] for r in runs])
        entry = {}
        for metric in ("test_pr_auc", "test_auc", "validation_pr_auc"):
            values = np.array([r["pipelines"][name][metric] for r in runs])
            entry[metric] = {"min": float(values.min()), "max": float(values.max()), "range": float(values.max() - values.min()),
                             "mean": float(values.mean()), "sd": float(values.std(ddof=1)) if len(values) > 1 else 0.0}
        entry["best_iteration"] = [r["pipelines"][name]["best_iteration"] for r in runs]
        entry["identical_scores_between_thread_counts"] = bool((scores == scores[0]).all())
        entry["max_abs_score_difference"] = float(np.abs(scores - scores[0]).max())
        entry["mean_abs_score_difference"] = float(np.abs(scores[1:] - scores[0]).mean()) if len(runs) > 1 else 0.0
        summary[name] = entry
    for r in runs:
        for name in PIPELINES:
            del r["pipelines"][name]["scores"]
    result = {"threads": args.threads, "seed": 42, "hyperparameters_from": "artifacts/tuning.json of the seeding training run",
              "runs": runs, "summary": summary,
              "reading": "Same data, split, hyperparameters, seed and library versions; only the thread count differs. "
                         "The range is the numerical noise floor of results that depend on a tuned XGBoost fit."}
    out = WORK / "artifacts" / "numerical_variability.json"
    out.write_text(json.dumps(result, indent=2))
    print(f"wrote {out.name}")


if __name__ == "__main__":
    main()
