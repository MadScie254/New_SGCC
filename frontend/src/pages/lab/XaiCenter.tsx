import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, Card, CardHeader, Empty, PageHeader, Pill, Segmented, Skeleton, Stat } from "@/components/ui";
import { Caveat, EvidenceBadge, SourceNote, type Evidence } from "@/components/evidence";
import { WeekEffectsChart } from "@/components/charts";
import {
  BeeswarmPlot, ContributionSteps, ImportanceBars, MissingnessHistogram, MonthlyMissingness, ValueRamp, WeightBars,
} from "@/components/viz/XaiPlots";
import {
  getMaskExperiment, getMissingnessAttribution, getMissingnessProfile, getShortcutEvidence, getXaiAgreement,
  getXaiBeeswarm, getXaiCustomer, getXaiCustomers, getXaiGlobal, getXaiWeeks,
} from "@/lib/api/xai";
import { palette, pipelineLabels } from "@/lib/palette";
import { cn } from "@/lib/cn";

const TABS = [
  ["global", "Global importance"],
  ["customer", "One customer"],
  ["shortcut", "The missingness shortcut"],
] as const;
type Tab = (typeof TABS)[number][0];

const pct = (v: number | null | undefined, digits = 1) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);
const num = (v: number | null | undefined, digits = 3) => (v == null ? "–" : v.toFixed(digits));

function LabelTag({ label }: { label: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        label === 1 ? "border-risk/40 bg-risk-bg text-risk-text" : "border-line bg-tint text-ink-2",
      )}
    >
      {label === 1 ? "theft-labelled" : "honest-labelled"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Global importance
// ---------------------------------------------------------------------------

function GlobalTab({ seed, top }: { seed: number; top: number }) {
  const [view, setView] = useState<"bars" | "swarm">("bars");
  const global = useQuery({ queryKey: ["xai-global", seed, top], queryFn: () => getXaiGlobal({ seed, top }) });
  const swarm = useQuery({
    queryKey: ["xai-beeswarm", seed],
    queryFn: () => getXaiBeeswarm({ seed, top: 12 }),
    enabled: view === "swarm",
  });

  if (global.isLoading) return <Skeleton className="h-[520px] w-full" />;
  if (global.isError) return <ApiError error={global.error} title="Could not compute SHAP values" />;
  const data = global.data!;
  const missingFeatures = data.features.filter((f) => f.missingness_feature);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Customers sampled" value={data.customers.toLocaleString()} hint={`${data.theft.toLocaleString()} theft-labelled`} />
        <Stat
          label="Attribution on missing readings"
          value={pct(data.missingness_share_of_attribution)}
          tone="risk"
          hint={`${missingFeatures.length} of the ${data.features.length} strongest features`}
        />
        <Stat label="Strongest feature" value={<span className="text-[22px] leading-tight">{data.features[0]?.label ?? "–"}</span>}
          hint={`mean |SHAP| ${num(data.features[0]?.mean_abs_shap, 3)} log-odds`} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Chart"
          value={view}
          onChange={setView}
          options={[{ value: "bars", label: "Ranked features" }, { value: "swarm", label: "Per-customer spread" }]}
        />
        {view === "swarm" ? <ValueRamp /> : null}
      </div>

      {view === "bars" ? (
        <ImportanceBars features={data.features} />
      ) : swarm.isLoading ? (
        <Skeleton className="h-[480px] w-full" />
      ) : swarm.isError ? (
        <ApiError error={swarm.error} />
      ) : (
        <>
          <BeeswarmPlot features={swarm.data!.features} />
          <p className="m-0 text-[13px] leading-relaxed text-ink-2">{swarm.data!.reading}</p>
        </>
      )}

      <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
        {data.provenance.computed_from}. {data.provenance.note}
      </SourceNote>

      <Card className="p-5">
        <CardHeader title="Every feature in the ranking" subtitle="Median feature value in each labelled class, and which way the feature moves the score." />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-[13px]">
            <caption className="sr-only">
              The {data.features.length} features with the largest mean absolute SHAP value, with their median value in each labelled class
            </caption>
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                <th className="py-2.5 pr-4 font-medium">Feature</th>
                <th className="py-2.5 pr-4 font-medium">Group</th>
                <th className="py-2.5 pr-4 text-right font-medium">Mean |SHAP|</th>
                <th className="py-2.5 pr-4 text-right font-medium">Mean SHAP, theft</th>
                <th className="py-2.5 pr-4 text-right font-medium">Mean SHAP, honest</th>
                <th className="py-2.5 pr-4 text-right font-medium">Median value, theft</th>
                <th className="py-2.5 pr-4 text-right font-medium">Median value, honest</th>
                <th className="py-2.5 font-medium">Direction</th>
              </tr>
            </thead>
            <tbody>
              {data.features.map((row) => (
                <tr key={row.feature} className="border-b border-line-soft">
                  <td className="py-2.5 pr-4">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: row.missingness_feature ? palette.missing : palette.accent }} />
                      <span>{row.label}</span>
                      {row.core ? <span className="rounded-full border border-line bg-tint px-1.5 py-0.5 text-[10px] text-ink-3">core</span> : null}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-ink-3">{row.group}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular">{num(row.mean_abs_shap)}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular text-risk-text">{num(row.mean_shap_theft)}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular text-cobalt-ink">{num(row.mean_shap_honest)}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{num(row.value_median_theft)}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{num(row.value_median_honest)}</td>
                  <td className="py-2.5 text-xs text-ink-3">{row.direction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Caveat>
        {data.reading} A feature that separates the two labelled groups may describe how a meter reported rather than how a
        customer used electricity, and SHAP cannot tell the two apart.
      </Caveat>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One customer
// ---------------------------------------------------------------------------

function CustomerPicker({ chosen, onPick }: { chosen: string | null; onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState<"all" | "theft" | "honest">("all");
  const list = useQuery({
    queryKey: ["xai-customers", query, label],
    queryFn: () => getXaiCustomers({ query, label: label === "all" ? undefined : label === "theft" ? 1 : 0, limit: 40 }),
  });

  return (
    <Card className="p-5">
      <CardHeader title="Choose a study customer" subtitle="The study's validation and test customers, whose labels are known. Operations customers are never explained with a label attached." />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          Customer id starts with
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. 10"
            className="h-9 w-36 rounded-lg border border-line bg-surface-alt px-2.5 font-mono text-[13px] text-ink placeholder:text-ink-3"
          />
        </label>
        <Segmented
          label="Labelled class"
          value={label}
          onChange={setLabel}
          options={[{ value: "all", label: "All" }, { value: "theft", label: "Theft-labelled" }, { value: "honest", label: "Honest-labelled" }]}
        />
      </div>
      <div className="mt-4">
        {list.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : list.isError ? (
          <ApiError error={list.error} />
        ) : list.data!.customers.length === 0 ? (
          <Empty title="No customer matches" message="Try a shorter id prefix." />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {list.data!.customers.map((customer) => (
                <Pill key={customer.customer_id} active={customer.customer_id === chosen} onClick={() => onPick(customer.customer_id)}>
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="h-2 w-2 rounded-full"
                      style={{ background: customer.label === 1 ? palette.theft : palette.honest }} />
                    <span className="font-mono">{customer.customer_id}</span>
                    <span className="text-ink-3">{pct(customer.probability, 0)}</span>
                  </span>
                </Pill>
              ))}
            </div>
            <p className="m-0 mt-3 text-xs text-ink-3">
              Showing {list.data!.customers.length} of {list.data!.total_matching.toLocaleString()} matching customers.
              The percentage is the saved probability of the served {pipelineLabels[list.data!.served_pipeline] ?? list.data!.served_pipeline} pipeline.
              {" "}{list.data!.note}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

function CustomerTab({ customerId, onPick }: { customerId: string | null; onPick: (id: string) => void }) {
  const explanation = useQuery({
    queryKey: ["xai-customer", customerId],
    queryFn: () => getXaiCustomer({ customer_id: customerId!, top: 15 }),
    enabled: !!customerId,
  });
  const weeks = useQuery({
    queryKey: ["xai-weeks", customerId],
    queryFn: () => getXaiWeeks({ customer_id: customerId! }),
    enabled: !!customerId,
  });
  const agreement = useQuery({
    queryKey: ["xai-agreement", customerId],
    queryFn: () => getXaiAgreement({ customer_id: customerId!, top: 5 }),
    enabled: !!customerId,
  });

  return (
    <div className="flex flex-col gap-5">
      <CustomerPicker chosen={customerId} onPick={onPick} />

      {!customerId ? (
        <Empty title="No customer chosen" message="Pick one above to see what moved its score." />
      ) : explanation.isLoading ? (
        <Skeleton className="h-[460px] w-full" />
      ) : explanation.isError ? (
        <ApiError error={explanation.error} title="Could not explain this customer" />
      ) : (
        <>
          <Card className="p-5">
            <CardHeader
              title={<span className="font-mono">{explanation.data!.customer_id}</span>}
              subtitle={`A ${explanation.data!.split} customer of the study split.`}
              action={<LabelTag label={explanation.data!.label} />}
            />
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,260px)]">
              <ContributionSteps
                baseValue={explanation.data!.base_value}
                logit={explanation.data!.logit}
                sumOfContributions={explanation.data!.sum_of_contributions}
                contributions={explanation.data!.contributions}
              />
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-alt p-4">
                <h3 className="m-0 text-[13px] font-medium text-ink">Saved probability, by pipeline</h3>
                <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
                  {Object.entries(explanation.data!.probabilities).map(([name, value]) => (
                    <li key={name} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-ink-2" title={pipelineLabels[name] ?? name}>{pipelineLabels[name] ?? name}</span>
                      <span className="font-mono tabular">{pct(value, 1)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <SourceNote status={explanation.data!.provenance.status} runId={explanation.data!.provenance.run_id}>
                {explanation.data!.provenance.computed_from}. {explanation.data!.provenance.note}
              </SourceNote>
              <Caveat title="A model attribution is not a finding against a customer">{explanation.data!.caveat}</Caveat>
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title="Which weeks the sequence model relied on" subtitle="Each week of readings is occluded in turn; the bar is the fall in the network's log-odds." />
            <div className="mt-4">
              {weeks.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : weeks.isError ? (
                <ApiError error={weeks.error} />
              ) : !weeks.data!.available ? (
                <Empty title="No sequence model in the served pipeline" message={weeks.data!.detail} />
              ) : (
                <div className="flex flex-col gap-4">
                  <WeekEffectsChart weeks={weeks.data!.weeks} />
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
                      <caption className="sr-only">The five weeks with the largest effect on this customer's score</caption>
                      <thead>
                        <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                          <th className="py-2 pr-4 font-medium">Week</th>
                          <th className="py-2 pr-4 font-medium">Dates</th>
                          <th className="py-2 pr-4 text-right font-medium">Effect (log-odds)</th>
                          <th className="py-2 pr-4 text-right font-medium">Missing days</th>
                          <th className="py-2 text-right font-medium">Mean consumption</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weeks.data!.strongest_weeks.map((week) => (
                          <tr key={week.week} className="border-b border-line-soft">
                            <td className="py-2 pr-4 font-mono tabular">{week.week}</td>
                            <td className="py-2 pr-4 font-mono text-xs text-ink-2">{week.start} → {week.end}</td>
                            <td className="py-2 pr-4 text-right font-mono tabular text-risk-text">+{num(week.effect)}</td>
                            <td className={cn("py-2 pr-4 text-right font-mono tabular", week.missing_days > 0 ? "text-amber-ink" : "text-ink-3")}>
                              {week.missing_days} of {week.days}
                            </td>
                            <td className="py-2 text-right font-mono tabular text-ink-2">
                              {week.mean_kwh == null ? "no readings" : `${week.mean_kwh.toFixed(2)} kWh`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="m-0 text-[13px] leading-relaxed text-ink-2">
                    {weeks.data!.missing_days_in_strongest_weeks} of the days in the five strongest weeks have no reading at all.
                    {" "}{weeks.data!.reading}
                  </p>
                  <SourceNote status={weeks.data!.provenance.status} runId={weeks.data!.provenance.run_id}>
                    {weeks.data!.provenance.computed_from}. {weeks.data!.provenance.note}
                  </SourceNote>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title="SHAP against LIME" subtitle="Two explanation methods on the same customer. Disagreement is reported, not hidden." />
            <div className="mt-4">
              {agreement.isLoading ? (
                <Skeleton className="h-52 w-full" />
              ) : agreement.isError ? (
                <ApiError error={agreement.error} title="Could not build the LIME surrogate" />
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <EvidenceBadge status={agreement.data!.agrees ? "executed" : "exploratory"} />
                    <span className="text-[13px] text-ink-2">
                      {agreement.data!.agrees
                        ? "The two methods pick out the same strongest feature and agree on its direction."
                        : "The two methods disagree on this customer. The study's protocol sends such a case to a person."}
                      {" "}
                      {agreement.data!.shared_features.length} of {agreement.data!.top} features appear in both lists,
                      {" "}{agreement.data!.same_direction.length} with the same sign.
                    </span>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="flex flex-col gap-2.5">
                      <h3 className="m-0 text-[13px] font-medium text-ink">SHAP (log-odds)</h3>
                      <WeightBars items={agreement.data!.shap} tone={palette.accent} />
                    </div>
                    <div className="flex flex-col gap-2.5">
                      <h3 className="m-0 text-[13px] font-medium text-ink">LIME ({agreement.data!.samples.toLocaleString()} samples)</h3>
                      <WeightBars items={agreement.data!.lime} tone={palette.synthetic} />
                    </div>
                  </div>
                  <p className="m-0 text-[13px] leading-relaxed text-ink-2">{agreement.data!.reading}</p>
                  <SourceNote status={agreement.data!.provenance.status} runId={agreement.data!.provenance.run_id}>
                    {agreement.data!.provenance.computed_from}.
                  </SourceNote>
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The missingness shortcut
// ---------------------------------------------------------------------------

function MaskExperiment({ customerId }: { customerId: string | null }) {
  const query = useQuery({
    queryKey: ["xai-mask", customerId],
    queryFn: () => getMaskExperiment({ customer_id: customerId! }),
    enabled: !!customerId,
  });
  if (!customerId) return <Empty title="No customer chosen" message="Pick one on the 'One customer' tab to run this counterfactual." />;
  if (query.isLoading) return <Skeleton className="h-52 w-full" />;
  if (query.isError) return <ApiError error={query.error} title="Could not run the masking experiment" />;
  const data = query.data!;
  const rows = [
    ["served", "As served", "The network reads both the consumption values and which days failed to report."],
    ["missingness_hidden", "Missingness hidden", "Every day is marked observed, so the network cannot see which readings failed."],
    ["all_days_marked_missing", "Every day marked missing", "The opposite extreme, as a bound on how far the channel can move the score."],
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[13px]">{data.customer_id}</span>
        <LabelTag label={data.label} />
        <span className="text-[13px] text-ink-2">{pct(data.missing_share)} of this customer's readings are missing.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
          <caption className="sr-only">The sequence model's score for this customer under three versions of its missing-reading channel</caption>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
              <th className="py-2.5 pr-4 font-medium">Input</th>
              <th className="py-2.5 pr-4 text-right font-medium">Score</th>
              <th className="py-2.5 font-medium">What it is</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, label, note]) => (
              <tr key={key} className="border-b border-line-soft">
                <td className="py-2.5 pr-4 font-medium">{label}</td>
                <td className={cn("py-2.5 pr-4 text-right font-mono tabular", key === "served" && "text-cobalt-ink")}>
                  {pct(data.scores[key], 1)}
                </td>
                <td className="py-2.5 text-xs leading-relaxed text-ink-3">{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-[13px] leading-relaxed text-ink-2">
        Hiding the missing-reading channel moves this customer's score by{" "}
        <span className={cn("font-mono tabular", data.effect_of_hiding_missingness < 0 ? "text-risk-text" : "text-cobalt-ink")}>
          {data.effect_of_hiding_missingness >= 0 ? "+" : "−"}{pct(Math.abs(data.effect_of_hiding_missingness), 1)}
        </span>.
      </p>
      <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
        {data.provenance.computed_from}. {data.provenance.note}
      </SourceNote>
      <Caveat title="This is one customer, and a counterfactual input">{data.caveat}</Caveat>
    </div>
  );
}

function ShortcutTab({ customerId }: { customerId: string | null }) {
  const profile = useQuery({ queryKey: ["xai-missingness-profile"], queryFn: getMissingnessProfile });
  const attribution = useQuery({ queryKey: ["xai-missingness-attribution"], queryFn: () => getMissingnessAttribution({ seed: 42 }) });
  const evidence = useQuery({ queryKey: ["xai-shortcut-evidence"], queryFn: getShortcutEvidence });

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <CardHeader
          title="Do missing readings separate the two classes on their own?"
          subtitle="Before asking what the model does, ask what is in the data."
        />
        <div className="mt-4">
          {profile.isLoading ? (
            <Skeleton className="h-[560px] w-full" />
          ) : profile.isError ? (
            <ApiError error={profile.error} />
          ) : (
            <div className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Readings missing overall" value={pct(profile.data!.overall_missing_share)} />
                <Stat
                  label="AUC of missingness alone"
                  value={num(profile.data!.auc_of_missing_share_alone)}
                  tone="risk"
                  hint="ranking customers by their share of missing readings and nothing else"
                />
                <Stat
                  label="Median missing, theft vs honest"
                  value={<span className="text-[30px]">{pct(profile.data!.by_class.theft.median, 0)} / {pct(profile.data!.by_class.honest.median, 0)}</span>}
                  hint={`${profile.data!.by_class.theft.complete_records.toLocaleString()} theft-labelled and ${profile.data!.by_class.honest.complete_records.toLocaleString()} honest-labelled customers have a complete record`}
                />
              </div>
              <MissingnessHistogram profile={profile.data!} />
              <MonthlyMissingness monthly={profile.data!.monthly} />
              <p className="m-0 text-[13px] leading-relaxed text-ink-2">{profile.data!.reading}</p>
              <SourceNote status={profile.data!.provenance.status} runId={profile.data!.provenance.run_id}>
                {profile.data!.provenance.computed_from}.
              </SourceNote>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="How much of the model's attribution sits on missing readings" subtitle="The XGBoost part only; SHAP does not cover the sequence model." />
        <div className="mt-4">
          {attribution.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : attribution.isError ? (
            <ApiError error={attribution.error} />
          ) : (
            <div className="flex flex-col gap-4">
              <Stat
                label="Share of total attribution"
                value={pct(attribution.data!.share_of_total_attribution)}
                tone="risk"
                hint={`over ${attribution.data!.customers.toLocaleString()} sampled test customers`}
              />
              {attribution.data!.features.length === 0 ? (
                <Empty title="No missing-reading feature in the ranking" message="None of the strongest features describe missing readings." />
              ) : (
                <ImportanceBars features={attribution.data!.features} max={12} />
              )}
              <p className="m-0 text-[13px] leading-relaxed text-ink-2">{attribution.data!.reading}</p>
              <SourceNote status={attribution.data!.provenance.status} runId={attribution.data!.provenance.run_id}>
                {attribution.data!.provenance.computed_from}.
              </SourceNote>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="What the recorded experiments show" subtitle="Models retrained without the missing-reading channel, from the sealed runs." />
        <div className="mt-4">
          {evidence.isLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : evidence.isError ? (
            <ApiError error={evidence.error} />
          ) : evidence.data!.sections.length === 0 ? (
            <Empty title="No recorded experiment is available" message="The runs that answer this question have not been executed in this build." />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
                  <caption className="sr-only">PR-AUC of each recorded variant bearing on the missingness question</caption>
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                      <th className="py-2.5 pr-4 font-medium">Variant</th>
                      <th className="py-2.5 pr-4 text-right font-medium">PR-AUC</th>
                      <th className="py-2.5 font-medium">What it is</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidence.data!.sections.map((section) => (
                      <tr key={section.title} className="border-b border-line-soft align-top">
                        <td className="py-2.5 pr-4 font-medium">{section.title}</td>
                        <td className="py-2.5 pr-4 text-right">
                          <span className="flex flex-col items-end gap-1">
                            {Object.entries(section.values).map(([status, body]) => (
                              <span key={status} className="flex items-center gap-2">
                                <span className="font-mono tabular">{num(body.value)}</span>
                                <EvidenceBadge status={status as Evidence} />
                              </span>
                            ))}
                          </span>
                        </td>
                        <td className="py-2.5 text-xs leading-relaxed text-ink-3">{section.reading}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="m-0 text-[13px] leading-relaxed text-ink-2">{evidence.data!.conclusion}</p>
              <div className="rounded-lg border border-line bg-surface-alt p-4">
                <h3 className="m-0 text-[13px] font-medium text-ink">What would settle it</h3>
                <ul className="m-0 mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
                  {evidence.data!.what_would_settle_it.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <SourceNote status={evidence.data!.provenance.status} runId={evidence.data!.provenance.run_id}>
                {evidence.data!.provenance.computed_from}. {evidence.data!.provenance.note}
              </SourceNote>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="One customer, with the channel switched off" subtitle="A counterfactual input to the served network, not a retrained model." />
        <div className="mt-4"><MaskExperiment customerId={customerId} /></div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function XaiCenterPage() {
  const [tab, setTab] = useState<Tab>("global");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [seed, setSeed] = useState(42);
  const [top, setTop] = useState(20);

  return (
    <>
      <PageHeader
        eyebrow="GridSentinel X"
        title="Explainability centre"
        description="What moves the detector's score, for the whole study split and for one customer at a time — and whether what moves it is consumption behaviour or the fact that a meter stopped reporting."
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <Segmented label="Explainability view" value={tab} onChange={setTab} options={TABS.map(([value, label]) => ({ value, label }))} />
        </div>
        {tab === "global" ? (
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Features
              <input type="range" min={5} max={40} value={top} onChange={(event) => setTop(Number(event.target.value))}
                className="studio-range w-28" aria-valuetext={`${top} features`} />
              <span className="font-mono tabular">{top}</span>
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Sample seed
              <input type="number" min={0} max={10000} value={seed} onChange={(event) => setSeed(Number(event.target.value))}
                className="h-9 w-20 rounded-lg border border-line bg-surface-alt px-2 font-mono text-[13px] text-ink" />
            </label>
          </div>
        ) : null}
      </div>

      <div className="mt-5">
        {tab === "global" ? <GlobalTab seed={seed} top={top} /> : null}
        {tab === "customer" ? <CustomerTab customerId={customerId} onPick={setCustomerId} /> : null}
        {tab === "shortcut" ? <ShortcutTab customerId={customerId} /> : null}
      </div>
    </>
  );
}
