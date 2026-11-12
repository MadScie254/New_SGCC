import { httpGet } from "@/lib/http";
import type { Provenance } from "@/lib/api/statistics";

export interface FeatureImportance {
  feature: string;
  label: string;
  group: string;
  core: boolean;
  missingness_feature: boolean;
  mean_abs_shap: number;
  mean_shap_theft: number;
  mean_shap_honest: number;
  value_median_theft: number | null;
  value_median_honest: number | null;
  direction: string;
}

export interface GlobalImportance {
  customers: number;
  theft: number;
  features: FeatureImportance[];
  missingness_share_of_attribution: number;
  provenance: Provenance;
  reading: string;
}

export interface BeeswarmFeature {
  feature: string;
  label: string;
  group: string;
  missingness_feature: boolean;
  points: Array<{ shap: number; normalised_value: number | null; label: number }>;
}

export interface Contribution {
  feature: string;
  label: string;
  group: string;
  value: number | null;
  shap_value: number;
  missingness_feature: boolean;
}

export interface CustomerExplanation {
  customer_id: string;
  split: string;
  label: number;
  probabilities: Record<string, number>;
  base_value: number;
  sum_of_contributions: number;
  logit: number;
  contributions: Contribution[];
  provenance: Provenance;
  caveat: string;
}

export interface WeekEffect {
  week: number;
  effect: number;
  start: string;
  end: string;
  missing_days: number;
  days: number;
  mean_kwh: number | null;
}

export interface WeekEffects {
  customer_id: string;
  available: boolean;
  weeks: WeekEffect[];
  strongest_weeks: WeekEffect[];
  missing_days_in_strongest_weeks: number;
  provenance: Provenance;
  reading: string;
  detail?: string;
}

export interface Agreement {
  customer_id: string;
  top: number;
  samples: number;
  shap: Array<{ feature: string; label: string; weight: number }>;
  lime: Array<{ feature: string; label: string; weight: number }>;
  shared_features: string[];
  same_direction: string[];
  agrees: boolean;
  provenance: Provenance;
  reading: string;
}

export interface MissingnessProfile {
  overall_missing_share: number;
  by_class: Record<"honest" | "theft", { customers: number; mean: number; median: number; p10: number; p90: number; complete_records: number }>;
  histogram: Array<{ low: number; high: number; honest: number; theft: number }>;
  auc_of_missing_share_alone: number;
  monthly: Array<{ month: string; all: number; theft: number; honest: number }>;
  provenance: Provenance;
  reading: string;
}

export interface ShortcutEvidence {
  sections: Array<{
    title: string;
    artifact: string;
    values: Record<string, { value: number; run_id: string }>;
    reading: string;
  }>;
  provenance: Provenance;
  conclusion: string;
  what_would_settle_it: string[];
}

export interface MaskExperiment {
  customer_id: string;
  label: number;
  missing_share: number;
  scores: { served: number; missingness_hidden: number; all_days_marked_missing: number };
  effect_of_hiding_missingness: number;
  provenance: Provenance;
  caveat: string;
}

export interface CustomerList {
  customers: Array<{ customer_id: string; label: number; probability: number }>;
  total_matching: number;
  served_pipeline: string;
  note: string;
}

export const getXaiCustomers = (q: { query?: string; label?: number; limit?: number }) => httpGet<CustomerList>("/xai/customers", q);
export const getXaiGlobal = (q: { seed?: number; top?: number }) => httpGet<GlobalImportance>("/xai/global", q);
export const getXaiBeeswarm = (q: { seed?: number; top?: number }) => httpGet<{ features: BeeswarmFeature[]; customers: number; provenance: Provenance; reading: string }>("/xai/beeswarm", q);
export const getXaiCustomer = (q: { customer_id: string; top?: number }) => httpGet<CustomerExplanation>("/xai/customer", q);
export const getXaiWeeks = (q: { customer_id: string }) => httpGet<WeekEffects>("/xai/weeks", q);
export const getXaiAgreement = (q: { customer_id: string; top?: number; samples?: number }) => httpGet<Agreement>("/xai/agreement", q);
export const getMissingnessProfile = () => httpGet<MissingnessProfile>("/xai/missingness/profile");
export const getMissingnessAttribution = (q: { seed?: number }) => httpGet<{ share_of_total_attribution: number; features: FeatureImportance[]; customers: number; provenance: Provenance; reading: string }>("/xai/missingness/attribution", q);
export const getShortcutEvidence = () => httpGet<ShortcutEvidence>("/xai/missingness/evidence");
export const getMaskExperiment = (q: { customer_id: string }) => httpGet<MaskExperiment>("/xai/missingness/mask-experiment", q);
