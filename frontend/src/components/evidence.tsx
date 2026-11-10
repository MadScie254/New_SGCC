import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";

/**
 * Where a number on screen comes from. Every chart and table in the research workspaces carries
 * one of these, and they are never interchangeable:
 *
 * - reported: published by the original study; not rerun here.
 * - verified: reproduced by a sealed rerun under the original protocol, inside a tolerance declared beforehand.
 * - discrepant: rerun under the original protocol and outside the declared tolerance (both values are kept).
 * - executed: computed here, now or by a sealed run, under the original protocol.
 * - recomputed: recalculated here from the original study's published predictions (checks the arithmetic, not the training).
 * - exploratory: new work outside the original protocol.
 * - synthetic: simulated for illustration; not an observation.
 * - observed: authentic SGCC readings.
 * - hypothetical: a what-if under stated assumptions.
 * - pending: a run that has not finished.
 */
export type Evidence =
  | "reported" | "verified" | "discrepant" | "executed" | "recomputed" | "exploratory" | "synthetic" | "observed"
  | "hypothetical" | "pending";

const META: Record<Evidence, { label: string; className: string; title: string }> = {
  reported: { label: "Reported", className: "border-amber/40 bg-amber-bg text-amber-ink", title: "Published by the original study; not rerun here" },
  verified: { label: "Verified", className: "border-ok/40 bg-ok-bg text-ok", title: "Reproduced by a sealed rerun under the original protocol, within the tolerance declared beforehand" },
  discrepant: { label: "Discrepant", className: "border-risk/40 bg-risk-bg text-risk-text", title: "Rerun under the original protocol; outside the declared tolerance. Both values are kept" },
  executed: { label: "Executed here", className: "border-cobalt/40 bg-cobalt-bg text-cobalt-ink", title: "Computed on this machine under the original protocol" },
  recomputed: { label: "Recomputed", className: "border-cobalt/40 bg-cobalt-soft text-cobalt-ink", title: "Recalculated from the original study's published predictions; checks the arithmetic, not the training" },
  exploratory: { label: "Exploratory", className: "border-violet/40 bg-violet-bg text-violet", title: "New work outside the original protocol" },
  synthetic: { label: "Synthetic", className: "border-violet/50 bg-violet-bg text-violet", title: "Simulated for illustration; not an observation" },
  observed: { label: "Observed data", className: "border-line bg-tint text-ink-2", title: "Authentic SGCC readings" },
  hypothetical: { label: "Hypothetical", className: "border-violet/40 bg-violet-bg text-violet", title: "A what-if under stated assumptions; not a measurement" },
  pending: { label: "Pending", className: "border-line bg-tint text-ink-3", title: "The run has not finished" },
};

export function EvidenceBadge({ status, className }: { status: Evidence; className?: string }) {
  const meta = META[status] ?? META.pending;
  return (
    <span title={meta.title} className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em]", meta.className, className)}>
      {meta.label}
    </span>
  );
}

/** The line under a chart or table that says what it was computed from. */
export function SourceNote({ status, children, runId }: { status: Evidence; children: ReactNode; runId?: string | null }) {
  return (
    <p className="m-0 flex flex-wrap items-center gap-2 text-xs leading-relaxed text-ink-3">
      <EvidenceBadge status={status} />
      <span>{children}</span>
      {runId ? (
        <Link to={`/runs/${runId}`} className="font-mono text-[11px] text-cobalt underline-offset-2 hover:underline">
          {runId}
        </Link>
      ) : null}
    </p>
  );
}

/** A boxed statement of what a view must not be read as. */
export function Caveat({ title = "Read this before drawing a conclusion", children }: { title?: string; children: ReactNode }) {
  return (
    <aside className="rounded-lg border border-amber/30 bg-amber-bg/50 px-4 py-3 text-[13px] leading-relaxed text-amber-ink">
      <span className="font-semibold">{title}. </span>
      {children}
    </aside>
  );
}
