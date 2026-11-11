import {
  createBuilding,
  createConnector,
  createEmptyProject,
  createFloor,
  createNavigationEdge,
  createNavigationNode,
  createPOI,
  createSite,
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

  it("reports overlay types a renderer can only draw as a marker", () => {
    const runtime = new IndoorRuntime({ container });
    const fallback = vi.fn();
    runtime.on("overlay.fallback", fallback);
    runtime.addOverlay({ id: "m", floorId: "1F", type: "marker", position: { x: 0, y: 0 } });
    expect(fallback).not.toHaveBeenCalled();
    runtime.addOverlay({ id: "c", floorId: "1F", type: "circle", position: { x: 0, y: 0 } });
    expect(fallback).toHaveBeenLastCalledWith({
      overlayId: "c",
      type: "circle",
      renderers: ["3d"],
    });
    runtime.addOverlay({ id: "i", floorId: "1F", type: "image", position: { x: 0, y: 0 } });
    expect(fallback).toHaveBeenLastCalledWith({
      overlayId: "i",
      type: "image",
      renderers: ["2d", "3d"],
    });
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

  it("startRoute rides building connectors and reports travel time", async () => {
    const project = createEmptyProject("Tower");
    const building = createBuilding("T");
    const lower = createFloor("1F", 1, 0);
    const upper = createFloor("2F", 2, 6);
    building.floors.push(lower, upper);
    project.buildings.push(building);
    const a = createNavigationNode(lower.id, { x: 0, y: 0 }, "elevator");
    const b = createNavigationNode(upper.id, { x: 0, y: 0 }, "elevator");
    lower.navigation.nodes.push(a);
    upper.navigation.nodes.push(b);
    const lift = createConnector("elevator", [
      { floorId: lower.id, nodeId: a.id },
      { floorId: upper.id, nodeId: b.id },
    ]);
    lift.spec = { speed: 2, averageWait: 20, boardingTime: 5 };
    building.connectors = [lift];

    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    const route = runtime.startRoute(a.id, b.id);
    expect(route?.nodeIds).toEqual([a.id, b.id]);
    expect(route?.distance).toBe(6);
    expect(route?.cost).toBeCloseTo(20 + 5 + 6 / 2);
    // Call-site defaults don't override the connector's own spec.
    expect(
      runtime.startRoute(a.id, b.id, { connectorDefaults: { elevator: { averageWait: 0 } } })?.cost,
    ).toBeCloseTo(28);
  });

  it("splits a multi-floor route into per-floor playback legs in travel order", async () => {
    const project = createEmptyProject("Tower");
    const building = createBuilding("T");
    const lower = createFloor("1F", 1, 0);
    const upper = createFloor("2F", 2, 6);
    building.floors.push(lower, upper);
    project.buildings.push(building);
    const start = createNavigationNode(lower.id, { x: 10, y: 0 });
    const liftLow = createNavigationNode(lower.id, { x: 0, y: 0 }, "elevator");
    const liftHigh = createNavigationNode(upper.id, { x: 0, y: 0 }, "elevator");
    const goal = createNavigationNode(upper.id, { x: 0, y: 8 });
    lower.navigation.nodes.push(start, liftLow);
    upper.navigation.nodes.push(liftHigh, goal);
    lower.navigation.edges.push(createNavigationEdge(start.id, liftLow.id, 10));
    upper.navigation.edges.push(createNavigationEdge(liftHigh.id, goal.id, 8));
    building.connectors = [
      createConnector("elevator", [
        { floorId: lower.id, nodeId: liftLow.id },
        { floorId: upper.id, nodeId: liftHigh.id },
      ]),
    ];

    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    expect(runtime.startRoute(start.id, goal.id)).not.toBeNull();
    const legs = (runtime as unknown as { computeRouteLegs(): unknown }).computeRouteLegs();
    expect(legs).toEqual([
      {
        floorId: lower.id,
        points: [
          { x: 10, y: 0 },
          { x: 0, y: 0 },
        ],
      },
      {
        floorId: upper.id,
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 8 },
        ],
      },
    ]);
  });

  it("load() discards the cached routing graph", async () => {
    const { project, floor } = makeProject();
    const a = createNavigationNode(floor.id, { x: 0, y: 0 });
    const b = createNavigationNode(floor.id, { x: 10, y: 0 });
    floor.navigation.nodes.push(a, b);
    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    expect(runtime.startRoute(a.id, b.id)).toBeNull();

    // Same ids, now connected: a stale cache would still report no route.
    const connected = structuredClone(project);
    connected.buildings[0]!.floors[0]!.navigation.edges.push(createNavigationEdge(a.id, b.id, 10));
    await runtime.load(connected);
    expect(runtime.startRoute(a.id, b.id)?.distance).toBe(10);
  });

  it("routes to a POI found by search, through its space's door", async () => {
    const { project, floor, space, poi } = makeProject();
    // A corridor node outside the room and a door node on its wall (x=4).
    const hall = createNavigationNode(floor.id, { x: 10, y: 2 });
    const door = createNavigationNode(floor.id, { x: 4, y: 2 });
    floor.navigation.nodes.push(hall, door);
    floor.navigation.edges.push(createNavigationEdge(hall.id, door.id, 6));
    poi.spaceId = space.id;

    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    const [hit] = runtime.search("coff");
    expect(hit?.id).toBe(poi.id);

    const started = vi.fn();
    runtime.on("route.started", started);
    const route = runtime.startRoute(hall.id, { poiId: hit!.id });
    expect(route?.nodeIds).toEqual([hall.id, door.id]);
    expect(route?.distance).toBeCloseTo(6 + 2); // door (4,2) → POI (2,2)
    expect(started).toHaveBeenCalledWith({
      fromNodeId: hall.id,
      toNodeId: door.id,
      to: { poiId: poi.id },
    });
    expect(runtime.startRoute(hall.id, { poiId: "missing" })).toBeNull();
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

  it("setFloor ignores unknown floor ids", async () => {
    const { project, floor } = makeProject();
    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    const handler = vi.fn();
    runtime.on("floor.changed", handler);
    expect(runtime.setFloor("nope")).toBe(false);
    expect(runtime.getActiveFloor()?.id).toBe(floor.id);
    expect(handler).not.toHaveBeenCalled();
  });

  it("invalidate() picks up in-place edits to the loaded project", async () => {
    const { project, floor } = makeProject();
    const a = createNavigationNode(floor.id, { x: 0, y: 0 });
    const b = createNavigationNode(floor.id, { x: 10, y: 0 });
    floor.navigation.nodes.push(a, b);
    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    expect(runtime.startRoute(a.id, b.id)).toBeNull();
    floor.navigation.edges.push(createNavigationEdge(a.id, b.id, 10));
    expect(runtime.startRoute(a.id, b.id)).toBeNull(); // cached graph
    runtime.invalidate();
    expect(runtime.startRoute(a.id, b.id)?.distance).toBe(10);
  });

  it("invalidate() clears an active route whose edge was removed", async () => {
    const { project, floor } = makeProject();
    const a = createNavigationNode(floor.id, { x: 0, y: 0 });
    const b = createNavigationNode(floor.id, { x: 10, y: 0 });
    const edge = createNavigationEdge(a.id, b.id, 10);
    floor.navigation.nodes.push(a, b);
    floor.navigation.edges.push(edge);
    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    const route = runtime.startRoute(a.id, b.id);
    expect(route?.edgeIds).toEqual([edge.id]);

    const recomputed = vi.fn();
    const finished = vi.fn();
    runtime.on("route.recomputed", recomputed);
    runtime.on("route.finished", finished);
    floor.navigation.edges.length = 0;
    runtime.invalidate();

    expect(recomputed).toHaveBeenCalledWith({ route: null });
    expect(finished).toHaveBeenCalledTimes(1);
    // The held route is gone: a later clearRoute() has nothing to finish.
    runtime.clearRoute();
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("invalidate() recomputes an active route against the edited graph", async () => {
    const { project, floor } = makeProject();
    const a = createNavigationNode(floor.id, { x: 0, y: 0 });
    const m = createNavigationNode(floor.id, { x: 5, y: 5 });
    const b = createNavigationNode(floor.id, { x: 10, y: 0 });
    const direct = createNavigationEdge(a.id, b.id, 10);
    floor.navigation.nodes.push(a, m, b);
    floor.navigation.edges.push(
      direct,
      createNavigationEdge(a.id, m.id, 8),
      createNavigationEdge(m.id, b.id, 8),
    );
    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    expect(runtime.startRoute(a.id, b.id)?.nodeIds).toEqual([a.id, b.id]);

    const recomputed = vi.fn();
    runtime.on("route.recomputed", recomputed);
    floor.navigation.edges.splice(floor.navigation.edges.indexOf(direct), 1);
    runtime.invalidate();

    const route = recomputed.mock.calls[0]?.[0].route;
    expect(route?.nodeIds).toEqual([a.id, m.id, b.id]);
    expect(route?.distance).toBe(16);
  });

  it("does not recreate renderers or state after destroy()", async () => {
    const { project, floor } = makeProject();
    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    runtime.destroy();

    const unavailable = vi.fn();
    const cameraChanged = vi.fn();
    runtime.on("render3d.unavailable", unavailable);
    runtime.on("camera.changed", cameraChanged);
    runtime.setCameraMode("3d");
    runtime.playRouteAnimation();
    runtime.addOverlay({ id: "m", type: "marker", floorId: floor.id, position: { x: 1, y: 1 } });

    // Renderer3D was never even attempted (it would have appended a canvas or reported failure).
    expect(container.children.length).toBe(0);
    expect(unavailable).not.toHaveBeenCalled();
    expect(cameraChanged).not.toHaveBeenCalled();
    expect(runtime.getOverlays()).toHaveLength(0);
    expect(runtime.startRoute("x", "y")).toBeNull();
    expect(runtime.setFloor(floor.id)).toBe(false);
  });

  it("shows the site plane and plays an A→outdoor→B route as connected legs", async () => {
    const project = createEmptyProject("Campus");
    const site = createSite("Campus");
    project.site = site;
    const square = (floorId: string) =>
      createSpace(floorId, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]);
    const makeBuilding = (name: string, x: number) => {
      const building = createBuilding(name);
      building.placement = { origin: { x, y: 0 }, bearing: 0 };
      const floor = createFloor("1F", 1);
      floor.spaces.push(square(floor.id));
      const room = createNavigationNode(floor.id, { x: 5, y: 5 });
      const door = createNavigationNode(floor.id, { x: 5, y: 0 }, "entrance");
      floor.navigation.nodes.push(room, door);
      floor.navigation.edges.push(createNavigationEdge(room.id, door.id, 5));
      building.floors.push(floor);
      project.buildings.push(building);
      return { floor, room, door };
    };
    const a = makeBuilding("A", 0);
    const b = makeBuilding("B", 100);
    const gateA = createNavigationNode(site.id, { x: 5, y: -10 });
    const gateB = createNavigationNode(site.id, { x: 105, y: -10 });
    site.navigation.nodes.push(gateA, gateB);
    site.navigation.edges.push(
      createNavigationEdge(a.door.id, gateA.id, 10),
      createNavigationEdge(gateA.id, gateB.id, 100),
      createNavigationEdge(gateB.id, b.door.id, 10),
    );

    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    expect(runtime.getPlanes().map((p) => p.kind)).toEqual(["site", "floor", "floor"]);
    expect(runtime.setFloor(site.id)).toBe(true);
    expect(runtime.isSiteView()).toBe(true);
    expect(runtime.getActiveFloor()?.spaces).toHaveLength(2); // building outlines

    const route = runtime.startRoute(a.room.id, b.room.id);
    expect(route?.nodeIds).toEqual([
      a.room.id,
      a.door.id,
      gateA.id,
      gateB.id,
      b.door.id,
      b.room.id,
    ]);
    const legs = (
      runtime as unknown as {
        computeRouteLegs(): Array<{ floorId: string; points: Array<{ x: number; y: number }> }>;
      }
    ).computeRouteLegs();
    expect(legs.map((l) => l.floorId)).toEqual([a.floor.id, site.id, b.floor.id]);
    // The outdoor leg starts at A's door and ends at B's door, in site coordinates.
    expect(legs[1]!.points[0]).toEqual({ x: 5, y: 0 });
    expect(legs[1]!.points.at(-1)).toEqual({ x: 105, y: 0 });
  });

  it("focusPOI switches to the POI's floor and centers on it", async () => {
    const { project } = makeProject();
    const upper = createFloor("2F", 2, 4);
    const poi = createPOI(upper.id, { x: 7, y: 9 }, "store", "Tea");
    upper.pois.push(poi);
    project.buildings[0]!.floors.push(upper);
    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    expect(runtime.focusPOI(poi.id)).toBe(true);
    expect(runtime.getActiveFloor()?.id).toBe(upper.id);
    expect(runtime.camera.getState().center).toEqual(poi.position);
    expect(runtime.focusPOI("missing")).toBe(false);
  });

  it("tracks a visitor along the route: off-route once per excursion, arrival once", async () => {
    const { project, floor } = makeProject();
    const a = createNavigationNode(floor.id, { x: 0, y: 0 });
    const b = createNavigationNode(floor.id, { x: 40, y: 0 });
    floor.navigation.nodes.push(a, b);
    floor.navigation.edges.push(createNavigationEdge(a.id, b.id, 40));
    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    runtime.startRoute(a.id, b.id);

    const off = vi.fn();
    const arrived = vi.fn();
    runtime.on("route.offRoute", off);
    runtime.on("route.arrived", arrived);

    runtime.setUserLocation({ floorId: floor.id, position: { x: 10, y: 2 } });
    expect(off).not.toHaveBeenCalled();
    runtime.setUserLocation({ floorId: floor.id, position: { x: 10, y: 30 } });
    runtime.setUserLocation({ floorId: floor.id, position: { x: 12, y: 31 } });
    expect(off).toHaveBeenCalledTimes(1);
    expect(off.mock.calls[0]![0].distance).toBeCloseTo(30);
    // Accuracy widens the threshold: 25 m away with 20 m uncertainty isn't "off".
    runtime.setUserLocation({ floorId: floor.id, position: { x: 20, y: 1 } });
    runtime.setUserLocation({ floorId: floor.id, position: { x: 20, y: 25 }, accuracy: 20 });
    expect(off).toHaveBeenCalledTimes(1);
    runtime.setUserLocation({ floorId: floor.id, position: { x: 20, y: 30 } });
    expect(off).toHaveBeenCalledTimes(2);

    runtime.setUserLocation({ floorId: floor.id, position: { x: 38, y: 1 } });
    runtime.setUserLocation({ floorId: floor.id, position: { x: 39, y: 0 } });
    expect(arrived).toHaveBeenCalledTimes(1);
    // The position marker isn't one of the host's overlays.
    expect(runtime.getOverlays()).toHaveLength(0);
  });

  it("drives the position from an attached provider and stops it on destroy", async () => {
    const { project, floor } = makeProject();
    const runtime = new IndoorRuntime({ container, project });
    await Promise.resolve();
    let push: ((l: { floorId: string; position: { x: number; y: number } } | null) => void) | null =
      null;
    const provider = { start: vi.fn((cb) => (push = cb)), stop: vi.fn() };
    const changed = vi.fn();
    runtime.on("location.changed", changed);
    runtime.attachLocationProvider(provider);
    push!({ floorId: floor.id, position: { x: 1, y: 2 } });
    expect(runtime.getUserLocation()?.position).toEqual({ x: 1, y: 2 });
    expect(changed).toHaveBeenCalledTimes(1);
    runtime.destroy();
    expect(provider.stop).toHaveBeenCalledTimes(1);
    push!({ floorId: floor.id, position: { x: 3, y: 3 } });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("destroy() is idempotent and load() afterwards rejects", async () => {
    const { project } = makeProject();
    const runtime = new IndoorRuntime({ container });
    runtime.destroy();
    expect(() => runtime.destroy()).not.toThrow();
    expect(runtime.isDestroyed).toBe(true);
    await expect(runtime.load(project)).rejects.toThrow(/destroy/);
  });

  it("destroy() removes the canvas from the container", () => {
    const runtime = new IndoorRuntime({ container });
    expect(container.querySelector("canvas")).not.toBeNull();
    runtime.destroy();
    expect(container.querySelector("canvas")).toBeNull();
  });
});
