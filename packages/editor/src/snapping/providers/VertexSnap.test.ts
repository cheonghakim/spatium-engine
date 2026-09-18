import { createFloor, createSpace, createWall } from "@indoor/core";
import { describe, expect, it } from "vitest";
import { VertexSnap } from "./VertexSnap.js";

describe("VertexSnap", () => {
  it("snaps to the nearest Space vertex within threshold", () => {
    const snap = new VertexSnap(0.5);
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    floor.spaces.push(space);

    const result = snap.getSnap({ x: 4.1, y: 4.1 }, { floor });
    expect(result).toEqual({ point: { x: 4, y: 4 }, type: "vertex" });
  });

  it("returns null when no vertex is within threshold", () => {
    const snap = new VertexSnap(0.1);
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    floor.spaces.push(space);

    expect(snap.getSnap({ x: 1, y: 1 }, { floor })).toBeNull();
  });

  it("ignores the excluded Space's own vertices", () => {
    const snap = new VertexSnap(0.5);
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    floor.spaces.push(space);

    expect(snap.getSnap({ x: 4.1, y: 4.1 }, { floor, excludeId: space.id })).toBeNull();
  });

  it("also snaps to Wall endpoints, since Wall is a first-class drawing primitive", () => {
    const snap = new VertexSnap(0.5);
    const floor = createFloor("1F", 1);
    const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
    floor.walls.push(wall);

    expect(snap.getSnap({ x: 4.1, y: 0.1 }, { floor })).toEqual({
      point: { x: 4, y: 0 },
      type: "vertex",
    });
    expect(snap.getSnap({ x: -0.1, y: 0.1 }, { floor })).toEqual({
      point: { x: 0, y: 0 },
      type: "vertex",
    });
  });

  it("ignores the excluded Wall's own endpoints", () => {
    const snap = new VertexSnap(0.5);
    const floor = createFloor("1F", 1);
    const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
    floor.walls.push(wall);

    expect(snap.getSnap({ x: 4.1, y: 0.1 }, { floor, excludeId: wall.id })).toBeNull();
  });

  it("picks whichever candidate (Space vertex or Wall endpoint) is closest", () => {
    const snap = new VertexSnap(1);
    const floor = createFloor("1F", 1);
    floor.spaces.push(
      createSpace(floor.id, [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ]),
    );
    floor.walls.push(createWall(floor.id, { x: 4.2, y: 4.2 }, { x: 10, y: 10 }));

    // (4,4) is a Space vertex 0.14 away; the Wall endpoint (4.2,4.2) is 0.28 away.
    expect(snap.getSnap({ x: 4.1, y: 4.1 }, { floor })).toEqual({
      point: { x: 4, y: 4 },
      type: "vertex",
    });
  });
});
