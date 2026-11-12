// Charts for the class-imbalance laboratory: how many rows each stage of a treatment leaves,
// how the treatments rank under the same cross-validation, and what resampling does to the
// distribution of one feature among theft-labelled rows.
import { Figure } from "@/components/viz/figure";
import { palette } from "@/lib/palette";
import type { TreatmentCounts, TryResult, Variant } from "@/lib/api/imbalance";

const int = (v: number) => v.toLocaleString();

// ---------------------------------------------------------------------------
// Rows at each stage of the treatment
// ---------------------------------------------------------------------------

export function StageCounts({ counts }: { counts: TreatmentCounts }) {
  const realTheftAfter = Math.max(counts.before.theft - counts.theft_removed_by_enn, 0);
  const stages = [
    {
      name: "Training rows",
      parts: [
        { key: "honest", label: "honest-labelled", value: counts.before.honest, color: palette.honest },
        { key: "theft", label: "theft-labelled", value: counts.before.theft, color: palette.theft },
      ],
    },
    {
      name: "After SMOTE",
      parts: [
        { key: "honest", label: "honest-labelled", value: counts.after_smote.honest, color: palette.honest },
        { key: "theft", label: "theft-labelled", value: counts.before.theft, color: palette.theft },
        { key: "synthetic", label: "synthetic", value: counts.synthetic_created, color: palette.synthetic },
      ],
    },
    {
      name: "After ENN",
      parts: [
        { key: "honest", label: "honest-labelled", value: counts.after.honest, color: palette.honest },
        { key: "theft", label: "theft-labelled", value: realTheftAfter, color: palette.theft },
        { key: "synthetic", label: "synthetic", value: Math.max(counts.after.theft - realTheftAfter, 0), color: palette.synthetic },
        { key: "removed", label: "removed by ENN", value: counts.honest_removed_by_enn + counts.theft_removed_by_enn + counts.synthetic_removed_by_enn, color: palette.removed },
      ],
    },
  ];
  const peak = Math.max(...stages.map((s) => s.parts.reduce((t, p) => t + p.value, 0)), 1);

  const W = 760, rowH = 54, L = 130, R = 96, T = 14;
  const H = T + stages.length * rowH + 34;
  const barW = W - L - R;

  return (
    <Figure
      title="Rows at each stage of the treatment"
      legend="blue: honest-labelled · red: real theft-labelled · violet: synthetic rows SMOTE created · grey: rows ENN deleted"
      ariaLabel={`Row counts through the treatment. SMOTE creates ${int(counts.synthetic_created)} synthetic theft rows, then ENN deletes ${int(counts.honest_removed_by_enn)} real honest rows, ${int(counts.theft_removed_by_enn)} real theft rows and ${int(counts.synthetic_removed_by_enn)} synthetic rows.`}
      viewBox={`0 0 ${W} ${H}`}
    >
      {stages.map((stage, i) => {
        const y = T + i * rowH;
        let cursor = L;
        return (
          <g key={stage.name}>
            <text x={L - 12} y={y + 24} textAnchor="end" fontSize="12" fill={palette.ink}>{stage.name}</text>
            {stage.parts.map((part) => {
              const width = (part.value / peak) * barW;
              const x = cursor;
              cursor += width;
              return (
                <g key={part.key}>
                  <rect x={x} y={y + 8} width={Math.max(width, 0)} height={26} fill={part.color} opacity={0.9}>
                    <title>{`${int(part.value)} ${part.label}`}</title>
                  </rect>
                  {width > 54 ? (
                    <text x={x + width / 2} y={y + 25} textAnchor="middle" fontSize="10.5" fill="#FFFFFF" fontFamily="monospace">
                      {int(part.value)}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <text x={Math.min(cursor + 8, W - R + 4)} y={y + 25} fontSize="10.5" fill={palette.ink3} fontFamily="monospace">
              {int(stage.parts.filter((p) => p.key !== "removed").reduce((t, p) => t + p.value, 0))} kept
            </text>
          </g>
        );
      })}
      <line x1={L} x2={L} y1={T} y2={H - 30} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + barW / 2} y={H - 8} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        Training rows (each bar to the same scale)
      </text>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// The sensitivity grid
// ---------------------------------------------------------------------------

export function SensitivityBars({ variants, baseline }: { variants: Variant[]; baseline: Variant | null }) {
  const values = variants.flatMap((v) => [...(v.folds ?? []), v.pr_auc ?? 0]);
  const lo = Math.min(...values) * 0.98;
  const hi = Math.max(...values) * 1.02;
  const span = hi - lo || 1;

  const W = 820, rowH = 28, L = 250, R = 72, T = 26;
  const H = T + variants.length * rowH + 34;
  const plotW = W - L - R;
  const x = (v: number) => L + ((v - lo) / span) * plotW;

  const best = variants[0];
  const proposed = variants.find((v) => v.proposed);

  return (
    <Figure
      title="Precision–recall area by treatment, five-fold cross-validation"
      legend="dot: mean across folds · whisker: ±1 standard deviation · faint dots: the individual folds. The dashed line is no resampling at all."
      minWidth={760}
      ariaLabel={`Thirteen imbalance treatments ranked by cross-validated precision–recall area. The best is ${best?.name ?? "unknown"} at ${best?.pr_auc?.toFixed(3) ?? "unknown"}; the proposal's setting reaches ${proposed?.pr_auc?.toFixed(3) ?? "unknown"} against ${baseline?.pr_auc?.toFixed(3) ?? "unknown"} for no resampling.`}
      viewBox={`0 0 ${W} ${H}`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const value = lo + t * span;
        return (
          <g key={t}>
            <line x1={x(value)} x2={x(value)} y1={T - 8} y2={H - 30} stroke={palette.grid} strokeWidth="1" />
            <text x={x(value)} y={H - 16} textAnchor="middle" fontSize="10" fill={palette.ink3} fontFamily="monospace">
              {value.toFixed(3)}
            </text>
          </g>
        );
      })}
      {baseline?.pr_auc != null ? (
        <line x1={x(baseline.pr_auc)} x2={x(baseline.pr_auc)} y1={T - 8} y2={H - 30}
          stroke={palette.ink3} strokeDasharray="4 3" strokeWidth="1.2" />
      ) : null}
      {variants.map((variant, i) => {
        const y = T + i * rowH + rowH / 2;
        const mean = variant.pr_auc ?? 0;
        const sd = variant.pr_auc_sd ?? 0;
        const colour = variant.proposed ? palette.theft : variant.treatment === "none" ? palette.ink3 : palette.accent;
        return (
          <g key={variant.name}>
            <text x={L - 12} y={y + 4} textAnchor="end" fontSize="11.5"
              fill={variant.proposed ? palette.theft : palette.ink}
              fontWeight={variant.proposed ? 600 : 400}>
              {variant.name.length > 34 ? `${variant.name.slice(0, 33)}…` : variant.name}
            </text>
            {(variant.folds ?? []).map((fold, j) => (
              <circle key={j} cx={x(fold)} cy={y} r="2" fill={colour} opacity={0.3} />
            ))}
            <line x1={x(mean - sd)} x2={x(mean + sd)} y1={y} y2={y} stroke={colour} strokeWidth="1.4" opacity={0.8} />
            <circle cx={x(mean)} cy={y} r="4.5" fill={colour}>
              <title>{`${variant.name}: PR-AUC ${mean.toFixed(4)} ± ${sd.toFixed(4)}`}</title>
            </circle>
            <text x={W - R + 10} y={y + 4} fontSize="11" fill={palette.ink2} fontFamily="monospace">
              {mean.toFixed(3)}
            </text>
          </g>
        );
      })}
      <line x1={L} x2={L} y1={T - 8} y2={H - 30} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + plotW / 2} y={H - 2} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        Precision–recall area under the curve (higher is better)
      </text>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// What resampling did to one feature
// ---------------------------------------------------------------------------

export function FeatureShift({ result }: { result: TryResult }) {
  const { feature } = result;
  if (!feature.edges.length) {
    return <p className="m-0 text-[13px] text-ink-3">This feature has no finite values in the sample.</p>;
  }
  const beforeTotal = Math.max(feature.before.reduce((s, v) => s + v, 0), 1);
  const afterTotal = Math.max(feature.after.reduce((s, v) => s + v, 0), 1);
  const bars = feature.before.map((_, i) => ({
    low: feature.edges[i],
    before: feature.before[i] / beforeTotal,
    after: feature.after[i] / afterTotal,
  }));
  const peak = Math.max(...bars.flatMap((b) => [b.before, b.after]), 1e-9);

  const W = 760, H = 270, L = 54, R = 16, T = 18, B = 54;
  const slot = (W - L - R) / bars.length;
  const y = (v: number) => H - B - (v / peak) * (H - T - B);

  return (
    <Figure
      title={`${feature.label}, among theft-labelled rows`}
      legend={`outline: the ${int(feature.before_rows)} real theft rows · filled: the ${int(feature.after_rows)} theft rows after the treatment, real and synthetic together`}
      ariaLabel={`Distribution of ${feature.label} among theft-labelled rows before and after resampling. The treatment grows the class from ${int(feature.before_rows)} rows to ${int(feature.after_rows)}, and the filled distribution shows where the new rows landed.`}
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
          <rect x={L + i * slot} y={y(bar.after)} width={Math.max(slot - 1.2, 0.8)}
            height={Math.max(H - B - y(bar.after), 0)} fill={palette.theft} opacity={0.55} />
          <rect x={L + i * slot} y={y(bar.before)} width={Math.max(slot - 1.2, 0.8)}
            height={Math.max(H - B - y(bar.before), 0)} fill="none" stroke={palette.ink} strokeWidth="1" />
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const index = Math.round(t * (feature.edges.length - 1));
        return (
          <text key={t} x={L + t * (W - L - R)} y={H - B + 16} textAnchor="middle" fontSize="9.5"
            fill={palette.ink3} fontFamily="monospace">
            {feature.edges[index].toFixed(2)}
          </text>
        );
      })}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + (W - L - R) / 2} y={H - 16} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        {feature.label}
      </text>
      <text x={14} y={T + (H - T - B) / 2} textAnchor="middle" fontSize="11" fill={palette.ink2}
        transform={`rotate(-90 14 ${T + (H - T - B) / 2})`}>
        % of theft-labelled rows
      </text>
    </Figure>
  );
}
