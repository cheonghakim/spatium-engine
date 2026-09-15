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
export type {
  VectorizeOptions,
  DraftWall,
  DraftSpace,
  VectorizationWarning,
  VectorizationResult,
} from "./vectorizeFloorPlan.js";
