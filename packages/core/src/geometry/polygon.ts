import type { Point } from "../types/common.js";
import { segmentIntersection, type Line } from "./line.js";
import { distanceToSegment } from "./distance.js";

/**
 * Signed area (shoelace formula). Positive = counter-clockwise winding.
 */
export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i] as Point;
    const p2 = points[(i + 1) % points.length] as Point;
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return sum / 2;
}

export function polygonCentroid(points: Point[]): Point {
  const area = polygonArea(points);
  if (points.length < 3 || area === 0) {
    const n = points.length || 1;
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), {
      x: 0,
      y: 0,
    });
    return { x: sum.x / n, y: sum.y / n };
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i] as Point;
    const p2 = points[(i + 1) % points.length] as Point;
    const cross = p1.x * p2.y - p2.x * p1.y;
    cx += (p1.x + p2.x) * cross;
    cy += (p1.y + p2.y) * cross;
  }
  const factor = 1 / (6 * area);
  return { x: cx * factor, y: cy * factor };
}

/** Ray-casting point-in-polygon test. Boundary points are treated as inside. */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i] as Point;
    const pj = polygon[j] as Point;

    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;

    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonEdges(points: Point[]): Line[] {
  return points.map((p, i) => ({ a: p, b: points[(i + 1) % points.length] as Point }));
}

/**
 * True if any two non-adjacent edges of the polygon cross each other.
 */
export function isPolygonSelfIntersecting(points: Point[]): boolean {
  if (points.length < 4) return false;
  const edges = polygonEdges(points);

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const isAdjacent =
        j === i + 1 || (i === 0 && j === edges.length - 1);
      if (isAdjacent) continue;

      if (segmentIntersection(edges[i] as Line, edges[j] as Line)) {
        return true;
      }
    }
  }
  return false;
}

/** Closest point on the polygon boundary to the given point, and its distance. */
export function nearestPointOnPolygon(
  point: Point,
  polygon: Point[],
): { point: Point; distance: number } {
  let best: { point: Point; distance: number } | null = null;
  for (const edge of polygonEdges(polygon)) {
    const candidate = distanceToSegment(point, edge.a, edge.b);
    if (!best || candidate.distance < best.distance) {
      best = candidate;
    }
  }
  return best ?? { point, distance: 0 };
}
