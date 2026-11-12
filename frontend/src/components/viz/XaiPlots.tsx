// Charts for the explainability workspace: SHAP importance, beeswarm, one customer's
// log-odds contributions, and the missing-reading distributions behind the shortcut question.
// Colours come from src/lib/palette.ts so a class means the same thing on every page.
import { Figure } from "@/components/viz/figure";
import { heat, palette } from "@/lib/palette";
import type { BeeswarmFeature, Contribution, FeatureImportance, MissingnessProfile } from "@/lib/api/xai";

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

// ---------------------------------------------------------------------------
// Global importance: mean |SHAP| per feature
// ---------------------------------------------------------------------------

export function ImportanceBars({ features, max }: { features: FeatureImportance[]; max?: number }) {
  const rows = max == null ? features : features.slice(0, max);
  const peak = Math.max(...rows.map((r) => r.mean_abs_shap), 1e-9);
  const missingCount = rows.filter((r) => r.missingness_feature).length;
  const W = 760, rowH = 26, labelW = 250, barW = W - labelW - 70, top = 26;
  const H = top + rows.length * rowH + 30;
  return (
    <Figure
      title="Mean |SHAP| per feature (log-odds of the XGBoost part)"
      ariaLabel={`Feature importance. ${rows[0]?.label ?? "No feature"} moves the score most, at ${rows[0]?.mean_abs_shap.toFixed(3) ?? "0"} log-odds on average. ${missingCount} of the ${rows.length} strongest features describe missing readings rather than consumption.`}
      viewBox={`0 0 ${W} ${H}`}
      legend="amber: a missing-reading feature · blue: a consumption feature"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={labelW + t * barW} x2={labelW + t * barW} y1={top - 6} y2={H - 30} stroke={palette.grid} strokeWidth="1" />
          <text x={labelW + t * barW} y={H - 16} textAnchor="middle" fontSize="10" fill={palette.ink3} fontFamily="monospace">
            {(t * peak).toFixed(2)}
          </text>
        </g>
      ))}
      {rows.map((row, i) => {
        const y = top + i * rowH;
        const width = Math.max((row.mean_abs_shap / peak) * barW, 1);
        return (
          <g key={row.feature}>
            <text x={labelW - 10} y={y + 13} textAnchor="end" fontSize="11.5" fill={row.missingness_feature ? palette.missing : palette.ink}>
              {row.label.length > 38 ? `${row.label.slice(0, 37)}…` : row.label}
            </text>
            <rect x={labelW} y={y + 4} width={width} height={rowH - 11} rx="2"
              fill={row.missingness_feature ? palette.missing : palette.accent} opacity={0.92}>
              <title>{`${row.label}: mean |SHAP| ${row.mean_abs_shap.toFixed(4)} log-odds. ${row.direction}.`}</title>
            </rect>
            <text x={labelW + width + 8} y={y + 13} fontSize="10.5" fill={palette.ink2} fontFamily="monospace">
              {row.mean_abs_shap.toFixed(3)}
            </text>
          </g>
        );
      })}
      <line x1={labelW} x2={labelW} y1={top - 6} y2={H - 30} stroke={palette.axis} strokeWidth="1.5" />
      <text x={labelW + barW / 2} y={H - 2} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        Mean absolute SHAP value (log-odds)
      </text>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// Beeswarm: one dot per customer, per feature
// ---------------------------------------------------------------------------

export function BeeswarmPlot({ features }: { features: BeeswarmFeature[] }) {
  const peak = Math.max(...features.flatMap((f) => f.points.map((p) => Math.abs(p.shap))), 1e-9);
  const W = 760, rowH = 34, labelW = 230, plotW = W - labelW - 24, top = 24;
  const H = top + features.length * rowH + 34;
  const x = (shap: number) => labelW + plotW / 2 + (shap / peak) * (plotW / 2 - 4);
  return (
    <Figure
      title="How each feature pushed the score, customer by customer"
      ariaLabel={`Beeswarm of SHAP values for the ${features.length} strongest features. Dots right of the centre line raised that customer's score, dots left lowered it. Colour runs from low feature value in pale blue to high in deep navy.`}
      viewBox={`0 0 ${W} ${H}`}
      legend="grey dots: the feature had no value for that customer"
    >
      <line x1={labelW + plotW / 2} x2={labelW + plotW / 2} y1={top - 8} y2={H - 34} stroke={palette.axis} strokeWidth="1.5" />
      {features.map((feature, i) => {
        const y0 = top + i * rowH;
        const mid = y0 + (rowH - 8) / 2;
        return (
          <g key={feature.feature}>
            <line x1={labelW} x2={W - 24} y1={y0 - 3} y2={y0 - 3} stroke={palette.grid} strokeWidth="1" />
            <text x={labelW - 10} y={mid + 4} textAnchor="end" fontSize="11.5"
              fill={feature.missingness_feature ? palette.missing : palette.ink}>
              {feature.label.length > 34 ? `${feature.label.slice(0, 33)}…` : feature.label}
            </text>
            {feature.points.map((point, j) => {
              // Deterministic vertical jitter so the plot is stable between renders.
              const jitter = (((j * 2654435761) % 1000) / 1000 - 0.5) * (rowH - 16);
              return (
                <circle key={j} cx={x(point.shap)} cy={mid + jitter} r="1.9"
                  fill={point.normalised_value == null ? palette.ink3 : heat(point.normalised_value)}
                  opacity={point.normalised_value == null ? 0.5 : 0.72} />
              );
            })}
          </g>
        );
      })}
      <text x={labelW + plotW / 2} y={H - 18} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        SHAP value (log-odds) — left lowers the score, right raises it
      </text>
      <text x={labelW} y={H - 4} fontSize="10" fill={palette.ink3} fontFamily="monospace">−{peak.toFixed(2)}</text>
      <text x={W - 24} y={H - 4} textAnchor="end" fontSize="10" fill={palette.ink3} fontFamily="monospace">+{peak.toFixed(2)}</text>
    </Figure>
  );
}

/** The low-to-high colour key the beeswarm uses. */
export function ValueRamp() {
  const stops = Array.from({ length: 24 }, (_, i) => i / 23);
  return (
    <div className="flex items-center gap-2 text-[11px] text-ink-3">
      <span>low feature value</span>
      <span className="flex h-2.5 w-28 overflow-hidden rounded-sm" aria-hidden>
        {stops.map((t) => <span key={t} className="h-full flex-1" style={{ background: heat(t) }} />)}
      </span>
      <span>high</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One customer: the log-odds walk from the average score to this customer's
// ---------------------------------------------------------------------------

export function ContributionSteps({ baseValue, logit, sumOfContributions, contributions }: {
  baseValue: number; logit: number; sumOfContributions: number; contributions: Contribution[];
}) {
  const shown = contributions.reduce((sum, c) => sum + c.shap_value, 0);
  const rest = sumOfContributions - shown;
  const rows: Array<{ key: string; label: string; value: string; shap: number; missing: boolean }> = [
    ...contributions.map((c) => ({
      key: c.feature,
      label: c.label,
      value: c.value == null ? "no value" : c.value.toFixed(3),
      shap: c.shap_value,
      missing: c.missingness_feature,
    })),
    { key: "__rest", label: "every other feature", value: "combined", shap: rest, missing: false },
  ];
  let cursor = baseValue;
  const steps = rows.map((row) => {
    const from = cursor;
    cursor += row.shap;
    return { ...row, from, to: cursor };
  });
  const lo = Math.min(baseValue, ...steps.map((s) => Math.min(s.from, s.to)));
  const hi = Math.max(baseValue, ...steps.map((s) => Math.max(s.from, s.to)));
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(90px,2fr)_60px] items-center gap-x-3 gap-y-2 text-[13px] sm:grid-cols-[minmax(0,230px)_minmax(0,1fr)_64px]">
        <span className="text-ink-2">Average score over the sample</span>
        <span className="relative h-5">
          <span className="absolute top-1/2 h-4 w-[2px] -translate-y-1/2" style={{ left: `${pos(baseValue)}%`, background: palette.ink3 }} />
        </span>
        <span className="text-right font-mono tabular text-ink-2">{baseValue.toFixed(2)}</span>
        {steps.map((step) => {
          const left = Math.min(pos(step.from), pos(step.to));
          const width = Math.max(Math.abs(pos(step.to) - pos(step.from)), 0.6);
          const up = step.shap >= 0;
          return (
            <div key={step.key} className="contents">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium" style={step.missing ? { color: palette.missing } : undefined}>{step.label}</span>
                <span className="text-xs text-ink-3">{step.value}</span>
              </span>
              <span className="relative h-5" title={`${up ? "+" : "−"}${Math.abs(step.shap).toFixed(3)} log-odds`}>
                <span className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-[3px]"
                  style={{ left: `${left}%`, width: `${width}%`, background: up ? palette.theft : palette.honest }} />
              </span>
              <span className={`text-right font-mono tabular ${up ? "text-risk-text" : "text-cobalt-ink"}`}>
                {up ? "+" : "−"}{Math.abs(step.shap).toFixed(2)}
              </span>
            </div>
          );
        })}
        <span className="border-t border-line-soft pt-2.5 font-semibold">This customer's score</span>
        <span className="border-t border-line-soft pt-2.5 text-xs text-ink-3">
          log-odds {baseValue.toFixed(2)} → {logit.toFixed(2)}
        </span>
        <span className="border-t border-line-soft pt-2.5 text-right font-mono font-semibold tabular">{logit.toFixed(2)}</span>
      </div>
      <p className="m-0 text-xs text-ink-3">
        Red bars pushed this customer's score up, blue bars pushed it down. Amber feature names describe missing readings
        rather than consumption. The walk is in log-odds of the XGBoost part, so it does not add up to the hybrid's probability.
      </p>
    </div>
  );
}

/** SHAP against LIME for one customer: the same features on one scale. */
export function WeightBars({ items, tone }: { items: Array<{ feature: string; label: string; weight: number }>; tone: string }) {
  const peak = Math.max(...items.map((i) => Math.abs(i.weight)), 1e-9);
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((item) => {
        const width = (Math.abs(item.weight) / peak) * 50;
        const up = item.weight >= 0;
        return (
          <li key={item.feature} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,120px)_56px] items-center gap-2 text-[12.5px]">
            <span className="truncate text-ink-2" title={item.label}>{item.label}</span>
            <span className="relative h-3.5 rounded-sm bg-tint">
              <span className="absolute top-0 h-full w-px bg-line" style={{ left: "50%" }} aria-hidden />
              <span className="absolute top-0 h-full rounded-[2px]"
                style={{ left: up ? "50%" : `${50 - width}%`, width: `${Math.max(width, 0.8)}%`, background: tone }} />
            </span>
            <span className="text-right font-mono tabular text-ink-3">{up ? "+" : "−"}{Math.abs(item.weight).toFixed(3)}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Missing readings
// ---------------------------------------------------------------------------

export function MissingnessHistogram({ profile }: { profile: MissingnessProfile }) {
  const honestTotal = Math.max(profile.by_class.honest.customers, 1);
  const theftTotal = Math.max(profile.by_class.theft.customers, 1);
  const bars = profile.histogram.map((bin) => ({
    low: bin.low,
    honest: bin.honest / honestTotal,
    theft: bin.theft / theftTotal,
  }));
  const peak = Math.max(...bars.flatMap((b) => [b.honest, b.theft]), 1e-9);
  const W = 760, H = 300, L = 54, R = 16, T = 18, B = 56;
  const x = (i: number) => L + (i / bars.length) * (W - L - R);
  const bw = (W - L - R) / bars.length / 2 - 0.6;
  const y = (v: number) => H - B - (v / peak) * (H - T - B);
  return (
    <Figure
      title="Share of readings missing, by labelled class"
      ariaLabel={`Distribution of missing readings. Theft-labelled customers have a median of ${pct(profile.by_class.theft.median)} of readings missing against ${pct(profile.by_class.honest.median)} for honest-labelled customers. Ranking customers by missingness alone separates the classes with an AUC of ${profile.auc_of_missing_share_alone.toFixed(3)}.`}
      viewBox={`0 0 ${W} ${H}`}
      legend="blue: honest-labelled · red: theft-labelled (each class scaled to its own size)"
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
        <g key={bar.low}>
          <rect x={x(i)} y={y(bar.honest)} width={Math.max(bw, 0.8)} height={Math.max(H - B - y(bar.honest), 0)} fill={palette.honest} opacity={0.85}>
            <title>{`${pct(bar.low, 0)}–${pct(bar.low + 0.04, 0)} missing: ${pct(bar.honest, 2)} of honest-labelled customers`}</title>
          </rect>
          <rect x={x(i) + bw + 1.2} y={y(bar.theft)} width={Math.max(bw, 0.8)} height={Math.max(H - B - y(bar.theft), 0)} fill={palette.theft} opacity={0.85}>
            <title>{`${pct(bar.low, 0)}–${pct(bar.low + 0.04, 0)} missing: ${pct(bar.theft, 2)} of theft-labelled customers`}</title>
          </rect>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <text key={t} x={L + t * (W - L - R)} y={H - B + 16} textAnchor="middle" fontSize="10" fill={palette.ink3} fontFamily="monospace">
          {(t * 100).toFixed(0)}%
        </text>
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + (W - L - R) / 2} y={H - 20} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        Share of that customer's readings that are missing
      </text>
      <text x={14} y={T + (H - T - B) / 2} textAnchor="middle" fontSize="11" fill={palette.ink2}
        transform={`rotate(-90 14 ${T + (H - T - B) / 2})`}>
        % of customers in that class
      </text>
    </Figure>
  );
}

export function MonthlyMissingness({ monthly }: { monthly: MissingnessProfile["monthly"] }) {
  const peak = Math.max(...monthly.flatMap((m) => [m.theft, m.honest]), 1e-9);
  const W = 760, H = 240, L = 54, R = 16, T = 16, B = 52;
  const x = (i: number) => L + (i / Math.max(monthly.length - 1, 1)) * (W - L - R);
  const y = (v: number) => H - B - (v / peak) * (H - T - B);
  const line = (key: "theft" | "honest") =>
    monthly.map((m, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(m[key]).toFixed(1)}`).join(" ");
  const gap = monthly.reduce((worst, m) => (m.theft - m.honest > worst.theft - worst.honest ? m : worst), monthly[0]);
  return (
    <Figure
      title="Readings missing each month, by labelled class"
      ariaLabel={`Monthly share of missing readings. The two classes diverge most in ${gap?.month ?? "the record"}, where ${pct(gap?.theft ?? 0)} of theft-labelled readings are missing against ${pct(gap?.honest ?? 0)} of honest-labelled ones.`}
      viewBox={`0 0 ${W} ${H}`}
      legend="blue: honest-labelled · red: theft-labelled"
    >
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t * peak)} y2={y(t * peak)} stroke={palette.grid} strokeWidth="1" />
          <text x={L - 8} y={y(t * peak) + 3} textAnchor="end" fontSize="10" fill={palette.ink3} fontFamily="monospace">
            {(t * peak * 100).toFixed(0)}
          </text>
        </g>
      ))}
      <path d={line("honest")} fill="none" stroke={palette.honest} strokeWidth="1.8" />
      <path d={line("theft")} fill="none" stroke={palette.theft} strokeWidth="1.8" />
      {monthly.map((m, i) =>
        i % 3 === 0 ? (
          <text key={m.month} x={x(i)} y={H - B + 16} textAnchor="middle" fontSize="9.5" fill={palette.ink3} fontFamily="monospace">
            {m.month.slice(0, 7)}
          </text>
        ) : null,
      )}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + (W - L - R) / 2} y={H - 16} textAnchor="middle" fontSize="11" fill={palette.ink2}>Month of the record</text>
      <text x={14} y={T + (H - T - B) / 2} textAnchor="middle" fontSize="11" fill={palette.ink2}
        transform={`rotate(-90 14 ${T + (H - T - B) / 2})`}>
        % of readings missing
      </text>
    </Figure>
  );
}
