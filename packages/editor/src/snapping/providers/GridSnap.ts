import type { Point } from "@indoor/core";
import type { SnapContext, SnapProvider, SnapResult } from "../SnapProvider.js";

/**
 * Rounds every point to the nearest grid intersection while enabled. This is
 * an "always align to the grid" toggle, not a proximity trigger — a small
 * distance gate here would mean most ordinary clicks (anywhere but almost
 * exactly on a grid line) silently fail to snap at all, which is what "격자
 * 맞춤 켜져 있는데도 다른 곳에 그려진다" (grid snap is on but points still land
 * elsewhere) turned out to be. SnapManager's closest-wins arbitration already
 * lets a genuinely nearby vertex/edge snap take priority over this coarser
 * grid rounding when one exists, so always returning a result here is safe.
 */
export class GridSnap implements SnapProvider {
  private enabled = true;

  constructor(private readonly gridSize = 1) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** The grid size while snapping is on, else null — for providers that align to it too. */
  activeGridSize(): number | null {
    return this.enabled ? this.gridSize : null;
  }

  getSnap(point: Point, _context: SnapContext): SnapResult | null {
    if (!this.enabled) return null;
    return {
      point: {
        // `+ 0` turns -0 (from rounding small negatives) into 0.
        x: Math.round(point.x / this.gridSize) * this.gridSize + 0,
        y: Math.round(point.y / this.gridSize) * this.gridSize + 0,
      },
      type: "grid",
    };
  }
}
