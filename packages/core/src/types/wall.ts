import type { Point } from "./common.js";

/**
 * Walls are simple line segments, independent of Space polygons.
 * A wall does not define a room boundary by itself — Space.polygon does.
 */
export interface Wall {
  id: string;
  floorId: string;

  start: Point;
  end: Point;

  thickness: number;
  height?: number;
}
