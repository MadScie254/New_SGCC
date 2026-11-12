import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, Box, ChartSpline, Compass, FileStack, FileText, FlaskConical, LayoutGrid, Menu, Network, Presentation, Scale, ScanSearch,
  Search, Settings, ShieldCheck, Sigma, SlidersHorizontal, Telescope, Workflow, X,
} from "lucide-react";
import { getModelMetrics, getPipelineRuns } from "@/lib/api";
import { useMe } from "@/lib/me";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/cn";

type NavItem = { to: string; label: string; icon: typeof LayoutGrid; end?: boolean };

// The sixteen sections of GridSentinel X, in three groups. Research pages work on the labelled
// study data and sealed runs; operations pages work on an unlabelled population and never show a label.
const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Research",
    items: [
      { to: "/overview", label: "Research overview", icon: Compass },
      { to: "/observatory", label: "Dataset observatory", icon: Telescope },
      { to: "/features", label: "Feature engineering", icon: Sigma },
      { to: "/imbalance", label: "Class imbalance lab", icon: Scale },
      { to: "/experiments", label: "ML experiment manager", icon: FlaskConical },
      { to: "/deep", label: "Deep learning & ensemble", icon: Network },
      { to: "/statistics", label: "Statistical evaluation", icon: ChartSpline },
      { to: "/xai", label: "Explainable AI center", icon: ScanSearch },
      { to: "/twin", label: "3D digital twin", icon: Box },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/", label: "Operations command center", icon: LayoutGrid, end: true },
      { to: "/cases", label: "Investigation cases", icon: Search },
      { to: "/threshold", label: "Threshold & inspection budget", icon: SlidersHorizontal },
      { to: "/pipeline", label: "Scoring pipeline", icon: Workflow },
    ],
  },
  {
    title: "Record",
    items: [
      { to: "/defense", label: "Thesis defense mode", icon: Presentation },
      { to: "/research-reports", label: "Research reports", icon: FileText },
      { to: "/registry", label: "Model registry & provenance", icon: ShieldCheck },
      { to: "/reports", label: "Operations reports & scoring", icon: FileStack },
    ],
  },
];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#E6EDF5" strokeWidth="1.6" aria-hidden>
        <path d="M14 2 L25 8 V20 L14 26 L3 20 V8 Z" />
        <path d="M15.5 7 L10 15 H14 L12.5 21 L18 13 H14 Z" fill="#38BDF8" stroke="none" />
      </svg>
      <div className="flex flex-col">
        <span className="font-display text-lg font-semibold text-ink">GridSentinel <span className="text-cobalt">X</span></span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-rail-muted">Research &amp; investigation</span>
      </div>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const metrics = useQuery({ queryKey: ["model-metrics"], queryFn: getModelMetrics });
  const runs = useQuery({ queryKey: ["pipeline-runs"], queryFn: () => getPipelineRuns(1), refetchInterval: 30_000 });
  const me = useMe();
  const lastRun = runs.data?.[0];

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-6">
      <Logo />
      <nav aria-label="Primary" className="flex flex-col gap-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-0.5">
            <span className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-rail-muted">{group.title}</span>
            {group.items.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} onClick={onNavigate}
                className={({ isActive }) => cn("flex items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-[13px] transition-colors",
                  isActive ? "border-cobalt bg-rail-2 font-medium text-ink shadow-card" : "border-transparent text-rail-text hover:bg-rail-2/70 hover:text-ink")}>
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden />
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-3">
        <div className="flex flex-col gap-2 rounded-lg border border-rail-line px-3 py-3.5">
          <span className="text-[11px] uppercase tracking-[0.08em] text-rail-muted">Model in service</span>
          <span className="font-mono text-[13px] text-ink">{metrics.data?.pipeline ?? "…"} v{metrics.data?.model_version ?? "…"}</span>
          <span className="text-xs text-rail-muted">
            τ {metrics.data ? metrics.data.threshold.toFixed(3) : "…"} · {metrics.data ? metrics.data.customers_monitored.toLocaleString() : "…"} customers
          </span>
          <span className="flex items-center gap-2 text-xs text-rail-muted">
            <Activity className={cn("h-3.5 w-3.5", lastRun?.status === "succeeded" ? "text-ok" : "text-amber")} aria-hidden />
            {lastRun ? `Scored ${fmtRelative(lastRun.finished_at)}` : "No scoring run yet"}
          </span>
        </div>
        <NavLink to="/admin" onClick={onNavigate}
          className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm", isActive ? "bg-rail-2 text-ink shadow-card" : "text-rail-text hover:text-ink")}>
          <Settings className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden />
          <span className="flex flex-col">
            System administration
            {me.data ? <span className="text-[11px] text-rail-muted">{me.data.name} · {me.data.role}</span> : null}
          </span>
        </NavLink>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const drawer = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  // Modal drawer: focus moves in when it opens, Tab stays inside, Escape closes, focus returns to the menu button.
  useEffect(() => {
    if (!open) return;
    const returnTo = opener.current;
    drawer.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => returnTo?.focus();
  }, [open]);

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab" || !drawer.current) return;
    const items = Array.from(drawer.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="flex min-h-screen bg-ground text-ink">
      <div className="hidden w-[264px] shrink-0 border-r border-rail-line bg-rail lg:block">
        <aside className="sticky top-0 h-screen">
          <SidebarContent />
        </aside>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation" onKeyDown={trapFocus}>
          <div aria-hidden className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside ref={drawer} className="relative h-full w-[280px] overflow-y-auto bg-rail">
            <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center text-rail-text">
              <X className="h-5 w-5" aria-hidden />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 lg:hidden">
          <button ref={opener} type="button" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-ink">
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <span className="font-display text-lg font-semibold">GridSentinel X</span>
        </div>
        <main key={location.pathname} className="flex w-full max-w-[1560px] animate-fade-up flex-col gap-6 px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
