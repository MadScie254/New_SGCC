import { httpGet } from "@/lib/http";
import type { Provenance } from "@/lib/api/statistics";

export interface ReleaseCheck {
  item: string;
  proposal: string;
  actual: string;
  agrees: boolean;
  note: string;
}

export interface SplitSummary {
  split: string;
  customers: number;
  theft: number;
  theft_rate: number;
}

export interface Release {
  identity: {
    file: string;
    sha256: string;
    registered_release: boolean;
    customers: number;
    days: number;
    cells: number;
    first_date: string;
    last_date: string;
    calendar_days_in_range: number;
    absent_dates: string[];
  };
  completeness: {
    missing_cells: number;
    missing_share: number;
    customers_complete: number;
    customers_without_any_reading: number;
    customers_over_10pct_missing: number;
    theft_customers_over_10pct_missing: number;
    missing_share_honest: number;
    missing_share_theft: number;
  };
  classes: { honest: number; theft: number; theft_rate: number; imbalance_ratio: number };
  splits: SplitSummary[];
  checks: ReleaseCheck[];
  provenance: Provenance;
  reading: string;
}

export interface CoverageDay {
  date: string;
  missing_share: number;
  missing_share_theft: number;
  missing_share_honest: number;
  meters_reporting: number;
}

export interface Coverage {
  days: CoverageDay[];
  months: Array<{ month: string; all: number; theft: number; honest: number }>;
  worst_days: CoverageDay[];
  absent_dates: string[];
  provenance: Provenance;
  reading: string;
}

export interface ClassBin {
  low: number;
  high: number;
  honest: number;
  theft: number;
}

export interface ClassSummary {
  customers: number;
  mean: number;
  median: number;
  p90: number;
  max: number;
}

export interface Gaps {
  missing_share_histogram: ClassBin[];
  longest_gap_histogram: ClassBin[];
  missing_share: Record<"honest" | "theft", ClassSummary>;
  longest_gap_days: Record<"honest" | "theft", ClassSummary>;
  provenance: Provenance;
  reading: string;
}

export interface Consumption {
  histogram: { edges: number[]; honest: number[]; theft: number[] };
  quantiles: Record<string, number>;
  totals: {
    readings: number;
    zero_readings: number;
    negative_readings: number;
    above_cap: number;
    cap_kwh: number;
    max_reading: number;
    mean_reading: number;
    customers_with_long_zero_runs: number;
    zero_run_days: number;
  };
  weekday: Array<{ weekday: number; mean_kwh: number }>;
  months: Array<{ month: string; mean_kwh: number }>;
  provenance: Provenance;
  reading: string;
}

export interface Cleaning {
  log: Record<string, number>;
  settings: Record<string, number | string | null>;
  provenance: Provenance;
  reading: string;
}

export interface ObservatoryCustomerList {
  customers: Array<{ customer_id: string; label: number; missing_share: number; mean_kwh: number | null }>;
  total_matching: number;
  note: string;
}

export interface CustomerRecord {
  customer_id: string;
  label: number;
  split: string;
  dates: string[];
  raw: Array<number | null>;
  cleaned: Array<number | null>;
  stats: {
    missing_days: number;
    days: number;
    missing_share: number;
    longest_gap_days: number;
    zero_days: number;
    mean_kwh: number | null;
    peak_kwh: number | null;
  };
  provenance: Provenance;
  caveat: string;
}

export const getRelease = () => httpGet<Release>("/observatory/release");
export const getCoverage = () => httpGet<Coverage>("/observatory/coverage");
export const getGaps = () => httpGet<Gaps>("/observatory/gaps");
export const getConsumption = () => httpGet<Consumption>("/observatory/consumption");
export const getCleaning = () => httpGet<Cleaning>("/observatory/cleaning");
export const getObservatoryCustomers = (q: { query?: string; label?: number; limit?: number }) =>
  httpGet<ObservatoryCustomerList>("/observatory/customers", q);
export const getCustomerRecord = (q: { customer_id: string }) => httpGet<CustomerRecord>("/observatory/customer", q);
