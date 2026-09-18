import {
  createBuilding,
  createEmptyProject,
  createFloor,
  createNavigationEdge,
  createNavigationNode,
  createPOI,
  createSpace,
} from "@indoor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndoorBuilder } from "./IndoorBuilder.js";
import type { BuilderConfig } from "./BuilderConfig.js";

function makeProject() {
  const project = createEmptyProject("Test Mall");
  const building = createBuilding("B1");
  const floor = createFloor("1F", 1);
  const poi = createPOI(floor.id, { x: 5, y: 5 }, "store", "Coffee House");
  floor.pois.push(poi);
  floor.spaces.push(
    createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]),
  );
  building.floors.push(floor);
  project.buildings.push(building);
  return { project, building, floor, poi };
}

function baseConfig(overrides: Partial<BuilderConfig> = {}): BuilderConfig {
  return {
    camera: { mode: "2d", pan: true, zoom: true, rotate: true },
    controls: { floorSelector: true, cameraToggle: true },
    events: [],
    ...overrides,
  };
}

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

async function flushLoad(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function clickWorldPoint(builder: IndoorBuilder, worldPoint: { x: number; y: number }): void {
  const canvas = container.querySelector("canvas")!;
  const screen = builder.runtime.camera.worldToScreen(worldPoint);
  canvas.dispatchEvent(new MouseEvent("click", { clientX: screen.x, clientY: screen.y }));
}

describe("IndoorBuilder", () => {
  it("loads the project and applies the initial camera config", async () => {
    const { project } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        camera: {
          mode: "2d",
          pan: true,
          zoom: true,
          rotate: true,
          initialCenter: { x: 5, y: 5 },
          initialZoom: 80,
        },
      }),
    });

    await flushLoad();

    const state = builder.runtime.camera.getState();
    expect(state.center).toEqual({ x: 5, y: 5 });
    expect(state.zoom).toBe(80);
  });

  it("a poi.click rule with a type condition focuses the clicked POI implicitly", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [
          {
            event: "poi.click",
            conditions: [{ field: "poi.type", operator: "equals", value: "store" }],
            actions: [{ type: "poi.focus" }],
          },
        ],
      }),
    });
    await flushLoad();

    clickWorldPoint(builder, poi.position);

    expect(builder.runtime.camera.getState().center).toEqual(poi.position);
  });

  it("a condition that doesn't match skips the action", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [
          {
            event: "poi.click",
            conditions: [{ field: "poi.type", operator: "equals", value: "restroom" }],
            actions: [{ type: "poi.focus" }],
          },
        ],
      }),
    });
    await flushLoad();
    const before = builder.runtime.camera.getState().center;

    clickWorldPoint(builder, poi.position);

    expect(builder.runtime.camera.getState().center).toEqual(before);
  });

  it("route.start / route.clear actions triggered by floor.changed drive the runtime's route", async () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor1 = createFloor("1F", 1);
    const floor2 = createFloor("2F", 2);
    const nodeA = createNavigationNode(floor1.id, { x: 0, y: 0 });
    const nodeB = createNavigationNode(floor1.id, { x: 3, y: 4 });
    floor1.navigation.nodes.push(nodeA, nodeB);
    floor1.navigation.edges.push(createNavigationEdge(nodeA.id, nodeB.id, 5));
    building.floors.push(floor1, floor2);
    project.buildings.push(building);

    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [
          {
            event: "floor.changed",
            actions: [{ type: "route.start", fromNodeId: nodeA.id, toNodeId: nodeB.id }],
          },
        ],
      }),
    });
    await flushLoad();

    const startedHandler = vi.fn();
    builder.runtime.on("route.started", startedHandler);

    builder.runtime.setFloor(floor2.id);

    expect(startedHandler).toHaveBeenCalledWith({ fromNodeId: nodeA.id, toNodeId: nodeB.id });
  });

  it("marker.add and marker.remove actions manage runtime overlays", async () => {
    const { project, floor } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [
          {
            event: "map.loaded",
            actions: [{ type: "marker.add", markerId: "m1", floorId: floor.id, x: 1, y: 2 }],
          },
        ],
      }),
    });

    await flushLoad();

    expect(builder.runtime.getOverlays().some((o) => o.id === "m1")).toBe(true);
  });

  it("applies a theme from config without throwing and exposes it via getConfig", async () => {
    const { project } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({ theme: { background: "#101014", accentColor: "#00ffaa" } }),
    });

    await flushLoad();

    expect(builder.getConfig().theme).toEqual({ background: "#101014", accentColor: "#00ffaa" });
  });

  it("captureCurrentCameraAsInitial stores the live camera into the config", async () => {
    const { project } = makeProject();
    const builder = new IndoorBuilder({ container, project, config: baseConfig() });
    await flushLoad();

    builder.runtime.setCameraState({ center: { x: 7, y: 8 }, zoom: 90, rotation: 0 });
    builder.captureCurrentCameraAsInitial();

    expect(builder.getConfig().camera.initialCenter).toEqual({ x: 7, y: 8 });
    expect(builder.getConfig().camera.initialZoom).toBe(90);
  });

  it("emits a builder-level action event for host-owned actions like panel.open", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [{ event: "poi.click", actions: [{ type: "panel.open", panelId: "poi-detail" }] }],
      }),
    });
    await flushLoad();

    const actionHandler = vi.fn();
    builder.on("action", actionHandler);

    clickWorldPoint(builder, poi.position);

    expect(actionHandler).toHaveBeenCalledWith({
      action: { type: "panel.open", panelId: "poi-detail" },
      sourceEvent: "panel.open",
    });
  });

  it("camera.move action moves the camera to an explicit point", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [{ event: "poi.click", actions: [{ type: "camera.move", x: 3, y: 4, zoom: 50 }] }],
      }),
    });
    await flushLoad();

    clickWorldPoint(builder, poi.position);

    const state = builder.runtime.camera.getState();
    expect(state.center).toEqual({ x: 3, y: 4 });
    expect(state.zoom).toBe(50);
  });

  it('camera.setMode2d action calls the runtime\'s setCameraMode with "2d"', async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [{ event: "poi.click", actions: [{ type: "camera.setMode2d" }] }],
      }),
    });
    await flushLoad();
    const setCameraModeSpy = vi.spyOn(builder.runtime, "setCameraMode");

    clickWorldPoint(builder, poi.position);

    expect(setCameraModeSpy).toHaveBeenCalledWith("2d");
  });

  it('camera.setMode3d action calls the runtime\'s setCameraMode with "3d"', async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [{ event: "poi.click", actions: [{ type: "camera.setMode3d" }] }],
      }),
    });
    await flushLoad();
    const setCameraModeSpy = vi.spyOn(builder.runtime, "setCameraMode");

    clickWorldPoint(builder, poi.position);

    expect(setCameraModeSpy).toHaveBeenCalledWith("3d");
  });

  it("route.playAnimation action forwards the configured playback options to the runtime", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [
          {
            event: "poi.click",
            actions: [
              {
                type: "route.playAnimation",
                animationType: "flythrough",
                cameraMode: "third",
                curve: "smooth",
                durationSeconds: 4,
              },
            ],
          },
        ],
      }),
    });
    await flushLoad();
    const playSpy = vi.spyOn(builder.runtime, "playRouteAnimation");

    clickWorldPoint(builder, poi.position);

    expect(playSpy).toHaveBeenCalledWith({
      animationType: "flythrough",
      cameraMode: "third",
      curve: "smooth",
      durationSeconds: 4,
    });
  });

  it("route.stopAnimation action calls the runtime's stopRouteAnimation", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [{ event: "poi.click", actions: [{ type: "route.stopAnimation" }] }],
      }),
    });
    await flushLoad();
    const stopSpy = vi.spyOn(builder.runtime, "stopRouteAnimation");

    clickWorldPoint(builder, poi.position);

    expect(stopSpy).toHaveBeenCalled();
  });

  it("marker.remove action removes a previously added overlay", async () => {
    const { project, floor, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [
          {
            event: "map.loaded",
            actions: [{ type: "marker.add", markerId: "m1", floorId: floor.id, x: 1, y: 2 }],
          },
          { event: "poi.click", actions: [{ type: "marker.remove", markerId: "m1" }] },
        ],
      }),
    });
    await flushLoad();
    expect(builder.runtime.getOverlays().some((o) => o.id === "m1")).toBe(true);

    clickWorldPoint(builder, poi.position);

    expect(builder.runtime.getOverlays().some((o) => o.id === "m1")).toBe(false);
  });

  it("floor.change action switches the runtime's active floor", async () => {
    const { project, poi, building } = makeProject();
    const floor2 = createFloor("2F", 2);
    building.floors.push(floor2);
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [{ event: "poi.click", actions: [{ type: "floor.change", floorId: floor2.id }] }],
      }),
    });
    await flushLoad();

    clickWorldPoint(builder, poi.position);

    expect(builder.runtime.getActiveFloor()?.id).toBe(floor2.id);
  });

  it("emits a builder-level action event for url.open", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [
          { event: "poi.click", actions: [{ type: "url.open", url: "https://example.com" }] },
        ],
      }),
    });
    await flushLoad();
    const actionHandler = vi.fn();
    builder.on("action", actionHandler);

    clickWorldPoint(builder, poi.position);

    expect(actionHandler).toHaveBeenCalledWith({
      action: { type: "url.open", url: "https://example.com" },
      sourceEvent: "url.open",
    });
  });

  it("emits a builder-level action event for event.emit", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [
          {
            event: "poi.click",
            actions: [{ type: "event.emit", name: "custom", payload: { foo: "bar" } }],
          },
        ],
      }),
    });
    await flushLoad();
    const actionHandler = vi.fn();
    builder.on("action", actionHandler);

    clickWorldPoint(builder, poi.position);

    expect(actionHandler).toHaveBeenCalledWith({
      action: { type: "event.emit", name: "custom", payload: { foo: "bar" } },
      sourceEvent: "event.emit",
    });
  });

  it("space.highlight action calls the runtime's highlightSpace with the resolved space id", async () => {
    const { project, poi, floor } = makeProject();
    const spaceId = floor.spaces[0]!.id;
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [{ event: "poi.click", actions: [{ type: "space.highlight", spaceId }] }],
      }),
    });
    await flushLoad();
    const highlightSpy = vi.spyOn(builder.runtime, "highlightSpace");

    clickWorldPoint(builder, poi.position);

    expect(highlightSpy).toHaveBeenCalledWith(spaceId);
  });

  it("space.highlight action with no resolvable target clears the highlight", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [{ event: "poi.click", actions: [{ type: "space.highlight" }] }],
      }),
    });
    await flushLoad();
    const highlightSpy = vi.spyOn(builder.runtime, "highlightSpace");

    clickWorldPoint(builder, poi.position);

    expect(highlightSpy).toHaveBeenCalledWith(null);
  });

  it("emits a warning when space.highlight references a stale/unknown space id, and still clears the highlight", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [
          { event: "poi.click", actions: [{ type: "space.highlight", spaceId: "does-not-exist" }] },
        ],
      }),
    });
    await flushLoad();
    const warningHandler = vi.fn();
    builder.on("warning", warningHandler);
    const highlightSpy = vi.spyOn(builder.runtime, "highlightSpace");

    clickWorldPoint(builder, poi.position);

    expect(warningHandler).toHaveBeenCalledTimes(1);
    expect(warningHandler.mock.calls[0]![0]!.message).toContain("does-not-exist");
    expect(highlightSpy).toHaveBeenCalledWith(null);
  });

  it("emits a warning when poi.focus references a stale/unknown poi id, without throwing", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [{ event: "poi.click", actions: [{ type: "poi.focus", poiId: "does-not-exist" }] }],
      }),
    });
    await flushLoad();
    const warningHandler = vi.fn();
    builder.on("warning", warningHandler);

    clickWorldPoint(builder, poi.position);

    expect(warningHandler).toHaveBeenCalledTimes(1);
    expect(warningHandler.mock.calls[0]![0]!.message).toContain("does-not-exist");
  });

  it("emits a warning instead of throwing for an unrecognized action type", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [{ event: "poi.click", actions: [{ type: "totally.bogus" } as never] }],
      }),
    });
    await flushLoad();
    const warningHandler = vi.fn();
    builder.on("warning", warningHandler);

    expect(() => clickWorldPoint(builder, poi.position)).not.toThrow();

    expect(warningHandler).toHaveBeenCalledTimes(1);
    expect(warningHandler.mock.calls[0]![0]!.message).toContain("totally.bogus");
  });

  it("emits a warning instead of throwing for an unrecognized condition operator", async () => {
    const { project, poi } = makeProject();
    const builder = new IndoorBuilder({
      container,
      project,
      config: baseConfig({
        events: [
          {
            event: "poi.click",
            conditions: [{ field: "poi.type", operator: "startsWith" as never, value: "s" }],
            actions: [{ type: "poi.focus" }],
          },
        ],
      }),
    });
    await flushLoad();
    const warningHandler = vi.fn();
    builder.on("warning", warningHandler);

    expect(() => clickWorldPoint(builder, poi.position)).not.toThrow();

    expect(warningHandler).toHaveBeenCalledTimes(1);
    expect(warningHandler.mock.calls[0]![0]!.message).toContain("startsWith");
  });
});
