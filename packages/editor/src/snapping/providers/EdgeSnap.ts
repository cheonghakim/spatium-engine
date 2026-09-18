import type { Point } from "@indoor/core";
import { distanceToSegment, nearestPointOnPolygon } from "@indoor/core";
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

    // Wall is a first-class drawing primitive (see WallTool's doc comment),
    // independent of Space polygons, so its own segment is a candidate too.
    for (const wall of context.floor.walls) {
      if (wall.id === context.excludeId) continue;
      const candidate = distanceToSegment(point, wall.start, wall.end);
      if (candidate.distance < bestDist) {
        bestDist = candidate.distance;
        best = { point: candidate.point, type: "edge" };
      }
    }

    return best;
  }
}
