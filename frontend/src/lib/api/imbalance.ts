import { httpGet } from "@/lib/http";
import type { Provenance } from "@/lib/api/statistics";

export interface Diagnostics {
  rows: number;
  theft_share: number;
  silhouette: number;
  fisher_ratio_mean: number;
  fisher_ratio_max: number;
  boundary_noise: number;
  boundary_noise_theft: number;
}

export interface PipelineRow {
  pipeline: string;
  label: string;
  treatment: string;
  served: boolean;
  threshold: number | null;
  accuracy: number | null;
  recall: number | null;
  precision: number | null;
  pr_auc: number | null;
  mcc: number | null;
  thefts_found: number | null;
  thefts_missed: number | null;
}

export interface Overview {
  customers: number;
  theft: number;
  honest: number;
  base_rate: number;
  imbalance_ratio: number;
  never_flag_anyone: {
    accuracy: number;
    recall: number;
    precision: number | null;
    thefts_found: number;
    thefts_missed: number;
  };
  pipelines: PipelineRow[];
  test_customers: number | null;
  test_theft: number | null;
  provenance: Provenance;
  reading: string;
}

export interface TreatmentCounts {
  before: { honest: number; theft: number };
  after_smote: { honest: number; theft: number };
  after: { honest: number; theft: number };
  synthetic_created: number;
  synthetic_removed_by_enn: number;
  honest_removed_by_enn: number;
  theft_removed_by_enn: number;
}

export interface Stage {
  stage: string;
  label: string;
  diagnostics: Diagnostics;
  note: string;
}

export interface TreatmentEffect {
  config: Record<string, number>;
  counts: TreatmentCounts;
  stages: Stage[];
  provenance: Provenance;
  reading: string;
  caveat: string;
}

export interface Variant {
  name: string;
  treatment: string;
  config: Record<string, number>;
  pr_auc: number | null;
  pr_auc_sd: number | null;
  roc_auc: number | null;
  roc_auc_sd: number | null;
  folds: number[];
  training_rows: number | null;
  training_theft_share: number | null;
  seconds: number | null;
  proposed: boolean;
}

export interface Sensitivity {
  customers: number | null;
  base_rate: number | null;
  folds: number | null;
  hyperparameters: string | Record<string, unknown>;
  variants: Variant[];
  baseline: Variant | null;
  best: Variant | null;
  proposed: Variant | null;
  provenance: Provenance;
  reading: string;
}

export interface Comparison {
  difference: number;
  ci_low: number;
  ci_high: number;
  p_value: number;
  p_holm: number;
  significant: boolean;
}

export interface FairTest {
  pipeline: string | null;
  label: string | null;
  threshold: number | null;
  validation_pr_auc: number | null;
  metrics: Record<string, number | { tn: number; fp: number; fn: number; tp: number }>;
  training_time: number | null;
  tuning: {
    trials: number;
    trial_scores: number[];
    fold_scores: number[];
    cv_best_score: number | null;
    seconds: number | null;
    params: Record<string, unknown>;
  };
  reference: string | null;
  resamples: number | null;
  comparisons: Record<string, Record<string, Comparison>>;
  provenance: Provenance;
  reading: string;
}

export interface TryResult {
  kind: string;
  label: string;
  config: { sampling_strategy: number; smote_k_neighbors: number; enn_n_neighbors: number };
  sample: { customers: number; theft: number; requested: number; used: number };
  counts: Partial<TreatmentCounts> & { before: { honest: number; theft: number }; after: { honest: number; theft: number } };
  diagnostics: { before: Diagnostics; after: Diagnostics };
  features: Array<{ feature: string; label: string; fisher_ratio: number }>;
  feature: {
    feature: string;
    label: string;
    edges: number[];
    before: number[];
    after: number[];
    before_rows: number;
    after_rows: number;
  };
  provenance: Provenance;
  caveat: string;
}

export const getImbalanceOverview = () => httpGet<Overview>("/imbalance/overview");
export const getTreatmentEffect = () => httpGet<TreatmentEffect>("/imbalance/treatment");
export const getSensitivity = () => httpGet<Sensitivity>("/imbalance/sensitivity");
export const getFairTest = () => httpGet<FairTest>("/imbalance/fair-test");
export const getTreatments = () => httpGet<Array<{ kind: string; label: string }>>("/imbalance/treatments");
export const tryTreatment = (q: {
  kind: string; sampling_strategy: number; smote_k_neighbors: number; enn_n_neighbors: number;
  sample: number; feature?: string;
}) => httpGet<TryResult>("/imbalance/try", q);
