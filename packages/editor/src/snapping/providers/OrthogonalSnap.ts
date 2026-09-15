import type { Point } from "@indoor/core";
import type { SnapContext, SnapProvider, SnapResult } from "../SnapProvider.js";

/** Aligns a new point horizontally or vertically with context.referencePoint. */
export class OrthogonalSnap implements SnapProvider {
  constructor(private readonly threshold = 0.15) {}

  getSnap(point: Point, context: SnapContext): SnapResult | null {
    const ref = context.referencePoint;
    if (!ref) return null;

    const dx = Math.abs(point.x - ref.x);
    const dy = Math.abs(point.y - ref.y);

    if (dx <= this.threshold && dx <= dy) {
      return { point: { x: ref.x, y: point.y }, type: "orthogonal" };
    }
    if (dy <= this.threshold && dy < dx) {
      return { point: { x: point.x, y: ref.y }, type: "orthogonal" };
    }
    return null;
  }
}
