import type { Point } from "@indoor/core";

/**
 * Generalized overlay concept shared by Runtime and Builder (spec §28).
 * Type-only for now — rendering lands in Phase 7/8.
 */
export type OverlayType =
  | "marker"
  | "label"
  | "icon"
  | "image"
  | "circle"
  | "polygon"
  | "html"
  | "route";

export interface Overlay {
  id: string;
  floorId: string;
  type: OverlayType;
  position: Point;
  properties?: Record<string, unknown>;
}
