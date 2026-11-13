import { describe, expect, it } from "vitest";
import type { RawImage } from "./binarize.js";
import { evaluateVectorization } from "./evaluate.js";
import { doubleLinePlan, syntheticPlan } from "./planFixture.js";
import { detectRegions, rectifyRing } from "./regions.js";
import { vectorizeFloorPlan } from "./vectorizeFloorPlan.js";

const M = 0.02;
const toWorld = (p: { x: number; y: number }) => ({ x: p.x * M, y: p.y * M });
const square = (x0: number, y0: number, x1: number, y1: number) => ({
  polygon: [
    { x: x0 * M, y: y0 * M },
    { x: x1 * M, y: y0 * M },
    { x: x1 * M, y: y1 * M },
    { x: x0 * M, y: y1 * M },
  ],
});

/** White canvas; `draw` gets a 2 px pen. */
function sketch(
  width: number,
  height: number,
  draw: (line: (x0: number, y0: number, x1: number, y1: number) => void) => void,
): RawImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  draw((x0, y0, x1, y1) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2;
    for (let s = 0; s <= steps; s++)
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const x = Math.round(x0 + ((x1 - x0) * s) / steps) + dx,
            y = Math.round(y0 + ((y1 - y0) * s) / steps) + dy;
          if (x >= 0 && y >= 0 && x < width && y < height)
            data[(y * width + x) * 4] =
              data[(y * width + x) * 4 + 1] =
              data[(y * width + x) * 4 + 2] =
                0;
        }
  });
  return { data, width, height };
}

describe("vectorizeFloorPlan — regions method", () => {
  it("finds the floor of a plan with filled walls, clutter and door swings", () => {
    const { image } = syntheticPlan();
    const result = vectorizeFloorPlan(image, toWorld, { method: "regions" });
    const score = evaluateVectorization(result, {
      walls: [],
      spaces: [
        square(112, 112, 400, 300),
        square(112, 308, 400, 488),
        square(408, 112, 688, 260),
        square(408, 268, 688, 488),
      ],
      stairs: [],
      openings: [],
    });
    // Furniture drawn close to a wall still takes its strip of floor with it.
    expect(score.floor.precision).toBeGreaterThan(0.95);
    expect(score.floor.recall).toBeGreaterThan(0.8);
  });

  it("finds the floor of a noisy scan drawn in double lines, without rooms in the dimension strings", () => {
    const { image } = doubleLinePlan();
    const result = vectorizeFloorPlan(image, toWorld, { method: "regions" });
    const score = evaluateVectorization(result, {
      walls: [],
      spaces: [
        square(108, 108, 445, 295),
        square(108, 305, 445, 492),
        square(455, 108, 792, 265),
        square(455, 275, 792, 492),
      ],
      stairs: [],
      openings: [],
    });
    expect(score.floor.iou).toBeGreaterThan(0.9);
  });

  it("follows a slanted wall and cuts a stair core out of the floor", () => {
    // A 12 × 9 m room with one corner cut off at 45°, double-line walls, and a
    // closed 3 × 2.4 m core of treads in the middle.
    const image = sketch(800, 650, (line) => {
      for (const d of [0, 12]) {
        line(100 - d, 100 - d, 700 + d, 100 - d);
        line(700 + d, 100 - d, 700 + d, 400 + d * 0.4);
        line(700 + d, 400 + d * 0.4, 550 + d * 0.4, 550 + d);
        line(550 + d * 0.4, 550 + d, 100 - d, 550 + d);
        line(100 - d, 550 + d, 100 - d, 100 - d);
      }
      line(320, 260, 470, 260);
      line(470, 260, 470, 380);
      line(470, 380, 320, 380);
      line(320, 380, 320, 260);
      for (let x = 335; x < 470; x += 15) line(x, 260, x, 380);
    });
    const result = vectorizeFloorPlan(image, toWorld, { method: "regions" });
    expect(result.spaces).toHaveLength(1);
    expect(result.spaces[0]!.holes).toHaveLength(1);
    const slanted = result.walls.filter((wall) => {
      const angle = Math.abs(
        (Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) * 180) / Math.PI,
      );
      return Math.abs((angle % 90) - 45) < 8;
    });
    expect(slanted.length).toBeGreaterThan(0);
  });
});

describe("detectRegions — faint walls", () => {
  const width = 220,
    height = 260;
  /** A room whose back wall is a hairline behind a row of stalls; only the fixtures there are drawn heavy. */
  const plan = () => {
    const heavy = new Uint8Array(width * height);
    const fine = new Uint8Array(width * height);
    const fill = (ink: Uint8Array, x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink[y * width + x] = 1;
    };
    fill(heavy, 55, 40, 60, 225); // left wall
    fill(heavy, 160, 40, 165, 225); // right wall
    fill(heavy, 55, 220, 165, 225); // front wall
    for (let x = 64; x < 156; x += 30) fill(heavy, x, 64, x + 8, 72); // fixtures along the back wall
    for (let x = 64; x < 156; x += 18) fill(heavy, x, 100, x + 8, 108); // stall fronts
    fill(fine, 55, 60, 165, 61); // the back wall itself
    for (const x of [93, 127]) fill(fine, x, 61, x + 1, 108); // partitions
    const detail = heavy.map((value, i) => (value || fine[i] ? 1 : 0));
    return { heavy: { width, height, ink: heavy }, detail: { width, height, ink: detail } };
  };
  const options = {
    wallHalfPx: 4,
    doorHalfPx: 10,
    minRoomAreaPx: 400,
    minHoleAreaPx: 600,
    maxWallThicknessPx: 16,
    minWallThicknessPx: 1,
    minWallLengthPx: 8,
    simplifyPx: 2.5,
  };
  const top = (rooms: ReturnType<typeof detectRegions>["rooms"]) =>
    Math.min(...rooms.flatMap((room) => room.polygon.map((p) => p.y)));

  it("takes the room up to a back wall drawn as a hairline", () => {
    const { heavy, detail } = plan();
    // Heavy lines alone: the outside comes in between the fixtures and fills the stalls.
    expect(top(detectRegions(heavy, options).rooms)).toBeGreaterThan(95);
    const rooms = detectRegions(heavy, { ...options, detail }).rooms;
    expect(rooms).toHaveLength(1);
    expect(top(rooms)).toBeGreaterThanOrEqual(60);
    expect(top(rooms)).toBeLessThan(76);
  });
});

describe("rectifyRing — cut corners", () => {
  const ring = (cut: number) => [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 - cut },
    { x: 100 - cut, y: 80 },
    { x: 0, y: 80 },
  ];

  it("puts back a square corner cut short, and keeps a slanted wall", () => {
    const squared = rectifyRing(ring(12), 4, 20);
    expect(squared).toHaveLength(4);
    expect(squared).toContainEqual({ x: 100, y: 80 });
    expect(rectifyRing(ring(30), 4, 20)).toHaveLength(5);
  });
});
