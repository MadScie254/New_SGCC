import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { ApiError, Button, Card, CardHeader, Empty, PageHeader, Skeleton } from "@/components/ui";
import { EvidenceBadge } from "@/components/evidence";
import { getRun, getRunEvents, getRunFile, verifyRun, type FileEntry, type RunDetail, type RunEvent } from "@/lib/api/experiments";
import { ProgressBar, StateChip } from "@/pages/lab/ExperimentManager";
import { useIsSupervisor } from "@/lib/me";
import { fmtDateTime, fmtNum, fmtSeconds } from "@/lib/format";
import { cn } from "@/lib/cn";

function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className={cn("m-0 break-all text-[13px]", mono && "font-mono text-xs")}>{children}</dd>
    </div>
  );
}

function LiveLog({ runId, live }: { runId: string; live: boolean }) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const next = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const query = useQuery({
    queryKey: ["run-events", runId],
    queryFn: async () => {
      const page = await getRunEvents(runId, next.current);
      if (page.events.length) {
        next.current = page.next;
        setEvents((old) => [...old, ...page.events].slice(-3000));
      }
      return page;
    },
    refetchInterval: live ? 2000 : false,
  });
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [events, follow]);
  if (query.isError) return <ApiError error={query.error} />;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
        <span>{events.length.toLocaleString()} events{live ? " · updating every 2 s" : ""}</span>
        <label className="flex items-center gap-2"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow the end</label>
      </div>
      <div ref={box} tabIndex={0} role="log" aria-label="Run output" className="h-[360px] overflow-auto rounded-lg border border-line bg-night p-3 font-mono text-[11.5px] leading-relaxed">
        {events.length === 0 ? <span className="text-ink-3">{query.isLoading ? "Loading…" : "No output yet."}</span> : events.map((e) => (
          <div key={e.seq} className={cn("whitespace-pre-wrap break-words", e.level === "error" ? "text-risk-text" : e.level === "warning" ? "text-amber-ink" : "text-night-text")}>
            <span className="select-none text-night-muted">{e.at.slice(11, 19)} </span>{e.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function Files({ title, files, runId, readable }: { title: string; files: Record<string, FileEntry>; runId: string; readable: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const file = useQuery({ queryKey: ["run-file", runId, open], queryFn: () => getRunFile(runId, open as string), enabled: Boolean(open) });
  const names = Object.keys(files).sort();
  if (!names.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">{title} ({names.length})</span>
      <div className="max-h-72 overflow-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-left text-xs">
          <tbody>
            {names.map((name) => {
              const canRead = readable && /\.(json|md|yaml|csv)$/.test(name);
              return (
                <tr key={name} className="border-b border-line-soft last:border-0">
                  <td className="px-3 py-1.5 font-mono">
                    {canRead ? <button type="button" className="text-left text-cobalt underline-offset-2 hover:underline" onClick={() => setOpen(open === name ? null : name)} aria-expanded={open === name}>{name}</button> : name}
                    {files[name].from ? <span className="ml-2 text-ink-3">from {files[name].from}</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink-3" title={files[name].sha256}>{files[name].sha256.slice(0, 16)}…</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open ? (
        file.isLoading ? <Skeleton className="h-40 w-full" /> : file.isError ? <ApiError error={file.error} /> : (
          <pre tabIndex={0} aria-label={`Contents of ${open}`} className="m-0 max-h-96 overflow-auto rounded-lg border border-line bg-night p-3 text-[11.5px] leading-relaxed text-night-text">
            {file.data?.json != null ? JSON.stringify(file.data.json, null, 2).slice(0, 60_000) : (file.data?.text ?? "").slice(0, 60_000)}
          </pre>
        )
      ) : null}
    </div>
  );
}

function FindingChecks({ run }: { run: RunDetail }) {
  const checks = run.finding_checks;
  if (!checks.length) return <Empty title="This run is not evidence for a listed finding" message="Only experiments named in the findings ledger are checked against reported values." />;
  const order = { discrepant: 0, missing: 1, within_tolerance: 2, exact: 3 } as const;
  const sorted = [...checks].sort((a, b) => order[a.outcome] - order[b.outcome]);
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[13px] leading-relaxed text-ink-2">
        {run.state === "reported"
          ? "For the reported record this compares the number printed in the study's documents with the number in its published result files."
          : run.eligible_to_verify
            ? "This run is eligible to verify findings: original protocol, registered settings, registered dataset, rerun inputs. Tolerances were declared before the rerun."
            : `This run cannot verify a finding: ${(run.eligibility_reasons ?? []).join("; ") || "not eligible"}. The comparison is shown for information.`}
      </p>
      <div className="max-h-[460px] overflow-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
              <th className="py-2 pr-4 font-medium">Finding</th><th className="py-2 pr-4 text-right font-medium">Reported</th>
              <th className="py-2 pr-4 text-right font-medium">This run</th><th className="py-2 pr-4 text-right font-medium">Difference</th>
              <th className="py-2 pr-4 text-right font-medium">Tolerance</th><th className="py-2 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.finding_id} className="border-b border-line-soft">
                <td className="py-2 pr-4 font-mono text-xs">{c.finding_id}</td>
                <td className="py-2 pr-4 text-right font-mono tabular">{c.reported}</td>
                <td className="py-2 pr-4 text-right font-mono tabular">{c.observed == null ? "–" : fmtNum(c.observed, Math.max(c.decimals + 1, 0))}</td>
                <td className="py-2 pr-4 text-right font-mono tabular">{c.difference == null ? "–" : `${c.difference > 0 ? "+" : ""}${c.difference.toFixed(Math.max(c.decimals + 1, 0))}`}</td>
                <td className="py-2 pr-4 text-right font-mono tabular text-ink-3">±{c.tolerance}</td>
                <td className="py-2"><EvidenceBadge status={c.outcome === "discrepant" ? "discrepant" : c.outcome === "missing" ? "pending" : "verified"} />{c.outcome === "exact" ? <span className="ml-2 text-xs text-ink-3">exact</span> : c.outcome === "within_tolerance" ? <span className="ml-2 text-xs text-ink-3">in tolerance</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RunDetailPage() {
  const { runId = "" } = useParams();
  const supervisor = useIsSupervisor();
  const client = useQueryClient();
  const run = useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun(runId),
    refetchInterval: (query) => (query.state.data && ["queued", "running"].includes(query.state.data.state) ? 3000 : false),
  });
  const verify = useMutation({ mutationFn: () => verifyRun(runId), onSuccess: () => void client.invalidateQueries({ queryKey: ["run", runId] }) });

  if (run.isLoading) return <Skeleton className="h-96 w-full" />;
  if (run.isError || !run.data) return <ApiError error={run.error} title="This run could not be loaded" />;
  const r = run.data;
  const live = r.state === "queued" || r.state === "running";
  const libraries = r.environment?.libraries ?? {};

  return (
    <>
      <PageHeader eyebrow={<Link to="/experiments" className="hover:text-ink">ML experiment manager</Link>} title={r.title ?? r.experiment_id}
        description={<span className="font-mono text-xs">{r.run_id}</span>}
        actions={<><StateChip state={r.state} /><EvidenceBadge status={r.evidence} /></>} />

      {live ? <Card className="p-5"><ProgressBar fraction={r.progress?.fraction} label={r.progress?.stage ?? "Queued"} /></Card> : null}
      {r.error ? <div role="alert" className="rounded-xl border border-risk/30 bg-risk-bg px-5 py-4 text-sm text-risk-ink">{r.error}</div> : null}
      {r.note ? <p className="m-0 max-w-4xl text-sm leading-relaxed text-ink-2">{r.note}</p> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="flex flex-col gap-4 p-6" label="Record">
          <CardHeader title="Record" subtitle="What was run, by whom, on what" />
          <dl className="m-0 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Field label="Experiment" mono>{r.experiment_id} v{r.experiment_version ?? "–"}</Field>
            <Field label="Definition SHA-256" mono>{r.experiment_sha256 ?? "not applicable"}</Field>
            <Field label="Protocol">{r.protocol === "original" ? "Original study protocol" : "Exploratory"}</Field>
            <Field label="Inputs">{r.lineage === "rerun" ? "Rerun from the dataset" : r.lineage === "reported-inputs" ? "Includes the study's published files" : r.lineage ?? "–"}</Field>
            <Field label="Created">{fmtDateTime(r.created_at)} by {r.created_by}</Field>
            <Field label="Runtime">{r.runtime_seconds != null ? fmtSeconds(r.runtime_seconds) : "–"}</Field>
            <Field label="Command" mono>{r.command?.join(" ") ?? "not executed here"}</Field>
            <Field label="Settings" mono>{Object.keys(r.parameters ?? {}).length ? JSON.stringify(r.parameters) : "registered defaults"}</Field>
            {r.retry_of ? <Field label="Retry of" mono><Link className="text-cobalt hover:underline" to={`/runs/${r.retry_of}`}>{r.retry_of}</Link></Field> : null}
            {r.seeded_from.length ? <Field label="Seeded from" mono>{r.seeded_from.map((id) => <Link key={id} className="mr-2 text-cobalt hover:underline" to={`/runs/${id}`}>{id}</Link>)}</Field> : null}
            {r.source ? <Field label="Imported from" mono>{r.source.repository} @ {r.source.commit.slice(0, 7)} on {r.source.imported_on}</Field> : null}
            {r.original_manifest ? <Field label="Study's own manifest">{r.original_manifest.verified ? `verified (${r.original_manifest.files} files, published ${fmtDateTime(r.original_manifest.published_at)})` : `failed: ${r.original_manifest.problems.join("; ")}`}</Field> : null}
          </dl>
        </Card>

        <Card className="flex flex-col gap-4 p-6" label="Integrity">
          <CardHeader title="Seal and integrity" subtitle="Every file of a finished run is hashed; the seal hash is also kept in the database"
            action={supervisor && r.integrity.sealed ? <Button busy={verify.isPending} onClick={() => verify.mutate()}><ShieldCheck className="h-4 w-4" aria-hidden /> Re-verify now</Button> : null} />
          {r.integrity.sealed ? (
            <>
              <p className={cn("m-0 text-sm font-medium", r.integrity.intact ? "text-ok" : "text-risk-text")}>
                {r.integrity.intact ? `Intact: all ${r.integrity.files} files match the seal.` : "The run no longer matches its seal. Its results are excluded from the findings ledger."}
              </p>
              {r.integrity.problems.length ? <ul className="m-0 list-disc pl-5 text-[13px] text-risk-text">{r.integrity.problems.slice(0, 12).map((p) => <li key={p}>{p}</li>)}</ul> : null}
              <dl className="m-0 grid gap-y-3">
                <Field label="Seal SHA-256" mono>{r.integrity.seal_sha256}</Field>
                <Field label="Sealed">{fmtDateTime(r.integrity.sealed_at)}</Field>
                <Field label="Last checked">{fmtDateTime(r.integrity.checked_at)}</Field>
              </dl>
            </>
          ) : <p className="m-0 text-sm text-ink-2">The run is still open. It is sealed when it finishes, fails or is found interrupted.</p>}
          {verify.isError ? <ApiError error={verify.error} /> : null}
        </Card>

        <Card className="flex flex-col gap-4 p-6" label="Fingerprints">
          <CardHeader title="Data, features and split" subtitle="Fingerprints recorded with the run" />
          <dl className="m-0 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Field label="Dataset" mono>{r.dataset ? `${r.dataset.file} (${r.dataset.bytes.toLocaleString()} bytes)` : (r.fingerprints?.trained_on?.data_file as string) ?? "not read by this run"}</Field>
            <Field label="Dataset SHA-256" mono>{r.dataset?.sha256 ?? (r.fingerprints?.trained_on?.data_sha256 as string) ?? "–"}{r.dataset ? <span className={cn("ml-2", r.dataset.matches_registered ? "text-ok" : "text-risk-text")}>{r.dataset.matches_registered ? "registered release" : "NOT the registered release"}</span> : null}</Field>
            <Field label="Feature schema" mono>{r.fingerprints?.feature_schema ? `${r.fingerprints.feature_schema.count} features, ordered · ${r.fingerprints.feature_schema.sha256.slice(0, 24)}…` : "–"}</Field>
            <Field label="Split sizes" mono>{r.fingerprints?.split ? `train ${r.fingerprints.split.train ?? "–"} / validation ${r.fingerprints.split.validation ?? "–"} / test ${r.fingerprints.split.test ?? "–"} (seed ${r.fingerprints.split.seed ?? "–"})` : "–"}</Field>
            <Field label="Validation customer ids SHA-256" mono>{(r.fingerprints?.split?.validation_ids_sha256 as string) ?? "–"}</Field>
            <Field label="Test customer ids SHA-256" mono>{(r.fingerprints?.split?.test_ids_sha256 as string) ?? "–"}</Field>
            <Field label="Served pipeline">{r.fingerprints?.served_pipeline ?? "–"}</Field>
            <Field label="Calibration" mono>{r.fingerprints?.calibration ? JSON.stringify(r.fingerprints.calibration) : "–"}</Field>
            <Field label="Decision threshold" mono>{r.fingerprints?.threshold != null ? fmtNum(r.fingerprints.threshold, 4) : "–"}</Field>
            <Field label="Blend" mono>{r.fingerprints?.blend ? JSON.stringify(r.fingerprints.blend) : "–"}</Field>
          </dl>
          {r.fingerprints?.hyperparameters ? (
            <details className="text-[13px]"><summary className="cursor-pointer text-cobalt">Tuned hyperparameters</summary>
              <pre className="m-0 mt-2 overflow-auto rounded-lg border border-line bg-night p-3 text-[11.5px] text-night-text">{JSON.stringify(r.fingerprints.hyperparameters, null, 2)}</pre>
            </details>
          ) : null}
        </Card>

        <Card className="flex flex-col gap-4 p-6" label="Software">
          <CardHeader title="Software and hardware" subtitle="Timings depend on this machine and are never treated as reproduced" />
          {r.environment ? (
            <dl className="m-0 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <Field label="Python" mono>{r.environment.python}</Field>
              <Field label="Platform" mono>{r.environment.platform}</Field>
              <Field label="Processor" mono>{r.environment.processor}</Field>
              <Field label="Threads used / logical CPUs" mono>{r.environment.threads} / {r.environment.cpu_count}</Field>
              <Field label="Code commit" mono>{r.code?.commit ?? "not a git checkout"}{r.code?.dirty ? " (uncommitted changes)" : ""}</Field>
              <Field label="Research code SHA-256" mono>{r.code?.source_tree_sha256}</Field>
              <div className="sm:col-span-2"><Field label="Libraries" mono>{Object.entries(libraries).map(([k, v]) => `${k} ${v ?? "absent"}`).join(" · ")}</Field></div>
              <Field label="Findings file SHA-256" mono>{r.findings_sha256}</Field>
              <Field label="Run config SHA-256" mono>{r.config_sha256}</Field>
            </dl>
          ) : <dl className="m-0 grid gap-y-3"><Field label="Libraries recorded by the original study" mono>{JSON.stringify(r.fingerprints?.trained_on?.libraries ?? {})}</Field><Field label="Code commit recorded by the original study" mono>{JSON.stringify(r.fingerprints?.trained_on?.code ?? {})}</Field></dl>}
        </Card>
      </div>

      <Card className="flex flex-col gap-4 p-6" label="Findings checked">
        <CardHeader title="Reported findings checked by this run" subtitle="Reported value against this run's value, with the tolerance declared beforehand" />
        <FindingChecks run={r} />
      </Card>

      <Card className="flex flex-col gap-4 p-6" label="Output">
        <CardHeader title={live ? "Live output" : "Output"} subtitle="Every line the experiment printed, as it happened" />
        <LiveLog key={runId} runId={runId} live={live} />
      </Card>

      <Card className="flex flex-col gap-5 p-6" label="Files">
        <CardHeader title="Files" subtitle="Inputs copied from earlier runs and outputs written by this one, with their SHA-256" />
        <Files title="Outputs" files={r.outputs ?? {}} runId={runId} readable />
        <Files title="Inputs" files={r.inputs ?? {}} runId={runId} readable />
      </Card>
    </>
  );
}
