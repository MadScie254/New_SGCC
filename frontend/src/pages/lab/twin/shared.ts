// Colours, labels and small helpers shared by the twin's scene, fallback schematic and panels.
import { useEffect, useState } from "react";
import type { NodeKind, ScenarioCategory, TwinAggregate, TwinMeterState, TwinNetwork, TwinNode } from "@/lib/api/twin";

// Scene colours. Cyan and electric blue for energised assets, amber for missing telemetry,
// coral only for meters the model flags; violet stays an interface accent for "synthetic".
export const scene = {
  ground: "#080D17",
  grid: "#16202F",
  hv: "#7DD3FC",
  mv: "#38BDF8",
  lv: "#2F6FB8",
  residential: "#27344A",
  commercial: "#2E3E58",
  meter: "#38BDF8",
  missing: "#F5A524",
  flagged: "#F2685C",
  steel: "#4A5B73",
  ops: "#A78BFA",
  select: "#E6EDF5",
} as const;

export const KIND_LABEL: Record<NodeKind, string> = {
  bulk_supply: "Bulk supply point",
  substation: "Primary substation",
  feeder: "MV feeder",
  transformer: "Distribution transformer",
  lateral: "LV lateral",
  service_point: "Service point",
  operations_centre: "Operations centre",
};

export const CATEGORY_LABEL: Record<ScenarioCategory, string> = {
  baseline: "Baseline",
  "anomalous-readings": "Anomalous readings",
  "legitimate-change": "Legitimate change",
  "data-quality": "Data quality",
};

export const CATEGORY_CLASS: Record<ScenarioCategory, string> = {
  baseline: "bg-tint text-ink-2",
  "anomalous-readings": "bg-risk-bg text-risk-text",
  "legitimate-change": "bg-ok-bg text-ok",
  "data-quality": "bg-amber-bg text-amber-ink",
};

/** Assets a reader can select, in network order, with the upstream path spelled out. */
export const SELECTABLE: NodeKind[] = ["bulk_supply", "substation", "feeder", "transformer", "service_point", "operations_centre"];

export function describeRating(node: TwinNode): string {
  if (!node.rating.unit) return "no rating";
  return `${node.rating.value} ${node.rating.unit}${node.rating.voltage ? ` · ${node.rating.voltage}` : ""}`;
}

export interface NetworkIndex {
  byId: Map<string, TwinNode>;
  children: Map<string, string[]>;
  servicePoints: TwinNode[];
  /** Service points below each node (its meters). */
  metersBelow: Map<string, string[]>;
  extent: { x: [number, number]; z: [number, number] };
}

export function indexNetwork(network: TwinNetwork): NetworkIndex {
  const byId = new Map(network.nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  network.nodes.forEach((node) => {
    if (node.parent) children.set(node.parent, [...(children.get(node.parent) ?? []), node.id]);
  });
  const servicePoints = network.nodes.filter((node) => node.kind === "service_point");
  const metersBelow = new Map<string, string[]>();
  const collect = (id: string): string[] => {
    const node = byId.get(id);
    if (node?.kind === "service_point") return [id];
    const below = (children.get(id) ?? []).flatMap(collect);
    metersBelow.set(id, below);
    return below;
  };
  network.nodes.filter((node) => !node.parent).forEach((node) => collect(node.id));
  const xs = network.nodes.map((n) => n.position.x);
  const zs = network.nodes.map((n) => n.position.z);
  return {
    byId, children, servicePoints, metersBelow,
    extent: { x: [Math.min(...xs), Math.max(...xs)], z: [Math.min(...zs), Math.max(...zs)] },
  };
}

/** Path from an asset up to the bulk supply point, e.g. "SS1 › F2 › T07". */
export function upstreamPath(index: NetworkIndex, id: string): TwinNode[] {
  const path: TwinNode[] = [];
  let current = index.byId.get(id)?.parent ?? null;
  while (current) {
    const node = index.byId.get(current);
    if (!node) break;
    path.unshift(node);
    current = node.parent;
  }
  return path;
}

export interface DayState {
  /** Current day's reading per service point (null = no reading). */
  reading: Map<string, number | null>;
  /** Current day's simulated supplied energy per upstream asset. */
  supplied: Map<string, number>;
  metered: Map<string, number>;
  gap: Map<string, number>;
  flagged: Set<string>;
  missing: Set<string>;
  scenarioOf: Map<string, TwinMeterState>;
  peakMeter: number;
  peakSupplied: number;
}

export function dayState(meters: TwinMeterState[], aggregates: TwinAggregate[], day: number): DayState {
  const reading = new Map<string, number | null>();
  const flagged = new Set<string>();
  const missing = new Set<string>();
  const scenarioOf = new Map<string, TwinMeterState>();
  let peakMeter = 0.001;
  meters.forEach((meter) => {
    const value = meter.kwh[day] ?? null;
    reading.set(meter.id, value);
    scenarioOf.set(meter.id, meter);
    if (meter.flagged) flagged.add(meter.id);
    if (value === null) missing.add(meter.id);
    if (value !== null) peakMeter = Math.max(peakMeter, value);
  });
  const supplied = new Map<string, number>();
  const metered = new Map<string, number>();
  const gap = new Map<string, number>();
  let peakSupplied = 0.001;
  aggregates.forEach((aggregate) => {
    const s = aggregate.supplied[day] ?? 0;
    supplied.set(aggregate.id, s);
    metered.set(aggregate.id, aggregate.metered[day] ?? 0);
    gap.set(aggregate.id, aggregate.gap[day] ?? 0);
    if (aggregate.kind !== "bulk_supply") peakSupplied = Math.max(peakSupplied, s);
  });
  return { reading, supplied, metered, gap, flagged, missing, scenarioOf, peakMeter, peakSupplied };
}

/** True when the reader asked for reduced motion: no auto-play, static flow markers. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return reduced;
}

/** Whether this browser can give us a WebGL context at all (the schematic fallback is used when not). */
export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function fmtKwh(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "no reading";
  return `${value.toFixed(digits)} kWh`;
}
