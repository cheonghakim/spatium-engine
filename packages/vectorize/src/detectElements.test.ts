import { describe, expect, it } from "vitest";
import { detectElements } from "./detectElements.js";
import type { DraftWall } from "./vectorizeFloorPlan.js";

const wall = (x1: number, y1: number, x2: number, y2: number, thickness = 0.2): DraftWall => ({
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
  thickness,
});

/** A grid of `rows` x `cols` unit-cell rooms (shared walls, no gaps) — a large, realistic wall set for the perf regression test below. */
function buildWallGrid(rows: number, cols: number, cell = 1, thickness = 0.15): DraftWall[] {
  const walls: DraftWall[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++)
      walls.push(wall(c * cell, r * cell, (c + 1) * cell, r * cell, thickness));
  }
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r < rows; r++)
      walls.push(wall(c * cell, r * cell, c * cell, (r + 1) * cell, thickness));
  }
  return walls;
}

describe("building element candidates", () => {
  it("proposes an unclassified gap instead of claiming to recognize a door", () => {
    const candidates = detectElements([wall(0, 0, 2, 0), wall(3, 0, 6, 0)]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ type: "opening", width: 1, position: { x: 2.5, y: 0 } });
    expect(candidates[0]?.supportWall).toMatchObject({
      start: { x: 2, y: 0 },
      end: { x: 3, y: 0 },
    });
  });
  it("does not bridge another wall, junction, tiny scan defect or a large gap", () => {
    expect(detectElements([wall(0, 0, 2, 0), wall(3, 0, 6, 0), wall(2.5, 0, 2.5, 3)])).toEqual([]);
    expect(detectElements([wall(0, 0, 2, 0), wall(2.1, 0, 6, 0)])).toEqual([]);
    expect(detectElements([wall(0, 0, 2, 0), wall(5, 0, 6, 0)])).toEqual([]);
  });
  it("groups regularly spaced treads and identifies exactly the replaced wall strokes", () => {
    const strokes = Array.from({ length: 8 }, (_, i) => wall(0, i * 0.28, 1.2, i * 0.28, 0.04));
    const candidates = detectElements(strokes);
    const stairs = candidates.filter((c) => c.type === "stairs");
    expect(stairs).toHaveLength(1);
    expect(stairs[0]).toMatchObject({
      width: 1.2,
      stepCount: 8,
      rotation: 90,
      replacesWallIndices: [0, 1, 2, 3, 4, 5, 6, 7],
    });
    expect(stairs[0]?.depth).toBeCloseTo(2.24);
    expect(stairs[0]?.height).toBeUndefined();
  });
  it("does not classify a few furniture lines as stairs", () => {
    expect(
      detectElements([
        wall(0, 0, 1, 0, 0.04),
        wall(0, 0.3, 1, 0.3, 0.04),
        wall(0, 0.6, 1, 0.6, 0.04),
      ]),
    ).toEqual([]);
  });

  it("stays fast on a large wall set (regression guard for the former O(n^3) opening scan)", () => {
    // ~5100 walls, matching the scale that profiling showed taking 4.2s (and, before the
    // bucketed fix, ~1.15s even in a lightly-loaded standalone benchmark) under the old
    // exhaustive pairwise + exhaustive obstruction scan. The budget below is deliberately
    // generous (observed ~350-400ms in isolation, ~650-700ms under full-monorepo parallel
    // `pnpm -r test` CPU contention) so this guards against a real algorithmic regression
    // back toward O(n^3) without flaking under CI/parallel-run jitter.
    const walls = buildWallGrid(50, 50);
    const start = performance.now();
    detectElements(walls);
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(3000);
  });
});

describe("non-axis-aligned walls (general detectElements API, not reachable via the shipped pixel-scan pipeline)", () => {
  it("still finds an opening bridged by a short, steep, non-axis-aligned wall once minWallLengthM allows it", () => {
    // Reviewer-reported counter-example: the opening-pairing fast path buckets
    // candidate walls by an isHorizontal classification *before* running the
    // real cross/project tolerance test. A long horizontal wall (A) plus a
    // short (~0.08m), steep (mostly-vertical) wall (B) whose endpoints both
    // land within the 0.04m perpendicular tolerance of A's line should be
    // found by the original exhaustive algorithm — but B gets classified
    // "vertical" while A is "horizontal", so a naive bucket split that never
    // compares across orientations misses the pair entirely.
    const longHorizontalWall = wall(0, 0, 2, 0);
    // dx=0.04, dy=0.07 => length ~0.0806m, |uy| (0.868) > |ux| (0.496) so this
    // is classified "vertical" even though it is not axis-aligned at all.
    const shortSteepWall = wall(2.6, -0.035, 2.64, 0.035);
    const candidates = detectElements([longHorizontalWall, shortSteepWall], {
      minWallLengthM: 0.05,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ type: "opening" });
    expect(candidates[0]?.width).toBeCloseTo(0.6, 2);
  });
});

describe("DetectElementsOptions", () => {
  it("uses the configured opening gap range instead of the hardcoded default", () => {
    // A 0.3m gap is scan noise under the default 0.55m minimum, but a real candidate once the minimum is lowered.
    expect(detectElements([wall(0, 0, 2, 0), wall(2.3, 0, 5, 0)])).toEqual([]);
    const candidates = detectElements([wall(0, 0, 2, 0), wall(2.3, 0, 5, 0)], {
      minOpeningGapM: 0.2,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.type).toBe("opening");
    expect(candidates[0]?.width).toBeCloseTo(0.3);
  });

  it("uses the configured tread count and spacing instead of the hardcoded defaults", () => {
    const strokes = Array.from({ length: 4 }, (_, i) => wall(0, i * 0.28, 1.2, i * 0.28, 0.04));
    expect(detectElements(strokes)).toEqual([]);
    const candidates = detectElements(strokes, { minTreadCount: 4 });
    expect(candidates.filter((c) => c.type === "stairs")).toHaveLength(1);
  });
});
