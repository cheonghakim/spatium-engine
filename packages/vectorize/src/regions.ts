import type { BinaryImage } from "./binarize.js";
import type { PixelPoint } from "./buildGraph.js";

/**
 * Region-based reading of a plan: instead of looking for straight strokes and
 * hoping they close into rooms, start from the open floor itself. Rooms are
 * the wide white areas; wall cavities, stair treads and paving are too narrow
 * to hold a room; walls are whatever separates a room from the next region.
 * Works at any wall angle and does not care whether a line wobbles.
 */
export interface RegionOptions {
  /** Half the widest band that is still "inside a wall" (px): cavity between face lines, tread spacing, paving. */
  wallHalfPx: number;
  /** Half the widest doorway (px). Rooms joined by a narrower passage are split there. */
  doorHalfPx: number;
  minRoomAreaPx: number;
  /** Enclosed non-floor areas at least this large (stair cores, shafts, courts) are cut out of the room. */
  minHoleAreaPx: number;
  maxWallThicknessPx: number;
  minWallThicknessPx: number;
  minWallLengthPx: number;
  /** Outline simplification tolerance (px). */
  simplifyPx: number;
  /**
   * Every drawn line, when `image` holds only the heavy ones (see
   * `structuralInk`). Where a wall is drawn too faintly to be structure the
   * outside runs into the building; the fine lines show how far the room goes.
   */
  detail?: BinaryImage;
}

export interface RegionRoom {
  /** Opens straight onto the outside somewhere along its outline — needs a look. */
  exposed?: boolean;
  /** Outline along the wall faces, in pixel-corner coordinates. */
  polygon: PixelPoint[];
  holes: PixelPoint[][];
  areaPx: number;
}

export interface RegionWall {
  start: PixelPoint;
  end: PixelPoint;
  thicknessPx: number;
}

export interface RegionResult {
  rooms: RegionRoom[];
  walls: RegionWall[];
}

/**
 * On a CAD plot the walls are drawn heavy and everything else — grid lines,
 * dimensions, furniture, hatching — in hairlines that cut rooms into pieces.
 * When a good share of the ink is heavy, only the heavy strokes are structure.
 * Hairlines that carry a wall on across a gap — a window drawn in the wall —
 * stay, or every window would open the room to the outside. A plan drawn in
 * one line weight (a pencil drawing, a thin-line scan) is returned unchanged.
 */
export function structuralInk(image: BinaryImage, maxOpeningPx: number): BinaryImage {
  const { width: w, height: h, ink } = image;
  // Stroke thickness at a pixel: the shorter of the ink runs through it.
  const across = new Uint16Array(w * h).fill(65535);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w;) {
      if (!ink[y * w + x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < w && ink[y * w + end]) end++;
      for (let k = x; k < end; k++) across[y * w + k] = end - x;
      x = end;
    }
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h;) {
      if (!ink[y * w + x]) {
        y++;
        continue;
      }
      let end = y;
      while (end < h && ink[end * w + x]) end++;
      for (let k = y; k < end; k++) if (end - y < across[k * w + x]!) across[k * w + x] = end - y;
      y = end;
    }
  let total = 0,
    heavy = 0;
  for (let i = 0; i < ink.length; i++)
    if (ink[i]) {
      total++;
      if (across[i]! >= 3) heavy++;
    }
  if (!total || heavy < 0.3 * total) return image;
  const kept = new Uint8Array(ink.length);
  for (let i = 0; i < ink.length; i++) kept[i] = ink[i] && across[i]! >= 3 ? 1 : 0;

  // Heavy strokes running along a row (or column) are walls in that direction;
  // a hairline between two of them, in line with both, bridges an opening.
  const runs = (horizontal: boolean) => {
    const length = new Uint16Array(w * h);
    const outer = horizontal ? h : w,
      inner = horizontal ? w : h;
    const at = (o: number, i: number) => (horizontal ? o * w + i : i * w + o);
    for (let o = 0; o < outer; o++)
      for (let i = 0; i < inner;) {
        if (!kept[at(o, i)]) {
          i++;
          continue;
        }
        let end = i;
        while (end < inner && kept[at(o, end)]) end++;
        for (let k = i; k < end; k++) length[at(o, k)] = end - i;
        i = end;
      }
    return length;
  };
  const rowRun = runs(true),
    columnRun = runs(false);
  const bridged = new Uint8Array(ink.length);
  for (const horizontal of [true, false]) {
    const outer = horizontal ? h : w,
      inner = horizontal ? w : h;
    const at = (o: number, i: number) => (horizontal ? o * w + i : i * w + o);
    const wall = (p: number) =>
      kept[p] === 1 &&
      (horizontal ? rowRun[p]! >= 3 * columnRun[p]! : columnRun[p]! >= 3 * rowRun[p]!);
    const before = new Int32Array(inner);
    for (let o = 0; o < outer; o++) {
      let last = -1e9;
      for (let i = 0; i < inner; i++) {
        if (wall(at(o, i))) last = i;
        before[i] = last;
      }
      let next = 1e9;
      for (let i = inner - 1; i >= 0; i--) {
        const p = at(o, i);
        if (wall(p)) next = i;
        if (ink[p] && !kept[p] && next - before[i]! <= maxOpeningPx) bridged[p] = 1;
      }
    }
  }
  for (let i = 0; i < ink.length; i++) if (bridged[i]) kept[i] = 1;
  return { width: w, height: h, ink: kept };
}

/** Distance (px) from every pixel to the nearest ink pixel (two-pass chamfer). */
function distanceToInk(image: BinaryImage): Float32Array {
  const { width: w, height: h, ink } = image;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = ink[i] ? 0 : 1e9;
  const relax = (i: number, j: number, cost: number) => {
    if (d[j]! + cost < d[i]!) d[i] = d[j]! + cost;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) relax(i, i - 1, 1);
      if (y > 0) {
        relax(i, i - w, 1);
        if (x > 0) relax(i, i - w - 1, Math.SQRT2);
        if (x < w - 1) relax(i, i - w + 1, Math.SQRT2);
      }
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) relax(i, i + 1, 1);
      if (y < h - 1) {
        relax(i, i + w, 1);
        if (x < w - 1) relax(i, i + w + 1, Math.SQRT2);
        if (x > 0) relax(i, i + w - 1, Math.SQRT2);
      }
    }
  return d;
}

interface Component {
  pixels: number[];
  border: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 4-connected components of the pixels where `member` is 1. */
function components(w: number, h: number, member: Uint8Array): Component[] {
  const seen = new Uint8Array(member.length);
  const result: Component[] = [];
  for (let s = 0; s < member.length; s++) {
    if (!member[s] || seen[s]) continue;
    const c: Component = { pixels: [s], border: false, minX: w, maxX: 0, minY: h, maxY: 0 };
    seen[s] = 1;
    for (let k = 0; k < c.pixels.length; k++) {
      const i = c.pixels[k]!;
      const x = i % w,
        y = (i - x) / w;
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.border = true;
      const visit = (j: number) => {
        if (member[j] && !seen[j]) {
          seen[j] = 1;
          c.pixels.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    result.push(c);
  }
  return result;
}

/**
 * Follows the boundary of a 4-connected pixel set clockwise (set on the right
 * hand), starting at the top-left corner of its first pixel in raster order.
 * Returns the corners where the direction changes.
 */
function traceContour(
  inside: (x: number, y: number) => boolean,
  startX: number,
  startY: number,
): PixelPoint[] {
  const DX = [1, 0, -1, 0],
    DY = [0, 1, 0, -1];
  // Pixel ahead on the right / on the left of a corner, per heading (right, down, left, up).
  const FR = [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, -1],
  ] as const;
  const FL = [
    [0, -1],
    [0, 0],
    [-1, 0],
    [-1, -1],
  ] as const;
  const points: PixelPoint[] = [];
  let x = startX,
    y = startY,
    d = 0;
  for (let guard = 0; guard < 50_000_000; guard++) {
    let next = d;
    if (!inside(x + FR[d]![0], y + FR[d]![1])) next = (d + 1) % 4;
    else if (inside(x + FL[d]![0], y + FL[d]![1])) next = (d + 3) % 4;
    if (next !== d || points.length === 0) points.push({ x, y });
    d = next;
    x += DX[d]!;
    y += DY[d]!;
    if (x === startX && y === startY) break;
  }
  return points;
}

function distanceToLine(p: PixelPoint, a: PixelPoint, b: PixelPoint): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function simplifyChain(points: PixelPoint[], tolerance: number): PixelPoint[] {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let worst = -1,
      worstDistance = tolerance;
    for (let i = from + 1; i < to; i++) {
      const distance = distanceToLine(points[i]!, points[from]!, points[to]!);
      if (distance > worstDistance) {
        worst = i;
        worstDistance = distance;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([from, worst], [worst, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Douglas–Peucker on a closed outline. */
export function simplifyRing(points: PixelPoint[], tolerance: number): PixelPoint[] {
  if (points.length < 4) return points;
  let far = 0,
    farDistance = -1;
  points.forEach((p, i) => {
    const distance = Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y);
    if (distance > farDistance) {
      far = i;
      farDistance = distance;
    }
  });
  const first = simplifyChain(points.slice(0, far + 1), tolerance);
  const second = simplifyChain([...points.slice(far), points[0]!], tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function ringArea(points: readonly PixelPoint[]): number {
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!;
    sum += p.x * q.y - q.x * p.y;
  });
  return Math.abs(sum) / 2;
}

/**
 * Straightens a traced outline. A region's edge follows every pixel of a
 * sketchy or anti-aliased line, so even after simplification a straight wall
 * face comes out as a run of slightly tilted pieces. Edges within 15° of
 * horizontal or vertical are made exactly so, runs of them that differ by
 * less than `jog` become one edge, and corners are rebuilt where the edges
 * meet. Slanted and curved stretches are left as traced — except a cut
 * across a square corner no longer than `chamfer`: that is the outline going
 * round a door swing, a shaft symbol or a fixture standing in the corner, and
 * the corner is put back.
 */
export function rectifyRing(points: PixelPoint[], jog: number, chamfer = 0): PixelPoint[] {
  if (points.length < 4) return points;
  type Edge = { kind: "h" | "v" | "d"; at: number; a: PixelPoint; b: PixelPoint; length: number };
  let edges: Edge[] = [];
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length]!;
    const dx = Math.abs(b.x - a.x),
      dy = Math.abs(b.y - a.y);
    const length = Math.hypot(dx, dy);
    if (!length) return;
    const kind = dy <= dx * 0.27 ? "h" : dx <= dy * 0.27 ? "v" : "d";
    edges.push({ kind, at: kind === "h" ? (a.y + b.y) / 2 : (a.x + b.x) / 2, a, b, length });
  });

  // Tiny pieces are noise between the edges either side of them.
  for (let i = 0; i < edges.length && edges.length > 4;) {
    const edge = edges[i]!;
    if (edge.length >= jog) {
      i++;
      continue;
    }
    const middle = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
    edges[(i + edges.length - 1) % edges.length]!.b = middle;
    edges[(i + 1) % edges.length]!.a = middle;
    edges.splice(i, 1);
  }
  // Runs of the same direction on (nearly) the same line are one edge.
  for (let changed = true; changed && edges.length > 3;) {
    changed = false;
    for (let i = 0; i < edges.length && edges.length > 3; i++) {
      const edge = edges[i]!,
        next = edges[(i + 1) % edges.length]!;
      if (edge.kind === "d" || edge.kind !== next.kind || Math.abs(edge.at - next.at) > jog)
        continue;
      edge.at = (edge.at * edge.length + next.at * next.length) / (edge.length + next.length);
      edge.length += next.length;
      edge.b = next.b;
      edges.splice((i + 1) % edges.length, 1);
      changed = true;
      break;
    }
  }
  // Square corners cut short by whatever stands in them.
  for (let i = 0; chamfer > 0 && i < edges.length;) {
    let run = 0;
    while (run < edges.length && edges[(i + run) % edges.length]!.kind === "d") run++;
    const before = edges[(i + edges.length - 1) % edges.length]!,
      after = edges[(i + run) % edges.length]!;
    if (
      !run ||
      edges.length - run < 4 ||
      before.kind === "d" ||
      after.kind === "d" ||
      before.kind === after.kind ||
      Math.hypot(after.a.x - before.b.x, after.a.y - before.b.y) > chamfer
    ) {
      i += Math.max(1, run);
      continue;
    }
    const corner =
      before.kind === "h" ? { x: after.at, y: before.at } : { x: before.at, y: after.at };
    before.b = corner;
    after.a = corner;
    const first = i % edges.length;
    const tail = Math.min(run, edges.length - first);
    edges.splice(first, tail);
    edges.splice(0, run - tail);
    i = 0;
  }
  // A real step between two parallel edges needs its riser back.
  const stepped: Edge[] = [];
  edges.forEach((edge, i) => {
    stepped.push(edge);
    const next = edges[(i + 1) % edges.length]!;
    if (edge.kind !== "d" && edge.kind === next.kind)
      stepped.push({
        kind: edge.kind === "h" ? "v" : "h",
        at: edge.kind === "h" ? edge.b.x : edge.b.y,
        a: edge.b,
        b: next.a,
        length: Math.abs(edge.at - next.at),
      });
  });
  edges = stepped;

  // Corners: where consecutive edges' lines cross — unless that lands far from
  // where the outline actually turned (near-parallel edges), then keep the turn.
  const line = (edge: Edge) =>
    edge.kind === "h"
      ? { px: edge.a.x, py: edge.at, dx: 1, dy: 0 }
      : edge.kind === "v"
        ? { px: edge.at, py: edge.a.y, dx: 0, dy: 1 }
        : { px: edge.a.x, py: edge.a.y, dx: edge.b.x - edge.a.x, dy: edge.b.y - edge.a.y };
  const result: PixelPoint[] = [];
  edges.forEach((edge, i) => {
    const next = edges[(i + 1) % edges.length]!;
    const turn = { x: (edge.b.x + next.a.x) / 2, y: (edge.b.y + next.a.y) / 2 };
    if (edge.kind === "d" && next.kind === "d") {
      result.push(turn);
      return;
    }
    const p = line(edge),
      q = line(next);
    const cross = p.dx * q.dy - p.dy * q.dx;
    if (Math.abs(cross) > 1e-6 * Math.hypot(p.dx, p.dy) * Math.hypot(q.dx, q.dy)) {
      const t = ((q.px - p.px) * q.dy - (q.py - p.py) * q.dx) / cross;
      const corner = { x: p.px + p.dx * t, y: p.py + p.dy * t };
      if (Math.hypot(corner.x - turn.x, corner.y - turn.y) <= 3 * jog) {
        result.push(corner);
        return;
      }
    }
    result.push(turn);
  });
  const clean = result.filter((p, i) => {
    const q = result[(i + result.length - 1) % result.length]!;
    return Math.hypot(p.x - q.x, p.y - q.y) > 0.5;
  });
  // A spike — out and straight back, as where a door leaf pokes into the room — is not a corner.
  for (let i = 0; i < clean.length && clean.length > 4;) {
    const before = clean[(i + clean.length - 1) % clean.length]!,
      after = clean[(i + 1) % clean.length]!;
    if (Math.hypot(after.x - before.x, after.y - before.y) <= 1.5 * jog) clean.splice(i, 1);
    else i++;
  }
  // Never trade a correct outline for a tidy wrong one.
  const before = ringArea(points);
  return clean.length >= 3 && Math.abs(ringArea(clean) - before) <= 0.1 * before ? clean : points;
}

/**
 * Splits indoor regions at doorways left open. A region pinches wherever it
 * gets narrower than a door — at doorways, but also between a table and the
 * wall. A doorway is the pinch that sits in a wall: carrying its line on past
 * either end runs inside a wall, with one side of the doorway on each face.
 * Returns the next free label.
 */
function splitAtDoorways(
  labels: Int32Array,
  dist: Float32Array,
  w: number,
  h: number,
  next: number,
  options: Pick<RegionOptions, "wallHalfPx" | "doorHalfPx">,
): number {
  const n = w * h;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = labels[i]! >= 1 && dist[i]! > options.doorHalfPx ? 1 : 0;
  const cores = components(w, h, mask);
  if (cores.length < 2) return next;
  const part = new Int32Array(n).fill(-1);
  const queue: number[] = [];
  cores.forEach((core, id) => {
    for (const p of core.pixels) {
      part[p] = id;
      queue.push(p);
    }
  });
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k]!;
    const x = i % w,
      y = (i - x) / w;
    const visit = (j: number) => {
      if (part[j]! < 0 && labels[j] === labels[i]) {
        part[j] = part[i]!;
        queue.push(j);
      }
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y < h - 1) visit(i + w);
  }

  // Where two parts of one region meet: the pinches.
  const seams = new Map<string, number[]>();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (part[i]! < 0) continue;
      for (const j of [x < w - 1 ? i + 1 : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0 || part[j]! < 0 || part[j] === part[i] || labels[j] !== labels[i]) continue;
        const key = `${Math.min(part[i]!, part[j]!)}:${Math.max(part[i]!, part[j]!)}`;
        const list = seams.get(key) ?? [];
        if (!list.length) seams.set(key, list);
        list.push(i);
      }
    }

  const reach = options.wallHalfPx * 3 + options.doorHalfPx;
  const partAt = (px: number, py: number): number => {
    const x = Math.round(px),
      y = Math.round(py);
    return x < 0 || y < 0 || x >= w || y >= h ? -1 : part[y * w + x]!;
  };
  /** Past the end of a pinch, heading (ux,uy): inside a wall with `a` on one face and `b` on the other? */
  const inWall = (ex: number, ey: number, ux: number, uy: number, a: number, b: number) => {
    // Lengthwise inside the wall for a good stretch, not clipping the tip of one at an angle.
    let tried = 0,
      passed = 0;
    for (let d = options.wallHalfPx + 3; d <= options.wallHalfPx * 2.5 + 3; d += 2) {
      const qx = ex + ux * d,
        qy = ey + uy * d;
      tried++;
      if (partAt(qx, qy) >= 0) continue;
      const side = (sign: number): number => {
        for (let s = 1; s <= reach; s++) {
          const found = partAt(qx - uy * s * sign, qy + ux * s * sign);
          if (found >= 0) return found;
        }
        return -1;
      };
      const one = side(1),
        other = side(-1);
      if ((one === a && other === b) || (one === b && other === a)) passed++;
    }
    return passed >= Math.max(3, 0.7 * tried);
  };

  // Close each doorway with a straight line from jamb to jamb; the watershed
  // seam itself wanders wherever the two fronts happened to meet.
  const cut = new Set<number>();
  for (const [key, pixels] of seams) {
    const [a, b] = key.split(":").map(Number) as [number, number];
    const member = new Set(pixels);
    const seen = new Set<number>();
    for (const start of pixels) {
      if (seen.has(start)) continue;
      seen.add(start);
      const group = [start];
      for (let k = 0; k < group.length; k++) {
        const i = group[k]!;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const j = i + dy * w + dx;
            if (member.has(j) && !seen.has(j)) {
              seen.add(j);
              group.push(j);
            }
          }
      }
      let minX = w,
        maxX = 0,
        minY = h,
        maxY = 0;
      for (const i of group) {
        const x = i % w,
          y = (i - x) / w;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      // The two ends of the pinch: its extreme pixels along the longer axis.
      const wide = maxX - minX >= maxY - minY;
      const along = (i: number) => (wide ? i % w : Math.floor(i / w));
      let first = group[0]!,
        last = group[0]!;
      for (const i of group) {
        if (along(i) < along(first)) first = i;
        if (along(i) > along(last)) last = i;
      }
      const fx = first % w,
        fy = Math.floor(first / w),
        lx = last % w,
        ly = Math.floor(last / w);
      const length = Math.hypot(lx - fx, ly - fy);
      if (length < 2 || length > options.doorHalfPx * 3) continue;
      const ux = (lx - fx) / length,
        uy = (ly - fy) / length;
      if (!inWall(lx, ly, ux, uy, a, b) && !inWall(fx, fy, -ux, -uy, a, b)) continue;
      const region = labels[first]!;
      const overshoot = options.wallHalfPx + 3;
      for (let s = -overshoot; s <= length + overshoot; s += 0.5)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const x = Math.round(fx + ux * s) + dx,
              y = Math.round(fy + uy * s) + dy;
            if (x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === region)
              cut.add(y * w + x);
          }
    }
  }
  if (!cut.size) return next;
  for (const i of cut) labels[i] = -1;

  // What the cuts separated: the largest piece of each region keeps its label.
  for (let i = 0; i < n; i++) mask[i] = labels[i]! >= 1 ? 1 : 0;
  const pieces = components(w, h, mask).sort((p, q) => q.pixels.length - p.pixels.length);
  const taken = new Set<number>();
  for (const piece of pieces) {
    const region = labels[piece.pixels[0]!]!;
    if (!taken.has(region)) {
      taken.add(region);
      continue;
    }
    for (const p of piece.pixels) labels[p] = next;
    next++;
  }
  return next;
}

/**
 * Labels every pixel: 0 = outside the building, 1.. = a room, -1 = neither
 * (ink, wall cavities, stairs, paving, small leftovers).
 */
export function labelRegions(
  image: BinaryImage,
  options: Pick<RegionOptions, "wallHalfPx" | "doorHalfPx" | "minRoomAreaPx">,
): { labels: Int32Array; roomCount: number } {
  const { width: w, height: h } = image;
  const n = w * h;
  // A scan's dark rim is not a line of the drawing: it would close off whatever touches the sheet edge.
  const ink = new Uint8Array(image.ink);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) ink[y * w + x] = 0;
  const dist = distanceToInk({ width: w, height: h, ink });
  const labels = new Int32Array(n).fill(-1);
  let next = 2;

  // Cores: floor further from any line than half a doorway. A core reaching
  // the image edge (or filling a sheet frame) is outside, the rest is indoors;
  // an open exterior door is too narrow for the two to merge through.
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = dist[i]! > options.doorHalfPx ? 1 : 0;
  for (const core of components(w, h, mask)) {
    const frame = core.maxX - core.minX >= 0.8 * w && core.maxY - core.minY >= 0.8 * h;
    const id = core.border || frame ? 0 : 1;
    for (const p of core.pixels) labels[p] = id;
  }

  // Grow both through floor wider than a wall cavity; they meet in exterior doorways.
  const open = (i: number) => dist[i]! > options.wallHalfPx;
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (labels[i]! >= 0) queue.push(i);
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k]!;
    const x = i % w,
      y = (i - x) / w;
    const visit = (j: number) => {
      if (labels[j]! < 0 && open(j)) {
        labels[j] = labels[i]!;
        queue.push(j);
      }
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y < h - 1) visit(i + w);
  }

  // Wide areas no core reached: too narrow for a core of their own (a closet)
  // or closed off by a thin line (furniture, a door swing).
  for (let i = 0; i < n; i++) mask[i] = labels[i]! < 0 && open(i) ? 1 : 0;
  // At the very edge of the sheet (scan speckle can keep it off the border itself) it is outside.
  const margin = options.wallHalfPx;
  const leftovers = components(w, h, mask).filter((area) => {
    const edge =
      area.border ||
      area.minX <= margin ||
      area.minY <= margin ||
      area.maxX >= w - 1 - margin ||
      area.maxY >= h - 1 - margin;
    if (edge) for (const p of area.pixels) labels[p] = 0;
    return !edge;
  });

  // Indoor floor joined through open doorways is one room; a door drawn with
  // its leaf and swing closes a room off.
  for (let i = 0; i < n; i++) mask[i] = labels[i] === 1 ? 1 : 0;
  for (const room of components(w, h, mask)) {
    for (const p of room.pixels) labels[p] = next;
    next++;
  }
  next = splitAtDoorways(labels, dist, w, h, next, options);

  const reach = Math.round(2 * options.wallHalfPx + Math.max(5, 0.5 * options.wallHalfPx));
  const depth = new Int32Array(n).fill(-1);
  const decisions: Array<{ pixels: number[]; label: number }> = [];
  for (const area of leftovers) {
    // What lies just across the area's outline: a single line away means the
    // same room continues there (furniture); a wall away means it does not.
    const votes = new Map<number, number>();
    let shell = 0;
    const visited = [...area.pixels];
    for (const p of visited) depth[p] = 0;
    for (let k = 0; k < visited.length; k++) {
      const i = visited[k]!;
      const at = depth[i]!;
      if (at >= reach - 2 && at > 0) {
        shell++;
        if (labels[i]! >= 0) votes.set(labels[i]!, (votes.get(labels[i]!) ?? 0) + 1);
      }
      if (at >= reach) continue;
      const x = i % w,
        y = (i - x) / w;
      const visit = (j: number) => {
        if (depth[j]! < 0) {
          depth[j] = at + 1;
          visited.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    for (const p of visited) depth[p] = -1;
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const best = ranked[0],
      second = ranked[1];
    if (best && best[1] >= 0.25 * shell && (!second || second[1] < 0.1 * shell))
      decisions.push({ pixels: area.pixels, label: best[0] });
    else if (area.pixels.length >= 0.4 * options.minRoomAreaPx)
      decisions.push({ pixels: area.pixels, label: next++ });
  }
  for (const { pixels, label } of decisions) for (const p of pixels) labels[p] = label;

  // Out to the wall faces: floor within reach of a region joins it, without
  // crossing a line (so a region also fills its square corners).
  const limit = Math.ceil(options.wallHalfPx) + 2;
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) if (labels[i]! >= 0) frontier.push(i);
  for (let round = 0; round < limit && frontier.length; round++) {
    const grown: number[] = [];
    for (const i of frontier) {
      const x = i % w,
        y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (labels[j]! >= 0 || ink[j]) continue;
          // No slipping diagonally between two ink pixels of a thin slanted line.
          if (dx && dy && ink[y * w + xx] && ink[yy * w + x]) continue;
          labels[j] = labels[i]!;
          grown.push(j);
        }
    }
    frontier = grown;
  }

  return { labels, roomCount: next - 1 };
}

/** First pixel in raster order (no spread: components run to millions of pixels). */
function firstPixel(pixels: readonly number[]): number {
  let first = Infinity;
  for (const p of pixels) if (p < first) first = p;
  return first;
}

/** Outline and large enclosed voids of each room label. */
function outlineRooms(
  labels: Int32Array,
  w: number,
  h: number,
  roomCount: number,
  options: RegionOptions,
): Array<RegionRoom & { label: number }> {
  const boxes = Array.from({ length: roomCount + 1 }, () => ({
    minX: w,
    maxX: -1,
    minY: h,
    maxY: -1,
    area: 0,
  }));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const label = labels[y * w + x]!;
      if (label < 1) continue;
      const box = boxes[label]!;
      box.area++;
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
    }

  const rooms: Array<RegionRoom & { label: number }> = [];
  for (let label = 1; label <= roomCount; label++) {
    const box = boxes[label]!;
    if (box.area < options.minRoomAreaPx) continue;
    const outline = bodyOutline(
      box.minX,
      box.minY,
      box.maxX,
      box.maxY,
      (x, y) => labels[y * w + x] === label,
      options.simplifyPx,
    );
    if (!outline) continue;
    const { body, local, lw, lh, trace } = outline;
    const jog = Math.max(4, options.wallHalfPx);
    const polygon = rectifyRing(outline.polygon, jog, 2 * options.doorHalfPx);

    // Enclosed areas that are not this room's floor: large ones are voids.
    const voids = new Uint8Array(lw * lh);
    for (const p of body.pixels) voids[p] = local[p] === 1 ? 0 : 1;
    const holes: PixelPoint[][] = [];
    let holeArea = 0;
    for (const hole of components(lw, lh, voids)) {
      if (hole.pixels.length < options.minHoleAreaPx) continue;
      const ring = rectifyRing(trace(hole.pixels), jog);
      if (ring.length >= 3) {
        holes.push(ring);
        holeArea += hole.pixels.length;
      }
    }
    rooms.push({ label, polygon, holes, areaPx: body.pixels.length - holeArea });
  }
  return rooms;
}

/** Distance (px) from every pixel to the nearest pixel where `source` is 1 (two-pass chamfer). */
function chamfer(source: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = source[i] ? 0 : 1e9;
  const relax = (i: number, j: number, cost: number) => {
    if (d[j]! + cost < d[i]!) d[i] = d[j]! + cost;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) relax(i, i - 1, 1);
      if (y > 0) {
        relax(i, i - w, 1);
        if (x > 0) relax(i, i - w - 1, Math.SQRT2);
        if (x < w - 1) relax(i, i - w + 1, Math.SQRT2);
      }
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) relax(i, i + 1, 1);
      if (y < h - 1) {
        relax(i, i + w, 1);
        if (x < w - 1) relax(i, i + w + 1, Math.SQRT2);
        if (x > 0) relax(i, i + w - 1, Math.SQRT2);
      }
    }
  return d;
}

/**
 * A room's floor runs to its walls, not to the toilet, the counter or the
 * door swing standing in front of them. Fills every dent in a room narrower
 * than `2 × radius` with that room — taking only pixels no other region owns,
 * so straight walls and neighbouring rooms are untouched.
 */
function closeRooms(
  labels: Int32Array,
  w: number,
  h: number,
  roomCount: number,
  radius: number,
  skip: Set<number>,
): void {
  const boxes = Array.from({ length: roomCount + 1 }, () => ({
    minX: w,
    maxX: -1,
    minY: h,
    maxY: -1,
  }));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const label = labels[y * w + x]!;
      if (label < 1) continue;
      const box = boxes[label]!;
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
    }
  const pad = Math.ceil(radius) + 2;
  for (let label = 1; label <= roomCount; label++) {
    const box = boxes[label]!;
    if (box.maxX < 0 || skip.has(label)) continue;
    const lw = box.maxX - box.minX + 1 + 2 * pad,
      lh = box.maxY - box.minY + 1 + 2 * pad;
    const inside = new Uint8Array(lw * lh);
    for (let y = box.minY; y <= box.maxY; y++)
      for (let x = box.minX; x <= box.maxX; x++)
        if (labels[y * w + x] === label)
          inside[(y - box.minY + pad) * lw + (x - box.minX + pad)] = 1;
    // Closing: grow by the radius, then shrink back by it.
    const grown = chamfer(inside, lw, lh);
    const beyond = new Uint8Array(lw * lh);
    for (let i = 0; i < beyond.length; i++) beyond[i] = grown[i]! > radius ? 1 : 0;
    const back = chamfer(beyond, lw, lh);
    for (let y = box.minY; y <= box.maxY; y++)
      for (let x = box.minX; x <= box.maxX; x++) {
        const local = (y - box.minY + pad) * lw + (x - box.minX + pad);
        if (!inside[local] && back[local]! > radius && labels[y * w + x]! < 0)
          labels[y * w + x] = label;
      }
  }
}

/**
 * Takes back floor the outside got into. A wall drawn faintly (a grey fill, a
 * hairline) is no barrier in the heavy-line image, so the outside spills into
 * the room behind it — toilet stalls, an alcove — and meets the room somewhere
 * in the middle. Such floor is cut into small cells by the fine lines, sits
 * next to the room with at most a fine line in between, and has structure or
 * the room itself close by on at least three sides. Those cells go to the room.
 */
function reclaimAlcoves(
  image: BinaryImage,
  detail: BinaryImage,
  labels: Int32Array,
  options: Pick<RegionOptions, "doorHalfPx">,
): void {
  const { width: w, height: h, ink } = image;
  if (detail.width !== w || detail.height !== h) return;
  const fine = (i: number) => detail.ink[i] === 1 && !ink[i];
  const n = w * h;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = labels[i] === 0 && !detail.ink[i] ? 1 : 0;
  const reach = Math.round(options.doorHalfPx * 6);
  let pending = components(w, h, mask).filter(
    (cell) => !cell.border && Math.max(cell.maxX - cell.minX, cell.maxY - cell.minY) < reach,
  );
  const steps: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const enclosed = (cell: Component): boolean => {
    const cx = (cell.minX + cell.maxX) >> 1,
      cy = (cell.minY + cell.maxY) >> 1;
    // One side may stand open: that is where the faint wall is.
    const shut = steps.filter(([dx, dy]) => {
      for (let s = 0; s <= reach; s++) {
        const x = cx + dx * s,
          y = cy + dy * s;
        if (x < 0 || y < 0 || x >= w || y >= h) return false;
        if (ink[y * w + x] || labels[y * w + x]! >= 1) return true;
      }
      return false;
    });
    return shut.length >= 3;
  };
  for (let pass = 0; pass < 64; pass++) {
    let changed = false;
    pending = pending.filter((cell) => {
      const votes = new Map<number, number>();
      for (const i of cell.pixels) {
        const x = i % w,
          y = (i - x) / w;
        for (const [dx, dy] of steps)
          for (let s = 1; s <= 3; s++) {
            const xx = x + dx * s,
              yy = y + dy * s;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) break;
            const j = yy * w + xx;
            if (labels[j]! >= 1) {
              votes.set(labels[j]!, (votes.get(labels[j]!) ?? 0) + 1);
              break;
            }
            if (!fine(j)) break;
          }
      }
      const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!best || best[1] < 3 || !enclosed(cell)) return true;
      for (const p of cell.pixels) labels[p] = best[0];
      changed = true;
      return false;
    });
    if (!changed) break;
  }
  // A fine line with the same room on both sides lies in that room; one with
  // a room on one side only is a drawn edge: the room does not open onto the outside there.
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? -1 : labels[y * w + x]!;
  const updates: Array<[number, number]> = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (labels[i] !== 0 || !fine(i)) continue;
      const side = (dx: number, dy: number): number => {
        for (let s = 1; s <= 2; s++) {
          const found = at(x + dx * s, y + dy * s);
          if (found >= 1) return found;
          if (found !== 0 || !fine((y + dy * s) * w + x + dx * s)) return -1;
        }
        return -1;
      };
      const left = side(-1, 0),
        right = side(1, 0),
        up = side(0, -1),
        down = side(0, 1);
      if (left >= 1 && left === right) updates.push([i, left]);
      else if (up >= 1 && up === down) updates.push([i, up]);
      else if (at(x - 1, y) >= 1 || at(x + 1, y) >= 1 || at(x, y - 1) >= 1 || at(x, y + 1) >= 1)
        updates.push([i, -1]);
    }
  for (const [i, label] of updates) labels[i] = label;
}

/** Rooms that open straight onto the outside (no line in between) somewhere along their edge. */
function exposedRooms(labels: Int32Array, w: number, h: number, roomCount: number): Set<number> {
  const contact = new Int32Array(roomCount + 1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const label = labels[y * w + x]!;
      if (label < 1) continue;
      if (
        (x > 0 && labels[y * w + x - 1] === 0) ||
        (x < w - 1 && labels[y * w + x + 1] === 0) ||
        (y > 0 && labels[(y - 1) * w + x] === 0) ||
        (y < h - 1 && labels[(y + 1) * w + x] === 0)
      )
        contact[label]!++;
    }
  const exposed = new Set<number>();
  contact.forEach((count, label) => {
    if (count >= 3) exposed.add(label);
  });
  return exposed;
}

/**
 * Closed cells that belong to no room — paving, exterior steps, the boxes
 * between dimension lines — are outside when they hang off the outside
 * without touching a room. The cavity of a wall touches a room, so it stays.
 */
function absorbOutsideCells(image: BinaryImage, labels: Int32Array, exposed: Set<number>): void {
  const { width: w, height: h, ink } = image;
  const n = w * h;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = labels[i]! < 0 && !ink[i] ? 1 : 0;
  const cells = components(w, h, mask);
  const cellOf = new Int32Array(n).fill(-1);
  cells.forEach((cell, id) => {
    for (const p of cell.pixels) cellOf[p] = id;
  });
  const stamp = new Int32Array(n).fill(-1);
  const info = cells.map((cell, id) => {
    // Across at most a few pixels of ink: what is on the other side of the lines around this cell?
    let room = false,
      outside = false;
    const neighbours = new Set<number>();
    let frontier = cell.pixels;
    for (let depth = 0; depth <= 4 && frontier.length; depth++) {
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % w,
          y = (i - x) / w;
        const visit = (j: number) => {
          if (stamp[j] === id) return;
          stamp[j] = id;
          if (ink[j]) next.push(j);
          else if (labels[j]! > 0 && !exposed.has(labels[j]!)) room = true;
          else if (labels[j]! >= 0) outside = true;
          else if (cellOf[j]! !== id) neighbours.add(cellOf[j]!);
        };
        if (x > 0) visit(i - 1);
        if (x < w - 1) visit(i + 1);
        if (y > 0) visit(i - w);
        if (y < h - 1) visit(i + w);
      }
      frontier = next;
    }
    return { room, outside, neighbours };
  });
  const done = new Uint8Array(cells.length);
  const queue: number[] = [];
  info.forEach((cell, id) => {
    if (cell.outside && !cell.room) {
      done[id] = 1;
      queue.push(id);
    }
  });
  for (let k = 0; k < queue.length; k++) {
    const id = queue[k]!;
    for (const p of cells[id]!.pixels) labels[p] = 0;
    for (const other of info[id]!.neighbours)
      if (!done[other] && !info[other]!.room) {
        done[other] = 1;
        queue.push(other);
      }
  }
}

/** For every pixel: the nearest labelled region and how far it is (two-pass chamfer). */
function nearestRegions(labels: Int32Array, w: number, h: number) {
  const n = w * h;
  const owner = new Int32Array(labels);
  const gap = new Float32Array(n);
  for (let i = 0; i < n; i++) gap[i] = labels[i]! >= 0 ? 0 : 1e9;
  const relax = (i: number, j: number, cost: number) => {
    if (gap[j]! + cost < gap[i]!) {
      gap[i] = gap[j]! + cost;
      owner[i] = owner[j]!;
    }
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) relax(i, i - 1, 1);
      if (y > 0) {
        relax(i, i - w, 1);
        if (x > 0) relax(i, i - w - 1, Math.SQRT2);
        if (x < w - 1) relax(i, i - w + 1, Math.SQRT2);
      }
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) relax(i, i + 1, 1);
      if (y < h - 1) {
        relax(i, i + w, 1);
        if (x < w - 1) relax(i, i + w + 1, Math.SQRT2);
        if (x > 0) relax(i, i + w - 1, Math.SQRT2);
      }
    }
  return { owner, gap };
}

interface Line {
  a: PixelPoint;
  b: PixelPoint;
  t: number;
}

type LabelledRoom = RegionRoom & { label: number };

/**
 * Walls are what lies between a room and the next region. Growing each room
 * to meet its neighbours halfway puts its outline on the wall centre lines —
 * at any angle, whether the wall is drawn filled or as two faces — and the
 * width of the gap there is the wall thickness. Where two regions touch with
 * nothing in between, there is an opening and no wall.
 */
function wallsBetweenRegions(
  labels: Int32Array,
  w: number,
  h: number,
  rooms: readonly LabelledRoom[],
  exposed: Set<number>,
  options: RegionOptions,
): { lines: Line[]; rooms: LabelledRoom[] } {
  const { owner, gap } = nearestRegions(labels, w, h);
  const cap = options.maxWallThicknessPx / 2 + 1;
  /** Region a pixel belongs to once every region has grown half a wall outward. */
  const cellAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    const i = y * w + x;
    return gap[i]! <= cap ? owner[i]! : -1;
  };
  const step = Math.max(3, options.minWallLengthPx / 4);
  // Thinner than this is a single drawn line (furniture, a dimension line), not a wall.
  const real = Math.max(3, options.minWallThicknessPx * 1.8);
  const slack = Math.ceil(options.simplifyPx * 1.5) + 2;

  const lines: Line[] = [];
  const kept: LabelledRoom[] = [];
  for (const room of rooms) {
    let minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    for (const p of room.polygon) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const outline = bodyOutline(
      Math.max(0, Math.floor(minX - cap - 2)),
      Math.max(0, Math.floor(minY - cap - 2)),
      Math.min(w - 1, Math.ceil(maxX + cap + 2)),
      Math.min(h - 1, Math.ceil(maxY + cap + 2)),
      (x, y) => cellAt(x, y) === room.label,
      options.simplifyPx * 1.5,
    )?.polygon;
    if (!outline) continue;

    /** Wall thickness where the outline passes (px,py), or null where it is not a wall. */
    const thicknessAt = (px: number, py: number, nx: number, ny: number): number | null => {
      let inside = -1;
      for (let s = -slack; s <= slack; s++) {
        const x = Math.floor(px + nx * s),
          y = Math.floor(py + ny * s);
        const cell = cellAt(x, y);
        if (cell === room.label) {
          inside = gap[y * w + x]!;
          continue;
        }
        if (inside < 0) continue;
        if (cell < 0) return null;
        const t = inside + gap[y * w + x]! + 1;
        return t >= real && t <= options.maxWallThicknessPx ? t : null;
      }
      return null;
    };

    const found: Line[] = [];
    let walled = 0,
      total = 0;
    outline.forEach((from, index) => {
      const to = outline[(index + 1) % outline.length]!;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (length < step) return;
      const ux = (to.x - from.x) / length,
        uy = (to.y - from.y) / length;
      // The outline runs clockwise with the room on its right: outward is to the left.
      const nx = uy,
        ny = -ux;
      const count = Math.max(1, Math.floor(length / step));
      const spacing = length / count;
      const samples: Array<number | null> = [];
      for (let k = 0; k < count; k++) {
        const at = (k + 0.5) * spacing;
        samples.push(thicknessAt(from.x + ux * at, from.y + uy * at, nx, ny));
      }
      total += count;
      walled += samples.filter((t) => t !== null).length;
      // One missed sample inside a run is a smudge, not an opening.
      for (let k = 1; k + 1 < count; k++)
        if (samples[k] === null && samples[k - 1] !== null && samples[k + 1] !== null)
          samples[k] = samples[k - 1]!;
      for (let k = 0; k < count;) {
        if (samples[k] === null) {
          k++;
          continue;
        }
        let end = k;
        while (end + 1 < count && samples[end + 1] !== null) end++;
        const run = samples.slice(k, end + 1) as number[];
        const start = k * spacing,
          stop = (end + 1) * spacing;
        k = end + 1;
        if (stop - start < options.minWallLengthPx) continue;
        found.push({
          a: { x: from.x + ux * start, y: from.y + uy * start },
          b: { x: from.x + ux * stop, y: from.y + uy * stop },
          t: [...run].sort((a, b) => a - b)[run.length >> 1]!,
        });
      }
    });
    // A room is enclosed largely by walls. Areas fenced in by single lines —
    // dimension strings, a site boundary — are not rooms.
    if (total && walled >= 0.4 * total) {
      // Open to the outside: a porch or terrace at best, possibly just the
      // space between the building and its dimension lines. Kept for review,
      // but it does not get walls of its own.
      const open = exposed.has(room.label);
      kept.push({ ...room, ...(open ? { exposed: true } : {}) });
      if (!open) lines.push(...found);
    }
  }
  return { lines, rooms: kept };
}

/**
 * Outline of the largest piece of a pixel set inside a box, with everything
 * that piece encloses filled in. Also returns the local raster it worked on.
 */
function bodyOutline(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  member: (x: number, y: number) => boolean,
  tolerance: number,
) {
  // Local raster with a 1 px margin: 1 = member, then 2 = reachable from outside.
  const lw = maxX - minX + 3,
    lh = maxY - minY + 3;
  const local = new Uint8Array(lw * lh);
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++)
      if (member(x, y)) local[(y - minY + 1) * lw + (x - minX + 1)] = 1;
  const outside = [0];
  local[0] = 2;
  for (let k = 0; k < outside.length; k++) {
    const i = outside[k]!;
    const x = i % lw,
      y = (i - x) / lw;
    const visit = (j: number) => {
      if (local[j] === 0) {
        local[j] = 2;
        outside.push(j);
      }
    };
    if (x > 0) visit(i - 1);
    if (x < lw - 1) visit(i + 1);
    if (y > 0) visit(i - lw);
    if (y < lh - 1) visit(i + lw);
  }
  const filled = new Uint8Array(lw * lh);
  for (let i = 0; i < filled.length; i++) filled[i] = local[i] === 2 ? 0 : 1;
  const body = components(lw, lh, filled).sort((a, b) => b.pixels.length - a.pixels.length)[0];
  if (!body) return null;
  const trace = (pixels: readonly number[]) => {
    const set = new Uint8Array(lw * lh);
    for (const p of pixels) set[p] = 1;
    const first = firstPixel(pixels);
    return simplifyRing(
      traceContour(
        (x, y) => x >= 0 && y >= 0 && x < lw && y < lh && set[y * lw + x] === 1,
        first % lw,
        Math.floor(first / lw),
      ),
      tolerance,
    ).map((p) => ({ x: p.x + minX - 1, y: p.y + minY - 1 }));
  };
  const polygon = trace(body.pixels);
  return polygon.length < 3 ? null : { polygon, body, local, lw, lh, trace };
}

const lineLength = (l: Line) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);

/** Hand-drawn or scanned near-axis walls: make them exactly horizontal/vertical. */
function snapToAxes(lines: Line[]): void {
  for (const line of lines) {
    const dx = Math.abs(line.b.x - line.a.x),
      dy = Math.abs(line.b.y - line.a.y);
    if (dy <= dx * 0.16) line.a.y = line.b.y = (line.a.y + line.b.y) / 2;
    else if (dx <= dy * 0.16) line.a.x = line.b.x = (line.a.x + line.b.x) / 2;
  }
}

/** The same wall seen from the rooms on both sides (or from two outline edges) becomes one. */
function mergeDuplicates(lines: Line[]): Line[] {
  const result = [...lines];
  for (let changed = true; changed;) {
    changed = false;
    search: for (let i = 0; i < result.length; i++)
      for (let j = i + 1; j < result.length; j++) {
        const [long, short] =
          lineLength(result[i]!) >= lineLength(result[j]!)
            ? [result[i]!, result[j]!]
            : [result[j]!, result[i]!];
        const length = lineLength(long);
        if (!length) continue;
        const ux = (long.b.x - long.a.x) / length,
          uy = (long.b.y - long.a.y) / length;
        const along = (p: PixelPoint) => (p.x - long.a.x) * ux + (p.y - long.a.y) * uy;
        const across = (p: PixelPoint) => -(p.x - long.a.x) * uy + (p.y - long.a.y) * ux;
        const sa = along(short.a),
          sb = along(short.b),
          offA = across(short.a),
          offB = across(short.b);
        const shortLength = lineLength(short);
        // Parallel (within ~6°), on the same line, and overlapping lengthwise.
        if (Math.abs(offA - offB) > Math.max(1.5, shortLength * 0.1)) continue;
        const offset = (offA + offB) / 2;
        if (Math.abs(offset) > Math.max(2, 0.5 * Math.max(long.t, short.t))) continue;
        if (Math.min(length, Math.max(sa, sb)) - Math.max(0, Math.min(sa, sb)) <= 0) continue;
        const shift = (offset * shortLength) / (length + shortLength);
        const from = Math.min(0, sa, sb),
          to = Math.max(length, sa, sb);
        const point = (s: number) => ({
          x: long.a.x + ux * s - uy * shift,
          y: long.a.y + uy * s + ux * shift,
        });
        result[i] = { a: point(from), b: point(to), t: Math.max(long.t, short.t) };
        result.splice(j, 1);
        changed = true;
        break search;
      }
  }
  return result;
}

/** A wall's centre line stops at the face of the wall it meets: carry it on to that wall's centre line. */
function joinCorners(lines: Line[]): void {
  const joined = lines.map((l) => ({ a: { ...l.a }, b: { ...l.b } }));
  lines.forEach((line, i) => {
    const length = lineLength(line);
    if (!length) return;
    const ux = (line.b.x - line.a.x) / length,
      uy = (line.b.y - line.a.y) / length;
    for (const end of ["a", "b"] as const) {
      const p = line[end];
      let best: PixelPoint | null = null,
        bestMove = Infinity;
      lines.forEach((other, j) => {
        if (i === j) return;
        const otherLength = lineLength(other);
        if (!otherLength) return;
        const vx = (other.b.x - other.a.x) / otherLength,
          vy = (other.b.y - other.a.y) / otherLength;
        const cross = ux * vy - uy * vx;
        if (Math.abs(cross) < 0.25) return; // (nearly) parallel
        // Intersection of the two centre lines.
        const s = ((other.a.x - p.x) * vy - (other.a.y - p.y) * vx) / cross;
        const hit = { x: p.x + ux * s, y: p.y + uy * s };
        const move = Math.abs(s);
        const reach = (line.t + other.t) / 2 + 3;
        const onOther = (hit.x - other.a.x) * vx + (hit.y - other.a.y) * vy;
        if (move > reach * 1.5 || onOther < -reach || onOther > otherLength + reach) return;
        if (move < bestMove) {
          best = hit;
          bestMove = move;
        }
      });
      if (best) joined[i]![end] = best;
    }
  });
  lines.forEach((line, i) => {
    line.a = joined[i]!.a;
    line.b = joined[i]!.b;
  });
}

/**
 * Hands every region that is neither a kept room nor open to the outside to
 * the kept room found just across its outline. Returns whether anything changed.
 */
function dissolveNonRooms(
  image: BinaryImage,
  labels: Int32Array,
  w: number,
  h: number,
  roomCount: number,
  rooms: readonly LabelledRoom[],
  exposed: Set<number>,
  options: RegionOptions,
): boolean {
  const kept = new Set(rooms.map((room) => room.label));
  const pixels = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!;
    if (label < 1 || label > roomCount || kept.has(label) || exposed.has(label)) continue;
    const list = pixels.get(label) ?? [];
    if (!list.length) pixels.set(label, list);
    list.push(i);
  }
  const reach = Math.round(2.5 * options.wallHalfPx);
  const depth = new Int32Array(labels.length).fill(-1);
  const moves: Array<[number[], number]> = [];
  for (const [label, own] of pixels) {
    const votes = new Map<number, number>();
    const visited = [...own];
    for (const p of visited) depth[p] = 0;
    for (let k = 0; k < visited.length; k++) {
      const i = visited[k]!;
      const at = depth[i]!;
      const found = labels[i]!;
      if (found !== label && kept.has(found)) votes.set(found, (votes.get(found) ?? 0) + 1);
      if (at >= reach) continue;
      const x = i % w,
        y = (i - x) / w;
      const visit = (j: number) => {
        if (depth[j]! < 0) {
          depth[j] = at + 1;
          visited.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    for (const p of visited) depth[p] = -1;
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) moves.push([own, best[0]]);
  }
  for (const [own, label] of moves) for (const p of own) labels[p] = label;

  // Closed cells no region claimed, big enough to stand in (a toilet stall, an
  // alcove behind a counter) and touching exactly one room: part of that room.
  // Tread-sized cells and wall cavities are too narrow to qualify.
  const { ink } = image;
  const mask = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) mask[i] = labels[i]! < 0 && !ink[i] ? 1 : 0;
  const stamp = new Int32Array(labels.length).fill(-1);
  let taken = 0;
  components(w, h, mask).forEach((cell, id) => {
    const width = cell.maxX - cell.minX + 1,
      height = cell.maxY - cell.minY + 1;
    if (
      cell.pixels.length < 0.3 * options.minRoomAreaPx ||
      Math.min(width, height) < 3 * options.wallHalfPx ||
      cell.pixels.length < 0.4 * width * height
    )
      return;
    const contact = new Map<number, number>();
    let outside = false;
    let frontier = cell.pixels;
    for (let depth = 0; depth <= 4 && frontier.length; depth++) {
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % w,
          y = (i - x) / w;
        const visit = (j: number) => {
          if (stamp[j] === id) return;
          stamp[j] = id;
          if (ink[j]) next.push(j);
          else if (labels[j] === 0) outside = true;
          else if (kept.has(labels[j]!))
            contact.set(labels[j]!, (contact.get(labels[j]!) ?? 0) + 1);
        };
        if (x > 0) visit(i - 1);
        if (x < w - 1) visit(i + 1);
        if (y > 0) visit(i - w);
        if (y < h - 1) visit(i + w);
      }
      frontier = next;
    }
    if (outside) return;
    const ranked = [...contact.entries()].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((sum, entry) => sum + entry[1], 0);
    if (!ranked[0] || ranked[0][1] < 0.7 * total) return;
    for (const p of cell.pixels) labels[p] = ranked[0][0];
    taken++;
  });
  return moves.length + taken > 0;
}

/**
 * Whether drawn lines actually run along a wall: at most places along it,
 * looking across its thickness finds ink (a solid band, or its two faces).
 * A centre line that merely fell between two regions — bending round a door
 * swing, cutting a corner — has little ink under it.
 */
function supportedByInk(image: BinaryImage, line: Line): boolean {
  const { width: w, height: h, ink } = image;
  const length = lineLength(line);
  if (!length) return false;
  const ux = (line.b.x - line.a.x) / length,
    uy = (line.b.y - line.a.y) / length;
  const half = line.t / 2 + 2;
  let samples = 0,
    supported = 0;
  for (let s = 1; s < length; s += 2) {
    let found = 0;
    for (let t = -half; t <= half; t++) {
      const x = Math.floor(line.a.x + ux * s - uy * t),
        y = Math.floor(line.a.y + uy * s + ux * t);
      if (x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x]) found++;
    }
    samples++;
    if (found >= 2) supported++;
  }
  const slanted = line.a.x !== line.b.x && line.a.y !== line.b.y;
  return samples > 0 && supported >= (slanted ? 0.85 : 0.6) * samples;
}

/** Rooms (with voids) and walls of a binarized plan. All coordinates are pixels. */
export function detectRegions(image: BinaryImage, options: RegionOptions): RegionResult {
  const { width: w, height: h } = image;
  const { labels, roomCount } = labelRegions(image, options);
  if (options.detail && options.detail !== image)
    reclaimAlcoves(image, options.detail, labels, options);
  // Only rooms that are closed off: an area open to the outside would grow out into it.
  closeRooms(
    labels,
    w,
    h,
    roomCount,
    options.doorHalfPx * 0.8,
    exposedRooms(labels, w, h, roomCount),
  );
  const exposed = exposedRooms(labels, w, h, roomCount);
  absorbOutsideCells(image, labels, exposed);
  const read = () =>
    wallsBetweenRegions(
      labels,
      w,
      h,
      outlineRooms(labels, w, h, roomCount, options),
      exposed,
      options,
    );
  let { lines, rooms } = read();
  // Closed areas that turned out not to be rooms (a sofa, a bed, a counter
  // outline) are floor of the room around them, not holes in it.
  if (dissolveNonRooms(image, labels, w, h, roomCount, rooms, exposed, options))
    ({ lines, rooms } = read());
  snapToAxes(lines);
  // Short slanted pieces are corners the outline cut across (or a door swing), not walls.
  const straight = lines.filter(
    (l) =>
      (l.a.x === l.b.x || l.a.y === l.b.y || lineLength(l) >= 2.5 * options.minWallLengthPx) &&
      supportedByInk(image, l),
  );
  const walls = mergeDuplicates(straight);
  joinCorners(walls);
  return {
    rooms: rooms.map(({ polygon, holes, areaPx, exposed }) => ({
      polygon,
      holes,
      areaPx,
      ...(exposed ? { exposed } : {}),
    })),
    walls: walls
      .filter((l) => lineLength(l) >= options.minWallLengthPx)
      .map((l) => ({ start: l.a, end: l.b, thicknessPx: l.t })),
  };
}
