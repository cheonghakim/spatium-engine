import type { GraphEdge, PixelPoint, PlanarGraph } from "./buildGraph.js";
import type { PixelSegment } from "./detectLines.js";

type Segment = PixelSegment & { thicknessPx: number };

const segmentLength = (s: Segment) => s.end - s.start + 1;

/**
 * The stroke thickness walls are drawn with on this plan, estimated as the
 * thickness at which the thickest 30% of all ink length is reached. Walls are
 * the long, heavy strokes of a plan, so they dominate this tail even when
 * furniture, text and dimension lines contribute more strokes overall.
 */
export function dominantWallThickness(segments: readonly Segment[]): number {
  const total = segments.reduce((sum, s) => sum + segmentLength(s), 0);
  if (total === 0) return 0;
  const sorted = [...segments].sort((a, b) => b.thicknessPx - a.thicknessPx);
  let accumulated = 0;
  for (const s of sorted) {
    accumulated += segmentLength(s);
    if (accumulated >= total * 0.3) return s.thicknessPx;
  }
  return sorted.at(-1)!.thicknessPx;
}

export interface SegmentSplit {
  walls: Segment[];
  /** Thin strokes that were not walls (furniture, text, dimensions, door leaves, stair treads). */
  thin: Segment[];
}

/**
 * Separates wall strokes from drawing clutter:
 * - blobs (a filled area scanned across, longer in thickness than in length) are dropped;
 * - with `auto`, strokes thinner than half the plan's wall thickness are set
 *   aside as `thin`. Only applied when walls are clearly heavier than the
 *   minimum, so a plan drawn entirely in thin single lines is left alone.
 */
export function splitWallSegments(
  segments: readonly Segment[],
  minThicknessPx: number,
  auto: boolean,
): SegmentSplit {
  const candidates = segments.filter(
    (s) => s.thicknessPx >= minThicknessPx && segmentLength(s) >= 2 * s.thicknessPx,
  );
  if (!auto) return { walls: candidates, thin: [] };
  const dominant = dominantWallThickness(candidates);
  const cutoff = dominant * 0.5;
  if (dominant < Math.max(4, minThicknessPx * 2)) return { walls: candidates, thin: [] };
  return {
    walls: candidates.filter((s) => s.thicknessPx >= cutoff),
    thin: candidates.filter((s) => s.thicknessPx < cutoff),
  };
}

/**
 * Fuses strokes lying on the same wall line that overlap or nearly touch —
 * what a wall band broken up by a window symbol or uneven ink scans into —
 * so the line yields one wall instead of several stacked/overlapping ones.
 */
export function unionCollinearSegments(segments: readonly Segment[], gapPx: number): Segment[] {
  const result: Segment[] = [];
  for (const orientation of ["horizontal", "vertical"] as const) {
    const pending = segments
      .filter((s) => s.orientation === orientation)
      .sort((a, b) => a.offset - b.offset);
    const groups: Array<Segment & { weight: number }> = [];
    for (const s of pending) {
      const length = segmentLength(s);
      const match = groups.find(
        (g) =>
          // ≥1.5 px so the ragged 1-px fringe of a blurred line joins its line.
          Math.abs(g.offset - s.offset) <=
            Math.max(1.5, Math.max(g.thicknessPx, s.thicknessPx) / 2) &&
          s.start <= g.end + gapPx &&
          s.end >= g.start - gapPx,
      );
      if (!match) {
        groups.push({ ...s, weight: length });
        continue;
      }
      // Offset weighted by length (the long stroke is the wall line), thickness of the heavier stroke.
      match.offset = (match.offset * match.weight + s.offset * length) / (match.weight + length);
      match.weight += length;
      match.start = Math.min(match.start, s.start);
      match.end = Math.max(match.end, s.end);
      match.thicknessPx = Math.max(match.thicknessPx, s.thicknessPx);
    }
    for (const { weight: _weight, ...g } of groups) result.push(g);
  }
  return result;
}

function edgeLength(graph: PlanarGraph, edge: GraphEdge): number {
  const a = graph.points[edge.from]!,
    b = graph.points[edge.to]!;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Removes scan artefacts from the wall graph:
 * - dangling stubs no longer than the wall is thick (the overhang a thick
 *   corner leaves past the joint), repeatedly, so chains of stubs go too;
 * - tiny free-floating pieces (all edges of a component shorter than `minComponentPx` in total).
 * Unused points are dropped and the graph is re-indexed.
 */
export function pruneGraph(
  graph: PlanarGraph,
  options: {
    stubPx: number;
    minComponentPx: number;
    /**
     * Also drop pieces shorter (in total) than this share of the largest
     * connected structure — dimension strings, paving, lone furniture: walls
     * hang together, annotations float apart. 0 disables.
     */
    minComponentShare?: number;
    /** Receives each edge of a dropped free-floating piece (e.g. a lone stair tread). */
    onDropped?: (a: PixelPoint, b: PixelPoint, thicknessPx: number) => void;
  },
): PlanarGraph {
  let edges = [...graph.edges];
  for (let changed = true; changed;) {
    changed = false;
    const degree = new Map<number, number>();
    for (const e of edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const kept = edges.filter((e) => {
      const leaf = degree.get(e.from) === 1 || degree.get(e.to) === 1;
      const isolated = degree.get(e.from) === 1 && degree.get(e.to) === 1;
      // An isolated single edge is a component of its own: judged below, not as a stub.
      return isolated || !leaf || edgeLength(graph, e) > Math.max(options.stubPx, e.thicknessPx);
    });
    if (kept.length !== edges.length) {
      edges = kept;
      changed = true;
    }
  }

  // Connected components by union-find; drop the tiny ones.
  const parent = graph.points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (const e of edges) parent[find(e.from)] = find(e.to);
  const componentLength = new Map<number, number>();
  for (const e of edges) {
    const root = find(e.from);
    componentLength.set(root, (componentLength.get(root) ?? 0) + edgeLength(graph, e));
  }
  const largest = Math.max(0, ...componentLength.values());
  const minLength = Math.max(options.minComponentPx, largest * (options.minComponentShare ?? 0));
  edges = edges.filter((e) => {
    const keep = componentLength.get(find(e.from))! >= minLength;
    if (!keep) options.onDropped?.(graph.points[e.from]!, graph.points[e.to]!, e.thicknessPx);
    return keep;
  });

  const remap = new Map<number, number>();
  const points: PixelPoint[] = [];
  const index = (i: number) => {
    let mapped = remap.get(i);
    if (mapped === undefined) {
      mapped = points.push(graph.points[i]!) - 1;
      remap.set(i, mapped);
    }
    return mapped;
  };
  return {
    points,
    edges: edges.map((e) => ({ from: index(e.from), to: index(e.to), thicknessPx: e.thicknessPx })),
  };
}

export interface WallChain {
  from: number;
  to: number;
  thicknessPx: number;
}

/**
 * Joins graph edges that continue straight through a node into one wall, so a
 * wall line crossed by (or meeting) other walls stays a single wall instead of
 * one piece per junction. The graph itself keeps the split edges for room tracing.
 */
export function mergeCollinearEdges(graph: PlanarGraph): WallChain[] {
  const incident: number[][] = graph.points.map(() => []);
  graph.edges.forEach((e, i) => {
    incident[e.from]!.push(i);
    incident[e.to]!.push(i);
  });
  const direction = (edgeIndex: number, from: number) => {
    const e = graph.edges[edgeIndex]!;
    const to = e.from === from ? e.to : e.from;
    const a = graph.points[from]!,
      b = graph.points[to]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  };
  /** The one edge leaving `node` straight on from `edgeIndex`, if exactly one does. */
  const continuation = (edgeIndex: number, node: number): number | null => {
    const incoming = direction(edgeIndex, node);
    const straight = incident[node]!.filter((other) => {
      if (other === edgeIndex) return false;
      const d = direction(other, node);
      // Opposite (within ~6°: junction snapping can nudge a node a pixel or two) = continues straight.
      return incoming.x * d.x + incoming.y * d.y < -0.995;
    });
    return straight.length === 1 ? straight[0]! : null;
  };

  const used = new Set<number>();
  const chains: WallChain[] = [];
  graph.edges.forEach((edge, start) => {
    if (used.has(start)) return;
    used.add(start);
    let length = edgeLength(graph, edge),
      weighted = edge.thicknessPx * length;
    // Walk both ways from this edge as far as the line runs straight.
    const extend = (node: number, via: number): number => {
      let current = node,
        edgeIndex = via;
      for (;;) {
        const next = continuation(edgeIndex, current);
        if (next === null || used.has(next)) return current;
        used.add(next);
        const e = graph.edges[next]!;
        const l = edgeLength(graph, e);
        length += l;
        weighted += e.thicknessPx * l;
        current = e.from === current ? e.to : e.from;
        edgeIndex = next;
      }
    };
    const from = extend(edge.from, start);
    const to = extend(edge.to, start);
    chains.push({ from, to, thicknessPx: length > 0 ? weighted / length : edge.thicknessPx });
  });
  return chains;
}

type Interval = [number, number];

/** `interval` minus every interval in `taken` (all inclusive pixel ranges). */
function subtractIntervals(interval: Interval, taken: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [interval];
  for (const [a, b] of taken) {
    pieces = pieces.flatMap(([s, e]) => {
      if (b < s || a > e) return [[s, e] as Interval];
      const out: Interval[] = [];
      if (a > s) out.push([s, a - 1]);
      if (b < e) out.push([b + 1, e]);
      return out;
    });
  }
  return pieces;
}

/**
 * The spacing between a wall's two face lines on a plan drawn in thin lines:
 * the most common gap between parallel, substantially overlapping lines
 * (weighted by how long they run side by side). Null when nothing stands out
 * — e.g. a plan with filled walls, or too few parallel lines.
 */
export function estimateFaceGap(
  segments: readonly Segment[],
  maxGapPx: number,
  minOverlapPx: number,
): number | null {
  const histogram = new Map<number, number>();
  let total = 0;
  for (const orientation of ["horizontal", "vertical"] as const) {
    const lines = segments
      .filter((s) => s.orientation === orientation)
      .sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i]!;
      total += segmentLength(a);
      for (let j = i + 1; j < lines.length; j++) {
        const b = lines[j]!;
        const gap = b.offset - a.offset;
        if (gap > maxGapPx) break;
        if (gap < 3) continue;
        const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start) + 1;
        if (overlap < minOverlapPx) continue;
        const bin = Math.round(gap);
        histogram.set(bin, (histogram.get(bin) ?? 0) + overlap);
      }
    }
  }
  let best: number | null = null,
    bestWeight = 0;
  for (const bin of histogram.keys()) {
    // Smooth over ±1 px: blurred scans spread one spacing over neighbouring bins.
    const weight =
      (histogram.get(bin - 1) ?? 0) + (histogram.get(bin) ?? 0) + (histogram.get(bin + 1) ?? 0);
    if (weight > bestWeight) {
      best = bin;
      bestWeight = weight;
    }
  }
  // A real wall-face spacing pairs up a good share of all the line work.
  return best !== null && bestWeight >= total * 0.08 ? best : null;
}

/**
 * Turns pairs of parallel face lines into walls (centre line + thickness).
 * Closest pairs win, and each stretch of a line is used once, so a face is
 * paired with the other face of its own wall, not with a dimension line or
 * the neighbouring wall. Returns the walls and the stretches left unpaired.
 */
export function pairWallFaces(
  segments: readonly Segment[],
  faceGapPx: number,
  minOverlapPx: number,
): { walls: Segment[]; unpaired: Segment[] } {
  // Interior walls can be a third as thick as exterior ones (and vice versa).
  const minGap = Math.max(3, faceGapPx * 0.3),
    maxGap = faceGapPx * 2.2;
  const used = segments.map(() => [] as Interval[]);
  const candidates: Array<{ a: number; b: number; gap: number; from: number; to: number }> = [];
  segments.forEach((a, i) =>
    segments.forEach((b, j) => {
      if (j <= i || a.orientation !== b.orientation) return;
      const gap = Math.abs(b.offset - a.offset);
      if (gap < minGap || gap > maxGap) return;
      const from = Math.max(a.start, b.start),
        to = Math.min(a.end, b.end);
      // A wall runs well past its own thickness; short parallel strokes (text, ticks) don't.
      if (to - from + 1 >= Math.max(minOverlapPx, gap * 1.5))
        candidates.push({ a: i, b: j, gap, from, to });
    }),
  );
  candidates.sort((x, y) => x.gap - y.gap || y.to - y.from - (x.to - x.from));

  const walls: Segment[] = [];
  for (const { a, b, gap, from, to } of candidates) {
    const sa = segments[a]!,
      sb = segments[b]!;
    for (const [start, end] of subtractIntervals([from, to], [...used[a]!, ...used[b]!])) {
      if (end - start + 1 < Math.max(minOverlapPx, gap * 1.5)) continue;
      walls.push({
        orientation: sa.orientation,
        offset: (sa.offset + sb.offset) / 2,
        start,
        end,
        thicknessPx: gap + (sa.thicknessPx + sb.thicknessPx) / 2,
      });
      used[a]!.push([start, end]);
      used[b]!.push([start, end]);
    }
  }
  const unpaired = segments.flatMap((s, i) =>
    subtractIntervals([s.start, s.end], used[i]!)
      .filter(([start, end]) => end - start + 1 >= minOverlapPx)
      .map(([start, end]) => ({ ...s, start, end })),
  );
  return { walls, unpaired };
}

/** Distance from a point to an axis-aligned segment's centre line. */
function distanceToSegmentLine(x: number, y: number, s: Segment): number {
  const along = s.orientation === "horizontal" ? x : y;
  const across = s.orientation === "horizontal" ? y : x;
  const clamped = Math.max(s.start, Math.min(s.end, along));
  return Math.hypot(along - clamped, across - s.offset);
}

/**
 * A single line whose two ends both land on walls is a partition drawn as one
 * line (not a dimension line or furniture, which float free) — keep it.
 */
export function singleLinePartitions(
  unpaired: readonly Segment[],
  walls: readonly Segment[],
  reachPx: number,
  minLengthPx: number,
): Segment[] {
  const endpoints = (s: Segment): Array<[number, number]> =>
    s.orientation === "horizontal"
      ? [
          [s.start, s.offset],
          [s.end, s.offset],
        ]
      : [
          [s.offset, s.start],
          [s.offset, s.end],
        ];
  const middle = (s: Segment): [number, number] =>
    s.orientation === "horizontal"
      ? [(s.start + s.end) / 2, s.offset]
      : [s.offset, (s.start + s.end) / 2];
  return unpaired.filter(
    (s) =>
      segmentLength(s) >= minLengthPx &&
      endpoints(s).every(([x, y]) =>
        walls.some((w) => distanceToSegmentLine(x, y, w) <= w.thicknessPx / 2 + reachPx),
      ) &&
      // A leftover piece of a wall's own face runs inside that wall's band — not a partition.
      !walls.some(
        (w) =>
          w.orientation === s.orientation &&
          distanceToSegmentLine(...middle(s), w) <= w.thicknessPx / 2 + reachPx / 2,
      ),
  );
}

/**
 * A wall built from its two faces stops where its faces stop: at the face of
 * the wall it runs into, half that wall's thickness short of its centre line.
 * Moves such an end exactly onto the crossing wall's centre line, so T and L
 * joints close without a large (and error-prone) node-snapping tolerance.
 * Ends that meet nothing (door and window openings) are left alone.
 */
export function joinWallEnds(walls: readonly Segment[], reachPx: number): Segment[] {
  return walls.map((wall) => {
    const joined = { ...wall };
    for (const end of ["start", "end"] as const) {
      const at = wall[end];
      let best: number | null = null;
      for (const other of walls) {
        if (other === wall || other.orientation === wall.orientation) continue;
        // `other` must span across this wall's line, and this end must reach into its band.
        if (wall.offset < other.start - reachPx || wall.offset > other.end + reachPx) continue;
        const gap = Math.abs(at - other.offset);
        if (gap > other.thicknessPx / 2 + reachPx) continue;
        if (best === null || gap < Math.abs(at - best)) best = other.offset;
      }
      if (best !== null) joined[end] = Math.round(best);
    }
    if (joined.start > joined.end) [joined.start, joined.end] = [joined.end, joined.start];
    return joined;
  });
}

/**
 * A blurred or upscaled scan draws each line as a solid core plus ragged
 * one-pixel rows along its edges. Those rows break into pieces that sit a few
 * pixels off the core and would pair up with the wrong lines; drop every
 * stroke that runs alongside a longer, covering stroke within that distance.
 */
export function absorbFringes(segments: readonly Segment[], gapPx: number): Segment[] {
  return segments.filter(
    (s) =>
      !segments.some(
        (core) =>
          core !== s &&
          core.orientation === s.orientation &&
          segmentLength(core) > segmentLength(s) &&
          core.start <= s.start + gapPx &&
          core.end >= s.end - gapPx &&
          Math.abs(core.offset - s.offset) <= (core.thicknessPx + s.thicknessPx) / 2 + gapPx + 1,
      ),
  );
}

/**
 * Lines that belong to a regular series of parallel strokes — stair treads,
 * paving or tile joints, hatching, graph-paper rulings: at least four
 * parallel, overlapping lines in a row at (nearly) the same spacing. Walls
 * don't look like this — a wall's second face is followed by a room — and
 * three lines evenly spaced by coincidence (furniture edges next to a wall)
 * aren't enough.
 */
export function findLadders(segments: readonly Segment[], minOverlapPx: number): Set<Segment> {
  const ladder = new Set<Segment>();
  for (const orientation of ["horizontal", "vertical"] as const) {
    const lines = segments
      .filter((s) => s.orientation === orientation)
      .sort((a, b) => a.offset - b.offset);
    const overlaps = (a: Segment, b: Segment) =>
      Math.min(a.end, b.end) - Math.max(a.start, b.start) + 1 >=
      Math.max(minOverlapPx, 0.5 * Math.min(segmentLength(a), segmentLength(b)));
    const neighbour = (i: number, step: -1 | 1): Segment | undefined => {
      const middle = lines[i]!;
      for (let j = i + step; j >= 0 && j < lines.length; j += step) {
        const other = lines[j]!;
        if (Math.abs(other.offset - middle.offset) > 1 && overlaps(other, middle)) return other;
      }
      return undefined;
    };
    const same = (d1: number, d2: number) =>
      Math.abs(d1 - d2) <= Math.max(2, 0.15 * Math.max(d1, d2));
    // Each line that sits evenly between its neighbours: the spacing, and those neighbours.
    const triples = new Map<Segment, { spacing: number; before: Segment; after: Segment }>();
    lines.forEach((middle, i) => {
      const before = neighbour(i, -1),
        after = neighbour(i, 1);
      if (!before || !after || !overlaps(before, after)) return;
      const d1 = middle.offset - before.offset,
        d2 = after.offset - middle.offset;
      if (same(d1, d2)) triples.set(middle, { spacing: (d1 + d2) / 2, before, after });
    });
    // Two adjacent evenly-spaced triples with the same spacing = four lines in a row.
    for (const [middle, triple] of triples) {
      const next = triples.get(triple.after);
      if (!next || !same(triple.spacing, next.spacing)) continue;
      for (const line of [triple.before, middle, triple.after, next.after]) ladder.add(line);
    }
  }
  return ladder;
}
