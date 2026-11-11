# Reproduction report

Generated 2026-11-11T01:59:51+00:00 by `scripts/reproduction_report.py` from the sealed runs in `runs/`. Every number below is read from those runs; none is typed in.

## What was done

The results published with the original study (repository `sgcc`, commit `081e814`) were imported unchanged as the **reported** record (`run-reported-sgcc-081e814`). Every experiment of the study was then rerun on this machine from the registered dataset, each in its own workspace, and sealed with SHA-256 hashes. The reruns use the original code, configuration, seeds and library versions. They do not use the original hardware.

- Dataset: `sgcc_full.csv`, SHA-256 `99f8fd315626b1f729a9a03a97cb52ed097ab4d43e5771e21554c9e0c369b9b7` (the registered release).
- Rerun environment: Python 3.11.15, Intel64 Family 6 Model 158 Stepping 10, GenuineIntel, 4 threads of 12; numpy 2.3.5, pandas 2.2.3, scipy 1.16.3, scikit-learn 1.8.0, imbalanced-learn 0.14.1, xgboost 3.2.0, optuna 4.6.0, torch 2.14.0+cpu, onnx 1.23.2, onnxruntime 1.30.0, shap 0.50.0, lime 0.2.0.1.
- Original environment as recorded by the study: python 3.11.15, xgboost 3.2.0, scikit-learn 1.8.0, imbalanced-learn 0.14.1, numpy 2.3.5, pandas 2.2.3, scipy 1.16.3, optuna 4.6.0. The study does not record its PyTorch version in the training run; its CNN baseline record names 2.14.0+cu130.

## Sealed runs

| Run | Experiment | State | Runtime (s) | Eligible to verify | Seal intact |
|---|---|---|---|---|---|
| `run-reported-sgcc-081e814` | reported.baseline | reported |  | no | yes |
| `run-20261110T114728-data-quality-a24e82` | data.quality | succeeded | 123.2 | yes | yes |
| `run-20261110T114728-train-full-a31409` | train.full | succeeded | 3742.2 | yes | yes |
| `run-20261110T125206-ablation-components-58de47` | ablation.components | succeeded | 474.7 | yes | yes |
| `run-20261110T125206-deep-baseline-ce9f81` | deep.baseline | succeeded | 888.8 | yes | yes |
| `run-20261110T125206-history-length-cb3b59` | history.length | succeeded | 178.2 | yes | yes |
| `run-20261110T125206-resampling-study-a3f41c` | resampling.study | succeeded | 1955.2 | yes | yes |
| `run-20261110T125206-stats-significance-2f4a3c` | stats.significance | succeeded | 44.5 | yes | yes |
| `run-20261110T135111-cnn-checks-7a6156` | cnn.checks | succeeded | 5119.2 | yes | yes |
| `run-20261110T135111-hybrid-splits-d13553` | hybrid.splits | succeeded | 3878.1 | yes | yes |
| `run-20261110T135111-nested-cv-d3a9f8` | nested.cv | succeeded | 8351.3 | yes | yes |
| `run-20261110T135111-robustness-splits-8eb888` | robustness.splits | succeeded | 856.0 | yes | yes |
| `run-20261110T135111-stats-literature-cc8100` | stats.literature | succeeded | 57.0 | yes | yes |
| `run-20261110T190159-deep-baseline-splits-18110f` | deep.baseline_splits | succeeded | 3136.6 | yes | yes |
| `run-20261110T190159-hybrid-significance-5e7dec` | hybrid.significance | succeeded | 33.0 | yes | yes |
| `run-20261110T190159-numerics-threads-073170` | numerics.threads | succeeded | 371.9 | no | yes |

## Findings ledger

`registry/findings.yaml` lists 133 numbers the study reports, each with a tolerance written before any rerun finished. All of them agree with the study's own published result files.

- **Verified: 85** (41 to the reported digit).
- **Discrepant: 48** (outside the predeclared tolerance).
- Not rerun: 0.

| Class of finding | Verified | Discrepant | Not rerun |
|---|---|---|---|
| count | 15 | 0 | 0 |
| deterministic | 46 | 41 | 0 |
| stochastic | 18 | 6 | 0 |
| stochastic_ranking | 6 | 1 | 0 |

## The comparison table, reported and rerun

Test customers of the study's split. Reported / rerun (`run-20261110T114728-train-full-a31409`).

| Pipeline | ROC-AUC | PR-AUC | Recall | Precision | F1 | MCC | Threshold |
|---|---|---|---|---|---|---|---|
| SMOTE+ENN + XGBoost (proposed) | 0.828 / 0.836 | 0.462 / 0.467 | 0.494 / 0.452 | 0.389 / 0.438 | 0.435 / 0.445 | 0.379 / 0.392 | 0.197 / 0.230 |
| XGBoost, no resampling | 0.850 / 0.853 | 0.513 / 0.514 | 0.467 / 0.443 | 0.487 / 0.505 | 0.476 / 0.472 | 0.429 / 0.427 | 0.243 / 0.255 |
| XGBoost, default settings | 0.839 / 0.839 | 0.488 / 0.488 | 0.483 / 0.483 | 0.439 / 0.439 | 0.460 / 0.460 | 0.408 / 0.408 | 0.204 / 0.204 |
| Random forest + SMOTE | 0.812 / 0.812 | 0.411 / 0.411 | 0.432 / 0.432 | 0.366 / 0.366 | 0.396 / 0.396 | 0.336 / 0.336 | 0.216 / 0.216 |
| Logistic regression + SMOTE | 0.754 / 0.753 | 0.314 / 0.311 | 0.371 / 0.373 | 0.318 / 0.319 | 0.342 / 0.344 | 0.277 / 0.278 | 0.154 / 0.154 |
| Wide & Deep CNN | 0.880 / 0.877 | 0.538 / 0.571 | 0.520 / 0.513 | 0.516 / 0.555 | 0.518 / 0.533 | 0.473 / 0.492 | 0.228 / 0.245 |
| Hybrid: CNN + XGBoost | 0.908 / 0.909 | 0.617 / 0.639 | 0.611 / 0.506 | 0.525 / 0.677 | 0.564 / 0.579 | 0.522 / 0.552 | 0.216 / 0.330 |

Hybrid weight on the CNN: reported 0.55, rerun 0.6.

## Why the digits differ

What reproduces to the reported digit in the training run: `F-brier-proposed-platt`, `F-enn-honest-removed`, `F-features`, `F-fisher-after`, `F-fisher-before`, `F-noise-after`, `F-noise-before`, `F-smote-synthetic`, `F-split-test`, `F-split-train`, `F-split-validation`, `T1-random_forest_smote-auc`, `T1-random_forest_smote-f1`, `T1-random_forest_smote-gmean`, `T1-random_forest_smote-mcc`, `T1-random_forest_smote-pr_auc`, `T1-random_forest_smote-precision`, `T1-random_forest_smote-recall`, `T1-xgboost_default-auc`, `T1-xgboost_default-f1`, `T1-xgboost_default-gmean`, `T1-xgboost_default-mcc`, `T1-xgboost_default-pr_auc`, `T1-xgboost_default-precision`, `T1-xgboost_default-recall`.

Customers, labels, the split, both feature matrices, the SMOTE and ENN row counts and separability diagnostics, the untuned XGBoost and the random forest are identical to the reported record. The differences begin where a model is *tuned* or is a neural network:

- `xgboost`: 40 of 40 Optuna trials have a different cross-validated score (first trial 0.4456 reported, 0.4448 rerun); best CV score 0.5047 reported, 0.5035 rerun; the chosen hyperparameters differ.
- `proposed`: 40 of 40 Optuna trials have a different cross-validated score (first trial 0.4401 reported, 0.4345 rerun); best CV score 0.4573 reported, 0.4520 rerun; the chosen hyperparameters differ.

The experiment `numerics.threads` (`run-20261110T190159-numerics-threads-073170`, exploratory) isolates the cause. It refits both tuned pipelines with identical data, split, hyperparameters, seed and library versions at [1, 2, 4, 8, 12] CPU threads:

| Pipeline | Test PR-AUC min | max | range | SD | Trees kept by early stopping | Largest change in one customer's score |
|---|---|---|---|---|---|---|
| xgboost | 0.5098 | 0.5178 | 0.0080 | 0.0029 | [385, 398, 316, 400, 393] | 0.199 |
| proposed | 0.4651 | 0.4742 | 0.0091 | 0.0034 | [446, 445, 283, 403, 447] | 0.310 |

So the thread count alone moves test PR-AUC by the range shown. Histogram-based tree building sums gradients in an order that depends on how rows are divided among threads; with deep trees, a minimum-loss threshold and early stopping, a difference in the last floating-point digit changes one split and then every tree after it. Optuna then follows a different search path. No reported difference between two pipelines that is smaller than this range should be read as a difference.

The tolerance for the tuned models (0.002) was declared on the assumption that seeded tree models reproduce exactly. That assumption was wrong. The tolerance has not been changed after the fact; the affected findings stay **discrepant**, and the conclusion checks below ask the coarser question instead.

## Do the study's conclusions hold?

**Post hoc.** `registry/conclusions.yaml` was written 2026-11-10, after the first rerun had been seen. Each check is mechanical and is applied the same way to the reported record and to the newest eligible rerun (α = 0.05).

- Hold in the rerun: **19** of 22.
- Do not hold: **3**.
- Not rerun: 0.

### Conclusions that do not hold in the rerun

- **C06. SMOTE+ENN on raw readings, tuned like the others, is level with standard XGBoost (no significant PR-AUC difference), so the cleaning step, not the resampling, explains the proposed pipeline's deficit.**
  - Reported record: -0.009 (95% CI -0.026 to +0.008; Holm p 0.311).
  - Rerun (`run-20261110T125206-resampling-study-a3f41c`): -0.034 (95% CI -0.053 to -0.014; Holm p 0.002).
- **C07. SMOTE+ENN on raw readings is significantly above the proposed pipeline on cleaned readings.**
  - Reported record: +0.042 (95% CI +0.022 to +0.063; Holm p < 0.001).
  - Rerun (`run-20261110T125206-resampling-study-a3f41c`): +0.013 (95% CI -0.008 to +0.035; Holm p 0.229).
- **C15. On the study's split alone, the CNN's PR-AUC advantage over standard XGBoost is not significant.**
  - Reported record: +0.025 (95% CI -0.017 to +0.068; Holm p 0.240).
  - Rerun (`run-20261110T125206-deep-baseline-ce9f81`): +0.057 (95% CI +0.015 to +0.100; Holm p 0.009).

### Conclusions that hold

| | Conclusion | Reported record | Rerun |
|---|---|---|---|
| C01 | The proposed pipeline (SMOTE+ENN + tuned XGBoost) has a significantly lower test PR-AUC than standard tuned XGBoost. | -0.051 (95% CI -0.076 to -0.027; Holm p < 0.001) | -0.047 (95% CI -0.071 to -0.023; Holm p < 0.001) |
| C02 | The proposed pipeline's recall advantage over standard XGBoost is not significant. | +0.028 (95% CI -0.009 to +0.065; Holm p 0.307) | +0.009 (95% CI -0.024 to +0.042; Holm p 0.625) |
| C03 | Against untreated default XGBoost, the proposed pipeline's PR-AUC difference is not significant. | -0.026 (95% CI -0.054 to +0.002; Holm p 0.070) | -0.021 (95% CI -0.048 to +0.008; Holm p 0.144) |
| C04 | The proposed pipeline has a significantly higher PR-AUC than random forest + SMOTE. | +0.050 (95% CI +0.030 to +0.070; Holm p < 0.001) | +0.056 (95% CI +0.035 to +0.076; Holm p < 0.001) |
| C05 | The proposed pipeline has a significantly higher PR-AUC than logistic regression + SMOTE. | +0.148 (95% CI +0.114 to +0.180; Holm p < 0.001) | +0.155 (95% CI +0.121 to +0.188; Holm p < 0.001) |
| C08 | In cross-validation no resampling setting beats no resampling. | best is No resampling (0.507); next SMOTE 0.2 (0.496) | best is No resampling (0.503); next SMOTE 0.2 (0.497) |
| C09 | Standard XGBoost ranks first on PR-AUC among the study pipelines on all six random splits. | 6 (expected 6) | 6 (expected 6) |
| C10 | All 87 features beat the 25 core features in cross-validation. | 0.507 against 0.438 (+0.068) | 0.503 against 0.437 (+0.067) |
| C11 | Tuned hyperparameters beat XGBoost's defaults in cross-validation. | 0.507 against 0.460 (+0.046) | 0.503 against 0.460 (+0.043) |
| C12 | Cleaning the readings lowers cross-validated PR-AUC. | 0.507 against 0.492 (+0.014) | 0.503 against 0.491 (+0.012) |
| C13 | Adding ENN to SMOTE lowers cross-validated PR-AUC further. | 0.453 against 0.420 (+0.033) | 0.461 against 0.426 (+0.035) |
| C14 | Detection quality rises with the length of meter history. | 0.274 → 0.296 → 0.319 → 0.349 → 0.396 → 0.513 | 0.266 → 0.293 → 0.316 → 0.341 → 0.406 → 0.514 |
| C16 | The hybrid has a significantly higher test PR-AUC than standard XGBoost. | +0.104 (95% CI +0.078 to +0.129; Holm p < 0.001) | +0.125 (95% CI +0.098 to +0.153; Holm p < 0.001) |
| C17 | The hybrid has a significantly higher test PR-AUC than the CNN alone. | +0.078 (95% CI +0.057 to +0.100; Holm p < 0.001) | +0.068 (95% CI +0.048 to +0.088; Holm p < 0.001) |
| C18 | The hybrid has the higher PR-AUC than standard XGBoost on all six random splits. | 6 (expected 6) | 6 (expected 6) |
| C19 | In nested cross-validation the hybrid is best on all five outer folds. | 5 (expected 5) | 5 (expected 5) |
| C20 | Most of the CNN's performance comes from its missing-reading channel (removing it costs at least 0.15 PR-AUC). | 0.538 against 0.335 (+0.203) | 0.571 against 0.323 (+0.248) |
| C21 | With no missing-reading information in either part, the hybrid is still above XGBoost alone. | 0.433 against 0.404 (+0.029) | 0.436 against 0.403 (+0.033) |
| C22 | Consumption behaviour alone (no missing-reading features) still detects theft well above chance in cross-validation. | 0.400 against 0.085 (+0.314) | 0.391 against 0.085 (+0.306) |

## Discrepant findings

| Finding | Reported | Rerun | Difference | Tolerance | Run |
|---|---|---|---|---|---|
| `T1-proposed-auc` SMOTE+ENN + XGBoost (proposed): auc 0.828 | 0.828 | 0.8357 | +0.0077 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-proposed-pr_auc` SMOTE+ENN + XGBoost (proposed): pr_auc 0.462 | 0.462 | 0.4669 | +0.0049 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-proposed-recall` SMOTE+ENN + XGBoost (proposed): recall 0.494 | 0.494 | 0.4520 | -0.0420 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-proposed-precision` SMOTE+ENN + XGBoost (proposed): precision 0.389 | 0.389 | 0.4383 | +0.0493 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-proposed-f1` SMOTE+ENN + XGBoost (proposed): f1 0.435 | 0.435 | 0.4450 | +0.0100 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-proposed-mcc` SMOTE+ENN + XGBoost (proposed): mcc 0.379 | 0.379 | 0.3925 | +0.0135 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-proposed-gmean` SMOTE+ENN + XGBoost (proposed): gmean 0.677 | 0.677 | 0.6539 | -0.0231 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-xgboost-auc` XGBoost, no resampling: auc 0.85 | 0.85 | 0.8532 | +0.0032 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-xgboost-recall` XGBoost, no resampling: recall 0.467 | 0.467 | 0.4428 | -0.0242 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-xgboost-precision` XGBoost, no resampling: precision 0.487 | 0.487 | 0.5053 | +0.0183 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-xgboost-f1` XGBoost, no resampling: f1 0.476 | 0.476 | 0.4720 | -0.0040 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-xgboost-gmean` XGBoost, no resampling: gmean 0.667 | 0.667 | 0.6518 | -0.0152 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-logistic_regression_smote-pr_auc` Logistic regression + SMOTE: pr_auc 0.314 | 0.314 | 0.3115 | -0.0025 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `T1-wide_deep_cnn-pr_auc` Wide & Deep CNN: pr_auc 0.538 | 0.538 | 0.5713 | +0.0333 | ±0.03 | `run-20261110T114728-train-full-a31409` |
| `T1-hybrid-recall` Hybrid: CNN + XGBoost: recall 0.611 | 0.611 | 0.5055 | -0.1055 | ±0.06 | `run-20261110T114728-train-full-a31409` |
| `T1-hybrid-precision` Hybrid: CNN + XGBoost: precision 0.525 | 0.525 | 0.6765 | +0.1515 | ±0.06 | `run-20261110T114728-train-full-a31409` |
| `T2-B-pr_auc` B. Raw readings, all 87 features: pr_auc 0.507 | 0.507 | 0.5032 | -0.0038 | ±0.002 | `run-20261110T125206-ablation-components-58de47` |
| `T2-D-pr_auc` D. Cleaned + SMOTE: pr_auc 0.453 | 0.453 | 0.4606 | +0.0076 | ±0.002 | `run-20261110T125206-ablation-components-58de47` |
| `T2-E-pr_auc` E. Cleaned + SMOTE+ENN (proposed): pr_auc 0.42 | 0.42 | 0.4257 | +0.0057 | ±0.002 | `run-20261110T125206-ablation-components-58de47` |
| `F-hybrid-threshold` Served threshold 0.216 (calibrated probability) | 0.216 | 0.3301 | +0.1141 | ±0.08 | `run-20261110T114728-train-full-a31409` |
| `F-hybrid-tp` At its threshold the hybrid finds 331 of the 542 test thieves | 331 | 274.0000 | -57.0000 | ±33.0 | `run-20261110T114728-train-full-a31409` |
| `F-hybrid-fp` with 300 false alarms | 300 | 131.0000 | -169.0000 | ±120.0 | `run-20261110T114728-train-full-a31409` |
| `F-cv-proposed` Best cross-validated PR-AUC of the proposed pipeline in tuning (5 folds) | 0.457 | 0.4520 | -0.0050 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `F-ece-proposed-raw` Proposed pipeline, test ECE before calibration 0.093 | 0.093 | 0.0497 | -0.0433 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `F-brier-proposed-raw` Proposed pipeline, test Brier score before calibration 0.080 | 0.08 | 0.0688 | -0.0112 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `F-ece-xgboost-raw` Standard XGBoost, test ECE before calibration 0.010 | 0.01 | 0.0590 | +0.0490 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `F-ece-xgboost-platt` and 0.007 after | 0.007 | 0.0100 | +0.0030 | ±0.002 | `run-20261110T114728-train-full-a31409` |
| `F-sig-xgb-prauc` Proposed minus standard XGBoost, PR-AUC -0.051 | -0.051 | -0.0469 | +0.0041 | ±0.002 | `run-20261110T125206-stats-significance-2f4a3c` |
| `F-sig-xgb-prauc-lo` 95% interval lower bound -0.076 | -0.076 | -0.0710 | +0.0050 | ±0.002 | `run-20261110T125206-stats-significance-2f4a3c` |
| `F-sig-xgb-prauc-hi` 95% interval upper bound -0.027 | -0.027 | -0.0227 | +0.0043 | ±0.002 | `run-20261110T125206-stats-significance-2f4a3c` |
| `F-sig-xgb-recall` Proposed minus standard XGBoost, recall +0.028 (not significant) | 0.028 | 0.0092 | -0.0188 | ±0.002 | `run-20261110T125206-stats-significance-2f4a3c` |
| `F-sig-xgb-recall-p` Holm-adjusted p for that recall difference 0.31 | 0.31 | 0.6249 | +0.3149 | ±0.02 | `run-20261110T125206-stats-significance-2f4a3c` |
| `F-sig-default-prauc` Proposed minus default XGBoost, PR-AUC -0.026 | -0.026 | -0.0207 | +0.0053 | ±0.002 | `run-20261110T125206-stats-significance-2f4a3c` |
| `F-sig-default-p` Holm-adjusted p for that difference 0.07 | 0.07 | 0.1444 | +0.0744 | ±0.02 | `run-20261110T125206-stats-significance-2f4a3c` |
| `F-sig-rf-prauc` Proposed minus random forest + SMOTE, PR-AUC +0.050 | 0.05 | 0.0555 | +0.0055 | ±0.002 | `run-20261110T125206-stats-significance-2f4a3c` |
| `F-sig-lr-prauc` Proposed minus logistic regression + SMOTE, PR-AUC +0.148 | 0.148 | 0.1554 | +0.0074 | ±0.002 | `run-20261110T125206-stats-significance-2f4a3c` |
| `F-fair-prauc` SMOTE+ENN on raw readings, tuned: test PR-AUC 0.504 | 0.504 | 0.4801 | -0.0239 | ±0.002 | `run-20261110T125206-resampling-study-a3f41c` |
| `F-grid-none` Resampling grid, no resampling: CV PR-AUC 0.507 | 0.507 | 0.5032 | -0.0038 | ±0.002 | `run-20261110T125206-resampling-study-a3f41c` |
| `F-grid-smote-1` SMOTE at ratio 1.0: 0.445 | 0.445 | 0.4337 | -0.0113 | ±0.002 | `run-20261110T125206-resampling-study-a3f41c` |
| `F-grid-smoteenn-1` SMOTE+ENN at ratio 1.0: 0.411 | 0.411 | 0.4001 | -0.0109 | ±0.002 | `run-20261110T125206-resampling-study-a3f41c` |
| `F-miss-all` CV PR-AUC with all features 0.507 | 0.507 | 0.5032 | -0.0038 | ±0.002 | `run-20261110T135111-robustness-splits-8eb888` |
| `F-miss-without` 0.468 without the eight missing-reading features | 0.468 | 0.4562 | -0.0118 | ±0.002 | `run-20261110T135111-robustness-splits-8eb888` |
| `F-miss-behaviour` 0.400 from consumption behaviour alone | 0.4 | 0.3909 | -0.0091 | ±0.002 | `run-20261110T135111-robustness-splits-8eb888` |
| `F-miss-only` 0.333 from the missing-reading features alone | 0.333 | 0.3450 | +0.0120 | ±0.002 | `run-20261110T135111-robustness-splits-8eb888` |
| `F-history-3` Test PR-AUC with the last 3 months 0.274 | 0.274 | 0.2659 | -0.0081 | ±0.002 | `run-20261110T125206-history-length-cb3b59` |
| `F-history-12` 12 months 0.319 | 0.319 | 0.3158 | -0.0032 | ±0.002 | `run-20261110T125206-history-length-cb3b59` |
| `F-history-24` 24 months 0.396 | 0.396 | 0.4061 | +0.0101 | ±0.002 | `run-20261110T125206-history-length-cb3b59` |
| `F-cnn-prauc` Wide & Deep CNN, test PR-AUC 0.538 on the study's split | 0.538 | 0.5713 | +0.0333 | ±0.03 | `run-20261110T125206-deep-baseline-ce9f81` |

## What this report does not establish

- One rerun on one machine. A second rerun would differ from this one by the same numerical noise.
- Timings were not compared: they depend on the hardware.
- The reruns reuse the study's split, so they inherit its limits: one dataset, random customer split, no later period, no second utility, noisy labels.
- The conclusion checks were chosen after the rerun was seen.
