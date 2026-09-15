import { describe, expect, it } from "vitest";
import { buildPlanarGraph } from "./buildGraph.js";
import type { PixelSegment } from "./detectLines.js";

function seg(
  orientation: "horizontal" | "vertical",
  offset: number,
  start: number,
  end: number,
): PixelSegment & { thicknessPx: number } {
  return { orientation, offset, start, end, thicknessPx: 2 };
}

describe("buildPlanarGraph", () => {
  it("splits a crossing horizontal and vertical segment at their intersection", () => {
    const horizontal = seg("horizontal", 5, 0, 20);
    const vertical = seg("vertical", 10, 0, 10);

    const graph = buildPlanarGraph([horizontal, vertical], 1);

    expect(graph.points).toHaveLength(5);
    expect(graph.points).toContainEqual({ x: 0, y: 5 });
    expect(graph.points).toContainEqual({ x: 10, y: 5 });
    expect(graph.points).toContainEqual({ x: 20, y: 5 });
    expect(graph.points).toContainEqual({ x: 10, y: 0 });
    expect(graph.points).toContainEqual({ x: 10, y: 10 });
    expect(graph.edges).toHaveLength(4);
  });

  it("forms a closed loop of 4 nodes/edges for a rectangle's four sides", () => {
    const segments = [
      seg("horizontal", 0, 0, 10),
      seg("horizontal", 10, 0, 10),
      seg("vertical", 0, 0, 10),
      seg("vertical", 10, 0, 10),
    ];

    const graph = buildPlanarGraph(segments, 2);

    expect(graph.points).toHaveLength(4);
    expect(graph.edges).toHaveLength(4);
    for (const corner of [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ]) {
      expect(graph.points).toContainEqual(corner);
    }
  });

  it("snaps nearly-touching endpoints together instead of leaving a gap", () => {
    const segments = [seg("horizontal", 0, 0, 10), seg("vertical", 10, 0, 10)]; // T touching near (10,0)... offset by 1px
    segments[1] = { ...segments[1]!, offset: 11 }; // vertical actually at x=11, 1px off from horizontal's end
    const graph = buildPlanarGraph(segments, 2);
    // Should still connect: horizontal end (10,0) and vertical start (11,0) collapse into one node.
    expect(graph.points.length).toBeLessThan(4);
  });
});
