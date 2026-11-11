"""
Write docs/reproduction-report.md from the sealed runs.

    python scripts/reproduction_report.py

Every number in the report is read from the findings ledger, the conclusion checks and the sealed
runs' files at the moment the script runs; nothing is typed in. Rerun it after any new run.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.registry import conclusions, findings, store  # noqa: E402
from src.registry.runner import latest_sealed_run, reported_run  # noqa: E402

OUT = ROOT / "docs" / "reproduction-report.md"
PIPELINES = [("proposed", "SMOTE+ENN + XGBoost (proposed)"), ("xgboost", "XGBoost, no resampling"),
             ("xgboost_default", "XGBoost, default settings"), ("random_forest_smote", "Random forest + SMOTE"),
             ("logistic_regression_smote", "Logistic regression + SMOTE"), ("wide_deep_cnn", "Wide & Deep CNN"),
             ("hybrid", "Hybrid: CNN + XGBoost")]
METRICS = [("auc", "ROC-AUC"), ("pr_auc", "PR-AUC"), ("recall", "Recall"), ("precision", "Precision"), ("f1", "F1"), ("mcc", "MCC")]


def load(run_id: str, relative: str):
    path = store.workspace(run_id) / relative
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def describe(detail: dict) -> str:
    if "unavailable" in detail:
        return "not available"
    if "p" in detail:
        p = "< 0.001" if detail["p"] < 0.001 else f"{detail['p']:.3f}"
        return f"{detail['difference']:+.3f} (95% CI {detail['ci_low']:+.3f} to {detail['ci_high']:+.3f}; Holm p {p})"
    if "values" in detail:
        return " → ".join(f"{v:.3f}" for v in detail["values"])
    if "expected" in detail:
        return f"{detail['value']} (expected {detail['expected']})"
    if "best" in detail:
        return f"best is {detail['best']} ({detail['value']:.3f}); next {detail['runner_up']} ({detail['runner_up_value']:.3f})"
    return f"{detail['a']:.3f} against {detail['b']:.3f} ({detail['difference']:+.3f})"


def main() -> None:
    rows = findings.ledger()
    summary = findings.summary(rows)
    checks = conclusions.evaluate()
    reported = reported_run()
    train = latest_sealed_run("train.full")
    runs = [r for r in store.list_runs() if store.is_sealed(r["run_id"])]
    lines = []
    add = lines.append

    add("# Reproduction report")
    add("")
    add(f"Generated {datetime.now(timezone.utc).isoformat(timespec='seconds')} by `scripts/reproduction_report.py` from the sealed runs "
        "in `runs/`. Every number below is read from those runs; none is typed in.")
    add("")
    add("## What was done")
    add("")
    add(f"The results published with the original study (repository `sgcc`, commit `081e814`) were imported unchanged as the "
        f"**reported** record (`{reported['run_id']}`). Every experiment of the study was then rerun on this machine from the "
        "registered dataset, each in its own workspace, and sealed with SHA-256 hashes. The reruns use the original code, "
        "configuration, seeds and library versions. They do not use the original hardware.")
    add("")
    if train:
        env = train.get("environment", {})
        libs = env.get("libraries", {})
        add(f"- Dataset: `{train['dataset']['file']}`, SHA-256 `{train['dataset']['sha256']}` "
            f"({'the registered release' if train['dataset'].get('matches_registered') else 'NOT the registered release'}).")
        add(f"- Rerun environment: Python {env.get('python')}, {env.get('processor')}, {env.get('threads')} threads of {env.get('cpu_count')}; "
            + ", ".join(f"{k} {v}" for k, v in libs.items() if v) + ".")
        original = (load(reported["run_id"], "artifacts/pipeline.json") or {}).get("provenance", {}).get("libraries", {})
        add("- Original environment as recorded by the study: " + ", ".join(f"{k} {v}" for k, v in original.items())
            + ". The study does not record its PyTorch version in the training run; its CNN baseline record names "
            + str((load(reported["run_id"], "artifacts/deep_baseline.json") or {}).get("training", {}).get("torch")) + ".")
    add("")
    add("## Sealed runs")
    add("")
    add("| Run | Experiment | State | Runtime (s) | Eligible to verify | Seal intact |")
    add("|---|---|---|---|---|---|")
    for r in sorted(runs, key=lambda r: r["created_at"]):
        add(f"| `{r['run_id']}` | {r['experiment_id']} | {r['state']} | {r.get('runtime_seconds') or ''} | "
            f"{'yes' if r.get('eligible_to_verify') else 'no'} | {'yes' if not store.verify(r['run_id']) else 'NO'} |")
    add("")
    add("## Findings ledger")
    add("")
    add(f"`registry/findings.yaml` lists {summary['findings']} numbers the study reports, each with a tolerance written before any "
        "rerun finished. All of them agree with the study's own published result files"
        + (" except: " + ", ".join(summary["document_differs_from_reported_artifact"]) if summary["document_differs_from_reported_artifact"] else "")
        + ".")
    add("")
    add(f"- **Verified: {summary['verified']}** ({summary['verified_exactly']} to the reported digit).")
    add(f"- **Discrepant: {summary['discrepant']}** (outside the predeclared tolerance).")
    add(f"- Not rerun: {summary['reported']}.")
    add("")
    by_class = {}
    for row in rows:
        entry = by_class.setdefault(row["class"], {"verified": 0, "discrepant": 0, "reported": 0})
        entry[row["status"]] += 1
    add("| Class of finding | Verified | Discrepant | Not rerun |")
    add("|---|---|---|---|")
    for name, entry in sorted(by_class.items()):
        add(f"| {name} | {entry['verified']} | {entry['discrepant']} | {entry['reported']} |")
    add("")

    if train:
        new = load(train["run_id"], "models/baselines/comparison_results.json")
        old = load(reported["run_id"], "models/baselines/comparison_results.json")
        add("## The comparison table, reported and rerun")
        add("")
        add(f"Test customers of the study's split. Reported / rerun (`{train['run_id']}`).")
        add("")
        add("| Pipeline | " + " | ".join(label for _, label in METRICS) + " | Threshold |")
        add("|---|" + "---|" * (len(METRICS) + 1))
        for name, label in PIPELINES:
            if name not in new or name not in old:
                continue
            cells = [f"{old[name][m]:.3f} / {new[name][m]:.3f}" for m, _ in METRICS]
            add(f"| {label} | " + " | ".join(cells) + f" | {old[name]['threshold']:.3f} / {new[name]['threshold']:.3f} |")
        add("")
        add(f"Hybrid weight on the CNN: reported {old['hybrid'].get('weight_sequence')}, rerun {new['hybrid'].get('weight_sequence')}.")
        add("")

    add("## Why the digits differ")
    add("")
    exact_groups = sorted({r["id"] for r in rows if r["latest"] and r["latest"]["outcome"] == "exact" and r["experiment"] == "train.full"})
    add("What reproduces to the reported digit in the training run: " + ", ".join(f"`{i}`" for i in exact_groups[:60]) + ".")
    add("")
    add("Customers, labels, the split, both feature matrices, the SMOTE and ENN row counts and separability diagnostics, the "
        "untuned XGBoost and the random forest are identical to the reported record. The differences begin where a model is "
        "*tuned* or is a neural network:")
    add("")
    if train:
        t_new, t_old = load(train["run_id"], "artifacts/tuning.json"), load(reported["run_id"], "artifacts/tuning.json")
        for name in ("xgboost", "proposed"):
            differing = sum(1 for a, b in zip(t_old[name]["trials"], t_new[name]["trials"]) if abs(a - b) > 1e-9)
            add(f"- `{name}`: {differing} of {len(t_old[name]['trials'])} Optuna trials have a different cross-validated score "
                f"(first trial {t_old[name]['trials'][0]:.4f} reported, {t_new[name]['trials'][0]:.4f} rerun); "
                f"best CV score {t_old[name]['cv_best_score']:.4f} reported, {t_new[name]['cv_best_score']:.4f} rerun; "
                f"the chosen hyperparameters {'are the same' if t_old[name]['params'] == t_new[name]['params'] else 'differ'}.")
    noise_run = latest_sealed_run("numerics.threads")
    noise = noise_run and load(noise_run["run_id"], "artifacts/numerical_variability.json")
    if noise:
        add("")
        add(f"The experiment `numerics.threads` (`{noise_run['run_id']}`, exploratory) isolates the cause. It refits both tuned pipelines "
            f"with identical data, split, hyperparameters, seed and library versions at {noise['threads']} CPU threads:")
        add("")
        add("| Pipeline | Test PR-AUC min | max | range | SD | Trees kept by early stopping | Largest change in one customer's score |")
        add("|---|---|---|---|---|---|---|")
        for name, entry in noise["summary"].items():
            m = entry["test_pr_auc"]
            add(f"| {name} | {m['min']:.4f} | {m['max']:.4f} | {m['range']:.4f} | {m['sd']:.4f} | {entry['best_iteration']} | {entry['max_abs_score_difference']:.3f} |")
        add("")
        add("So the thread count alone moves test PR-AUC by the range shown. Histogram-based tree building sums gradients in an "
            "order that depends on how rows are divided among threads; with deep trees, a minimum-loss threshold and early stopping, "
            "a difference in the last floating-point digit changes one split and then every tree after it. Optuna then follows a "
            "different search path. No reported difference between two pipelines that is smaller than this range should be read "
            "as a difference.")
    add("")
    add("The tolerance for the tuned models (0.002) was declared on the assumption that seeded tree models reproduce exactly. "
        "That assumption was wrong. The tolerance has not been changed after the fact; the affected findings stay **discrepant**, "
        "and the conclusion checks below ask the coarser question instead.")
    add("")

    add("## Do the study's conclusions hold?")
    add("")
    s = checks["summary"]
    add(f"**Post hoc.** `registry/conclusions.yaml` was written {checks['written']}. Each check is mechanical and is applied the same "
        f"way to the reported record and to the newest eligible rerun (α = {checks['alpha']}).")
    add("")
    add(f"- Hold in the rerun: **{s['holds']}** of {s['conclusions']}.")
    add(f"- Do not hold: **{s['does_not_hold']}**.")
    add(f"- Not rerun: {s['not_rerun']}.")
    add("")
    add("### Conclusions that do not hold in the rerun")
    add("")
    for c in checks["conclusions"]:
        if c["outcome"] == "does_not_hold":
            add(f"- **{c['id']}. {c['statement']}**")
            add(f"  - Reported record: {describe(c['reported']['detail'])}.")
            add(f"  - Rerun (`{c['rerun_run_id']}`): {describe(c['rerun']['detail'])}.")
    add("")
    add("### Conclusions that hold")
    add("")
    add("| | Conclusion | Reported record | Rerun |")
    add("|---|---|---|---|")
    for c in checks["conclusions"]:
        if c["outcome"] == "holds":
            add(f"| {c['id']} | {c['statement']} | {describe(c['reported']['detail'])} | {describe(c['rerun']['detail'])} |")
    add("")

    add("## Discrepant findings")
    add("")
    add("| Finding | Reported | Rerun | Difference | Tolerance | Run |")
    add("|---|---|---|---|---|---|")
    for row in rows:
        if row["status"] == "discrepant":
            latest = row["latest"]
            add(f"| `{row['id']}` {row['claim']} | {row['reported']} | {latest['observed']:.4f} | {latest['difference']:+.4f} | ±{row['tolerance']} | `{latest['run_id']}` |")
    add("")
    add("## What this report does not establish")
    add("")
    add("- One rerun on one machine. A second rerun would differ from this one by the same numerical noise.")
    add("- Timings were not compared: they depend on the hardware.")
    add("- The reruns reuse the study's split, so they inherit its limits: one dataset, random customer split, no later period, "
        "no second utility, noisy labels.")
    add("- The conclusion checks were chosen after the rerun was seen.")
    add("")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
