import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, Card, Empty, PageHeader, Pill, Skeleton, Stat } from "@/components/ui";
import { Caveat, EvidenceBadge, SourceNote } from "@/components/evidence";
import { CurveLegend, ForestPlot, PrChart, ReliabilityChart, RocChart } from "@/components/viz/StatCurves";
import {
  METRIC_LABELS, getCurvesFor, getStatCalibration, getStatCompare, getStatLimitations, getStatPipelines,
  getStatRanked, getStatRuns, getStatSignificance, getStatStability,
} from "@/lib/api/statistics";
import { palette, pipelineColor } from "@/lib/palette";
import { cn } from "@/lib/cn";

const METRICS = ["pr_auc", "auc", "recall", "precision", "f1", "mcc", "gmean"] as const;
const TABS = [
  ["metrics", "Metrics"], ["curves", "Curves"], ["calibration", "Calibration"], ["significance", "Significance"],
  ["ranked", "Ranked list"], ["stability", "Stability"], ["compare", "Compare runs"], ["limitations", "Limitations"],
] as const;
type Tab = (typeof TABS)[number][0];

function num(value: number | null | undefined, digits = 3) {
  return value == null ? "–" : value.toFixed(digits);
}

function MetricsTab({ run, split }: { run: string; split: string }) {
  const query = useQuery({ queryKey: ["stat-pipelines", run, split], queryFn: () => getStatPipelines({ run, split }) });
  if (query.isLoading) return <Skeleton className="h-96 w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;
  const best = Object.fromEntries(METRICS.map((m) => [m, Math.max(...data.pipelines.map((p) => p.metrics[m]))]));
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] border-collapse text-left text-[13px]">
          <caption className="sr-only">Metrics of each pipeline on the {split} customers at its validation-chosen threshold</caption>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
              <th className="py-2.5 pr-4 font-medium">Pipeline</th>
              {METRICS.map((m) => <th key={m} className="py-2.5 pr-4 text-right font-medium">{METRIC_LABELS[m]}</th>)}
              <th className="py-2.5 pr-4 text-right font-medium">Threshold</th>
              <th className="py-2.5 pr-4 text-right font-medium">Confusion (tp/fp/fn)</th>
              <th className="py-2.5 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.pipelines.map((row) => (
              <tr key={row.pipeline} className="border-b border-line-soft">
                <td className="py-2.5 pr-4">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: pipelineColor(row.pipeline) }} />
                    {row.label}
                    {row.served ? <span className="rounded-full bg-cobalt px-2 py-0.5 text-[10px] font-semibold text-on-accent">served</span> : null}
                  </span>
                </td>
                {METRICS.map((m) => (
                  <td key={m} className={cn("py-2.5 pr-4 text-right font-mono tabular", row.metrics[m] === best[m] && "font-semibold text-cobalt-ink")}>
                    {num(row.metrics[m])}
                  </td>
                ))}
                <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{num(row.threshold)}</td>
                <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">
                  {row.metrics.confusion_matrix.tp}/{row.metrics.confusion_matrix.fp}/{row.metrics.confusion_matrix.fn}
                </td>
                <td className="py-2.5 text-right font-mono text-xs tabular text-ink-3">
                  {row.cost.training_time != null ? `${row.cost.training_time.toFixed(0)} s` : "–"} · {row.cost.inference_ms_per_customer != null ? `${row.cost.inference_ms_per_customer.toFixed(2)} ms` : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
        {data.customers.toLocaleString()} {split} customers, {data.theft} theft-labelled. Each pipeline is scored at the threshold chosen on the validation customers. {data.cost_note}
      </SourceNote>
      <p className="m-0 text-xs leading-relaxed text-ink-3">{data.rounding_note}</p>
    </div>
  );
}

function CurvesTab({ run, split, selected }: { run: string; split: string; selected: string[] }) {
  const query = useQuery({ queryKey: ["stat-curves", run, split, selected], queryFn: () => getCurvesFor(run, split, selected), enabled: selected.length > 0 });
  if (!selected.length) return <Empty title="Choose at least one pipeline" message="Use the pipeline selector above." />;
  if (query.isLoading) return <Skeleton className="h-96 w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-8 lg:grid-cols-2">
        <RocChart curves={data.curves} />
        <PrChart curves={data.curves} baseRate={data.base_rate} />
      </div>
      <CurveLegend curves={data.curves} />
      <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
        {data.provenance.note} With {(data.base_rate * 100).toFixed(2)}% of customers theft-labelled, the precision–recall curve is the informative one: ROC-AUC flatters every model at this imbalance.
      </SourceNote>
    </div>
  );
}

function CalibrationTab({ run, split, pipelines }: { run: string; split: string; pipelines: Array<{ pipeline: string; label: string }> }) {
  const [name, setName] = useState(pipelines.find((p) => p.pipeline === "hybrid")?.pipeline ?? pipelines[0]?.pipeline ?? "hybrid");
  const [bins, setBins] = useState(10);
  const query = useQuery({ queryKey: ["stat-calibration", run, split, name, bins], queryFn: () => getStatCalibration({ run, split, name, bins }) });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-[13px] text-ink-2">Pipeline
          <select value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-lg border border-line bg-surface-alt px-2 text-ink">
            {pipelines.map((p) => <option key={p.pipeline} value={p.pipeline}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">Bins
          <input type="range" min={4} max={20} value={bins} onChange={(e) => setBins(Number(e.target.value))} className="studio-range w-32" aria-valuetext={`${bins} bins`} />
          <span className="font-mono tabular">{bins}</span>
        </label>
      </div>
      {query.isLoading ? <Skeleton className="h-80 w-full" /> : query.isError ? <ApiError error={query.error} /> : (
        <>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <ReliabilityChart raw={query.data!.raw.reliability} calibrated={query.data!.calibrated.reliability} />
            <div className="flex flex-col gap-3">
              <table className="w-full border-collapse text-left text-[13px]">
                <caption className="sr-only">Calibration measures before and after Platt scaling</caption>
                <thead><tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                  <th className="py-2 pr-4 font-medium">Measure</th><th className="py-2 pr-4 text-right font-medium">Raw score</th>
                  <th className="py-2 pr-4 text-right font-medium">Calibrated</th><th className="py-2 text-right font-medium">Change</th></tr></thead>
                <tbody>
                  {([["ece", "Expected calibration error"], ["ece_equal_mass", "ECE (equal-count bins)"], ["brier", "Brier score"], ["log_loss", "Log loss"], ["mean_predicted", "Mean predicted probability"], ["observed_rate", "Observed theft rate"]] as const).map(([key, label]) => (
                    <tr key={key} className="border-b border-line-soft">
                      <td className="py-2 pr-4">{label}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular" style={{ color: palette.missing }}>{num(query.data!.raw[key], 4)}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular text-cobalt-ink">{num(query.data!.calibrated[key], 4)}</td>
                      <td className="py-2 text-right font-mono tabular text-ink-3">
                        {key === "observed_rate" ? "–" : `${query.data!.calibrated[key] - query.data!.raw[key] > 0 ? "+" : ""}${(query.data!.calibrated[key] - query.data!.raw[key]).toFixed(4)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="m-0 text-[13px] leading-relaxed text-ink-2">{query.data!.reading}</p>
            </div>
          </div>
          <SourceNote status={query.data!.provenance.status} runId={query.data!.provenance.run_id}>
            {query.data!.provenance.note} Amber is the model's raw score, blue the probability after Platt scaling.
          </SourceNote>
        </>
      )}
    </div>
  );
}

function SignificanceTab({ run, split, pipelines }: { run: string; split: string; pipelines: Array<{ pipeline: string; label: string }> }) {
  const [reference, setReference] = useState("proposed");
  const [resamples, setResamples] = useState(10_000);
  const [metric, setMetric] = useState<string>("pr_auc");
  const query = useQuery({
    queryKey: ["stat-significance", run, split, reference, resamples],
    queryFn: () => getStatSignificance({ run, split, reference, resamples }),
  });
  const rows = useMemo(() => {
    if (!query.data) return [];
    return Object.entries(query.data.comparisons).map(([name, body]) => ({
      pipeline: name, label: query.data!.labels[name] ?? name,
      difference: body[metric].difference, ci_low: body[metric].ci_low, ci_high: body[metric].ci_high, p: body[metric].p_holm,
      mcnemar: body.mcnemar,
    })).sort((a, b) => b.difference - a.difference);
  }, [query.data, metric]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-[13px] text-ink-2">Reference
          <select value={reference} onChange={(e) => setReference(e.target.value)} className="h-9 rounded-lg border border-line bg-surface-alt px-2 text-ink">
            {pipelines.map((p) => <option key={p.pipeline} value={p.pipeline}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">Resamples
          <select value={resamples} onChange={(e) => setResamples(Number(e.target.value))} className="h-9 rounded-lg border border-line bg-surface-alt px-2 text-ink">
            {[1000, 2000, 10000, 20000].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Metric to compare">
          {METRICS.map((m) => <Pill key={m} active={metric === m} onClick={() => setMetric(m)}>{METRIC_LABELS[m]}</Pill>)}
        </div>
      </div>
      {query.isLoading ? <Skeleton className="h-80 w-full" /> : query.isError ? <ApiError error={query.error} /> : (
        <>
          <ForestPlot rows={rows} metric={METRIC_LABELS[metric]} alpha={query.data!.alpha} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Paired differences from the reference pipeline with McNemar's test on the flag decisions</caption>
              <thead><tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                <th className="py-2 pr-4 font-medium">Pipeline minus {query.data!.labels[reference] ?? reference}</th>
                <th className="py-2 pr-4 text-right font-medium">Difference</th><th className="py-2 pr-4 text-right font-medium">95% interval</th>
                <th className="py-2 pr-4 text-right font-medium">p (Holm)</th><th className="py-2 pr-4 text-right font-medium">McNemar p</th>
                <th className="py-2 font-medium">Reading</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const significant = r.p < query.data!.alpha;
                  return (
                    <tr key={r.pipeline} className="border-b border-line-soft">
                      <td className="py-2 pr-4">{r.label}</td>
                      <td className={cn("py-2 pr-4 text-right font-mono tabular", significant && (r.difference > 0 ? "text-ok" : "text-risk-text"))}>{r.difference > 0 ? "+" : ""}{num(r.difference)}</td>
                      <td className="py-2 pr-4 text-right font-mono text-xs tabular text-ink-2">{num(r.ci_low)} to {num(r.ci_high)}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular">{r.p < 0.001 ? "< 0.001" : num(r.p)}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular text-ink-2">{r.mcnemar.p_holm < 0.001 ? "< 0.001" : num(r.mcnemar.p_holm)}</td>
                      <td className="py-2 text-xs text-ink-3">{significant ? "the interval excludes zero" : "consistent with no difference"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <dl className="m-0 grid gap-x-8 gap-y-2 text-xs text-ink-3 sm:grid-cols-2">
            {Object.entries(query.data!.method).map(([key, value]) => (
              <div key={key}><dt className="inline font-medium text-ink-2">{key.replace(/_/g, " ")}: </dt><dd className="m-0 inline">{value}</dd></div>
            ))}
          </dl>
          {query.data!.recomputation_check ? (
            <p className="m-0 text-xs text-ink-3">
              Checked against the run's own <span className="font-mono">{query.data!.recomputation_check.artifact}</span>:{" "}
              {query.data!.recomputation_check.agrees ? "identical to within 1e-9." : `largest difference ${query.data!.recomputation_check.max_abs_difference?.toExponential(2)}.`}
            </p>
          ) : null}
          <SourceNote status={query.data!.provenance.status} runId={query.data!.provenance.run_id}>
            {query.data!.resamples.toLocaleString()} resamples, seed {query.data!.seed}, α = {query.data!.alpha}, Holm across {query.data!.comparisons_per_metric} comparisons per metric. {query.data!.provenance.note}
          </SourceNote>
        </>
      )}
    </div>
  );
}

function RankedTab({ run, split }: { run: string; split: string }) {
  const query = useQuery({ queryKey: ["stat-ranked", run, split], queryFn: () => getStatRanked({ run, split }) });
  if (query.isLoading) return <Skeleton className="h-80 w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;
  const shares = data.pipelines[0]?.rows ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
          <caption className="sr-only">Precision at the top of the ranked inspection list</caption>
          <thead><tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
            <th className="py-2 pr-4 font-medium">Pipeline</th>
            {shares.map((r) => <th key={r.k} className="py-2 pr-4 text-right font-medium">Top {r.k}<div className="normal-case tracking-normal text-ink-3">{(r.share * 100).toFixed(1)}%</div></th>)}
            <th className="py-2 pr-4 text-right font-medium">MAP@100</th><th className="py-2 text-right font-medium">MAP@200</th>
          </tr></thead>
          <tbody>
            {data.pipelines.map((p) => (
              <tr key={p.pipeline} className="border-b border-line-soft">
                <td className="py-2 pr-4">{p.label}</td>
                {p.rows.map((r) => (
                  <td key={r.k} className="py-2 pr-4 text-right font-mono text-xs tabular">
                    {num(r.precision)}<div className="text-ink-3">{r.found} found</div>
                  </td>
                ))}
                <td className="py-2 pr-4 text-right font-mono tabular">{num(p.map_at_100)}</td>
                <td className="py-2 text-right font-mono tabular">{num(p.map_at_200)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
        Precision at the top of the list is what an inspection team actually experiences: of the first k customers it visits, this share were theft-labelled. {data.provenance.note}
      </SourceNote>
    </div>
  );
}

function StabilityTab({ run }: { run: string }) {
  const query = useQuery({ queryKey: ["stat-stability", run], queryFn: () => getStatStability({ run }) });
  if (query.isLoading) return <Skeleton className="h-80 w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const sections = query.data!.sections;
  if (!sections.length) return <Empty title="This run holds no stability records" message="Run the robustness, hybrid-splits, nested-CV or CNN-checks experiments." />;
  return (
    <div className="flex flex-col gap-6">
      {sections.map((s) => (
        <div key={s.title} className="flex flex-col gap-3 rounded-lg border border-line bg-surface-alt p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="m-0 font-display text-[17px] font-medium">{s.title}</h3>
            <span className="font-mono text-xs text-ink-3">{s.artifact.split("/").pop()}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
              <thead><tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                <th className="py-2 pr-4 font-medium">Pipeline</th>
                {s.kind === "noise" ? (<><th className="py-2 pr-4 text-right font-medium">Min</th><th className="py-2 pr-4 text-right font-medium">Max</th><th className="py-2 pr-4 text-right font-medium">Range</th><th className="py-2 text-right font-medium">Trees kept</th></>)
                  : (<><th className="py-2 pr-4 text-right font-medium">Mean PR-AUC</th><th className="py-2 pr-4 text-right font-medium">SD</th>{s.kind === "per_seed" ? <th className="py-2 font-medium">Per split</th> : <th className="py-2 text-right font-medium">Pooled</th>}</>)}
              </tr></thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.pipeline} className="border-b border-line-soft">
                    <td className="py-2 pr-4">{r.pipeline}</td>
                    {s.kind === "noise" ? (
                      <>
                        <td className="py-2 pr-4 text-right font-mono tabular">{num(r.min, 4)}</td>
                        <td className="py-2 pr-4 text-right font-mono tabular">{num(r.max, 4)}</td>
                        <td className="py-2 pr-4 text-right font-mono tabular text-amber-ink">{num(r.range, 4)}</td>
                        <td className="py-2 text-right font-mono text-xs tabular text-ink-3">{(r.trees ?? []).join(", ")}</td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 pr-4 text-right font-mono tabular">{num(r.mean)}</td>
                        <td className="py-2 pr-4 text-right font-mono tabular text-ink-2">± {num(r.sd)}</td>
                        {s.kind === "per_seed"
                          ? <td className="py-2 font-mono text-xs tabular text-ink-3">{Object.values(r.per_seed ?? {}).map((v) => v.toFixed(3)).join(" · ")}</td>
                          : <td className="py-2 text-right font-mono tabular text-ink-2">{num(r.pooled)}</td>}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.wins ? <p className="m-0 text-xs text-ink-2">Hybrid ahead on: {Object.entries(s.wins).map(([k, v]) => `${v} of ${s.folds ?? s.seeds?.length ?? v} against ${k}`).join("; ")}.</p> : null}
          <p className="m-0 text-xs leading-relaxed text-ink-3">{s.caveat}</p>
        </div>
      ))}
      <SourceNote status="reported">Each section is read from the named record of the selected run.</SourceNote>
    </div>
  );
}

function CompareTab({ runs, split }: { runs: Array<{ run_id: string; label: string; evidence: string }>; split: string }) {
  const [a, setA] = useState(runs.find((r) => r.evidence === "recomputed")?.run_id ?? runs[0]?.run_id ?? "");
  const [b, setB] = useState(runs.find((r) => r.evidence === "executed")?.run_id ?? runs[0]?.run_id ?? "");
  const query = useQuery({ queryKey: ["stat-compare", a, b, split], queryFn: () => getStatCompare({ a, b, split }), enabled: Boolean(a && b) });
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {([["A", a, setA], ["B", b, setB]] as const).map(([name, value, set]) => (
          <label key={name} className="flex flex-col gap-1 text-[13px] text-ink-2">Run {name}
            <select value={value} onChange={(e) => set(e.target.value)} className="h-10 rounded-lg border border-line bg-surface-alt px-2 text-ink">
              {runs.map((r) => <option key={r.run_id} value={r.run_id}>{r.label} — {r.run_id.slice(4, 28)}</option>)}
            </select>
          </label>
        ))}
      </div>
      {query.isLoading ? <Skeleton className="h-72 w-full" /> : query.isError ? <ApiError error={query.error} /> : (
        <>
          <div className={cn("rounded-lg border px-4 py-3 text-[13px]", query.data!.same_customers ? "border-line bg-surface-alt text-ink-2" : "border-risk/40 bg-risk-bg text-risk-ink")}>
            {query.data!.note} Customer-id hash A <span className="font-mono text-xs">{query.data!.a.customer_ids_sha256.slice(0, 12)}…</span>, B <span className="font-mono text-xs">{query.data!.b.customer_ids_sha256.slice(0, 12)}…</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Metrics of each pipeline in run A and run B</caption>
              <thead><tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                <th className="py-2 pr-4 font-medium">Pipeline</th>
                {METRICS.map((m) => <th key={m} className="py-2 pr-4 text-right font-medium">{METRIC_LABELS[m]}<div className="normal-case tracking-normal text-ink-3">A · B · B−A</div></th>)}
              </tr></thead>
              <tbody>
                {query.data!.pipelines.map((row) => (
                  <tr key={row.pipeline} className="border-b border-line-soft">
                    <td className="py-2 pr-4">{row.label}</td>
                    {METRICS.map((m) => {
                      const cell = row.metrics[m];
                      return (
                        <td key={m} className="py-2 pr-4 text-right font-mono text-xs tabular">
                          {num(cell?.a)} · {num(cell?.b)} ·{" "}
                          <span className={cn(Math.abs(cell?.difference ?? 0) > 0.01 ? "text-amber-ink" : "text-ok")}>
                            {cell?.difference == null ? "–" : `${cell.difference > 0 ? "+" : ""}${cell.difference.toFixed(3)}`}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourceNote status={query.data!.b.evidence as never} runId={query.data!.b.run}>
            A is <EvidenceBadge status={query.data!.a.evidence} className="mx-1 align-middle" /> and B is <EvidenceBadge status={query.data!.b.evidence} className="mx-1 align-middle" />. Both columns are recomputed here from each run's saved predictions, so the difference is between the runs, not between two ways of counting.
          </SourceNote>
        </>
      )}
    </div>
  );
}

function LimitationsTab({ run }: { run: string }) {
  const query = useQuery({ queryKey: ["stat-limitations", run], queryFn: () => getStatLimitations({ run }) });
  if (query.isLoading) return <Skeleton className="h-80 w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  return (
    <div className="flex flex-col gap-4">
      {query.data!.limitations.map((item) => (
        <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-line bg-surface-alt p-5">
          <h3 className="m-0 font-display text-[17px] font-medium text-ink">{item.title}</h3>
          <p className="m-0 text-[13px] leading-relaxed text-ink-2">{item.detail}</p>
          <p className="m-0 text-[13px] leading-relaxed text-ink-3"><span className="font-medium text-ink-2">What limits the damage: </span>{item.mitigation}</p>
          {item.evidence ? <p className="m-0 rounded border border-line bg-surface px-3 py-2 font-mono text-xs text-cobalt-ink">{item.evidence}</p> : null}
        </div>
      ))}
      <SourceNote status="executed" runId={query.data!.run}>
        The texts are fixed; the figures quoted inside them are computed from the selected run's records.
      </SourceNote>
    </div>
  );
}

export function StatisticalEvaluationPage() {
  const runs = useQuery({ queryKey: ["stat-runs"], queryFn: getStatRuns });
  const [run, setRun] = useState("reported");
  const [split, setSplit] = useState("test");
  const [tab, setTab] = useState<Tab>("metrics");
  const pipelines = useQuery({ queryKey: ["stat-pipelines", run, split], queryFn: () => getStatPipelines({ run, split }) });
  const names = (pipelines.data?.pipelines ?? []).map((p) => ({ pipeline: p.pipeline, label: p.label }));
  const [selected, setSelected] = useState<string[] | null>(null);
  const chosen = selected ?? names.slice(0, 4).map((p) => p.pipeline);
  const runList = (runs.data ?? []).map((r) => ({ run_id: r.run_id, label: r.label, evidence: r.evidence }));
  const current = runs.data?.find((r) => r.run_id === run);

  return (
    <>
      <PageHeader eyebrow="Research" title="Statistical evaluation"
        description="Metrics, curves, calibration and paired tests, computed here from the predictions a sealed run saved. Thresholds and every other choice come from the validation customers; the test customers are only ever reported on." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Customers evaluated" value={pipelines.data?.customers.toLocaleString() ?? "…"} hint={`${split} split`} />
        <Stat label="Theft-labelled" value={pipelines.data?.theft ?? "…"} tone="risk" hint={pipelines.data ? `${((pipelines.data.theft / pipelines.data.customers) * 100).toFixed(2)}% of them` : undefined} />
        <Stat label="Pipelines" value={names.length || "…"} hint="scored on the same customers" />
        <Stat label="Evidence" value={<EvidenceBadge status={pipelines.data?.provenance.status ?? "pending"} />} hint={current?.label.slice(0, 48)} />
      </div>

      <Caveat title="What these intervals do and do not cover">
        The bootstrap resamples customers with the fitted models held fixed, so an interval covers the sampling variation of this
        one test set. It does not cover refitting the models (the numerical-variability experiment measures that), re-splitting the
        customers (the repeated splits measure that) or training on different hardware. Do not add the three together naively, and
        do not read a difference smaller than the numerical noise floor as a difference at all.
      </Caveat>

      <Card className="flex flex-col gap-5 p-6" label="Statistical evaluation">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex min-w-[280px] flex-col gap-1 text-[13px] text-ink-2">Run
            <select value={run} onChange={(e) => setRun(e.target.value)} className="h-10 rounded-lg border border-line bg-surface-alt px-2 text-ink">
              <option value="reported">Reported record (the original study)</option>
              {runList.filter((r) => r.evidence !== "recomputed").map((r) => <option key={r.run_id} value={r.run_id}>{r.label} — {r.run_id.slice(4, 28)}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Split">
            <Pill active={split === "test"} onClick={() => setSplit("test")}>Test customers</Pill>
            <Pill active={split === "validation"} onClick={() => setSplit("validation")}>Validation customers</Pill>
          </div>
        </div>

        {tab === "curves" && names.length ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Pipelines to draw">
            {names.map((p) => (
              <Pill key={p.pipeline} active={chosen.includes(p.pipeline)}
                onClick={() => setSelected(chosen.includes(p.pipeline) ? chosen.filter((n) => n !== p.pipeline) : [...chosen, p.pipeline])}>
                {p.label}
              </Pill>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1 border-b border-line" role="tablist" aria-label="Statistical views">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={cn("-mb-px border-b-2 px-3.5 py-2 text-[13px] font-medium transition-colors",
                tab === key ? "border-cobalt text-ink" : "border-transparent text-ink-3 hover:text-ink-2")}>
              {label}
            </button>
          ))}
        </div>

        <div role="tabpanel">
          {tab === "metrics" ? <MetricsTab run={run} split={split} /> : null}
          {tab === "curves" ? <CurvesTab run={run} split={split} selected={chosen} /> : null}
          {tab === "calibration" ? <CalibrationTab run={run} split={split} pipelines={names} /> : null}
          {tab === "significance" ? <SignificanceTab run={run} split={split} pipelines={names} /> : null}
          {tab === "ranked" ? <RankedTab run={run} split={split} /> : null}
          {tab === "stability" ? <StabilityTab run={run} /> : null}
          {tab === "compare" ? <CompareTab runs={runList} split={split} /> : null}
          {tab === "limitations" ? <LimitationsTab run={run} /> : null}
        </div>
      </Card>
    </>
  );
}
