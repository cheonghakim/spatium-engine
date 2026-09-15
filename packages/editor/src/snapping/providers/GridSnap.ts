import type { Point } from "@indoor/core";
import { distance } from "@indoor/core";
import type { SnapContext, SnapProvider, SnapResult } from "../SnapProvider.js";

export class GridSnap implements SnapProvider {
  private enabled = true;

  constructor(
    private readonly gridSize = 1,
    private readonly threshold = 0.15,
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getSnap(point: Point, _context: SnapContext): SnapResult | null {
    if (!this.enabled) return null;
    const snapped: Point = {
      x: Math.round(point.x / this.gridSize) * this.gridSize,
      y: Math.round(point.y / this.gridSize) * this.gridSize,
    };
    if (distance(point, snapped) <= this.threshold) {
      return { point: snapped, type: "grid" };
    }
    return null;
  }
}
