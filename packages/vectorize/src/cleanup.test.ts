import { describe, expect, it } from "vitest";
import {
  dominantWallThickness,
  mergeCollinearEdges,
  pruneGraph,
  splitWallSegments,
  unionCollinearSegments,
} from "./cleanup.js";
import { vectorizeFloorPlan } from "./vectorizeFloorPlan.js";
import { addNoise, doubleLinePlan, rescale, syntheticPlan } from "./planFixture.js";

const seg = (
  orientation: "horizontal" | "vertical",
  offset: number,
  start: number,
  end: number,
  thicknessPx: number,
) => ({ orientation, offset, start, end, thicknessPx });

describe("wall stroke selection", () => {
  it("estimates the wall thickness from the heavy, long strokes", () => {
    const segments = [
      seg("horizontal", 10, 0, 600, 12), // walls
      seg("vertical", 10, 0, 400, 12),
      ...Array.from({ length: 30 }, (_, i) => seg("horizontal", 50 + i * 5, 0, 60, 2)), // clutter
    ];
    expect(dominantWallThickness(segments)).toBe(12);
  });

  it("sets thin clutter aside, but leaves an all-thin-line plan alone", () => {
    const mixed = [seg("horizontal", 0, 0, 300, 10), seg("horizontal", 40, 0, 300, 2)];
    const split = splitWallSegments(mixed, 1, true);
    expect(split.walls.map((s) => s.thicknessPx)).toEqual([10]);
    expect(split.thin.map((s) => s.thicknessPx)).toEqual([2]);

    const allThin = [seg("horizontal", 0, 0, 300, 2), seg("horizontal", 40, 0, 300, 1)];
    expect(splitWallSegments(allThin, 1, true).walls).toHaveLength(2);
    expect(splitWallSegments(mixed, 1, false).walls).toHaveLength(2);
  });

  it("drops blobs (scanned across a filled area: thicker than long)", () => {
    const blob = seg("horizontal", 200, 0, 19, 400);
    expect(splitWallSegments([blob], 1, false).walls).toHaveLength(0);
  });

  it("fuses strokes on one wall line that overlap or nearly touch", () => {
    const fused = unionCollinearSegments(
      [
        seg("horizontal", 100, 0, 220, 12),
        seg("horizontal", 103, 218, 600, 10),
        seg("horizontal", 160, 0, 600, 12), // a different line
      ],
      4,
    );
    expect(fused).toHaveLength(2);
    expect(fused[0]).toMatchObject({ start: 0, end: 600, thicknessPx: 12 });
  });
});

describe("wall graph cleanup", () => {
  it("prunes corner overhang stubs and specks, then re-indexes", () => {
    // An L corner whose horizontal wall overhangs the joint by 5 px, plus a free speck.
    const graph = {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 105, y: 0 },
        { x: 100, y: 100 },
        { x: 300, y: 300 },
        { x: 306, y: 300 },
      ],
      edges: [
        { from: 0, to: 1, thicknessPx: 10 },
        { from: 1, to: 2, thicknessPx: 10 },
        { from: 1, to: 3, thicknessPx: 10 },
        { from: 4, to: 5, thicknessPx: 2 },
      ],
    };
    const pruned = pruneGraph(graph, { stubPx: 8, minComponentPx: 30 });
    expect(pruned.edges).toHaveLength(2);
    expect(pruned.points).toHaveLength(3);
  });

  it("drops groups that float apart from the main wall structure (dimension strings, paving)", () => {
    // A 400×300 building outline, plus a separate 120 px "wall" (a paired dimension string).
    const graph = {
      points: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
        { x: 0, y: -60 },
        { x: 120, y: -60 },
      ],
      edges: [
        { from: 0, to: 1, thicknessPx: 10 },
        { from: 1, to: 2, thicknessPx: 10 },
        { from: 2, to: 3, thicknessPx: 10 },
        { from: 3, to: 0, thicknessPx: 10 },
        { from: 4, to: 5, thicknessPx: 12 },
      ],
    };
    const dropped: number[] = [];
    const kept = pruneGraph(graph, {
      stubPx: 4,
      minComponentPx: 30,
      minComponentShare: 0.1,
      onDropped: (a, b) => dropped.push(Math.hypot(b.x - a.x, b.y - a.y)),
    });
    expect(kept.edges).toHaveLength(4);
    expect(dropped).toEqual([120]);
    // Without the share rule the lone piece (≥ 30 px) stays.
    expect(pruneGraph(graph, { stubPx: 4, minComponentPx: 30 }).edges).toHaveLength(5);
  });

  it("joins edges running straight through junctions into one wall", () => {
    // A long line crossed by a T at its middle → the long line stays one wall.
    const graph = {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 100, y: 80 },
      ],
      edges: [
        { from: 0, to: 1, thicknessPx: 10 },
        { from: 1, to: 2, thicknessPx: 10 },
        { from: 1, to: 3, thicknessPx: 6 },
      ],
    };
    const chains = mergeCollinearEdges(graph);
    expect(chains).toHaveLength(2);
    expect(chains[0]).toMatchObject({ from: 0, to: 2, thicknessPx: 10 });
  });
});

describe("vectorizing a cluttered plan", () => {
  const world = (metersPerPixel: number) => (p: { x: number; y: number }) => ({
    x: p.x * metersPerPixel,
    y: p.y * metersPerPixel,
  });

  it("keeps the walls and rooms, not furniture/text/dimension/door-leaf strokes", () => {
    const { image, metersPerPixel } = syntheticPlan();
    const result = vectorizeFloorPlan(image, world(metersPerPixel));
    // 4 exterior walls (the top one split by the window) + 6 interior runs split by doors.
    expect(result.walls).toHaveLength(11);
    expect(result.spaces).toHaveLength(4);
    // No stub walls left at the corners.
    for (const wall of result.walls)
      expect(Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)).toBeGreaterThan(0.5);
    // The three doors and the window are offered as opening candidates.
    expect(result.elements.filter((e) => e.supportWall)).toHaveLength(4);
  });

  it("still finds a staircase drawn with thin treads", () => {
    const { image, metersPerPixel } = syntheticPlan({ withStairs: true });
    const result = vectorizeFloorPlan(image, world(metersPerPixel));
    const stairs = result.elements.find((e) => e.type === "stairs");
    expect(stairs).toBeDefined();
    // The treads it replaces are brought back as (replaceable) walls after the real ones.
    expect(stairs!.replacesWallIndices!.length).toBeGreaterThanOrEqual(5);
    expect(Math.min(...stairs!.replacesWallIndices!)).toBeGreaterThanOrEqual(11);
    expect(result.spaces).toHaveLength(4);
  });

  it("does not restore exterior dimension ticks as stair walls", () => {
    const { image, metersPerPixel } = syntheticPlan({ withStairs: true });
    for (let k = 0; k < 8; k++)
      for (let y = 150 + k * 12; y < 152 + k * 12; y++)
        for (let x = 10; x < 70; x++) {
          const i = (y * image.width + x) * 4;
          image.data[i] = image.data[i + 1] = image.data[i + 2] = 30;
        }
    const result = vectorizeFloorPlan(image, world(metersPerPixel));
    expect(result.elements.filter((e) => e.type === "stairs")).toHaveLength(1);
    expect(result.walls.every((w) => Math.min(w.start.x, w.end.x) > 1.9)).toBe(true);
    expect(result.spaces).toHaveLength(4);
  });
});

describe("vectorizing a plan drawn with double-line walls (scanned)", () => {
  it("pairs thin interior faces even when exterior walls are filled", () => {
    const width = 400,
      height = 300;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 40; y < 260; y++)
      for (let x = 40; x < 360; x++) {
        const exterior = x < 48 || x >= 352 || y < 48 || y >= 252;
        const interior = (x === 197 || x === 203) && (y < 100 || y >= 140);
        if (!exterior && !interior) continue;
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 30;
      }
    const result = vectorizeFloorPlan({ width, height, data }, (p) => ({
      x: p.x * 0.02,
      y: p.y * 0.02,
    }));
    expect(result.spaces).toHaveLength(2);
    const interior = result.walls.filter(
      (w) => Math.abs(w.start.x - 4) < 0.01 && Math.abs(w.end.x - 4) < 0.01,
    );
    expect(interior).toHaveLength(2);
    for (const wall of interior) expect(wall.thickness).toBeCloseTo(0.14);
  });

  const studio = {
    minWallThicknessPx: 2,
    minSegmentLengthPx: 25,
    maxMergeGapPx: 2,
    snapTolerancePx: 3,
  };
  const { image, metersPerPixel } = doubleLinePlan();
  const cases = [
    ["as scanned", image, metersPerPixel],
    ["half resolution", rescale(image, 0.5), metersPerPixel * 2],
    ["1.5× resolution", rescale(image, 1.5), metersPerPixel / 1.5],
    ["2× resolution", rescale(image, 2), metersPerPixel / 2],
    ["very grainy", addNoise(image, 40), metersPerPixel],
  ] as const;

  for (const [name, plan, mpp] of cases)
    for (const [settings, options] of [
      ["library defaults", {}],
      ["Studio settings", studio],
    ] as const)
      it(`${name}, ${settings}: one wall per wall, not per face line; all four rooms`, () => {
        const result = vectorizeFloorPlan(plan, (p) => ({ x: p.x * mpp, y: p.y * mpp }), options);
        // 5 exterior runs (the top wall is split by the window) + 6 interior runs between doors.
        expect(result.walls.length).toBeGreaterThanOrEqual(11);
        expect(result.walls.length).toBeLessThanOrEqual(12);
        expect(result.spaces).toHaveLength(4);
        expect(result.elements.filter((e) => e.supportWall)).toHaveLength(4); // 3 doors + window
        // Walls sit between the face lines with the real thickness (0.2 m inside, 0.32 m outside)…
        for (const wall of result.walls) {
          expect(wall.thickness).toBeGreaterThan(0.17);
          expect(wall.thickness).toBeLessThan(0.42);
        }
        // …and no two walls run along the same line (no duplicates).
        for (const [i, a] of result.walls.entries())
          for (const b of result.walls.slice(i + 1)) {
            const horizontal = (w: typeof a) =>
              Math.abs(w.end.y - w.start.y) < Math.abs(w.end.x - w.start.x);
            if (horizontal(a) !== horizontal(b)) continue;
            const across = horizontal(a)
              ? Math.abs(a.start.y - b.start.y)
              : Math.abs(a.start.x - b.start.x);
            if (across > 0.1) continue;
            const span = (w: typeof a) =>
              horizontal(w)
                ? [Math.min(w.start.x, w.end.x), Math.max(w.start.x, w.end.x)]
                : [Math.min(w.start.y, w.end.y), Math.max(w.start.y, w.end.y)];
            const [a0, a1] = span(a),
              [b0, b1] = span(b);
            expect(Math.min(a1!, b1!) - Math.max(a0!, b0!)).toBeLessThan(0.1);
          }
      });
});

it("warns when the walls come out implausibly thick — the image scale is off", () => {
  const { image } = doubleLinePlan();
  const wrongScale = 0.08; // 4× the real 0.02 m/px: walls would be 0.8–1.3 m thick
  const result = vectorizeFloorPlan(image, (p) => ({ x: p.x * wrongScale, y: p.y * wrongScale }));
  expect(result.warnings.some((w) => w.message.includes("축척"))).toBe(true);
  const right = vectorizeFloorPlan(image, (p) => ({ x: p.x * 0.02, y: p.y * 0.02 }));
  expect(right.warnings.some((w) => w.message.includes("축척"))).toBe(false);
});
