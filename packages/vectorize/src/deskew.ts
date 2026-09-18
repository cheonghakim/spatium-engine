import type { Point } from "@indoor/core";
import type { BinaryImage } from "./binarize.js";

export interface DeskewOptions {
  /** Half-width (degrees) of the angle range searched around 0. Larger scans cost more but tolerate more skew. */
  maxAngleDegrees?: number;
  /** Angle step (degrees) between candidates in the search. */
  stepDegrees?: number;
}

const DESKEW_DEFAULTS: Required<DeskewOptions> = {
  maxAngleDegrees: 10,
  stepDegrees: 0.5,
};

/** Cap on ink pixels rotated per candidate angle during the search, so estimation stays bounded on large images. */
const MAX_SAMPLE_POINTS = 4000;

/** Require a real (not floating-point/sampling noise) improvement over the zero-skew hypothesis before reporting non-zero skew. */
const NO_SKEW_SCORE_MARGIN = 1e-6;

/** Rotates a point about `center` by `angleDegrees` (standard CCW convention in xy space). */
export function rotatePoint(
  point: Point,
  angleDegrees: number,
  center: Point = { x: 0, y: 0 },
): Point {
  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad),
    sin = Math.sin(rad);
  const dx = point.x - center.x,
    dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** Inverse of `rotatePoint`: maps a point that was rotated by `angleDegrees` back to its pre-rotation location. */
export function rotatePointInverse(
  point: Point,
  angleDegrees: number,
  center: Point = { x: 0, y: 0 },
): Point {
  return rotatePoint(point, -angleDegrees, center);
}

/** The pixel center a `BinaryImage` is rotated about — shared by `rotateBinaryImage` and its callers so coordinate mapping stays consistent. */
export function imageCenter(image: Pick<BinaryImage, "width" | "height">): Point {
  return { x: (image.width - 1) / 2, y: (image.height - 1) / 2 };
}

/**
 * Rotates a binary wall mask by `angleDegrees` about its center using
 * nearest-neighbor sampling (fine for a binary mask; this is not a
 * photographic resample). A point at (x, y) in `image` ends up at
 * `rotatePoint({x, y}, angleDegrees, imageCenter(image))` in the result, so
 * `rotatePointInverse` with the same angle/center maps a point found in the
 * rotated image back to `image`'s original pixel frame. The canvas size is
 * unchanged, so content can fall outside it near the corners — acceptable
 * for the small angles (a few degrees) this pre-pass targets.
 *
 * Curved walls are out of scope for this whole package (see
 * `vectorizeFloorPlan`'s doc comment); this only corrects a small global
 * rotation of an otherwise straight-line plan, not curvature.
 */
export function rotateBinaryImage(image: BinaryImage, angleDegrees: number): BinaryImage {
  const { width, height } = image;
  const center = imageCenter(image);
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = rotatePoint({ x, y }, -angleDegrees, center);
      const sx = Math.round(source.x),
        sy = Math.round(source.y);
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        ink[y * width + x] = image.ink[sy * width + sx]!;
      }
    }
  }
  return { width, height, ink };
}

/** Collects ink pixel coordinates, downsampling by stride (not by resolution) so large images stay bounded. */
function collectInkPoints(image: BinaryImage, maxPoints: number): Point[] {
  const points: Point[] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.ink[y * image.width + x] === 1) points.push({ x, y });
    }
  }
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % stride === 0);
}

/** Variance of the row-occupancy histogram after de-rotating `points` by `-angleDegrees` — a well-aligned guess produces sharper (more variable) rows. */
function rowProfileVariance(points: readonly Point[], angleDegrees: number, center: Point): number {
  if (points.length === 0) return 0;
  let min = Infinity,
    max = -Infinity;
  const rows = new Array<number>(points.length);
  for (let i = 0; i < points.length; i++) {
    const row = Math.round(rotatePoint(points[i]!, -angleDegrees, center).y);
    rows[i] = row;
    if (row < min) min = row;
    if (row > max) max = row;
  }
  const size = max - min + 1;
  const histogram = new Float64Array(size);
  for (const row of rows) histogram[row - min]! += 1;
  let mean = 0;
  for (const count of histogram) mean += count;
  mean /= size;
  let variance = 0;
  for (const count of histogram) variance += (count - mean) * (count - mean);
  return variance / size;
}

/**
 * Estimates a floor plan's global rotation with a projection-profile
 * heuristic: a well-aligned scan has sharp peaks/troughs in its row-sum
 * profile (walls line up into a few dense rows against mostly-empty ones),
 * while a skewed scan blurs that structure across many rows. The search
 * tries candidate angles across [-maxAngleDegrees, maxAngleDegrees] and
 * picks the one whose de-rotated row-occupancy histogram has the highest
 * variance.
 *
 * Bounded cost by construction: it samples at most a few thousand ink
 * pixels (not the full raster) and only rotates that sample per candidate
 * angle; the caller does the one real full-resolution rotation afterwards
 * via `rotateBinaryImage`, using only the winning angle.
 *
 * Returns the estimated skew in degrees (0 when the image already reads as
 * aligned, or when there isn't enough ink to tell). Pass the *negated*
 * result to `rotateBinaryImage` to straighten the image.
 */
export function estimateSkewAngle(image: BinaryImage, options: DeskewOptions = {}): number {
  const { maxAngleDegrees, stepDegrees } = { ...DESKEW_DEFAULTS, ...options };
  const points = collectInkPoints(image, MAX_SAMPLE_POINTS);
  if (points.length < 8) return 0;

  const center = imageCenter(image);
  const steps = Math.max(1, Math.round(maxAngleDegrees / stepDegrees));
  const zeroScore = rowProfileVariance(points, 0, center);
  let bestAngle = 0;
  let bestScore = zeroScore;
  for (let i = -steps; i <= steps; i++) {
    if (i === 0) continue; // angle 0 is the `zeroScore` baseline above, computed once
    const angle = i * stepDegrees;
    const score = rowProfileVariance(points, angle, center);
    // Require a real improvement over "no skew" before preferring a non-zero
    // angle — on small/discrete rasters a tie can go either way by pure
    // rounding noise, and we'd rather stay a no-op than nudge an
    // already-aligned plan.
    if (score > bestScore * (1 + NO_SKEW_SCORE_MARGIN)) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  return bestAngle;
}
