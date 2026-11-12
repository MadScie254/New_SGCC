// The React Three Fiber view of the simulated network. The "simulated network" label is part of
// the view itself: an overlay inside the canvas frame that cannot be dismissed.
import { useEffect, useMemo, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { TwinNetwork, TwinNode } from "@/lib/api/twin";
import { EvidenceBadge } from "@/components/evidence";
import { Conductors, Flow, Ground, OperationsCentre, SelectionMarker, ServicePoints, Station, Transformers } from "./assets";
import { scene, type DayState, type NetworkIndex } from "./shared";

type Controls = ComponentRef<typeof OrbitControls>;

const VIEW_DIRECTION = new THREE.Vector3(0.12, 0.66, 0.74).normalize();

/** Frame the whole network for the canvas as it is now: a short, wide canvas needs a longer lens. */
function homeView(index: NetworkIndex, fov: number, aspect: number): { target: THREE.Vector3; position: THREE.Vector3 } {
  const cx = (index.extent.x[0] + index.extent.x[1]) / 2;
  const cz = (index.extent.z[0] + index.extent.z[1]) / 2;
  const span = Math.max(index.extent.x[1] - index.extent.x[0], index.extent.z[1] - index.extent.z[0], 200);
  const distance = (span / 2) / Math.tan((fov * Math.PI) / 360) / Math.max(Math.min(aspect, 1.6), 0.5) * 1.1;
  const target = new THREE.Vector3(cx, 0, cz);
  return { target, position: target.clone().add(VIEW_DIRECTION.clone().multiplyScalar(distance)) };
}

/** Orbit, pan and zoom with sensible limits, plus animated "reset view" and "focus on selection". */
function Rig({ index, focus, focusToken, resetToken }: {
  index: NetworkIndex; focus: TwinNode | null; focusToken: number; resetToken: number;
}) {
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const fov = (camera as THREE.PerspectiveCamera).fov ?? 42;
  const home = useMemo(
    () => homeView(index, fov, size.width / Math.max(size.height, 1)),
    [index, fov, size.width, size.height],
  );
  const wanted = useRef({ target: home.target.clone(), position: home.position.clone(), active: false });

  // Place the camera once per network: a canvas resize must not throw away the reader's own view.
  const placedFor = useRef<NetworkIndex | null>(null);
  useEffect(() => {
    if (placedFor.current === index) return;
    placedFor.current = index;
    camera.position.copy(home.position);
    if (controls.current) {
      controls.current.target.copy(home.target);
      controls.current.update();
    }
    wanted.current = { target: home.target.clone(), position: home.position.clone(), active: false };
  }, [camera, home, index]);

  useEffect(() => {
    if (resetToken === 0) return;
    wanted.current = { target: home.target.clone(), position: home.position.clone(), active: true };
    invalidate();
  }, [resetToken, home, invalidate]);

  useEffect(() => {
    if (focusToken === 0 || !focus) return;
    const target = new THREE.Vector3(focus.position.x, 0, focus.position.z);
    const distance = focus.kind === "service_point" ? 78 : focus.kind === "transformer" ? 120 : 230;
    wanted.current = { target, position: target.clone().add(new THREE.Vector3(0.18 * distance, distance * 0.62, distance)), active: true };
    invalidate();
  }, [focusToken, focus, invalidate]);

  useFrame(() => {
    const move = wanted.current;
    if (!move.active || !controls.current) return;
    camera.position.lerp(move.position, 0.1);
    controls.current.target.lerp(move.target, 0.12);
    controls.current.update();
    invalidate();
    if (camera.position.distanceTo(move.position) < 1.5) move.active = false;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={28}
      maxDistance={2200}
      maxPolarAngle={Math.PI / 2 - 0.06}
      target={home.target}
    />
  );
}

export interface SceneProps {
  network: TwinNetwork;
  index: NetworkIndex;
  state: DayState;
  dayLabel: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  reducedMotion: boolean;
  speed: number;
  focusToken: number;
  resetToken: number;
}

export function TwinScene({ network, index, state, dayLabel, selected, onSelect, reducedMotion, speed, focusToken, resetToken }: SceneProps) {
  const transformers = useMemo(() => network.nodes.filter((node) => node.kind === "transformer"), [network]);
  const stations = useMemo(() => network.nodes.filter((node) => node.kind === "substation" || node.kind === "bulk_supply"), [network]);
  const ops = network.nodes.find((node) => node.kind === "operations_centre");
  const selectedNode = selected ? index.byId.get(selected) ?? null : null;
  const flagged = state.flagged.size;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-line bg-ground">
      <Canvas
        role="img"
        aria-label={`Simulated distribution network on ${dayLabel}: ${index.servicePoints.length} virtual service points, `
          + `${transformers.length} distribution transformers, ${flagged} meters flagged by the model. `
          + "The network is simulated, not SGCC infrastructure. Every asset can also be selected from the asset list beside this view."}
        dpr={[1, 2]}
        frameloop={reducedMotion ? "demand" : "always"}
        camera={{ fov: 42, near: 1, far: 6000, position: [300, 400, 520] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => gl.setClearColor(scene.ground)}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={[scene.ground]} />
        <fog attach="fog" args={[scene.ground, 900, 2600]} />
        <hemisphereLight args={["#2A3A54", "#060A12", 1.1]} />
        <directionalLight position={[220, 420, 180]} intensity={1.15} color="#CFE3F5" />
        <directionalLight position={[-320, 180, -260]} intensity={0.35} color="#38BDF8" />
        <Ground index={index} />
        <Conductors network={network} state={state} />
        <Flow network={network} state={state} reducedMotion={reducedMotion} speed={speed} />
        <ServicePoints index={index} state={state} onSelect={onSelect} />
        <Transformers nodes={transformers} state={state} onSelect={onSelect} />
        {stations.map((node) => (
          <Station key={node.id} node={node} kind={node.kind === "bulk_supply" ? "bulk_supply" : "substation"} onSelect={onSelect} />
        ))}
        {ops ? <OperationsCentre node={ops} onSelect={onSelect} /> : null}
        {selectedNode ? <SelectionMarker node={selectedNode} reducedMotion={reducedMotion} /> : null}
        <Rig index={index} focus={selectedNode} focusToken={focusToken} resetToken={resetToken} />
      </Canvas>

      {/* Persistent, non-dismissible statement of what this view is. */}
      <div className="pointer-events-none absolute left-3 top-3 flex max-w-[min(92%,30rem)] flex-col gap-1.5 rounded-lg border border-violet/50 bg-ground/90 px-3 py-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-violet">
          <EvidenceBadge status="synthetic" />
          Simulated network — not SGCC infrastructure
        </span>
        <span className="text-[11px] leading-snug text-ink-3">
          Seeded illustration. SGCC has no customer locations or topology, and this twin connects to nothing.
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-ground/85 px-3 py-2 text-[11px] text-ink-2">
        <span className="font-mono tabular text-ink">{dayLabel}</span>
        {[
          { color: scene.mv, label: "energised line" },
          { color: scene.missing, label: "missing telemetry" },
          { color: scene.flagged, label: "flagged by the model" },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
