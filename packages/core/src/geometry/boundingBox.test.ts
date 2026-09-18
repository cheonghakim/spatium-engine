import { describe, expect, it } from "vitest";
import {
  boundingBoxContainsPoint,
  boundingBoxesIntersect,
  boundingBoxOfPoints,
} from "./boundingBox.js";

describe("boundingBoxOfPoints", () => {
  it("computes the min/max extents of a set of points", () => {
    const box = boundingBoxOfPoints([
      { x: 0, y: 5 },
      { x: -3, y: 2 },
      { x: 4, y: -1 },
    ]);
    expect(box).toEqual({ min: { x: -3, y: -1 }, max: { x: 4, y: 5 } });
  });

  it("collapses to a single point for a single-point input", () => {
    const box = boundingBoxOfPoints([{ x: 2, y: 2 }]);
    expect(box).toEqual({ min: { x: 2, y: 2 }, max: { x: 2, y: 2 } });
  });

  it("returns a degenerate origin box for an empty point list", () => {
    const box = boundingBoxOfPoints([]);
    expect(box).toEqual({ min: { x: 0, y: 0 }, max: { x: 0, y: 0 } });
  });
});

describe("boundingBoxContainsPoint", () => {
  const box = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };

  it("returns true for a point in the interior", () => {
    expect(boundingBoxContainsPoint(box, { x: 5, y: 5 })).toBe(true);
  });

  it("returns true for a point exactly on the boundary", () => {
    expect(boundingBoxContainsPoint(box, { x: 0, y: 5 })).toBe(true);
    expect(boundingBoxContainsPoint(box, { x: 10, y: 10 })).toBe(true);
  });

  it("returns false for a point outside the box", () => {
    expect(boundingBoxContainsPoint(box, { x: 11, y: 5 })).toBe(false);
    expect(boundingBoxContainsPoint(box, { x: 5, y: -1 })).toBe(false);
  });
});

describe("boundingBoxesIntersect", () => {
  it("returns true for overlapping boxes", () => {
    const a = { min: { x: 0, y: 0 }, max: { x: 5, y: 5 } };
    const b = { min: { x: 3, y: 3 }, max: { x: 8, y: 8 } };
    expect(boundingBoxesIntersect(a, b)).toBe(true);
  });

  it("returns true for boxes that only touch at an edge", () => {
    const a = { min: { x: 0, y: 0 }, max: { x: 5, y: 5 } };
    const b = { min: { x: 5, y: 0 }, max: { x: 10, y: 5 } };
    expect(boundingBoxesIntersect(a, b)).toBe(true);
  });

  it("returns false for clearly separated boxes", () => {
    const a = { min: { x: 0, y: 0 }, max: { x: 5, y: 5 } };
    const b = { min: { x: 100, y: 100 }, max: { x: 105, y: 105 } };
    expect(boundingBoxesIntersect(a, b)).toBe(false);
  });

  it("is symmetric regardless of argument order", () => {
    const a = { min: { x: 0, y: 0 }, max: { x: 5, y: 5 } };
    const b = { min: { x: 3, y: 3 }, max: { x: 8, y: 8 } };
    expect(boundingBoxesIntersect(a, b)).toBe(boundingBoxesIntersect(b, a));
  });
});
