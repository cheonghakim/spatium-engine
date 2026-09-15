import { createFloor, createSpace } from "@indoor/core";
import { describe, expect, it } from "vitest";
import { GridSnap } from "./providers/GridSnap.js";
import { VertexSnap } from "./providers/VertexSnap.js";
import { SnapManager } from "./SnapManager.js";

describe("SnapManager", () => {
  it("returns the raw point when no provider matches", () => {
    const manager = new SnapManager();
    manager.register(new GridSnap(1, 0.1));
    const floor = createFloor("1F", 1);

    const result = manager.resolve({ x: 1.5, y: 1.5 }, { floor });
    expect(result).toEqual({ x: 1.5, y: 1.5 });
  });

  it("snaps to the grid when within threshold", () => {
    const manager = new SnapManager();
    manager.register(new GridSnap(1, 0.2));
    const floor = createFloor("1F", 1);

    const result = manager.resolve({ x: 1.95, y: 3.05 }, { floor });
    expect(result).toEqual({ x: 2, y: 3 });
  });

  it("prefers whichever provider's result is closest to the input point", () => {
    const manager = new SnapManager();
    manager.register(new GridSnap(1, 0.5));
    manager.register(new VertexSnap(0.5));

    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    floor.spaces.push(space);

    // Closer to the vertex (4,4) than to the grid point (4,0)... pick a point
    // near (4.1, 3.9): grid snap -> (4,4) distance ~0.14, vertex snap -> (4,4) same point.
    // Use a point clearly closer to a non-grid-aligned vertex instead.
    const skewedSpace = createSpace(floor.id, [
      { x: 10, y: 10 },
      { x: 10.3, y: 10.3 },
      { x: 11, y: 10 },
    ]);
    floor.spaces.push(skewedSpace);

    const result = manager.resolve({ x: 10.32, y: 10.28 }, { floor });
    expect(result).toEqual({ x: 10.3, y: 10.3 });
  });

  it("does nothing when disabled", () => {
    const manager = new SnapManager();
    manager.register(new GridSnap(1, 1));
    manager.setEnabled(false);

    const floor = createFloor("1F", 1);
    const result = manager.resolve({ x: 1.5, y: 1.5 }, { floor });
    expect(result).toEqual({ x: 1.5, y: 1.5 });
  });
});
