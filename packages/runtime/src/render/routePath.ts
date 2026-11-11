import { distanceToSegment, segmentIntersection, type Point } from "@indoor/core";

export type RouteCurveShape = "straight" | "smooth";

/**
 * A route run resampled into the exact polyline that is both drawn and
 * animated along — sharing one shape is what keeps the playback marker on
 * the drawn line. `distances[i]` is the arc length from the start to
 * `points[i]`.
 */
export interface RoutePath {
  points: Point[];
  distances: number[];
  length: number;
}

export interface RoutePathSample {
  point: Point;
  /** Unit direction of travel at this distance. */
  direction: Point;
}

/** How far back along each leg a corner starts rounding, in meters (capped per corner). */
export const ROUTE_CORNER_RADIUS_METERS = 0.8;
/** A corner may use at most this share of each adjacent segment, so consecutive corners never overlap. */
const MAX_CORNER_SHARE = 0.45;
const EPSILON = 1e-6;

/**
 * Geometry a smoothed corner must keep clear of. Both kinds are optional;
 * with neither, smoothing is unconstrained (the pre-clearance behavior).
 */
export interface RouteObstacles {
  /** Wall centerlines; a curve must stay at least `thickness / 2` from each. */
  walls?: ReadonlyArray<{ start: Point; end: Point; thickness: number }>;
  /** Closed rings (unclosed point lists) a curve must not cross into, e.g. space holes. */
  polygons?: ReadonlyArray<ReadonlyArray<Point>>;
}

/** The obstacles of one floor: its walls plus every space's holes. */
export function routeObstaclesForFloor(
  floor:
    | {
        walls?: ReadonlyArray<{ start: Point; end: Point; thickness: number }>;
        spaces?: ReadonlyArray<{ holes?: Point[][] }>;
      }
    | undefined,
): RouteObstacles | undefined {
  if (!floor) return undefined;
  return {
    walls: floor.walls ?? [],
    polygons: (floor.spaces ?? []).flatMap((space) => space.holes ?? []),
  };
}

/**
 * Builds the shape of one contiguous route run. `"smooth"` replaces every
 * corner with a quadratic Bézier between points `r` back along each leg,
 * using the corner itself as the control point, so the curve stays inside the
 * corner's triangle and never overshoots the polyline the way a Catmull-Rom
 * spline can. That alone does NOT keep it out of walls: the triangle cuts the
 * inside of the corner, which may be a wall or a hole even where the polyline
 * is clear. When `obstacles` is given, each corner's radius is shrunk until
 * the curve comes no closer to any wall than `thickness / 2` (or than the
 * replaced polyline already was) and touches no obstacle edge the polyline
 * didn't; if no radius works the corner stays sharp. Without `obstacles` the
 * output is unchanged. Returns null for fewer than two distinct points.
 */
export function buildRoutePath(
  input: readonly Point[],
  shape: RouteCurveShape,
  cornerRadius = ROUTE_CORNER_RADIUS_METERS,
  obstacles?: RouteObstacles,
): RoutePath | null {
  const points: Point[] = [];
  for (const p of input) {
    const last = points.at(-1);
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > EPSILON) points.push({ x: p.x, y: p.y });
  }
  if (points.length < 2) return null;

  const shaped =
    shape === "smooth" && cornerRadius > 0
      ? roundCorners(points, cornerRadius, prepareObstacles(obstacles))
      : points;
  const distances: number[] = [0];
  const kept: Point[] = [shaped[0] as Point];
  for (let i = 1; i < shaped.length; i++) {
    const p = shaped[i] as Point;
    const prev = kept.at(-1) as Point;
    const step = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (step <= EPSILON) continue;
    kept.push(p);
    distances.push((distances.at(-1) as number) + step);
  }
  if (kept.length < 2) return null;
  return { points: kept, distances, length: distances.at(-1) as number };
}

/** One obstacle edge with the clearance a curve must keep from it, plus its bounding box. */
interface ObstacleSegment {
  a: Point;
  b: Point;
  clearance: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Radius tries per corner: the full radius, then this factor smaller each time. */
const RADIUS_SHRINK = 0.6;
const RADIUS_ATTEMPTS = 8;

function prepareObstacles(obstacles: RouteObstacles | undefined): ObstacleSegment[] {
  if (!obstacles) return [];
  const segments: ObstacleSegment[] = [];
  const push = (a: Point, b: Point, clearance: number) =>
    segments.push({
      a,
      b,
      clearance,
      minX: Math.min(a.x, b.x) - clearance,
      minY: Math.min(a.y, b.y) - clearance,
      maxX: Math.max(a.x, b.x) + clearance,
      maxY: Math.max(a.y, b.y) + clearance,
    });
  for (const wall of obstacles.walls ?? []) {
    push(wall.start, wall.end, Math.max(0, wall.thickness / 2));
  }
  for (const ring of obstacles.polygons ?? []) {
    for (let i = 0; i < ring.length; i++) {
      push(ring[i] as Point, ring[(i + 1) % ring.length] as Point, 0);
    }
  }
  return segments;
}

/** Distance between segments [a, b] and [c, d] (0 when they touch or cross). */
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentIntersection({ a, b }, { a: c, b: d })) return 0;
  return Math.min(
    distanceToSegment(a, c, d).distance,
    distanceToSegment(b, c, d).distance,
    distanceToSegment(c, a, b).distance,
    distanceToSegment(d, a, b).distance,
  );
}

function polylineDistance(line: readonly Point[], seg: ObstacleSegment): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1 && best > 0; i++) {
    best = Math.min(best, segmentDistance(line[i] as Point, line[i + 1] as Point, seg.a, seg.b));
  }
  return best;
}

/**
 * True when `curve` (replacing the straight `original` p1 -> corner -> p2)
 * keeps clear of every obstacle: it may come no closer to a segment than that
 * segment's clearance, or than the original already was (a route legitimately
 * passes through doorways cut into walls), and may not touch a segment the
 * original didn't touch.
 */
function curveIsClear(
  curve: readonly Point[],
  original: readonly Point[],
  obstacles: readonly ObstacleSegment[],
): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of original) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  for (const seg of obstacles) {
    // The curve lies inside the original's triangle, so the triangle's bbox bounds it.
    if (seg.maxX < minX || seg.minX > maxX || seg.maxY < minY || seg.minY > maxY) continue;
    const curveDist = polylineDistance(curve, seg);
    if (curveDist > 0 && curveDist >= seg.clearance) continue;
    const originalDist = polylineDistance(original, seg);
    if (curveDist <= 0 && originalDist > 0) return false;
    if (curveDist < Math.min(seg.clearance, originalDist) - EPSILON) return false;
  }
  return true;
}

function bezierCorner(p1: Point, p: Point, p2: Point, steps: number): Point[] {
  const out: Point[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const w0 = (1 - t) * (1 - t);
    const w1 = 2 * (1 - t) * t;
    const w2 = t * t;
    out.push({
      x: w0 * p1.x + w1 * p.x + w2 * p2.x,
      y: w0 * p1.y + w1 * p.y + w2 * p2.y,
    });
  }
  return out;
}

function roundCorners(
  points: readonly Point[],
  cornerRadius: number,
  obstacles: readonly ObstacleSegment[],
): Point[] {
  const out: Point[] = [points[0] as Point];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1] as Point;
    const p = points[i] as Point;
    const b = points[i + 1] as Point;
    const lenA = Math.hypot(a.x - p.x, a.y - p.y);
    const lenB = Math.hypot(b.x - p.x, b.y - p.y);
    const ua = { x: (a.x - p.x) / lenA, y: (a.y - p.y) / lenA };
    const ub = { x: (b.x - p.x) / lenB, y: (b.y - p.y) / lenB };
    const cos = ua.x * ub.x + ua.y * ub.y;
    // Nearly collinear: no visible corner to round.
    if (cos < -0.9995) {
      out.push(p);
      continue;
    }
    const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, cos)));
    const steps = Math.max(2, Math.ceil(turn / (Math.PI / 16)));
    let r = Math.min(cornerRadius, lenA * MAX_CORNER_SHARE, lenB * MAX_CORNER_SHARE);
    let corner: Point[] | null = null;
    for (let attempt = 0; attempt < RADIUS_ATTEMPTS && r > EPSILON; attempt++, r *= RADIUS_SHRINK) {
      const p1 = { x: p.x + ua.x * r, y: p.y + ua.y * r };
      const p2 = { x: p.x + ub.x * r, y: p.y + ub.y * r };
      const curve = bezierCorner(p1, p, p2, steps);
      if (obstacles.length === 0 || curveIsClear(curve, [p1, p, p2], obstacles)) {
        corner = curve;
        break;
      }
    }
    // No radius keeps clear: keep the sharp corner, i.e. the original polyline.
    if (corner) out.push(...corner);
    else out.push(p);
  }
  out.push(points.at(-1) as Point);
  return out;
}

/** Index of the segment [i, i+1] containing `distance` (clamped to the path). */
export function segmentIndexAt(path: RoutePath, distance: number): number {
  const { distances } = path;
  let lo = 0;
  let hi = distances.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((distances[mid] as number) <= distance) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Position and direction of travel `distance` meters along the path (clamped to its ends). */
export function sampleRoutePath(path: RoutePath, distance: number): RoutePathSample {
  const d = Math.max(0, Math.min(path.length, distance));
  const i = segmentIndexAt(path, d);
  const a = path.points[i] as Point;
  const b = path.points[i + 1] as Point;
  const d0 = path.distances[i] as number;
  const seg = (path.distances[i + 1] as number) - d0;
  const t = seg > 0 ? (d - d0) / seg : 0;
  return {
    point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    direction: { x: (b.x - a.x) / seg, y: (b.y - a.y) / seg },
  };
}

/** Splits every segment longer than `maxStep` so a draw range can track progress finely. */
export function densifyRoutePath(path: RoutePath, maxStep: number): RoutePath {
  const points: Point[] = [path.points[0] as Point];
  const distances: number[] = [0];
  for (let i = 0; i < path.points.length - 1; i++) {
    const a = path.points[i] as Point;
    const b = path.points[i + 1] as Point;
    const d0 = path.distances[i] as number;
    const seg = (path.distances[i + 1] as number) - d0;
    const parts = Math.max(1, Math.ceil(seg / maxStep));
    for (let s = 1; s <= parts; s++) {
      const t = s / parts;
      points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      distances.push(d0 + seg * t);
    }
  }
  return { points, distances, length: path.length };
}
