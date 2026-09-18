import { describe, expect, it } from "vitest";
import { vectorizeFloorPlan } from "./vectorizeFloorPlan.js";
import type { BinaryImage, RawImage } from "./binarize.js";
import { rotateBinaryImage } from "./deskew.js";

/** White canvas with a black rectangular outline (line thickness in px). */
function drawRectOutline(
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
  thickness: number,
): RawImage {
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

/** Rectangular-outline wall mask, drawn directly as ink (no RGBA round-trip) so it can be rotated via `rotateBinaryImage` before rasterizing. */
function drawRectBinary(
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
  thickness: number,
): BinaryImage {
  const ink = new Uint8Array(width * height);
  const setInk = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) ink[y * width + x] = 1;
  };
  for (let t = 0; t < thickness; t++) {
    for (let x = rect.x; x <= rect.x + rect.w; x++) {
      setInk(x, rect.y + t);
      setInk(x, rect.y + rect.h - t);
    }
    for (let y = rect.y; y <= rect.y + rect.h; y++) {
      setInk(rect.x + t, y);
      setInk(rect.x + rect.w - t, y);
    }
  }
  return { width, height, ink };
}

/** Renders a binary ink mask as a white-background RGBA raster, the input shape `vectorizeFloorPlan` actually accepts. */
function binaryToRawImage(binary: BinaryImage): RawImage {
  const data = new Uint8ClampedArray(binary.width * binary.height * 4).fill(255);
  for (let i = 0; i < binary.ink.length; i++) {
    if (binary.ink[i] === 1) {
      data[i * 4] = 0;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
    }
    data[i * 4 + 3] = 255;
  }
  return { data, width: binary.width, height: binary.height };
}

describe("vectorizeFloorPlan", () => {
  it("proposes a reviewable floor across a doorway without turning the gap into a detected wall", () => {
    const image = drawRectOutline(160, 120, { x: 10, y: 10, w: 140, h: 100 }, 4);
    for (let y = 106; y <= 110; y++)
      for (let x = 65; x < 85; x++) {
        const index = (y * image.width + x) * 4;
        image.data[index] = 255;
        image.data[index + 1] = 255;
        image.data[index + 2] = 255;
      }
    const result = vectorizeFloorPlan(image, (p) => ({ x: p.x * 0.05, y: -p.y * 0.05 }), {
      maxMergeGapPx: 2,
    });
    expect(result.elements.some((e) => e.type === "opening")).toBe(true);
    expect(result.spaces).toHaveLength(1);
    expect(result.spaces[0]?.needsReview).toBe(true);
    expect(result.walls).toHaveLength(5);
  });
  it("does not treat a uniform gray scan background as a wall", () => {
    const data = new Uint8ClampedArray(40 * 40 * 4).fill(100);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    expect(vectorizeFloorPlan({ data, width: 40, height: 40 }, identity).walls).toHaveLength(0);
  });
  it("detects a low contrast plan whose ink is above the old fixed threshold", () => {
    const image = drawRectOutline(100, 80, { x: 10, y: 10, w: 60, h: 50 }, 2);
    for (let i = 0; i < image.data.length; i += 4) {
      const value = image.data[i] === 0 ? 170 : 235;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
    }
    expect(vectorizeFloorPlan(image, identity, { autoThreshold: false }).walls).toHaveLength(0);
    expect(vectorizeFloorPlan(image, identity).spaces).toHaveLength(1);
  });

  it("filters a thin furniture line while preserving thick room walls", () => {
    const image = drawRectOutline(100, 80, { x: 10, y: 10, w: 75, h: 60 }, 3);
    for (let x = 30; x <= 60; x++) {
      const index = (40 * image.width + x) * 4;
      image.data[index] = 0;
      image.data[index + 1] = 0;
      image.data[index + 2] = 0;
    }
    const unfiltered = vectorizeFloorPlan(image, identity, { minWallThicknessPx: 1 });
    const filtered = vectorizeFloorPlan(image, identity, { minWallThicknessPx: 2 });
    expect(unfiltered.walls.some((w) => w.start.y === 40 && w.end.y === 40)).toBe(true);
    expect(filtered.walls.some((w) => w.start.y === 40 && w.end.y === 40)).toBe(false);
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

describe("vectorizeFloorPlan autoDeskew", () => {
  it("is a complete no-op on an already axis-aligned plan", () => {
    const image = drawRectOutline(100, 80, { x: 10, y: 10, w: 60, h: 50 }, 2);
    const withDeskew = vectorizeFloorPlan(image, identity, { autoDeskew: true });
    const withoutDeskew = vectorizeFloorPlan(image, identity, { autoDeskew: false });
    expect(withDeskew).toEqual(withoutDeskew);
  });

  it("recovers walls close to the ground truth from a plan rotated by a few degrees", () => {
    const clean = drawRectBinary(160, 140, { x: 25, y: 25, w: 100, h: 80 }, 3);
    const rotated = rotateBinaryImage(clean, 5);
    const image = binaryToRawImage(rotated);

    const corrected = vectorizeFloorPlan(image, identity, { autoDeskew: true });
    const uncorrected = vectorizeFloorPlan(image, identity, { autoDeskew: false });

    expect(corrected.walls.length).toBeGreaterThanOrEqual(4);
    expect(corrected.spaces).toHaveLength(1);

    // With deskew, the recovered room should closely match the clean rectangle's interior.
    const polygon = corrected.spaces[0]!.polygon;
    const xs = polygon.map((p) => p.x),
      ys = polygon.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThan(20);
    expect(Math.max(...xs)).toBeLessThan(130);
    expect(Math.min(...ys)).toBeGreaterThan(20);
    expect(Math.max(...ys)).toBeLessThan(110);

    // Without correction, the rotated strokes shouldn't form the same clean rectangular room
    // (segments only ever scan axis-aligned rows/columns), showing the pre-pass is doing real work.
    expect(
      uncorrected.spaces.length === 0 || uncorrected.walls.length !== corrected.walls.length,
    ).toBe(true);
  });

  // Curved walls are an explicit, intentional gap for this whole package (see
  // `vectorizeFloorPlan`'s doc comment) — auto-deskew corrects small global
  // rotation only, it does not add curve support.
  it("does not attempt to straighten a curved stroke into a wall", () => {
    const width = 100,
      height = 100;
    const ink = new Uint8Array(width * height);
    // A quarter-circle arc — never axis-aligned for more than a couple of pixels at a time.
    for (let angle = 0; angle <= 90; angle += 0.5) {
      const rad = (angle * Math.PI) / 180;
      const x = Math.round(50 + 40 * Math.cos(rad));
      const y = Math.round(50 + 40 * Math.sin(rad));
      if (x >= 0 && x < width && y >= 0 && y < height) ink[y * width + x] = 1;
    }
    const image = binaryToRawImage({ width, height, ink });
    const result = vectorizeFloorPlan(image, identity, { autoDeskew: true });
    expect(result.walls).toHaveLength(0);
  });

  // Regression for the reported bug: `detectElements` was called on `walls`,
  // which under deskew are rotated *back* into the original tilted pixel
  // frame (see `toWorld`). Its opening search buckets walls by a literal
  // y/x-coordinate proxy for "which line this wall lies on" — valid only for
  // exactly axis-aligned input. Two collinear walls on a globally-rotated
  // line land in different buckets and are never compared, so a real opening
  // between them is missed *only* once deskew has corrected a rotation.
  describe("opening detection survives a corrected global rotation", () => {
    const worldScale = (p: { x: number; y: number }) => ({ x: p.x * 0.05, y: -p.y * 0.05 });
    // A wide rectangle: the door gap's two flanking wall segments end up far
    // apart along the top wall, so a small global rotation shifts their
    // average-y "offset" bucketing key by much more than one bucket width —
    // this is what actually reproduces the reported bug (a narrower plan's
    // segments stay within the bucket search's tolerance radius by
    // coincidence, masking it).
    const rect = { x: 25, y: 25, w: 300, h: 80 };
    const doorGap: [number, number] = [150, 170]; // ~1m gap cut into the top wall, at 0.05 world scale.

    /** Same rectangular-outline wall mask as `drawRectBinary`, but with a door-sized gap cut into the top wall, so its two remaining halves are genuinely collinear walls either side of an opening. */
    function drawRectBinaryWithDoorGap(width: number, height: number): BinaryImage {
      const binary = drawRectBinary(width, height, rect, 3);
      for (let t = 0; t < 3; t++) {
        for (let x = doorGap[0]; x <= doorGap[1]; x++) binary.ink[(rect.y + t) * width + x] = 0;
      }
      return binary;
    }

    it("finds exactly one opening in the top wall when the plan is perfectly axis-aligned (baseline)", () => {
      const binary = drawRectBinaryWithDoorGap(400, 140);
      const image = binaryToRawImage(binary);
      const result = vectorizeFloorPlan(image, worldScale, { autoDeskew: false });
      expect(result.elements.filter((e) => e.type === "opening")).toHaveLength(1);
    });

    it("still finds exactly one opening after autoDeskew corrects a ~3 degree global rotation", () => {
      const clean = drawRectBinaryWithDoorGap(400, 140);
      const rotated = rotateBinaryImage(clean, 3);
      const image = binaryToRawImage(rotated);

      const result = vectorizeFloorPlan(image, worldScale, { autoDeskew: true });
      const openings = result.elements.filter((e) => e.type === "opening");
      expect(openings).toHaveLength(1);

      // ~1m door gap (21px gap * 0.05 world scale), with tolerance for scan/rotation rounding.
      expect(openings[0]!.width).toBeGreaterThan(0.6);
      expect(openings[0]!.width).toBeLessThan(1.5);

      // Should land close to where the door actually is in world space (top wall, x~160px, y~26.5px pre-rotation).
      const expected = worldScale({ x: (doorGap[0] + doorGap[1]) / 2, y: rect.y + 1.5 });
      expect(Math.abs(openings[0]!.position.x - expected.x)).toBeLessThan(1.5);
      expect(Math.abs(openings[0]!.position.y - expected.y)).toBeLessThan(1.5);
    });
  });
});
