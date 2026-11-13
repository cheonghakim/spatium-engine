export { toGrayscale, binarize } from "./binarize.js";
export type { RawImage, GrayscaleImage, BinaryImage } from "./binarize.js";
export {
  detectHorizontalSegments,
  detectVerticalSegments,
  mergeParallelSegments,
} from "./detectLines.js";
export type { PixelSegment } from "./detectLines.js";
export { buildPlanarGraph } from "./buildGraph.js";
export type { PixelPoint, GraphEdge, PlanarGraph } from "./buildGraph.js";
export { findFaces, selectRoomFaces } from "./findFaces.js";
export type { Face } from "./findFaces.js";
export { vectorizeFloorPlan } from "./vectorizeFloorPlan.js";
export type { DraftElement } from "./detectElements.js";
export type { DetectElementsOptions } from "./detectElements.js";
export type {
  VectorizeOptions,
  DraftWall,
  DraftSpace,
  VectorizationWarning,
  VectorizationResult,
} from "./vectorizeFloorPlan.js";
export {
  estimateSkewAngle,
  rotateBinaryImage,
  rotatePoint,
  rotatePointInverse,
  imageCenter,
} from "./deskew.js";
export type { DeskewOptions } from "./deskew.js";
export {
  MAX_ANALYSIS_PIXELS,
  MAX_WORKING_PIXELS,
  MAX_WORKING_SIDE,
  planAnalysisResolution,
  sampleAffineTransform,
  applyAffineTransform,
  scaleTransformToWorkingResolution,
  scaleVectorizeOptions,
  vectorizeAtWorkingResolution,
} from "./analysisBudget.js";
export type {
  AnalysisLimits,
  AnalysisPlan,
  AffinePixelTransform,
  WorkingResolutionInput,
} from "./analysisBudget.js";
export { evaluateVectorization, truthFromFloor } from "./evaluate.js";
export type {
  EvaluationTruth,
  EvaluationPrediction,
  EvaluationOptions,
  MatchCount,
  VectorizationScore,
} from "./evaluate.js";
export { detectRegions, labelRegions } from "./regions.js";
export type { RegionOptions, RegionRoom, RegionWall, RegionResult } from "./regions.js";
