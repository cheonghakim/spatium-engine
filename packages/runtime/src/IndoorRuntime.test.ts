import {
  createBuilding,
  createEmptyProject,
  createFloor,
  createPOI,
  createSpace,
} from "@indoor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndoorRuntime } from "./IndoorRuntime.js";

function makeProject() {
  const project = createEmptyProject("Test Mall");
  const building = createBuilding("B1");
  const floor = createFloor("1F", 1);
  const space = createSpace(floor.id, [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ]);
  const poi = createPOI(floor.id, { x: 2, y: 2 }, "store", "Coffee");
  floor.spaces.push(space);
  floor.pois.push(poi);
  building.floors.push(floor);
  project.buildings.push(building);
  return { project, floor, space, poi };
}

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe("IndoorRuntime", () => {
  it("load() resolves the first floor and emits map.loaded", async () => {
    const { project, floor } = makeProject();
    const runtime = new IndoorRuntime({ container });
    const handler = vi.fn();
    runtime.on("map.loaded", handler);

    await runtime.load(project);

    expect(handler).toHaveBeenCalledWith({ project });
    expect(runtime.getActiveFloor()?.id).toBe(floor.id);
  });

  it("loads the project passed in the constructor without an explicit load() call", async () => {
    const { project, floor } = makeProject();
    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve(); // let the fire-and-forget load() microtask settle
    expect(runtime.getActiveFloor()?.id).toBe(floor.id);
  });

  it("setFloor switches the active floor and emits floor.changed, no-ops for the same floor", async () => {
    const { project, floor } = makeProject();
    const building = project.buildings[0]!;
    const secondFloor = createFloor("2F", 2);
    building.floors.push(secondFloor);

    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();

    const handler = vi.fn();
    runtime.on("floor.changed", handler);

    runtime.setFloor(secondFloor.id);
    expect(handler).toHaveBeenCalledWith({ floorId: secondFloor.id });
    expect(runtime.getActiveFloor()?.id).toBe(secondFloor.id);

    handler.mockClear();
    runtime.setFloor(secondFloor.id);
    expect(handler).not.toHaveBeenCalled();

    void floor; // referenced for clarity of what "first floor" means above
  });

  it("setCameraState applies the camera and emits camera.changed", () => {
    const runtime = new IndoorRuntime({ container });
    const handler = vi.fn();
    runtime.on("camera.changed", handler);

    runtime.setCameraState({ center: { x: 3, y: 4 }, zoom: 80, rotation: 0.5 });

    expect(runtime.camera.getState()).toEqual({ center: { x: 3, y: 4 }, zoom: 80, rotation: 0.5 });
    expect(handler).toHaveBeenCalledWith({
      mode: "2d",
      state: { center: { x: 3, y: 4 }, zoom: 80, rotation: 0.5 },
    });
  });

  it("setInteractionOptions disables pan gestures", () => {
    const runtime = new IndoorRuntime({ container });
    runtime.setInteractionOptions({ pan: false });

    const canvas = container.querySelector("canvas")!;
    const before = runtime.camera.getState().center;

    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 0, clientY: 0 }));
    canvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 50, clientY: 0 }));

    expect(runtime.camera.getState().center).toEqual(before);
  });

  it("manages overlays", () => {
    const runtime = new IndoorRuntime({ container });
    runtime.addOverlay({ id: "m1", floorId: "1F", type: "marker", position: { x: 0, y: 0 } });
    expect(runtime.getOverlays()).toHaveLength(1);

    runtime.removeOverlay("m1");
    expect(runtime.getOverlays()).toHaveLength(0);
  });

  it("startRoute computes a path over the project's navigation graph and clearRoute resets it", async () => {
    const { project, floor } = makeProject();
    floor.navigation.nodes.push(
      { id: "a", floorId: floor.id, position: { x: 0, y: 0 }, type: "normal" },
      { id: "b", floorId: floor.id, position: { x: 3, y: 4 }, type: "normal" },
    );
    floor.navigation.edges.push({
      id: "e1",
      from: "a",
      to: "b",
      type: "walk",
      distance: 5,
      accessible: true,
    });

    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();

    const startedHandler = vi.fn();
    const finishedHandler = vi.fn();
    runtime.on("route.started", startedHandler);
    runtime.on("route.finished", finishedHandler);

    const result = runtime.startRoute("a", "b");
    expect(result?.distance).toBeCloseTo(5);
    expect(startedHandler).toHaveBeenCalledWith({ fromNodeId: "a", toNodeId: "b" });

    runtime.clearRoute();
    expect(finishedHandler).toHaveBeenCalled();
  });

  it("emits space.click and poi.click based on what was clicked", async () => {
    const { project, space, poi } = makeProject();
    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();

    const spaceHandler = vi.fn();
    const poiHandler = vi.fn();
    runtime.on("space.click", spaceHandler);
    runtime.on("poi.click", poiHandler);

    const canvas = container.querySelector("canvas")!;
    // POI sits at world (2,2); default camera centers world origin at viewport
    // center with zoom 50px/m, so world (2,2) -> screen (100, -100) relative
    // to center. With a zero-size jsdom viewport, center is (0,0), so world
    // (2,2) maps to screen (100, -100).
    canvas.dispatchEvent(new MouseEvent("click", { clientX: 100, clientY: -100 }));
    expect(poiHandler).toHaveBeenCalledWith({ poi });

    // A point inside the space but far from the POI (e.g. world (0.5, 0.5) -> screen (25, -25))
    canvas.dispatchEvent(new MouseEvent("click", { clientX: 25, clientY: -25 }));
    expect(spaceHandler).toHaveBeenCalledWith({ space });
  });

  it("setCameraMode('3d') degrades gracefully when Renderer3D construction fails (jsdom has no real WebGL, so `new THREE.WebGLRenderer(...)` throws there without any mocking)", () => {
    const runtime = new IndoorRuntime({ container });

    const unavailableHandler = vi.fn();
    const cameraChangedHandler = vi.fn();
    runtime.on("render3d.unavailable", unavailableHandler);
    runtime.on("camera.changed", cameraChangedHandler);

    expect(() => runtime.setCameraMode("3d")).not.toThrow();

    expect(unavailableHandler).toHaveBeenCalledTimes(1);
    const payload = unavailableHandler.mock.calls[0]?.[0];
    expect(typeof payload.message).toBe("string");
    expect(payload.message.length).toBeGreaterThan(0);

    // Nothing about the camera mode actually changed: no camera.changed was emitted, and the 2D
    // canvas (the only one that exists — Renderer3D's own canvas never got created) stays visible.
    expect(cameraChangedHandler).not.toHaveBeenCalled();
    const canvas = container.querySelector("canvas")!;
    expect(canvas.style.display).toBe("block");
    expect(container.querySelectorAll("canvas")).toHaveLength(1);

    // If cameraMode had incorrectly flipped to "3d" internally despite the construction failure,
    // this second call would see mode === this.cameraMode and bail out as a no-op, never
    // re-attempting Renderer3D construction — so a second render3d.unavailable proves the mode
    // genuinely stayed "2d".
    expect(() => runtime.setCameraMode("3d")).not.toThrow();
    expect(unavailableHandler).toHaveBeenCalledTimes(2);
  });

  it("destroy() removes the canvas from the container", () => {
    const runtime = new IndoorRuntime({ container });
    expect(container.querySelector("canvas")).not.toBeNull();
    runtime.destroy();
    expect(container.querySelector("canvas")).toBeNull();
  });
});
