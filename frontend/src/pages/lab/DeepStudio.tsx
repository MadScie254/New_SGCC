import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, Card, CardHeader, Empty, PageHeader, Segmented, Skeleton, Stat } from "@/components/ui";
import { Caveat, SourceNote } from "@/components/evidence";
import { LearningCurveChart, SeedSpread, TrainingHistory, WeightSweepChart } from "@/components/viz/DeepPlots";
import {
  getAgainstFeatures, getHybridStudy, getLearningCurves, getNetwork, getWeightSweep,
} from "@/lib/api/deeplab";
import { pipelineLabels } from "@/lib/palette";
import { cn } from "@/lib/cn";

const TABS = [
  ["network", "The network"],
  ["against", "Against the feature model"],
  ["hybrid", "The blend"],
  ["curves", "Learning curves"],
] as const;
type Tab = (typeof TABS)[number][0];

const num = (v: number | null | undefined, digits = 3) => (v == null ? "–" : v.toFixed(digits));
const pct = (v: number | null | undefined, digits = 1) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);
const int = (v: number | null | undefined) => (v == null ? "–" : v.toLocaleString());

// ---------------------------------------------------------------------------

function NetworkTab() {
  const query = useQuery({ queryKey: ["deep-network"], queryFn: getNetwork });
  if (query.isLoading) return <Skeleton className="h-[560px] w-full" />;
  if (query.isError) return <ApiError error={query.error} title="Could not read the deep-learning record" />;
  const data = query.data!;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Parameters" value={int(data.parameters)} hint="weights in the network" />
        <Stat label="Epochs run" value={int(data.training.epochs_run)}
          hint={`stopped after ${int(data.training.patience)} without improvement`} />
        <Stat label="Weights kept" value={`epoch ${int(data.training.best_epoch)}`} hint="the best validation score" />
        <Stat label="Training time" value={`${num(data.cost.training_time, 0)} s`}
          hint={`on ${data.training.device ?? "unknown hardware"}`} />
      </div>

      <Card className="p-5">
        <CardHeader title="What the network is" subtitle={data.label} />
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <dl className="m-0 grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13px]">
            <dt className="text-ink-2">Wide branch</dt>
            <dd className="m-0 font-mono text-[12.5px]">{data.architecture.wide ?? "–"}</dd>
            <dt className="text-ink-2">Deep branch</dt>
            <dd className="m-0 font-mono text-[12.5px]">{data.architecture.deep ?? "–"}</dd>
            <dt className="text-ink-2">Framework</dt>
            <dd className="m-0 font-mono text-[12.5px]">{data.training.torch ? `torch ${data.training.torch}` : "–"}</dd>
            <dt className="text-ink-2">Inference</dt>
            <dd className="m-0 font-mono text-[12.5px]">
              {data.cost.inference_ms_per_customer == null ? "–" : `${data.cost.inference_ms_per_customer.toFixed(2)} ms per customer`}
            </dd>
          </dl>
          <dl className="m-0 grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13px]">
            {Object.entries(data.settings).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-ink-2">{key.replace(/_/g, " ")}</dt>
                <dd className="m-0 font-mono text-[12.5px]">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="How it trained" subtitle="Training loss against the validation score it was stopped on." />
        <div className="mt-4 flex flex-col gap-4">
          {data.history.length ? <TrainingHistory history={data.history} bestEpoch={data.training.best_epoch} />
            : <Empty title="No training history in the record" />}
          <p className="m-0 text-[13px] leading-relaxed text-ink-2">{data.reading}</p>
          <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
            {data.provenance.computed_from}. {data.provenance.note}
          </SourceNote>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AgainstTab() {
  const query = useQuery({ queryKey: ["deep-against"], queryFn: getAgainstFeatures });
  if (query.isLoading) return <Skeleton className="h-[520px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;
  const differences = data.per_seed.map((r) => r.difference_from_xgboost).filter((d): d is number => d != null);
  const reference = data.per_seed[0]?.pr_auc != null && differences.length
    ? data.per_seed[0].pr_auc - differences[0]
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Retrainings" value={int(data.runs)} hint="each from a different seed" />
        <Stat label="Mean PR-AUC" value={num(data.mean.pr_auc)} hint={`± ${num(data.sd.pr_auc, 4)} across seeds`} />
        <Stat label="Seeds that beat XGBoost" value={`${int(data.higher_than_xgboost)} of ${int(data.runs)}`}
          tone={data.higher_than_xgboost === data.runs ? "cobalt" : "risk"} />
        <Stat label="Spread of the gain"
          value={differences.length ? `${num(Math.min(...differences))} – ${num(Math.max(...differences))}` : "–"}
          hint="difference from standard XGBoost, per seed" />
      </div>

      <Card className="p-5">
        <CardHeader title="Does it win on every seed, or just on one?"
          subtitle="Each point is a complete retraining of the network on the same split." />
        <div className="mt-4 flex flex-col gap-5">
          <SeedSpread rows={data.per_seed.map((r) => ({ seed: r.seed, value: r.pr_auc }))}
            reference={reference} referenceLabel="standard XGBoost" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Each seed's metrics and its difference from standard XGBoost</caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                  <th className="py-2.5 pr-4 font-medium">Seed</th>
                  <th className="py-2.5 pr-4 text-right font-medium">PR-AUC</th>
                  <th className="py-2.5 pr-4 text-right font-medium">ROC-AUC</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Recall</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Precision</th>
                  <th className="py-2.5 text-right font-medium">vs XGBoost</th>
                </tr>
              </thead>
              <tbody>
                {data.per_seed.map((row) => (
                  <tr key={row.seed} className="border-b border-line-soft">
                    <td className="py-2.5 pr-4 font-mono tabular">{row.seed}</td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular">{num(row.pr_auc)}</td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{num(row.auc)}</td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{pct(row.recall)}</td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{pct(row.precision)}</td>
                    <td className={cn("py-2.5 text-right font-mono tabular",
                      (row.difference_from_xgboost ?? 0) >= 0 ? "text-ok" : "text-risk-text")}>
                      {row.difference_from_xgboost == null ? "–"
                        : `${row.difference_from_xgboost >= 0 ? "+" : "−"}${Math.abs(row.difference_from_xgboost).toFixed(4)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 text-[13px] leading-relaxed text-ink-2">{data.reading}</p>
          {data.note ? <p className="m-0 text-xs leading-relaxed text-ink-3">{data.note}</p> : null}
          <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
            {data.provenance.computed_from}. {data.provenance.note}
          </SourceNote>
        </div>
      </Card>

      {Object.keys(data.bootstrap.comparisons).length ? (
        <Card className="p-5">
          <CardHeader title="The bootstrap on the served split"
            subtitle={`Paired stratified bootstrap over ${int(data.bootstrap.resamples)} resamples, against ${data.bootstrap.reference ?? "the reference"}.`} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Bootstrap comparisons of the network against each reference pipeline</caption>
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
                {Object.entries(data.bootstrap.comparisons).map(([name, body]) => {
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
                      <td className="py-2.5">{entry.significant ? "a real difference at this sample size" : "indistinguishable at this sample size"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function HybridTab() {
  const study = useQuery({ queryKey: ["deep-hybrid"], queryFn: getHybridStudy });
  const sweep = useQuery({ queryKey: ["deep-sweep"], queryFn: () => getWeightSweep({ step: 0.05 }) });

  return (
    <div className="flex flex-col gap-5">
      {sweep.isLoading ? <Skeleton className="h-[480px] w-full" /> : sweep.isError ? <ApiError error={sweep.error} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Weight on the network" value={num(sweep.data!.served_weight, 2)} hint="chosen on validation customers" />
            <Stat label="Feature model alone" value={num(sweep.data!.features_only)} />
            <Stat label="Network alone" value={num(sweep.data!.cnn_only)} />
            <Stat label="The blend buys" value={`+${num(sweep.data!.gain_over_best_part)}`} tone="cobalt"
              hint="over the better of its two parts, on validation" />
          </div>

          <Card className="p-5">
            <CardHeader title="Why that weight?"
              subtitle="The study's own selection, recomputed from its saved validation predictions." />
            <div className="mt-4 flex flex-col gap-4">
              <WeightSweepChart sweep={sweep.data!} />
              <p className="m-0 text-[13px] leading-relaxed text-ink-2">{sweep.data!.reading}</p>
              <SourceNote status={sweep.data!.provenance.status} runId={sweep.data!.provenance.run_id}>
                {sweep.data!.provenance.computed_from}. {sweep.data!.provenance.note}
              </SourceNote>
              <Caveat title="A fitted parameter is never swept on the test customers">{sweep.data!.caveat}</Caveat>
            </div>
          </Card>
        </>
      )}

      {study.isLoading ? <Skeleton className="h-[420px] w-full" /> : study.isError ? <ApiError error={study.error} /> : (
        <Card className="p-5">
          <CardHeader title="The blend against its parts, seed by seed"
            subtitle={`Each seed retrains the network, re-chooses the weight on validation customers and scores the test customers once.`} />
          <div className="mt-4 flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-3">
              {(["hybrid", "cnn", "xgboost"] as const).map((name) => (
                <Stat key={name}
                  label={name === "hybrid" ? "Hybrid" : name === "cnn" ? "Network alone" : "Feature model alone"}
                  value={num(study.data!.summary[name]?.mean?.pr_auc)}
                  hint={`± ${num(study.data!.summary[name]?.sd?.pr_auc, 4)} across ${study.data!.seeds.length} seeds`} />
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left text-[13px]">
                <caption className="sr-only">Each seed's hybrid, network and feature-model precision–recall area</caption>
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                    <th className="py-2.5 pr-4 font-medium">Seed</th>
                    <th className="py-2.5 pr-4 text-right font-medium">Weight chosen</th>
                    <th className="py-2.5 pr-4 text-right font-medium">Hybrid</th>
                    <th className="py-2.5 pr-4 text-right font-medium">Network</th>
                    <th className="py-2.5 text-right font-medium">Feature model</th>
                  </tr>
                </thead>
                <tbody>
                  {study.data!.per_seed.map((row) => (
                    <tr key={row.seed} className="border-b border-line-soft">
                      <td className="py-2.5 pr-4 font-mono tabular">{row.seed}</td>
                      <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{num(row.weight_cnn, 2)}</td>
                      <td className="py-2.5 pr-4 text-right font-mono tabular font-semibold">{num(row.hybrid)}</td>
                      <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{num(row.cnn)}</td>
                      <td className="py-2.5 text-right font-mono tabular text-ink-2">{num(row.xgboost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 text-[13px] leading-relaxed text-ink-2">
              The hybrid scored above the feature model on {int(study.data!.higher_than.xgboost)} of{" "}
              {study.data!.seeds.length} seeds, and above the network alone on {int(study.data!.higher_than.cnn)}.
              {" "}{study.data!.reading}
            </p>
            <SourceNote status={study.data!.provenance.status} runId={study.data!.provenance.run_id}>
              {study.data!.provenance.computed_from}. {study.data!.provenance.note}
            </SourceNote>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CurvesTab() {
  const query = useQuery({ queryKey: ["deep-curves"], queryFn: getLearningCurves });
  if (query.isLoading) return <Skeleton className="h-[420px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;

  return (
    <Card className="p-5">
      <CardHeader title="What the boosted models learned that did not generalise"
        subtitle="Training score against validation score, iteration by iteration." />
      <div className="mt-4 flex flex-col gap-5">
        <div className="grid gap-8 lg:grid-cols-2">
          {data.curves.map((curve) => (
            <LearningCurveChart key={curve.pipeline} pipeline={curve.pipeline}
              train={curve.train_pr_auc} validation={curve.validation_pr_auc} bestIteration={curve.best_iteration} />
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <caption className="sr-only">The gap between training and validation score at the end of training</caption>
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                <th className="py-2 pr-4 font-medium">Pipeline</th>
                <th className="py-2 pr-4 text-right font-medium">Best iteration</th>
                <th className="py-2 text-right font-medium">Final train − validation</th>
              </tr>
            </thead>
            <tbody>
              {data.curves.map((curve) => (
                <tr key={curve.pipeline} className="border-b border-line-soft">
                  <td className="py-2 pr-4">{pipelineLabels[curve.pipeline] ?? curve.pipeline}</td>
                  <td className="py-2 pr-4 text-right font-mono tabular text-ink-2">{int(curve.best_iteration)}</td>
                  <td className="py-2 text-right font-mono tabular">{num(curve.final_gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 text-[13px] leading-relaxed text-ink-2">{data.reading}</p>
        <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
          {data.provenance.computed_from}.
        </SourceNote>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function DeepStudioPage() {
  const [tab, setTab] = useState<Tab>("network");

  return (
    <>
      <PageHeader
        title="Deep learning and ensemble studio"
        description="A convolutional network on the daily readings, the gradient-boosted model on the engineered features, and the blend of the two. An ensemble claim is only as good as its weakest check, so the seeds and the weight are shown here rather than summarised."
      />
      <div className="mt-6 -mx-1 max-w-full overflow-x-auto px-1">
        <Segmented label="Deep learning view" value={tab} onChange={setTab} options={TABS.map(([value, label]) => ({ value, label }))} />
      </div>
      <div className="mt-5">
        {tab === "network" ? <NetworkTab /> : null}
        {tab === "against" ? <AgainstTab /> : null}
        {tab === "hybrid" ? <HybridTab /> : null}
        {tab === "curves" ? <CurvesTab /> : null}
      </div>
    </>
  );
}
