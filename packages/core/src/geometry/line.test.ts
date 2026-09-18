import { describe, expect, it } from "vitest";
import { nearestPointOnSegment, segmentIntersection } from "./line.js";

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

describe("nearestPointOnSegment", () => {
  it("clamps to the start point when the projection falls before the segment", () => {
    const point = nearestPointOnSegment({ x: -5, y: 3 }, { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
    expect(point).toEqual({ x: 0, y: 0 });
  });

  it("clamps to the end point when the projection falls past the segment", () => {
    const point = nearestPointOnSegment(
      { x: 15, y: -3 },
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    );
    expect(point).toEqual({ x: 10, y: 0 });
  });

  it("finds the perpendicular projection for a point beside the segment", () => {
    const point = nearestPointOnSegment({ x: 5, y: 5 }, { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
    expect(point).toEqual({ x: 5, y: 0 });
  });

  it("returns the shared point for a zero-length segment", () => {
    const point = nearestPointOnSegment({ x: 3, y: 4 }, { a: { x: 1, y: 1 }, b: { x: 1, y: 1 } });
    expect(point).toEqual({ x: 1, y: 1 });
  });

  it("returns the point itself when it lies exactly on the segment", () => {
    const point = nearestPointOnSegment({ x: 4, y: 0 }, { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
    expect(point).toEqual({ x: 4, y: 0 });
  });
});
