import { describe, expect, it } from "vitest";
import type { Point } from "@indoor/core";
import {
  buildRoutePath,
  densifyRoutePath,
  routeObstaclesForFloor,
  sampleRoutePath,
} from "./routePath.js";

/** Shortest distance from `p` to the polyline through `line`. */
function distanceToPolyline(p: Point, line: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i] as Point;
    const b = line[i + 1] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

describe("buildRoutePath", () => {
  const zigzag: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 0.6 }, // short jog: the kind of uneven spacing that made Catmull-Rom overshoot
    { x: 20, y: 0.6 },
    { x: 20, y: 12 },
  ];

  it("returns null for fewer than two distinct points", () => {
    expect(buildRoutePath([], "smooth")).toBeNull();
    expect(buildRoutePath([{ x: 1, y: 1 }], "straight")).toBeNull();
    expect(
      buildRoutePath(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        "smooth",
      ),
    ).toBeNull();
  });

  it("keeps the input polyline exactly for the straight shape", () => {
    const path = buildRoutePath(zigzag, "straight")!;
    expect(path.points).toEqual(zigzag);
    expect(path.length).toBeCloseTo(10 + 0.6 + 10 + 11.4);
  });

  it("rounds corners without leaving the corner's neighbourhood (no overshoot)", () => {
    const path = buildRoutePath(zigzag, "smooth")!;
    expect(path.points[0]).toEqual(zigzag[0]);
    expect(path.points.at(-1)).toEqual(zigzag.at(-1));
    // A corner cut by at most r=0.8 m deviates from the polyline by well under r.
    for (const p of path.points) expect(distanceToPolyline(p, zigzag)).toBeLessThan(0.6);
    // Every sample stays inside the bounding box of the input — a spline overshoot would not.
    for (const p of path.points) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(20 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeLessThanOrEqual(12 + 1e-9);
    }
    expect(path.length).toBeLessThan(buildRoutePath(zigzag, "straight")!.length);
  });

  it("keeps distances monotonic and consistent with the points", () => {
    const path = buildRoutePath(zigzag, "smooth")!;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1]!;
      const b = path.points[i]!;
      expect(path.distances[i]! - path.distances[i - 1]!).toBeCloseTo(
        Math.hypot(b.x - a.x, b.y - a.y),
      );
    }
    expect(path.length).toBe(path.distances.at(-1));
  });
});

describe("sampleRoutePath", () => {
  it("interpolates position and reports the travel direction, clamped at the ends", () => {
    const path = buildRoutePath(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
      ],
      "straight",
    )!;
    expect(sampleRoutePath(path, 2)).toEqual({ point: { x: 2, y: 0 }, direction: { x: 1, y: 0 } });
    const onSecond = sampleRoutePath(path, 5.5);
    expect(onSecond.point.x).toBeCloseTo(4);
    expect(onSecond.point.y).toBeCloseTo(1.5);
    expect(onSecond.direction).toEqual({ x: 0, y: 1 });
    expect(sampleRoutePath(path, -3).point).toEqual({ x: 0, y: 0 });
    expect(sampleRoutePath(path, 99).point).toEqual({ x: 4, y: 3 });
  });

  it("samples a point on the drawn shape for the smooth curve too", () => {
    const path = buildRoutePath(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ],
      "smooth",
    )!;
    for (let d = 0; d <= path.length; d += 0.37) {
      expect(distanceToPolyline(sampleRoutePath(path, d).point, path.points)).toBeLessThan(1e-9);
    }
  });
});

describe("densifyRoutePath", () => {
  it("splits long segments without changing the shape or length", () => {
    const path = buildRoutePath(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      "straight",
    )!;
    const dense = densifyRoutePath(path, 0.25);
    expect(dense.points).toHaveLength(5);
    expect(dense.distances).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(dense.length).toBe(1);
  });
});

describe("buildRoutePath with obstacles", () => {
  const corner: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  function pointSegmentDistance(p: Point, a: Point, b: Point): number {
    return distanceToPolyline(p, [a, b]);
  }

  function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
    const orient = (p: Point, q: Point, r: Point) =>
      (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    return o1 * o2 < 0 && o3 * o4 < 0;
  }

  /** Shortest distance from any drawn segment of `path` to the wall centerline. */
  function clearanceTo(points: readonly Point[], a: Point, b: Point): number {
    let best = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      const p = points[i]!;
      const q = points[i + 1]!;
      if (segmentsCross(p, q, a, b)) return 0;
      best = Math.min(
        best,
        pointSegmentDistance(p, a, b),
        pointSegmentDistance(q, a, b),
        pointSegmentDistance(a, p, q),
        pointSegmentDistance(b, p, q),
      );
    }
    return best;
  }

  function isInside(p: Point, ring: readonly Point[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  it("is unchanged without obstacles, with empty obstacles, or with far-away ones", () => {
    const zigzag: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0.6 },
      { x: 20, y: 0.6 },
      { x: 20, y: 12 },
    ];
    const plain = buildRoutePath(zigzag, "smooth")!;
    expect(buildRoutePath(zigzag, "smooth", undefined, undefined)).toEqual(plain);
    expect(buildRoutePath(zigzag, "smooth", undefined, {})).toEqual(plain);
    expect(buildRoutePath(zigzag, "smooth", undefined, { walls: [], polygons: [] })).toEqual(plain);
    expect(
      buildRoutePath(zigzag, "smooth", undefined, {
        walls: [{ start: { x: 50, y: 50 }, end: { x: 60, y: 50 }, thickness: 0.2 }],
        polygons: [
          [
            { x: -10, y: -10 },
            { x: -5, y: -10 },
            { x: -5, y: -5 },
          ],
        ],
      }),
    ).toEqual(plain);
    // The straight shape ignores obstacles entirely.
    expect(
      buildRoutePath(zigzag, "straight", undefined, {
        walls: [{ start: { x: 9.9, y: 0.1 }, end: { x: 9, y: 1 }, thickness: 1 }],
      })!.points,
    ).toEqual(zigzag);
  });

  it("shrinks a corner whose full-radius curve would come within half a wall's thickness", () => {
    // A thick wall ending just inside the corner: the polyline keeps 0.3 m (> 0.2 m) from
    // it, the default 0.8 m curve would pass ~0.14 m from its end.
    const wall = { start: { x: 9.7, y: 0.3 }, end: { x: 9.7, y: 10 }, thickness: 0.4 };
    const unconstrained = buildRoutePath(corner, "smooth")!;
    expect(clearanceTo(unconstrained.points, wall.start, wall.end)).toBeLessThan(0.2);

    const path = buildRoutePath(corner, "smooth", undefined, { walls: [wall] })!;
    expect(clearanceTo(path.points, wall.start, wall.end)).toBeGreaterThanOrEqual(0.2 - 1e-6);
    // Still a curve (not the sharp corner), just a tighter one.
    expect(path.points).not.toContainEqual({ x: 10, y: 0 });
    expect(path.length).toBeLessThan(20);
    expect(path.length).toBeGreaterThan(unconstrained.length);
  });

  it("falls back to the sharp corner when no radius keeps clear", () => {
    // A thin partition reaching almost into the corner point: every curve crosses it.
    const wall = { start: { x: 9.999, y: 0.001 }, end: { x: 5, y: 5 }, thickness: 0 };
    const path = buildRoutePath(corner, "smooth", undefined, { walls: [wall] })!;
    expect(path.points).toEqual(corner);
    expect(path.length).toBeCloseTo(20);
    expect(clearanceTo(path.points, wall.start, wall.end)).toBeGreaterThan(0);
  });

  it("keeps the curve out of a space hole inside the corner", () => {
    const hole: Point[] = [
      { x: 5, y: 0.1 },
      { x: 9.9, y: 0.1 },
      { x: 9.9, y: 5 },
      { x: 5, y: 5 },
    ];
    const unconstrained = buildRoutePath(corner, "smooth")!;
    expect(unconstrained.points.some((p) => isInside(p, hole))).toBe(true);

    const obstacles = routeObstaclesForFloor({ walls: [], spaces: [{ holes: [hole] }, {}] });
    const path = buildRoutePath(corner, "smooth", undefined, obstacles)!;
    for (const p of path.points) expect(isInside(p, hole)).toBe(false);
    for (let i = 0; i < hole.length; i++) {
      expect(clearanceTo(path.points, hole[i]!, hole[(i + 1) % hole.length]!)).toBeGreaterThan(0);
    }
    expect(path.points).not.toContainEqual({ x: 10, y: 0 });
  });

  it("stays inside a narrow L corridor", () => {
    // 0.2 m-wide corridor faces (centerlines ±0.2 m, 0.2 m thick) around the centerline route.
    const walls = [
      { start: { x: 0, y: 0.2 }, end: { x: 9.8, y: 0.2 }, thickness: 0.2 },
      { start: { x: 9.8, y: 0.2 }, end: { x: 9.8, y: 10 }, thickness: 0.2 },
      { start: { x: 0, y: -0.2 }, end: { x: 10.2, y: -0.2 }, thickness: 0.2 },
      { start: { x: 10.2, y: -0.2 }, end: { x: 10.2, y: 10 }, thickness: 0.2 },
    ];
    const unconstrained = buildRoutePath(corner, "smooth")!;
    expect(
      Math.min(...walls.map((w) => clearanceTo(unconstrained.points, w.start, w.end))),
    ).toBeLessThan(0.1);

    const path = buildRoutePath(corner, "smooth", undefined, { walls })!;
    for (const w of walls) {
      expect(clearanceTo(path.points, w.start, w.end)).toBeGreaterThanOrEqual(0.1 - 1e-6);
    }
    expect(path.points[0]).toEqual(corner[0]);
    expect(path.points.at(-1)).toEqual(corner[2]);
  });

  it("does not let a doorway wall the route already crosses block smoothing", () => {
    // The route passes through a door in this wall on the first leg, far from the corner.
    const wall = { start: { x: 5, y: -3 }, end: { x: 5, y: 3 }, thickness: 0.2 };
    const path = buildRoutePath(corner, "smooth", undefined, { walls: [wall] })!;
    expect(path).toEqual(buildRoutePath(corner, "smooth"));
  });
});
