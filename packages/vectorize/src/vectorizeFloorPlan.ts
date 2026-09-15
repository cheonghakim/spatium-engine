import type { Point } from "@indoor/core";
import { automaticThreshold, binarize, toGrayscale, type RawImage } from "./binarize.js";
import { detectHorizontalSegments, detectVerticalSegments, mergeParallelSegments } from "./detectLines.js";
import { buildPlanarGraph } from "./buildGraph.js";
import { findFaces, selectRoomFaces } from "./findFaces.js";

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
}

export interface DraftWall {
  start: Point;
  end: Point;
  thickness: number;
}

export interface DraftSpace {
  polygon: Point[];
}

export interface VectorizationWarning {
  message: string;
}

export interface VectorizationResult {
  walls: DraftWall[];
  spaces: DraftSpace[];
  warnings: VectorizationWarning[];
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
};

/**
 * Classical-CV floor plan vectorization (spec §18's VectorizationService,
 * implemented with heuristics instead of a trained model — see project notes
 * on why: no license-clean, Node-runnable pretrained model was available).
 * Never publishes directly: callers get draft walls/spaces for human review.
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
  const metersPerPixel = Math.hypot(unitX.x - origin.x, unitX.y - origin.y) || 1;

  const gray = toGrayscale(image);
  const binary = binarize(gray, opts.autoThreshold && options.threshold === undefined ? automaticThreshold(gray) : opts.threshold);

  const rawHorizontal = detectHorizontalSegments(binary, opts.minSegmentLengthPx, opts.maxLineGapPx);
  const rawVertical = detectVerticalSegments(binary, opts.minSegmentLengthPx, opts.maxLineGapPx);
  const mergedHorizontal = mergeParallelSegments(rawHorizontal, opts.maxMergeGapPx, "horizontal");
  const mergedVertical = mergeParallelSegments(rawVertical, opts.maxMergeGapPx, "vertical");
  const segments = [...mergedHorizontal, ...mergedVertical].filter(s => s.thicknessPx >= opts.minWallThicknessPx);

  if (segments.length === 0) {
    warnings.push({
      message: "직선을 하나도 찾지 못했습니다. 이미지 대비가 낮거나 흑백 선 도면이 아닐 수 있습니다.",
    });
    return { walls: [], spaces: [], warnings };
  }

  const graph = buildPlanarGraph(segments, opts.snapTolerancePx);

  const walls: DraftWall[] = graph.edges.map((edge) => ({
    start: pixelToWorld(graph.points[edge.from]!),
    end: pixelToWorld(graph.points[edge.to]!),
    thickness: Math.max(0.05, edge.thicknessPx * metersPerPixel),
  }));

  const faces = findFaces(graph);
  const roomFaces = selectRoomFaces(faces, opts.minRoomAreaPx);
  const spaces: DraftSpace[] = roomFaces.map((face) => ({
    polygon: face.nodeIndices.map((i) => pixelToWorld(graph.points[i]!)),
  }));

  if (spaces.length === 0) {
    warnings.push({ message: "닫힌 방 형태를 찾지 못했습니다 — 벽만 초안으로 제공됩니다." });
  }

  return { walls, spaces, warnings };
}
