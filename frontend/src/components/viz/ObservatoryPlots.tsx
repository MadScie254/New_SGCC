// Charts for the dataset observatory: how completely the meters reported over the calendar,
// how missing days are arranged, the distribution of the readings themselves, and one
// customer's record as released beside the same series after the study's cleaning step.
import { Figure } from "@/components/viz/figure";
import { palette } from "@/lib/palette";
import type { ClassBin, Consumption, CoverageDay, CustomerRecord } from "@/lib/api/observatory";

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

// ---------------------------------------------------------------------------
// Coverage over the calendar
// ---------------------------------------------------------------------------

export function CoverageChart({ days }: { days: CoverageDay[] }) {
  const peak = Math.max(...days.flatMap((d) => [d.missing_share_theft, d.missing_share_honest]), 0.01);
  const W = 880, H = 300, L = 54, R = 16, T = 18, B = 54;
  const x = (i: number) => L + (i / Math.max(days.length - 1, 1)) * (W - L - R);
  const y = (v: number) => H - B - (v / peak) * (H - T - B);
  const line = (key: "missing_share_theft" | "missing_share_honest") =>
    days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");

  const worst = days.reduce((a, b) => (b.missing_share > a.missing_share ? b : a), days[0]);
  const tickEvery = Math.max(Math.floor(days.length / 8), 1);
  const tickIndexes = days.map((_, i) => i).filter((i) => i % tickEvery === 0 && x(i) <= W - R - 28);

  return (
    <Figure
      title="Share of meters with no reading, day by day"
      legend="blue: honest-labelled · red: theft-labelled"
      minWidth={760}
      ariaLabel={`Daily missing-reading rate across the release. The worst day is ${worst?.date ?? "unknown"}, when ${pct(worst?.missing_share ?? 0)} of meters reported nothing. The theft-labelled line sits above the honest-labelled line for most of the record.`}
      viewBox={`0 0 ${W} ${H}`}
    >
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t * peak)} y2={y(t * peak)} stroke={palette.grid} strokeWidth="1" />
          <text x={L - 8} y={y(t * peak) + 3} textAnchor="end" fontSize="10" fill={palette.ink3} fontFamily="monospace">
            {(t * peak * 100).toFixed(0)}
          </text>
        </g>
      ))}
      <path d={line("missing_share_honest")} fill="none" stroke={palette.honest} strokeWidth="1.2" />
      <path d={line("missing_share_theft")} fill="none" stroke={palette.theft} strokeWidth="1.2" />
      {tickIndexes.map((i) => (
        <text key={days[i].date} x={x(i)} y={H - B + 16} textAnchor="middle" fontSize="9.5"
          fill={palette.ink3} fontFamily="monospace">
          {days[i].date.slice(0, 7)}
        </text>
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + (W - L - R) / 2} y={H - 16} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        Day of the release
      </text>
      <text x={14} y={T + (H - T - B) / 2} textAnchor="middle" fontSize="11" fill={palette.ink2}
        transform={`rotate(-90 14 ${T + (H - T - B) / 2})`}>
        % of meters not reporting
      </text>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// A distribution split by labelled class, each class scaled to its own size
// ---------------------------------------------------------------------------

export function ClassBars({ bins, title, xLabel, ariaLabel, tickLabel }: {
  bins: ClassBin[];
  title: string;
  xLabel: string;
  ariaLabel: string;
  tickLabel: (bin: ClassBin, index: number) => string | null;
}) {
  const honestTotal = Math.max(bins.reduce((s, b) => s + b.honest, 0), 1);
  const theftTotal = Math.max(bins.reduce((s, b) => s + b.theft, 0), 1);
  const bars = bins.map((b) => ({ ...b, honestShare: b.honest / honestTotal, theftShare: b.theft / theftTotal }));
  const peak = Math.max(...bars.flatMap((b) => [b.honestShare, b.theftShare]), 1e-9);

  const W = 760, H = 290, L = 54, R = 16, T = 18, B = 56;
  const slot = (W - L - R) / bars.length;
  const bw = slot / 2 - 0.8;
  const y = (v: number) => H - B - (v / peak) * (H - T - B);

  return (
    <Figure
      title={title}
      legend="blue: honest-labelled · red: theft-labelled (each class scaled to its own size)"
      ariaLabel={ariaLabel}
      viewBox={`0 0 ${W} ${H}`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t * peak)} y2={y(t * peak)} stroke={palette.grid} strokeWidth="1" />
          <text x={L - 8} y={y(t * peak) + 3} textAnchor="end" fontSize="10" fill={palette.ink3} fontFamily="monospace">
            {(t * peak * 100).toFixed(0)}
          </text>
        </g>
      ))}
      {bars.map((bar, i) => (
        <g key={`${bar.low}-${bar.high}`}>
          <rect x={L + i * slot} y={y(bar.honestShare)} width={Math.max(bw, 0.8)}
            height={Math.max(H - B - y(bar.honestShare), 0)} fill={palette.honest} opacity={0.85}>
            <title>{`${bar.honest.toLocaleString()} honest-labelled customers (${pct(bar.honestShare, 2)} of that class)`}</title>
          </rect>
          <rect x={L + i * slot + bw + 1.4} y={y(bar.theftShare)} width={Math.max(bw, 0.8)}
            height={Math.max(H - B - y(bar.theftShare), 0)} fill={palette.theft} opacity={0.85}>
            <title>{`${bar.theft.toLocaleString()} theft-labelled customers (${pct(bar.theftShare, 2)} of that class)`}</title>
          </rect>
          {tickLabel(bar, i) ? (
            <text x={L + i * slot + slot / 2} y={H - B + 16} textAnchor="middle" fontSize="9.5"
              fill={palette.ink3} fontFamily="monospace">
              {tickLabel(bar, i)}
            </text>
          ) : null}
        </g>
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + (W - L - R) / 2} y={H - 18} textAnchor="middle" fontSize="11" fill={palette.ink2}>{xLabel}</text>
      <text x={14} y={T + (H - T - B) / 2} textAnchor="middle" fontSize="11" fill={palette.ink2}
        transform={`rotate(-90 14 ${T + (H - T - B) / 2})`}>
        % of customers in that class
      </text>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// The readings themselves, on a log scale
// ---------------------------------------------------------------------------

export function ReadingHistogram({ histogram, quantiles }: {
  histogram: Consumption["histogram"];
  quantiles: Record<string, number>;
}) {
  const honestTotal = Math.max(histogram.honest.reduce((s, v) => s + v, 0), 1);
  const theftTotal = Math.max(histogram.theft.reduce((s, v) => s + v, 0), 1);
  const bars = histogram.honest.map((_, i) => ({
    low: histogram.edges[i],
    high: histogram.edges[i + 1],
    honest: histogram.honest[i] / honestTotal,
    theft: histogram.theft[i] / theftTotal,
  }));
  const peak = Math.max(...bars.flatMap((b) => [b.honest, b.theft]), 1e-9);

  const W = 760, H = 290, L = 54, R = 16, T = 18, B = 56;
  const slot = (W - L - R) / bars.length;
  const y = (v: number) => H - B - (v / peak) * (H - T - B);
  const median = quantiles["50"];

  // Ticks at the powers of ten the bins span, which is what a log axis is for.
  const lo = Math.log10(histogram.edges[0]);
  const hi = Math.log10(histogram.edges[histogram.edges.length - 1]);
  const decades: number[] = [];
  for (let p = Math.ceil(lo); p <= Math.floor(hi); p += 1) decades.push(p);
  const xOfValue = (v: number) => L + ((Math.log10(v) - lo) / (hi - lo)) * (W - L - R);

  return (
    <Figure
      title="Distribution of daily readings (log scale)"
      legend={`blue: honest-labelled · red: theft-labelled (each class scaled to its own size). The dashed line is the median reading${median == null ? "" : `, ${median.toFixed(2)} kWh`}. Zero readings are counted separately and are not on a log axis.`}
      ariaLabel={`Distribution of daily consumption readings on a log scale. The median reading is ${median == null ? "unknown" : `${median.toFixed(2)} kWh`}. Both labelled classes span several orders of magnitude with broadly the same shape.`}
      viewBox={`0 0 ${W} ${H}`}
    >
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t * peak)} y2={y(t * peak)} stroke={palette.grid} strokeWidth="1" />
          <text x={L - 8} y={y(t * peak) + 3} textAnchor="end" fontSize="10" fill={palette.ink3} fontFamily="monospace">
            {(t * peak * 100).toFixed(0)}
          </text>
        </g>
      ))}
      {bars.map((bar, i) => (
        <g key={bar.low}>
          <rect x={L + i * slot} y={y(bar.honest)} width={Math.max(slot / 2 - 0.6, 0.8)}
            height={Math.max(H - B - y(bar.honest), 0)} fill={palette.honest} opacity={0.85}>
            <title>{`${bar.low.toFixed(2)}–${bar.high.toFixed(2)} kWh: ${pct(bar.honest, 2)} of honest-labelled readings`}</title>
          </rect>
          <rect x={L + i * slot + slot / 2} y={y(bar.theft)} width={Math.max(slot / 2 - 0.6, 0.8)}
            height={Math.max(H - B - y(bar.theft), 0)} fill={palette.theft} opacity={0.85}>
            <title>{`${bar.low.toFixed(2)}–${bar.high.toFixed(2)} kWh: ${pct(bar.theft, 2)} of theft-labelled readings`}</title>
          </rect>
        </g>
      ))}
      {median != null && median > 0 ? (
        <g>
          <line x1={xOfValue(median)} x2={xOfValue(median)} y1={T} y2={H - B} stroke={palette.ink} strokeDasharray="3 3" />
        </g>
      ) : null}
      {decades.map((p) => (
        <text key={p} x={xOfValue(10 ** p)} y={H - B + 16} textAnchor="middle" fontSize="9.5"
          fill={palette.ink3} fontFamily="monospace">
          {10 ** p >= 1 ? (10 ** p).toLocaleString() : (10 ** p).toString()}
        </text>
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + (W - L - R) / 2} y={H - 18} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        Daily reading (kWh, log scale)
      </text>
      <text x={14} y={T + (H - T - B) / 2} textAnchor="middle" fontSize="11" fill={palette.ink2}
        transform={`rotate(-90 14 ${T + (H - T - B) / 2})`}>
        % of readings in that class
      </text>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// One customer's record
// ---------------------------------------------------------------------------

export function RecordChart({ record, showCleaned }: { record: CustomerRecord; showCleaned: boolean }) {
  const { dates, raw, cleaned, stats } = record;
  const values = showCleaned ? cleaned : raw;
  const peak = Math.max(...raw.map((v) => v ?? 0), ...cleaned.map((v) => v ?? 0), 1e-6);

  const W = 880, H = 260, L = 54, R = 16, T = 16, B = 50;
  const x = (i: number) => L + (i / Math.max(dates.length - 1, 1)) * (W - L - R);
  const y = (v: number) => H - B - (v / peak) * (H - T - B);

  // A missing reading breaks the line rather than being drawn through as a zero.
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${current.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  // Shade the stretches where the meter reported nothing.
  const bands: Array<[number, number]> = [];
  let start: number | null = null;
  raw.forEach((v, i) => {
    if (v == null && start == null) start = i;
    if (v != null && start != null) {
      bands.push([start, i]);
      start = null;
    }
  });
  if (start != null) bands.push([start, raw.length]);

  const tickEvery = Math.max(Math.floor(dates.length / 8), 1);
  const tickIndexes = dates.map((_, i) => i).filter((i) => i % tickEvery === 0 && x(i) <= W - R - 28);

  return (
    <Figure
      title={showCleaned ? "Readings after the study's cleaning step" : "Readings as released"}
      legend={showCleaned
        ? "Short gaps are interpolated, extreme readings capped and negatives replaced; the amber bands mark where the released record had no reading at all."
        : "amber bands: days with no reading at all"}
      minWidth={760}
      ariaLabel={`Daily consumption for customer ${record.customer_id}. ${stats.missing_days} of ${stats.days} days have no reading, the longest unbroken gap running ${stats.longest_gap_days} days.`}
      viewBox={`0 0 ${W} ${H}`}
    >
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t * peak)} y2={y(t * peak)} stroke={palette.grid} strokeWidth="1" />
          <text x={L - 8} y={y(t * peak) + 3} textAnchor="end" fontSize="10" fill={palette.ink3} fontFamily="monospace">
            {(t * peak).toFixed(0)}
          </text>
        </g>
      ))}
      {bands.map(([a, b]) => (
        <rect key={a} x={x(a)} y={T} width={Math.max(x(b) - x(a), 1)} height={H - B - T}
          fill={palette.missing} opacity={0.16}>
          <title>{`No reading from ${dates[a]} to ${dates[Math.min(b, dates.length - 1)]}`}</title>
        </rect>
      ))}
      {segments.map((d) => (
        <path key={d.slice(0, 24)} d={d} fill="none" stroke={showCleaned ? palette.accent : palette.ink2} strokeWidth="1.1" />
      ))}
      {tickIndexes.map((i) => (
        <text key={dates[i]} x={x(i)} y={H - B + 16} textAnchor="middle" fontSize="9.5"
          fill={palette.ink3} fontFamily="monospace">
          {dates[i].slice(0, 7)}
        </text>
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + (W - L - R) / 2} y={H - 14} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        Day of the release
      </text>
      <text x={14} y={T + (H - T - B) / 2} textAnchor="middle" fontSize="11" fill={palette.ink2}
        transform={`rotate(-90 14 ${T + (H - T - B) / 2})`}>
        kWh per day
      </text>
    </Figure>
  );
}
