import type { Point } from "@indoor/core";
import { automaticThreshold, binarize, toGrayscale, type RawImage } from "./binarize.js";
import {
  detectHorizontalSegments,
  detectVerticalSegments,
  mergeParallelSegments,
} from "./detectLines.js";
import { buildPlanarGraph } from "./buildGraph.js";
import { findFaces, selectRoomFaces } from "./findFaces.js";
import { detectElements, type DetectElementsOptions, type DraftElement } from "./detectElements.js";
import { estimateSkewAngle, imageCenter, rotateBinaryImage, rotatePoint } from "./deskew.js";
import type { PixelPoint } from "./buildGraph.js";

export interface VectorizeOptions {
  autoThreshold?: boolean;
  /** Bridge small scan defects, preserving larger openings. */
  maxLineGapPx?: number;
  /** Reject thin furniture/text strokes before constructing the graph. */
  minWallThicknessPx?: number;
  /** Grayscale threshold (0-255); pixels darker than this count as wall ink. */
  threshold?: number;
  /** Minimum run length (px) to count as a wall segment candidate. */
  minSegmentLengthPx?: number;
  /** Max gap (px) between parallel runs to merge into one wall centerline. */
  maxMergeGapPx?: number;
  /** Tolerance (px) for snapping nearby endpoints into one graph node. */
  snapTolerancePx?: number;
  /** Minimum face area (px²) to keep as a room candidate, rejecting slivers. */
  minRoomAreaPx?: number;
  /** Estimate and correct small global rotation (a crooked photo/scan) before scanning for axis-aligned segments. */
  autoDeskew?: boolean;
  /** Below this width (m), a gap between two collinear walls is a scan defect, not a door/window opening. Passed through to `detectElements`. */
  minOpeningGapM?: number;
  /** Above this width (m), a gap is too wide to read as a single door/window opening. Passed through to `detectElements`. */
  maxOpeningGapM?: number;
  /** Minimum wall run length (m) eligible to be paired across a candidate opening. Passed through to `detectElements`. */
  minElementWallLengthM?: number;
  /** Minimum spacing (m) between adjacent stair-tread strokes. Passed through to `detectElements`. */
  minTreadSpacingM?: number;
  /** Maximum spacing (m) between adjacent stair-tread strokes. Passed through to `detectElements`. */
  maxTreadSpacingM?: number;
  /** Stair-tread candidate run width bounds (m). Passed through to `detectElements`. */
  minTreadWidthM?: number;
  maxTreadWidthM?: number;
  /** Maximum stroke thickness (m) for a wall to be considered a tread. Passed through to `detectElements`. */
  maxTreadThicknessM?: number;
  /** Minimum number of regularly spaced treads required to report a staircase candidate. Passed through to `detectElements`. */
  minTreadCount?: number;
}

export interface DraftWall {
  start: Point;
  end: Point;
  thickness: number;
}

export interface DraftSpace {
  polygon: Point[];
  /** Boundary crosses an inferred opening; requires explicit review. */
  needsReview?: boolean;
}

export interface VectorizationWarning {
  message: string;
}

export interface VectorizationResult {
  walls: DraftWall[];
  spaces: DraftSpace[];
  warnings: VectorizationWarning[];
  elements: DraftElement[];
}

const DEFAULTS: Required<VectorizeOptions> = {
  autoThreshold: true,
  maxLineGapPx: 2,
  minWallThicknessPx: 1,
  threshold: 128,
  minSegmentLengthPx: 15,
  maxMergeGapPx: 6,
  snapTolerancePx: 4,
  minRoomAreaPx: 400,
  autoDeskew: true,
  minOpeningGapM: 0.55,
  maxOpeningGapM: 2.4,
  minElementWallLengthM: 0.4,
  minTreadSpacingM: 0.16,
  maxTreadSpacingM: 0.4,
  minTreadWidthM: 0.6,
  maxTreadWidthM: 3,
  maxTreadThicknessM: 0.12,
  minTreadCount: 5,
};

/** Below this, an estimated rotation is treated as measurement noise rather than real skew, so an already-straight plan is never touched. */
const MIN_SIGNIFICANT_SKEW_DEGREES = 0.3;

/**
 * Classical-CV floor plan vectorization (spec §18's VectorizationService,
 * implemented with heuristics instead of a trained model — see project notes
 * on why: no license-clean, Node-runnable pretrained model was available).
 * Never publishes directly: callers get draft walls/spaces for human review.
 * Handles only straight walls — a bounded auto-deskew pass (see `autoDeskew`)
 * corrects small global rotation, but curved walls are not detected and
 * remain out of scope.
 *
 * `pixelToWorld` should be the same calibration transform the reference
 * image itself uses, so results line up with it exactly.
 */
export function vectorizeFloorPlan(
  image: RawImage,
  pixelToWorld: (pixel: Point) => Point,
  options: VectorizeOptions = {},
): VectorizationResult {
  const opts = { ...DEFAULTS, ...options };
  const warnings: VectorizationWarning[] = [];

  const origin = pixelToWorld({ x: 0, y: 0 });
  const unitX = pixelToWorld({ x: 1, y: 0 });
  const unitY = pixelToWorld({ x: 0, y: 1 });
  const metersPerPixel = Math.hypot(unitX.x - origin.x, unitX.y - origin.y) || 1;
  // Linear part of `pixelToWorld` (columns = images of the pixel unit axes,
  // relative to `origin`), used below to build/undo the "detection frame" —
  // see `detectionWalls`. Assumes (as the rest of this function already does
  // for `metersPerPixel`) that `pixelToWorld` is affine — scale, translation,
  // and optionally an axis flip/reflection, but no rotation of its own.
  const detectionColX = { x: unitX.x - origin.x, y: unitX.y - origin.y };
  const detectionColY = { x: unitY.x - origin.x, y: unitY.y - origin.y };
  const detectionDeterminant =
    detectionColX.x * detectionColY.y - detectionColY.x * detectionColX.y;

  const gray = toGrayscale(image);
  const binary = binarize(
    gray,
    opts.autoThreshold && options.threshold === undefined
      ? automaticThreshold(gray)
      : opts.threshold,
  );

  // Bounded deskew pre-pass: estimate a small global rotation (a crooked
  // photo/scan) and, only if it's meaningfully non-zero, correct it before
  // scanning for axis-aligned segments. Whenever `autoDeskew` is enabled
  // (the default), `estimateSkewAngle` itself always runs (~9ms measured on
  // a 1200x900 image) — what's skipped when the estimate is negligible is
  // only the subsequent full-raster rotation (`rotateBinaryImage`) and its
  // associated behavior change, not the estimation cost.
  const skewAngleDegrees = opts.autoDeskew ? estimateSkewAngle(binary) : 0;
  const deskewed = Math.abs(skewAngleDegrees) > MIN_SIGNIFICANT_SKEW_DEGREES;
  const workingBinary = deskewed ? rotateBinaryImage(binary, -skewAngleDegrees) : binary;
  const rotationCenter = imageCenter(binary);
  // Segments/graph points below are in `workingBinary`'s (possibly rotated)
  // pixel frame; map back to the original image's pixel frame before
  // applying the caller's calibration transform.
  const toWorld = (p: PixelPoint): Point =>
    pixelToWorld(deskewed ? rotatePoint(p, skewAngleDegrees, rotationCenter) : p);
  if (deskewed) {
    warnings.push({
      message: `이미지가 약 ${Math.abs(skewAngleDegrees).toFixed(1)}도 기울어진 것으로 추정되어 자동으로 보정했습니다. 벽 인식 결과를 확인하세요.`,
    });
  }

  const rawHorizontal = detectHorizontalSegments(
    workingBinary,
    opts.minSegmentLengthPx,
    opts.maxLineGapPx,
  );
  const rawVertical = detectVerticalSegments(
    workingBinary,
    opts.minSegmentLengthPx,
    opts.maxLineGapPx,
  );
  const mergedHorizontal = mergeParallelSegments(rawHorizontal, opts.maxMergeGapPx, "horizontal");
  const mergedVertical = mergeParallelSegments(rawVertical, opts.maxMergeGapPx, "vertical");
  const segments = [...mergedHorizontal, ...mergedVertical].filter(
    (s) => s.thicknessPx >= opts.minWallThicknessPx,
  );

  if (segments.length === 0) {
    warnings.push({
      message:
        "직선을 하나도 찾지 못했습니다. 이미지 대비가 낮거나 흑백 선 도면이 아닐 수 있습니다.",
    });
    return { walls: [], spaces: [], elements: [], warnings };
  }

  const graph = buildPlanarGraph(segments, opts.snapTolerancePx);

  const walls: DraftWall[] = graph.edges.map((edge) => ({
    start: toWorld(graph.points[edge.from]!),
    end: toWorld(graph.points[edge.to]!),
    thickness: Math.max(0.05, edge.thicknessPx * metersPerPixel),
  }));

  // `detectElements`'s opening-search fast path (see its own doc comment)
  // assumes every wall it receives is exactly axis-aligned, matching this
  // package's own pixel scan — but `walls` above is NOT exactly axis-aligned
  // once deskew is active: `toWorld` rotates coordinates back to the
  // original tilted frame (`rotatePoint` then `pixelToWorld`) before this
  // point, so two walls genuinely collinear on that tilted line can round to
  // different offset buckets and never get compared, silently missing
  // openings. `detectionWalls` instead maps the same pixel data through
  // `pixelToWorld` alone (no rotate-back), which stays axis-aligned as long
  // as `pixelToWorld` itself has no rotation of its own (true for every
  // caller today — see `ReferenceManager.imagePixelToWorld`, a pure
  // scale+translate(+axis-flip) map; `detectionDeterminant` guards the one
  // case that would violate this, a degenerate/singular `pixelToWorld`).
  // Candidate positions/support walls are mapped back into `walls`'s final
  // world frame afterward via `detectionPointToWorld`/`detectionAngleToWorldDegrees`.
  const canRemapDetectionFrame = deskewed && Math.abs(detectionDeterminant) > 1e-9;
  const detectionWalls: DraftWall[] = canRemapDetectionFrame
    ? graph.edges.map((edge) => ({
        start: pixelToWorld(graph.points[edge.from]!),
        end: pixelToWorld(graph.points[edge.to]!),
        thickness: Math.max(0.05, edge.thicknessPx * metersPerPixel),
      }))
    : walls;

  /** Maps a point from `detectionWalls`'s frame into `walls`'s final world frame. */
  const detectionPointToWorld = (p: Point): Point => {
    const dx = p.x - origin.x,
      dy = p.y - origin.y;
    const px = (detectionColY.y * dx - detectionColY.x * dy) / detectionDeterminant;
    const py = (-detectionColX.y * dx + detectionColX.x * dy) / detectionDeterminant;
    return toWorld({ x: px, y: py });
  };
  /** Same remap for a direction vector (no translation) — used for a `rotation` angle below. */
  const detectionVectorToWorld = (v: Point): Point => {
    const px = (detectionColY.y * v.x - detectionColY.x * v.y) / detectionDeterminant;
    const py = (-detectionColX.y * v.x + detectionColX.x * v.y) / detectionDeterminant;
    const rotated = rotatePoint({ x: px, y: py }, skewAngleDegrees, { x: 0, y: 0 });
    return {
      x: detectionColX.x * rotated.x + detectionColY.x * rotated.y,
      y: detectionColX.y * rotated.x + detectionColY.y * rotated.y,
    };
  };
  const detectionAngleToWorldDegrees = (angleDegrees: number): number => {
    const rad = (angleDegrees * Math.PI) / 180;
    const v = detectionVectorToWorld({ x: Math.cos(rad), y: Math.sin(rad) });
    return (Math.atan2(v.y, v.x) * 180) / Math.PI;
  };

  const elementOptions: DetectElementsOptions = {
    ...(options.minOpeningGapM !== undefined ? { minOpeningGapM: options.minOpeningGapM } : {}),
    ...(options.maxOpeningGapM !== undefined ? { maxOpeningGapM: options.maxOpeningGapM } : {}),
    ...(options.minElementWallLengthM !== undefined
      ? { minWallLengthM: options.minElementWallLengthM }
      : {}),
    ...(options.minTreadSpacingM !== undefined
      ? { minTreadSpacingM: options.minTreadSpacingM }
      : {}),
    ...(options.maxTreadSpacingM !== undefined
      ? { maxTreadSpacingM: options.maxTreadSpacingM }
      : {}),
    ...(options.minTreadWidthM !== undefined ? { minTreadWidthM: options.minTreadWidthM } : {}),
    ...(options.maxTreadWidthM !== undefined ? { maxTreadWidthM: options.maxTreadWidthM } : {}),
    ...(options.maxTreadThicknessM !== undefined
      ? { maxTreadThicknessM: options.maxTreadThicknessM }
      : {}),
    ...(options.minTreadCount !== undefined ? { minTreadCount: options.minTreadCount } : {}),
  };
  const rawElements = detectElements(detectionWalls, elementOptions);
  // Remap candidate geometry from `detectionWalls`'s frame back into the same
  // final world frame `walls`/`worldPoints` use below, so the bridge-closing
  // match against `worldPoints` (via `nearestNode`) keeps working correctly.
  const elements: DraftElement[] = canRemapDetectionFrame
    ? rawElements.map((element) => ({
        ...element,
        position: detectionPointToWorld(element.position),
        ...(element.rotation !== undefined
          ? { rotation: detectionAngleToWorldDegrees(element.rotation) }
          : {}),
        ...(element.supportWall
          ? {
              supportWall: {
                ...element.supportWall,
                start: detectionPointToWorld(element.supportWall.start),
                end: detectionPointToWorld(element.supportWall.end),
              },
            }
          : {}),
      }))
    : rawElements;
  // Close candidate openings only in the room topology, never in the detected wall output.
  const worldPoints = graph.points.map(toWorld);
  const nearestNode = (point: Point) =>
    worldPoints.reduce(
      (best, p, i) =>
        Math.hypot(p.x - point.x, p.y - point.y) <
        Math.hypot(worldPoints[best]!.x - point.x, worldPoints[best]!.y - point.y)
          ? i
          : best,
      0,
    );
  const bridges = elements.flatMap((element) => {
    if (!element.supportWall) return [];
    const from = nearestNode(element.supportWall.start),
      to = nearestNode(element.supportWall.end);
    return from === to
      ? []
      : [{ from, to, thicknessPx: element.supportWall.thickness / metersPerPixel }];
  });
  const faces = findFaces({ points: graph.points, edges: [...graph.edges, ...bridges] });
  const roomFaces = selectRoomFaces(faces, opts.minRoomAreaPx);
  const spaces: DraftSpace[] = roomFaces.map((face) => ({
    polygon: face.nodeIndices.map((i) => toWorld(graph.points[i]!)),
    ...(bridges.some((bridge) =>
      face.nodeIndices.some((node, i) => {
        const next = face.nodeIndices[(i + 1) % face.nodeIndices.length];
        return (
          (node === bridge.from && next === bridge.to) ||
          (node === bridge.to && next === bridge.from)
        );
      }),
    )
      ? { needsReview: true }
      : {}),
  }));

  if (spaces.length === 0) {
    warnings.push({ message: "닫힌 방 형태를 찾지 못했습니다 — 벽만 초안으로 제공됩니다." });
  }

  if (spaces.some((s) => s.needsReview))
    warnings.push({
      message: "틈을 가상으로 연결해 추정한 방은 기본 제외했습니다. 방 윤곽을 확인하고 포함하세요.",
    });
  if (elements.length)
    warnings.push({
      message:
        "건축 요소 후보는 기본 제외 상태입니다. 종류·치수·방향을 확인하고 포함하세요. 높이는 도면에서 추출하지 않습니다.",
    });
  return { walls, spaces, elements, warnings };
}
