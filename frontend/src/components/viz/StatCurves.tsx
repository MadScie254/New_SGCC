import { useId } from "react";
import { palette, pipelineColor } from "@/lib/palette";
import type { Curve } from "@/lib/api/statistics";

const W = 420;
const H = 300;
const M = { top: 14, right: 14, bottom: 44, left: 52 };

function Frame({ title, xLabel, yLabel, children, ariaLabel }: {
  title: string; xLabel: string; yLabel: string; children: React.ReactNode; ariaLabel: string;
}) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const x = (v: number) => M.left + v * (W - M.left - M.right);
  const y = (v: number) => H - M.bottom - v * (H - M.top - M.bottom);
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="text-[13px] font-medium text-ink">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={M.top} y2={H - M.bottom} stroke={palette.grid} strokeWidth="1" />
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={palette.grid} strokeWidth="1" />
            <text x={x(t)} y={H - M.bottom + 15} textAnchor="middle" fontSize="10" fill={palette.ink3}>{t}</text>
            <text x={M.left - 7} y={y(t) + 3} textAnchor="end" fontSize="10" fill={palette.ink3}>{t}</text>
          </g>
        ))}
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke={palette.axis} strokeWidth="1.5" />
        <line x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} stroke={palette.axis} strokeWidth="1.5" />
        {children}
        <text x={M.left + (W - M.left - M.right) / 2} y={H - 6} textAnchor="middle" fontSize="11" fill={palette.ink2}>{xLabel}</text>
        <text x={12} y={M.top + (H - M.top - M.bottom) / 2} textAnchor="middle" fontSize="11" fill={palette.ink2}
          transform={`rotate(-90 12 ${M.top + (H - M.top - M.bottom) / 2})`}>{yLabel}</text>
      </svg>
    </figure>
  );
}

const path = (xs: number[], ys: number[], x: (v: number) => number, y: (v: number) => number) =>
  xs.map((v, i) => `${i ? "L" : "M"}${x(v).toFixed(2)},${y(ys[i]).toFixed(2)}`).join(" ");

export function RocChart({ curves }: { curves: Curve[] }) {
  const x = (v: number) => M.left + v * (W - M.left - M.right);
  const y = (v: number) => H - M.bottom - v * (H - M.top - M.bottom);
  const best = [...curves].sort((a, b) => b.roc.auc - a.roc.auc)[0];
  return (
    <Frame title="ROC curves" xLabel="False positive rate" yLabel="True positive rate"
      ariaLabel={`ROC curves for ${curves.length} pipelines. Highest area under the curve: ${best?.label} at ${best?.roc.auc.toFixed(3)}.`}>
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke={palette.ink3} strokeWidth="1" strokeDasharray="4 4" />
      {curves.map((c) => (
        <g key={c.pipeline}>
          <path d={path(c.roc.fpr, c.roc.tpr, x, y)} fill="none" stroke={pipelineColor(c.pipeline)} strokeWidth="1.8" />
          <circle cx={x(c.operating_point.false_positive_rate)} cy={y(c.operating_point.recall)} r="3.5"
            fill={palette.surface} stroke={pipelineColor(c.pipeline)} strokeWidth="2" />
        </g>
      ))}
    </Frame>
  );
}

export function PrChart({ curves, baseRate }: { curves: Curve[]; baseRate: number }) {
  const x = (v: number) => M.left + v * (W - M.left - M.right);
  const y = (v: number) => H - M.bottom - v * (H - M.top - M.bottom);
  const best = [...curves].sort((a, b) => b.pr.average_precision - a.pr.average_precision)[0];
  return (
    <Frame title="Precision–recall curves" xLabel="Recall (share of theft-labelled customers found)" yLabel="Precision"
      ariaLabel={`Precision-recall curves for ${curves.length} pipelines. Highest average precision: ${best?.label} at ${best?.pr.average_precision.toFixed(3)}. A model with no skill would sit at ${baseRate.toFixed(3)}.`}>
      <line x1={x(0)} y1={y(baseRate)} x2={x(1)} y2={y(baseRate)} stroke={palette.ink3} strokeWidth="1" strokeDasharray="4 4" />
      <text x={x(1) - 4} y={y(baseRate) - 5} textAnchor="end" fontSize="9" fill={palette.ink3}>no skill ({baseRate.toFixed(3)})</text>
      {curves.map((c) => (
        <g key={c.pipeline}>
          <path d={path(c.pr.recall, c.pr.precision, x, y)} fill="none" stroke={pipelineColor(c.pipeline)} strokeWidth="1.8" />
          <circle cx={x(c.operating_point.recall)} cy={y(c.operating_point.precision)} r="3.5"
            fill={palette.surface} stroke={pipelineColor(c.pipeline)} strokeWidth="2" />
        </g>
      ))}
    </Frame>
  );
}

export function CurveLegend({ curves }: { curves: Curve[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1.5 p-0 text-xs text-ink-2">
      {curves.map((c) => (
        <li key={c.pipeline} className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-5 rounded" style={{ background: pipelineColor(c.pipeline) }} />
          {c.label}
        </li>
      ))}
      <li className="flex items-center gap-2 text-ink-3"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border-2 border-ink-3" /> operating point (threshold chosen on validation)</li>
    </ul>
  );
}

export function ReliabilityChart({ raw, calibrated }: {
  raw: Array<{ mean_predicted: number; observed_rate: number; count: number }>;
  calibrated: Array<{ mean_predicted: number; observed_rate: number; count: number }>;
}) {
  const id = useId();
  const x = (v: number) => M.left + v * (W - M.left - M.right);
  const y = (v: number) => H - M.bottom - v * (H - M.top - M.bottom);
  const line = (rows: typeof raw, color: string) => (
    <g>
      <path d={path(rows.map((r) => r.mean_predicted), rows.map((r) => r.observed_rate), x, y)} fill="none" stroke={color} strokeWidth="1.8" />
      {rows.map((r, i) => <circle key={`${id}-${i}`} cx={x(r.mean_predicted)} cy={y(r.observed_rate)} r={Math.max(2, Math.min(6, Math.sqrt(r.count) / 9))} fill={color} />)}
    </g>
  );
  return (
    <Frame title="Reliability" xLabel="Predicted probability" yLabel="Observed share that were theft-labelled"
      ariaLabel="Reliability diagram. A perfectly calibrated model lies on the diagonal; points are bins and their size shows how many customers fall in each.">
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke={palette.ink3} strokeWidth="1" strokeDasharray="4 4" />
      {line(raw, palette.missing)}
      {line(calibrated, palette.accent)}
    </Frame>
  );
}

/** Differences from a reference pipeline with their confidence intervals. */
export function ForestPlot({ rows, metric, alpha }: {
  rows: Array<{ pipeline: string; label: string; difference: number; ci_low: number; ci_high: number; p: number }>;
  metric: string;
  alpha: number;
}) {
  const height = 34 + rows.length * 30;
  const left = 230;
  const right = 60;
  const span = Math.max(0.02, ...rows.map((r) => Math.max(Math.abs(r.ci_low), Math.abs(r.ci_high)))) * 1.12;
  const x = (v: number) => left + ((v + span) / (2 * span)) * (760 - left - right);
  const ticks = [-span, -span / 2, 0, span / 2, span];
  return (
    <figure className="m-0 flex flex-col gap-2">
      <svg viewBox={`0 0 760 ${height}`} role="img" className="w-full"
        aria-label={`Difference in ${metric} from the reference pipeline for ${rows.length} pipelines, with 95% confidence intervals. ${rows.filter((r) => r.p < alpha).length} are significant after Holm's correction.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={16} y2={height - 18} stroke={t === 0 ? palette.ink3 : palette.grid} strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={x(t)} y={height - 5} textAnchor="middle" fontSize="10" fill={palette.ink3}>{t === 0 ? "0" : t.toFixed(3)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cy = 30 + i * 30;
          const significant = r.p < alpha;
          const color = significant ? (r.difference > 0 ? palette.ok : palette.theft) : palette.ink3;
          return (
            <g key={r.pipeline}>
              <text x={0} y={cy + 4} fontSize="11" fill={palette.ink2}>{r.label.length > 36 ? `${r.label.slice(0, 35)}…` : r.label}</text>
              <line x1={x(r.ci_low)} x2={x(r.ci_high)} y1={cy} y2={cy} stroke={color} strokeWidth="2" />
              <line x1={x(r.ci_low)} x2={x(r.ci_low)} y1={cy - 4} y2={cy + 4} stroke={color} strokeWidth="2" />
              <line x1={x(r.ci_high)} x2={x(r.ci_high)} y1={cy - 4} y2={cy + 4} stroke={color} strokeWidth="2" />
              <circle cx={x(r.difference)} cy={cy} r="4" fill={color} />
              <text x={760 - right + 8} y={cy + 4} fontSize="10" fill={significant ? palette.ink : palette.ink3} fontFamily="monospace">
                {r.p < 0.001 ? "p<.001" : `p=${r.p.toFixed(3)}`}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-xs text-ink-3">
        Difference in {metric} (this pipeline minus the reference), 95% percentile bootstrap interval, Holm-adjusted p.
        An interval that crosses the vertical line is consistent with no difference.
      </figcaption>
    </figure>
  );
}
