import type { Entrance, Point } from "@indoor/core";
import type { DraftWall } from "./vectorizeFloorPlan.js";

export interface DraftElement extends Pick<
  Entrance,
  "type" | "position" | "width" | "height" | "depth" | "rotation" | "stepCount" | "sillHeight"
> {
  confidence: number;
  reason: string;
  /** Added only if this candidate is accepted; restores the lintel/sill across a gap. */
  supportWall?: DraftWall;
  /** Existing wall strokes replaced by the accepted architectural element. */
  replacesWallIndices?: number[];
}

/** Tunable geometric thresholds for candidate detection; defaults match the original hardcoded heuristics. */
export interface DetectElementsOptions {
  /** Below this width (m), a gap between two collinear walls is a scan defect, not a door/window opening. */
  minOpeningGapM?: number;
  /** Above this width (m), a gap is too wide to read as a single door/window opening. */
  maxOpeningGapM?: number;
  /** Minimum wall run length (m) eligible to be paired across a candidate opening. */
  minWallLengthM?: number;
  /** Minimum spacing (m) between adjacent stair-tread strokes. */
  minTreadSpacingM?: number;
  /** Maximum spacing (m) between adjacent stair-tread strokes. */
  maxTreadSpacingM?: number;
  /** Stair-tread candidate run width bounds (m). */
  minTreadWidthM?: number;
  maxTreadWidthM?: number;
  /** Maximum stroke thickness (m) for a wall to be considered a tread. */
  maxTreadThicknessM?: number;
  /** Minimum number of regularly spaced treads required to report a staircase candidate. */
  minTreadCount?: number;
}

const DETECT_ELEMENTS_DEFAULTS: Required<DetectElementsOptions> = {
  minOpeningGapM: 0.55,
  maxOpeningGapM: 2.4,
  minWallLengthM: 0.4,
  minTreadSpacingM: 0.16,
  maxTreadSpacingM: 0.4,
  minTreadWidthM: 0.6,
  maxTreadWidthM: 3,
  maxTreadThicknessM: 0.12,
  minTreadCount: 5,
};

// Perpendicular tolerance for the opening-pairing collinearity test below
// (`cross(...) > OPENING_CROSS_TOLERANCE_M`). Named so the bucketing safety
// margin derived from it (`MIN_CONFIDENT_BUCKET_LENGTH_M`) stays traceable
// to the same number instead of a second hardcoded 0.04.
const OPENING_CROSS_TOLERANCE_M = 0.04;

// Spatial-index bucket width (m) for the opening search below. It must be
// <= the tightest tolerance it stands in for (the 0.04m collinearity check)
// so two values within that tolerance can never land more than one bucket
// apart — see `bucketRadius`.
const BUCKET_WIDTH_M = 0.08;

function bucketOf(value: number): number {
  return Math.floor(value / BUCKET_WIDTH_M);
}

/** Bucket radius to check so no pair within `toleranceM` is missed, however it straddles a bucket boundary. */
function bucketRadius(toleranceM: number): number {
  return Math.max(1, Math.ceil(toleranceM / BUCKET_WIDTH_M));
}

interface IndexedPoint {
  index: number;
  point: Point;
}

// A wall's direction is classified `isHorizontal` by comparing |ux| to |uy|
// — i.e. by which side of the 45-degree line it falls on. Routing a wall
// straight into its own orientation's bucket (and never comparing it
// against the *other* orientation's bucket) is only safe if no wall on the
// other side of that boundary could possibly still pass the collinearity
// test above (`cross(...) > OPENING_CROSS_TOLERANCE_M`) against it.
//
// For a wall W with unit direction (ux, uy) and length L, the angular gap
// between W's own direction and the *nearest* possible direction on the
// other side of the 45-degree boundary is bounded below by the angle
// between W and the boundary itself, whose sine is the magnitude of the
// cross product between W's direction and the unit boundary direction
// (√2/2, √2/2):
//   sin(gap) >= (√2 / 2) * | |ux| - |uy| |
// Two walls A and B can only both satisfy the collinearity test if
// whichever one is being tested (say B, against A's line) has both
// endpoints within OPENING_CROSS_TOLERANCE_M of that line, i.e. its
// endpoints' perpendicular spread L_B * sin(angle(A, B)) is at most
// 2 * OPENING_CROSS_TOLERANCE_M. Since angle(A, B) >= gap above whenever A
// and B are classified into opposite buckets, a wall is safe to restrict to
// its own bucket whenever
//   L * (√2 / 2) * | |ux| - |uy| | > 2 * OPENING_CROSS_TOLERANCE_M
// i.e. once `length * axisSkew` (computed per wall as `confident` below)
// clears this bound. Walls that don't clear it — short and/or close enough
// to 45 degrees to be genuinely diagonal — are excluded from the fast
// per-orientation buckets and instead compared against every other wall,
// exactly like the original exhaustive scan.
//
// Every wall this package's own pixel scan ever produces is *exactly*
// horizontal or vertical (axisSkew = 1), so with the default minWallLengthM
// (0.4m, well above this bound) every real wall clears it and the fast path
// is always taken; the exhaustive fallback only ever triggers once a caller
// both lowers minWallLengthM below ~0.113m *and* supplies non-axis-aligned
// wall data directly to this exported function.
const MIN_CONFIDENT_BUCKET_LENGTH_M = 2 * OPENING_CROSS_TOLERANCE_M * Math.SQRT2; // ≈ 0.1131

/**
 * Conservative, scale-dependent geometric candidates, not a semantic classifier.
 *
 * Performance note: walls are produced by this package's own pixel scan, so
 * in practice they are always axis-aligned (horizontal or vertical). The
 * opening search below exploits that: two walls can only bridge a gap if
 * they run along (approximately) the same line, i.e. share an orientation
 * and a perpendicular offset (y for a horizontal wall, x for a vertical
 * one) within the existing tolerance. Bucketing walls (and, for the
 * obstruction check, wall endpoints) by that offset turns what was an
 * exhaustive "every wall against every other wall, each re-scanning every
 * wall" O(n^3) scan into an indexed lookup. A wall is only ever routed
 * through the fast per-orientation bucket when its own `confident` flag
 * proves no wall of the *other* orientation could pass the collinearity
 * test against it (see `MIN_CONFIDENT_BUCKET_LENGTH_M`); walls that don't
 * clear that bar — genuinely diagonal and/or too short, which this
 * package's own scan never produces — fall back to an exhaustive
 * comparison against every other wall. Results, including their order, are
 * therefore unchanged for arbitrary wall input, not just axis-aligned input.
 */
export function detectElements(
  walls: readonly DraftWall[],
  options: DetectElementsOptions = {},
): DraftElement[] {
  const opts = { ...DETECT_ELEMENTS_DEFAULTS, ...options };
  const result: DraftElement[] = [];
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  interface WallInfo {
    length: number;
    ux: number;
    uy: number;
    isHorizontal: boolean;
    offset: number;
    confident: boolean;
  }
  const info: WallInfo[] = walls.map((w) => {
    const length = distance(w.start, w.end);
    const ux = length ? (w.end.x - w.start.x) / length : 0;
    const uy = length ? (w.end.y - w.start.y) / length : 0;
    const isHorizontal = Math.abs(ux) >= Math.abs(uy);
    const offset = isHorizontal ? (w.start.y + w.end.y) / 2 : (w.start.x + w.end.x) / 2;
    // How far this wall's direction sits from the 45-degree h/v boundary,
    // scaled by its own length — see `MIN_CONFIDENT_BUCKET_LENGTH_M` above.
    // 1 for exactly axis-aligned walls (everything this package's own scan
    // emits), shrinking to 0 for a wall running exactly at 45 degrees.
    const axisSkew = Math.abs(Math.abs(ux) - Math.abs(uy));
    const confident = length * axisSkew > MIN_CONFIDENT_BUCKET_LENGTH_M;
    return { length, ux, uy, isHorizontal, offset, confident };
  });

  // Every wall endpoint, indexed by its coordinate along each axis, so the
  // obstruction check only visits points that could plausibly sit near a
  // candidate wall's line instead of re-scanning every wall.
  const byY = new Map<number, IndexedPoint[]>();
  const byX = new Map<number, IndexedPoint[]>();
  const addToIndex = (
    map: Map<number, IndexedPoint[]>,
    key: number,
    index: number,
    point: Point,
  ) => {
    let bucket = map.get(key);
    if (!bucket) map.set(key, (bucket = []));
    bucket.push({ index, point });
  };
  walls.forEach((w, index) => {
    for (const point of [w.start, w.end]) {
      addToIndex(byY, bucketOf(point.y), index, point);
      addToIndex(byX, bucketOf(point.x), index, point);
    }
  });
  const nearbyPoints = (
    map: Map<number, IndexedPoint[]>,
    offset: number,
    toleranceM: number,
  ): IndexedPoint[] => {
    const radius = bucketRadius(toleranceM);
    const center = bucketOf(offset);
    const items: IndexedPoint[] = [];
    for (let b = center - radius; b <= center + radius; b++) {
      const bucket = map.get(b);
      if (bucket) items.push(...bucket);
    }
    return items;
  };

  // Candidate walls for opening-pairing, bucketed by orientation + perpendicular offset.
  // Only walls whose `confident` flag is true go into a bucket at all —
  // everything else (too short and/or too close to the 45-degree boundary
  // to trust the isHorizontal split) is tracked separately in
  // `ambiguousIndices` and compared against every other wall below.
  const pairBuckets = new Map<string, number[]>();
  const ambiguousIndices: number[] = [];
  walls.forEach((_, index) => {
    if (info[index]!.length < opts.minWallLengthM) return;
    const { isHorizontal, offset, confident } = info[index]!;
    if (!confident) {
      ambiguousIndices.push(index);
      return;
    }
    const key = `${isHorizontal ? "h" : "v"}:${bucketOf(offset)}`;
    let bucket = pairBuckets.get(key);
    if (!bucket) pairBuckets.set(key, (bucket = []));
    bucket.push(index);
  });
  const collinearRadius = bucketRadius(OPENING_CROSS_TOLERANCE_M);
  // Candidates for a *confident* wall: its own orientation bucket (other
  // confident walls that could not possibly be found via the other
  // orientation's bucket) plus every ambiguous wall, since an ambiguous
  // wall's own classification can't be trusted to have put it in the right
  // (or wrong) bucket in the first place.
  const candidatesFor = (isHorizontal: boolean, offset: number): number[] => {
    const center = bucketOf(offset);
    const indices: number[] = [...ambiguousIndices];
    for (let b = center - collinearRadius; b <= center + collinearRadius; b++) {
      const bucket = pairBuckets.get(`${isHorizontal ? "h" : "v"}:${b}`);
      if (bucket) indices.push(...bucket);
    }
    // Buckets are built in ascending wall-index order and never overlap, so
    // this concatenation-then-sort reproduces the original ascending j scan.
    return indices.sort((a, b) => a - b);
  };

  for (let i = 0; i < walls.length; i++) {
    const a = walls[i]!,
      aInfo = info[i]!;
    const length = aInfo.length;
    if (length < opts.minWallLengthM) continue;
    const { ux, uy, isHorizontal, offset, confident } = aInfo;
    // An ambiguous wall can't trust its own bucket placement either, so it
    // is compared against every other wall (in ascending order, matching
    // the original exhaustive scan) instead of doing a bucket lookup.
    const candidates = confident
      ? candidatesFor(isHorizontal, offset)
      : Array.from({ length: walls.length - i - 1 }, (_, k) => i + 1 + k);
    for (const j of candidates) {
      if (j <= i) continue;
      const b = walls[j]!,
        bl = info[j]!.length;
      if (bl < opts.minWallLengthM || Math.abs(a.thickness - b.thickness) > 0.08) continue;
      const cross = (p: Point) => (p.x - a.start.x) * uy - (p.y - a.start.y) * ux;
      if (Math.max(Math.abs(cross(b.start)), Math.abs(cross(b.end))) > OPENING_CROSS_TOLERANCE_M)
        continue;
      const project = (p: Point) => (p.x - a.start.x) * ux + (p.y - a.start.y) * uy;
      const lo = Math.min(project(b.start), project(b.end)),
        hi = Math.max(project(b.start), project(b.end));
      const from = lo > length ? length : hi < 0 ? hi : 0;
      const to = lo > length ? lo : hi < 0 ? 0 : 0;
      const gap = to - from;
      if (gap < opts.minOpeningGapM || gap > opts.maxOpeningGapM) continue;
      const start = { x: a.start.x + ux * from, y: a.start.y + uy * from };
      const end = { x: a.start.x + ux * to, y: a.start.y + uy * to };
      const position = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      // Do not bridge a junction, another collinear wall, or a previously proposed gap.
      // For a confident (near-axis) `a`, its own orientation's index is enough
      // — for an ambiguous (genuinely diagonal) `a`, neither index alone is
      // guaranteed to cover it (its offset isn't reliably a y- or x-value), so
      // both are searched, each around a's actual center on that axis.
      const obstructionCandidates = confident
        ? nearbyPoints(isHorizontal ? byY : byX, offset, 0.15)
        : [
            ...nearbyPoints(byY, (a.start.y + a.end.y) / 2, 0.15),
            ...nearbyPoints(byX, (a.start.x + a.end.x) / 2, 0.15),
          ];
      const obstructed = obstructionCandidates.some(({ index: k, point: p }) => {
        if (k === i || k === j) return false;
        const t = project(p);
        return t > from + 0.04 && t < to - 0.04 && Math.abs(cross(p)) < 0.15;
      });
      if (obstructed || result.some((e) => distance(e.position, position) < 0.15)) continue;
      result.push({
        type: "opening",
        position,
        width: gap,
        rotation: (Math.atan2(uy, ux) * 180) / Math.PI,
        confidence: 0.55,
        reason: "같은 축의 벽 사이 틈입니다. 문·창문·통로인지 확인하세요.",
        supportWall: { start, end, thickness: (a.thickness + b.thickness) / 2 },
      });
    }
  }

  // Repeated, similarly sized parallel strokes suggest treads. Keep candidates unaccepted.
  const used = new Set<number>();
  for (let i = 0; i < walls.length; i++) {
    if (used.has(i)) continue;
    const base = walls[i]!,
      width = distance(base.start, base.end);
    if (
      width < opts.minTreadWidthM ||
      width > opts.maxTreadWidthM ||
      base.thickness > opts.maxTreadThicknessM
    )
      continue;
    const ux = (base.end.x - base.start.x) / width,
      uy = (base.end.y - base.start.y) / width;
    const center = { x: (base.start.x + base.end.x) / 2, y: (base.start.y + base.end.y) / 2 };
    const matches = walls
      .map((w, index) => {
        const len = distance(w.start, w.end),
          cx = (w.start.x + w.end.x) / 2 - center.x,
          cy = (w.start.y + w.end.y) / 2 - center.y;
        return { index, wall: w, offset: -uy * cx + ux * cy, along: ux * cx + uy * cy, len };
      })
      .filter(
        (m) =>
          !used.has(m.index) &&
          m.wall.thickness <= opts.maxTreadThicknessM &&
          Math.abs(m.len - width) < 0.12 &&
          Math.abs(m.along) < 0.08 &&
          Math.abs((m.wall.end.x - m.wall.start.x) * uy - (m.wall.end.y - m.wall.start.y) * ux) <
            0.04,
      )
      .sort((a, b) => a.offset - b.offset);
    const seed = matches.findIndex((m) => m.index === i);
    if (seed < 0) continue;
    let first = seed,
      last = seed;
    const validGap = (a: number, b: number) =>
      b - a >= opts.minTreadSpacingM && b - a <= opts.maxTreadSpacingM;
    while (first > 0 && validGap(matches[first - 1]!.offset, matches[first]!.offset)) first--;
    while (last + 1 < matches.length && validGap(matches[last]!.offset, matches[last + 1]!.offset))
      last++;
    const run = matches.slice(first, last + 1);
    if (run.length < opts.minTreadCount) continue;
    const spacing = (run[run.length - 1]!.offset - run[0]!.offset) / (run.length - 1);
    if (
      run.some((m, k) => k > 0 && Math.abs(m.offset - run[k - 1]!.offset - spacing) > spacing * 0.2)
    )
      continue;
    const middle = (run[0]!.offset + run[run.length - 1]!.offset) / 2;
    result.push({
      type: "stairs",
      position: { x: center.x - uy * middle, y: center.y + ux * middle },
      width,
      depth: spacing * run.length,
      stepCount: run.length,
      rotation: (Math.atan2(ux, -uy) * 180) / Math.PI,
      confidence: 0.65,
      reason: "일정 간격의 평행선입니다. 계단 여부·상행 방향·층고를 확인하세요.",
      replacesWallIndices: run.map((m) => m.index),
    });
    run.forEach((m) => used.add(m.index));
  }
  return result;
}
