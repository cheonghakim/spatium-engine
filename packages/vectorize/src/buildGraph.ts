import type { PixelSegment } from "./detectLines.js";

export interface PixelPoint {
  x: number;
  y: number;
}

export interface GraphEdge {
  from: number;
  to: number;
  thicknessPx: number;
}

export interface PlanarGraph {
  points: PixelPoint[];
  edges: GraphEdge[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Builds a planar graph from axis-aligned wall segments: every place a
 * segment's endpoint touches another segment, or two segments cross, becomes
 * a graph node, splitting whichever segment(s) pass through that point. This
 * uniformly handles X-crossings, T-junctions, and L-corners for
 * horizontal/vertical segments without needing separate cases for each.
 */
export function buildPlanarGraph(
  segments: Array<PixelSegment & { thicknessPx: number }>,
  snapTolerancePx = 3,
): PlanarGraph {
  const horizontals = segments.filter((s) => s.orientation === "horizontal");
  const verticals = segments.filter((s) => s.orientation === "vertical");

  const hBreaks: number[][] = horizontals.map((h) => [h.start, h.end]);
  const vBreaks: number[][] = verticals.map((v) => [v.start, v.end]);

  for (let hi = 0; hi < horizontals.length; hi++) {
    const h = horizontals[hi]!;
    for (let vi = 0; vi < verticals.length; vi++) {
      const v = verticals[vi]!;
      const x = v.offset;
      const y = h.offset;
      const onHorizontal = x >= h.start - snapTolerancePx && x <= h.end + snapTolerancePx;
      const onVertical = y >= v.start - snapTolerancePx && y <= v.end + snapTolerancePx;
      if (onHorizontal && onVertical) {
        hBreaks[hi]!.push(clamp(x, h.start, h.end));
        vBreaks[vi]!.push(clamp(y, v.start, v.end));
      }
    }
  }

  const rawPoints: PixelPoint[] = [];
  const rawEdges: Array<{ a: number; b: number; thicknessPx: number }> = [];

  horizontals.forEach((h, hi) => {
    const xs = [...new Set(hBreaks[hi])].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) {
      const a = rawPoints.push({ x: xs[i]!, y: h.offset }) - 1;
      const b = rawPoints.push({ x: xs[i + 1]!, y: h.offset }) - 1;
      rawEdges.push({ a, b, thicknessPx: h.thicknessPx });
    }
  });

  verticals.forEach((v, vi) => {
    const ys = [...new Set(vBreaks[vi])].sort((a, b) => a - b);
    for (let i = 0; i < ys.length - 1; i++) {
      const a = rawPoints.push({ x: v.offset, y: ys[i]! }) - 1;
      const b = rawPoints.push({ x: v.offset, y: ys[i + 1]! }) - 1;
      rawEdges.push({ a, b, thicknessPx: v.thicknessPx });
    }
  });

  const { points, indexMap } = snapPoints(rawPoints, snapTolerancePx);

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const e of rawEdges) {
    const from = indexMap[e.a]!;
    const to = indexMap[e.b]!;
    if (from === to) continue;
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to, thicknessPx: e.thicknessPx });
  }

  return { points, edges };
}

/** Clusters points within `tolerance` of each other into single canonical points. */
function snapPoints(
  rawPoints: PixelPoint[],
  tolerance: number,
): { points: PixelPoint[]; indexMap: number[] } {
  const clusters: Array<{ sumX: number; sumY: number; count: number }> = [];
  const indexMap: number[] = new Array(rawPoints.length);

  for (let i = 0; i < rawPoints.length; i++) {
    const p = rawPoints[i]!;
    let matched = -1;
    for (let c = 0; c < clusters.length; c++) {
      const cluster = clusters[c]!;
      const cx = cluster.sumX / cluster.count;
      const cy = cluster.sumY / cluster.count;
      if (Math.hypot(p.x - cx, p.y - cy) <= tolerance) {
        matched = c;
        break;
      }
    }
    if (matched === -1) {
      clusters.push({ sumX: p.x, sumY: p.y, count: 1 });
      indexMap[i] = clusters.length - 1;
    } else {
      const cluster = clusters[matched]!;
      cluster.sumX += p.x;
      cluster.sumY += p.y;
      cluster.count += 1;
      indexMap[i] = matched;
    }
  }

  const points = clusters.map((c) => ({ x: c.sumX / c.count, y: c.sumY / c.count }));
  return { points, indexMap };
}
