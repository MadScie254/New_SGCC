import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, Button, Card, CardHeader, Empty, PageHeader, Segmented, Skeleton, Stat } from "@/components/ui";
import { SourceNote } from "@/components/evidence";
import {
  downloadFigure, downloadTable, fetchFigure, getFigures, getReproductionReport, getTables,
} from "@/lib/api/exports";
import type { FigureEntry } from "@/lib/api/exports";
import { cn } from "@/lib/cn";

const TABS = [
  ["figures", "Figures"],
  ["tables", "Tables"],
  ["report", "Reproduction report"],
] as const;
type Tab = (typeof TABS)[number][0];

const kb = (bytes: number | undefined) => (bytes == null ? "–" : `${Math.round(bytes / 1024).toLocaleString()} kB`);

/** Shows a figure inline, fetched through the client so the API key header is sent. */
function FigurePreview({ figure }: { figure: FigureEntry }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    let created: string | null = null;
    setUrl(null);
    setFailed(false);
    void fetchFigure(figure.name, "png")
      .then((blob) => {
        if (!live) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [figure.name]);

  if (failed) return <Empty title="Could not load this figure" message="Its file may be missing from the figure set." />;
  if (!url) return <Skeleton className="h-80 w-full" />;
  return (
    <img src={url} alt={figure.caption || `Figure ${figure.number}`}
      className="w-full rounded-lg border border-line bg-surface" />
  );
}

// ---------------------------------------------------------------------------

function FiguresTab() {
  const query = useQuery({ queryKey: ["exports-figures"], queryFn: getFigures });
  const [chapter, setChapter] = useState<string>("");
  const [selected, setSelected] = useState<string>("");

  const chosenChapter = chapter || query.data?.chapters[0]?.chapter || "";
  const shown = useMemo(
    () => (query.data?.figures ?? []).filter((f) => f.chapter === chosenChapter),
    [query.data, chosenChapter],
  );
  const figure = shown.find((f) => f.name === selected) ?? shown[0];

  if (query.isLoading) return <Skeleton className="h-[560px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Figures in the set" value={data.total.toLocaleString()} />
        <Stat label="Chapters" value={data.chapters.length.toLocaleString()}
          hint={data.chapters.map((c) => `${c.figures}`).join(" · ")} />
        <Stat label="Formats" value={<span className="font-sans text-[20px]">PNG and PDF</span>}
          hint="300 dpi raster and vector; use the PDF in LaTeX" />
      </div>

      <Card className="p-5">
        <CardHeader title="The thesis figure set" subtitle={data.reading}
          action={
            <select value={chosenChapter} onChange={(event) => { setChapter(event.target.value); setSelected(""); }}
              aria-label="Choose a chapter"
              className="h-9 max-w-[18rem] rounded-lg border border-line bg-surface-alt px-2 text-[13px] text-ink">
              {data.chapters.map((c) => <option key={c.chapter} value={c.chapter}>{c.chapter} ({c.figures})</option>)}
            </select>
          } />
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <ul className="m-0 flex max-h-[520px] list-none flex-col gap-1 overflow-y-auto p-0">
            {shown.map((entry) => (
              <li key={entry.name}>
                <button type="button" onClick={() => setSelected(entry.name)}
                  aria-pressed={figure?.name === entry.name}
                  className={cn("w-full rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
                    figure?.name === entry.name ? "border-cobalt bg-cobalt-bg text-ink" : "border-line bg-surface hover:border-ink-3")}>
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-[12px] text-ink-3">{entry.number}</span>
                    <span className="min-w-0 flex-1 truncate">{entry.where || entry.name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {!figure ? <Empty title="No figure in this chapter" /> : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="m-0 font-display text-[20px] font-medium">Figure {figure.number}</h3>
                <div className="flex flex-wrap gap-2">
                  {figure.formats.map((fmt) => (
                    <Button key={fmt} onClick={() => void downloadFigure(figure.name, fmt)}>
                      Download {fmt.toUpperCase()} ({kb(figure.bytes[fmt])})
                    </Button>
                  ))}
                </div>
              </div>
              <FigurePreview figure={figure} />
              <p className="m-0 text-[13px] leading-relaxed text-ink-2">{figure.caption}</p>
              <p className="m-0 font-mono text-[11.5px] text-ink-3">{figure.name}</p>
            </div>
          )}
        </div>
        <div className="mt-4">
          <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
            {data.provenance.computed_from}. {data.provenance.note}
          </SourceNote>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TablesTab() {
  const query = useQuery({ queryKey: ["exports-tables"], queryFn: getTables });
  if (query.isLoading) return <Skeleton className="h-[420px] w-full" />;
  if (query.isError) return <ApiError error={query.error} />;
  const data = query.data!;

  return (
    <Card className="p-5">
      <CardHeader title="The numbers behind the figures" subtitle={data.reading} />
      <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
        {data.tables.map((entry) => (
          <li key={entry.name}
            className="flex flex-wrap items-start justify-between gap-4 border-b border-line-soft pb-3 last:border-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <h3 className="m-0 text-[14px] font-medium text-ink">{entry.title}</h3>
              <p className="m-0 mt-0.5 text-[13px] leading-relaxed text-ink-2">{entry.detail}</p>
              <p className="m-0 mt-1 font-mono text-[11.5px] text-ink-3">{entry.artifact}</p>
            </div>
            {entry.available ? (
              <Button onClick={() => void downloadTable(entry.name)}>Download CSV</Button>
            ) : (
              <span className="text-[13px] text-ink-3">not in this record</span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
          {data.provenance.computed_from}. {data.provenance.note}
        </SourceNote>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ReportTab() {
  const query = useQuery({ queryKey: ["exports-report"], queryFn: getReproductionReport });
  if (query.isLoading) return <Skeleton className="h-[560px] w-full" />;
  if (query.isError) return <ApiError error={query.error} title="The reproduction report has not been generated" />;
  const data = query.data!;

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <CardHeader title="Reproduction report" subtitle={data.reading}
          action={<span className="text-[13px] text-ink-3">{kb(data.bytes)}</span>} />
        <nav aria-label="Report sections" className="mt-4 flex flex-wrap gap-2">
          {data.sections.map((section) => (
            <span key={section} className="rounded-full border border-line bg-tint px-2.5 py-1 text-xs text-ink-2">
              {section}
            </span>
          ))}
        </nav>
        <div className="mt-4">
          <SourceNote status={data.provenance.status} runId={data.provenance.run_id}>
            {data.provenance.computed_from}. {data.provenance.note}
          </SourceNote>
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="As generated" subtitle="The file exactly as scripts/reproduction_report.py wrote it." />
        <pre tabIndex={0} aria-label="The reproduction report"
          className="gsx-console m-0 mt-4 max-h-[640px] overflow-auto rounded-lg border border-console-line bg-console p-4 text-[12px] leading-relaxed text-console-text">
          {data.markdown}
        </pre>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ResearchReportsPage() {
  const [tab, setTab] = useState<Tab>("figures");

  return (
    <>
      <PageHeader
        title="Research reports"
        description="The evidence in the formats a thesis and its examiners need: the figures as drawn, the tables behind them as CSV, and the reproduction report as generated. Everything here is written out of the sealed record rather than recomputed, so an export cannot disagree with the page it came from."
      />
      <div className="mt-6 -mx-1 max-w-full overflow-x-auto px-1">
        <Segmented label="Reports view" value={tab} onChange={setTab} options={TABS.map(([value, label]) => ({ value, label }))} />
      </div>
      <div className="mt-5">
        {tab === "figures" ? <FiguresTab /> : null}
        {tab === "tables" ? <TablesTab /> : null}
        {tab === "report" ? <ReportTab /> : null}
      </div>
    </>
  );
}
