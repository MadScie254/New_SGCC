// Instrument-style low-poly geometry for the simulated network. Buildings, meters and transformers
// are instanced (one draw call each) so a few hundred service points stay cheap, and every geometry
// and material built here is disposed when the scene unmounts.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { TwinEdge, TwinNetwork, TwinNode } from "@/lib/api/twin";
import { scene, type DayState, type NetworkIndex } from "./shared";

const UP = new THREE.Object3D();
const COLOR = new THREE.Color();

function useDisposed<T extends THREE.Object3D>(object: T): T {
  useEffect(() => () => {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    (object as unknown as THREE.InstancedMesh).dispose?.();
  }, [object]);
  return object;
}

function instanced(count: number, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(count, 1));
  mesh.count = count;
  mesh.frustumCulled = false;
  return mesh;
}

function place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  UP.position.set(x, y, z);
  UP.scale.set(sx, sy, sz);
  UP.rotation.set(0, 0, 0);
  UP.updateMatrix();
  mesh.setMatrixAt(i, UP.matrix);
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

export function Ground({ index }: { index: NetworkIndex }) {
  const size = Math.max(index.extent.x[1] - index.extent.x[0], index.extent.z[1] - index.extent.z[0]) + 260;
  const centre: [number, number, number] = [
    (index.extent.x[0] + index.extent.x[1]) / 2, -0.4, (index.extent.z[0] + index.extent.z[1]) / 2,
  ];
  return (
    <group position={centre}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow={false}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color={scene.ground} />
      </mesh>
      <gridHelper args={[size, Math.round(size / 42), scene.grid, scene.grid]} position={[0, 0.2, 0]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Conductors: one line-segments object for the whole network
// ---------------------------------------------------------------------------

const LEVEL_COLOR = { hv: scene.hv, mv: scene.mv, lv: scene.lv } as const;

export function Conductors({ network, state }: { network: TwinNetwork; state: DayState }) {
  const lines = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    network.edges.forEach((edge) => {
      for (let i = 0; i < edge.points.length - 1; i += 1) {
        positions.push(...edge.points[i], ...edge.points[i + 1]);
        colors.push(0, 0, 0, 0, 0, 0);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
    return new THREE.LineSegments(geometry, material);
  }, [network]);
  useDisposed(lines);

  // A service line is amber when its meter has no reading today and coral when the model flags it;
  // everything else is energised cyan, dimmed in proportion to the load it carries.
  useEffect(() => {
    const attribute = lines.geometry.getAttribute("color") as THREE.BufferAttribute;
    let vertex = 0;
    network.edges.forEach((edge) => {
      const load = state.supplied.get(edge.to) ?? state.reading.get(edge.to) ?? 0;
      const reference = edge.level === "lv" && edge.role === "service" ? state.peakMeter : state.peakSupplied;
      let colour: string = LEVEL_COLOR[edge.level];
      if (state.missing.has(edge.to)) colour = scene.missing;
      else if (state.flagged.has(edge.to)) colour = scene.flagged;
      COLOR.set(colour).multiplyScalar(0.45 + 0.55 * Math.min(1, Math.sqrt(load / reference)));
      for (let i = 0; i < edge.points.length - 1; i += 1) {
        attribute.setXYZ(vertex, COLOR.r, COLOR.g, COLOR.b);
        attribute.setXYZ(vertex + 1, COLOR.r, COLOR.g, COLOR.b);
        vertex += 2;
      }
    });
    attribute.needsUpdate = true;
  }, [lines, network, state]);

  return <primitive object={lines} />;
}

// ---------------------------------------------------------------------------
// Electricity flow: instanced pulses that run along the lines
// ---------------------------------------------------------------------------

interface FlowPath {
  points: THREE.Vector3[];
  lengths: number[];
  total: number;
  to: string;
}

const PULSES_PER_EDGE = 2;

export function Flow({ network, state, reducedMotion, speed }: {
  network: TwinNetwork; state: DayState; reducedMotion: boolean; speed: number;
}) {
  const paths = useMemo<FlowPath[]>(() => network.edges
    .filter((edge: TwinEdge) => edge.role !== "service")
    .map((edge) => {
      const points = edge.points.map((p) => new THREE.Vector3(p[0], p[1] + 1.4, p[2]));
      const lengths = points.slice(1).map((point, i) => point.distanceTo(points[i]));
      return { points, lengths, total: lengths.reduce((sum, l) => sum + l, 0), to: edge.to };
    }), [network]);

  const count = paths.length * PULSES_PER_EDGE;
  const mesh = useMemo(() => instanced(
    count,
    new THREE.OctahedronGeometry(2.1, 0),
    new THREE.MeshBasicMaterial({ color: scene.hv, transparent: true, opacity: 0.85 }),
  ), [count]);
  useDisposed(mesh);
  const phases = useRef<Float32Array>(new Float32Array(0));

  useEffect(() => {
    phases.current = new Float32Array(count);
    for (let i = 0; i < count; i += 1) phases.current[i] = ((i % PULSES_PER_EDGE) / PULSES_PER_EDGE + 0.17 * i) % 1;
  }, [count]);

  const draw = (delta: number) => {
    const phase = phases.current;
    if (phase.length !== count) return;
    for (let p = 0; p < paths.length; p += 1) {
      const path = paths[p];
      const load = state.supplied.get(path.to) ?? 0;
      const relative = Math.min(1, Math.sqrt(load / state.peakSupplied));
      for (let k = 0; k < PULSES_PER_EDGE; k += 1) {
        const i = p * PULSES_PER_EDGE + k;
        if (delta > 0) phase[i] = (phase[i] + delta * (0.08 + 0.42 * relative) * speed) % 1;
        let travelled = phase[i] * path.total;
        let leg = 0;
        while (leg < path.lengths.length - 1 && travelled > path.lengths[leg]) {
          travelled -= path.lengths[leg];
          leg += 1;
        }
        const t = path.lengths[leg] > 0 ? travelled / path.lengths[leg] : 0;
        const a = path.points[leg];
        const b = path.points[leg + 1];
        const size = load <= 0 ? 0 : 0.45 + 0.75 * relative;
        place(mesh, i, a.x + (b.x - a.x) * t, a.y, a.z + (b.z - a.z) * t, size, size, size);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  useFrame((_, delta) => {
    if (!reducedMotion) draw(Math.min(delta, 0.1));
  });
  useEffect(() => {
    draw(0); // static markers: correct positions without animating (also the reduced-motion view)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh, state, paths]);

  return <primitive object={mesh} />;
}

// ---------------------------------------------------------------------------
// Buildings and their meters
// ---------------------------------------------------------------------------

export function ServicePoints({ index, state, onSelect }: {
  index: NetworkIndex; state: DayState; onSelect: (id: string) => void;
}) {
  const points = index.servicePoints;
  const residential = points.filter((p) => p.building === "residential");
  const commercial = points.filter((p) => p.building !== "residential");

  const buildings = useMemo(() => [residential, commercial].map((group, kind) => {
    const mesh = instanced(
      group.length,
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: kind === 0 ? scene.residential : scene.commercial, roughness: 0.85, metalness: 0.05 }),
    );
    group.forEach((node, i) => {
      const f = node.footprint ?? { w: 4, d: 4, h: 4 };
      place(mesh, i, node.position.x, f.h / 2, node.position.z, f.w, f.h, f.d);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [index]);
  const meters = useMemo(() => {
    const mesh = instanced(
      points.length,
      new THREE.BoxGeometry(1.5, 1.9, 0.7),
      new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5, metalness: 0.1, emissive: new THREE.Color("#0B1420") }),
    );
    points.forEach((node, i) => {
      const f = node.footprint ?? { w: 4, d: 4, h: 4 };
      place(mesh, i, node.position.x + f.w / 2 + 0.6, 2.4, node.position.z, 1, 1, 1);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [points]);
  useDisposed(buildings[0]);
  useDisposed(buildings[1]);
  useDisposed(meters);

  // One colour per meter: amber = no reading today, coral = flagged by the model, otherwise cyan by load.
  useEffect(() => {
    points.forEach((node, i) => {
      const reading = state.reading.get(node.id);
      if (state.missing.has(node.id)) COLOR.set(scene.missing);
      else if (state.flagged.has(node.id)) COLOR.set(scene.flagged);
      else COLOR.set(scene.meter).multiplyScalar(0.4 + 0.6 * Math.min(1, Math.sqrt((reading ?? 0) / state.peakMeter)));
      meters.setColorAt(i, COLOR);
    });
    if (meters.instanceColor) meters.instanceColor.needsUpdate = true;
    [residential, commercial].forEach((group, kind) => {
      group.forEach((node, i) => {
        COLOR.set(kind === 0 ? scene.residential : scene.commercial);
        if (state.flagged.has(node.id)) COLOR.set(scene.flagged).multiplyScalar(0.55);
        else if (state.missing.has(node.id)) COLOR.set(scene.missing).multiplyScalar(0.4);
        buildings[kind].setColorAt(i, COLOR);
      });
      if (buildings[kind].instanceColor) buildings[kind].instanceColor!.needsUpdate = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, meters, buildings, points]);

  const pick = (group: TwinNode[]) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const node = group[event.instanceId ?? -1];
    if (node) onSelect(node.id);
  };

  return (
    <group>
      <primitive object={buildings[0]} onClick={pick(residential)} />
      <primitive object={buildings[1]} onClick={pick(commercial)} />
      <primitive object={meters} onClick={pick(points)} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Transformers (pole and pad mounted)
// ---------------------------------------------------------------------------

export function Transformers({ nodes, state, onSelect }: {
  nodes: TwinNode[]; state: DayState; onSelect: (id: string) => void;
}) {
  const tanks = useMemo(() => {
    const mesh = instanced(
      nodes.length,
      new THREE.CylinderGeometry(2.2, 2.2, 4.4, 8),
      new THREE.MeshStandardMaterial({ color: scene.steel, roughness: 0.6, metalness: 0.3 }),
    );
    nodes.forEach((node, i) => {
      const pole = node.mount === "pole";
      place(mesh, i, node.position.x, pole ? 9.5 : 3.2, node.position.z, 1, pole ? 0.8 : 1.2, 1);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [nodes]);
  const masts = useMemo(() => {
    const mesh = instanced(
      nodes.length,
      new THREE.CylinderGeometry(0.5, 0.65, 1, 6),
      new THREE.MeshStandardMaterial({ color: "#35445C", roughness: 0.9 }),
    );
    nodes.forEach((node, i) => {
      const height = node.mount === "pole" ? 12 : 5;
      place(mesh, i, node.position.x, height / 2, node.position.z, 1, height, 1);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [nodes]);
  useDisposed(tanks);
  useDisposed(masts);

  useEffect(() => {
    nodes.forEach((node, i) => {
      const gap = state.gap.get(node.id) ?? 0;
      const supplied = state.supplied.get(node.id) ?? 0;
      // A transformer turns coral only when the simulation's own balance leaves energy unaccounted for.
      if (supplied > 0 && gap > 0.02 * supplied) COLOR.set(scene.flagged);
      else if ((state.missing.size > 0 && (state.gap.get(node.id) ?? 0) > 0)) COLOR.set(scene.missing);
      else COLOR.set(scene.steel).multiplyScalar(0.7 + 0.5 * Math.min(1, Math.sqrt(supplied / state.peakSupplied)));
      tanks.setColorAt(i, COLOR);
    });
    if (tanks.instanceColor) tanks.instanceColor.needsUpdate = true;
  }, [nodes, state, tanks]);

  return (
    <group>
      <primitive object={masts} />
      <primitive
        object={tanks}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          const node = nodes[event.instanceId ?? -1];
          if (node) onSelect(node.id);
        }}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Substations, the bulk supply point and the operations centre
// ---------------------------------------------------------------------------

function Busbars({ width, colour }: { width: number; colour: string }) {
  return (
    <group>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[0, 7 + i * 2.6, i * 3.4]}>
          <boxGeometry args={[width, 0.5, 0.5]} />
          <meshBasicMaterial color={colour} />
        </mesh>
      ))}
    </group>
  );
}

export function Station({ node, kind, onSelect }: { node: TwinNode; kind: "bulk_supply" | "substation"; onSelect: (id: string) => void }) {
  const bulk = kind === "bulk_supply";
  const width = bulk ? 34 : 26;
  return (
    <group position={[node.position.x, 0, node.position.z]} onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}>
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[width, 1.2, 22]} />
        <meshStandardMaterial color="#141E2E" roughness={0.95} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * width) / 2.6, 6, 0]}>
          <boxGeometry args={[3.4, 12, 3.4]} />
          <meshStandardMaterial color={scene.steel} roughness={0.7} metalness={0.25} />
        </mesh>
      ))}
      {/* Transformer bay */}
      <mesh position={[0, 3.4, 6]}>
        <boxGeometry args={[9, 6.8, 7]} />
        <meshStandardMaterial color="#3C4C66" roughness={0.6} metalness={0.3} />
      </mesh>
      <Busbars width={width * 0.86} colour={bulk ? scene.hv : scene.mv} />
    </group>
  );
}

export function OperationsCentre({ node, onSelect }: { node: TwinNode; onSelect: (id: string) => void }) {
  return (
    <group position={[node.position.x, 0, node.position.z]} onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}>
      <mesh position={[0, 7, 0]}>
        <boxGeometry args={[22, 14, 16]} />
        <meshStandardMaterial color="#1B2436" roughness={0.8} />
      </mesh>
      <mesh position={[0, 14.6, 0]}>
        <boxGeometry args={[23, 1.2, 17]} />
        <meshBasicMaterial color={scene.ops} />
      </mesh>
      <mesh position={[8, 20, -5]}>
        <cylinderGeometry args={[0.4, 0.4, 11, 6]} />
        <meshStandardMaterial color={scene.steel} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Selection marker
// ---------------------------------------------------------------------------

export function SelectionMarker({ node, reducedMotion }: { node: TwinNode; reducedMotion: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const radius = node.kind === "service_point" ? 7 : node.kind === "transformer" ? 11 : 22;
  useFrame(({ clock }) => {
    if (ring.current && !reducedMotion) {
      ring.current.scale.setScalar(1 + 0.06 * Math.sin(clock.elapsedTime * 2.4));
    }
  });
  return (
    <group position={[node.position.x, 0.6, node.position.z]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius, radius + 1.3, 40]} />
        <meshBasicMaterial color={scene.select} transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 16, 0]}>
        <boxGeometry args={[0.35, 32, 0.35]} />
        <meshBasicMaterial color={scene.select} transparent opacity={0.35} />
      </mesh>
    </group>
  );
}
