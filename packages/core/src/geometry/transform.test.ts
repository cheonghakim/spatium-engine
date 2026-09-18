import { describe, expect, it } from "vitest";
import { rotatePoint, scalePointFrom, translatePoint, translatePoints } from "./transform.js";

describe("translatePoint", () => {
  it("shifts a point by a delta", () => {
    expect(translatePoint({ x: 1, y: 1 }, { x: 2, y: 3 })).toEqual({ x: 3, y: 4 });
  });

  it("is a no-op for a zero delta", () => {
    expect(translatePoint({ x: 5, y: 5 }, { x: 0, y: 0 })).toEqual({ x: 5, y: 5 });
  });
});

describe("translatePoints", () => {
  it("translates every point in the list by the same delta", () => {
    const result = translatePoints(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      { x: 5, y: -5 },
    );
    expect(result).toEqual([
      { x: 5, y: -5 },
      { x: 6, y: -4 },
    ]);
  });

  it("returns an empty array for an empty input", () => {
    expect(translatePoints([], { x: 1, y: 1 })).toEqual([]);
  });
});

describe("rotatePoint", () => {
  it("leaves a point unchanged for a zero-angle rotation", () => {
    const result = rotatePoint({ x: 3, y: 4 }, { x: 0, y: 0 }, 0);
    expect(result.x).toBeCloseTo(3);
    expect(result.y).toBeCloseTo(4);
  });

  it("rotates a point 90 degrees counter-clockwise around the origin", () => {
    const result = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(1);
  });

  it("rotates a point 180 degrees around an arbitrary pivot", () => {
    const result = rotatePoint({ x: 2, y: 0 }, { x: 1, y: 0 }, Math.PI);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  it("leaves the pivot point itself unchanged by any rotation", () => {
    const pivot = { x: 5, y: 5 };
    const result = rotatePoint(pivot, pivot, Math.PI / 3);
    expect(result.x).toBeCloseTo(5);
    expect(result.y).toBeCloseTo(5);
  });
});

describe("scalePointFrom", () => {
  it("scales a point away from the pivot", () => {
    const result = scalePointFrom({ x: 2, y: 0 }, { x: 0, y: 0 }, 2);
    expect(result).toEqual({ x: 4, y: 0 });
  });

  it("leaves the pivot point unchanged", () => {
    const pivot = { x: 3, y: 3 };
    expect(scalePointFrom(pivot, pivot, 5)).toEqual({ x: 3, y: 3 });
  });

  it("collapses the point onto the pivot for a factor of 0", () => {
    const result = scalePointFrom({ x: 10, y: 10 }, { x: 2, y: 2 }, 0);
    expect(result).toEqual({ x: 2, y: 2 });
  });

  it("supports scaling from an arbitrary (non-origin) pivot", () => {
    const result = scalePointFrom({ x: 4, y: 4 }, { x: 2, y: 2 }, 3);
    expect(result).toEqual({ x: 8, y: 8 });
  });
});
