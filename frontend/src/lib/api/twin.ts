// The 3D digital twin workspace. Everything typed "synthetic" here is simulated by the API's seeded
// generator (src/simulation.py); only `TwinObservedCustomer` carries authentic SGCC readings.
import { httpGet, httpPost } from "@/lib/http";
import type { Evidence } from "@/components/evidence";
import type { ModelPart, Reading, Reason } from "@/lib/api";

export interface Provenance {
  status: Evidence;
  source: string;
  computed_from: string;
  note?: string;
}

export type NodeKind =
  | "bulk_supply" | "substation" | "feeder" | "transformer" | "lateral" | "service_point" | "operations_centre";

export interface TwinNode {
  id: string;
  kind: NodeKind;
  label: string;
  position: { x: number; y: number; z: number };
  parent: string | null;
  rating: { value: number; unit: string; voltage: string };
  synthetic: true;
  substation?: string;
  feeder?: string;
  transformer?: string;
  mount?: "pole" | "pad";
  index?: number;
  building?: "residential" | "commercial";
  meter_id?: string;
  base_kwh?: number;
  footprint?: { w: number; d: number; h: number };
  note?: string;
}

export interface TwinEdge {
  id: string;
  from: string;
  to: string;
  level: "hv" | "mv" | "lv";
  role: "line" | "lateral" | "service";
  length_m: number;
  points: Array<[number, number, number]>;
  synthetic: true;
}

export interface TwinNetwork {
  seed: number;
  synthetic: true;
  units: string;
  counts: Partial<Record<NodeKind, number>>;
  nodes: TwinNode[];
  edges: TwinEdge[];
  provenance: Provenance;
  statement: string;
}

export type ScenarioCategory = "baseline" | "anomalous-readings" | "legitimate-change" | "data-quality";

export interface ScenarioParameter {
  name: string;
  label: string;
  type: "int" | "float" | "day" | "bool" | "choice";
  default: number | string | boolean;
  minimum: number | null;
  maximum: number | null;
  unit: string | null;
  choices: Array<{ value: string; label: string }> | null;
  help: string | null;
}

export interface ScenarioSpec {
  id: string;
  title: string;
  category: ScenarioCategory;
  false_positive_example: boolean;
  network_side: boolean;
  readings_show: string;
  other_causes: string[];
  delivery_assumption: string;
  parameters: ScenarioParameter[];
}

export type ScenarioParams = Record<string, number | string | boolean>;

export interface ComparePair {
  id: string;
  title: string;
  point: string;
  anomalous: { scenario: string; params: ScenarioParams };
  legitimate: { scenario: string; params: ScenarioParams };
}

export interface TwinCatalogue {
  provenance: Provenance;
  synthetic: true;
  calendar: { start: string; end: string; days: number; dates: string[] };
  window: { default_days: number; max_days: number };
  scenarios: ScenarioSpec[];
  compare_pairs: ComparePair[];
  model: { pipeline: string; label: string; version: string; threshold: number; statement: string };
  statements: { network: string; model: string; balance: string; attachment: string; losses: string };
}

export interface WeekEffect {
  week: number;
  effect: number;
  start: string | null;
  end: string | null;
}

export interface TwinModelScore {
  probability: number;
  raw_score: number;
  threshold: number;
  flagged: boolean;
  risk_tier: "high" | "medium" | "low";
  parts: ModelPart[] | null;
  reasons: Reason[];
  reasons_explain: string;
  sequence: { available: boolean; label?: string; weeks: WeekEffect[] };
  statement: string;
}

export interface ScenarioScore {
  provenance: Provenance;
  synthetic: true;
  seed: number;
  meter: {
    service_point: string | null; meter_id: string; building: string; base_kwh: number;
    transformer: string | null; synthetic: true;
  };
  scenario: Omit<ScenarioSpec, "parameters"> & { params: ScenarioParams };
  series: {
    synthetic: true; unit: string; points: Reading[]; days: number; missing_days: number; zero_days: number;
    registered_kwh: number; delivered_kwh: number; unmetered_kwh: number;
  };
  model: TwinModelScore;
}

export interface TwinMeterState {
  id: string;
  scenario: string;
  category: ScenarioCategory;
  probability: number;
  flagged: boolean;
  missing_days: number;
  kwh: Array<number | null>;
  synthetic: true;
}

export interface TwinAggregate {
  id: string;
  kind: NodeKind;
  supplied: Array<number | null>;
  metered: Array<number | null>;
  gap: Array<number | null>;
  missing_meter_days: number;
  synthetic: true;
}

export interface TwinAssignmentRow {
  service_point: string;
  scenario: string;
  params: ScenarioParams;
  title: string;
  category: ScenarioCategory;
  false_positive_example: boolean;
  network_side: boolean;
  synthetic: true;
}

export interface TwinSimulation {
  provenance: Provenance;
  synthetic: true;
  seed: number;
  window: { start_day: number; end_day: number; dates: string[] };
  assignment: TwinAssignmentRow[];
  default_assignment: boolean;
  meters: TwinMeterState[];
  aggregates: TwinAggregate[];
  system: { synthetic: true; resolution: string; unit: string; dates: string[]; supplied: number[]; metered: number[]; gap: number[] };
  model: { threshold: number; flagged: number; meter_count: number; scored_on: string; statement: string };
  assumptions: { technical_loss: Record<string, number>; losses: string; balance: string };
}

export interface TwinObservedCustomer {
  customer_id: string;
  provenance: Provenance;
  attachment: "illustrative";
  attachment_note: string;
  readings: {
    provenance: Provenance; unit: string; points: Reading[]; days: number; missing_days: number; zero_days: number;
  };
  model: TwinModelScore;
}

export interface CustomerSearchRow {
  customer_id: string;
  rank: number;
  risk_score: number;
  risk_tier: "high" | "medium" | "low";
}

export const getTwinNetwork = (seed: number) => httpGet<TwinNetwork>("/twin/network", { seed });
export const getTwinCatalogue = () => httpGet<TwinCatalogue>("/twin/scenarios");

export const scoreScenario = (body: { seed: number; scenario: string; params?: ScenarioParams; service_point?: string | null }) =>
  httpPost<ScenarioScore>("/twin/scenarios/score", {
    seed: body.seed, scenario: body.scenario, params: body.params ?? {}, service_point: body.service_point ?? null,
  });

export const simulateNetwork = (body: {
  seed: number;
  assignment?: Array<{ service_point: string; scenario: string; params?: ScenarioParams }> | null;
  start_day?: number; end_day?: number;
}) => httpPost<TwinSimulation>("/twin/simulate", body);

export const getTwinObservedCustomer = (customerId: string) =>
  httpGet<TwinObservedCustomer>(`/twin/customers/${encodeURIComponent(customerId)}`);

/** The operational population's own search, used to pick a real customer to attach to a virtual meter. */
export const searchOperationalCustomers = (search: string) =>
  httpGet<{ items: CustomerSearchRow[]; total: number }>("/customers", { search, page_size: 8 });
