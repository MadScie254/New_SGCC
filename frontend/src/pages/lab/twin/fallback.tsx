// A 2D schematic of the same simulated network, driven by the same simulation data. It is used when
// WebGL is unavailable (no GPU, automated tests) and whenever the reader asks for the flat view.
import { EvidenceBadge } from "@/components/evidence";
import type { TwinNetwork } from "@/lib/api/twin";
import { KIND_LABEL, scene, type DayState, type NetworkIndex } from "./shared";

const W = 1000;
const H = 620;
const PAD = 34;

export function SchematicFallback({ network, index, state, dayLabel, selected, onSelect, reason }: {
  network: TwinNetwork;
  index: NetworkIndex;
  state: DayState;
  dayLabel: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  reason?: string;
}) {
  const [x0, x1] = index.extent.x;
  const [z0, z1] = index.extent.z;
  const scale = Math.min((W - 2 * PAD) / Math.max(x1 - x0, 1), (H - 2 * PAD) / Math.max(z1 - z0, 1));
  const px = (x: number) => PAD + (x - x0) * scale;
  const py = (z: number) => PAD + (z - z0) * scale;

  const colourOf = (id: string, fallback: string) => {
    if (state.missing.has(id)) return scene.missing;
    if (state.flagged.has(id)) return scene.flagged;
    return fallback;
  };

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden rounded-xl border border-line bg-ground p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-violet">
          <EvidenceBadge status="synthetic" />
          Simulated network — not SGCC infrastructure
        </span>
        <span className="font-mono text-[11px] tabular text-ink-2">{dayLabel}</span>
      </div>
      {reason ? <p className="m-0 text-[11px] text-ink-3">{reason}</p> : null}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full flex-1"
        role="img"
        aria-label={`Schematic of the simulated network on ${dayLabel}: ${index.servicePoints.length} virtual service points, `
          + `${state.flagged.size} flagged by the model, ${state.missing.size} with no reading today.`}
      >
        {network.edges.map((edge) => {
          const points = edge.points.map((p) => `${px(p[0]).toFixed(1)},${py(p[2]).toFixed(1)}`).join(" ");
          const load = state.supplied.get(edge.to) ?? state.reading.get(edge.to) ?? 0;
          const reference = edge.role === "service" ? state.peakMeter : state.peakSupplied;
          const strength = 0.3 + 0.7 * Math.min(1, Math.sqrt(load / reference));
          return (
            <polyline
              key={edge.id}
              points={points}
              fill="none"
              stroke={colourOf(edge.to, edge.level === "hv" ? scene.hv : edge.level === "mv" ? scene.mv : scene.lv)}
              strokeOpacity={strength}
              strokeWidth={edge.level === "hv" ? 2.6 : edge.level === "mv" ? 1.8 : 0.9}
            />
          );
        })}
        {index.servicePoints.map((node) => (
          <rect
            key={node.id}
            x={px(node.position.x) - 2.6}
            y={py(node.position.z) - 2.6}
            width={5.2}
            height={5.2}
            rx={1}
            fill={colourOf(node.id, node.building === "commercial" ? "#5B7795" : "#415A77")}
            stroke={selected === node.id ? scene.select : "none"}
            strokeWidth={1.4}
            className="cursor-pointer"
            onClick={() => onSelect(node.id)}
          >
            <title>{`${node.label} · ${node.building} · ${state.reading.get(node.id) ?? "no"} kWh`}</title>
          </rect>
        ))}
        {network.nodes.filter((n) => n.kind === "transformer").map((node) => (
          <circle
            key={node.id}
            cx={px(node.position.x)}
            cy={py(node.position.z)}
            r={5}
            fill={(state.gap.get(node.id) ?? 0) > 0.02 * (state.supplied.get(node.id) ?? 1) ? scene.flagged : "#2B3A52"}
            stroke={selected === node.id ? scene.select : scene.mv}
            strokeWidth={selected === node.id ? 2 : 1}
            className="cursor-pointer"
            onClick={() => onSelect(node.id)}
          >
            <title>{`${node.label} · ${node.rating.value} kVA`}</title>
          </circle>
        ))}
        {network.nodes.filter((n) => n.kind === "substation" || n.kind === "bulk_supply" || n.kind === "operations_centre").map((node) => (
          <g key={node.id} className="cursor-pointer" onClick={() => onSelect(node.id)}>
            <rect
              x={px(node.position.x) - 11}
              y={py(node.position.z) - 8}
              width={22}
              height={16}
              rx={2}
              fill={node.kind === "operations_centre" ? "#241C45" : "#15233A"}
              stroke={selected === node.id ? scene.select : node.kind === "operations_centre" ? scene.ops : scene.hv}
              strokeWidth={selected === node.id ? 2 : 1.2}
            />
            <text x={px(node.position.x)} y={py(node.position.z) + 20} textAnchor="middle" fontSize="10" fill="#7386A0" fontFamily="IBM Plex Mono, monospace">
              {node.id}
            </text>
            <title>{`${node.label} · ${KIND_LABEL[node.kind]}`}</title>
          </g>
        ))}
      </svg>
    </div>
  );
}
