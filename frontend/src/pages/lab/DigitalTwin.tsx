// GridSentinel X: the 3D digital twin workspace. The network, its coordinates and every scenario
// series are simulated; the only authentic readings here are an operational customer's, shown on a
// virtual meter whose choice is arbitrary and said to be so.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, RotateCcw } from "lucide-react";
import { ApiError, Button, Card, PageHeader, Segmented, Skeleton, Stat } from "@/components/ui";
import { Caveat, EvidenceBadge, SourceNote } from "@/components/evidence";
import { fmtInt, fmtNum } from "@/lib/format";
import { getTwinCatalogue, getTwinNetwork, simulateNetwork } from "@/lib/api/twin";
import { TwinScene } from "./twin/scene";
import { SchematicFallback } from "./twin/fallback";
import { AggregatePanel, AssetList, AssetPanel } from "./twin/panels";
import { CompareView, ResearchLink, ScenarioStudio } from "./twin/studio";
import { Timeline, useDayClock, type Speed } from "./twin/playback";
import { dayState, indexNetwork, usePrefersReducedMotion, webglAvailable } from "./twin/shared";

const MAX_SEED = 2 ** 31 - 1;

export function DigitalTwinPage() {
  const reducedMotion = usePrefersReducedMotion();
  const [canWebgl] = useState(() => webglAvailable());
  const [view, setView] = useState<"3d" | "schematic">(() => (webglAvailable() ? "3d" : "schematic"));
  const [seed, setSeed] = useState(7);
  const [seedDraft, setSeedDraft] = useState("7");
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(2);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const [feeder, setFeeder] = useState<string | null>(null);
  const [studioPoint, setStudioPoint] = useState<string | null>(null);

  const network = useQuery({ queryKey: ["twin-network", seed], queryFn: () => getTwinNetwork(seed), staleTime: Infinity });
  const catalogue = useQuery({ queryKey: ["twin-catalogue"], queryFn: getTwinCatalogue, staleTime: Infinity });
  const simulation = useQuery({
    queryKey: ["twin-simulation", seed],
    queryFn: () => simulateNetwork({ seed }),
    staleTime: 10 * 60 * 1000,
  });

  const index = useMemo(() => (network.data ? indexNetwork(network.data) : null), [network.data]);
  const days = simulation.data?.window.dates.length ?? 0;
  const state = useMemo(
    () => (simulation.data ? dayState(simulation.data.meters, simulation.data.aggregates, Math.min(day, days - 1)) : null),
    [simulation.data, day, days],
  );

  useDayClock({ playing, speed, days, onTick: useCallback(() => setDay((current) => (days ? (current + 1) % days : 0)), [days]) });

  // Open on the last simulated day, with a meter that carries a scenario selected.
  useEffect(() => {
    if (!simulation.data) return;
    setDay(simulation.data.window.dates.length - 1);
    setSelected((current) => current ?? simulation.data.assignment[0]?.service_point ?? null);
    setStudioPoint((current) => current ?? simulation.data.assignment.find((row) => row.scenario === "bypass_partial")?.service_point
      ?? simulation.data.meters[0]?.id ?? null);
  }, [simulation.data]);

  const select = useCallback((id: string | null) => setSelected(id), []);
  const selectAndFocus = useCallback((id: string) => {
    setSelected(id);
    setFocusToken((token) => token + 1);
  }, []);

  const loading = network.isPending || catalogue.isPending || simulation.isPending;
  const error = network.error ?? catalogue.error ?? simulation.error;

  return (
    <>
      <PageHeader
        eyebrow="Simulated network · no SGCC location or topology data exists"
        title="3D digital twin"
        description={
          <>
            A simulated distribution network for showing what patterns of meter readings look like and how the model in
            service reacts to them. SGCC has no customer locations and no network topology, so every asset, coordinate and
            series here is generated from a seed — nothing in this view is observed infrastructure.
          </>
        }
        actions={
          <>
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const value = Number(seedDraft);
                if (Number.isInteger(value) && value >= 0 && value <= MAX_SEED) setSeed(value);
              }}
            >
              <label htmlFor="twin-seed" className="flex flex-col gap-1 text-[12px] text-ink-2">
                Network seed
                <input
                  id="twin-seed"
                  value={seedDraft}
                  inputMode="numeric"
                  onChange={(event) => setSeedDraft(event.target.value)}
                  className="h-11 w-24 rounded-lg border border-line bg-surface px-3 font-mono text-sm outline-none focus:border-cobalt"
                />
              </label>
              <Button type="submit" variant="secondary">Generate</Button>
            </form>
            <Segmented
              label="View"
              value={view}
              options={[{ value: "3d", label: "3D" }, { value: "schematic", label: "Schematic" }]}
              onChange={(value) => setView(value as "3d" | "schematic")}
            />
          </>
        }
      />

      <Caveat title="What this twin is and is not">
        The network, its coordinates, ratings and every simulated series are <strong>synthetic</strong>: generated from the
        seed above for illustration. A score on a simulated series shows how the model reacts to a pattern of readings, not
        the probability that such a pattern is theft. Scenarios of lawful behaviour that looks suspicious are included on
        equal footing, and a pattern of readings never identifies its cause.
      </Caveat>

      {error ? <ApiError error={error} title="The twin could not be simulated" /> : null}
      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-[30rem]" />
          <Skeleton className="h-[30rem]" />
        </div>
      ) : null}

      {network.data && catalogue.data && simulation.data && index && state ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Simulated service points" value={fmtInt(simulation.data.model.meter_count)} hint={`${fmtInt(network.data.counts.transformer ?? 0)} transformers · ${fmtInt(network.data.counts.substation ?? 0)} substations`} />
            <Stat label="Meters with a scenario" value={fmtInt(simulation.data.assignment.length)} hint={`${fmtInt(simulation.data.assignment.filter((row) => row.false_positive_example).length)} are false-positive examples`} />
            <Stat label="Flagged by the model" value={fmtInt(simulation.data.model.flagged)} tone="risk" hint={`at the operating threshold ${fmtNum(simulation.data.model.threshold)}`} />
            <Stat label="No reading today" value={fmtInt(state.missing.size)} hint="amber meters in the view" />
          </div>

          <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="h-[22rem] sm:h-[30rem] lg:h-[34rem]">
                {view === "3d" && canWebgl ? (
                  <TwinScene
                    network={network.data}
                    index={index}
                    state={state}
                    dayLabel={simulation.data.window.dates[Math.min(day, days - 1)] ?? ""}
                    selected={selected}
                    onSelect={select}
                    reducedMotion={reducedMotion}
                    speed={speed}
                    focusToken={focusToken}
                    resetToken={resetToken}
                  />
                ) : (
                  <SchematicFallback
                    network={network.data}
                    index={index}
                    state={state}
                    dayLabel={simulation.data.window.dates[Math.min(day, days - 1)] ?? ""}
                    selected={selected}
                    onSelect={select}
                    reason={canWebgl
                      ? "Flat schematic of the same simulated network, driven by the same simulation data."
                      : "WebGL is unavailable in this browser, so the twin is drawn as a flat schematic from the same simulation data."}
                  />
                )}
              </div>
              <Card label="Playback" className="flex flex-col gap-3 p-4">
                <Timeline
                  day={Math.min(day, Math.max(days - 1, 0))}
                  days={days}
                  dates={simulation.data.window.dates}
                  playing={playing}
                  speed={speed}
                  reducedMotion={reducedMotion}
                  onDay={(value) => { setDay(value); setPlaying(false); }}
                  onPlaying={setPlaying}
                  onSpeed={setSpeed}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SourceNote status="synthetic">
                    {fmtInt(days)} simulated days ending {simulation.data.window.dates[days - 1]}; flow along the lines is
                    proportional to the simulated load of the day shown.
                  </SourceNote>
                  <div className="flex gap-2">
                    <Button onClick={() => { setResetToken((token) => token + 1); }} disabled={view !== "3d" || !canWebgl}>
                      <RotateCcw className="h-4 w-4" aria-hidden /> Reset view
                    </Button>
                    <Button onClick={() => selected && setFocusToken((token) => token + 1)} disabled={!selected || view !== "3d" || !canWebgl}>
                      <Boxes className="h-4 w-4" aria-hidden /> Focus selection
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
            <AssetList
              network={network.data}
              state={state}
              simulation={simulation.data}
              selected={selected}
              onSelect={selectAndFocus}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <AssetPanel
              node={selected ? index.byId.get(selected) ?? null : null}
              index={index}
              state={state}
              simulation={simulation.data}
              catalogue={catalogue.data.scenarios}
              seed={seed}
              day={Math.min(day, Math.max(days - 1, 0))}
              onFocus={() => setFocusToken((token) => token + 1)}
              onSelect={selectAndFocus}
            />
            <AggregatePanel
              simulation={simulation.data}
              index={index}
              day={Math.min(day, Math.max(days - 1, 0))}
              feeder={feeder}
              onFeeder={setFeeder}
              onSelect={selectAndFocus}
            />
          </div>

          {studioPoint ? (
            <>
              <ScenarioStudio
                seed={seed}
                scenarios={catalogue.data.scenarios}
                dates={catalogue.data.calendar.dates}
                index={index}
                servicePoint={studioPoint}
                onServicePoint={setStudioPoint}
                window={{ start_day: simulation.data.window.start_day, end_day: simulation.data.window.end_day }}
              />
              <CompareView seed={seed} pairs={catalogue.data.compare_pairs} servicePoint={studioPoint} />
              <ResearchLink index={index} servicePoint={studioPoint} onServicePoint={setStudioPoint} />
            </>
          ) : null}

          <footer className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-5 py-4 text-[12px] leading-relaxed text-ink-3">
            <span className="flex flex-wrap items-center gap-2 text-ink-2">
              <EvidenceBadge status="synthetic" />
              <span className="font-medium">
                This twin is connected to no real infrastructure. It reads no live telemetry and sends no commands to any
                device, meter or utility system.
              </span>
            </span>
            <span>
              Network seed {network.data.seed} · {network.data.units} · model {catalogue.data.model.label} v
              {catalogue.data.model.version}. {catalogue.data.statements.model}
            </span>
          </footer>
        </>
      ) : null}
    </>
  );
}
