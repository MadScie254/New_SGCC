// Charts for the deep-learning and ensemble workspace: how the network trained, how it varies
// from seed to seed, and what the blend weight is worth.
import { Figure } from "@/components/viz/figure";
import { palette, pipelineColor } from "@/lib/palette";
import type { Epoch, HybridSeedRow, SeedRow, WeightSweep } from "@/lib/api/deeplab";

// ---------------------------------------------------------------------------
// Training history: loss falling while the validation score peaks and turns
// ---------------------------------------------------------------------------

export function TrainingHistory({ history, bestEpoch }: { history: Epoch[]; bestEpoch: number | null }) {
  const W = 760, H = 300, L = 54, R = 56, T = 20, B = 52;
  const lossPeak = Math.max(...history.map((h) => h.train_loss), 1e-6);
  const scorePeak = Math.max(...history.map((h) => h.validation_pr_auc), 1e-6);
  const x = (i: number) => L + (i / Math.max(history.length - 1, 1)) * (W - L - R);
  const yLoss = (v: number) => H - B - (v / lossPeak) * (H - T - B);
  const yScore = (v: number) => H - B - (v / scorePeak) * (H - T - B);

  const best = history.find((h) => h.epoch === bestEpoch);
  const path = (key: "train_loss" | "validation_pr_auc", y: (v: number) => number) =>
    history.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h[key]).toFixed(1)}`).join(" ");

  return (
    <Figure
      title="Training history"
      legend="grey: training loss (left axis) · blue: validation precision–recall area (right axis) · dashed: the epoch whose weights were kept"
      ariaLabel={`Training history over ${history.length} epochs. Validation precision–recall area peaks at ${best?.validation_pr_auc.toFixed(3) ?? "unknown"} on epoch ${bestEpoch ?? "unknown"}, after which training continued without improving and was stopped.`}
      viewBox={`0 0 ${W} ${H}`}
    >
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={yScore(t * scorePeak)} y2={yScore(t * scorePeak)} stroke={palette.grid} strokeWidth="1" />
          <text x={L - 8} y={yLoss(t * lossPeak) + 3} textAnchor="end" fontSize="10" fill={palette.ink3} fontFamily="monospace">
            {(t * lossPeak).toFixed(2)}
          </text>
          <text x={W - R + 8} y={yScore(t * scorePeak) + 3} fontSize="10" fill={palette.accent} fontFamily="monospace">
            {(t * scorePeak).toFixed(2)}
          </text>
        </g>
      ))}
      {bestEpoch != null ? (
        <line x1={x(history.findIndex((h) => h.epoch === bestEpoch))} x2={x(history.findIndex((h) => h.epoch === bestEpoch))}
          y1={T} y2={H - B} stroke={palette.ink} strokeDasharray="4 3" strokeWidth="1.2" />
      ) : null}
      <path d={path("train_loss", yLoss)} fill="none" stroke={palette.ink3} strokeWidth="1.6" />
      <path d={path("validation_pr_auc", yScore)} fill="none" stroke={palette.accent} strokeWidth="2" />
      {best ? (
        <circle cx={x(history.findIndex((h) => h.epoch === bestEpoch))} cy={yScore(best.validation_pr_auc)} r="4.5"
          fill={palette.accent} stroke={palette.surface} strokeWidth="2" />
      ) : null}
      {history.filter((_, i) => i % Math.max(Math.floor(history.length / 8), 1) === 0).map((h) => (
        <text key={h.epoch} x={x(history.indexOf(h))} y={H - B + 16} textAnchor="middle" fontSize="10"
          fill={palette.ink3} fontFamily="monospace">{h.epoch}</text>
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + (W - L - R) / 2} y={H - 14} textAnchor="middle" fontSize="11" fill={palette.ink2}>Epoch</text>
      <text x={14} y={T + (H - T - B) / 2} textAnchor="middle" fontSize="11" fill={palette.ink2}
        transform={`rotate(-90 14 ${T + (H - T - B) / 2})`}>Training loss</text>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// Seed to seed
// ---------------------------------------------------------------------------

export function SeedSpread({ rows, reference, referenceLabel }: {
  rows: Array<{ seed: string; value: number | null }>;
  reference: number | null;
  referenceLabel: string;
}) {
  const values = rows.map((r) => r.value ?? 0);
  const all = reference == null ? values : [...values, reference];
  const lo = Math.min(...all) * 0.98;
  const hi = Math.max(...all) * 1.02;
  const span = hi - lo || 1;

  const W = 760, H = 150, L = 54, R = 16, T = 26, B = 46;
  const x = (v: number) => L + ((v - lo) / span) * (W - L - R);
  const y = H - B - 22;

  return (
    <Figure
      title="Precision–recall area, one point per seed"
      legend={`each dot is one complete retraining · dashed: ${referenceLabel}`}
      ariaLabel={`Per-seed precision–recall area across ${rows.length} retrainings, ranging from ${Math.min(...values).toFixed(3)} to ${Math.max(...values).toFixed(3)}, against ${referenceLabel} at ${reference?.toFixed(3) ?? "unknown"}.`}
      viewBox={`0 0 ${W} ${H}`}
      minWidth={560}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const value = lo + t * span;
        return (
          <g key={t}>
            <line x1={x(value)} x2={x(value)} y1={T} y2={H - B} stroke={palette.grid} strokeWidth="1" />
            <text x={x(value)} y={H - B + 16} textAnchor="middle" fontSize="10" fill={palette.ink3} fontFamily="monospace">
              {value.toFixed(3)}
            </text>
          </g>
        );
      })}
      {reference != null ? (
        <line x1={x(reference)} x2={x(reference)} y1={T} y2={H - B} stroke={palette.ink} strokeDasharray="4 3" strokeWidth="1.3" />
      ) : null}
      {rows.map((row) => (
        row.value == null ? null : (
          <g key={row.seed}>
            <circle cx={x(row.value)} cy={y} r="5" fill={palette.accent} opacity={0.75}>
              <title>{`seed ${row.seed}: ${row.value.toFixed(4)}`}</title>
            </circle>
            <text x={x(row.value)} y={y - 11} textAnchor="middle" fontSize="9" fill={palette.ink3} fontFamily="monospace">
              {row.seed}
            </text>
          </g>
        )
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + (W - L - R) / 2} y={H - 6} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        Precision–recall area on the test customers
      </text>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// The blend weight
// ---------------------------------------------------------------------------

export function WeightSweepChart({ sweep }: { sweep: WeightSweep }) {
  const { points, best, served_weight: served } = sweep;
  const values = points.map((p) => p.pr_auc);
  const lo = Math.min(...values) - (Math.max(...values) - Math.min(...values)) * 0.12;
  const hi = Math.max(...values) + (Math.max(...values) - Math.min(...values)) * 0.12;
  const span = hi - lo || 1;

  const W = 760, H = 300, L = 60, R = 20, T = 22, B = 56;
  const x = (w: number) => L + w * (W - L - R);
  const y = (v: number) => H - B - ((v - lo) / span) * (H - T - B);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.weight).toFixed(1)},${y(p.pr_auc).toFixed(1)}`).join(" ");

  return (
    <Figure
      title="Blend weight against validation precision–recall area"
      legend="weight 0 is the feature model alone, weight 1 is the network alone · dashed: the weight the study chose"
      ariaLabel={`Precision–recall area across the blend weight on validation customers. The peak is ${best.pr_auc.toFixed(4)} at weight ${best.weight}, against ${sweep.features_only.toFixed(4)} for the feature model alone and ${sweep.cnn_only.toFixed(4)} for the network alone.`}
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
      {served != null ? (
        <line x1={x(served)} x2={x(served)} y1={T} y2={H - B} stroke={palette.ink} strokeDasharray="4 3" strokeWidth="1.3" />
      ) : null}
      <path d={path} fill="none" stroke={palette.accent} strokeWidth="2.2" />
      <circle cx={x(best.weight)} cy={y(best.pr_auc)} r="5" fill={palette.theft} stroke={palette.surface} strokeWidth="2">
        <title>{`best: weight ${best.weight}, PR-AUC ${best.pr_auc.toFixed(4)}`}</title>
      </circle>
      {[0, 0.25, 0.5, 0.75, 1].map((w) => (
        <text key={w} x={x(w)} y={H - B + 16} textAnchor="middle" fontSize="10" fill={palette.ink3} fontFamily="monospace">
          {w.toFixed(2)}
        </text>
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + (W - L - R) / 2} y={H - 16} textAnchor="middle" fontSize="11" fill={palette.ink2}>
        Weight given to the network
      </text>
      <text x={16} y={T + (H - T - B) / 2} textAnchor="middle" fontSize="11" fill={palette.ink2}
        transform={`rotate(-90 16 ${T + (H - T - B) / 2})`}>
        Validation PR-AUC
      </text>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// Train against validation
// ---------------------------------------------------------------------------

export function LearningCurveChart({ pipeline, train, validation, bestIteration }: {
  pipeline: string; train: number[]; validation: number[]; bestIteration: number | null;
}) {
  const W = 420, H = 260, L = 48, R = 14, T = 18, B = 48;
  const n = Math.max(train.length, validation.length);
  const lo = Math.min(...train, ...validation) * 0.98;
  const hi = Math.max(...train, ...validation) * 1.02;
  const span = hi - lo || 1;
  const x = (i: number) => L + (i / Math.max(n - 1, 1)) * (W - L - R);
  const y = (v: number) => H - B - ((v - lo) / span) * (H - T - B);
  const path = (series: number[]) => series.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const gap = train.length && validation.length ? train[train.length - 1] - validation[validation.length - 1] : 0;

  return (
    <Figure
      title={pipeline}
      legend="solid: training · dashed: validation"
      minWidth={340}
      ariaLabel={`Learning curve for ${pipeline}. The training score ends ${gap.toFixed(3)} above the validation score, and the best iteration is ${bestIteration ?? "unknown"}.`}
      viewBox={`0 0 ${W} ${H}`}
    >
      {[0, 0.5, 1].map((t) => {
        const value = lo + t * span;
        return (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(value)} y2={y(value)} stroke={palette.grid} strokeWidth="1" />
            <text x={L - 7} y={y(value) + 3} textAnchor="end" fontSize="10" fill={palette.ink3} fontFamily="monospace">
              {value.toFixed(2)}
            </text>
          </g>
        );
      })}
      {bestIteration != null && n > 1 ? (
        <line x1={x(Math.min(bestIteration, n - 1))} x2={x(Math.min(bestIteration, n - 1))} y1={T} y2={H - B}
          stroke={palette.ink} strokeDasharray="3 3" strokeWidth="1.1" />
      ) : null}
      <path d={path(train)} fill="none" stroke={pipelineColor(pipeline)} strokeWidth="2" />
      <path d={path(validation)} fill="none" stroke={pipelineColor(pipeline)} strokeWidth="2" strokeDasharray="5 3" opacity={0.75} />
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <line x1={L} x2={L} y1={T} y2={H - B} stroke={palette.axis} strokeWidth="1.5" />
      <text x={L + (W - L - R) / 2} y={H - 14} textAnchor="middle" fontSize="11" fill={palette.ink2}>Boosting iteration</text>
      <text x={13} y={T + (H - T - B) / 2} textAnchor="middle" fontSize="11" fill={palette.ink2}
        transform={`rotate(-90 13 ${T + (H - T - B) / 2})`}>PR-AUC</text>
    </Figure>
  );
}

export type { HybridSeedRow, SeedRow };
