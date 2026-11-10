import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RotateCcw } from "lucide-react";
import { ApiError, Button, Card, CardHeader, Empty, PageHeader, Pill, Skeleton, Stat } from "@/components/ui";
import { Caveat, EvidenceBadge, SourceNote } from "@/components/evidence";
import {
  PHASE_LABEL, REPORTED_RUN, compareRuns, getExperiments, getRegistryStatus, getRuns, startRun,
  type Experiment, type RunSummary, type Setting,
} from "@/lib/api/experiments";
import { useIsSupervisor } from "@/lib/me";
import { fmtDateTime, fmtNum, fmtSeconds } from "@/lib/format";
import { pipelineLabels } from "@/lib/palette";
import { cn } from "@/lib/cn";

const STATE_CLASS: Record<string, string> = {
  queued: "bg-tint text-ink-2",
  running: "bg-cobalt-bg text-cobalt-ink",
  succeeded: "bg-ok-bg text-ok",
  failed: "bg-risk-bg text-risk-text",
  interrupted: "bg-amber-bg text-amber-ink",
  reported: "bg-amber-bg text-amber-ink",
};

export function StateChip({ state }: { state: string }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em]", STATE_CLASS[state] ?? STATE_CLASS.queued)}>{state}</span>;
}

export function ProgressBar({ fraction, label }: { fraction: number | null | undefined; label: string }) {
  const value = Math.round(Math.max(0, Math.min(1, fraction ?? 0)) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-1.5 w-full overflow-hidden rounded-full bg-tint">
        <div className="h-full rounded-full bg-cobalt transition-[width] duration-500" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-ink-3">{label} · {value}%</span>
    </div>
  );
}

function SettingInput({ setting, value, onChange }: { setting: Setting; value: unknown; onChange: (v: unknown) => void }) {
  const id = `setting-${setting.name}`;
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-[13px] text-ink-2">
      {setting.label}
      {setting.type === "bool" ? (
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5" />
      ) : setting.type === "choice" ? (
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} className="h-10 rounded-lg border border-line bg-surface-alt px-3 text-ink">
          {(setting.choices ?? []).map((c) => <option key={String(c)} value={String(c)}>{String(c)}</option>)}
        </select>
      ) : (
        <input id={id} type="number" value={Number(value)} min={setting.minimum ?? undefined} max={setting.maximum ?? undefined}
          step={setting.type === "int" ? 1 : "any"} onChange={(e) => onChange(setting.type === "int" ? Math.round(Number(e.target.value)) : Number(e.target.value))}
          className="h-10 w-40 rounded-lg border border-line bg-surface-alt px-3 font-mono text-ink tabular" />
      )}
      <span className="text-xs text-ink-3">Registered default: <span className="font-mono">{String(setting.default)}</span></span>
    </label>
  );
}

function ExperimentPanel({ experiment, runs }: { experiment: Experiment; runs: RunSummary[] }) {
  const supervisor = useIsSupervisor();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(experiment.settings.map((s) => [s.name, s.default])));
  const [fromReported, setFromReported] = useState(false);
  const usesDefaults = experiment.settings.every((s) => values[s.name] === s.default);
  const start = useMutation({
    mutationFn: (retryOf?: string) => startRun(experiment.id, { settings: values, seed_from: fromReported ? [REPORTED_RUN] : undefined, retry_of: retryOf }),
    onSuccess: (run) => {
      void client.invalidateQueries({ queryKey: ["runs"] });
      void client.invalidateQueries({ queryKey: ["experiments"] });
      navigate(`/runs/${run.run_id}`);
    },
  });
  const blocked = experiment.missing_prerequisites.length > 0 && !fromReported;
  const willVerify = experiment.protocol === "original" && usesDefaults && !fromReported;
  const lastFailed = runs.find((r) => r.state === "failed" || r.state === "interrupted");

  return (
    <Card className="flex flex-col gap-5 p-6" label={experiment.title}>
      <CardHeader title={experiment.title} subtitle={<span className="font-mono text-xs">{experiment.id} · v{experiment.version} · definition {experiment.sha256.slice(0, 12)}</span>}
        action={<EvidenceBadge status={experiment.protocol === "original" ? "executed" : "exploratory"} />} />
      <p className="m-0 max-w-4xl text-sm leading-relaxed text-ink-2">{experiment.summary}</p>

      <dl className="m-0 grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
        <div><dt className="text-ink-3">Protocol</dt><dd className="m-0">{experiment.protocol === "original" ? "Original study protocol" : "Exploratory (outside the protocol)"}</dd></div>
        <div><dt className="text-ink-3">Origin</dt><dd className="m-0">{PHASE_LABEL[experiment.phase]}</dd></div>
        <div><dt className="text-ink-3">Typical runtime (4 CPU threads)</dt><dd className="m-0 font-mono tabular">about {experiment.expected_minutes} min</dd></div>
        <div><dt className="text-ink-3">Evidence for</dt><dd className="m-0">{experiment.thesis.length ? experiment.thesis.join(", ") : "not a thesis item"}</dd></div>
        <div className="sm:col-span-2"><dt className="text-ink-3">Command</dt><dd className="m-0 break-all font-mono text-xs">python {experiment.command.join(" ")}</dd></div>
        <div className="sm:col-span-2"><dt className="text-ink-3">Needs a finished run of</dt><dd className="m-0 font-mono text-xs">{experiment.needs.length ? experiment.needs.join(", ") : "nothing (starts from the dataset)"}</dd></div>
      </dl>

      {experiment.pipelines.length ? (
        <div className="flex flex-wrap gap-2" aria-label="Pipelines this experiment fits or compares">
          {experiment.pipelines.map((p) => <span key={p} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2">{pipelineLabels[p] ?? p}</span>)}
        </div>
      ) : null}

      {experiment.leakage_controls.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">Leakage controls in this protocol</span>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-relaxed text-ink-2">
            {experiment.leakage_controls.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-alt p-4">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">Start a run</span>
        {experiment.settings.length ? (
          <div className="flex flex-wrap gap-6">
            {experiment.settings.map((s) => <SettingInput key={s.name} setting={s} value={values[s.name]} onChange={(v) => setValues((old) => ({ ...old, [s.name]: v }))} />)}
          </div>
        ) : <p className="m-0 text-[13px] text-ink-3">This experiment has no adjustable settings: its configuration is the registered one.</p>}
        {experiment.can_recompute_from_reported ? (
          <label className="flex items-start gap-2.5 text-[13px] text-ink-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={fromReported} onChange={(e) => setFromReported(e.target.checked)} />
            <span>Use the original study's published files as inputs instead of a rerun. The result is a <strong className="text-ink">recomputation</strong>: it checks the arithmetic, not the training, and cannot verify a finding.</span>
          </label>
        ) : null}
        <p className="m-0 text-[13px] text-ink-2">
          {willVerify
            ? "With the registered settings and rerun inputs, this run is eligible to verify or contradict the reported findings it is evidence for."
            : "This run will be recorded as exploratory or recomputed evidence. It cannot change the status of a reported finding."}
        </p>
        {blocked ? <p className="m-0 text-[13px] text-amber-ink">Run {experiment.missing_prerequisites.join(", ")} first, or tick the box above to recompute from the published files.</p> : null}
        {start.isError ? <ApiError error={start.error} title="The run was not started" /> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" busy={start.isPending} disabled={!supervisor || blocked || Boolean(experiment.active)} onClick={() => start.mutate(undefined)}>
            <Play className="h-4 w-4" aria-hidden /> Queue this run
          </Button>
          {lastFailed && supervisor ? (
            <Button busy={start.isPending} disabled={blocked || Boolean(experiment.active)} onClick={() => start.mutate(lastFailed.run_id)}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Retry {lastFailed.state} run as a new run
            </Button>
          ) : null}
          {!supervisor ? <span className="text-[13px] text-ink-3">Starting runs needs the supervisor role.</span> : null}
          {experiment.active ? <Link className="text-[13px] text-cobalt underline-offset-2 hover:underline" to={`/runs/${experiment.active}`}>A run of this experiment is in progress</Link> : null}
        </div>
      </div>
    </Card>
  );
}

function RunsTable({ runs, selected, onToggle }: { runs: RunSummary[]; selected: string[]; onToggle: (id: string) => void }) {
  if (!runs.length) return <Empty title="No runs yet" message="Queue a run above; it appears here with live progress." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
            <th className="w-10 py-2.5 pr-2 font-medium"><span className="sr-only">Compare</span></th>
            <th className="py-2.5 pr-4 font-medium">Run</th><th className="py-2.5 pr-4 font-medium">Experiment</th>
            <th className="py-2.5 pr-4 font-medium">State</th><th className="py-2.5 pr-4 font-medium">Evidence</th>
            <th className="py-2.5 pr-4 font-medium">Findings checked</th><th className="py-2.5 pr-4 font-medium">Runtime</th>
            <th className="py-2.5 pr-4 font-medium">Seal</th><th className="py-2.5 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.run_id} className="border-b border-line-soft align-top">
              <td className="py-3 pr-2">
                <input type="checkbox" aria-label={`Select ${run.run_id} for comparison`} checked={selected.includes(run.run_id)} onChange={() => onToggle(run.run_id)} className="h-4 w-4" />
              </td>
              <td className="py-3 pr-4"><Link to={`/runs/${run.run_id}`} className="font-mono text-xs text-cobalt underline-offset-2 hover:underline">{run.run_id}</Link>
                {run.retry_of ? <div className="text-xs text-ink-3">retry of {run.retry_of}</div> : null}</td>
              <td className="py-3 pr-4 font-mono text-xs">{run.experiment_id}</td>
              <td className="py-3 pr-4"><StateChip state={run.state} />
                {run.state === "running" ? <div className="mt-2 w-44"><ProgressBar fraction={run.progress?.fraction} label={run.progress?.stage ?? "Running"} /></div> : null}
                {run.error ? <div className="mt-1 max-w-xs text-xs text-risk-text">{run.error}</div> : null}</td>
              <td className="py-3 pr-4"><EvidenceBadge status={run.evidence} /></td>
              <td className="py-3 pr-4 font-mono text-xs tabular">
                {run.findings ? (
                  <span><span className="text-ok">{run.findings.exact} exact</span> · {run.findings.within_tolerance} in tolerance · <span className={run.findings.discrepant ? "text-risk-text" : ""}>{run.findings.discrepant} discrepant</span></span>
                ) : <span className="text-ink-3">none</span>}
              </td>
              <td className="py-3 pr-4 font-mono tabular">{run.runtime_seconds != null ? fmtSeconds(run.runtime_seconds) : "–"}</td>
              <td className="py-3 pr-4">{run.integrity?.sealed ? (run.integrity.intact ? <span className="text-ok">sealed, intact</span> : <span className="text-risk-text">seal broken</span>) : <span className="text-ink-3">open</span>}</td>
              <td className="py-3 text-ink-2">{fmtDateTime(run.created_at)}<div className="text-xs text-ink-3">{run.created_by}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COMPARE_METRICS: Array<[string, string]> = [["pr_auc", "PR-AUC"], ["auc", "ROC-AUC"], ["recall", "Recall"], ["precision", "Precision"], ["f1", "F1"], ["mcc", "MCC"], ["threshold", "Threshold"], ["training_time", "Train s"], ["inference_ms_per_customer", "ms / customer"]];

function Comparison({ a, b }: { a: string; b: string }) {
  const query = useQuery({ queryKey: ["compare-runs", a, b], queryFn: () => compareRuns(a, b) });
  if (query.isLoading) return <Skeleton className="h-48 w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const rows = query.data?.pipelines ?? [];
  if (!rows.length) return <Empty title="Neither run has a pipeline comparison table" message="Choose two training runs (or the reported record and a training run)." />;
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-[13px]">
          <caption className="sr-only">Test metrics of each pipeline in run A and run B, and B minus A</caption>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
              <th className="py-2.5 pr-4 font-medium">Pipeline</th>
              {COMPARE_METRICS.map(([key, label]) => <th key={key} className="py-2.5 pr-4 text-right font-medium">{label}<div className="normal-case tracking-normal text-ink-3">A · B · B−A</div></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.pipeline} className="border-b border-line-soft">
                <td className="py-2.5 pr-4">{row.label ?? row.pipeline}</td>
                {COMPARE_METRICS.map(([key]) => {
                  const m = row.metrics[key];
                  const digits = key === "training_time" ? 1 : 3;
                  const hardware = key === "training_time" || key === "inference_ms_per_customer";
                  return (
                    <td key={key} className="py-2.5 pr-4 text-right font-mono text-xs tabular">
                      {fmtNum(m?.a, digits)} · {fmtNum(m?.b, digits)} · <span className={cn(hardware ? "text-ink-3" : Math.abs(m?.difference ?? 0) > 0.002 ? "text-amber-ink" : "text-ok")}>{m?.difference == null ? "–" : `${m.difference > 0 ? "+" : ""}${m.difference.toFixed(digits)}`}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SourceNote status="executed">A = <span className="font-mono">{a}</span>, B = <span className="font-mono">{b}</span>. Read from each run's sealed comparison file. Training and inference times depend on the machine and are never treated as reproduced.</SourceNote>
    </div>
  );
}

export function ExperimentManagerPage() {
  const experiments = useQuery({ queryKey: ["experiments"], queryFn: getExperiments });
  const anyActive = (experiments.data ?? []).some((e) => e.active);
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => getRuns(), refetchInterval: anyActive ? 4000 : 30_000 });
  const status = useQuery({ queryKey: ["registry-status"], queryFn: getRegistryStatus, refetchInterval: 10_000 });
  const [selectedId, setSelectedId] = useState<string>("train.full");
  const [phase, setPhase] = useState<"all" | Experiment["phase"]>("all");
  const [compare, setCompare] = useState<string[]>([]);

  const list = useMemo(() => (experiments.data ?? []).filter((e) => phase === "all" || e.phase === phase), [experiments.data, phase]);
  const selected = (experiments.data ?? []).find((e) => e.id === selectedId) ?? list[0];
  const allRuns = runs.data ?? [];
  const toggle = (id: string) => setCompare((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old.slice(-1), id]));

  return (
    <>
      <PageHeader eyebrow="Research" title="ML experiment manager"
        description="Every experiment of the study is registered with its exact command and protocol. A run executes in its own workspace, reports real progress, and is sealed with SHA-256 hashes when it ends. Runs are never edited or overwritten." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Registered experiments" value={experiments.data?.length ?? "…"} hint="versioned definitions in registry/experiments" />
        <Stat label="Runs on record" value={status.data?.runs ?? "…"} hint="including the reported record" />
        <Stat label="Running now" value={status.data?.running.length ?? "…"} tone="cobalt" hint={status.data?.runner_alive ? "runner alive" : "runner idle"} />
        <Stat label="Queued" value={status.data?.queued.length ?? "…"} hint="one run executes at a time" />
      </div>

      <Caveat title="What a rerun can and cannot show">
        A rerun on this machine uses the same data, code, seeds and library versions as the original study, on different hardware. Tree and neural-network training are not bit-reproducible across CPUs and thread counts, so a rerun tests whether a result is stable, not whether the same digits come out. Each finding carries a tolerance fixed before any rerun; see the registry page.
      </Caveat>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="flex flex-col gap-4 p-5" label="Registered experiments">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter experiments by origin">
            <Pill active={phase === "all"} onClick={() => setPhase("all")}>All</Pill>
            <Pill active={phase === "proposed_study"} onClick={() => setPhase("proposed_study")}>Proposed study</Pill>
            <Pill active={phase === "documented_extension"} onClick={() => setPhase("documented_extension")}>Extensions</Pill>
            <Pill active={phase === "new"} onClick={() => setPhase("new")}>New</Pill>
          </div>
          {experiments.isLoading ? <Skeleton className="h-72 w-full" /> : experiments.isError ? <ApiError error={experiments.error} /> : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {list.map((e) => (
                <li key={e.id}>
                  <button type="button" aria-current={selected?.id === e.id} onClick={() => setSelectedId(e.id)}
                    className={cn("flex w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selected?.id === e.id ? "border-cobalt bg-cobalt-soft" : "border-transparent hover:bg-tint")}>
                    <span className="text-[13px] font-medium leading-snug text-ink">{e.title}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                      <span className="font-mono">{e.id}</span>
                      <span>{e.runs} run{e.runs === 1 ? "" : "s"}</span>
                      {e.active ? <span className="text-cobalt-ink">running</span> : null}
                      {e.protocol === "exploratory" ? <span className="text-violet">exploratory</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {selected ? <ExperimentPanel key={selected.id} experiment={selected} runs={allRuns.filter((r) => r.experiment_id === selected.id)} /> : <Skeleton className="h-96 w-full" />}
      </div>

      <Card className="flex flex-col gap-4 p-6" label="Runs">
        <CardHeader title="Run history" subtitle="Newest first. Tick two runs to compare their pipelines' test metrics." />
        {runs.isLoading ? <Skeleton className="h-64 w-full" /> : runs.isError ? <ApiError error={runs.error} /> : <RunsTable runs={allRuns} selected={compare} onToggle={toggle} />}
      </Card>

      {compare.length === 2 ? (
        <Card className="flex flex-col gap-4 p-6" label="Run comparison">
          <CardHeader title="Run comparison" subtitle="Each pipeline's test metrics in the two selected runs" />
          <Comparison a={compare[1]} b={compare[0]} />
        </Card>
      ) : null}
    </>
  );
}
