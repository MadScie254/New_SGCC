import type { ReactNode } from "react";

/**
 * A titled SVG figure.
 *
 * `ariaLabel` states the finding, not the chart type, so a screen reader gets the same thing a
 * sighted reader takes from the picture. The legend is HTML above the plot so it never collides
 * with an axis, and the plot keeps a legible minimum width: on a phone it scrolls inside its card
 * rather than shrinking to nothing.
 */
export function Figure({ title, ariaLabel, viewBox, legend, minWidth = 680, children }: {
  title: ReactNode;
  ariaLabel: string;
  viewBox: string;
  legend?: ReactNode;
  minWidth?: number;
  children: ReactNode;
}) {
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="text-[13px] font-medium text-ink">{title}</figcaption>
      {legend ? <p className="m-0 text-[11px] text-ink-3">{legend}</p> : null}
      <div className="-mx-1 overflow-x-auto px-1">
        <svg viewBox={viewBox} role="img" aria-label={ariaLabel} className="h-auto w-full"
          style={{ minWidth: `${minWidth}px` }} preserveAspectRatio="xMidYMid meet">
          {children}
        </svg>
      </div>
    </figure>
  );
}
