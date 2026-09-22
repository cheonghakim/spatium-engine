import {
  distance,
  isPointInPolygon,
  type Floor,
  type Furniture,
  type Point,
  type POI,
  type Space,
} from "@indoor/core";
import type { Overlay } from "./overlay.js";

const HIT_RADIUS_PX = 14;

export type HitResult =
  | { kind: "marker"; overlay: Overlay }
  | { kind: "poi"; poi: POI }
  | { kind: "furniture"; item: Furniture }
  | { kind: "space"; space: Space };

/**
 * Markers > POIs > Furniture > Spaces, matching how small point features
 * should win over the large polygon underneath them.
 */
export function hitTest(
  point: Point,
  floor: Floor,
  overlays: readonly Overlay[],
  hitRadiusWorld: number = HIT_RADIUS_PX / 50,
): HitResult | null {
  for (const overlay of overlays) {
    if (overlay.floorId !== floor.id) continue;
    if (distance(point, overlay.position) <= hitRadiusWorld) return { kind: "marker", overlay };
  }

  for (const poi of floor.pois) {
    if (distance(point, poi.position) <= hitRadiusWorld) return { kind: "poi", poi };
  }

  for (const item of floor.furniture) {
    if (distance(point, item.position) <= hitRadiusWorld) return { kind: "furniture", item };
  }

  for (let i = floor.spaces.length - 1; i >= 0; i--) {
    const space = floor.spaces[i];
    if (space && isPointInPolygon(point, space.polygon)) return { kind: "space", space };
  }

  return null;
}

export { HIT_RADIUS_PX };
