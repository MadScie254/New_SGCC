import { httpDelete, httpGet, httpPost } from "@/lib/http";
import type { Evidence } from "@/components/evidence";

export interface Setting {
  name: string;
  label: string;
  type: "int" | "float" | "choice" | "bool";
  default: number | string | boolean;
  minimum: number | null;
  maximum: number | null;
  choices: Array<number | string> | null;
}

export interface Experiment {
  id: string;
  version: number;
  title: string;
  protocol: "original" | "exploratory";
  phase: "proposed_study" | "documented_extension" | "new";
  kind: string;
  summary: string;
  command: string[];
  needs: string[];
  needs_data: boolean;
  needs_torch: boolean;
  expected_minutes: number;
  settings: Setting[];
  outputs: string[];
  thesis: string[];
  pipelines: string[];
  leakage_controls: string[];
  notes: string | null;
  sha256: string;
  runs: number;
  active: string | null;
  latest_succeeded: string | null;
  missing_prerequisites: string[];
  can_recompute_from_reported: boolean;
}

export type RunState = "queued" | "running" | "succeeded" | "failed" | "interrupted" | "reported";

export interface Integrity {
  sealed: boolean;
  intact: boolean | null;
  problems: string[];
  sealed_at?: string;
  seal_sha256?: string;
  files?: number;
  checked_at?: string;
}

export interface RunSummary {
  run_id: string;
  experiment_id: string;
  experiment_version: number | null;
  title: string | null;
  protocol: "original" | "exploratory";
  state: RunState;
  evidence: Evidence;
  created_at: string;
  created_by: string;
  started_at: string | null;
  finished_at: string | null;
  runtime_seconds: number | null;
  retry_of: string | null;
  seeded_from: string[];
  parameters: Record<string, number | string | boolean>;
  progress: { stage: string; fraction: number | null } | null;
  error: string | null;
  lineage: string | null;
  eligible_to_verify: boolean | null;
  eligibility_reasons: string[] | null;
  heartbeat_age_seconds?: number | null;
  integrity?: Integrity;
  findings: Record<"exact" | "within_tolerance" | "discrepant" | "missing", number> | null;
}

export interface FindingCheck {
  finding_id: string;
  reported: number;
  tolerance: number;
  decimals: number;
  observed: number | null;
  difference: number | null;
  outcome: "exact" | "within_tolerance" | "discrepant" | "missing";
}

export interface FileEntry {
  sha256: string;
  bytes?: number;
  from?: string;
}

export interface RunDetail extends RunSummary {
  experiment_sha256: string | null;
  command?: string[];
  config_sha256?: string;
  findings_sha256?: string;
  exit_code?: number | null;
  dataset?: { file: string; bytes: number; sha256: string; matches_registered?: boolean } | null;
  environment?: {
    python: string;
    platform: string;
    machine: string;
    processor: string;
    cpu_count: number;
    threads: number;
    libraries: Record<string, string | null>;
  };
  code?: { commit: string | null; dirty: boolean | null; source_tree_sha256: string; files: number };
  fingerprints?: {
    feature_schema?: { count: number; sha256: string };
    served_pipeline?: string;
    calibration?: Record<string, number | string> | null;
    threshold?: number | null;
    blend?: Record<string, number | string> | null;
    split?: Record<string, number | string | null>;
    hyperparameters?: Record<string, Record<string, number> | null>;
    trained_on?: Record<string, unknown>;
  };
  inputs?: Record<string, FileEntry>;
  outputs?: Record<string, FileEntry>;
  source?: { repository: string; commit: string; imported_on: string };
  original_manifest?: { published_at: string; pipeline: string; files: number; verified: boolean; problems: string[] };
  note?: string;
  integrity: Integrity;
  seal: { sealed_at: string; seal_sha256: string; files: Record<string, string> } | null;
  finding_checks: FindingCheck[];
}

export interface RunEvent {
  seq: number;
  at: string;
  level: "info" | "warning" | "error";
  message: string;
  stage?: string;
}

export interface RunEvents {
  run_id: string;
  state: RunState;
  progress: { stage: string; fraction: number | null } | null;
  events: RunEvent[];
  next: number;
}

export interface Attempt {
  run_id: string;
  finished_at: string | null;
  eligible: boolean;
  lineage: string | null;
  observed: number | null;
  difference: number | null;
  outcome: FindingCheck["outcome"];
}

export interface Finding {
  id: string;
  group: string;
  group_title: string | null;
  claim: string;
  source: string;
  thesis: string[];
  experiment: string;
  artifact: string;
  path: string[];
  reported: number;
  decimals: number;
  tolerance: number;
  class: string;
  note: string | null;
  status: "reported" | "verified" | "discrepant";
  reported_artifact: { value: number | null; outcome: string } | null;
  latest: Attempt | null;
  recomputed: Attempt | null;
  attempts: Attempt[];
}

export interface Ledger {
  summary: {
    findings: number;
    reported: number;
    verified: number;
    discrepant: number;
    verified_exactly: number;
    document_differs_from_reported_artifact: string[];
    findings_sha256: string;
  };
  findings: Finding[];
  excluded_runs: string[];
}

export interface RegistryStatus {
  runner_alive: boolean;
  queued: string[];
  running: string[];
  runs: number;
  findings_sha256: string;
  datasets: Record<string, { title: string; file: string; sha256: string; kind: string; labelled: boolean; customers: number; source: string; caveats?: string[] }>;
}

export interface RunComparison {
  a: string;
  b: string;
  pipelines: Array<{ pipeline: string; label: string | null; metrics: Record<string, { a: number | null; b: number | null; difference: number | null }> }>;
}

export const getExperiments = () => httpGet<Experiment[]>("/experiments");
export const getRuns = (experimentId?: string) => httpGet<RunSummary[]>("/runs", { experiment_id: experimentId });
export const getRun = (runId: string) => httpGet<RunDetail>(`/runs/${runId}`);
export const getRunEvents = (runId: string, after: number) => httpGet<RunEvents>(`/runs/${runId}/events`, { after, limit: 1000 });
export const getRunFile = (runId: string, path: string) =>
  httpGet<{ run_id: string; path: string; sha256: string; bytes: number; json: unknown; text: string | null }>(`/runs/${runId}/file`, { path });
export const startRun = (experimentId: string, body: { settings?: Record<string, unknown>; seed_from?: string[]; retry_of?: string }) =>
  httpPost<RunSummary>(`/experiments/${experimentId}/runs`, body);
export const verifyRun = (runId: string) => httpPost<Integrity>(`/runs/${runId}/verify`);
export const withdrawRun = (runId: string) => httpDelete(`/runs/${runId}`);
export const getLedger = () => httpGet<Ledger>("/findings");
export const getRegistryStatus = () => httpGet<RegistryStatus>("/registry/status");
export const compareRuns = (a: string, b: string) => httpGet<RunComparison>("/runs/compare", { a, b });

export const REPORTED_RUN = "run-reported-sgcc-081e814";

export const PHASE_LABEL: Record<Experiment["phase"], string> = {
  proposed_study: "Proposed study",
  documented_extension: "Documented extension",
  new: "Added by GridSentinel X",
};
