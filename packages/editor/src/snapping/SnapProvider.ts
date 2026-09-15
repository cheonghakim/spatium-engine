import type { Floor, Point } from "@indoor/core";

export interface SnapContext {
  floor: Floor;
  /** Id of the vertex/object currently being dragged, so it doesn't snap to itself. */
  excludeId?: string;
  /** The previously placed point, used by orthogonal/alignment snapping. */
  referencePoint?: Point;
}

export interface SnapResult {
  point: Point;
  type: string;
}

export interface SnapProvider {
  getSnap(point: Point, context: SnapContext): SnapResult | null;
}
