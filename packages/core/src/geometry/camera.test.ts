import { describe, expect, it } from "vitest";
import { projectToScreen, projectToWorld, screenDeltaToWorldDelta, type CameraProjection } from "./camera.js";

const baseCamera: CameraProjection = {
  center: { x: 0, y: 0 },
  zoom: 50,
  rotation: 0,
  viewportWidth: 800,
  viewportHeight: 600,
};

describe("projectToScreen / projectToWorld", () => {
  it("maps world origin to the viewport center", () => {
    const screen = projectToScreen({ x: 0, y: 0 }, baseCamera);
    expect(screen).toEqual({ x: 400, y: 300 });
  });

  it("moves right in world (+x) to the right on screen, and up (+y) upward on screen", () => {
    const right = projectToScreen({ x: 1, y: 0 }, baseCamera);
    const up = projectToScreen({ x: 0, y: 1 }, baseCamera);
    expect(right.x).toBeGreaterThan(400);
    expect(right.y).toBeCloseTo(300);
    expect(up.y).toBeLessThan(300); // screen y grows downward, so "up" in world means smaller screen y
    expect(up.x).toBeCloseTo(400);
  });

  it("round-trips screen -> world -> screen", () => {
    const original = { x: 550, y: 120 };
    const world = projectToWorld(original, baseCamera);
    const back = projectToScreen(world, baseCamera);
    expect(back.x).toBeCloseTo(original.x);
    expect(back.y).toBeCloseTo(original.y);
  });

  it("respects camera center offset", () => {
    const camera = { ...baseCamera, center: { x: 10, y: 5 } };
    const screen = projectToScreen({ x: 10, y: 5 }, camera);
    expect(screen).toEqual({ x: 400, y: 300 });
  });

  it("rotates the world correctly for a 90-degree camera rotation", () => {
    const camera = { ...baseCamera, rotation: Math.PI / 2 };
    // World (1,0) (east) should appear rotated 90deg clockwise on screen -> pointing "up" on screen (smaller y)
    const screen = projectToScreen({ x: 1, y: 0 }, camera);
    expect(screen.x).toBeCloseTo(400);
    expect(screen.y).toBeLessThan(300);
  });
});

describe("screenDeltaToWorldDelta", () => {
  it("converts a rightward screen drag into a rightward world delta with no rotation", () => {
    const delta = screenDeltaToWorldDelta({ x: 50, y: 0 }, { zoom: 50, rotation: 0 });
    expect(delta.x).toBeCloseTo(1);
    expect(delta.y).toBeCloseTo(0);
  });

  it("converts a downward screen drag into a southward (negative y) world delta", () => {
    const delta = screenDeltaToWorldDelta({ x: 0, y: 50 }, { zoom: 50, rotation: 0 });
    expect(delta.y).toBeCloseTo(-1);
  });
});
