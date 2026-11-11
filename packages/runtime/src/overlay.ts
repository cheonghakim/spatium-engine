import type { Point } from "@indoor/core";

/**
 * Generalized overlay concept shared by Runtime and Builder (spec §28).
 *
 * Not every type is drawn as itself yet — see OVERLAY_SUPPORT. A type that a
 * renderer doesn't support is drawn as a plain marker there, and the runtime
 * emits `overlay.fallback` when such an overlay is added, so a missing image
 * or polygon is never mistaken for a configuration error.
 */
export type OverlayType =
  "marker" | "label" | "icon" | "image" | "circle" | "polygon" | "html" | "route";

/** How each renderer draws each overlay type today: as itself, or as a marker fallback. */
export const OVERLAY_SUPPORT: Readonly<
  Record<OverlayType, { "2d": "native" | "marker"; "3d": "native" | "marker" }>
> = {
  marker: { "2d": "native", "3d": "native" },
  label: { "2d": "native", "3d": "marker" },
  circle: { "2d": "native", "3d": "marker" },
  icon: { "2d": "marker", "3d": "marker" },
  image: { "2d": "marker", "3d": "marker" },
  polygon: { "2d": "marker", "3d": "marker" },
  html: { "2d": "marker", "3d": "marker" },
  route: { "2d": "marker", "3d": "marker" },
};

export interface Overlay {
  id: string;
  floorId: string;
  type: OverlayType;
  position: Point;
  properties?: Record<string, unknown>;
}
