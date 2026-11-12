// Chart colours for GridSentinel X, tuned for the white surfaces in tailwind.config.js.
// Class colours are fixed across the whole console so a reader never has to relearn them:
// honest-labelled is always the steel blue, theft-labelled always the red, missing readings
// always the ochre, and anything simulated always the violet.

export const palette = {
  honest: "#3E86C4", // honest-labelled customers
  theft: "#C73B22", // theft-labelled customers
  missing: "#D08700", // missing readings
  synthetic: "#7C5CD6", // anything simulated or SMOTE-generated
  removed: "#8795A8", // rows removed by ENN
  accent: "#0D5BB9",
  electric: "#1D6FD0",
  ok: "#0F7045",
  ink: "#141B26",
  ink2: "#4D5A6B",
  ink3: "#6B7A8D",
  grid: "#E5EAF1",
  axis: "#C2CCD9",
  surface: "#FFFFFF",
  tint: "#EDF1F6",
} as const;

// One colour per pipeline, in the order the study lists them.
export const pipelineColors: Record<string, string> = {
  proposed: "#B5700A",
  xgboost: "#0D5BB9",
  xgboost_default: "#6B7A8D",
  random_forest_smote: "#0F7045",
  logistic_regression_smote: "#A53A72",
  wide_deep_cnn: "#7C5CD6",
  hybrid: "#C73B22",
  xgboost_smote_enn_raw: "#7E6A12",
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

/**
 * Sequential ramp for heatmaps on a white background: t in [0, 1] -> rgb string.
 * Light to dark, so a higher value is a heavier mark and the page still reads when printed.
 */
export function heat(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const stops = [
    [206, 223, 239],
    [150, 189, 221],
    [84, 143, 197],
    [28, 92, 157],
    [10, 45, 85],
  ];
  const scaled = x * (stops.length - 1);
  const i = Math.min(Math.floor(scaled), stops.length - 2);
  const f = scaled - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
