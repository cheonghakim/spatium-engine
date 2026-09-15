import { describe, expect, it } from "vitest";
import { segmentIntersection } from "./line.js";

describe("segmentIntersection", () => {
  it("finds the crossing point of two intersecting segments", () => {
    const result = segmentIntersection(
      { a: { x: 0, y: 0 }, b: { x: 4, y: 4 } },
      { a: { x: 0, y: 4 }, b: { x: 4, y: 0 } },
    );
    expect(result?.x).toBeCloseTo(2);
    expect(result?.y).toBeCloseTo(2);
  });

  it("returns null for non-intersecting segments", () => {
    const result = segmentIntersection(
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
      { a: { x: 0, y: 5 }, b: { x: 1, y: 5 } },
    );
    expect(result).toBeNull();
  });

  it("returns null for parallel segments", () => {
    const result = segmentIntersection(
      { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { a: { x: 0, y: 1 }, b: { x: 4, y: 1 } },
    );
    expect(result).toBeNull();
  });
});
