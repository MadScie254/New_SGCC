// Side panels: the keyboard-reachable asset list, the asset inspector, and the aggregate energy view.
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crosshair } from "lucide-react";
import { ApiError, Button, Card, CardHeader, Skeleton, TierBadge } from "@/components/ui";
import { EvidenceBadge, SourceNote, type Evidence } from "@/components/evidence";
import { WeekEffectsChart } from "@/components/charts";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { palette } from "@/lib/palette";
import { cn } from "@/lib/cn";
import {
  scoreScenario, type ScenarioSpec, type TwinAssignmentRow, type TwinModelScore, type TwinNetwork, type TwinNode,
  type TwinSimulation,
} from "@/lib/api/twin";
import { CATEGORY_CLASS, CATEGORY_LABEL, KIND_LABEL, SELECTABLE, describeRating, fmtKwh, scene, upstreamPath, type DayState, type NetworkIndex } from "./shared";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-soft py-1.5 last:border-0">
      <span className="text-[13px] text-ink-2">{label}</span>
      <span className="text-right font-mono text-[13px] tabular text-ink">{children}</span>
    </div>
  );
}

/** The model's calibrated probability, its two parts and the operating threshold. */
export function ScoreBlock({ model, caption, status = "synthetic" }: { model: TwinModelScore; caption: string; status?: Evidence }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <span className={cn("font-display text-[34px] font-medium leading-none tabular", model.flagged ? "text-risk" : "text-ink")}>
          {fmtPct(model.probability, 1)}
        </span>
        <TierBadge tier={model.risk_tier} solid />
        <span className="text-xs text-ink-3">
          {model.flagged ? "at or above" : "below"} the operating threshold {fmtNum(model.threshold)}
        </span>
      </div>
      {model.parts?.map((part) => (
        <div key={part.name} className="flex items-center gap-3 text-[12px]">
          <span className="w-[13.5rem] shrink-0 text-ink-2">{part.label}</span>
          <span className="h-1.5 flex-1 rounded-full bg-tint">
            <span className="block h-1.5 rounded-full" style={{ width: `${Math.max(1, part.probability * 100)}%`, background: palette.accent }} />
          </span>
          <span className="w-24 shrink-0 text-right font-mono tabular text-ink">
            {fmtPct(part.probability, 1)} <span className="text-ink-3">×{fmtNum(part.weight, 2)}</span>
          </span>
        </div>
      ))}
      <SourceNote status={status}>{caption}</SourceNote>
      <p className="m-0 rounded-lg bg-tint px-3 py-2 text-[11px] leading-relaxed text-ink-2">{model.statement}</p>
    </div>
  );
}

export function ReasonList({ model, title = "Why the XGBoost part scored it this way" }: { model: TwinModelScore; title?: string }) {
  const peak = Math.max(...model.reasons.map((r) => Math.abs(r.shap_value)), 1e-6);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium">{title}</span>
      {model.reasons.map((reason) => {
        const up = reason.shap_value >= 0;
        return (
          <div key={reason.feature} className="grid grid-cols-[minmax(0,1fr)_72px_56px] items-center gap-2 text-[12px]">
            <span className="flex flex-col">
              <span className="truncate text-ink">{reason.label}</span>
              <span className="truncate text-[11px] text-ink-3">{reason.display_value}</span>
            </span>
            <span className="relative h-2.5">
              <span
                className="absolute top-0 h-2.5 rounded-[2px]"
                style={{ width: `${(Math.abs(reason.shap_value) / peak) * 100}%`, right: up ? undefined : 0, left: up ? 0 : undefined,
                  background: up ? palette.theft : palette.accent }}
              />
            </span>
            <span className={cn("text-right font-mono tabular", up ? "text-risk-text" : "text-cobalt-ink")}>
              {up ? "+" : "−"}{Math.abs(reason.shap_value).toFixed(2)}
            </span>
          </div>
        );
      })}
      <p className="m-0 text-[11px] text-ink-3">{model.reasons_explain}</p>
    </div>
  );
}

export function OtherCauses({ causes, readings, delivery }: { causes: string[]; readings?: string; delivery?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber/30 bg-amber-bg/40 px-3.5 py-3">
      {readings ? <p className="m-0 text-[12px] leading-relaxed text-amber-ink"><span className="font-semibold">The readings show. </span>{readings}</p> : null}
      <span className="text-[12px] font-semibold text-amber-ink">Other causes that produce the same readings</span>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[12px] leading-relaxed text-amber-ink/90">
        {causes.map((cause) => <li key={cause}>{cause}</li>)}
      </ul>
      {delivery ? <p className="m-0 text-[11px] leading-relaxed text-ink-3">Simulation assumption: {delivery}</p> : null}
    </div>
  );
}

/** A compact line over the visible window (nulls leave a gap, as missing readings should). */
export function WindowSparkline({ values, dates, label, height = 64 }: {
  values: Array<number | null>; dates: string[]; label: string; height?: number;
}) {
  const observed = values.filter((v): v is number => v !== null);
  const top = Math.max(...observed, 0.1) * 1.12;
  const step = 1000 / Math.max(values.length, 1);
  let path = "";
  let pen = false;
  values.forEach((value, i) => {
    if (value === null) { pen = false; return; }
    path += `${pen ? "L" : "M"}${((i + 0.5) * step).toFixed(1)},${(height - (value / top) * (height - 6)).toFixed(1)}`;
    pen = true;
  });
  const gaps: Array<[number, number]> = [];
  let start: number | null = null;
  values.forEach((value, i) => {
    if (value === null && start === null) start = i;
    if (value !== null && start !== null) { gaps.push([start, i]); start = null; }
  });
  if (start !== null) gaps.push([start, values.length]);
  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 1000 ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" role="img" aria-label={label}>
        {gaps.map(([a, b]) => <rect key={a} x={a * step} y={0} width={(b - a) * step} height={height} fill="#3A2A10" />)}
        <path d={path} fill="none" stroke={palette.accent} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-ink-3">
        <span>{dates[0]}</span>
        {gaps.length ? <span className="text-amber-ink">shaded: no reading</span> : null}
        <span>{dates[dates.length - 1]}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset list: every asset selectable from the keyboard
// ---------------------------------------------------------------------------

export function AssetList({ network, state, simulation, selected, onSelect }: {
  network: TwinNetwork;
  state: DayState;
  simulation: TwinSimulation | undefined;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<"all" | "scenario" | "flagged">("all");
  const assigned = useMemo(
    () => new Map((simulation?.assignment ?? []).map((row) => [row.service_point, row])),
    [simulation],
  );

  const groups = SELECTABLE.map((kind) => {
    const text = query.trim().toLowerCase();
    const nodes = network.nodes.filter((node) => {
      if (node.kind !== kind) return false;
      if (text && !`${node.id} ${node.label} ${node.meter_id ?? ""}`.toLowerCase().includes(text)) return false;
      if (only === "flagged") return state.flagged.has(node.id) || (state.gap.get(node.id) ?? 0) > 0.02 * (state.supplied.get(node.id) ?? 1);
      if (only === "scenario") return assigned.has(node.id);
      return true;
    });
    return { kind, nodes };
  }).filter((group) => group.nodes.length > 0);

  const total = groups.reduce((sum, group) => sum + group.nodes.length, 0);

  return (
    <Card label="Network assets" className="flex min-h-0 flex-col gap-3 p-4">
      <CardHeader title="Assets" subtitle={`${fmtInt(total)} simulated assets · select any of them here or in the view`} />
      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
        <span className="sr-only">Search assets</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by id, label or meter"
          className="h-10 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-cobalt"
        />
      </label>
      <div role="radiogroup" aria-label="Filter assets" className="flex gap-1 rounded-lg bg-tint p-0.5">
        {([["all", "All"], ["scenario", "With a scenario"], ["flagged", "Flagged"]] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={only === value}
            onClick={() => setOnly(value)}
            className={cn("h-8 flex-1 rounded-md px-2 text-[12px] font-medium", only === value ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="-mr-1 flex max-h-[26rem] min-h-0 flex-col gap-3 overflow-y-auto pr-1 lg:max-h-[34rem]">
        {groups.map((group) => (
          <div key={group.kind} className="flex flex-col gap-1">
            <span className="sticky top-0 bg-surface py-1 text-[11px] uppercase tracking-[0.07em] text-ink-3">
              {KIND_LABEL[group.kind]} ({group.nodes.length})
            </span>
            {group.nodes.map((node) => {
              const row = assigned.get(node.id);
              const reading = state.reading.get(node.id);
              const supplied = state.supplied.get(node.id);
              return (
                <button
                  key={node.id}
                  type="button"
                  aria-pressed={selected === node.id}
                  onClick={() => onSelect(node.id)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] transition-colors",
                    selected === node.id ? "border-cobalt bg-cobalt-soft text-ink" : "border-transparent bg-tint/60 text-ink-2 hover:border-line hover:text-ink",
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 font-mono text-ink">
                      {node.id}
                      {state.flagged.has(node.id) ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: scene.flagged }} /> : null}
                      {state.missing.has(node.id) ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: scene.missing }} /> : null}
                    </span>
                    <span className="truncate text-[11px] text-ink-3">{row ? row.title : node.label}</span>
                  </span>
                  <span className="shrink-0 font-mono tabular text-[11px] text-ink-2">
                    {node.kind === "service_point" ? (reading === null ? "—" : fmtNum(reading ?? 0, 1)) : fmtNum(supplied ?? 0, 0)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {total === 0 ? <p className="m-0 py-6 text-center text-[13px] text-ink-3">No asset matches that filter.</p> : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Asset inspector
// ---------------------------------------------------------------------------

export function AssetPanel({ node, index, state, simulation, catalogue, seed, day, onFocus, onSelect }: {
  node: TwinNode | null;
  index: NetworkIndex;
  state: DayState;
  simulation: TwinSimulation | undefined;
  catalogue: ScenarioSpec[];
  seed: number;
  day: number;
  onFocus: () => void;
  onSelect: (id: string) => void;
}) {
  const meter = node?.kind === "service_point" ? node : null;
  const assignment: TwinAssignmentRow | undefined = simulation?.assignment.find((row) => row.service_point === meter?.id);
  const scenarioId = assignment?.scenario ?? "normal";
  const scored = useQuery({
    queryKey: ["twin-asset-score", seed, meter?.id, scenarioId, JSON.stringify(assignment?.params ?? {})],
    queryFn: () => scoreScenario({ seed, scenario: scenarioId, params: assignment?.params ?? {}, service_point: meter!.id }),
    enabled: Boolean(meter),
    staleTime: 10 * 60 * 1000,
  });

  if (!node) {
    return (
      <Card label="Selected asset" className="flex flex-col gap-2 p-5">
        <CardHeader title="No asset selected" subtitle="Click an asset in the view, or pick one from the asset list." />
        <p className="m-0 text-[13px] leading-relaxed text-ink-2">
          Every building, meter, transformer, feeder and substation in this twin is generated from the network seed.
          Selecting one shows its simulated rating, what it supplies and, for a meter, the scenario on it and how the
          model in service reacts to those readings.
        </p>
      </Card>
    );
  }

  const children = (index.children.get(node.id) ?? []).map((id) => index.byId.get(id)).filter((n): n is TwinNode => Boolean(n));
  const metersBelow = index.metersBelow.get(node.id) ?? [];
  const path = upstreamPath(index, node.id);
  const spec = catalogue.find((item) => item.id === scenarioId);
  const windowValues = meter ? simulation?.meters.find((m) => m.id === meter.id)?.kwh ?? [] : [];

  return (
    <Card label="Selected asset" className="flex flex-col gap-4 p-5">
      <CardHeader
        title={<span className="flex flex-wrap items-center gap-2">{node.label}<EvidenceBadge status="synthetic" /></span>}
        subtitle={`${KIND_LABEL[node.kind]}${node.mount ? ` · ${node.mount} mounted` : ""}${meter ? ` · ${meter.building}` : ""}`}
        action={<Button onClick={onFocus} aria-label="Move the camera to this asset"><Crosshair className="h-4 w-4" aria-hidden /> Focus</Button>}
      />
      <div className="flex flex-col">
        <Row label="Id">{node.id}</Row>
        <Row label="Simulated rating">{describeRating(node)}</Row>
        {meter?.meter_id ? <Row label="Virtual meter">{meter.meter_id}</Row> : null}
        <Row label="Upstream">
          {path.length ? path.map((p) => p.id).join(" › ") : "—"}
        </Row>
        {meter ? (
          <Row label="Reading today">{fmtKwh(state.reading.get(node.id))}</Row>
        ) : (
          <>
            <Row label="Supplied today">{fmtKwh(state.supplied.get(node.id), 1)}</Row>
            <Row label="Metered today">{fmtKwh(state.metered.get(node.id), 1)}</Row>
            <Row label="Unaccounted today">{fmtKwh(state.gap.get(node.id), 1)}</Row>
            <Row label="Meters below">{fmtInt(metersBelow.length)}</Row>
          </>
        )}
      </div>

      {children.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Connected below ({children.length})</span>
          <div className="flex flex-wrap gap-1.5">
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => onSelect(child.id)}
                className="rounded-md border border-line bg-tint px-2 py-1 font-mono text-[11px] text-ink-2 hover:border-cobalt hover:text-ink"
              >
                {child.id}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {node.note ? <p className="m-0 rounded-lg bg-tint px-3 py-2 text-[12px] leading-relaxed text-ink-2">{node.note}</p> : null}

      {meter ? (
        <div className="flex flex-col gap-4 border-t border-line-soft pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium">{spec?.title ?? "Normal daily consumption"}</span>
            {spec ? <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", CATEGORY_CLASS[spec.category])}>{CATEGORY_LABEL[spec.category]}</span> : null}
          </div>
          {windowValues.length && simulation ? (
            <WindowSparkline
              values={windowValues}
              dates={simulation.window.dates}
              label={`Simulated daily kWh for ${meter.meter_id} over the visible window; the current day is ${simulation.window.dates[day] ?? ""}.`}
            />
          ) : null}
          {scored.isPending ? <Skeleton className="h-28" /> : null}
          {scored.isError ? <ApiError error={scored.error} title="Could not score this meter" /> : null}
          {scored.data ? (
            <>
              <div className="flex flex-col">
                <Row label="Registered over the series">{fmtKwh(scored.data.series.registered_kwh, 0)}</Row>
                <Row label="Days with no reading">{fmtInt(scored.data.series.missing_days)}</Row>
                <Row label="Days reading exactly zero">{fmtInt(scored.data.series.zero_days)}</Row>
                {scored.data.series.unmetered_kwh > 0 ? <Row label="Unmetered at the transformer">{fmtKwh(scored.data.series.unmetered_kwh, 0)}</Row> : null}
              </div>
              <ScoreBlock model={scored.data.model} caption={`Simulated readings for ${meter.meter_id}, scored by the model in service (${scored.data.scenario.title}).`} />
              <ReasonList model={scored.data.model} />
              {scored.data.model.sequence.available && scored.data.model.sequence.weeks.length ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium">Which weeks of readings moved the CNN part</span>
                  <WeekEffectsChart weeks={scored.data.model.sequence.weeks} />
                </div>
              ) : null}
              <OtherCauses
                causes={scored.data.scenario.other_causes}
                readings={scored.data.scenario.readings_show}
                delivery={scored.data.scenario.delivery_assumption}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Aggregate energy: system demand, and supplied against metered per transformer
// ---------------------------------------------------------------------------

function BalanceBars({ rows, onSelect }: { rows: Array<{ id: string; supplied: number; metered: number; gap: number }>; onSelect: (id: string) => void }) {
  const peak = Math.max(...rows.map((row) => row.supplied), 0.1);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <button key={row.id} type="button" onClick={() => onSelect(row.id)} className="group grid grid-cols-[4.5rem_minmax(0,1fr)_6.5rem] items-center gap-2 text-left text-[12px]">
          <span className="font-mono text-ink-2 group-hover:text-ink">{row.id}</span>
          <span className="relative h-4 rounded-[3px] bg-tint">
            <span className="absolute left-0 top-0 h-4 rounded-[3px]" style={{ width: `${(row.supplied / peak) * 100}%`, background: "#24405C" }} />
            <span className="absolute left-0 top-0 h-4 rounded-[3px]" style={{ width: `${(row.metered / peak) * 100}%`, background: palette.accent }} />
            {row.gap > 0.02 * row.supplied ? (
              <span
                className="absolute top-0 h-4 rounded-r-[3px]"
                style={{ left: `${(row.metered / peak) * 100}%`, width: `${((row.supplied - row.metered) / peak) * 100}%`, background: palette.theft }}
              />
            ) : null}
          </span>
          <span className="text-right font-mono tabular text-ink-2">
            {row.gap > 0.02 * row.supplied ? <span className="text-risk-text">+{fmtNum(row.supplied - row.metered, 1)}</span> : fmtNum(row.supplied, 1)}
          </span>
        </button>
      ))}
    </div>
  );
}

export function AggregatePanel({ simulation, index, day, feeder, onFeeder, onSelect }: {
  simulation: TwinSimulation;
  index: NetworkIndex;
  day: number;
  feeder: string | null;
  onFeeder: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const feeders = useMemo(() => [...index.byId.values()].filter((node) => node.kind === "feeder"), [index]);
  const active = feeder ?? feeders[0]?.id ?? null;
  const transformers = useMemo(
    () => [...index.byId.values()].filter((node) => node.kind === "transformer" && node.feeder === active),
    [index, active],
  );
  const aggregates = useMemo(() => new Map(simulation.aggregates.map((a) => [a.id, a])), [simulation]);
  const rows = transformers.map((node) => {
    const a = aggregates.get(node.id);
    return { id: node.id, supplied: a?.supplied[day] ?? 0, metered: a?.metered[day] ?? 0, gap: a?.gap[day] ?? 0 };
  });

  const system = simulation.system;
  const W = 1000;
  const H = 150;
  const peak = Math.max(...system.supplied, 0.1) * 1.1;
  const line = (values: number[]) => values.map((value, i) => `${((i / Math.max(values.length - 1, 1)) * W).toFixed(1)},${(H - (value / peak) * (H - 8)).toFixed(1)}`).join(" ");

  return (
    <Card label="Simulated energy balance" className="flex flex-col gap-4 p-5">
      <CardHeader
        title={<span className="flex flex-wrap items-center gap-2">Simulated system demand<EvidenceBadge status="synthetic" /></span>}
        subtitle={`${system.resolution} over the whole simulated calendar`}
      />
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img"
        aria-label={`Simulated supplied and metered energy per day across the whole network, weekly means. Supplied peaks at ${fmtNum(Math.max(...system.supplied), 0)} kWh per day.`}>
        <line x1={0} x2={W} y1={H} y2={H} stroke={palette.axis} />
        <polyline points={line(system.supplied)} fill="none" stroke={palette.missing} strokeWidth={2} />
        <polyline points={line(system.metered)} fill="none" stroke={palette.accent} strokeWidth={2} />
        <text x={0} y={H + 15} fontSize="10" fill={palette.ink3} fontFamily="IBM Plex Mono, monospace">{system.dates[0]}</text>
        <text x={W} y={H + 15} textAnchor="end" fontSize="10" fill={palette.ink3} fontFamily="IBM Plex Mono, monospace">{system.dates[system.dates.length - 1]}</text>
      </svg>
      <div className="flex flex-wrap gap-4 text-[11px] text-ink-2">
        <span className="flex items-center gap-1.5"><span className="h-[3px] w-3.5" style={{ background: palette.missing }} />supplied (with assumed losses)</span>
        <span className="flex items-center gap-1.5"><span className="h-[3px] w-3.5" style={{ background: palette.accent }} />registered by the meters</span>
      </div>
      <SourceNote status="synthetic">
        Simulated kWh per day, {system.resolution}. Nothing here is an SGCC measurement.
      </SourceNote>

      <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-medium">Supplied against metered, by transformer</span>
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            Feeder
            <select
              value={active ?? ""}
              onChange={(event) => onFeeder(event.target.value)}
              className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-cobalt"
            >
              {feeders.map((node) => <option key={node.id} value={node.id}>{node.id} · {node.substation}</option>)}
            </select>
          </label>
        </div>
        <BalanceBars rows={rows} onSelect={onSelect} />
        <p className="m-0 text-[11px] leading-relaxed text-ink-3">
          Blue is what the virtual meters registered on {simulation.window.dates[day]}; the darker bar behind it is what
          the simulation supplied. A coral overhang is energy the simulation supplied that no meter registered and the
          loss assumption does not explain.
        </p>
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-tint/50 px-3.5 py-3 text-[11px] leading-relaxed text-ink-2">
          <span className="font-semibold text-ink">Assumptions behind these numbers</span>
          <p className="m-0">{simulation.assumptions.losses}</p>
          <p className="m-0">{simulation.assumptions.balance}</p>
        </div>
      </div>
    </Card>
  );
}
