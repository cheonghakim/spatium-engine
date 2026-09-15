import { describe, expect, it } from "vitest";
import {
  isPointInPolygon,
  isPolygonSelfIntersecting,
  polygonArea,
  polygonCentroid,
} from "./polygon.js";

const square = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
];

const bowtie = [
  { x: 0, y: 0 },
  { x: 4, y: 4 },
  { x: 4, y: 0 },
  { x: 0, y: 4 },
];

describe("polygonArea", () => {
  it("computes the area of a simple square", () => {
    expect(Math.abs(polygonArea(square))).toBe(16);
  });

  it("returns 0 for degenerate polygons", () => {
    expect(polygonArea([{ x: 0, y: 0 }])).toBe(0);
  });
});

describe("polygonCentroid", () => {
  it("computes the centroid of a square", () => {
    const centroid = polygonCentroid(square);
    expect(centroid.x).toBeCloseTo(2);
    expect(centroid.y).toBeCloseTo(2);
  });
});

describe("isPointInPolygon", () => {
  it("detects a point inside a square", () => {
    expect(isPointInPolygon({ x: 2, y: 2 }, square)).toBe(true);
  });

  it("detects a point outside a square", () => {
    expect(isPointInPolygon({ x: 10, y: 10 }, square)).toBe(false);
  });
});

describe("isPolygonSelfIntersecting", () => {
  it("returns false for a simple square", () => {
    expect(isPolygonSelfIntersecting(square)).toBe(false);
  });

  it("returns true for a bowtie polygon", () => {
    expect(isPolygonSelfIntersecting(bowtie)).toBe(true);
  });
});
