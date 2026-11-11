import { describe, expect, it } from "vitest";
import type { RawImage } from "./binarize.js";
import {
  MAX_ANALYSIS_PIXELS,
  MAX_WORKING_PIXELS,
  MAX_WORKING_SIDE,
  applyAffineTransform,
  planAnalysisResolution,
  sampleAffineTransform,
  scaleTransformToWorkingResolution,
  scaleVectorizeOptions,
  vectorizeAtWorkingResolution,
} from "./analysisBudget.js";
import { DEFAULTS, vectorizeFloorPlan } from "./vectorizeFloorPlan.js";

/** Same shape as ReferenceManager.imagePixelToWorld: scale + translate + y flip. */
const calibration = (p: { x: number; y: number }) => ({ x: 5 + p.x * 0.02, y: 10 - p.y * 0.02 });

function drawRectOutline(
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
  thickness: number,
): RawImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inX = x >= rect.x && x <= rect.x + rect.w;
      const inY = y >= rect.y && y <= rect.y + rect.h;
      const onH =
        inX &&
        ((y - rect.y < thickness && y >= rect.y) ||
          (rect.y + rect.h - y < thickness && y <= rect.y + rect.h));
      const onV =
        inY &&
        ((x - rect.x < thickness && x >= rect.x) ||
          (rect.x + rect.w - x < thickness && x <= rect.x + rect.w));
      if (onH || onV) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { data, width, height };
}

/** Box-filter downscale by an integer factor (what a canvas drawImage roughly does). */
function downscale(image: RawImage, factor: number): RawImage {
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < factor; dy++)
          for (let dx = 0; dx < factor; dx++)
            sum += image.data[((y * factor + dy) * image.width + x * factor + dx) * 4 + c]!;
        data[(y * width + x) * 4 + c] = sum / (factor * factor);
      }
    }
  }
  return { data, width, height };
}

function bounds(points: Array<{ x: number; y: number }>) {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

describe("planAnalysisResolution", () => {
  it("keeps small images at full resolution", () => {
    const plan = planAnalysisResolution(1200, 900);
    expect(plan).toMatchObject({
      ok: true,
      width: 1200,
      height: 900,
      scaleX: 1,
      scaleY: 1,
      downscaled: false,
    });
  });

  it("downscales images above the working budget to at most MAX_WORKING_PIXELS, preserving aspect", () => {
    const plan = planAnalysisResolution(4000, 3000);
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.downscaled).toBe(true);
    expect(plan.width * plan.height).toBeLessThanOrEqual(MAX_WORKING_PIXELS);
    expect(plan.width * plan.height).toBeGreaterThan(MAX_WORKING_PIXELS * 0.99);
    expect(plan.width / plan.height).toBeCloseTo(4 / 3, 2);
    expect(plan.scaleX).toBeCloseTo(plan.width / 4000);
    expect(plan.scaleY).toBeCloseTo(plan.height / 3000);
  });

  it("caps the longest working side for extreme aspect ratios", () => {
    const plan = planAnalysisResolution(40000, 100);
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.width).toBeLessThanOrEqual(MAX_WORKING_SIDE);
    expect(plan.height).toBeGreaterThanOrEqual(1);
  });

  it("rejects images over MAX_ANALYSIS_PIXELS with a Korean message, and empty sizes", () => {
    const plan = planAnalysisResolution(4001, 4000);
    expect(4001 * 4000).toBeGreaterThan(MAX_ANALYSIS_PIXELS);
    expect(plan).toMatchObject({ ok: false, reason: "too-large" });
    if (plan.ok) throw new Error("expected rejection");
    expect(plan.message).toContain("이미지가 너무 큽니다");
    expect(plan.message).toContain("4001×4000");
    expect(planAnalysisResolution(4000, 4000).ok).toBe(true);
    expect(planAnalysisResolution(0, 100)).toMatchObject({ ok: false, reason: "empty" });
    expect(planAnalysisResolution(Number.NaN, 100)).toMatchObject({ ok: false, reason: "empty" });
  });

  it("honours custom limits", () => {
    expect(planAnalysisResolution(100, 100, { maxAnalysisPixels: 5000 }).ok).toBe(false);
    const plan = planAnalysisResolution(100, 100, { maxWorkingPixels: 2500 });
    expect(plan).toMatchObject({ ok: true, width: 50, height: 50, scaleX: 0.5, scaleY: 0.5 });
  });
});

describe("affine transform helpers", () => {
  it("sampleAffineTransform reproduces an affine pixelToWorld exactly", () => {
    const t = sampleAffineTransform(calibration);
    for (const p of [
      { x: 0, y: 0 },
      { x: 123, y: 45 },
      { x: -7, y: 900 },
    ]) {
      const expected = calibration(p);
      const actual = applyAffineTransform(t, p);
      expect(actual.x).toBeCloseTo(expected.x, 9);
      expect(actual.y).toBeCloseTo(expected.y, 9);
    }
  });

  it("scaleTransformToWorkingResolution maps working pixels to the same world point as the source pixel", () => {
    const t = scaleTransformToWorkingResolution(sampleAffineTransform(calibration), 0.25, 0.5);
    const world = applyAffineTransform(t, { x: 100, y: 100 });
    const expected = calibration({ x: 400, y: 200 });
    expect(world.x).toBeCloseTo(expected.x, 9);
    expect(world.y).toBeCloseTo(expected.y, 9);
  });
});

describe("scaleVectorizeOptions", () => {
  it("is a no-op at full resolution", () => {
    expect(scaleVectorizeOptions({ minSegmentLengthPx: 25 }, 1)).toEqual({
      minSegmentLengthPx: 25,
    });
  });

  it("scales explicit and default pixel options (area quadratically), leaves metric options alone", () => {
    const scaled = scaleVectorizeOptions(
      { minSegmentLengthPx: 40, maxLineGapPx: 2, minOpeningGapM: 0.6, threshold: 100 },
      0.5,
    );
    expect(scaled.minSegmentLengthPx).toBe(20);
    expect(scaled.maxLineGapPx).toBe(1);
    expect(scaled.maxMergeGapPx).toBe(DEFAULTS.maxMergeGapPx * 0.5);
    expect(scaled.snapTolerancePx).toBe(DEFAULTS.snapTolerancePx * 0.5);
    expect(scaled.minRoomAreaPx).toBe(DEFAULTS.minRoomAreaPx * 0.25);
    expect(scaled.minOpeningGapM).toBe(0.6);
    expect(scaled.threshold).toBe(100);
  });
});

describe("vectorizeAtWorkingResolution", () => {
  it("returns the same world geometry from a downscaled raster as from the full-resolution one", () => {
    const full = drawRectOutline(800, 600, { x: 100, y: 80, w: 600, h: 440 }, 8);
    const options = { minSegmentLengthPx: 40, minWallThicknessPx: 2, maxMergeGapPx: 4 };
    const reference = vectorizeFloorPlan(full, calibration, options);
    const half = downscale(full, 2);
    const result = vectorizeAtWorkingResolution(
      {
        image: half,
        transform: sampleAffineTransform(calibration),
        scaleX: 0.5,
        scaleY: 0.5,
        sourceWidth: 800,
        sourceHeight: 600,
      },
      options,
    );

    // Box-filtered edges can leave 1-2 px stubs at corners; compare the real walls.
    const long = (walls: typeof reference.walls) =>
      walls.filter((w) => Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) > 0.5);
    expect(long(reference.walls)).toHaveLength(4);
    expect(long(result.walls)).toHaveLength(4);
    expect(result.spaces).toHaveLength(reference.spaces.length);
    const a = bounds(long(reference.walls).flatMap((w) => [w.start, w.end]));
    const b = bounds(long(result.walls).flatMap((w) => [w.start, w.end]));
    // Within ~2 source pixels (0.04 m) of the full-resolution result.
    for (const key of ["minX", "maxX", "minY", "maxY"] as const)
      expect(Math.abs(a[key] - b[key])).toBeLessThan(0.045);
    long(result.walls).forEach((w, i) =>
      expect(Math.abs(w.thickness - long(reference.walls)[i]!.thickness)).toBeLessThan(0.045),
    );
    expect(result.warnings[0]!.message).toContain("800×600 이미지를 400×300로 축소해 분석했습니다");
  });

  it("matches vectorizeFloorPlan exactly when no downscale is needed", () => {
    const image = drawRectOutline(300, 200, { x: 20, y: 20, w: 260, h: 160 }, 4);
    const direct = vectorizeFloorPlan(image, calibration);
    const viaBudget = vectorizeAtWorkingResolution({
      image,
      transform: sampleAffineTransform(calibration),
      scaleX: 1,
      scaleY: 1,
    });
    expect(viaBudget.walls.length).toBe(direct.walls.length);
    viaBudget.walls.forEach((w, i) => {
      expect(w.start.x).toBeCloseTo(direct.walls[i]!.start.x, 9);
      expect(w.start.y).toBeCloseTo(direct.walls[i]!.start.y, 9);
      expect(w.thickness).toBeCloseTo(direct.walls[i]!.thickness, 9);
    });
    expect(viaBudget.warnings.map((w) => w.message)).toEqual(direct.warnings.map((w) => w.message));
  });
});
