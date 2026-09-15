import type { Point } from "../types/common.js";
import { dot, subtract } from "./vector2.js";

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance from point p to the segment [a, b], and the closest point on it. */
export function distanceToSegment(
  p: Point,
  a: Point,
  b: Point,
): { distance: number; point: Point } {
  const ab = subtract(b, a);
  const lengthSquared = dot(ab, ab);

  if (lengthSquared === 0) {
    return { distance: distance(p, a), point: a };
  }

  const t = Math.max(0, Math.min(1, dot(subtract(p, a), ab) / lengthSquared));
  const point: Point = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return { distance: distance(p, point), point };
}
