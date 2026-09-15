import { describe, expect, it } from "vitest";
import { findFaces, selectRoomFaces } from "./findFaces.js";
import type { PlanarGraph } from "./buildGraph.js";

function square(x0: number, y0: number, size: number, idOffset: number) {
  return {
    points: [
      { x: x0, y: y0 },
      { x: x0 + size, y: y0 },
      { x: x0 + size, y: y0 + size },
      { x: x0, y: y0 + size },
    ],
    edges: [
      { from: idOffset, to: idOffset + 1, thicknessPx: 2 },
      { from: idOffset + 1, to: idOffset + 2, thicknessPx: 2 },
      { from: idOffset + 2, to: idOffset + 3, thicknessPx: 2 },
      { from: idOffset + 3, to: idOffset, thicknessPx: 2 },
    ],
  };
}

describe("findFaces / selectRoomFaces", () => {
  it("finds the inner room and the outer face of a single square", () => {
    const s = square(0, 0, 10, 0);
    const graph: PlanarGraph = { points: s.points, edges: s.edges };

    const faces = findFaces(graph);
    expect(faces).toHaveLength(2);

    const rooms = selectRoomFaces(faces, 1);
    expect(rooms).toHaveLength(1);
    expect(Math.abs(rooms[0]!.areaPx)).toBeCloseTo(100);
  });

  it("rejects the room if it's below the minimum area", () => {
    const s = square(0, 0, 10, 0);
    const graph: PlanarGraph = { points: s.points, edges: s.edges };
    const faces = findFaces(graph);
    expect(selectRoomFaces(faces, 1000)).toHaveLength(0);
  });

  it("finds four inner rooms in a 2x2 grid sharing a center point", () => {
    // A 20x20 square split into four 10x10 rooms by a cross through the center.
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 0, y: 20 },
      { x: 10, y: 20 },
      { x: 20, y: 20 },
    ];
    const edges = [
      { from: 0, to: 1, thicknessPx: 2 },
      { from: 1, to: 2, thicknessPx: 2 },
      { from: 3, to: 4, thicknessPx: 2 },
      { from: 4, to: 5, thicknessPx: 2 },
      { from: 6, to: 7, thicknessPx: 2 },
      { from: 7, to: 8, thicknessPx: 2 },
      { from: 0, to: 3, thicknessPx: 2 },
      { from: 3, to: 6, thicknessPx: 2 },
      { from: 1, to: 4, thicknessPx: 2 },
      { from: 4, to: 7, thicknessPx: 2 },
      { from: 2, to: 5, thicknessPx: 2 },
      { from: 5, to: 8, thicknessPx: 2 },
    ];
    const graph: PlanarGraph = { points, edges };

    const faces = findFaces(graph);
    const rooms = selectRoomFaces(faces, 1);
    expect(rooms).toHaveLength(4);
    for (const room of rooms) {
      expect(Math.abs(room.areaPx)).toBeCloseTo(100);
    }
  });
});
