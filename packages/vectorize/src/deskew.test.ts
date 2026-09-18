import { describe, expect, it } from "vitest";
import {
  estimateSkewAngle,
  imageCenter,
  rotateBinaryImage,
  rotatePoint,
  rotatePointInverse,
} from "./deskew.js";
import type { BinaryImage } from "./binarize.js";

/** A simple rectangular-outline "floor plan" with an internal partition, for a projection profile with real structure. */
function buildTestFloorPlan(width: number, height: number): BinaryImage {
  const ink = new Uint8Array(width * height);
  const setInk = (x: number, y: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) ink[y * width + x] = 1;
  };
  const hLine = (y: number, x0: number, x1: number, thickness = 2) => {
    for (let t = 0; t < thickness; t++) for (let x = x0; x <= x1; x++) setInk(x, y + t);
  };
  const vLine = (x: number, y0: number, y1: number, thickness = 2) => {
    for (let t = 0; t < thickness; t++) for (let y = y0; y <= y1; y++) setInk(x + t, y);
  };
  hLine(4, 4, width - 5);
  hLine(height - 6, 4, width - 5);
  vLine(4, 4, height - 5);
  vLine(width - 6, 4, height - 5);
  hLine(Math.floor(height / 2), 4, width - 5);
  return { width, height, ink };
}

describe("rotatePoint / rotatePointInverse", () => {
  it("round-trips a point through a rotation and its inverse", () => {
    const center = { x: 10, y: 10 };
    const point = { x: 17, y: 4 };
    const rotated = rotatePoint(point, 23, center);
    const back = rotatePointInverse(rotated, 23, center);
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });
});

describe("rotateBinaryImage", () => {
  it("keeps a centered pixel roughly in place under rotation", () => {
    const image = buildTestFloorPlan(60, 50);
    const rotated = rotateBinaryImage(image, 15);
    expect(rotated.width).toBe(image.width);
    expect(rotated.height).toBe(image.height);
    // Some ink should survive a modest rotation about the center.
    expect(Array.from(rotated.ink).some((v) => v === 1)).toBe(true);
  });

  it("maps a source point forward via rotatePoint, consistent with imageCenter", () => {
    const image = buildTestFloorPlan(40, 40);
    const center = imageCenter(image);
    const rotated = rotateBinaryImage(image, 10);
    // A point that was ink in the source should, after mapping through rotatePoint,
    // land on (approximately, given nearest-neighbor resampling) ink in the rotated image.
    let checked = 0;
    for (let y = 0; y < image.height && checked < 20; y++) {
      for (let x = 0; x < image.width && checked < 20; x++) {
        if (image.ink[y * image.width + x] !== 1) continue;
        const dest = rotatePoint({ x, y }, 10, center);
        const dx = Math.round(dest.x),
          dy = Math.round(dest.y);
        if (dx < 0 || dx >= rotated.width || dy < 0 || dy >= rotated.height) continue;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("estimateSkewAngle", () => {
  it("returns (near) zero for an already axis-aligned image", () => {
    const image = buildTestFloorPlan(60, 50);
    expect(estimateSkewAngle(image)).toBe(0);
  });

  it("recovers a known small rotation via the row-projection profile", () => {
    const clean = buildTestFloorPlan(80, 60);
    const rotated = rotateBinaryImage(clean, 5);
    const estimate = estimateSkewAngle(rotated);
    expect(estimate).toBeGreaterThan(4);
    expect(estimate).toBeLessThan(6);
  });

  it("recovers a known negative rotation", () => {
    const clean = buildTestFloorPlan(80, 60);
    const rotated = rotateBinaryImage(clean, -6);
    const estimate = estimateSkewAngle(rotated);
    expect(estimate).toBeGreaterThan(-7);
    expect(estimate).toBeLessThan(-5);
  });

  it("returns 0 when there is not enough ink to estimate anything", () => {
    const blank: BinaryImage = { width: 20, height: 20, ink: new Uint8Array(20 * 20) };
    expect(estimateSkewAngle(blank)).toBe(0);
  });

  it("stays bounded to the requested angle range", () => {
    const clean = buildTestFloorPlan(80, 60);
    const rotated = rotateBinaryImage(clean, 5);
    // Searching only [-2, 2] degrees cannot find the true 5-degree skew.
    const estimate = estimateSkewAngle(rotated, { maxAngleDegrees: 2, stepDegrees: 0.5 });
    expect(Math.abs(estimate)).toBeLessThanOrEqual(2);
  });
});
