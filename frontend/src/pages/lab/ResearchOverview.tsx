import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiError, Card, CardHeader, PageHeader, Skeleton, Stat } from "@/components/ui";
import { Caveat, EvidenceBadge, SourceNote, type Evidence } from "@/components/evidence";
import { getLedger } from "@/lib/api/experiments";
import { getStatLimitations, getStatPipelines } from "@/lib/api/statistics";
import { getRelease } from "@/lib/api/observatory";
import { getMissingnessProfile } from "@/lib/api/xai";
import { getSensitivity } from "@/lib/api/imbalance";
import { getWeightSweep } from "@/lib/api/deeplab";
import { getHistoryLength } from "@/lib/api/features";
import { cn } from "@/lib/cn";

const num = (v: number | null | undefined, digits = 3) => (v == null ? "–" : v.toFixed(digits));
const pct = (v: number | null | undefined, digits = 1) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);
const int = (v: number | null | undefined) => (v == null ? "–" : v.toLocaleString());

/** A finding from one workspace, with the number that carries it and a way through to the detail. */
function FindingCard({ title, to, linkLabel, status, value, children, loading, error }: {
  title: string;
  to: string;
  linkLabel: string;
  status: Evidence;
  value: ReactNode;
  children: ReactNode;
  loading: boolean;
  error: unknown;
}) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="m-0 min-h-[3.4rem] font-display text-[19px] font-medium leading-tight">{title}</h3>
        <EvidenceBadge status={status} />
      </div>
      {loading ? <Skeleton className="h-20 w-full" /> : error ? <ApiError error={error} /> : (
        <>
          <p className="m-0 font-mono text-[28px] leading-none tabular">{value}</p>
          <p className="m-0 text-[13px] leading-relaxed text-ink-2">{children}</p>
        </>
      )}
      <Link to={to} className="mt-auto text-[13px] font-medium text-cobalt underline-offset-2 hover:underline">
        {linkLabel} →
      </Link>
    </Card>
  );
}

export function ResearchOverviewPage() {
  const release = useQuery({ queryKey: ["obs-release"], queryFn: getRelease });
  const pipelines = useQuery({ queryKey: ["stat-pipelines", "reported", "test"], queryFn: () => getStatPipelines({ run: "reported", split: "test" }) });
  const ledger = useQuery({ queryKey: ["findings-ledger"], queryFn: getLedger });
  const limitations = useQuery({ queryKey: ["stat-limitations"], queryFn: () => getStatLimitations({}) });

  const missingness = useQuery({ queryKey: ["xai-missingness-profile"], queryFn: getMissingnessProfile });
  const resampling = useQuery({ queryKey: ["imb-sensitivity"], queryFn: getSensitivity });
  const blend = useQuery({ queryKey: ["deep-sweep"], queryFn: () => getWeightSweep({ step: 0.05 }) });
  const history = useQuery({ queryKey: ["feat-history"], queryFn: getHistoryLength });

  const served = pipelines.data?.pipelines.find((p) => p.served);
  const summary = ledger.data?.summary;
  const discrepant = (ledger.data?.findings ?? []).filter((f) => f.status === "discrepant");

  const proposed = resampling.data?.proposed?.pr_auc;
  const baseline = resampling.data?.baseline?.pr_auc;
  const resamplingGap = proposed != null && baseline != null ? proposed - baseline : null;

  return (
    <>
      <PageHeader
        title="Research overview"
        description="Electricity-theft detection on the SGCC release, reproduced and examined. This page is the way in: each finding below states the number it rests on, where that number came from, and where to go to take it apart."
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Customers in the release" value={int(release.data?.identity.customers)}
          hint={release.data ? `${int(release.data.classes.theft)} theft-labelled, ${pct(release.data.classes.theft_rate, 2)}` : "…"} />
        <Stat label="Served pipeline"
          value={<span className="font-sans text-[18px] leading-tight">{served?.label ?? "…"}</span>}
          hint={served ? `threshold ${num(served.threshold)} chosen on validation customers` : ""} />
        <Stat label="Precision–recall area" value={num(served?.metrics.pr_auc)}
          hint={pipelines.data ? `on ${int(pipelines.data.customers)} test customers` : ""} />
        <Stat label="Claims in the ledger"
          value={summary ? int(summary.findings) : "…"}
          tone={summary && summary.discrepant > 0 ? "risk" : "ink"}
          hint={summary
            ? `${summary.verified} verified here, ${summary.reported} not rerun on this machine, ${summary.discrepant} outside tolerance`
            : ""} />
      </div>

      <section className="mt-6 flex flex-col gap-4">
        <h2 className="m-0 font-display text-[24px] font-medium">What the reproduction found</h2>
        {ledger.isLoading ? <Skeleton className="h-40 w-full" /> : ledger.isError ? <ApiError error={ledger.error} /> : summary ? (
          <Card className="p-5">
            <CardHeader title="The findings ledger"
              subtitle="Every number the thesis claims, checked against a rerun under the original protocol inside a tolerance declared beforehand."
              action={<Link to="/registry" className="text-[13px] font-medium text-cobalt underline-offset-2 hover:underline">Open the registry →</Link>} />
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              {([
                ["Claims checked", summary.findings, "ink"],
                ["Verified", summary.verified, "ok"],
                ["Reported only", summary.reported, "amber"],
                ["Discrepant", summary.discrepant, summary.discrepant > 0 ? "risk" : "ink"],
              ] as const).map(([label, value, tone]) => (
                <div key={label} className="rounded-lg border border-line bg-surface-alt px-4 py-3">
                  <span className="block text-[13px] text-ink-2">{label}</span>
                  <span className={cn("font-mono text-[26px] tabular",
                    value > 0 && tone === "ok" && "text-ok",
                    value > 0 && tone === "risk" && "text-risk",
                    value > 0 && tone === "amber" && "text-amber")}>
                    {int(value)}
                  </span>
                </div>
              ))}
            </div>
            {discrepant.length ? (
              <div className="mt-4 flex flex-col gap-2">
                <h3 className="m-0 text-[13px] font-medium text-ink">Outside the declared tolerance</h3>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {discrepant.slice(0, 5).map((finding) => (
                    <li key={finding.id} className="flex flex-wrap items-baseline gap-2 border-b border-line-soft pb-2 text-[13px]">
                      <EvidenceBadge status="discrepant" />
                      <span className="text-ink-2">{finding.claim}</span>
                      <span className="font-mono tabular text-ink-3">
                        reported {finding.reported}
                        {finding.latest?.observed != null ? ` · rerun ${finding.latest.observed}` : ""}
                        {finding.latest?.difference != null ? ` · off by ${Math.abs(finding.latest.difference)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="m-0 mt-4 text-[13px] leading-relaxed text-ink-2">
                Every claim that has been rerun landed inside its declared tolerance. Claims still marked
                &ldquo;reported only&rdquo; have not been rerun here and carry the original study's word for it.
              </p>
            )}
            <p className="m-0 mt-4 text-xs text-ink-3">
              Ledger fingerprint <span className="font-mono">{summary.findings_sha256.slice(0, 16)}…</span>
            </p>
          </Card>
        ) : null}
      </section>

      <section className="mt-8 flex flex-col gap-4">
        <h2 className="m-0 font-display text-[24px] font-medium">Four things worth knowing before the headline</h2>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <FindingCard
            title="Missingness separates the classes on its own"
            to="/xai" linkLabel="Open the shortcut investigation"
            status={missingness.data?.provenance.status ?? "pending"}
            value={num(missingness.data?.auc_of_missing_share_alone)}
            loading={missingness.isLoading} error={missingness.isError ? missingness.error : null}
          >
            Ranking customers by nothing but the share of readings their meter failed to report separates the two
            labelled groups at this AUC. A model that reads missingness is reading something real, but it is a
            difference in how meters reported, not necessarily in how customers behaved.
          </FindingCard>

          <FindingCard
            title="Resampling did not help"
            to="/imbalance" linkLabel="Open the imbalance laboratory"
            status={resampling.data?.provenance.status ?? "pending"}
            value={resamplingGap == null ? "–" : `${resamplingGap >= 0 ? "+" : "−"}${Math.abs(resamplingGap).toFixed(3)}`}
            loading={resampling.isLoading} error={resampling.isError ? resampling.error : null}
          >
            The proposal's SMOTE+ENN setting scores {num(proposed)} against {num(baseline)} for no resampling at all,
            under the same folds and the same fixed hyperparameters. Thirteen treatments were tried; the ranking is
            reported as recorded.
          </FindingCard>

          <FindingCard
            title="The ensemble is worth something"
            to="/deep" linkLabel="Open the ensemble studio"
            status={blend.data?.provenance.status ?? "pending"}
            value={blend.data ? `+${num(blend.data.gain_over_best_part)}` : "–"}
            loading={blend.isLoading} error={blend.isError ? blend.error : null}
          >
            Blending the network with the feature model beats the better of the two parts by this much on validation
            customers, at a weight of {num(blend.data?.served_weight, 2)}. It beat both parts on every seed tried.
          </FindingCard>

          <FindingCard
            title="More history kept helping"
            to="/features" linkLabel="Open the feature studio"
            status={history.data?.provenance.status ?? "pending"}
            value={history.data?.full ? `${int(history.data.full.months)} months` : "–"}
            loading={history.isLoading} error={history.isError ? history.error : null}
          >
            {history.data?.within_5_percent && history.data.within_5_percent.months === history.data.full?.months
              ? "No shorter window came within five per cent of the full record, so the curve had not flattened by the end of the data. A utility deciding how long to keep meter readings needs that curve, not the headline score."
              : `A ${int(history.data?.within_5_percent?.months)}-month window gets within five per cent of the full record.`}
          </FindingCard>
        </div>
      </section>

      <section className="mt-8 flex flex-col gap-4">
        <h2 className="m-0 font-display text-[24px] font-medium">What this study cannot tell you</h2>
        {limitations.isLoading ? <Skeleton className="h-52 w-full" /> : limitations.isError ? <ApiError error={limitations.error} /> : (
          <Card className="p-5">
            <CardHeader title="Limitations carried by the data and the protocol"
              subtitle="Each one changes how a result on this page should be read." />
            <ul className="m-0 mt-4 flex list-none flex-col gap-4 p-0">
              {(limitations.data?.limitations ?? []).map((limitation) => (
                <li key={limitation.id} className="border-b border-line-soft pb-4 last:border-0 last:pb-0">
                  <h3 className="m-0 text-[14px] font-medium text-ink">{limitation.title}</h3>
                  <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink-2">{limitation.detail}</p>
                  <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-ink-3">
                    <span className="font-medium text-ink-2">What is done about it: </span>{limitation.mitigation}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Caveat title="A flagged customer is not a thief">
          Everything in these workspaces is a measurement of a model and of a dataset. A score is a reason to look at
          a meter, never a finding against a person, and the study's labels are the dataset's, not a verdict reached
          here.
        </Caveat>
        {release.data ? (
          <SourceNote status={release.data.provenance.status}>
            Dataset figures measured from {release.data.identity.file}; pipeline metrics and the ledger from the
            sealed run.
          </SourceNote>
        ) : null}
      </section>
    </>
  );
}
