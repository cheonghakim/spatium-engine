import { describe, expect, it } from "vitest";
import { vectorizeFloorPlan } from "./vectorizeFloorPlan.js";
import type { RawImage } from "./binarize.js";

/** White canvas with a black rectangular outline (line thickness in px). */
function drawRectOutline(width: number, height: number, rect: { x: number; y: number; w: number; h: number }, thickness: number): RawImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const setBlack = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255;
  };
  for (let t = 0; t < thickness; t++) {
    for (let x = rect.x; x <= rect.x + rect.w; x++) {
      setBlack(x, rect.y + t);
      setBlack(x, rect.y + rect.h - t);
    }
    for (let y = rect.y; y <= rect.y + rect.h; y++) {
      setBlack(rect.x + t, y);
      setBlack(rect.x + rect.w - t, y);
    }
  }
  return { data, width, height };
}

const identity = (p: { x: number; y: number }) => p;

describe("vectorizeFloorPlan", () => {
  it('does not treat a uniform gray scan background as a wall', () => {
    const data = new Uint8ClampedArray(40*40*4).fill(100);
    for (let i=3;i<data.length;i+=4) data[i]=255;
    expect(vectorizeFloorPlan({data,width:40,height:40},identity).walls).toHaveLength(0);
  });
  it('detects a low contrast plan whose ink is above the old fixed threshold', () => {
    const image = drawRectOutline(100, 80, { x: 10, y: 10, w: 60, h: 50 }, 2);
    for (let i=0; i<image.data.length; i+=4) {
      const value = image.data[i] === 0 ? 170 : 235;
      image.data[i] = value; image.data[i+1] = value; image.data[i+2] = value;
    }
    expect(vectorizeFloorPlan(image, identity, { autoThreshold: false }).walls).toHaveLength(0);
    expect(vectorizeFloorPlan(image, identity).spaces).toHaveLength(1);
  });

  it('filters a thin furniture line while preserving thick room walls', () => {
    const image = drawRectOutline(100, 80, { x: 10, y: 10, w: 75, h: 60 }, 3);
    for (let x=30; x<=60; x++) {
      const index = (40*image.width+x)*4;
      image.data[index]=0; image.data[index+1]=0; image.data[index+2]=0;
    }
    const unfiltered = vectorizeFloorPlan(image, identity, { minWallThicknessPx: 1 });
    const filtered = vectorizeFloorPlan(image, identity, { minWallThicknessPx: 2 });
    expect(unfiltered.walls.some(w => w.start.y === 40 && w.end.y === 40)).toBe(true);
    expect(filtered.walls.some(w => w.start.y === 40 && w.end.y === 40)).toBe(false);
    expect(filtered.spaces).toHaveLength(1);
  });
  it("detects a single room from a rectangular outline", () => {
    const image = drawRectOutline(100, 80, { x: 10, y: 10, w: 60, h: 50 }, 2);
    const result = vectorizeFloorPlan(image, identity);

    expect(result.walls.length).toBeGreaterThanOrEqual(4);
    expect(result.spaces).toHaveLength(1);
    const polygon = result.spaces[0]!.polygon;
    expect(polygon.length).toBeGreaterThanOrEqual(4);

    // The room's bounding box should roughly match the drawn rectangle's interior.
    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(71);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(61);
  });

  it("returns a warning and no data for a blank image", () => {
    const width = 50;
    const height = 50;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const result = vectorizeFloorPlan({ data, width, height }, identity);

    expect(result.walls).toHaveLength(0);
    expect(result.spaces).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("scales wall thickness using the pixelToWorld transform", () => {
    const image = drawRectOutline(100, 80, { x: 10, y: 10, w: 60, h: 50 }, 2);
    const halfScale = (p: { x: number; y: number }) => ({ x: p.x * 0.5, y: p.y * 0.5 });
    const result = vectorizeFloorPlan(image, halfScale);

    // Wall endpoints should be scaled down by the same 0.5 factor as the transform.
    for (const wall of result.walls) {
      expect(wall.thickness).toBeGreaterThan(0);
    }
    const rawResult = vectorizeFloorPlan(image, identity);
    expect(result.walls[0]!.thickness).toBeLessThan(rawResult.walls[0]!.thickness);
  });
});
