import type { Point } from "@indoor/core";
import { distanceToSegment } from "@indoor/core";
import type { SnapContext, SnapProvider, SnapResult } from "../SnapProvider.js";

const AXIS_EPSILON = 1e-9;

/**
 * The closest point on segment a–b. With a grid, on a horizontal or vertical
 * segment the position along it is rounded to the grid (kept within the
 * segment), so walls drawn along a room's edge still land on grid points.
 * Slanted segments can't share the grid; their projection is used as is.
 */
function closestOnSegment(
  point: Point,
  a: Point,
  b: Point,
  grid: number | null,
): { point: Point; distance: number } {
  const hit = distanceToSegment(point, a, b);
  if (!grid) return hit;
  const round = (value: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, Math.round(value / grid) * grid + 0));
  let snapped: Point | null = null;
  if (Math.abs(a.y - b.y) < AXIS_EPSILON) {
    snapped = { x: round(hit.point.x, Math.min(a.x, b.x), Math.max(a.x, b.x)), y: a.y };
  } else if (Math.abs(a.x - b.x) < AXIS_EPSILON) {
    snapped = { x: a.x, y: round(hit.point.y, Math.min(a.y, b.y), Math.max(a.y, b.y)) };
  }
  if (!snapped) return hit;
  return { point: snapped, distance: Math.hypot(point.x - snapped.x, point.y - snapped.y) };
}

export class EdgeSnap implements SnapProvider {
  constructor(
    private readonly threshold = 0.15,
    private readonly getGridSize: () => number | null = () => null,
  ) {}

  getSnap(point: Point, context: SnapContext): SnapResult | null {
    const grid = this.getGridSize();
    let best: SnapResult | null = null;
    let bestDist = this.threshold;
    const consider = (a: Point, b: Point) => {
      // Gate on the true distance to the edge; the grid only moves the point along it.
      if (distanceToSegment(point, a, b).distance >= bestDist) return;
      const candidate = closestOnSegment(point, a, b, grid);
      bestDist = distanceToSegment(point, a, b).distance;
      best = { point: candidate.point, type: "edge" };
    };

    for (const space of context.floor.spaces) {
      if (space.id === context.excludeId || space.polygon.length < 2) continue;
      const ring = space.polygon;
      for (let i = 0; i < ring.length; i++) consider(ring[i]!, ring[(i + 1) % ring.length]!);
    }

    // Wall is a first-class drawing primitive (see WallTool's doc comment),
    // independent of Space polygons, so its own segment is a candidate too.
    for (const wall of context.floor.walls) {
      if (wall.id === context.excludeId) continue;
      consider(wall.start, wall.end);
    }

    return best;
  }
}
