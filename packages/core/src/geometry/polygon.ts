import earcut from "earcut";
import type { Point } from "../types/common.js";
import { segmentIntersection, type Line } from "./line.js";
import { distanceToSegment } from "./distance.js";
import { boundingBoxOfPoints, boundingBoxesIntersect } from "./boundingBox.js";
import { normalize, subtract } from "./vector2.js";

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
 * triangle-overlap testing to treat near-zero cross
 * products / separations as exactly zero. At the coordinate scales this
 * geometry package is meant for (architectural floor plans — meters or
 * millimeters, roughly 1e-2 to 1e4 in magnitude), 1e-9 is many orders of
 * magnitude below any real distance while still comfortably above the
 * floating-point noise produced by a handful of arithmetic operations on
 * such values (double precision gives ~15-17 significant decimal digits).
 */
const GEOMETRY_EPSILON = 1e-9;

/**
 * Decomposes a simple polygon, convex or concave and optionally with holes,
 * into triangles. Backed by earcut (Mapbox, ISC — see THIRD_PARTY_NOTICES.md),
 * which handles holes and runs in roughly O(n log n) via z-order hashing,
 * replacing the earlier hand-rolled O(n^3) ear clipper.
 *
 * Winding of the outer ring and holes doesn't matter. Each hole is a ring
 * lying inside `polygon`; the triangles cover the polygon minus the holes.
 * Zero-area (collinear) triangles are dropped, so for a simple n-gon without
 * holes or collinear runs this returns n-2 triangles.
 *
 * Precondition: rings must not self-intersect or cross each other (see
 * isPolygonSelfIntersecting). Earcut still terminates on such input but may
 * leave parts uncovered. Returns [] when the outer ring has fewer than 3 points.
 */
export function triangulate(polygon: Point[], holes: Point[][] = []): Triangle[] {
  if (polygon.length < 3) return [];

  const rings = [polygon, ...holes.filter((hole) => hole.length >= 3)];
  const vertices: Point[] = [];
  const coords: number[] = [];
  const holeIndices: number[] = [];
  for (const [ringIndex, ring] of rings.entries()) {
    if (ringIndex > 0) holeIndices.push(vertices.length);
    for (const p of ring) {
      vertices.push(p);
      coords.push(p.x, p.y);
    }
  }

  const indices = earcut(coords, holeIndices.length > 0 ? holeIndices : null);
  const triangles: Triangle[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    triangles.push([
      vertices[indices[i] as number] as Point,
      vertices[indices[i + 1] as number] as Point,
      vertices[indices[i + 2] as number] as Point,
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
 * True if the two (simple) polygons — optionally with holes — overlap — i.e. their interiors share a
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
export function polygonsOverlap(
  a: Point[],
  b: Point[],
  holesA: Point[][] = [],
  holesB: Point[][] = [],
): boolean {
  if (a.length < 3 || b.length < 3) return false;

  const boxA = boundingBoxOfPoints(a);
  const boxB = boundingBoxOfPoints(b);
  if (!boundingBoxesIntersect(boxA, boxB)) return false;

  // Holes are excluded from the triangulation, so a space sitting inside
  // another's hole (a kiosk in an atrium void) doesn't count as overlapping.
  const trianglesA = triangulate(a, holesA);
  const trianglesB = triangulate(b, holesB);

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

/** Area of a polygon minus its holes (always non-negative). */
export function polygonWithHolesArea(polygon: Point[], holes: Point[][] = []): number {
  const outer = Math.abs(polygonArea(polygon));
  const removed = holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0);
  return Math.max(0, outer - removed);
}

/**
 * Inside the outer ring and not strictly inside any hole. Like
 * isPointInPolygon, boundaries are fuzzy — a point on a hole's edge may land
 * either way.
 */
export function isPointInPolygonWithHoles(
  point: Point,
  polygon: Point[],
  holes: Point[][] = [],
): boolean {
  if (!isPointInPolygon(point, polygon)) return false;
  return !holes.some((hole) => hole.length >= 3 && isPointInPolygon(point, hole));
}

/** Holed-polygon helpers for a Space-like object. */
export function spaceArea(space: { polygon: Point[]; holes?: Point[][] }): number {
  return polygonWithHolesArea(space.polygon, space.holes);
}

export function isPointInSpace(
  space: { polygon: Point[]; holes?: Point[][] },
  point: Point,
): boolean {
  return isPointInPolygonWithHoles(point, space.polygon, space.holes);
}

/** Problems with a polygon's holes, in the order found; [] when all are fine. */
export type HoleProblem =
  | { kind: "too-few-vertices"; holeIndex: number }
  | { kind: "self-intersecting"; holeIndex: number }
  | { kind: "outside-outer"; holeIndex: number }
  | { kind: "holes-overlap"; holeIndex: number; otherIndex: number };

export function findHoleProblems(polygon: Point[], holes: Point[][] = []): HoleProblem[] {
  const problems: HoleProblem[] = [];
  const valid: number[] = [];
  const outerEdges = polygonEdges(polygon);
  holes.forEach((hole, holeIndex) => {
    if (hole.length < 3) {
      problems.push({ kind: "too-few-vertices", holeIndex });
      return;
    }
    if (isPolygonSelfIntersecting(hole)) {
      problems.push({ kind: "self-intersecting", holeIndex });
      return;
    }
    const crossesOuter = polygonEdges(hole).some((edge) =>
      outerEdges.some((outer) => segmentIntersection(edge, outer)),
    );
    if (crossesOuter || !hole.every((p) => isPointInPolygon(p, polygon))) {
      problems.push({ kind: "outside-outer", holeIndex });
      return;
    }
    valid.push(holeIndex);
  });
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = holes[valid[i]!]!;
      const b = holes[valid[j]!]!;
      if (polygonsOverlap(a, b)) {
        problems.push({ kind: "holes-overlap", holeIndex: valid[i]!, otherIndex: valid[j]! });
      }
    }
  }
  return problems;
}

/**
 * Convex hull (Andrew's monotone chain), counter-clockwise, without repeating
 * the first point. Fewer than 3 distinct non-collinear points give whatever
 * remains (possibly fewer than 3 points).
 */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const turn = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
