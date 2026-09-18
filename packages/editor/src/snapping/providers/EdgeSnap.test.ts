import { createFloor, createSpace, createWall } from "@indoor/core";
import { describe, expect, it } from "vitest";
import { EdgeSnap } from "./EdgeSnap.js";

describe("EdgeSnap", () => {
  it("snaps to the nearest point on a Space's boundary within threshold", () => {
    const snap = new EdgeSnap(0.5);
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    floor.spaces.push(space);

    const result = snap.getSnap({ x: 2, y: 0.2 }, { floor });
    expect(result).toEqual({ point: { x: 2, y: 0 }, type: "edge" });
  });

  it("returns null when no Space edge is within threshold", () => {
    const snap = new EdgeSnap(0.1);
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    floor.spaces.push(space);

    expect(snap.getSnap({ x: 2, y: 2 }, { floor })).toBeNull();
  });

  it("ignores the excluded Space", () => {
    const snap = new EdgeSnap(0.5);
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    floor.spaces.push(space);

    expect(snap.getSnap({ x: 2, y: 0.2 }, { floor, excludeId: space.id })).toBeNull();
  });

  it("also snaps to the nearest point on a Wall segment, since Wall is a first-class drawing primitive", () => {
    const snap = new EdgeSnap(0.5);
    const floor = createFloor("1F", 1);
    const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
    floor.walls.push(wall);

    const result = snap.getSnap({ x: 2, y: 0.2 }, { floor });
    expect(result).toEqual({ point: { x: 2, y: 0 }, type: "edge" });
  });

  it("ignores the excluded Wall", () => {
    const snap = new EdgeSnap(0.5);
    const floor = createFloor("1F", 1);
    const wall = createWall(floor.id, { x: 0, y: 0 }, { x: 4, y: 0 });
    floor.walls.push(wall);

    expect(snap.getSnap({ x: 2, y: 0.2 }, { floor, excludeId: wall.id })).toBeNull();
  });

  it("picks whichever candidate (Space edge or Wall segment) is closest", () => {
    const snap = new EdgeSnap(1);
    const floor = createFloor("1F", 1);
    floor.spaces.push(
      createSpace(floor.id, [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ]),
    );
    floor.walls.push(createWall(floor.id, { x: 0, y: 10 }, { x: 4, y: 10 }));

    // Closer to the Space's bottom edge (y=0) than to the far-away Wall (y=10).
    const result = snap.getSnap({ x: 2, y: 0.3 }, { floor });
    expect(result).toEqual({ point: { x: 2, y: 0 }, type: "edge" });
  });
});
