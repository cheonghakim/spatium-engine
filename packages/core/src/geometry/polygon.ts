import type { Point } from "../types/common.js";
import { segmentIntersection, type Line } from "./line.js";
import { distanceToSegment } from "./distance.js";
import { boundingBoxOfPoints, boundingBoxesIntersect } from "./boundingBox.js";
import { cross, normalize, subtract } from "./vector2.js";

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
      const isAdjacent = j === i + 1 || (i === 0 && j === edges.length - 1);
      if (isAdjacent) continue;

      if (segmentIntersection(edges[i] as Line, edges[j] as Line)) {
        return true;
      }
    }
  }
  return false;
}

export type Triangle = [Point, Point, Point];

/**
 * Small absolute tolerance (in coordinate units) used throughout
 * triangulation and triangle-overlap testing to treat near-zero cross
 * products / separations as exactly zero. At the coordinate scales this
 * geometry package is meant for (architectural floor plans — meters or
 * millimeters, roughly 1e-2 to 1e4 in magnitude), 1e-9 is many orders of
 * magnitude below any real distance while still comfortably above the
 * floating-point noise produced by a handful of arithmetic operations on
 * such values (double precision gives ~15-17 significant decimal digits).
 */
const GEOMETRY_EPSILON = 1e-9;

/**
 * True if `curr` is a convex (non-reflex) vertex of a polygon ring in
 * counter-clockwise winding, i.e. the turn from `prev`->`curr`->`next` is a
 * left turn (or the three points are collinear, which is harmless to treat
 * as convex here since ear-clipping never *requires* a candidate ear to
 * have a strictly positive angle — a zero-area ear is simply discarded
 * later if it happens to be picked, but excluding collinear points from
 * candidacy entirely can wrongly stall clipping on inputs with repeated or
 * collinear vertices).
 */
function isConvexVertex(prev: Point, curr: Point, next: Point): boolean {
  return cross(subtract(curr, prev), subtract(next, curr)) >= -GEOMETRY_EPSILON;
}

/**
 * True if `p` lies inside or on the boundary of triangle (a, b, c),
 * regardless of the triangle's winding order. Used by ear-clipping to test
 * whether a candidate ear contains another vertex of the polygon (which
 * would make it an invalid ear to clip) — boundary-inclusive on purpose,
 * so a vertex lying exactly on a candidate ear's edge (collinear points)
 * still disqualifies it, keeping the resulting triangulation non-overlapping.
 */
function isPointInOrOnTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = cross(subtract(b, a), subtract(p, a));
  const d2 = cross(subtract(c, b), subtract(p, b));
  const d3 = cross(subtract(a, c), subtract(p, c));

  const hasNeg = d1 < -GEOMETRY_EPSILON || d2 < -GEOMETRY_EPSILON || d3 < -GEOMETRY_EPSILON;
  const hasPos = d1 > GEOMETRY_EPSILON || d2 > GEOMETRY_EPSILON || d3 > GEOMETRY_EPSILON;
  return !(hasNeg && hasPos);
}

/**
 * Decomposes a simple (non-self-intersecting) polygon, convex or concave,
 * into triangles via standard ear clipping: repeatedly find a convex vertex
 * whose triangle with its two ring-neighbors ("ear") contains no other
 * polygon vertex, clip it off (remove it from the ring and record the
 * triangle), and repeat until 3 vertices remain. Every simple polygon has
 * at least two clippable ears at every step (a classical result), so this
 * always terminates with a complete triangulation whose triangles exactly
 * partition the polygon's area with no gaps or overlaps between them.
 *
 * Winding is normalized to counter-clockwise up front (via polygonArea's
 * sign) because the convexity test needs to know which turn direction is
 * "convex" — without normalizing, a clockwise-wound input would have its
 * convex/reflex vertices exactly backwards.
 *
 * Precondition: `polygon` must not be self-intersecting (see
 * isPolygonSelfIntersecting) — ear clipping is only defined for simple
 * polygons. Returns [] for fewer than 3 points.
 */
export function triangulate(polygon: Point[]): Triangle[] {
  if (polygon.length < 3) return [];
  if (polygon.length === 3) {
    return [[polygon[0] as Point, polygon[1] as Point, polygon[2] as Point]];
  }

  const ring = polygonArea(polygon) < 0 ? [...polygon].reverse() : [...polygon];
  let indices = ring.map((_, i) => i);
  const triangles: Triangle[] = [];

  // Each successful clip removes exactly one index; this bounds the total
  // number of clip attempts (successful or not) so a pathological input
  // (e.g. one that violates the simple-polygon precondition) can't spin
  // forever — it just stops short with a partial-but-valid triangle set.
  const maxAttempts = ring.length * ring.length + 8;
  let attempts = 0;

  while (indices.length > 3 && attempts < maxAttempts) {
    attempts++;
    const n = indices.length;
    let clippedIndex = -1;

    for (let i = 0; i < n; i++) {
      const iPrev = indices[(i - 1 + n) % n] as number;
      const iCurr = indices[i] as number;
      const iNext = indices[(i + 1) % n] as number;
      const prev = ring[iPrev] as Point;
      const curr = ring[iCurr] as Point;
      const next = ring[iNext] as Point;

      if (!isConvexVertex(prev, curr, next)) continue;

      const containsOtherVertex = indices.some((idx) => {
        if (idx === iPrev || idx === iCurr || idx === iNext) return false;
        return isPointInOrOnTriangle(ring[idx] as Point, prev, curr, next);
      });
      if (containsOtherVertex) continue;

      triangles.push([prev, curr, next]);
      clippedIndex = i;
      break;
    }

    if (clippedIndex === -1) {
      // No strictly-valid ear this pass (can happen with degenerate
      // floating-point configurations, e.g. several collinear vertices in a
      // row) — clip the first vertex anyway so triangulation always
      // terminates with a full triangle set rather than dropping area.
      const iPrev = indices[n - 1] as number;
      const iCurr = indices[0] as number;
      const iNext = indices[1] as number;
      triangles.push([ring[iPrev] as Point, ring[iCurr] as Point, ring[iNext] as Point]);
      clippedIndex = 0;
    }

    indices = indices.filter((_, i) => i !== clippedIndex);
  }

  if (indices.length === 3) {
    triangles.push([
      ring[indices[0] as number] as Point,
      ring[indices[1] as number] as Point,
      ring[indices[2] as number] as Point,
    ]);
  }

  return triangles;
}

/** The three outward edge normals of a triangle, each normalized to unit
 * length so that projections onto them are in real coordinate units
 * (needed for SAT_TOUCH_EPSILON below to mean an actual distance rather
 * than something that scales with the triangle's edge lengths). Degenerate
 * edges (zero length, from a degenerate/collinear triangle) normalize to
 * the zero vector and are filtered out, since a zero axis carries no
 * separating information and would otherwise report every projection as
 * a perfectly-touching (and therefore falsely "separating") interval. */
function triangleAxes(t: Triangle): Point[] {
  const axes: Point[] = [];
  for (let i = 0; i < 3; i++) {
    const edge = subtract(t[(i + 1) % 3] as Point, t[i] as Point);
    const normal = normalize({ x: -edge.y, y: edge.x });
    if (normal.x !== 0 || normal.y !== 0) axes.push(normal);
  }
  return axes;
}

function projectTriangle(t: Triangle, axis: Point): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of t) {
    const proj = p.x * axis.x + p.y * axis.y;
    if (proj < min) min = proj;
    if (proj > max) max = proj;
  }
  return { min, max };
}

/**
 * Two triangles are considered merely touching (not overlapping) when their
 * projections onto every axis meet with a gap no larger than this — i.e.
 * they share at most a boundary (an edge, or a corner) with no positive-area
 * interpenetration. This must be large enough to absorb floating-point
 * error in the projected coordinates (sums/products of a handful of input
 * coordinates, so error on the order of 1e-9 relative for typical
 * architectural-scale inputs) but far smaller than any real overlap this
 * function is meant to detect — using the same GEOMETRY_EPSILON as the rest
 * of this file keeps that tradeoff consistent everywhere. Concretely, this
 * is what keeps two rooms sharing an exact wall (whose triangulations touch
 * exactly along that wall's edge) classified as non-overlapping.
 */
const SAT_TOUCH_EPSILON = GEOMETRY_EPSILON;

/**
 * True if two triangles have a positive-area intersection, via the
 * Separating Axis Theorem: for two convex polygons, checking their edge
 * normals as candidate separating axes is a necessary and sufficient test
 * (this is a standard, exact result for convex shapes, not an approximation
 * or heuristic) — a triangle has only 3 edges, so only 3 axes per triangle
 * (6 total) ever need checking. If projecting both triangles onto some axis
 * yields intervals separated by more than SAT_TOUCH_EPSILON, that axis
 * proves they don't overlap; if no axis separates them (within that
 * tolerance), they do.
 */
export function trianglesOverlap(t1: Triangle, t2: Triangle): boolean {
  const axes = [...triangleAxes(t1), ...triangleAxes(t2)];
  for (const axis of axes) {
    const p1 = projectTriangle(t1, axis);
    const p2 = projectTriangle(t2, axis);
    const separated = p1.max <= p2.min + SAT_TOUCH_EPSILON || p2.max <= p1.min + SAT_TOUCH_EPSILON;
    if (separated) return false;
  }
  return true;
}

/**
 * True if the two (simple) polygons overlap — i.e. their interiors share a
 * positive-area region — rather than merely touching along a shared edge or
 * a shared corner.
 *
 * This decomposes each polygon into triangles (`triangulate`, ear clipping)
 * and checks every triangle from A against every triangle from B for a
 * genuine area intersection (`trianglesOverlap`, exact SAT). Because
 * triangulation exactly partitions each polygon's area into non-overlapping
 * triangles, "some triangle of A overlaps some triangle of B" is equivalent
 * to "A's area and B's area intersect with positive measure" — this is a
 * direct test of polygon-vs-polygon area intersection, not a sampling
 * heuristic, so it has no blind spot for coincident boundaries, identical
 * shapes, or concave notches: earlier heuristic signals (a verified interior
 * centroid, strict vertex containment, edge-interior sampling, proper edge
 * crossing) all existed only to indirectly infer area intersection from
 * finitely many sample points, and each had a configuration that produced no
 * sample point or crossing anywhere on the shared boundary (most recently:
 * two identical copies of a concave polygon, where the centroid falls
 * outside the polygon's own area — disqualifying that signal — while every
 * vertex and edge-sample point of one lands exactly on the other's boundary,
 * never strictly inside it). Triangulation sidesteps this entirely because
 * it reasons about the polygons' full areas rather than any finite sample
 * of points on or near them.
 *
 * The only tolerance left is SAT_TOUCH_EPSILON, which decides how much
 * "touching" (shared boundary, zero-width) is distinguished from genuine
 * overlap — a deliberate, tiny, fixed modeling choice (and the standard
 * floating-point tolerance every computational-geometry routine needs), not
 * a structural gap: it cannot miss a real overlap of any non-negligible
 * area, at any orientation, for any winding or convexity, because SAT over a
 * polygon's full triangulation is exact for the area it actually measures.
 */
export function polygonsOverlap(a: Point[], b: Point[]): boolean {
  if (a.length < 3 || b.length < 3) return false;

  const boxA = boundingBoxOfPoints(a);
  const boxB = boundingBoxOfPoints(b);
  if (!boundingBoxesIntersect(boxA, boxB)) return false;

  const trianglesA = triangulate(a);
  const trianglesB = triangulate(b);

  for (const triA of trianglesA) {
    for (const triB of trianglesB) {
      if (trianglesOverlap(triA, triB)) return true;
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
