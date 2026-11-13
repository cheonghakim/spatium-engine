import type { Point } from "@indoor/core";
import type { SnapContext, SnapProvider, SnapResult } from "../SnapProvider.js";

/**
 * Aligns a new point horizontally or vertically with context.referencePoint.
 *
 * Only one axis is locked to the reference; the other is free. With the grid
 * on (`getGridSize` returns a size), that free coordinate is rounded to the
 * grid too — otherwise this result (closer to the raw click than the grid
 * point) would win SnapManager's closest-wins pick and leave e.g. a chained
 * wall 3.3 m long while grid snapping is enabled.
 */
export class OrthogonalSnap implements SnapProvider {
  constructor(
    private readonly threshold = 0.15,
    private readonly getGridSize: () => number | null = () => null,
  ) {}

  getSnap(point: Point, context: SnapContext): SnapResult | null {
    const ref = context.referencePoint;
    if (!ref) return null;

    const dx = Math.abs(point.x - ref.x);
    const dy = Math.abs(point.y - ref.y);
    const grid = this.getGridSize();
    const free = (value: number) => (grid ? Math.round(value / grid) * grid + 0 : value);

    if (dx <= this.threshold && dx <= dy) {
      return { point: { x: ref.x, y: free(point.y) }, type: "orthogonal" };
    }
    if (dy <= this.threshold && dy < dx) {
      return { point: { x: free(point.x), y: ref.y }, type: "orthogonal" };
    }
    return null;
  }
}
