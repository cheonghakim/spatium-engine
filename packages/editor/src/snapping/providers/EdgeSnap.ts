import type { Point } from "@indoor/core";
import { nearestPointOnPolygon } from "@indoor/core";
import type { SnapContext, SnapProvider, SnapResult } from "../SnapProvider.js";

export class EdgeSnap implements SnapProvider {
  constructor(private readonly threshold = 0.15) {}

  getSnap(point: Point, context: SnapContext): SnapResult | null {
    let best: SnapResult | null = null;
    let bestDist = this.threshold;

    for (const space of context.floor.spaces) {
      if (space.id === context.excludeId || space.polygon.length < 2) continue;
      const candidate = nearestPointOnPolygon(point, space.polygon);
      if (candidate.distance < bestDist) {
        bestDist = candidate.distance;
        best = { point: candidate.point, type: "edge" };
      }
    }

    return best;
  }
}
