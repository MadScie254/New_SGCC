// Playback over the simulated days: play, pause, step, scrub and speed. With prefers-reduced-motion
// nothing auto-plays, and the controls still step through the days.
import { useEffect } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Button, Segmented } from "@/components/ui";

export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

export function useDayClock({ playing, speed, days, onTick }: {
  playing: boolean; speed: Speed; days: number; onTick: () => void;
}) {
  useEffect(() => {
    if (!playing || days < 2) return;
    const id = window.setInterval(onTick, Math.max(60, 600 / speed));
    return () => window.clearInterval(id);
  }, [playing, speed, days, onTick]);
}

export function Timeline({ day, days, dates, playing, speed, reducedMotion, onDay, onPlaying, onSpeed }: {
  day: number;
  days: number;
  dates: string[];
  playing: boolean;
  speed: Speed;
  reducedMotion: boolean;
  onDay: (day: number) => void;
  onPlaying: (playing: boolean) => void;
  onSpeed: (speed: Speed) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        <Button aria-label="Previous day" onClick={() => onDay(Math.max(0, day - 1))} disabled={day === 0} className="h-9 w-9 px-0">
          <SkipBack className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="primary"
          aria-label={playing ? "Pause playback" : "Play the simulated days"}
          aria-pressed={playing}
          onClick={() => onPlaying(!playing)}
          className="h-9 w-9 px-0"
        >
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </Button>
        <Button aria-label="Next day" onClick={() => onDay(Math.min(days - 1, day + 1))} disabled={day >= days - 1} className="h-9 w-9 px-0">
          <SkipForward className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <label className="flex min-w-[220px] flex-1 items-center gap-3 text-[13px] text-ink-2">
        <span className="sr-only">Simulated day</span>
        <input
          type="range"
          min={0}
          max={Math.max(days - 1, 0)}
          step={1}
          value={day}
          onChange={(event) => onDay(Number(event.target.value))}
          aria-valuetext={dates[day] ?? ""}
          className="h-1.5 w-full flex-1 cursor-pointer appearance-none rounded-full bg-tint accent-cobalt"
        />
        <span className="w-[9.5rem] shrink-0 font-mono text-xs tabular text-ink">
          {dates[day] ?? "—"} <span className="text-ink-3">· {day + 1}/{days}</span>
        </span>
      </label>
      <Segmented
        label="Playback speed"
        value={String(speed)}
        options={SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }))}
        onChange={(value) => onSpeed(Number(value) as Speed)}
      />
      {reducedMotion ? (
        <span className="text-[11px] text-ink-3">Reduced motion: nothing animates until you press play.</span>
      ) : null}
    </div>
  );
}
