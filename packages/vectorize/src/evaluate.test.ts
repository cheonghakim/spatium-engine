import { describe, expect, it } from "vitest";
import { evaluateVectorization, truthFromFloor, type EvaluationTruth } from "./evaluate.js";
import { syntheticPlan } from "./planFixture.js";
import { vectorizeFloorPlan } from "./vectorizeFloorPlan.js";

const square = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const wall = (x0: number, y0: number, x1: number, y1: number) => ({
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

/** Two 5×4 m rooms side by side, a stair in the right one and a door between them. */
const truth: EvaluationTruth = {
  walls: [
    wall(0, 0, 10, 0),
    wall(0, 4, 10, 4),
    wall(0, 0, 0, 4),
    wall(10, 0, 10, 4),
    wall(5, 0, 5, 4),
  ],
  spaces: [{ polygon: square(0, 0, 5, 4) }, { polygon: square(5, 0, 10, 4) }],
  stairs: [{ position: { x: 8, y: 2 } }],
  openings: [{ x: 5, y: 2 }],
};

describe("evaluateVectorization", () => {
  it("scores a perfect result at 1 everywhere", () => {
    const score = evaluateVectorization(
      {
        walls: truth.walls,
        spaces: truth.spaces,
        elements: [
          { type: "stairs", position: { x: 8.2, y: 2.1 } },
          { type: "opening", position: { x: 5, y: 2.1 } },
        ],
      },
      truth,
    );
    expect(score.walls.precision).toBeCloseTo(1);
    expect(score.walls.recall).toBeCloseTo(1);
    expect(score.floor.iou).toBeCloseTo(1);
    expect(score.rooms).toEqual({ matched: 2, truth: 2, predicted: 2 });
    expect(score.stairs.matched).toBe(1);
    expect(score.openings.matched).toBe(1);
  });

  it("separates missed walls (recall) from false walls (precision)", () => {
    const missed = evaluateVectorization({ walls: truth.walls.slice(0, 4), spaces: [] }, truth);
    expect(missed.walls.precision).toBeCloseTo(1);
    // The ends of the missed partition still lie within tolerance of the walls it meets.
    expect(missed.walls.recall).toBeCloseTo(28.4 / 32);

    // A dimension line 1 m outside the building, as long as the building.
    const extra = evaluateVectorization(
      { walls: [...truth.walls, wall(0, -1, 10, -1)], spaces: [] },
      truth,
    );
    expect(extra.walls.recall).toBeCloseTo(1);
    expect(extra.walls.precision).toBeCloseTo(32 / 42);
  });

  it("does not count a stair candidate's treads as walls", () => {
    const score = evaluateVectorization(
      {
        walls: [...truth.walls, wall(7, 1, 9, 1), wall(7, 1.3, 9, 1.3)],
        spaces: [],
        elements: [{ type: "stairs", position: { x: 8, y: 2 }, replacesWallIndices: [5, 6] }],
      },
      truth,
    );
    expect(score.walls.precision).toBeCloseTo(1);
  });

  it("reports a missing floor and a room merged across a missed wall", () => {
    const missing = evaluateVectorization({ walls: [], spaces: [truth.spaces[0]!] }, truth);
    expect(missing.floor.precision).toBeCloseTo(1, 1);
    expect(missing.floor.recall).toBeCloseTo(0.5, 1);
    expect(missing.rooms.matched).toBe(1);

    const merged = evaluateVectorization(
      { walls: [], spaces: [{ polygon: square(0, 0, 10, 4) }] },
      truth,
    );
    expect(merged.floor.iou).toBeCloseTo(1, 1);
    // Full floor coverage, yet neither room was found as a room of its own.
    expect(
      evaluateVectorization({ walls: [], spaces: [{ polygon: square(0, 0, 10, 4) }] }, truth, {
        roomIou: 0.6,
      }).rooms.matched,
    ).toBe(0);
  });

  it("penalises floor drawn over a void", () => {
    const withVoid: EvaluationTruth = {
      ...truth,
      spaces: [{ polygon: square(0, 0, 10, 4), holes: [square(6, 1, 9, 3)] }],
    };
    const score = evaluateVectorization(
      { walls: [], spaces: [{ polygon: square(0, 0, 10, 4) }] },
      withVoid,
    );
    expect(score.floor.recall).toBeCloseTo(1, 1);
    expect(score.floor.precision).toBeCloseTo(34 / 40, 1);
  });

  it("leaves ratios null when there is nothing to divide by", () => {
    const score = evaluateVectorization({ walls: [], spaces: [] }, truth);
    expect(score.walls.precision).toBeNull();
    expect(score.walls.recall).toBe(0);
    expect(score.floor.precision).toBeNull();
    expect(score.stairs).toEqual({ matched: 0, truth: 1, predicted: 0 });
  });
});

describe("truthFromFloor", () => {
  it("treats stair spaces as stairs, not floor, and merges a stair entrance inside one", () => {
    const result = truthFromFloor({
      walls: [{ ...wall(0, 0, 10, 0) }],
      spaces: [
        { polygon: square(0, 0, 5, 4), type: "room" },
        { polygon: square(7, 1, 9, 3), type: "stairs" },
      ],
      entrances: [
        { position: { x: 8, y: 2 }, type: "stairs" },
        { position: { x: 2, y: 9 }, type: "stairs" },
        { position: { x: 5, y: 2 }, type: "door" },
        { position: { x: 1, y: 1 }, type: "elevator" },
      ],
    });
    expect(result.spaces).toHaveLength(1);
    expect(result.stairs).toHaveLength(2);
    expect(result.openings).toEqual([{ x: 5, y: 2 }]);
  });
});

describe("baseline on the synthetic plan", () => {
  it("finds the walls, rooms and staircase it was drawn with", () => {
    const { image, metersPerPixel: m } = syntheticPlan({ withStairs: true });
    const px = (x0: number, y0: number, x1: number, y1: number) =>
      wall(x0 * m, y0 * m, x1 * m, y1 * m);
    const room = (x0: number, y0: number, x1: number, y1: number) => ({
      polygon: square(x0 * m, y0 * m, x1 * m, y1 * m),
    });
    // Wall centre lines and rooms, read off `syntheticPlan`'s drawing calls.
    const planTruth: EvaluationTruth = {
      walls: [
        px(100, 106, 700, 106),
        px(100, 494, 700, 494),
        px(106, 100, 106, 500),
        px(694, 100, 694, 500),
        px(404, 100, 404, 500),
        px(100, 304, 400, 304),
        px(400, 264, 700, 264),
      ],
      spaces: [
        room(106, 106, 404, 304),
        room(106, 304, 404, 494),
        room(404, 106, 694, 264),
        room(404, 264, 694, 494),
      ],
      stairs: [{ position: { x: 650 * m, y: 342 * m } }],
      openings: [
        { x: 404 * m, y: 182 * m },
        { x: 222 * m, y: 304 * m },
        { x: 542 * m, y: 264 * m },
        { x: 260 * m, y: 106 * m },
      ],
    };
    const result = vectorizeFloorPlan(image, (p) => ({ x: p.x * m, y: p.y * m }));
    const score = evaluateVectorization(result, planTruth);
    expect(score.walls.recall).toBeGreaterThan(0.9);
    expect(score.walls.precision).toBeGreaterThan(0.95);
    expect(score.floor.iou).toBeGreaterThan(0.95);
    expect(score.rooms.matched).toBe(4);
    expect(score.stairs.matched).toBe(1);
  });
});
