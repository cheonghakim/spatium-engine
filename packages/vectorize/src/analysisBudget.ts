import type { Point } from "@indoor/core";
import type { RawImage } from "./binarize.js";
import {
  DEFAULTS,
  vectorizeFloorPlan,
  type VectorizationResult,
  type VectorizeOptions,
} from "./vectorizeFloorPlan.js";

/**
 * Hard ceiling on source image size (width × height) accepted for analysis.
 * Above this the image is rejected outright rather than decoded/rasterized:
 * a 16 MP RGBA buffer alone is 64 MB before grayscale/binary/deskew copies.
 */
export const MAX_ANALYSIS_PIXELS = 16_000_000;
/**
 * Images larger than this are downscaled before analysis. ~4 MP keeps the
 * RGBA buffer around 16 MB and the whole CV pass to a few seconds at worst.
 */
export const MAX_WORKING_PIXELS = 4_000_000;
/** Longest side of the working raster — keeps extreme aspect ratios inside common canvas limits. */
export const MAX_WORKING_SIDE = 8192;

export interface AnalysisLimits {
  maxAnalysisPixels?: number;
  maxWorkingPixels?: number;
  maxWorkingSide?: number;
}

export type AnalysisPlan =
  | {
      ok: true;
      sourceWidth: number;
      sourceHeight: number;
      /** Working raster size (≤ source size). */
      width: number;
      height: number;
      /** working pixels per source pixel, per axis (1 when not downscaled). */
      scaleX: number;
      scaleY: number;
      downscaled: boolean;
    }
  | { ok: false; reason: "empty" | "too-large"; message: string };

function megapixels(pixels: number): string {
  return (pixels / 1_000_000).toFixed(1);
}

/**
 * Decides whether an image of the given size can be analyzed and at what
 * working resolution. Pure — the caller rasterizes at `width`×`height`.
 */
export function planAnalysisResolution(
  sourceWidth: number,
  sourceHeight: number,
  limits: AnalysisLimits = {},
): AnalysisPlan {
  const maxAnalysis = limits.maxAnalysisPixels ?? MAX_ANALYSIS_PIXELS;
  const maxWorking = limits.maxWorkingPixels ?? MAX_WORKING_PIXELS;
  const maxSide = limits.maxWorkingSide ?? MAX_WORKING_SIDE;
  const w = Math.floor(sourceWidth);
  const h = Math.floor(sourceHeight);
  if (!(w > 0) || !(h > 0)) {
    return { ok: false, reason: "empty", message: "이미지 크기를 확인할 수 없습니다." };
  }
  const pixels = w * h;
  if (pixels > maxAnalysis) {
    return {
      ok: false,
      reason: "too-large",
      message: `이미지가 너무 큽니다 (${w}×${h}, 약 ${megapixels(pixels)}MP). 자동 벡터화는 최대 ${megapixels(maxAnalysis)}MP까지 지원합니다. 해상도를 줄인 이미지로 다시 업로드하세요.`,
    };
  }
  const scale = Math.min(1, Math.sqrt(maxWorking / pixels), maxSide / Math.max(w, h));
  const width = Math.max(1, Math.min(w, Math.floor(w * scale)));
  const height = Math.max(1, Math.min(h, Math.floor(h * scale)));
  return {
    ok: true,
    sourceWidth: w,
    sourceHeight: h,
    width,
    height,
    scaleX: width / w,
    scaleY: height / h,
    downscaled: width !== w || height !== h,
  };
}

/**
 * Affine pixel→world map as plain data (so it can cross a Worker boundary):
 * world = origin + px·xAxis + py·yAxis.
 */
export interface AffinePixelTransform {
  origin: Point;
  xAxis: Point;
  yAxis: Point;
}

/** Samples an affine `pixelToWorld` (e.g. `ReferenceManager.imagePixelToWorld`) into plain data. */
export function sampleAffineTransform(pixelToWorld: (pixel: Point) => Point): AffinePixelTransform {
  const origin = pixelToWorld({ x: 0, y: 0 });
  const ux = pixelToWorld({ x: 1, y: 0 });
  const uy = pixelToWorld({ x: 0, y: 1 });
  return {
    origin,
    xAxis: { x: ux.x - origin.x, y: ux.y - origin.y },
    yAxis: { x: uy.x - origin.x, y: uy.y - origin.y },
  };
}

export function applyAffineTransform(t: AffinePixelTransform, p: Point): Point {
  return {
    x: t.origin.x + p.x * t.xAxis.x + p.y * t.yAxis.x,
    y: t.origin.y + p.x * t.xAxis.y + p.y * t.yAxis.y,
  };
}

/**
 * Re-expresses a source-pixel transform in working-raster pixels: a working
 * pixel p corresponds to source pixel (p.x / scaleX, p.y / scaleY), so the
 * world output (and metersPerPixel derived from it) stays in the same units
 * as a full-resolution run.
 */
export function scaleTransformToWorkingResolution(
  t: AffinePixelTransform,
  scaleX: number,
  scaleY: number,
): AffinePixelTransform {
  return {
    origin: { ...t.origin },
    xAxis: { x: t.xAxis.x / scaleX, y: t.xAxis.y / scaleX },
    yAxis: { x: t.yAxis.x / scaleY, y: t.yAxis.y / scaleY },
  };
}

/**
 * Pixel-unit options are expressed in source-image pixels (that is what the
 * Studio sliders show); converts them to working-raster pixels. Defaults are
 * scaled too, so a downscaled run behaves like a full-resolution one.
 */
export function scaleVectorizeOptions(options: VectorizeOptions, scale: number): VectorizeOptions {
  if (scale >= 1) return { ...options };
  const linear = (value: number, min: number) => Math.max(min, value * scale);
  return {
    ...options,
    minSegmentLengthPx: linear(options.minSegmentLengthPx ?? DEFAULTS.minSegmentLengthPx, 2),
    maxLineGapPx: linear(options.maxLineGapPx ?? DEFAULTS.maxLineGapPx, 0),
    maxMergeGapPx: linear(options.maxMergeGapPx ?? DEFAULTS.maxMergeGapPx, 0),
    minWallThicknessPx: linear(options.minWallThicknessPx ?? DEFAULTS.minWallThicknessPx, 0),
    snapTolerancePx: linear(options.snapTolerancePx ?? DEFAULTS.snapTolerancePx, 1),
    minRoomAreaPx: Math.max(1, (options.minRoomAreaPx ?? DEFAULTS.minRoomAreaPx) * scale * scale),
  };
}

export interface WorkingResolutionInput {
  /** Raster at working resolution (see `planAnalysisResolution`). */
  image: RawImage;
  /** Calibration in SOURCE-image pixels. */
  transform: AffinePixelTransform;
  scaleX: number;
  scaleY: number;
  /** Source image size, only used in the downscale warning. */
  sourceWidth?: number;
  sourceHeight?: number;
}

/**
 * Runs `vectorizeFloorPlan` on a (possibly downscaled) raster while keeping
 * outputs in the same world units as a full-resolution run. Pure and
 * DOM-free, so it runs identically inside a Worker and on the main thread.
 */
export function vectorizeAtWorkingResolution(
  input: WorkingResolutionInput,
  options: VectorizeOptions = {},
): VectorizationResult {
  const working = scaleTransformToWorkingResolution(input.transform, input.scaleX, input.scaleY);
  const scale = Math.sqrt(input.scaleX * input.scaleY);
  const result = vectorizeFloorPlan(
    input.image,
    (p) => applyAffineTransform(working, p),
    scaleVectorizeOptions(options, scale),
  );
  if (scale < 1) {
    const source =
      input.sourceWidth && input.sourceHeight
        ? `${input.sourceWidth}×${input.sourceHeight} 이미지를 `
        : "큰 이미지를 ";
    result.warnings.unshift({
      message: `${source}${input.image.width}×${input.image.height}로 축소해 분석했습니다. 얇은 선이 누락될 수 있으니 결과를 확인하세요.`,
    });
  }
  return result;
}
