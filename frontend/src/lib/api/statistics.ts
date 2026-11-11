import { httpGet } from "@/lib/http";
import type { Evidence } from "@/components/evidence";

export interface Provenance {
  status: Evidence;
  run_id: string;
  experiment: string;
  source: string;
  computed_from: string;
  note: string | null;
}

export interface Metrics {
  threshold: number;
  recall: number;
  precision: number;
  f1: number;
  accuracy: number;
  auc: number;
  pr_auc: number;
  gmean: number;
  mcc: number;
  specificity: number;
  confusion_matrix: { tn: number; fp: number; fn: number; tp: number };
  support: { class_0: number; class_1: number };
}

export interface PipelineRow {
  pipeline: string;
  label: string;
  threshold: number;
  served: boolean;
  tuned: boolean | null;
  preprocessing: string | null;
  treatment: string | null;
  metrics: Metrics;
  cost: { training_time: number | null; inference_ms_per_customer: number | null; model_size_mb: number | null };
  validation_pr_auc: number | null;
  recorded_metrics: Record<string, number | null>;
}

export interface Pipelines {
  run: string;
  split: string;
  customers: number;
  theft: number;
  pipelines: PipelineRow[];
  provenance: Provenance;
  cost_note: string;
  rounding_note: string;
}

export interface Curve {
  pipeline: string;
  label: string;
  roc: { fpr: number[]; tpr: number[]; auc: number };
  pr: { recall: number[]; precision: number[]; average_precision: number; no_skill: number };
  operating_point: { threshold: number; recall: number; precision: number; false_positive_rate: number };
}

export interface Curves {
  run: string;
  split: string;
  base_rate: number;
  curves: Curve[];
  provenance: Provenance;
}

export interface ReliabilityBin {
  low: number;
  high: number;
  count: number;
  mean_predicted: number;
  observed_rate: number;
}

export interface CalibrationSide {
  brier: number;
  log_loss: number;
  ece: number;
  ece_equal_mass: number;
  mean_predicted: number;
  observed_rate: number;
  reliability: ReliabilityBin[];
  reliability_equal_mass: ReliabilityBin[];
}

export interface Calibration {
  run: string;
  split: string;
  pipeline: string;
  bins: number;
  raw: CalibrationSide;
  calibrated: CalibrationSide;
  recorded: { raw: Record<string, number> | null; platt: Record<string, number> | null; isotonic: Record<string, number> | null } | null;
  provenance: Provenance;
  reading: string;
}

export interface RankedRow {
  k: number;
  share: number;
  found: number;
  precision: number;
  recall: number;
  lift: number;
}

export interface Ranked {
  run: string;
  split: string;
  pipelines: Array<{ pipeline: string; label: string; rows: RankedRow[]; map_at_100: number; map_at_200: number; base_rate: number; customers: number; theft: number }>;
  provenance: Provenance;
}

export interface MetricInterval {
  value: number;
  ci_low: number;
  ci_high: number;
}

export interface ComparisonMetric {
  difference: number;
  ci_low: number;
  ci_high: number;
  p_value: number;
  p_holm: number;
}

export interface Significance {
  reference: string;
  resamples: number;
  seed: number;
  alpha: number;
  metrics: string[];
  customers: number;
  theft: number;
  comparisons_per_metric: number;
  pipelines: Record<string, Record<string, MetricInterval>>;
  comparisons: Record<string, Record<string, ComparisonMetric> & { mcnemar: { only_reference_right: number; only_other_right: number; p_value: number; p_holm: number } }>;
  labels: Record<string, string>;
  recomputation_check: { artifact: string; max_abs_difference: number | null; agrees: boolean } | null;
  provenance: Provenance;
  method: Record<string, string>;
}

export interface StabilitySection {
  title: string;
  artifact: string;
  kind: string;
  rows: Array<{ pipeline: string; mean?: number; sd?: number; pooled?: number; min?: number; max?: number; range?: number; trees?: number[]; per_seed?: Record<string, number> }>;
  caveat: string;
  seeds?: number[];
  wins?: Record<string, number>;
  weights?: Record<string, number>;
  folds?: number;
  threads?: number[];
  ranked_first?: Record<string, number>;
}

export interface Limitation {
  id: string;
  title: string;
  detail: string;
  mitigation: string;
  evidence?: string;
}

export interface StatRun {
  run_id: string;
  experiment_id: string;
  state: string;
  finished_at: string | null;
  evidence: Evidence;
  label: string;
}

export interface StatCompare {
  a: { run: string; customers: number; theft: number; customer_ids_sha256: string; evidence: Evidence };
  b: { run: string; customers: number; theft: number; customer_ids_sha256: string; evidence: Evidence };
  split: string;
  same_customers: boolean;
  pipelines: Array<{ pipeline: string; label: string; metrics: Record<string, { a: number | null; b: number | null; difference: number | null }>; threshold: { a: number | null; b: number | null } }>;
  note: string;
  provenance: Provenance;
}

type Q = { run?: string; split?: string };

export const getStatRuns = () => httpGet<StatRun[]>("/statistics/runs");
export const getStatPipelines = (q: Q) => httpGet<Pipelines>("/statistics/pipelines", q);
export const getStatCalibration = (q: Q & { name: string; bins?: number }) => httpGet<Calibration>("/statistics/calibration", q);
export const getStatRanked = (q: Q) => httpGet<Ranked>("/statistics/ranked", q);
export const getStatSignificance = (q: Q & { reference: string; resamples: number; seed?: number }) =>
  httpGet<Significance>("/statistics/significance", q);
export const getStatStability = (q: { run?: string }) => httpGet<{ run: string; sections: StabilitySection[] }>("/statistics/stability", q);
export const getStatLimitations = (q: { run?: string }) => httpGet<{ run: string; limitations: Limitation[] }>("/statistics/limitations", q);
export const getStatCompare = (q: { a: string; b: string; split?: string }) => httpGet<StatCompare>("/statistics/compare", q);

/** Curves for a set of pipelines (the names repeat as a query parameter). */
export async function getCurvesFor(run: string, split: string, names: string[]): Promise<Curves> {
  const search = new URLSearchParams({ run, split });
  names.forEach((n) => search.append("names", n));
  return httpGet<Curves>(`/statistics/curves?${search.toString()}`);
}

export const METRIC_LABELS: Record<string, string> = {
  pr_auc: "PR-AUC",
  auc: "ROC-AUC",
  recall: "Recall",
  precision: "Precision",
  f1: "F1",
  mcc: "MCC",
  gmean: "G-Mean",
  accuracy: "Accuracy",
  specificity: "Specificity",
};
