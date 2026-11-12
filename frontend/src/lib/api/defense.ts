import { httpGet } from "@/lib/http";
import type { Provenance } from "@/lib/api/statistics";

export interface Claim {
  id: string;
  claim: string | null;
  group: string | null;
  group_title: string | null;
  source: string | null;
  experiment: string | null;
  reported: number | null;
  tolerance: number | null;
  status: "verified" | "discrepant" | "reported";
  status_label: string;
  observed: number | null;
  difference: number | null;
  run_id: string | null;
  note: string | null;
}

export interface Objective {
  objective: string;
  claims: Claim[];
  total: number;
  verified?: number;
  discrepant?: number;
  reported?: number;
}

export interface Claims {
  summary: {
    findings: number;
    reported: number;
    verified: number;
    discrepant: number;
    verified_exactly: number;
    findings_sha256: string;
  };
  objectives: Objective[];
  excluded_runs: string[];
  predeclared: boolean;
  provenance: Provenance;
  reading: string;
}

export interface Conclusion {
  id: string;
  statement: string | null;
  source: string | null;
  thesis: string[];
  experiment: string | null;
  check: Record<string, unknown>;
  outcome: "holds" | "does_not_hold" | "not_rerun" | "not_supported_by_reported_record";
  outcome_label: string;
  holds_in_reported: boolean | null;
  holds_in_rerun: boolean | null;
  rerun_run_id: string | null;
  detail: Record<string, unknown>;
}

export interface Conclusions {
  summary: Record<string, number>;
  conclusions: Conclusion[];
  alpha: number | null;
  predeclared: boolean;
  written: string | null;
  sha256: string | null;
  applies_integrity_gate: boolean;
  provenance: Provenance;
  reading: string;
}

export interface Question {
  id: string | null;
  question: string | null;
  detail: string | null;
  answer: string | null;
  evidence: string | null;
}

export interface Questions {
  questions: Question[];
  run: string | null;
  provenance: Provenance;
  reading: string;
}

export interface Briefing {
  claims: {
    total: number | null;
    verified: number | null;
    discrepant: number | null;
    reported_only: number | null;
    fingerprint: string | null;
  };
  conclusions: {
    total: number | null;
    holds: number | null;
    does_not_hold: number | null;
    not_rerun: number | null;
    not_supported: number | null;
    predeclared: boolean;
    written: string | null;
  };
  open_questions: number;
  provenance: Provenance;
  reading: string;
}

export const getBriefing = () => httpGet<Briefing>("/defense/briefing");
export const getClaims = () => httpGet<Claims>("/defense/claims");
export const getConclusions = () => httpGet<Conclusions>("/defense/conclusions");
export const getQuestions = () => httpGet<Questions>("/defense/questions");
