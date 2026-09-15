import { describe, expect, it } from "vitest";
import { RuntimeCamera } from "./RuntimeCamera.js";

function makeCamera(): RuntimeCamera {
  const camera = new RuntimeCamera();
  camera.setViewportSize({ width: 800, height: 600 });
  return camera;
}

describe("RuntimeCamera", () => {
  it("maps world origin to the viewport center by default", () => {
    const camera = makeCamera();
    expect(camera.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 400, y: 300 });
  });

  it("round-trips screen -> world -> screen", () => {
    const camera = makeCamera();
    const original = { x: 120, y: 450 };
    const back = camera.worldToScreen(camera.screenToWorld(original));
    expect(back.x).toBeCloseTo(original.x);
    expect(back.y).toBeCloseTo(original.y);
  });

  it("panByScreenDelta drags content with the cursor (like dragging a map)", () => {
    const camera = makeCamera();
    const before = camera.screenToWorld({ x: 400, y: 300 });
    camera.panByScreenDelta({ x: 50, y: 0 });
    const after = camera.screenToWorld({ x: 400, y: 300 });
    // Dragging right exposes content that was previously off-screen to the
    // left, i.e. the world point now at screen-center moved further west.
    expect(after.x).toBeLessThan(before.x);
  });

  it("zoomBy keeps the pivot point visually fixed", () => {
    const camera = makeCamera();
    const pivot = { x: 600, y: 200 };
    const worldAtPivotBefore = camera.screenToWorld(pivot);
    camera.zoomBy(2, pivot);
    const worldAtPivotAfter = camera.screenToWorld(pivot);
    expect(worldAtPivotAfter.x).toBeCloseTo(worldAtPivotBefore.x);
    expect(worldAtPivotAfter.y).toBeCloseTo(worldAtPivotBefore.y);
    expect(camera.getState().zoom).toBe(100); // default 50 * 2
  });

  it("rotateBy changes rotation while keeping the pivot fixed", () => {
    const camera = makeCamera();
    const pivot = { x: 400, y: 300 };
    const worldBefore = camera.screenToWorld(pivot);
    camera.rotateBy(Math.PI / 2, pivot);
    expect(camera.getState().rotation).toBeCloseTo(Math.PI / 2);
    const worldAfter = camera.screenToWorld(pivot);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });

  it("setState/getState round-trip", () => {
    const camera = makeCamera();
    camera.setState({ center: { x: 5, y: -3 }, zoom: 80, rotation: 1.2 });
    expect(camera.getState()).toEqual({ center: { x: 5, y: -3 }, zoom: 80, rotation: 1.2 });
  });
});
