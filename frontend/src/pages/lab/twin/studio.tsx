// Scenario studio, the false-positive comparison, and the link from a real SGCC customer to a virtual meter.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Search } from "lucide-react";
import { ApiError, Button, Card, CardHeader, Empty, Skeleton } from "@/components/ui";
import { EvidenceBadge, SourceNote } from "@/components/evidence";
import { ConsumptionChart } from "@/components/charts";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";
import { palette } from "@/lib/palette";
import {
  getTwinObservedCustomer, scoreScenario, searchOperationalCustomers, simulateNetwork,
  type ComparePair, type ScenarioParameter, type ScenarioParams, type ScenarioSpec, type TwinNode,
} from "@/lib/api/twin";
import { CATEGORY_CLASS, CATEGORY_LABEL, type NetworkIndex } from "./shared";
import { OtherCauses, ReasonList, Row, ScoreBlock } from "./panels";

const CATEGORY_ORDER: ScenarioSpec["category"][] = ["baseline", "anomalous-readings", "legitimate-change", "data-quality"];

function defaultsOf(spec: ScenarioSpec): ScenarioParams {
  return Object.fromEntries(spec.parameters.map((p) => [p.name, p.default])) as ScenarioParams;
}

function ParamControl({ parameter, value, dates, onChange }: {
  parameter: ScenarioParameter; value: number | string | boolean; dates: string[]; onChange: (value: number | string | boolean) => void;
}) {
  const id = `twin-param-${parameter.name}`;
  if (parameter.type === "bool") {
    return (
      <label htmlFor={id} className="flex items-center gap-2.5 py-1 text-[13px] text-ink-2">
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 accent-cobalt" />
        {parameter.label}
        {parameter.help ? <span className="text-[11px] text-ink-3">{parameter.help}</span> : null}
      </label>
    );
  }
  if (parameter.type === "choice") {
    return (
      <label htmlFor={id} className="flex flex-col gap-1 text-[13px] text-ink-2">
        {parameter.label}
        <select id={id} value={String(value)} onChange={(event) => onChange(event.target.value)}
          className="h-10 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-cobalt">
          {parameter.choices?.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      </label>
    );
  }
  const minimum = parameter.minimum ?? 0;
  const maximum = parameter.maximum ?? 1;
  const step = parameter.type === "float" ? 0.05 : 1;
  const numeric = Number(value);
  const shown = parameter.type === "day"
    ? `${dates[numeric] ?? `day ${numeric}`}`
    : `${parameter.type === "float" ? numeric.toFixed(2) : fmtInt(numeric)}${parameter.unit ? ` ${parameter.unit}` : ""}`;
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-[13px] text-ink-2">
      <span className="flex items-baseline justify-between gap-3">
        {parameter.label}
        <span className="font-mono text-[12px] tabular text-ink">{shown}</span>
      </span>
      <input id={id} type="range" min={minimum} max={maximum} step={step} value={numeric}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-tint accent-cobalt" />
      {parameter.help ? <span className="text-[11px] text-ink-3">{parameter.help}</span> : null}
    </label>
  );
}

function ScenarioSelect({ id, scenarios, value, onChange, label }: {
  id: string; scenarios: ScenarioSpec[]; value: string; onChange: (value: string) => void; label: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-[13px] text-ink-2">
      {label}
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-cobalt">
        {CATEGORY_ORDER.filter((category) => scenarios.some((s) => s.category === category)).map((category) => (
          <optgroup key={category} label={CATEGORY_LABEL[category]}>
            {scenarios.filter((s) => s.category === category).map((s) => (
              <option key={s.id} value={s.id}>{s.title}{s.false_positive_example ? " (false-positive example)" : ""}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Scenario studio
// ---------------------------------------------------------------------------

export function ScenarioStudio({ seed, scenarios, dates, index, servicePoint, onServicePoint, window: visibleWindow }: {
  seed: number;
  scenarios: ScenarioSpec[];
  dates: string[];
  index: NetworkIndex;
  servicePoint: string;
  onServicePoint: (id: string) => void;
  window: { start_day: number; end_day: number };
}) {
  const [scenarioId, setScenarioId] = useState("bypass_partial");
  const spec = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];
  const [params, setParams] = useState<ScenarioParams>(() => defaultsOf(spec));
  const [run, setRun] = useState<{ scenario: string; params: ScenarioParams; servicePoint: string } | null>(null);

  useEffect(() => { setParams(defaultsOf(spec)); }, [spec]);

  const scored = useQuery({
    queryKey: ["twin-studio", seed, run?.servicePoint, run?.scenario, JSON.stringify(run?.params ?? {})],
    queryFn: () => scoreScenario({ seed, scenario: run!.scenario, params: run!.params, service_point: run!.servicePoint }),
    enabled: Boolean(run),
    staleTime: 10 * 60 * 1000,
  });
  const balance = useQuery({
    queryKey: ["twin-studio-balance", seed, run?.servicePoint, run?.scenario, JSON.stringify(run?.params ?? {}), visibleWindow.start_day, visibleWindow.end_day],
    queryFn: () => simulateNetwork({
      seed,
      assignment: [{ service_point: run!.servicePoint, scenario: run!.scenario, params: run!.params }],
      start_day: visibleWindow.start_day,
      end_day: visibleWindow.end_day,
    }),
    enabled: Boolean(run),
    staleTime: 10 * 60 * 1000,
  });

  const point = index.byId.get(servicePoint);
  const transformerId = point?.transformer ?? null;
  const transformer = balance.data?.aggregates.find((a) => a.id === transformerId);
  const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

  return (
    <Card label="Scenario studio" className="flex flex-col gap-4 p-5">
      <CardHeader
        title={<span className="flex flex-wrap items-center gap-2">Scenario studio<EvidenceBadge status="synthetic" /></span>}
        subtitle="Put a pattern of readings on a virtual meter and watch how the model in service reacts to it."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="twin-studio-point" className="flex flex-col gap-1 text-[13px] text-ink-2">
          Virtual service point
          <select
            id="twin-studio-point"
            value={servicePoint}
            onChange={(event) => onServicePoint(event.target.value)}
            className="h-10 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-cobalt"
          >
            {index.servicePoints.map((node: TwinNode) => (
              <option key={node.id} value={node.id}>
                {node.id} · {node.meter_id} · {node.building} · {node.transformer}
              </option>
            ))}
          </select>
        </label>
        <ScenarioSelect id="twin-studio-scenario" label="Scenario" scenarios={scenarios} value={scenarioId} onChange={setScenarioId} />
      </div>

      {spec ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-tint/40 px-4 py-3.5">
          <span className={cn("w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold", CATEGORY_CLASS[spec.category])}>
            {CATEGORY_LABEL[spec.category]}{spec.network_side ? " · seen from the network only" : ""}
          </span>
          <p className="m-0 text-[12px] leading-relaxed text-ink-2">{spec.readings_show}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {spec.parameters.map((parameter) => (
              <ParamControl
                key={parameter.name}
                parameter={parameter}
                dates={dates}
                value={params[parameter.name] ?? (parameter.default as number | string | boolean)}
                onChange={(value) => setParams((current) => ({ ...current, [parameter.name]: value }))}
              />
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setRun({ scenario: spec.id, params, servicePoint })}
              busy={scored.isFetching || balance.isFetching}>
              <Play className="h-4 w-4" aria-hidden /> Run and score
            </Button>
          </div>
        </div>
      ) : null}

      {!run ? <Empty title="Nothing simulated yet" message="Choose a scenario, tune it and press run. The series is built on the SGCC calendar so the served model can score it." /> : null}
      {scored.isPending && run ? <Skeleton className="h-64" /> : null}
      {scored.isError ? <ApiError error={scored.error} title="The simulation was refused" /> : null}
      {scored.data ? (
        <div className="flex flex-col gap-4">
          <ConsumptionChart points={scored.data.series.points} />
          <SourceNote status="synthetic">
            Simulated daily kWh for {scored.data.meter.meter_id} on the SGCC calendar ({scored.data.series.days} days),
            seed {scored.data.seed}. Not an SGCC customer's readings.
          </SourceNote>
          <ScoreBlock model={scored.data.model} caption={`Simulated readings scored by the model in service: ${scored.data.scenario.title}.`} />
          <ReasonList model={scored.data.model} />
          <OtherCauses causes={scored.data.scenario.other_causes} delivery={scored.data.scenario.delivery_assumption} />
          {transformer ? (
            <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
              <span className="text-[13px] font-medium">Balance at {transformerId} over the visible window</span>
              <div className="flex flex-col">
                <Row label="Supplied (with assumed losses)">{fmtNum(sum(transformer.supplied), 0)} kWh</Row>
                <Row label="Registered by its meters">{fmtNum(sum(transformer.metered), 0)} kWh</Row>
                <Row label="Unaccounted for">{fmtNum(sum(transformer.gap), 0)} kWh</Row>
                <Row label="Meter-days with no reading">{fmtInt(transformer.missing_meter_days)}</Row>
              </div>
              <p className="m-0 text-[11px] leading-relaxed text-ink-3">{balance.data?.assumptions.balance}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The false-positive point, side by side
// ---------------------------------------------------------------------------

function CompareColumn({ seed, servicePoint, scenario, params, tone }: {
  seed: number; servicePoint: string; scenario: string; params: ScenarioParams; tone: "anomalous" | "legitimate";
}) {
  const scored = useQuery({
    queryKey: ["twin-compare", seed, servicePoint, scenario, JSON.stringify(params)],
    queryFn: () => scoreScenario({ seed, scenario, params, service_point: servicePoint }),
    staleTime: 10 * 60 * 1000,
  });
  if (scored.isPending) return <Skeleton className="h-56" />;
  if (scored.isError) return <ApiError error={scored.error} title="Could not simulate this side" />;
  const data = scored.data;
  const values = data.series.points.map((p) => p.kwh);
  const observed = values.filter((v): v is number => v !== null);
  const top = Math.max(...observed, 0.1);
  const step = 1000 / values.length;
  let path = "";
  let pen = false;
  values.forEach((value, i) => {
    if (value === null) { pen = false; return; }
    path += `${pen ? "L" : "M"}${((i + 0.5) * step).toFixed(1)},${(70 - (value / top) * 64).toFixed(1)}`;
    pen = true;
  });
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border px-4 py-3.5",
      tone === "anomalous" ? "border-risk/30 bg-risk-bg/30" : "border-ok/30 bg-ok-bg/30")}>
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-medium">{data.scenario.title}</span>
        <span className={cn("w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold", CATEGORY_CLASS[data.scenario.category])}>
          {CATEGORY_LABEL[data.scenario.category]}
        </span>
      </div>
      <svg viewBox="0 0 1000 74" className="h-16 w-full" preserveAspectRatio="none" role="img"
        aria-label={`Simulated daily readings for ${data.scenario.title}; the model's calibrated probability is ${fmtPct(data.model.probability, 1)}.`}>
        <path d={path} fill="none" stroke={tone === "anomalous" ? palette.theft : palette.ok} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex items-baseline gap-3">
        <span className={cn("font-display text-[28px] font-medium leading-none tabular", data.model.flagged ? "text-risk" : "text-ink")}>
          {fmtPct(data.model.probability, 1)}
        </span>
        <span className="text-[11px] text-ink-3">{data.model.flagged ? "flagged" : "not flagged"} at τ {fmtNum(data.model.threshold)}</span>
      </div>
      <p className="m-0 text-[11px] leading-relaxed text-ink-2">{data.scenario.readings_show}</p>
    </div>
  );
}

export function CompareView({ seed, pairs, servicePoint }: { seed: number; pairs: ComparePair[]; servicePoint: string }) {
  const [pairId, setPairId] = useState(pairs[0]?.id ?? "");
  const pair = pairs.find((item) => item.id === pairId) ?? pairs[0];
  if (!pair) return null;
  return (
    <Card label="Look-alike comparison" className="flex flex-col gap-4 p-5">
      <CardHeader
        title={<span className="flex flex-wrap items-center gap-2">The same readings, two causes<EvidenceBadge status="synthetic" /></span>}
        subtitle="An anomalous-readings scenario beside a lawful look-alike, on the same virtual meter."
        action={
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            <span className="sr-only">Comparison</span>
            <select value={pairId} onChange={(event) => setPairId(event.target.value)}
              className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-cobalt">
              {pairs.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
        }
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <CompareColumn seed={seed} servicePoint={servicePoint} scenario={pair.anomalous.scenario} params={pair.anomalous.params} tone="anomalous" />
        <CompareColumn seed={seed} servicePoint={servicePoint} scenario={pair.legitimate.scenario} params={pair.legitimate.params} tone="legitimate" />
      </div>
      <p className="m-0 rounded-lg border border-amber/30 bg-amber-bg/40 px-3.5 py-3 text-[12px] leading-relaxed text-amber-ink">
        {pair.point}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// A real SGCC customer on an illustrative virtual meter
// ---------------------------------------------------------------------------

export function ResearchLink({ index, servicePoint, onServicePoint }: {
  index: NetworkIndex; servicePoint: string; onServicePoint: (id: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);

  const results = useQuery({
    queryKey: ["twin-customer-search", search],
    queryFn: () => searchOperationalCustomers(search),
    enabled: search.trim().length > 0,
  });
  const observed = useQuery({
    queryKey: ["twin-observed", customerId],
    queryFn: () => getTwinObservedCustomer(customerId!),
    enabled: Boolean(customerId),
    staleTime: 10 * 60 * 1000,
  });
  const meter = index.byId.get(servicePoint);

  return (
    <Card label="Real readings on a virtual meter" className="flex flex-col gap-4 p-5">
      <CardHeader
        title={<span className="flex flex-wrap items-center gap-2">An SGCC customer on a virtual meter<EvidenceBadge status="observed" /></span>}
        subtitle="Search the operational population and show one customer's recorded readings beside the simulated network."
      />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => { event.preventDefault(); setSearch(term.trim()); }}
      >
        <label htmlFor="twin-customer-search" className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[13px] text-ink-2">
          Customer id
          <input
            id="twin-customer-search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="part of an operational customer id"
            className="h-10 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-cobalt"
          />
        </label>
        <Button type="submit" variant="secondary" busy={results.isFetching} disabled={!term.trim()}>
          <Search className="h-4 w-4" aria-hidden /> Search
        </Button>
      </form>

      {results.isError ? <ApiError error={results.error} title="Search failed" /> : null}
      {results.data ? (
        results.data.items.length === 0
          ? <Empty title="No customer matches" message="Operational customer ids are long hashes; try a shorter fragment." />
          : (
            <div className="flex flex-wrap gap-1.5">
              {results.data.items.map((row) => (
                <button
                  key={row.customer_id}
                  type="button"
                  aria-pressed={customerId === row.customer_id}
                  onClick={() => setCustomerId(row.customer_id)}
                  className={cn("rounded-lg border px-2.5 py-1.5 font-mono text-[11px]",
                    customerId === row.customer_id ? "border-cobalt bg-cobalt-soft text-ink" : "border-line bg-tint text-ink-2 hover:text-ink")}
                >
                  {row.customer_id.slice(0, 14)}… <span className="text-ink-3">#{row.rank}</span>
                </button>
              ))}
            </div>
          )
      ) : null}

      <label htmlFor="twin-attach-point" className="flex flex-col gap-1 text-[13px] text-ink-2">
        Illustrative virtual meter to display it on
        <select
          id="twin-attach-point"
          value={servicePoint}
          onChange={(event) => onServicePoint(event.target.value)}
          className="h-10 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-cobalt"
        >
          {index.servicePoints.map((node) => (
            <option key={node.id} value={node.id}>{node.id} · {node.meter_id} · {node.transformer}</option>
          ))}
        </select>
      </label>

      {observed.isPending && customerId ? <Skeleton className="h-64" /> : null}
      {observed.isError ? <ApiError error={observed.error} title="Could not load this customer" /> : null}
      {observed.data ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 rounded-lg border border-violet/40 bg-violet-bg/60 px-3.5 py-3 text-[12px] leading-relaxed text-ink-2">
            <span className="font-semibold text-violet">The attachment is illustrative. </span>
            {observed.data.attachment_note} Shown here on {meter?.meter_id ?? servicePoint}
            {meter?.transformer ? `, a simulated meter on simulated transformer ${meter.transformer}` : ""}.
          </p>
          <ConsumptionChart points={observed.data.readings.points} />
          <SourceNote status="observed">
            Recorded SGCC readings for customer {observed.data.customer_id} ({fmtInt(observed.data.readings.days)} days,
            {" "}{fmtInt(observed.data.readings.missing_days)} with no reading). The operational population carries no labels.
          </SourceNote>
          <ScoreBlock
            model={observed.data.model}
            status="observed"
            caption={`The model in service scoring this customer's recorded readings, exactly as the case file does.`}
          />
          <ReasonList model={observed.data.model} />
        </div>
      ) : null}
    </Card>
  );
}
