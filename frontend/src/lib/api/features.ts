import { httpGet } from "@/lib/http";
import type { Provenance } from "@/lib/api/statistics";

export interface CatalogFeature {
  feature: string;
  label: string;
  group: string;
  core: boolean;
  importance: number;
  share: number;
  rank: number;
}

export interface FeatureGroup {
  group: string;
  features: number;
  importance: number;
  share: number;
  strongest: string | null;
}

export interface Catalog {
  features: CatalogFeature[];
  groups: FeatureGroup[];
  total_features: number;
  core_features: number;
  provenance: Provenance;
  reading: string;
}

export interface AblationVariant {
  name: string;
  features: number | null;
  treatment: string | null;
  pr_auc: number | null;
  pr_auc_sd: number | null;
  roc_auc: number | null;
  roc_auc_sd: number | null;
  folds: number[];
}

export interface Ablation {
  customers: number | null;
  base_rate: number | null;
  variants: AblationVariant[];
  best: AblationVariant | null;
  core_only: AblationVariant | null;
  all_features: AblationVariant | null;
  extra_features_buy: number | null;
  provenance: Provenance;
  reading: string;
}

export interface HistoryWindow {
  months: number | null;
  days: number | null;
  features: number | null;
  first_day: string | null;
  pr_auc: number | null;
  auc: number | null;
  recall: number | null;
  precision: number | null;
  mcc: number | null;
  validation_pr_auc: number | null;
}

export interface HistoryLength {
  windows: HistoryWindow[];
  full: HistoryWindow | null;
  within_5_percent: HistoryWindow | null;
  end: string | null;
  pipeline: string | null;
  test_customers: number | null;
  base_rate: number | null;
  provenance: Provenance;
  reading: string;
}

export interface ClassSummary {
  rows: number;
  median: number | null;
  mean: number | null;
  p10: number | null;
  p90: number | null;
}

export interface FeatureDistribution {
  feature: string;
  label: string;
  group: string;
  core: boolean;
  importance: number | null;
  edges: number[];
  honest: number[];
  theft: number[];
  summary: Record<"honest" | "theft", ClassSummary>;
  missing_values: number;
  fisher_ratio: number;
  provenance: Provenance;
  caveat: string;
}

export const getCatalog = () => httpGet<Catalog>("/observatory/features/catalog");
export const getAblation = () => httpGet<Ablation>("/observatory/features/ablation");
export const getHistoryLength = () => httpGet<HistoryLength>("/observatory/features/history-length");
export const getFeatureNames = () =>
  httpGet<Array<{ feature: string; label: string; group: string; rank: number }>>("/observatory/features/names");
export const getFeatureDistribution = (q: { feature: string; bins?: number }) =>
  httpGet<FeatureDistribution>("/observatory/features/distribution", q);
