import * as THREE from "three";
import { distanceToSegment, type Entrance, type Point, type Space, type Wall } from "@indoor/core";

const positive = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
const finite = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) ? value : fallback;

export interface Opening {
  entrance: Entrance;
  wall: Wall;
  from: number;
  to: number;
  bottom: number;
  top: number;
}

/** An opening belongs to exactly one wall, even at a corner. Vertical circulation never cuts walls. */
export function resolveOpenings(walls: readonly Wall[], entrances: readonly Entrance[]): Opening[] {
  const result: Opening[] = [];
  for (const entrance of entrances) {
    if (!["door", "window", "opening"].includes(entrance.type)) continue;
    const candidates = walls.filter(w => !entrance.wallId || entrance.wallId === w.id)
      .map(wall => ({ wall, hit: distanceToSegment(entrance.position, wall.start, wall.end) }))
      .filter(({ wall, hit }) => hit.distance <= positive(wall.thickness, 0.2) / 2 + 0.2)
      .sort((a, b) => a.hit.distance - b.hit.distance);
    const candidate = candidates[0];
    if (!candidate) continue;
    const { wall, hit } = candidate;
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    if (length < 0.01) continue;
    const center = Math.hypot(hit.point.x - wall.start.x, hit.point.y - wall.start.y);
    const width = positive(entrance.width, entrance.type === "window" ? 1.2 : 0.9);
    const wallHeight = positive(wall.height, 2.4);
    const bottom = entrance.type === "window" ? Math.max(0, finite(entrance.sillHeight, 0.9)) : 0;
    const top = Math.min(wallHeight, bottom + positive(entrance.height, entrance.type === "window" ? 1.2 : 2.1));
    const from = Math.max(0, center - width / 2), to = Math.min(length, center + width / 2);
    if (top > bottom && to - from > 0.01) result.push({ entrance, wall, from, to, bottom, top });
  }
  return result;
}

export interface WallPanel { from: number; to: number; bottom: number; top: number }

/** Sweep opening boundaries and subtract the union of vertical intervals, retaining sills and lintels. */
export function wallPanels(length: number, height: number, openings: readonly Opening[]): WallPanel[] {
  const cuts = [...new Set([0, length, ...openings.flatMap(o => [o.from, o.to])])].sort((a, b) => a - b);
  const panels: WallPanel[] = [];
  for (let i = 1; i < cuts.length; i++) {
    const from = cuts[i - 1]!, to = cuts[i]!;
    if (to - from < 0.0001) continue;
    const intervals = openings.filter(o => o.from < to && o.to > from).sort((a, b) => a.bottom - b.bottom);
    let cursor = 0;
    for (const opening of intervals) {
      if (opening.bottom > cursor) panels.push({ from, to, bottom: cursor, top: opening.bottom });
      cursor = Math.max(cursor, opening.top);
    }
    if (cursor < height) panels.push({ from, to, bottom: cursor, top: height });
  }
  return panels;
}

function box(group: THREE.Group, width: number, height: number, depth: number,
  x: number, y: number, z: number, color: number, glass = false): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshStandardMaterial({
    color, roughness: glass ? 0.15 : 0.7, transparent: glass, opacity: glass ? 0.32 : 1,
    depthWrite: !glass,
  }));
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function openingModel(opening: Opening): THREE.Group {
  const group = new THREE.Group();
  const { entrance, from, to, top, bottom, wall } = opening;
  const width = to - from, height = top - bottom;
  const frame = Math.min(0.06, width / 8, height / 8), depth = positive(wall.thickness, 0.2) + 0.025;
  if (entrance.type === "opening") return group;
  const color = 0xe4e0d8;
  box(group, frame, height, depth, -width / 2 + frame / 2, bottom + height / 2, 0, color);
  box(group, frame, height, depth, width / 2 - frame / 2, bottom + height / 2, 0, color);
  box(group, width, frame, depth, 0, top - frame / 2, 0, color);
  if (entrance.type === "window") {
    box(group, width, frame, depth, 0, bottom + frame / 2, 0, color);
    box(group, frame, height - 2 * frame, depth * 0.6, 0, bottom + height / 2, 0, color);
    box(group, width - 2 * frame, height - 2 * frame, 0.02, 0, bottom + height / 2, 0, 0x9cd8ea, true);
  } else {
    const hinge = new THREE.Group();
    hinge.position.set(-width / 2 + frame, bottom, 0);
    hinge.rotation.y = THREE.MathUtils.degToRad(finite(entrance.doorOpenAngle, 35));
    group.add(hinge);
    const leafWidth = width - 2 * frame;
    box(hinge, leafWidth, height - frame, 0.04, leafWidth / 2, (height - frame) / 2, 0, 0xb68b60);
    box(hinge, 0.08, 0.025, 0.08, Math.max(0.04, leafWidth - 0.1), Math.min(1, height / 2), 0.04, 0x555555);
  }
  return group;
}

export function buildArchitecture(walls: readonly Wall[], entrances: readonly Entrance[]): { walls: THREE.Group; elements: THREE.Group } {
  const wallGroup = new THREE.Group(), elements = new THREE.Group();
  const openings = resolveOpenings(walls, entrances);
  for (const wall of walls) {
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    if (length < 0.01) continue;
    const group = new THREE.Group();
    group.position.set(wall.start.x, 0, -wall.start.y);
    group.rotation.y = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
    const thickness = positive(wall.thickness, 0.2), height = positive(wall.height, 2.4);
    const own = openings.filter(o => o.wall === wall);
    const panels = wallPanels(length, height, own);
    const joined = (point: Point) => walls.some(other => other !== wall && [other.start, other.end]
      .some(p => Math.hypot(p.x - point.x, p.y - point.y) < 0.01));
    for (const panel of panels) {
      const from = panel.from === 0 && joined(wall.start) ? -thickness / 2 : panel.from;
      const to = panel.to === length && joined(wall.end) ? length + thickness / 2 : panel.to;
      box(group, to - from, panel.top - panel.bottom, thickness, (from + to) / 2, (panel.top + panel.bottom) / 2, 0, 0xb8b8c0);
    }
    for (const opening of own) {
      const model = openingModel(opening);
      model.position.x = (opening.from + opening.to) / 2;
      group.add(model);
    }
    wallGroup.add(group);
  }
  const attached = new Set(openings.map(o => o.entrance.id));
  for (const entrance of entrances) {
    if (attached.has(entrance.id)) continue;
    const group = new THREE.Group();
    group.position.set(entrance.position.x, 0, -entrance.position.y);
    group.rotation.y = THREE.MathUtils.degToRad(finite(entrance.rotation, 0));
    const width = positive(entrance.width, 1.2), height = positive(entrance.height, 3), depth = positive(entrance.depth, 4);
    if (entrance.type === "stairs" || entrance.type === "escalator") {
      const count = Math.min(200, Math.max(2, Math.round(positive(entrance.stepCount, Math.ceil(height / 0.18)))));
      const landing = Math.min(depth * 0.5, Math.max(0, finite(entrance.landingDepth, 0.8)));
      const tread = (depth - landing) / count;
      for (let i = 0; i < count; i++) {
        const rise = height * (i + 1) / count;
        box(group, tread, rise, width, -depth / 2 + tread * (i + 0.5), rise / 2, 0, i % 2 ? 0xb8b5af : 0xc8c5bf);
      }
      if (landing > 0) box(group, landing, height, width, depth / 2 - landing / 2, height / 2, 0, 0xc8c5bf);
    } else if (entrance.type === "elevator") {
      box(group, width, 0.08, depth, 0, 0.04, 0, 0x9a9da0);
      box(group, width / 2 - 0.01, 2.1, 0.06, -width / 4, 1.05, -depth / 2, 0xaab2b8);
      box(group, width / 2 - 0.01, 2.1, 0.06, width / 4, 1.05, -depth / 2, 0xaab2b8);
    } else {
      // An unattached element remains visible as its real type, without inventing a wall.
      const wall: Wall = { id: "", floorId: entrance.floorId, start: { x: 0, y: 0 }, end: { x: width, y: 0 }, thickness: 0.15 };
      const bottom = entrance.type === "window" ? Math.max(0, finite(entrance.sillHeight, 0.9)) : 0;
      const model = openingModel({ entrance, wall, from: 0, to: positive(entrance.width, entrance.type === "window" ? 1.2 : 0.9), bottom,
        top: bottom + positive(entrance.height, entrance.type === "window" ? 1.2 : 2.1) });
      group.add(model);
    }
    elements.add(group);
  }
  return { walls: wallGroup, elements };
}

/** Clip the actual footprint into strips, so stair geometry stays inside its space polygon. */
export function stairSpaceGeometry(space: Space): THREE.BufferGeometry[] {
  const angle = THREE.MathUtils.degToRad(finite(space.stairDirection, 0));
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const projection = (p: Point) => p.x * ux + p.y * uy;
  const values = space.polygon.map(projection), min = Math.min(...values), max = Math.max(...values);
  const count = Math.min(200, Math.max(2, Math.round(positive(space.stairSteps, Math.ceil(positive(space.height, 3) / 0.18)))));
  const clip = (polygon: Point[], boundary: number, greater: boolean): Point[] => {
    const result: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
      const da = projection(a) - boundary, db = projection(b) - boundary;
      const insideA = greater ? da >= 0 : da <= 0, insideB = greater ? db >= 0 : db <= 0;
      if (insideA) result.push(a);
      if (insideA !== insideB) {
        const t = da / (da - db);
        result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return result;
  };
  const geometries: THREE.BufferGeometry[] = [];
  if (max - min < 0.01) return geometries;
  for (let i = 0; i < count; i++) {
    const polygon = clip(clip(space.polygon, min + (max - min) * i / count, true), min + (max - min) * (i + 1) / count, false);
    if (polygon.length < 3) continue;
    const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(polygon.map(p => new THREE.Vector2(p.x, p.y))), {
      depth: positive(space.height, 3) * (i + 1) / count, bevelEnabled: false,
    });
    geometry.rotateX(-Math.PI / 2);
    geometries.push(geometry);
  }
  return geometries;
}
