import type { CaseStatus } from "@/lib/api";

export const STATUS_META: Record<CaseStatus, { label: string; className: string }> = {
  new: { label: "New", className: "bg-cobalt-bg text-cobalt-ink" },
  reviewing: { label: "Reviewing", className: "bg-amber-bg text-amber-ink" },
  dispatched: { label: "Dispatched", className: "bg-violet-bg text-violet" },
  confirmed: { label: "Confirmed", className: "bg-risk-bg text-risk-text" },
  cleared: { label: "Cleared", className: "bg-tint text-ink-2" },
};
