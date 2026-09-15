import type { Point } from "@indoor/core";
import { distance } from "@indoor/core";
import type { SnapContext, SnapProvider, SnapResult } from "./SnapProvider.js";

/**
 * Combines multiple SnapProviders and returns whichever result lands
 * closest to the raw input point.
 */
export class SnapManager {
  private providers: SnapProvider[] = [];
  private enabled = true;

  register(provider: SnapProvider): void {
    this.providers.push(provider);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  resolve(point: Point, context: SnapContext): Point {
    const result = this.resolveWithType(point, context);
    return result ? result.point : point;
  }

  resolveWithType(point: Point, context: SnapContext): SnapResult | null {
    if (!this.enabled) return null;

    let best: SnapResult | null = null;
    let bestDist = Infinity;

    for (const provider of this.providers) {
      const result = provider.getSnap(point, context);
      if (!result) continue;
      const d = distance(point, result.point);
      if (d < bestDist) {
        bestDist = d;
        best = result;
      }
    }

    return best;
  }
}
