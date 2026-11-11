import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiError, Card, CardHeader, PageHeader, Pill, Skeleton, Stat } from "@/components/ui";
import { Caveat, EvidenceBadge, SourceNote } from "@/components/evidence";
import { getConclusions, getLedger, getRegistryStatus, getRuns, type Conclusion, type Finding } from "@/lib/api/experiments";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";

type StatusFilter = "all" | Finding["status"];

function signed(value: number | null | undefined, digits: number) {
  if (value == null) return "–";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

/** Reported value, tolerance band and the rerun value on one small axis. */
function ToleranceMark({ finding }: { finding: Finding }) {
  const latest = finding.latest;
  if (!latest || latest.observed == null) return <span className="text-xs text-ink-3">not rerun</span>;
  const tolerance = Math.max(finding.tolerance, 10 ** -finding.decimals / 2);
  const span = Math.max(tolerance * 2.5, Math.abs(latest.observed - finding.reported) * 1.25);
  const x = (v: number) => 60 + ((v - finding.reported) / span) * 56;
  const inside = latest.outcome !== "discrepant";
  return (
    <svg width="120" height="18" role="img" aria-label={`Rerun ${latest.observed.toFixed(4)} against reported ${finding.reported}, tolerance ${finding.tolerance}: ${latest.outcome.replace("_", " ")}`}>
      <rect x={x(finding.reported - tolerance)} y="5" width={x(finding.reported + tolerance) - x(finding.reported - tolerance)} height="8" rx="2" className="fill-tint" />
      <line x1="60" x2="60" y1="2" y2="16" className="stroke-ink-3" strokeWidth="1" />
      <circle cx={Math.max(4, Math.min(116, x(latest.observed)))} cy="9" r="3.5" className={inside ? "fill-ok" : "fill-risk"} />
    </svg>
  );
}

function FindingsTable({ findings }: { findings: Finding[] }) {
  return (
    <div className="max-h-[640px] overflow-auto">
      <table className="w-full min-w-[1080px] border-collapse text-left text-[13px]">
        <caption className="sr-only">Each reported finding with the newest eligible rerun's value</caption>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
            <th className="py-2.5 pr-4 font-medium">Finding</th><th className="py-2.5 pr-4 font-medium">Status</th>
            <th className="py-2.5 pr-4 text-right font-medium">Reported</th><th className="py-2.5 pr-4 text-right font-medium">Rerun</th>
            <th className="py-2.5 pr-4 text-right font-medium">Difference</th><th className="py-2.5 pr-4 text-right font-medium">Tolerance</th>
            <th className="py-2.5 pr-4 font-medium">Reported · band · rerun</th><th className="py-2.5 font-medium">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => {
            const digits = Math.max(f.decimals + 1, 0);
            return (
              <tr key={f.id} className="border-b border-line-soft align-top">
                <td className="max-w-[420px] py-2.5 pr-4">
                  <div className="leading-snug">{f.claim}</div>
                  <div className="mt-0.5 text-xs text-ink-3"><span className="font-mono">{f.id}</span> · {f.source}{f.thesis.length ? ` · ${f.thesis.join(", ")}` : ""}</div>
                  {f.note ? <div className="mt-0.5 text-xs text-ink-3">{f.note}</div> : null}
                </td>
                <td className="py-2.5 pr-4"><EvidenceBadge status={f.status} />{f.latest?.outcome === "exact" ? <div className="mt-1 text-xs text-ink-3">exact</div> : f.latest?.outcome === "within_tolerance" ? <div className="mt-1 text-xs text-ink-3">in tolerance</div> : null}</td>
                <td className="py-2.5 pr-4 text-right font-mono tabular">{f.reported}</td>
                <td className="py-2.5 pr-4 text-right font-mono tabular">{f.latest?.observed == null ? "–" : fmtNum(f.latest.observed, digits)}</td>
                <td className={cn("py-2.5 pr-4 text-right font-mono tabular", f.status === "discrepant" && "text-risk-text")}>{signed(f.latest?.difference, digits)}</td>
                <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-3">±{f.tolerance}<div className="text-[11px]">{f.class}</div></td>
                <td className="py-2.5 pr-4"><ToleranceMark finding={f} /></td>
                <td className="py-2.5 text-xs">
                  {f.latest ? <Link className="font-mono text-cobalt underline-offset-2 hover:underline" to={`/runs/${f.latest.run_id}`}>{f.latest.run_id.slice(4, 19)}…</Link> : <span className="text-ink-3">{f.experiment}</span>}
                  <div className="font-mono text-ink-3">{f.artifact.split("/").pop()}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function describe(detail: Conclusion["rerun"]["detail"]): string {
  if ("unavailable" in detail) return String(detail.unavailable);
  if ("p" in detail) return `difference ${signed(detail.difference as number, 3)} (95% CI ${signed(detail.ci_low as number, 3)} to ${signed(detail.ci_high as number, 3)}), Holm p = ${(detail.p as number) < 0.001 ? "< 0.001" : (detail.p as number).toFixed(3)}`;
  if ("values" in detail) return (detail.values as number[]).map((v) => v.toFixed(3)).join(" → ");
  if ("expected" in detail) return `${detail.value} (expected ${detail.expected})`;
  if ("best" in detail) return `best: ${detail.best} (${(detail.value as number).toFixed(3)}); next: ${detail.runner_up} (${(detail.runner_up_value as number).toFixed(3)})`;
  if ("a" in detail) return `${(detail.a as number).toFixed(3)} against ${(detail.b as number).toFixed(3)} (${signed(detail.difference as number, 3)})`;
  return "";
}

const OUTCOME: Record<Conclusion["outcome"], { label: string; className: string }> = {
  holds: { label: "Holds in the rerun", className: "border-ok/40 bg-ok-bg text-ok" },
  does_not_hold: { label: "Does not hold in the rerun", className: "border-risk/40 bg-risk-bg text-risk-text" },
  not_rerun: { label: "Not rerun", className: "border-line bg-tint text-ink-3" },
  not_supported_by_reported_record: { label: "Not supported by the reported record", className: "border-amber/40 bg-amber-bg text-amber-ink" },
};

export function RegistryPage() {
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: getLedger });
  const conclusions = useQuery({ queryKey: ["conclusions"], queryFn: getConclusions });
  const status = useQuery({ queryKey: ["registry-status"], queryFn: getRegistryStatus });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => getRuns() });
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [group, setGroup] = useState<string>("all");
  const [search, setSearch] = useState("");

  const findings = ledger.data?.findings ?? [];
  const groups = useMemo(() => Array.from(new Set(findings.map((f) => f.experiment))).sort(), [findings]);
  const shown = useMemo(() => findings.filter((f) =>
    (filter === "all" || f.status === filter) && (group === "all" || f.experiment === group)
    && (!search || `${f.claim} ${f.id} ${f.source}`.toLowerCase().includes(search.toLowerCase()))), [findings, filter, group, search]);
  const summary = ledger.data?.summary;
  const sealed = (runs.data ?? []).filter((r) => r.integrity?.sealed);
  const broken = sealed.filter((r) => r.integrity?.intact === false);

  return (
    <>
      <PageHeader eyebrow="Record" title="Model registry and provenance"
        description="What the original study reported, what a rerun on this machine produced, and whether the two agree. A reported number becomes verified only when a sealed rerun under the original protocol lands inside a tolerance fixed before the rerun." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Reported findings tracked" value={summary?.findings ?? "…"} hint="numbers typed from the study's documents" />
        <Stat label="Verified" value={summary?.verified ?? "…"} tone="cobalt" hint={summary ? `${summary.verified_exactly} to the reported digit` : undefined} />
        <Stat label="Discrepant" value={summary?.discrepant ?? "…"} tone="risk" hint="outside the predeclared tolerance" />
        <Stat label="Not yet rerun" value={summary?.reported ?? "…"} hint="still reported only" />
        <Stat label="Sealed runs intact" value={runs.data ? `${sealed.length - broken.length}/${sealed.length}` : "…"} tone={broken.length ? "risk" : "ink"} hint={broken.length ? "a seal is broken; that run is excluded" : "every file matches its seal"} />
      </div>

      <Caveat title="How to read a discrepancy">
        Data, split, features, SMOTE+ENN row counts, the untuned XGBoost and the random forest reproduce bit for bit. The two tuned XGBoost pipelines and the CNN do not, with the same library versions and seeds: tree and network training are not bit-reproducible across CPUs and thread counts, and Optuna's search path follows those small differences. The tolerance for the tuned models (0.002) was declared on the assumption that they would reproduce exactly; that assumption was wrong, and the tolerance has not been widened after the fact. The experiment <span className="font-mono">numerics.threads</span> measures the noise this introduces.
      </Caveat>

      <Card className="flex flex-col gap-4 p-6" label="Conclusions">
        <CardHeader title="Do the study's conclusions hold?" subtitle={conclusions.data ? `${conclusions.data.summary.holds} of ${conclusions.data.summary.conclusions} hold in the rerun · ${conclusions.data.summary.does_not_hold} do not · α = ${conclusions.data.alpha}` : "…"}
          action={<EvidenceBadge status="exploratory" />} />
        <p className="m-0 max-w-4xl text-[13px] leading-relaxed text-ink-2">
          These checks are <strong className="text-ink">post hoc</strong>: they were written {conclusions.data?.written ?? "after the first rerun"}, once it was clear the digits would not match. Each is mechanical (a sign, a significance test, an ordering, a count) and is applied identically to the reported record and to the newest eligible rerun. Agreement here is weaker evidence than a predeclared check.
        </p>
        {conclusions.isLoading ? <Skeleton className="h-64 w-full" /> : conclusions.isError ? <ApiError error={conclusions.error} /> : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {[...(conclusions.data?.conclusions ?? [])].sort((a, b) => Number(a.outcome === "holds") - Number(b.outcome === "holds")).map((c) => (
              <li key={c.id} className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-alt px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span className="max-w-4xl text-sm leading-snug"><span className="mr-2 font-mono text-xs text-ink-3">{c.id}</span>{c.statement}</span>
                  <span className={cn("inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em]", OUTCOME[c.outcome].className)}>{OUTCOME[c.outcome].label}</span>
                </div>
                <div className="grid gap-x-8 gap-y-1 text-xs text-ink-2 md:grid-cols-2">
                  <span><span className="text-amber-ink">Reported record:</span> <span className="font-mono">{describe(c.reported.detail)}</span></span>
                  <span><span className="text-cobalt-ink">Rerun:</span> <span className="font-mono">{describe(c.rerun.detail)}</span>{c.rerun_run_id ? <Link className="ml-2 text-cobalt underline-offset-2 hover:underline" to={`/runs/${c.rerun_run_id}`}>run</Link> : null}</span>
                </div>
                <span className="text-xs text-ink-3">{c.source} · {c.thesis.join(", ")} · {c.experiment}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-6" label="Findings ledger">
        <CardHeader title="Findings ledger" subtitle="Every reported number, its predeclared tolerance, and the newest eligible rerun" />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter findings by status">
            {(["all", "discrepant", "verified", "reported"] as StatusFilter[]).map((s) => (
              <Pill key={s} active={filter === s} onClick={() => setFilter(s)}>{s === "all" ? `All (${findings.length})` : `${s[0].toUpperCase()}${s.slice(1)} (${findings.filter((f) => f.status === s).length})`}</Pill>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-2 text-[13px] text-ink-2">Experiment
            <select value={group} onChange={(e) => setGroup(e.target.value)} className="h-9 rounded-lg border border-line bg-surface-alt px-2 text-ink">
              <option value="all">All</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">Search
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="PR-AUC, hybrid, ECE…" className="h-9 w-48 rounded-lg border border-line bg-surface-alt px-3 text-ink placeholder:text-ink-3" />
          </label>
        </div>
        {ledger.isLoading ? <Skeleton className="h-96 w-full" /> : ledger.isError ? <ApiError error={ledger.error} /> : <FindingsTable findings={shown} />}
        <SourceNote status="executed">
          {shown.length} of {findings.length} findings shown. Reported values are typed from the study's documents; all {findings.length} agree with the study's published result files
          {summary?.document_differs_from_reported_artifact.length ? ` except ${summary.document_differs_from_reported_artifact.join(", ")}` : ""}. Findings file SHA-256 <span className="font-mono">{summary?.findings_sha256.slice(0, 16)}…</span>
          {ledger.data?.excluded_runs.length ? ` Runs excluded for a broken seal: ${ledger.data.excluded_runs.join(", ")}.` : ""}
        </SourceNote>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="flex flex-col gap-4 p-6" label="Datasets">
          <CardHeader title="Registered datasets" subtitle="A run on any other file can never verify a finding" />
          {status.isLoading ? <Skeleton className="h-40 w-full" /> : status.isError ? <ApiError error={status.error} /> : Object.entries(status.data?.datasets ?? {}).map(([key, d]) => (
            <div key={key} className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-alt px-4 py-3 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{d.title}</span><EvidenceBadge status="observed" /></div>
              <span className="break-all font-mono text-xs text-ink-2">{d.file} · sha256 {d.sha256}</span>
              <span className="text-ink-2">{d.customers.toLocaleString()} customers · {d.labelled ? "labelled (research only)" : "unlabelled (operations)"}</span>
              <span className="text-xs leading-relaxed text-ink-3">{d.source}</span>
              {d.caveats?.length ? <ul className="m-0 list-disc pl-5 text-xs leading-relaxed text-ink-3">{d.caveats.map((c) => <li key={c}>{c}</li>)}</ul> : null}
            </div>
          ))}
        </Card>

        <Card className="flex flex-col gap-4 p-6" label="Sealed runs">
          <CardHeader title="Sealed runs" subtitle="Each seal is a SHA-256 over every file of the run; a copy is kept in the database" />
          {runs.isLoading ? <Skeleton className="h-40 w-full" /> : runs.isError ? <ApiError error={runs.error} /> : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-surface"><tr className="border-b border-line uppercase tracking-[0.06em] text-ink-3"><th className="py-2 pr-3 font-medium">Run</th><th className="py-2 pr-3 font-medium">Evidence</th><th className="py-2 pr-3 font-medium">Seal</th><th className="py-2 font-medium">Sealed</th></tr></thead>
                <tbody>
                  {sealed.map((r) => (
                    <tr key={r.run_id} className="border-b border-line-soft">
                      <td className="py-2 pr-3"><Link className="font-mono text-cobalt underline-offset-2 hover:underline" to={`/runs/${r.run_id}`}>{r.run_id}</Link></td>
                      <td className="py-2 pr-3"><EvidenceBadge status={r.evidence} /></td>
                      <td className={cn("py-2 pr-3 font-mono", r.integrity?.intact ? "text-ink-2" : "text-risk-text")} title={r.integrity?.seal_sha256}>{r.integrity?.intact ? `${r.integrity.seal_sha256?.slice(0, 12)}…` : "BROKEN"}</td>
                      <td className="py-2 text-ink-3">{fmtDateTime(r.integrity?.sealed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
