// Chart colours for GridSentinel X, tuned for the dark surfaces in tailwind.config.js.
// Class colours are fixed across the whole console so a reader never has to relearn them.

export const palette = {
  honest: "#5B9BD5", // honest-labelled customers
  theft: "#F2685C", // theft-labelled customers
  missing: "#F5A524", // missing readings
  synthetic: "#A78BFA", // anything simulated or SMOTE-generated
  removed: "#6F8196", // rows removed by ENN
  accent: "#38BDF8",
  electric: "#3B82F6",
  ok: "#34D399",
  ink: "#E6EDF5",
  ink2: "#A3B2C5",
  ink3: "#7386A0",
  grid: "#1E293A",
  axis: "#2A3648",
  surface: "#0F1624",
  tint: "#172030",
} as const;

// One colour per pipeline, in the order the study lists them.
export const pipelineColors: Record<string, string> = {
  proposed: "#F5A524",
  xgboost: "#38BDF8",
  xgboost_default: "#7386A0",
  random_forest_smote: "#34D399",
  logistic_regression_smote: "#E879A6",
  wide_deep_cnn: "#A78BFA",
  hybrid: "#F2685C",
  xgboost_smote_enn_raw: "#EAB308",
};

export const pipelineLabels: Record<string, string> = {
  proposed: "SMOTE+ENN + XGBoost (proposed)",
  xgboost: "XGBoost, no resampling",
  xgboost_default: "XGBoost, default settings",
  random_forest_smote: "Random forest + SMOTE",
  logistic_regression_smote: "Logistic regression + SMOTE",
  wide_deep_cnn: "Wide & Deep CNN",
  hybrid: "Hybrid: CNN + XGBoost",
  xgboost_smote_enn_raw: "SMOTE+ENN + XGBoost, raw readings",
};

export function pipelineColor(name: string): string {
  return pipelineColors[name] ?? palette.ink3;
}

/** Sequential ramp for heatmaps on a dark background: t in [0, 1] -> rgb string. */
export function heat(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const stops = [
    [11, 17, 29],
    [14, 52, 84],
    [20, 110, 160],
    [56, 189, 248],
    [224, 242, 254],
  ];
  const scaled = x * (stops.length - 1);
  const i = Math.min(Math.floor(scaled), stops.length - 2);
  const f = scaled - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
