import { httpGet } from "@/lib/http";
import type { Provenance } from "@/lib/api/statistics";

export interface Epoch {
  epoch: number;
  train_loss: number;
  validation_pr_auc: number;
}

export interface NetworkInfo {
  pipeline: string;
  label: string;
  architecture: { wide?: string; deep?: string; parameters?: number };
  settings: Record<string, number>;
  parameters: number | null;
  training: {
    epochs_run: number | null;
    best_epoch: number | null;
    device: string | null;
    torch: string | null;
    seconds: number | null;
    patience: number | null;
    max_epochs: number | null;
  };
  history: Epoch[];
  cost: { training_time: number | null; inference_ms_per_customer: number | null; model_size_mb: number | null };
  validation_pr_auc: Record<string, number>;
  provenance: Provenance;
  reading: string;
}

export interface SeedRow {
  seed: string;
  pr_auc: number | null;
  auc: number | null;
  recall: number | null;
  precision: number | null;
  mcc: number | null;
  difference_from_xgboost: number | null;
}

export interface Comparison {
  difference: number;
  ci_low: number;
  ci_high: number;
  p_value: number;
  p_holm: number;
  significant: boolean;
}

export interface AgainstFeatures {
  seeds: string[];
  per_seed: SeedRow[];
  mean: Record<string, number>;
  sd: Record<string, number>;
  higher_than_xgboost: number | null;
  runs: number;
  note: string | null;
  bootstrap: { reference: string | null; resamples: number | null; comparisons: Record<string, Record<string, Comparison>> };
  provenance: Provenance;
  reading: string;
}

export interface HybridSeedRow {
  seed: string;
  weight_cnn: number | null;
  threshold: number | null;
  hybrid: number | null;
  xgboost: number | null;
  cnn: number | null;
}

export interface HybridStudy {
  seeds: string[];
  weights_grid: number[];
  per_seed: HybridSeedRow[];
  summary: Record<string, { mean: Record<string, number>; sd: Record<string, number> }>;
  higher_than: Record<string, number>;
  served: {
    weight_sequence: number | null;
    customers: number | null;
    theft: number | null;
    resamples: number | null;
    thresholds: Record<string, number>;
    confusion_matrix: Record<string, { tn: number; fp: number; fn: number; tp: number }>;
    comparisons: Record<string, Record<string, Comparison>>;
  };
  provenance: Provenance;
  reading: string;
}

export interface WeightSweep {
  points: Array<{ weight: number; pr_auc: number }>;
  best: { weight: number; pr_auc: number };
  served_weight: number | null;
  features_only: number;
  cnn_only: number;
  gain_over_best_part: number;
  customers: number;
  theft: number;
  provenance: Provenance;
  reading: string;
  caveat: string;
}

export interface LearningCurves {
  curves: Array<{
    pipeline: string;
    best_iteration: number | null;
    train_pr_auc: number[];
    validation_pr_auc: number[];
    final_gap: number | null;
  }>;
  provenance: Provenance;
  reading: string;
}

export const getNetwork = () => httpGet<NetworkInfo>("/deeplab/network");
export const getAgainstFeatures = () => httpGet<AgainstFeatures>("/deeplab/against-features");
export const getHybridStudy = () => httpGet<HybridStudy>("/deeplab/hybrid");
export const getWeightSweep = (q: { step?: number }) => httpGet<WeightSweep>("/deeplab/weight-sweep", q);
export const getLearningCurves = () => httpGet<LearningCurves>("/deeplab/learning-curves");
