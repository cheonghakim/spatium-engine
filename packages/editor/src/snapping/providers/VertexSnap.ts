import type { Point } from "@indoor/core";
import { distance } from "@indoor/core";
import type { SnapContext, SnapProvider, SnapResult } from "../SnapProvider.js";

export class VertexSnap implements SnapProvider {
  constructor(private readonly threshold = 0.2) {}

  getSnap(point: Point, context: SnapContext): SnapResult | null {
    let best: Point | null = null;
    let bestDist = this.threshold;

    for (const space of context.floor.spaces) {
      if (space.id === context.excludeId) continue;
      for (const vertex of space.polygon) {
        const d = distance(point, vertex);
        if (d < bestDist) {
          bestDist = d;
          best = vertex;
        }
      }
    }

    return best ? { point: { ...best }, type: "vertex" } : null;
  }
}
