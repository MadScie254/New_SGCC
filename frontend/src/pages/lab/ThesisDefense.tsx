import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiError, Card, CardHeader, Empty, PageHeader, Segmented, Skeleton, Stat } from "@/components/ui";
import { Caveat, EvidenceBadge, SourceNote } from "@/components/evidence";
import { getBriefing, getClaims, getConclusions, getQuestions } from "@/lib/api/defense";
import type { Claim, Conclusion } from "@/lib/api/defense";
import { cn } from "@/lib/cn";

const TABS = [
  ["briefing", "Briefing"],
  ["claims", "The claims"],
  ["conclusions", "The conclusions"],
  ["questions", "The questions"],
] as const;
type Tab = (typeof TABS)[number][0];

const int = (v: number | null | undefined) => (v == null ? "–" : v.toLocaleString());

const OUTCOME_TONE: Record<Conclusion["outcome"], string> = {
  holds: "text-ok",
  does_not_hold: "text-risk-text",
  not_rerun: "text-ink-3",
  not_supported_by_reported_record: "text-risk-text",
};

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <tr className="border-b border-line-soft align-top">
      <td className="py-2.5 pr-4 font-mono text-[12px] text-ink-3">{claim.id}</td>
      <td className="py-2.5 pr-4">
        <span className="block">{claim.claim}</span>
        {claim.source ? <span className="block text-xs text-ink-3">{claim.source}</span> : null}
      </td>
      <td className="py-2.5 pr-4 text-right font-mono tabular">{claim.reported ?? "–"}</td>
      <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">
        {claim.observed == null ? "not rerun" : claim.observed}
      </td>
      <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-3">±{claim.tolerance ?? "–"}</td>
      <td className="py-2.5">
        <EvidenceBadge status={claim.status} />
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------

function BriefingTab() {
  const query = useQuery({ queryKey: ["defense-briefing"], queryFn: getBriefing });
  if (query.isLoading) return <Skeleton className="h-[420px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Numbers the thesis prints" value={int(data.claims.total)}
          hint={`${int(data.claims.verified)} reproduced here, ${int(data.claims.discrepant)} outside tolerance`} />
        <Stat label="Conclusions drawn from them" value={int(data.conclusions.total)}
          hint={`${int(data.conclusions.holds)} still hold, ${int(data.conclusions.does_not_hold)} do not`} />
        <Stat label="Questions with no answer in the record" value={int(data.open_questions)} tone="risk" />
      </div>

      <Card className="p-5">
        <CardHeader title="Three counts that do not mean the same thing"
          subtitle="Read in this order: what was predeclared, what was decided afterwards, and what the record cannot settle." />
        <ol className="m-0 mt-4 flex list-none flex-col gap-4 p-0">
          <li className="border-l-2 border-ok pl-4">
            <h3 className="m-0 text-[14px] font-medium text-ink">Claims — the strong evidence</h3>
            <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink-2">
              {int(data.claims.total)} numbers, each with a tolerance fixed before any rerun was seen.
              {" "}{int(data.claims.verified)} came back inside it, {int(data.claims.discrepant)} did not, and{" "}
              {int(data.claims.reported_only)} have not been rerun on this machine.
            </p>
          </li>
          <li className="border-l-2 border-violet pl-4">
            <h3 className="m-0 text-[14px] font-medium text-ink">Conclusions — weaker, and post hoc</h3>
            <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink-2">
              {int(data.conclusions.total)} qualitative statements with mechanical checks, written{" "}
              {data.conclusions.written ?? "after the first rerun"}. Agreement here is weaker evidence than a
              predeclared check, because the check was chosen knowing the answer.
            </p>
          </li>
          <li className="border-l-2 border-risk pl-4">
            <h3 className="m-0 text-[14px] font-medium text-ink">Questions — open whatever the other two say</h3>
            <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink-2">
              {int(data.open_questions)} limitations the record carries. A reproduced number does not close any of
              them, and the answers below say where the evidence runs out.
            </p>
          </li>
        </ol>
        <p className="m-0 mt-4 text-[13px] leading-relaxed text-ink-2">{data.reading}</p>
        <div className="mt-4">
          <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
            {data.provenance.computed_from}.
          </SourceNote>
        </div>
      </Card>

      <Caveat title="What this mode is not">
        This is a record of what was claimed and what a rerun found. It does not decide whether the thesis is right,
        and nothing on it should be read as a verdict on a customer: every number here is a measurement of a model
        and of a dataset.
      </Caveat>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ClaimsTab() {
  const query = useQuery({ queryKey: ["defense-claims"], queryFn: getClaims });
  const [objective, setObjective] = useState<string>("");
  if (query.isLoading) return <Skeleton className="h-[560px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;
  const chosen = objective || data.objectives[0]?.objective || "";
  const bucket = data.objectives.find((o) => o.objective === chosen);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Claims in the ledger" value={int(data.summary.findings)} />
        <Stat label="Reproduced here" value={int(data.summary.verified)} tone={data.summary.verified > 0 ? "cobalt" : "ink"} />
        <Stat label="Outside tolerance" value={int(data.summary.discrepant)} tone={data.summary.discrepant > 0 ? "risk" : "ink"} />
        <Stat label="Not rerun on this machine" value={int(data.summary.reported)} />
      </div>

      <Card className="p-5">
        <CardHeader
          title="Claim by claim, objective by objective"
          subtitle={data.reading}
          action={
            <select value={chosen} onChange={(event) => setObjective(event.target.value)}
              aria-label="Choose an objective"
              className="h-9 rounded-lg border border-line bg-surface-alt px-2 text-[13px] text-ink">
              {data.objectives.map((o) => (
                <option key={o.objective} value={o.objective}>{o.objective} ({o.total})</option>
              ))}
            </select>
          }
        />
        <div className="mt-4">
          {!bucket ? <Empty title="No claims under this objective" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
                <caption className="sr-only">Every claim under {chosen}, with its reported value, the rerun value and its tolerance</caption>
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                    <th className="py-2.5 pr-4 font-medium">Id</th>
                    <th className="py-2.5 pr-4 font-medium">Claim</th>
                    <th className="py-2.5 pr-4 text-right font-medium">Thesis states</th>
                    <th className="py-2.5 pr-4 text-right font-medium">Rerun here</th>
                    <th className="py-2.5 pr-4 text-right font-medium">Tolerance</th>
                    <th className="py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bucket.claims.map((claim) => <ClaimRow key={`${claim.id}-${claim.claim}`} claim={claim} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
            {data.provenance.computed_from}. {data.provenance.note}
          </SourceNote>
          {data.excluded_runs.length ? (
            <p className="m-0 text-xs leading-relaxed text-ink-3">
              {data.excluded_runs.length} sealed {data.excluded_runs.length === 1 ? "run was" : "runs were"} excluded
              because their files did not check out, so nothing they produced counts towards a reproduction.
              {" "}<Link to="/registry" className="text-cobalt underline-offset-2 hover:underline">See the registry</Link>.
            </p>
          ) : null}
          <p className="m-0 text-xs text-ink-3">
            Ledger fingerprint <span className="font-mono">{data.summary.findings_sha256.slice(0, 16)}…</span>
          </p>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ConclusionsTab() {
  const query = useQuery({ queryKey: ["defense-conclusions"], queryFn: getConclusions });
  if (query.isLoading) return <Skeleton className="h-[520px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;

  return (
    <div className="flex flex-col gap-5">
      <Caveat title="These checks were written after the answer was known">
        {data.written ? `The conclusions register was written ${data.written}. ` : ""}
        Each check is mechanical and is applied the same way to the reported record and to the newest sealed rerun,
        but it was chosen with the rerun's numbers already in view. Agreement here is weaker evidence than the
        predeclared claims on the previous tab, and should be weighed accordingly.
        {data.applies_integrity_gate ? null : (
          <>
            {" "}It is weaker in a second way too: the register takes the newest sealed rerun without also checking
            that its files still match their seal. The claims tab does apply that check and excludes the runs that
            fail it, so a verdict here rests on a weaker guarantee than a verdict there.
          </>
        )}
      </Caveat>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Conclusions checked" value={int(data.summary.conclusions)} />
        <Stat label="Still hold" value={int(data.summary.holds)} tone="cobalt" />
        <Stat label="Do not hold" value={int(data.summary.does_not_hold)}
          tone={(data.summary.does_not_hold ?? 0) > 0 ? "risk" : "ink"} />
        <Stat label="Not rerun here" value={int(data.summary.not_rerun)} />
      </div>

      <Card className="p-5">
        <CardHeader title="Does the sentence still hold?"
          subtitle={`Significance is taken at alpha = ${data.alpha ?? 0.05}. The check behind each verdict is shown, not just the verdict.`} />
        <ul className="m-0 mt-4 flex list-none flex-col gap-4 p-0">
          {data.conclusions.map((item) => (
            <li key={item.id} className="border-b border-line-soft pb-4 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[12px] text-ink-3">{item.id}</span>
                <span className={cn("text-[13px] font-medium", OUTCOME_TONE[item.outcome])}>{item.outcome_label}</span>
                {item.thesis.length ? <span className="text-xs text-ink-3">{item.thesis.join(", ")}</span> : null}
              </div>
              <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink">{item.statement}</p>
              <p className="m-0 mt-1.5 font-mono text-[11.5px] leading-relaxed text-ink-3">
                check: {JSON.stringify(item.check)}
              </p>
              {item.source ? <p className="m-0 mt-1 text-xs text-ink-3">{item.source}</p> : null}
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
            {data.provenance.computed_from}. {data.provenance.note}
          </SourceNote>
        </div>
        {data.sha256 ? (
          <p className="m-0 mt-2 text-xs text-ink-3">
            Register fingerprint <span className="font-mono">{data.sha256.slice(0, 16)}…</span>
          </p>
        ) : null}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function QuestionsTab() {
  const query = useQuery({ queryKey: ["defense-questions"], queryFn: getQuestions });
  if (query.isLoading) return <Skeleton className="h-[520px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <CardHeader title="What an examiner will press on" subtitle={data.reading} />
        <ol className="m-0 mt-4 flex list-none flex-col gap-5 p-0">
          {data.questions.map((question, index) => (
            <li key={question.id ?? index} className="border-b border-line-soft pb-5 last:border-0 last:pb-0">
              <h3 className="m-0 font-display text-[18px] font-medium leading-snug">{question.question}</h3>
              <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-ink-2">{question.detail}</p>
              <div className="mt-3 rounded-lg border border-line bg-surface-alt px-4 py-3">
                <span className="text-[13px] font-medium text-ink">What the record supports</span>
                <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink-2">{question.answer}</p>
                {question.evidence ? (
                  <p className="m-0 mt-2 text-[13px] leading-relaxed text-cobalt-ink">{question.evidence}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4">
          <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
            {data.provenance.computed_from}. {data.provenance.note}
          </SourceNote>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ThesisDefensePage() {
  const [tab, setTab] = useState<Tab>("briefing");

  return (
    <>
      <PageHeader
        title="Thesis defence mode"
        description="What the thesis claims, what a rerun found, and the questions neither settles. The three are kept apart on purpose: a predeclared number that came back is evidence, a conclusion checked after the fact is weaker, and an open question stays open however the other two came out."
      />
      <div className="mt-6 -mx-1 max-w-full overflow-x-auto px-1">
        <Segmented label="Defence view" value={tab} onChange={setTab} options={TABS.map(([value, label]) => ({ value, label }))} />
      </div>
      <div className="mt-5">
        {tab === "briefing" ? <BriefingTab /> : null}
        {tab === "claims" ? <ClaimsTab /> : null}
        {tab === "conclusions" ? <ConclusionsTab /> : null}
        {tab === "questions" ? <QuestionsTab /> : null}
      </div>
    </>
  );
}
