// Charts for the feature studio: where the served model's attention sits, what each layer of
// the pipeline buys, and how far back the readings have to go.
import { Figure } from "@/components/viz/figure";
import { palette } from "@/lib/palette";
import type { AblationVariant, CatalogFeature, FeatureGroup, HistoryWindow } from "@/lib/api/features";

const GROUP_COLOUR: Record<string, string> = {
  statistical: palette.accent,
  temporal: palette.honest,
  trend: palette.ok,
  anomaly: palette.missing,
};

export const groupColour = (group: string) => GROUP_COLOUR[group] ?? palette.removed;

// ---------------------------------------------------------------------------

export function GroupShare({ groups }: { groups: FeatureGroup[] }) {
  const total = groups.reduce((s, g) => s + g.share, 0) || 1;
  let cursor = 0;
  const W = 760, H = 86, L = 0, R = 0, T = 18;
  const barW = W - L - R;

  return (
    <Figure
      title="Where the model's attention sits, by kind of feature"
      legend={groups.map((g) => `${g.group}: ${(g.share * 100).toFixed(0)}%`).join(" · ")}
      minWidth={420}
      ariaLabel={`Share of the served model's importance by feature group. ${groups[0]?.group ?? "No group"} carries ${((groups[0]?.share ?? 0) * 100).toFixed(0)}% of it across ${groups[0]?.features ?? 0} features.`}
      viewBox={`0 0 ${W} ${H}`}
    >
      {groups.map((group) => {
        const width = (group.share / total) * barW;
        const x = cursor;
        cursor += width;
        return (
          <g key={group.group}>
            <rect x={x} y={T} width={Math.max(width - 1.5, 0)} height={30} fill={groupColour(group.group)} opacity={0.9}>
              <title>{`${group.group}: ${group.features} features, ${(group.share * 100).toFixed(1)}% of the importance`}</title>
            </rect>
            {width > 70 ? (
              <>
                <text x={x + width / 2} y={T + 20} textAnchor="middle" fontSize="11.5" fill="#FFFFFF">{group.group}</text>
                <text x={x + width / 2} y={T + 48} textAnchor="middle" fontSize="10.5" fill={palette.ink3} fontFamily="monospace">
                  {(group.share * 100).toFixed(0)}% · {group.features}
                </text>
              </>
            ) : null}
          </g>
        );
      })}
      <text x={0} y={H - 4} fontSize="10.5" fill={palette.ink3}>
        width is the share of total importance; the number below each band is its feature count
      </text>
    </Figure>
  );
}

// ---------------------------------------------------------------------------

export function FeatureRanking({ features, max = 20 }: { features: CatalogFeature[]; max?: number }) {
  const rows = features.slice(0, max);
  const peak = Math.max(...rows.map((r) => r.share), 1e-9);
  const W = 760, rowH = 24, labelW = 260, right = 64, top = 14;
  const H = top + rows.length * rowH + 30;
  const barW = W - labelW - right;

  return (
    <Figure
      title="The strongest features in the served model"
      legend="colour is the feature's group, as in the band above"
      ariaLabel={`The ${rows.length} features the served model leaned on most. ${rows[0]?.label ?? "None"} carries ${((rows[0]?.share ?? 0) * 100).toFixed(1)}% of the total importance.`}
      viewBox={`0 0 ${W} ${H}`}
    >
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={labelW + t * barW} x2={labelW + t * barW} y1={top - 4} y2={H - 26} stroke={palette.grid} strokeWidth="1" />
          <text x={labelW + t * barW} y={H - 12} textAnchor="middle" fontSize="10" fill={palette.ink3} fontFamily="monospace">
            {(t * peak * 100).toFixed(1)}%
          </text>
        </g>
      ))}
      {rows.map((row, i) => {
        const y = top + i * rowH;
        const width = Math.max((row.share / peak) * barW, 1);
        return (
          <g key={row.feature}>
            <text x={labelW - 10} y={y + 12} textAnchor="end" fontSize="11" fill={palette.ink}>
              {row.label.length > 36 ? `${row.label.slice(0, 35)}…` : row.label}
            </text>
            <rect x={labelW} y={y + 3} width={width} height={rowH - 9} rx="2" fill={groupColour(row.group)} opacity={0.9}>
              <title>{`${row.label} (${row.group}): ${(row.share * 100).toFixed(2)}% of the importance`}</title>
            </rect>
            <text x={labelW + width + 7} y={y + 12} fontSize="10" fill={palette.ink2} fontFamily="monospace">
              {(row.share * 100).toFixed(1)}
            </text>
          </g>
        );
      })}
      <line x1={labelW} x2={labelW} y1={top - 4} y2={H - 26} stroke={palette.axis} strokeWidth="1.5" />
      <text x={labelW + barW / 2} y={H - 1} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        Share of the model's total importance
      </text>
    </Figure>
  );
}

// ---------------------------------------------------------------------------

export function AblationBars({ variants }: { variants: AblationVariant[] }) {
  const values = variants.flatMap((v) => [...(v.folds ?? []), v.pr_auc ?? 0]);
  const lo = Math.min(...values) * 0.985;
  const hi = Math.max(...values) * 1.015;
  const span = hi - lo || 1;

  const W = 820, rowH = 32, L = 290, R = 72, T = 24;
  const H = T + variants.length * rowH + 34;
  const plotW = W - L - R;
  const x = (v: number) => L + ((v - lo) / span) * plotW;
  const best = variants.reduce((a, b) => ((b.pr_auc ?? 0) > (a.pr_auc ?? 0) ? b : a), variants[0]);

  return (
    <Figure
      title="What each layer of the pipeline buys"
      legend="dot: mean across folds · whisker: ±1 standard deviation · faint dots: the individual folds"
      minWidth={760}
      ariaLabel={`Component ablation across ${variants.length} variants. The highest precision–recall area is ${best?.name ?? "unknown"} at ${best?.pr_auc?.toFixed(3) ?? "unknown"}.`}
      viewBox={`0 0 ${W} ${H}`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const value = lo + t * span;
        return (
          <g key={t}>
            <line x1={x(value)} x2={x(value)} y1={T - 8} y2={H - 30} stroke={palette.grid} strokeWidth="1" />
            <text x={x(value)} y={H - 14} textAnchor="middle" fontSize="10" fill={palette.ink3} fontFamily="monospace">
              {value.toFixed(3)}
            </text>
          </g>
        );
      })}
      {variants.map((variant, i) => {
        const y = T + i * rowH + rowH / 2;
        const mean = variant.pr_auc ?? 0;
        const sd = variant.pr_auc_sd ?? 0;
        const isBest = variant.name === best?.name;
        const colour = isBest ? palette.ok : palette.accent;
        return (
          <g key={variant.name}>
            <text x={L - 12} y={y + 4} textAnchor="end" fontSize="11.5" fill={palette.ink}>
              {variant.name.length > 40 ? `${variant.name.slice(0, 39)}…` : variant.name}
            </text>
            {(variant.folds ?? []).map((fold, j) => (
              <circle key={j} cx={x(fold)} cy={y} r="2" fill={colour} opacity={0.3} />
            ))}
            <line x1={x(mean - sd)} x2={x(mean + sd)} y1={y} y2={y} stroke={colour} strokeWidth="1.4" opacity={0.8} />
            <circle cx={x(mean)} cy={y} r="4.5" fill={colour}>
              <title>{`${variant.name}: PR-AUC ${mean.toFixed(4)} ± ${sd.toFixed(4)}${variant.features ? `, ${variant.features} features` : ""}`}</title>
            </circle>
            <text x={W - R + 10} y={y + 4} fontSize="11" fill={palette.ink2} fontFamily="monospace">{mean.toFixed(3)}</text>
          </g>
        );
      })}
      <line x1={L} x2={L} y1={T - 8} y2={H - 30} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + plotW / 2} y={H - 1} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        Precision–recall area, five-fold cross-validation
      </text>
    </Figure>
  );
}

// ---------------------------------------------------------------------------

export function HistoryCurve({ windows, full }: { windows: HistoryWindow[]; full: HistoryWindow | null }) {
  const points = windows.filter((w) => w.months != null && w.pr_auc != null);
  const months = points.map((p) => p.months as number);
  const scores = points.map((p) => p.pr_auc as number);
  const maxMonths = Math.max(...months, 1);
  const lo = Math.min(...scores) * 0.9;
  const hi = Math.max(...scores) * 1.05;
  const span = hi - lo || 1;

  const W = 760, H = 300, L = 58, R = 20, T = 20, B = 56;
  const x = (m: number) => L + (m / maxMonths) * (W - L - R);
  const y = (v: number) => H - B - ((v - lo) / span) * (H - T - B);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.months as number).toFixed(1)},${y(p.pr_auc as number).toFixed(1)}`).join(" ");

  return (
    <Figure
      title="Precision–recall area against how many months of readings the model gets"
      legend="dashed: the score with the full record · each point retrains the model on that window and re-chooses its threshold on validation customers"
      ariaLabel={`Model score against history length. With the full ${full?.months ?? "unknown"} months the score is ${full?.pr_auc?.toFixed(3) ?? "unknown"}, and it falls as the window shortens.`}
      viewBox={`0 0 ${W} ${H}`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const value = lo + t * span;
        return (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(value)} y2={y(value)} stroke={palette.grid} strokeWidth="1" />
            <text x={L - 8} y={y(value) + 3} textAnchor="end" fontSize="10" fill={palette.ink3} fontFamily="monospace">
              {value.toFixed(3)}
            </text>
          </g>
        );
      })}
      {full?.pr_auc != null ? (
        <line x1={L} x2={W - R} y1={y(full.pr_auc)} y2={y(full.pr_auc)} stroke={palette.ink} strokeDasharray="4 3" strokeWidth="1.2" />
      ) : null}
      <path d={path} fill="none" stroke={palette.accent} strokeWidth="2.2" />
      {points.map((p) => (
        <g key={p.months}>
          <circle cx={x(p.months as number)} cy={y(p.pr_auc as number)} r="4.5" fill={palette.accent}
            stroke={palette.surface} strokeWidth="1.5">
            <title>{`${p.months} months (${p.days} days, ${p.features} features): PR-AUC ${(p.pr_auc as number).toFixed(4)}`}</title>
          </circle>
          <text x={x(p.months as number)} y={H - B + 16} textAnchor="middle" fontSize="10"
            fill={palette.ink3} fontFamily="monospace">{p.months}</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + (W - L - R) / 2} y={H - 16} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        Months of readings kept, counting back from the end of the record
      </text>
      <text x={16} y={T + (H - T - B) / 2} textAnchor="middle" fontSize="11" fill={palette.ink2}
        transform={`rotate(-90 16 ${T + (H - T - B) / 2})`}>
        PR-AUC on the test customers
      </text>
    </Figure>
  );
}
