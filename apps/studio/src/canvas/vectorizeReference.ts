import { vectorizeFloorPlan, type VectorizationResult, type VectorizeOptions } from "@indoor/vectorize";
import type { ReferenceManager } from "@indoor/editor";
import { getLoadedImage } from "./imageCache";

/**
 * Rasterizes the currently loaded reference image to pixels and runs the
 * CV-heuristic vectorizer (spec §16-18) against it, mapping detected
 * geometry through the reference's own pixel<->world calibration so drafts
 * line up with the image exactly as displayed.
 */
export function vectorizeReferenceImage(reference: ReferenceManager, options: VectorizeOptions = {}): VectorizationResult | null {
  const state = reference.current;
  if (!state) return null;

  const image = getLoadedImage(state.imageUrl);
  if (!image) return null;

  const canvas = document.createElement("canvas");
  canvas.width = state.naturalWidth;
  canvas.height = state.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0, state.naturalWidth, state.naturalHeight);
  const imageData = ctx.getImageData(0, 0, state.naturalWidth, state.naturalHeight);

  return vectorizeFloorPlan(
    { data: imageData.data, width: imageData.width, height: imageData.height },
    (pixel) => reference.imagePixelToWorld(pixel),
    options,
  );
}
