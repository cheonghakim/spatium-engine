import type { Point } from "../types/common.js";
import { cross, subtract } from "./vector2.js";
import { distanceToSegment } from "./distance.js";

export interface Line {
  a: Point;
  b: Point;
}

/**
 * Intersection point of two segments, or null if they don't cross.
 * Collinear/parallel segments are treated as non-intersecting — callers
 * needing overlap detection should handle that case separately.
 */
export function segmentIntersection(l1: Line, l2: Line): Point | null {
  const r = subtract(l1.b, l1.a);
  const s = subtract(l2.b, l2.a);
  const rxs = cross(r, s);
  const qp = subtract(l2.a, l1.a);

  if (rxs === 0) return null;

  const t = cross(qp, s) / rxs;
  const u = cross(qp, r) / rxs;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: l1.a.x + r.x * t, y: l1.a.y + r.y * t };
  }
  return null;
}

export function nearestPointOnSegment(p: Point, line: Line): Point {
  return distanceToSegment(p, line.a, line.b).point;
}
