import { describe, expect, it } from "vitest";
import { EditorCamera } from "./EditorCamera.js";

describe("EditorCamera", () => {
  it("defaults to origin/zoom and reports it back via getState", () => {
    const camera = new EditorCamera();
    expect(camera.getState()).toEqual({ center: { x: 0, y: 0 }, zoom: 50 });
  });

  it("setState replaces center and zoom", () => {
    const camera = new EditorCamera();
    camera.setState({ center: { x: 10, y: -5 }, zoom: 100 });
    expect(camera.getState()).toEqual({ center: { x: 10, y: -5 }, zoom: 100 });
  });

  it("clamps zoom to the minimum via setState, matching zoomBy's own clamp", () => {
    const camera = new EditorCamera();
    camera.setState({ center: { x: 0, y: 0 }, zoom: 0.001 });
    expect(camera.getState().zoom).toBe(2);
  });

  it("clamps zoom to the maximum via setState, matching zoomBy's own clamp", () => {
    const camera = new EditorCamera();
    camera.setState({ center: { x: 0, y: 0 }, zoom: 1_000_000 });
    expect(camera.getState().zoom).toBe(2000);
  });

  it("zoomBy multiplies the zoom level and clamps to the minimum", () => {
    const camera = new EditorCamera();
    camera.zoomBy(0.0001);
    expect(camera.getState().zoom).toBe(2);
  });

  it("zoomBy multiplies the zoom level and clamps to the maximum", () => {
    const camera = new EditorCamera();
    camera.zoomBy(1_000_000);
    expect(camera.getState().zoom).toBe(2000);
  });

  it("zoomBy keeps the pivot's world point fixed on screen", () => {
    const camera = new EditorCamera();
    camera.setViewportSize({ width: 800, height: 600 });
    const pivot = { x: 500, y: 200 };
    const worldBefore = camera.screenToWorld(pivot);

    camera.zoomBy(2, pivot);

    const worldAfter = camera.screenToWorld(pivot);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
    expect(camera.getState().zoom).toBe(100);
  });

  it("zoomBy defaults to pivoting around the viewport center", () => {
    const camera = new EditorCamera();
    camera.setViewportSize({ width: 800, height: 600 });
    const centerWorldBefore = camera.screenToWorld({ x: 400, y: 300 });

    camera.zoomBy(4);

    const centerWorldAfter = camera.screenToWorld({ x: 400, y: 300 });
    expect(centerWorldAfter.x).toBeCloseTo(centerWorldBefore.x);
    expect(centerWorldAfter.y).toBeCloseTo(centerWorldBefore.y);
  });

  it("panByScreenDelta moves the world center opposite the drag direction", () => {
    const camera = new EditorCamera();
    camera.panByScreenDelta({ x: 50, y: 0 }); // drag content right by 50px (zoom 50 -> 1 world unit)
    expect(camera.getState().center.x).toBeCloseTo(-1);
    expect(camera.getState().center.y).toBeCloseTo(0);
  });

  it("round-trips world -> screen -> world through the viewport projection", () => {
    const camera = new EditorCamera();
    camera.setViewportSize({ width: 800, height: 600 });
    const world = { x: 3, y: -7 };
    const screen = camera.worldToScreen(world);
    const back = camera.screenToWorld(screen);
    expect(back.x).toBeCloseTo(world.x);
    expect(back.y).toBeCloseTo(world.y);
  });
});
