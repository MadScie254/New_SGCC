import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, Card, CardHeader, Empty, PageHeader, Pill, Segmented, Skeleton, Stat } from "@/components/ui";
import { Caveat, SourceNote } from "@/components/evidence";
import { ClassBars, CoverageChart, ReadingHistogram, RecordChart } from "@/components/viz/ObservatoryPlots";
import {
  getCleaning, getConsumption, getCoverage, getCustomerRecord, getGaps, getObservatoryCustomers, getRelease,
} from "@/lib/api/observatory";
import { palette } from "@/lib/palette";
import { cn } from "@/lib/cn";

const TABS = [
  ["release", "The release"],
  ["coverage", "Coverage"],
  ["gaps", "Gaps"],
  ["readings", "Readings"],
  ["customer", "One customer"],
] as const;
type Tab = (typeof TABS)[number][0];

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const pct = (v: number | null | undefined, digits = 1) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);
const num = (v: number | null | undefined, digits = 2) => (v == null ? "–" : v.toFixed(digits));
const int = (v: number | null | undefined) => (v == null ? "–" : v.toLocaleString());

function LabelTag({ label }: { label: number }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
      label === 1 ? "border-risk/40 bg-risk-bg text-risk-text" : "border-line bg-tint text-ink-2")}>
      {label === 1 ? "theft-labelled" : "honest-labelled"}
    </span>
  );
}

// ---------------------------------------------------------------------------

function ReleaseTab() {
  const query = useQuery({ queryKey: ["obs-release"], queryFn: getRelease });
  if (query.isLoading) return <Skeleton className="h-[600px] w-full" />;
  if (query.isError) return <ApiError error={query.error} title="Could not read the release" />;
  const { identity, completeness, classes, splits, checks, provenance, reading } = query.data!;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Customers" value={int(identity.customers)} hint={`${int(classes.theft)} theft-labelled`} />
        <Stat label="Days in the record" value={int(identity.days)}
          hint={`over ${int(identity.calendar_days_in_range)} calendar days`} />
        <Stat label="Readings missing" value={pct(completeness.missing_share)} tone="risk"
          hint={`${int(completeness.missing_cells)} of ${int(identity.cells)} customer-days`} />
        <Stat label="Imbalance" value={`${num(classes.imbalance_ratio, 1)}:1`}
          hint={`${pct(classes.theft_rate, 2)} of customers are theft-labelled`} />
      </div>

      <Card className="p-5">
        <CardHeader title="The proposal's claims, set beside the file"
          subtitle="Each figure on the left is what the written proposal states. Each figure on the right is counted here, now, from the file on this machine." />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
            <caption className="sr-only">The proposal's stated figures for the release against the measured values</caption>
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                <th className="py-2.5 pr-4 font-medium">Item</th>
                <th className="py-2.5 pr-4 text-right font-medium">Proposal states</th>
                <th className="py-2.5 pr-4 text-right font-medium">Measured here</th>
                <th className="py-2.5 pr-4 font-medium">Agrees</th>
                <th className="py-2.5 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((check) => (
                <tr key={check.item} className="border-b border-line-soft align-top">
                  <td className="py-2.5 pr-4 font-medium">{check.item}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular text-ink-2">{check.proposal}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular">{check.actual}</td>
                  <td className={cn("py-2.5 pr-4 font-medium", check.agrees ? "text-ok" : "text-risk-text")}>
                    {check.agrees ? "yes" : "no"}
                  </td>
                  <td className="py-2.5 text-xs leading-relaxed text-ink-3">{check.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {identity.absent_dates.length ? (
          <p className="m-0 mt-4 text-[13px] leading-relaxed text-ink-2">
            {identity.absent_dates.length === 1 ? "One date falls" : `${int(identity.absent_dates.length)} dates fall`} inside the
            range the release spans but has no column at all:{" "}
            <span className="font-mono text-ink">{identity.absent_dates.slice(0, 8).join(", ")}</span>
            {identity.absent_dates.length > 8 ? ` and ${int(identity.absent_dates.length - 8)} more` : ""}. A model reading a
            fixed-length window sees these as days that never existed, not as days with no reading.
          </p>
        ) : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="Completeness" subtitle="How much of the record is there, and for whom." />
          <dl className="m-0 mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2.5 text-[13px]">
            {([
              ["Customers with a complete record", int(completeness.customers_complete)],
              ["Customers with no reading at all", int(completeness.customers_without_any_reading)],
              ["Customers over 10% missing", int(completeness.customers_over_10pct_missing)],
              ["…of which theft-labelled", int(completeness.theft_customers_over_10pct_missing)],
              ["Missing, honest-labelled", pct(completeness.missing_share_honest)],
              ["Missing, theft-labelled", pct(completeness.missing_share_theft)],
            ] as const).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-2">{label}</dt>
                <dd className="m-0 text-right font-mono tabular">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4"><Caveat title="The proposal's exclusion rule was not applied">
            Dropping every customer over 10% missing would remove {int(completeness.theft_customers_over_10pct_missing)} of
            the {int(classes.theft)} theft-labelled customers — most of the signal the study is trying to detect. The rule is
            recorded and not used.
          </Caveat></div>
        </Card>

        <Card className="p-5">
          <CardHeader title="The study's split" subtitle="Stratified by label, seed 42, fixed for every workspace." />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <caption className="sr-only">Customers and theft rate in each split of the study</caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                  <th className="py-2 pr-4 font-medium">Split</th>
                  <th className="py-2 pr-4 text-right font-medium">Customers</th>
                  <th className="py-2 pr-4 text-right font-medium">Theft-labelled</th>
                  <th className="py-2 text-right font-medium">Theft rate</th>
                </tr>
              </thead>
              <tbody>
                {splits.map((split) => (
                  <tr key={split.split} className="border-b border-line-soft">
                    <td className="py-2 pr-4 capitalize">{split.split}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular">{int(split.customers)}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular">{int(split.theft)}</td>
                    <td className="py-2 text-right font-mono tabular text-ink-2">{pct(split.theft_rate, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 mt-4 text-xs leading-relaxed text-ink-3">
            File <span className="font-mono">{identity.file}</span>, sha256{" "}
            <span className="font-mono">{identity.sha256.slice(0, 16)}…</span>{" "}
            {identity.registered_release ? "— this is the registered SGCC release." : "— this file is not the registered SGCC release."}
          </p>
        </Card>
      </div>

      <p className="m-0 text-[13px] leading-relaxed text-ink-2">{reading}</p>
      <SourceNote status={provenance.status}>{provenance.computed_from}.</SourceNote>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CoverageTab() {
  const query = useQuery({ queryKey: ["obs-coverage"], queryFn: getCoverage });
  if (query.isLoading) return <Skeleton className="h-[520px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <CardHeader title="Who was reporting, and when"
          subtitle="A day where many meters report nothing is a collection event, not a change in consumption." />
        <div className="mt-4 flex flex-col gap-5">
          <CoverageChart days={data.days} />
          <p className="m-0 text-[13px] leading-relaxed text-ink-2">{data.reading}</p>
          <SourceNote status={data.provenance.status}>{data.provenance.computed_from}.</SourceNote>
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="The ten worst days" subtitle="Ranked by the share of meters that reported nothing." />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
            <caption className="sr-only">The ten days of the release with the most meters not reporting</caption>
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 text-right font-medium">Not reporting</th>
                <th className="py-2 pr-4 text-right font-medium">Theft-labelled</th>
                <th className="py-2 pr-4 text-right font-medium">Honest-labelled</th>
                <th className="py-2 text-right font-medium">Meters reporting</th>
              </tr>
            </thead>
            <tbody>
              {data.worst_days.map((day) => (
                <tr key={day.date} className="border-b border-line-soft">
                  <td className="py-2 pr-4 font-mono">{day.date}</td>
                  <td className="py-2 pr-4 text-right font-mono tabular text-risk-text">{pct(day.missing_share)}</td>
                  <td className="py-2 pr-4 text-right font-mono tabular text-ink-2">{pct(day.missing_share_theft)}</td>
                  <td className="py-2 pr-4 text-right font-mono tabular text-ink-2">{pct(day.missing_share_honest)}</td>
                  <td className="py-2 text-right font-mono tabular text-ink-2">{int(day.meters_reporting)}</td>
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

function GapsTab() {
  const query = useQuery({ queryKey: ["obs-gaps"], queryFn: getGaps });
  if (query.isLoading) return <Skeleton className="h-[560px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Median missing, theft-labelled" value={pct(data.missing_share.theft.median)} tone="risk" />
        <Stat label="Median missing, honest-labelled" value={pct(data.missing_share.honest.median)} />
        <Stat label="Longest gap, theft-labelled" value={`${int(data.longest_gap_days.theft.median)} d`}
          hint={`median; longest in the class is ${int(data.longest_gap_days.theft.max)} days`} />
        <Stat label="Longest gap, honest-labelled" value={`${int(data.longest_gap_days.honest.median)} d`}
          hint={`median; longest in the class is ${int(data.longest_gap_days.honest.max)} days`} />
      </div>

      <Card className="p-5">
        <CardHeader title="How much of a record is missing"
          subtitle="Each class is scaled to its own size, so the rarer class stays visible." />
        <div className="mt-4">
          <ClassBars
            bins={data.missing_share_histogram}
            title="Share of a customer's readings that are missing"
            xLabel="Share of that customer's readings that are missing"
            ariaLabel={`Distribution of per-customer missingness. Theft-labelled customers have a median of ${pct(data.missing_share.theft.median)} of readings missing against ${pct(data.missing_share.honest.median)} for honest-labelled customers.`}
            tickLabel={(bin, i) => (i % 6 === 0 ? `${Math.round(bin.low * 100)}%` : null)}
          />
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="How those missing days are arranged"
          subtitle="The longest unbroken run of days with no reading, for each customer." />
        <div className="mt-4 flex flex-col gap-4">
          <ClassBars
            bins={data.longest_gap_histogram}
            title="Longest unbroken gap in a customer's record"
            xLabel="Longest run of consecutive days with no reading"
            ariaLabel={`Distribution of the longest unbroken gap per customer. The median theft-labelled customer's longest gap runs ${int(data.longest_gap_days.theft.median)} days against ${int(data.longest_gap_days.honest.median)} days for honest-labelled customers.`}
            tickLabel={(bin) => (bin.high - bin.low > 1 ? `${bin.low}+` : `${bin.low}`)}
          />
          <p className="m-0 text-[13px] leading-relaxed text-ink-2">{data.reading}</p>
          <SourceNote status={data.provenance.status}>{data.provenance.computed_from}.</SourceNote>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ReadingsTab() {
  const query = useQuery({ queryKey: ["obs-consumption"], queryFn: getConsumption });
  if (query.isLoading) return <Skeleton className="h-[560px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;
  const { totals } = data;
  const peakWeekday = data.weekday.reduce((a, b) => (b.mean_kwh > a.mean_kwh ? b : a), data.weekday[0]);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Readings in the release" value={int(totals.readings)} />
        <Stat label="Median reading" value={`${num(data.quantiles["50"])} kWh`}
          hint={`mean ${num(totals.mean_reading)} kWh, peak ${int(Math.round(totals.max_reading))} kWh`} />
        <Stat label="Zero readings" value={int(totals.zero_readings)}
          hint="a meter reporting nothing used, which is not a meter that did not report" />
        <Stat label="Above the cap" value={int(totals.above_cap)} tone={totals.above_cap > 0 ? "risk" : "ink"}
          hint={`readings over ${int(totals.cap_kwh)} kWh; cleaning caps these`} />
      </div>

      <Card className="p-5">
        <CardHeader title="What a day's consumption looks like"
          subtitle="Daily readings span several orders of magnitude, so the scale is logarithmic." />
        <div className="mt-4 flex flex-col gap-4">
          <ReadingHistogram histogram={data.histogram} quantiles={data.quantiles} />
          <p className="m-0 text-[13px] leading-relaxed text-ink-2">{data.reading}</p>
          <SourceNote status={data.provenance.status}>{data.provenance.computed_from}.</SourceNote>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="Impossible and extreme readings" subtitle="What the cleaning step has to deal with." />
          <dl className="m-0 mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2.5 text-[13px]">
            {([
              ["Negative readings", int(totals.negative_readings)],
              [`Readings above ${int(totals.cap_kwh)} kWh`, int(totals.above_cap)],
              ["Highest reading", `${int(Math.round(totals.max_reading))} kWh`],
              [`Customers with a zero run over ${totals.zero_run_days} days`, int(totals.customers_with_long_zero_runs)],
            ] as const).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-2">{label}</dt>
                <dd className="m-0 text-right font-mono tabular">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <caption className="sr-only">Percentiles of every reading in the release</caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-[0.06em] text-ink-3">
                  <th className="py-2 pr-4 font-medium">Percentile</th>
                  {Object.keys(data.quantiles).map((p) => <th key={p} className="py-2 pr-3 text-right font-medium">p{p}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-2 pr-4 text-ink-2">kWh</td>
                  {Object.entries(data.quantiles).map(([p, v]) => (
                    <td key={p} className="py-2 pr-3 text-right font-mono tabular">{num(v)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader title="The shape of the week" subtitle="Mean consumption across all meters, by day of the week." />
          <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
            {data.weekday.map((day) => (
              <li key={day.weekday} className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-[13px]">
                <span className="text-ink-2">{WEEKDAYS[day.weekday] ?? day.weekday}</span>
                <span className="relative h-3.5 rounded-sm bg-tint">
                  <span className="absolute left-0 top-0 h-full rounded-sm"
                    style={{ width: `${(day.mean_kwh / Math.max(peakWeekday?.mean_kwh ?? 1, 1e-6)) * 100}%`, background: palette.accent }} />
                </span>
                <span className="text-right font-mono tabular">{num(day.mean_kwh)}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-4 text-xs leading-relaxed text-ink-3">
            Mean kWh per meter per day. A flat week is what domestic metering usually looks like; a strong weekday peak
            would suggest the population is not purely residential.
          </p>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CustomerTab() {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState<"all" | "theft" | "honest">("all");
  const [view, setView] = useState<"released" | "cleaned">("released");

  const list = useQuery({
    queryKey: ["obs-customers", query, label],
    queryFn: () => getObservatoryCustomers({ query, label: label === "all" ? undefined : label === "theft" ? 1 : 0, limit: 40 }),
  });
  const record = useQuery({
    queryKey: ["obs-customer", customerId],
    queryFn: () => getCustomerRecord({ customer_id: customerId! }),
    enabled: !!customerId,
  });
  const cleaning = useQuery({ queryKey: ["obs-cleaning"], queryFn: getCleaning });

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <CardHeader title="Choose a customer"
          subtitle="Customers of the labelled release. The operations pages work on an unlabelled population and never show a label." />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            Customer id starts with
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. 10"
              className="h-9 w-36 rounded-lg border border-line bg-surface-alt px-2.5 font-mono text-[13px] text-ink placeholder:text-ink-3" />
          </label>
          <Segmented label="Labelled class" value={label} onChange={setLabel}
            options={[{ value: "all", label: "All" }, { value: "theft", label: "Theft-labelled" }, { value: "honest", label: "Honest-labelled" }]} />
        </div>
        <div className="mt-4">
          {list.isLoading ? <Skeleton className="h-24 w-full" />
            : list.isError ? <ApiError error={list.error} />
            : list.data!.customers.length === 0 ? <Empty title="No customer matches" message="Try a shorter id prefix." />
            : (
              <>
                <div className="flex flex-wrap gap-2">
                  {list.data!.customers.map((customer) => (
                    <Pill key={customer.customer_id} active={customer.customer_id === customerId}
                      onClick={() => setCustomerId(customer.customer_id)}>
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="h-2 w-2 rounded-full"
                          style={{ background: customer.label === 1 ? palette.theft : palette.honest }} />
                        <span className="font-mono">{customer.customer_id}</span>
                        <span className="opacity-70">{pct(customer.missing_share, 0)} missing</span>
                      </span>
                    </Pill>
                  ))}
                </div>
                <p className="m-0 mt-3 text-xs text-ink-3">
                  Showing {list.data!.customers.length} of {int(list.data!.total_matching)} matching customers. {list.data!.note}
                </p>
              </>
            )}
        </div>
      </Card>

      {!customerId ? (
        <Empty title="No customer chosen" message="Pick one above to see its record as released." />
      ) : record.isLoading ? (
        <Skeleton className="h-[420px] w-full" />
      ) : record.isError ? (
        <ApiError error={record.error} title="Could not read this customer's record" />
      ) : (
        <Card className="p-5">
          <CardHeader
            title={<span className="font-mono">{record.data!.customer_id}</span>}
            subtitle={`A ${record.data!.split} customer of the study split.`}
            action={<LabelTag label={record.data!.label} />}
          />
          <div className="mt-4 flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Days with no reading" value={int(record.data!.stats.missing_days)}
                hint={`of ${int(record.data!.stats.days)} days`} />
              <Stat label="Longest unbroken gap" value={`${int(record.data!.stats.longest_gap_days)} d`} />
              <Stat label="Mean consumption" value={`${num(record.data!.stats.mean_kwh)}`} hint="kWh per reported day" />
              <Stat label="Days reading zero" value={int(record.data!.stats.zero_days)} />
            </div>
            <Segmented label="Series" value={view} onChange={setView}
              options={[{ value: "released", label: "As released" }, { value: "cleaned", label: "After cleaning" }]} />
            <RecordChart record={record.data!} showCleaned={view === "cleaned"} />
            <SourceNote status={record.data!.provenance.status}>{record.data!.provenance.computed_from}.</SourceNote>
            <Caveat>{record.data!.caveat}</Caveat>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <CardHeader title="What cleaning changes" subtitle="The study's section 3.7 step, counted over the whole release." />
        <div className="mt-4">
          {cleaning.isLoading ? <Skeleton className="h-40 w-full" />
            : cleaning.isError ? <ApiError error={cleaning.error} />
            : (
              <div className="flex flex-col gap-4">
                <div className="grid gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-2">
                  {Object.entries(cleaning.data!.log).map(([key, value]) => (
                    <div key={key} className="flex items-baseline justify-between gap-3 border-b border-line-soft pb-1.5">
                      <span className="text-ink-2">{key.replace(/_/g, " ")}</span>
                      <span className="font-mono tabular">{int(value)}</span>
                    </div>
                  ))}
                </div>
                <p className="m-0 text-[13px] leading-relaxed text-ink-2">{cleaning.data!.reading}</p>
                <SourceNote status={cleaning.data!.provenance.status}>{cleaning.data!.provenance.computed_from}.</SourceNote>
              </div>
            )}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DatasetObservatoryPage() {
  const [tab, setTab] = useState<Tab>("release");

  return (
    <>
      <PageHeader
        title="Dataset observatory"
        description="What the labelled SGCC release contains, measured rather than claimed — because several of the study's findings only mean something once you know how incomplete the record is."
      />
      <div className="mt-6 -mx-1 max-w-full overflow-x-auto px-1">
        <Segmented label="Dataset view" value={tab} onChange={setTab} options={TABS.map(([value, label]) => ({ value, label }))} />
      </div>
      <div className="mt-5">
        {tab === "release" ? <ReleaseTab /> : null}
        {tab === "coverage" ? <CoverageTab /> : null}
        {tab === "gaps" ? <GapsTab /> : null}
        {tab === "readings" ? <ReadingsTab /> : null}
        {tab === "customer" ? <CustomerTab /> : null}
      </div>
    </>
  );
}
