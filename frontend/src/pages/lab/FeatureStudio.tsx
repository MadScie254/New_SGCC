import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, Card, CardHeader, PageHeader, Segmented, Skeleton, Stat } from "@/components/ui";
import { Caveat, SourceNote } from "@/components/evidence";
import { AblationBars, FeatureRanking, GroupShare, HistoryCurve, groupColour } from "@/components/viz/FeaturePlots";
import { ClassBars } from "@/components/viz/ObservatoryPlots";
import {
  getAblation, getCatalog, getFeatureDistribution, getFeatureNames, getHistoryLength,
} from "@/lib/api/features";
import { cn } from "@/lib/cn";

const TABS = [
  ["catalog", "The features"],
  ["distribution", "One feature"],
  ["ablation", "What each layer buys"],
  ["history", "How much history"],
] as const;
type Tab = (typeof TABS)[number][0];

const num = (v: number | null | undefined, digits = 3) => (v == null ? "–" : v.toFixed(digits));
const pct = (v: number | null | undefined, digits = 1) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);
const int = (v: number | null | undefined) => (v == null ? "–" : v.toLocaleString());

// ---------------------------------------------------------------------------

function CatalogTab() {
  const query = useQuery({ queryKey: ["feat-catalog"], queryFn: getCatalog });
  const [group, setGroup] = useState<string>("all");
  if (query.isLoading) return <Skeleton className="h-[560px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;
  const shown = group === "all" ? data.features : data.features.filter((f) => f.group === group);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Features built per customer" value={int(data.total_features)}
          hint="from 1,034 daily readings" />
        <Stat label="Core features" value={int(data.core_features)} hint="the proposal's original set" />
        <Stat label="Strongest feature"
          value={<span className="font-sans text-[18px] leading-tight">{data.features[0]?.label ?? "–"}</span>}
          hint={`${pct(data.features[0]?.share, 1)} of the model's importance`} />
        <Stat label="Top ten carry" value={pct(data.features.slice(0, 10).reduce((s, f) => s + f.share, 0))}
          hint="of the model's total importance" />
      </div>

      <Card className="p-5">
        <CardHeader title="What the model is given" subtitle={data.reading} />
        <div className="mt-4 flex flex-col gap-5">
          <GroupShare groups={data.groups} />
          <FeatureRanking features={data.features} max={20} />
          <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
            {data.provenance.computed_from}.
          </SourceNote>
          <Caveat title="Importance is use, not cause">{data.provenance.note}</Caveat>
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="Every feature" subtitle="Ranked by how much the served model leaned on it."
          action={
            <select value={group} onChange={(event) => setGroup(event.target.value)}
              aria-label="Filter by feature group"
              className="h-9 rounded-lg border border-line bg-surface-alt px-2 text-[13px] text-ink">
              <option value="all">All groups</option>
              {data.groups.map((g) => <option key={g.group} value={g.group}>{g.group}</option>)}
            </select>
          } />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
            <caption className="sr-only">Every engineered feature with its group and the share of model importance it carries</caption>
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                <th className="py-2.5 pr-4 font-medium">Rank</th>
                <th className="py-2.5 pr-4 font-medium">Feature</th>
                <th className="py-2.5 pr-4 font-medium">Group</th>
                <th className="py-2.5 pr-4 font-medium">In the core set</th>
                <th className="py-2.5 text-right font-medium">Share of importance</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.feature} className="border-b border-line-soft">
                  <td className="py-2 pr-4 font-mono tabular text-ink-3">{row.rank}</td>
                  <td className="py-2 pr-4">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: groupColour(row.group) }} />
                      <span>{row.label}</span>
                      <span className="font-mono text-[11px] text-ink-3">{row.feature}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-ink-2">{row.group}</td>
                  <td className="py-2 pr-4 text-ink-3">{row.core ? "yes" : "—"}</td>
                  <td className="py-2 text-right font-mono tabular">{(row.share * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DistributionTab() {
  const names = useQuery({ queryKey: ["feat-names"], queryFn: getFeatureNames });
  const [feature, setFeature] = useState<string>("");
  const chosen = feature || names.data?.[0]?.feature || "";
  const query = useQuery({
    queryKey: ["feat-distribution", chosen],
    queryFn: () => getFeatureDistribution({ feature: chosen, bins: 30 }),
    enabled: !!chosen,
  });

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <CardHeader title="One feature, in each labelled class"
          subtitle="Measured from the release itself, not from a model." />
        <div className="mt-4">
          <label className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            Feature
            <select value={chosen} onChange={(event) => setFeature(event.target.value)}
              className="h-9 max-w-full rounded-lg border border-line bg-surface-alt px-2 text-[13px] text-ink">
              {(names.data ?? []).map((n) => (
                <option key={n.feature} value={n.feature}>{n.rank}. {n.label} ({n.group})</option>
              ))}
            </select>
            <span className="text-xs text-ink-3">ordered by how much the served model used it</span>
          </label>
        </div>
      </Card>

      {query.isLoading ? <Skeleton className="h-[460px] w-full" /> : query.isError ? <ApiError error={query.error} /> : query.data ? (
        <Card className="p-5">
          <CardHeader
            title={query.data.label}
            subtitle={`${query.data.group} feature${query.data.core ? ", in the proposal's core set" : ""}`}
            action={<span className="font-mono text-[12px] text-ink-3">{query.data.feature}</span>}
          />
          <div className="mt-4 flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Median, theft-labelled" value={num(query.data.summary.theft.median, 2)} tone="risk" />
              <Stat label="Median, honest-labelled" value={num(query.data.summary.honest.median, 2)} />
              <Stat label="Separation" value={num(query.data.fisher_ratio, 4)}
                hint="Fisher ratio: how far apart the classes sit against their own spread" />
              <Stat label="Customers with no value" value={int(query.data.missing_values)} />
            </div>
            <ClassBars
              bins={query.data.honest.map((honest, i) => ({
                low: query.data!.edges[i], high: query.data!.edges[i + 1], honest, theft: query.data!.theft[i],
              }))}
              title={`${query.data.label}, by labelled class`}
              xLabel={query.data.label}
              ariaLabel={`Distribution of ${query.data.label}. The median is ${num(query.data.summary.theft.median, 2)} for theft-labelled customers against ${num(query.data.summary.honest.median, 2)} for honest-labelled ones.`}
              tickLabel={(bin, i) => (i % 6 === 0 ? bin.low.toFixed(1) : null)}
            />
            <SourceNote status={query.data.provenance.status}>{query.data.provenance.computed_from}.</SourceNote>
            <Caveat>{query.data.caveat}</Caveat>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AblationTab() {
  const query = useQuery({ queryKey: ["feat-ablation"], queryFn: getAblation });
  if (query.isLoading) return <Skeleton className="h-[520px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Core features alone" value={num(data.core_only?.pr_auc)}
          hint={`${int(data.core_only?.features)} features`} />
        <Stat label="All features" value={num(data.all_features?.pr_auc)}
          hint={`${int(data.all_features?.features)} features`} />
        <Stat label="The extra features buy"
          value={data.extra_features_buy == null ? "–" : `${data.extra_features_buy >= 0 ? "+" : "−"}${Math.abs(data.extra_features_buy).toFixed(3)}`}
          tone={(data.extra_features_buy ?? 0) >= 0 ? "cobalt" : "risk"}
          hint="precision–recall area, five-fold" />
      </div>

      <Card className="p-5">
        <CardHeader title="One layer at a time"
          subtitle={`Five-fold cross-validation on ${int(data.customers)} development customers. The test customers are not touched.`} />
        <div className="mt-4 flex flex-col gap-5">
          <AblationBars variants={data.variants} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Each ablation variant with its features, treatment and cross-validated scores</caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                  <th className="py-2.5 pr-4 font-medium">Variant</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Features</th>
                  <th className="py-2.5 pr-4 font-medium">Treatment</th>
                  <th className="py-2.5 pr-4 text-right font-medium">PR-AUC</th>
                  <th className="py-2.5 pr-4 text-right font-medium">± sd</th>
                  <th className="py-2.5 text-right font-medium">ROC-AUC</th>
                </tr>
              </thead>
              <tbody>
                {data.variants.map((variant) => (
                  <tr key={variant.name} className="border-b border-line-soft">
                    <td className="py-2.5 pr-4">{variant.name}</td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{int(variant.features)}</td>
                    <td className="py-2.5 pr-4 text-ink-2">{variant.treatment ?? "—"}</td>
                    <td className={cn("py-2.5 pr-4 text-right font-mono tabular",
                      variant.name === data.best?.name && "font-semibold text-ok")}>
                      {num(variant.pr_auc)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-3">{num(variant.pr_auc_sd, 4)}</td>
                    <td className="py-2.5 text-right font-mono tabular text-ink-2">{num(variant.roc_auc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

function HistoryTab() {
  const query = useQuery({ queryKey: ["feat-history"], queryFn: getHistoryLength });
  if (query.isLoading) return <Skeleton className="h-[520px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;
  const shortest = data.windows[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="With the full record" value={num(data.full?.pr_auc)}
          hint={`${int(data.full?.months)} months, ${int(data.full?.features)} features`} />
        <Stat label="With the shortest window" value={num(shortest?.pr_auc)}
          hint={`${int(shortest?.months)} months, ${int(shortest?.features)} features`} tone="risk" />
        <Stat
          label="Within 5% of the full record"
          value={data.within_5_percent ? `${int(data.within_5_percent.months)} months` : "none shorter"}
          hint={data.within_5_percent && data.within_5_percent.months === data.full?.months
            ? "no shorter window comes close; more history kept helping"
            : "the shortest window that gets there"}
        />
      </div>

      <Card className="p-5">
        <CardHeader title="How far back the readings have to go"
          subtitle={`Each window keeps only its trailing months, rebuilds the features and retrains. Scored on ${int(data.test_customers)} test customers.`} />
        <div className="mt-4 flex flex-col gap-5">
          <HistoryCurve windows={data.windows} full={data.full} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Each history window with the features it yields and the scores it reaches</caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                  <th className="py-2.5 pr-4 font-medium">Months kept</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Days</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Features</th>
                  <th className="py-2.5 pr-4 font-medium">From</th>
                  <th className="py-2.5 pr-4 text-right font-medium">PR-AUC</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Recall</th>
                  <th className="py-2.5 text-right font-medium">Precision</th>
                </tr>
              </thead>
              <tbody>
                {data.windows.map((window) => (
                  <tr key={window.months} className="border-b border-line-soft">
                    <td className="py-2.5 pr-4 font-mono tabular">{int(window.months)}</td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{int(window.days)}</td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{int(window.features)}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-ink-3">{window.first_day ?? "–"}</td>
                    <td className={cn("py-2.5 pr-4 text-right font-mono tabular",
                      window.months === data.full?.months && "font-semibold")}>
                      {num(window.pr_auc)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{pct(window.recall)}</td>
                    <td className="py-2.5 text-right font-mono tabular text-ink-2">{pct(window.precision)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

export function FeatureStudioPage() {
  const [tab, setTab] = useState<Tab>("catalog");

  return (
    <>
      <PageHeader
        title="Feature engineering studio"
        description="The gradient-boosted model never sees a daily reading: it sees 87 numbers built from them. This workspace shows what those numbers are, which ones it leans on, and what each layer of the pipeline is actually worth."
      />
      <div className="mt-6 -mx-1 max-w-full overflow-x-auto px-1">
        <Segmented label="Feature view" value={tab} onChange={setTab} options={TABS.map(([value, label]) => ({ value, label }))} />
      </div>
      <div className="mt-5">
        {tab === "catalog" ? <CatalogTab /> : null}
        {tab === "distribution" ? <DistributionTab /> : null}
        {tab === "ablation" ? <AblationTab /> : null}
        {tab === "history" ? <HistoryTab /> : null}
      </div>
    </>
  );
}
