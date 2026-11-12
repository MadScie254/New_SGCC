import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, Card, CardHeader, PageHeader, Segmented, Skeleton, Stat } from "@/components/ui";
import { Caveat, SourceNote } from "@/components/evidence";
import { FeatureShift, SensitivityBars, StageCounts } from "@/components/viz/ImbalancePlots";
import {
  getFairTest, getImbalanceOverview, getSensitivity, getTreatmentEffect, getTreatments, tryTreatment,
} from "@/lib/api/imbalance";
import type { Diagnostics } from "@/lib/api/imbalance";
import { pipelineLabels } from "@/lib/palette";
import { cn } from "@/lib/cn";

const TABS = [
  ["imbalance", "The imbalance"],
  ["treatment", "What SMOTE+ENN did"],
  ["sensitivity", "Treatment comparison"],
  ["try", "Try a treatment"],
] as const;
type Tab = (typeof TABS)[number][0];

const pct = (v: number | null | undefined, digits = 1) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);
const num = (v: number | null | undefined, digits = 3) => (v == null ? "–" : v.toFixed(digits));
const int = (v: number | null | undefined) => (v == null ? "–" : v.toLocaleString());

const DIAGNOSTIC_ROWS = [
  ["theft_share", "Theft share of the rows", "how balanced the training data is", 1],
  ["silhouette", "Silhouette", "how separated the two classes are (higher is more separated)", 0],
  ["fisher_ratio_mean", "Fisher ratio, mean", "mean per-feature separation", 0],
  ["fisher_ratio_max", "Fisher ratio, strongest feature", "the single most separating feature", 0],
  ["boundary_noise", "Boundary noise", "share of rows whose neighbours mostly carry the other label", 1],
  ["boundary_noise_theft", "Boundary noise, theft rows", "the same, among theft-labelled rows only", 1],
] as const;

function DiagnosticsTable({ columns }: { columns: Array<{ label: string; diagnostics: Diagnostics }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-left text-[13px]">
        <caption className="sr-only">Separability and boundary-noise measures at each stage of the treatment</caption>
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
            <th className="py-2.5 pr-4 font-medium">Measure</th>
            {columns.map((column) => <th key={column.label} className="py-2.5 pr-4 text-right font-medium">{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line-soft">
            <td className="py-2.5 pr-4">
              <span className="font-medium">Rows</span>
              <span className="block text-xs text-ink-3">how many feature rows the model would train on</span>
            </td>
            {columns.map((column) => (
              <td key={column.label} className="py-2.5 pr-4 text-right font-mono tabular">{int(column.diagnostics.rows)}</td>
            ))}
          </tr>
          {DIAGNOSTIC_ROWS.map(([key, label, hint, isShare]) => (
            <tr key={key} className="border-b border-line-soft">
              <td className="py-2.5 pr-4">
                <span className="font-medium">{label}</span>
                <span className="block text-xs text-ink-3">{hint}</span>
              </td>
              {columns.map((column) => (
                <td key={column.label} className="py-2.5 pr-4 text-right font-mono tabular">
                  {isShare ? pct(column.diagnostics[key], 1) : num(column.diagnostics[key], 4)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ImbalanceTab() {
  const query = useQuery({ queryKey: ["imb-overview"], queryFn: getImbalanceOverview });
  if (query.isLoading) return <Skeleton className="h-[520px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;
  const bestRecall = data.pipelines.reduce((a, b) => ((b.recall ?? 0) > (a.recall ?? 0) ? b : a), data.pipelines[0]);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Theft-labelled customers" value={int(data.theft)} tone="risk" hint={pct(data.base_rate, 2)} />
        <Stat label="Honest-labelled customers" value={int(data.honest)} />
        <Stat label="Imbalance" value={`${num(data.imbalance_ratio, 1)}:1`} hint="honest to theft" />
        <Stat label="Accuracy of flagging nobody" value={pct(data.never_flag_anyone.accuracy)} tone="risk"
          hint={`and ${int(data.never_flag_anyone.thefts_missed)} thefts missed`} />
      </div>

      <Card className="p-5">
        <CardHeader title="Why accuracy cannot be the measure"
          subtitle="A model that flags nobody beats most honest attempts on accuracy, and is worthless." />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-left text-[13px]">
            <caption className="sr-only">Each pipeline's accuracy against its recall, with the treatment it used</caption>
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                <th className="py-2.5 pr-4 font-medium">Pipeline</th>
                <th className="py-2.5 pr-4 font-medium">Imbalance treatment</th>
                <th className="py-2.5 pr-4 text-right font-medium">Accuracy</th>
                <th className="py-2.5 pr-4 text-right font-medium">Recall</th>
                <th className="py-2.5 pr-4 text-right font-medium">Precision</th>
                <th className="py-2.5 pr-4 text-right font-medium">PR-AUC</th>
                <th className="py-2.5 pr-4 text-right font-medium">MCC</th>
                <th className="py-2.5 text-right font-medium">Thefts found / missed</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line-soft bg-risk-bg/40">
                <td className="py-2.5 pr-4 font-medium">Flag nobody</td>
                <td className="py-2.5 pr-4 text-ink-3">none — it is not a model</td>
                <td className="py-2.5 pr-4 text-right font-mono tabular font-semibold text-risk-text">{pct(data.never_flag_anyone.accuracy)}</td>
                <td className="py-2.5 pr-4 text-right font-mono tabular">0.0%</td>
                <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-3">–</td>
                <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-3">–</td>
                <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-3">0.000</td>
                <td className="py-2.5 text-right font-mono tabular">0 / {int(data.never_flag_anyone.thefts_missed)}</td>
              </tr>
              {data.pipelines.map((row) => (
                <tr key={row.pipeline} className="border-b border-line-soft">
                  <td className="py-2.5 pr-4">
                    <span className="flex items-center gap-2">
                      {pipelineLabels[row.pipeline] ?? row.label}
                      {row.served ? <span className="rounded-full bg-cobalt px-2 py-0.5 text-[10px] font-semibold text-on-accent">served</span> : null}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-ink-2">{row.treatment}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{pct(row.accuracy)}</td>
                  <td className={cn("py-2.5 pr-4 text-right font-mono tabular", row.pipeline === bestRecall?.pipeline && "font-semibold text-cobalt-ink")}>
                    {pct(row.recall)}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular">{pct(row.precision)}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular">{num(row.pr_auc)}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular">{num(row.mcc)}</td>
                  <td className="py-2.5 text-right font-mono tabular text-ink-2">
                    {int(row.thefts_found)} / {int(row.thefts_missed)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 mt-4 text-[13px] leading-relaxed text-ink-2">{data.reading}</p>
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

function TreatmentTab() {
  const query = useQuery({ queryKey: ["imb-treatment"], queryFn: getTreatmentEffect });
  if (query.isLoading) return <Skeleton className="h-[560px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;
  const { counts } = data;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Synthetic rows created" value={int(counts.synthetic_created)} hint="interpolated between real theft rows" />
        <Stat label="Real honest rows deleted" value={int(counts.honest_removed_by_enn)} tone="risk"
          hint="removed by ENN as boundary noise" />
        <Stat label="Real theft rows deleted" value={int(counts.theft_removed_by_enn)} tone="risk" />
        <Stat label="Theft share after" value={pct(data.stages[2]?.diagnostics.theft_share)}
          hint={`from ${pct(data.stages[0]?.diagnostics.theft_share)} before`} />
      </div>

      <Card className="p-5">
        <CardHeader title="What the treatment did to the training rows"
          subtitle={`Sampling ratio ${data.config.sampling_strategy}, SMOTE k = ${data.config.smote_k_neighbors}, ENN k = ${data.config.enn_n_neighbors}.`} />
        <div className="mt-4 flex flex-col gap-5">
          <StageCounts counts={counts} />
          <DiagnosticsTable columns={data.stages.map((s) => ({ label: s.label, diagnostics: s.diagnostics }))} />
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px] leading-relaxed text-ink-2">
            {data.stages.map((stage) => (
              <li key={stage.stage} className="flex gap-2">
                <span className="font-medium text-ink">{stage.label}:</span>
                <span>{stage.note}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-[13px] leading-relaxed text-ink-2">{data.reading}</p>
          <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
            {data.provenance.computed_from}. {data.provenance.note}
          </SourceNote>
          <Caveat title="A synthetic row is not a customer">{data.caveat}</Caveat>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SensitivityTab() {
  const grid = useQuery({ queryKey: ["imb-sensitivity"], queryFn: getSensitivity });
  const fair = useQuery({ queryKey: ["imb-fair-test"], queryFn: getFairTest });

  return (
    <div className="flex flex-col gap-5">
      {grid.isLoading ? <Skeleton className="h-[560px] w-full" /> : grid.isError ? <ApiError error={grid.error} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Best treatment" value={<span className="font-sans text-[18px] leading-tight">{grid.data!.best?.name ?? "–"}</span>}
              hint={`PR-AUC ${num(grid.data!.best?.pr_auc)}`} />
            <Stat label="The proposal's setting" value={num(grid.data!.proposed?.pr_auc)}
              hint={grid.data!.proposed?.name ?? ""} />
            <Stat
              label="The proposal's setting, against no resampling"
              value={(() => {
                const proposed = grid.data!.proposed?.pr_auc;
                const baseline = grid.data!.baseline?.pr_auc;
                if (proposed == null || baseline == null) return "–";
                return `${proposed - baseline >= 0 ? "+" : "−"}${Math.abs(proposed - baseline).toFixed(3)}`;
              })()}
              tone={(grid.data!.proposed?.pr_auc ?? 0) < (grid.data!.baseline?.pr_auc ?? 0) ? "risk" : "ink"}
              hint={`no resampling reaches ${num(grid.data!.baseline?.pr_auc)} over ${int(grid.data!.customers)} development customers`}
            />
          </div>

          <Card className="p-5">
            <CardHeader title="Does the resampling choice change the answer?"
              subtitle="Every treatment under the same folds, the same features and the same fixed hyperparameters." />
            <div className="mt-4 flex flex-col gap-5">
              <SensitivityBars variants={grid.data!.variants} baseline={grid.data!.baseline} />
              <p className="m-0 text-[13px] leading-relaxed text-ink-2">{grid.data!.reading}</p>
              <SourceNote status={grid.data!.provenance.status} runId={grid.data!.provenance.run_id}>
                {grid.data!.provenance.computed_from}. {grid.data!.provenance.note}
              </SourceNote>
            </div>
          </Card>
        </>
      )}

      {fair.isLoading ? <Skeleton className="h-64 w-full" /> : fair.isError ? <ApiError error={fair.error} /> : (
        <Card className="p-5">
          <CardHeader title="The fair test" subtitle={fair.data!.label ?? "SMOTE+ENN tuned under the same budget"} />
          <div className="mt-4 flex flex-col gap-4">
            <p className="m-0 text-[13px] leading-relaxed text-ink-2">{fair.data!.reading}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left text-[13px]">
                <caption className="sr-only">Bootstrap comparisons of the fairly tuned pipeline against its references</caption>
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                    <th className="py-2.5 pr-4 font-medium">Compared with</th>
                    <th className="py-2.5 pr-4 text-right font-medium">Difference in PR-AUC</th>
                    <th className="py-2.5 pr-4 text-right font-medium">95% interval</th>
                    <th className="py-2.5 pr-4 text-right font-medium">p (Holm)</th>
                    <th className="py-2.5 font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(fair.data!.comparisons).map(([name, body]) => {
                    const entry = body.pr_auc;
                    if (!entry) return null;
                    return (
                      <tr key={name} className="border-b border-line-soft">
                        <td className="py-2.5 pr-4">{pipelineLabels[name] ?? name}</td>
                        <td className={cn("py-2.5 pr-4 text-right font-mono tabular", entry.difference >= 0 ? "text-ok" : "text-risk-text")}>
                          {entry.difference >= 0 ? "+" : "−"}{Math.abs(entry.difference).toFixed(4)}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">
                          [{entry.ci_low.toFixed(4)}, {entry.ci_high.toFixed(4)}]
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular">{entry.p_holm.toFixed(4)}</td>
                        <td className="py-2.5 text-[13px]">
                          {entry.significant ? "a real difference at this sample size" : "indistinguishable at this sample size"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="m-0 text-xs leading-relaxed text-ink-3">
              Tuned over {int(fair.data!.tuning.trials)} trials, threshold {num(fair.data!.threshold)} chosen on validation
              customers, scored once on the test customers. Paired stratified bootstrap over {int(fair.data!.resamples)} resamples.
            </p>
            <SourceNote status={fair.data!.provenance.status} runId={fair.data!.provenance.run_id}>
              {fair.data!.provenance.computed_from}. {fair.data!.provenance.note}
            </SourceNote>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TryTab() {
  const [kind, setKind] = useState("smote_enn");
  const [ratio, setRatio] = useState(0.5);
  const [k, setK] = useState(5);
  const [ennK, setEnnK] = useState(3);
  const [sample, setSample] = useState(2000);
  const [feature, setFeature] = useState("");

  const treatments = useQuery({ queryKey: ["imb-treatments"], queryFn: getTreatments });
  const result = useQuery({
    queryKey: ["imb-try", kind, ratio, k, ennK, sample, feature],
    queryFn: () => tryTreatment({ kind, sampling_strategy: ratio, smote_k_neighbors: k, enn_n_neighbors: ennK, sample, feature }),
  });

  const usesSmote = kind !== "none" && kind !== "undersample";
  const usesEnn = kind === "smote_enn";

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <CardHeader title="Apply a treatment to training rows"
          subtitle="A stratified sample of training customers, resampled now. Outside the study's protocol, so everything here is exploratory." />
        <div className="mt-4 flex flex-col gap-4">
          <label className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            Treatment
            <select value={kind} onChange={(event) => setKind(event.target.value)}
              className="h-9 rounded-lg border border-line bg-surface-alt px-2 text-[13px] text-ink">
              {(treatments.data ?? []).map((t) => <option key={t.kind} value={t.kind}>{t.label}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Target ratio
              <input type="range" min={0.05} max={1} step={0.05} value={ratio} disabled={kind === "none"}
                onChange={(event) => setRatio(Number(event.target.value))} className="studio-range w-32"
                aria-valuetext={`${ratio.toFixed(2)} theft to honest`} />
              <span className="font-mono tabular">{ratio.toFixed(2)}</span>
            </label>
            <label className={cn("flex items-center gap-2 text-[13px]", usesSmote ? "text-ink-2" : "text-ink-3")}>
              SMOTE k
              <input type="range" min={1} max={20} value={k} disabled={!usesSmote}
                onChange={(event) => setK(Number(event.target.value))} className="studio-range w-24"
                aria-valuetext={`${k} neighbours`} />
              <span className="font-mono tabular">{k}</span>
            </label>
            <label className={cn("flex items-center gap-2 text-[13px]", usesEnn ? "text-ink-2" : "text-ink-3")}>
              ENN k
              <input type="range" min={1} max={20} value={ennK} disabled={!usesEnn}
                onChange={(event) => setEnnK(Number(event.target.value))} className="studio-range w-24"
                aria-valuetext={`${ennK} neighbours`} />
              <span className="font-mono tabular">{ennK}</span>
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Sample
              <input type="range" min={500} max={4000} step={250} value={sample}
                onChange={(event) => setSample(Number(event.target.value))} className="studio-range w-32"
                aria-valuetext={`${sample} customers`} />
              <span className="font-mono tabular">{sample.toLocaleString()}</span>
            </label>
          </div>
        </div>
      </Card>

      {result.isLoading ? <Skeleton className="h-[520px] w-full" /> : result.isError ? <ApiError error={result.error} /> : (
        <>
          <Card className="p-5">
            <CardHeader title={result.data!.label}
              subtitle={`${int(result.data!.sample.customers)} training customers, ${int(result.data!.sample.theft)} theft-labelled.`} />
            <div className="mt-4 flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Rows before" value={int(result.data!.counts.before.honest + result.data!.counts.before.theft)} />
                <Stat label="Rows after" value={int(result.data!.counts.after.honest + result.data!.counts.after.theft)} />
                <Stat label="Synthetic created" value={int(result.data!.counts.synthetic_created ?? 0)} />
                <Stat label="Theft share after" value={pct(result.data!.diagnostics.after.theft_share)}
                  hint={`from ${pct(result.data!.diagnostics.before.theft_share)}`} />
              </div>
              <DiagnosticsTable columns={[
                { label: "Before", diagnostics: result.data!.diagnostics.before },
                { label: "After", diagnostics: result.data!.diagnostics.after },
              ]} />
              <SourceNote status={result.data!.provenance.status}>
                {result.data!.provenance.computed_from}. {result.data!.provenance.note}
              </SourceNote>
              <Caveat title="A synthetic row is not a customer">{result.data!.caveat}</Caveat>
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title="Where the new rows landed"
              subtitle="One feature's distribution among theft-labelled rows, before the treatment and after it." />
            <div className="mt-4 flex flex-col gap-4">
              <label className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                Feature
                <select value={result.data!.feature.feature} onChange={(event) => setFeature(event.target.value)}
                  className="h-9 max-w-full rounded-lg border border-line bg-surface-alt px-2 text-[13px] text-ink">
                  {result.data!.features.map((f) => (
                    <option key={f.feature} value={f.feature}>{f.label}</option>
                  ))}
                </select>
                <span className="text-xs text-ink-3">the twelve features that separate the classes best in this sample</span>
              </label>
              <FeatureShift result={result.data!} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ImbalanceLabPage() {
  const [tab, setTab] = useState<Tab>("imbalance");

  return (
    <>
      <PageHeader
        title="Class imbalance laboratory"
        description="Theft-labelled customers are about one in twelve. That breaks accuracy as a measure and makes the resampling choice the proposal's central methodological claim, so this workspace shows what the treatment does and what it costs."
      />
      <div className="mt-6 -mx-1 max-w-full overflow-x-auto px-1">
        <Segmented label="Imbalance view" value={tab} onChange={setTab} options={TABS.map(([value, label]) => ({ value, label }))} />
      </div>
      <div className="mt-5">
        {tab === "imbalance" ? <ImbalanceTab /> : null}
        {tab === "treatment" ? <TreatmentTab /> : null}
        {tab === "sensitivity" ? <SensitivityTab /> : null}
        {tab === "try" ? <TryTab /> : null}
      </div>
    </>
  );
}
