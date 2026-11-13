import { createFloor, createFurniture, createPOI, createSpace } from "@indoor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Renderer3D } from "./Renderer3D.js";

// jsdom has no real WebGL context, so `new THREE.WebGLRenderer(...)` throws there — mock just the
// renderer construct/render surface Renderer3D.ts actually calls, and keep everything else (scene
// graph, geometries, materials, OrbitControls — which only needs a real DOM element with
// addEventListener, which jsdom's canvas supports) as the genuine three.js implementation, since
// none of that needs a GPU context. vi.mock() is hoisted above these imports by Vitest, so
// Renderer3D.ts (which does `import * as THREE from "three"`) sees the mocked module.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class MockWebGLRenderer {
    domElement = document.createElement("canvas");
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
    setAnimationLoop() {}
  }
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

function makeFloorWithSpace() {
  const floor = createFloor("1F", 1);
  const space = createSpace(floor.id, [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ]);
  floor.spaces.push(space);
  const poi = createPOI(floor.id, { x: 2, y: 2 }, "store", "Coffee");
  floor.pois.push(poi);
  return { floor, space, poi };
}

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Renderer3D", () => {
  it("automatically frames the first furniture on an otherwise empty floor", () => {
    const renderer = new Renderer3D(container);
    const fit = vi.spyOn(renderer, "fitView");
    const floor = createFloor("1F", 1);
    renderer.update({ floor, overlays: [], routePoints: [] });
    expect(fit).not.toHaveBeenCalled();
    floor.furniture.push(createFurniture(floor.id, { x: 100, y: 100 }, "bed"));
    renderer.update({ floor, overlays: [], routePoints: [] });
    expect(fit).toHaveBeenCalledOnce();
    renderer.update({ floor, overlays: [], routePoints: [] });
    expect(fit).toHaveBeenCalledOnce();
    renderer.dispose();
  });
  it("dispose() tears down cleanly: no throw, animation frame cancelled, controls disposed", () => {
    const cafSpy = vi.spyOn(window, "cancelAnimationFrame");
    const controlsDisposeSpy = vi.spyOn(OrbitControls.prototype, "dispose");

    const renderer = new Renderer3D(container);
    expect(() => renderer.dispose()).not.toThrow();

    expect(cafSpy).toHaveBeenCalled();
    expect(controlsDisposeSpy).toHaveBeenCalled();
  });

  it("resize() guards against a zero width or height without NaN/Infinity aspect", () => {
    const renderer = new Renderer3D(container);

    expect(() => renderer.resize(0, 100)).not.toThrow();
    let aspect = renderer.getCameraAspectForTesting();
    expect(Number.isFinite(aspect)).toBe(true);
    expect(aspect).toBeGreaterThan(0);

    expect(() => renderer.resize(100, 0)).not.toThrow();
    aspect = renderer.getCameraAspectForTesting();
    expect(Number.isFinite(aspect)).toBe(true);
    expect(aspect).toBeGreaterThan(0);

    expect(() => renderer.resize(0, 0)).not.toThrow();
    aspect = renderer.getCameraAspectForTesting();
    expect(Number.isFinite(aspect)).toBe(true);
    expect(aspect).toBeGreaterThan(0);

    expect(() => renderer.fitView()).not.toThrow();
    renderer.dispose();
  });

  it("playRoute() no-ops for no legs or only single-point legs", () => {
    const renderer = new Renderer3D(container);

    renderer.playRoute([], {});
    expect(renderer.isRoutePlaying()).toBe(false);

    renderer.playRoute([{ points: [{ x: 0, y: 0 }] }], {});
    expect(renderer.isRoutePlaying()).toBe(false);

    renderer.dispose();
  });

  describe("route playback", () => {
    const legs = [
      {
        floorId: "f1",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
      {
        floorId: "f2",
        points: [
          { x: 10, y: 0 },
          { x: 10, y: 30 },
        ],
      },
    ];

    it("plays across floors, asking the host to show each leg's floor", () => {
      const onRouteLegChange = vi.fn();
      const renderer = new Renderer3D(container, { onRouteLegChange });

      renderer.playRoute(legs, { curve: "straight" });
      expect(onRouteLegChange).toHaveBeenLastCalledWith("f1", 0);
      expect(renderer.getRoutePlaybackState()).toMatchObject({
        progress: 0,
        totalDistance: 40,
        legIndex: 0,
        legCount: 2,
        floorId: "f1",
      });

      renderer.seekRoute(0.5); // 20 m: 10 m into the second leg
      expect(onRouteLegChange).toHaveBeenLastCalledWith("f2", 1);
      expect(renderer.getRoutePlaybackState()).toMatchObject({ distance: 20, floorId: "f2" });

      renderer.seekRoute(0.1);
      expect(onRouteLegChange).toHaveBeenLastCalledWith("f1", 0);
      renderer.dispose();
    });

    it("animates a floor change between legs reached by elevator", () => {
      const onRouteLegChange = vi.fn();
      const renderer = new Renderer3D(container, { onRouteLegChange });
      const withLift = [
        legs[0]!,
        {
          ...legs[1]!,
          arrival: { via: "elevator" as const, seconds: 24, direction: "up" as const },
        },
      ];
      renderer.playRoute(withLift, { curve: "straight", cameraMode: "third" });
      // 24 s ride → shown for 3 s (compressed) = 3.9 m of timeline between the 10 m and 30 m legs.
      const total = 10 + 3 * 1.3 + 30;
      const at = (metres: number) => renderer.seekRoute(metres / total);
      const marker = () =>
        (renderer as unknown as { routePlayback: { markerMesh: { position: { y: number } } } })
          .routePlayback.markerMesh.position.y;
      const opacity = () => renderer.getDomElement().style.opacity;

      at(10 + 3.9 * 0.25); // rising out of 1F
      let state = renderer.getRoutePlaybackState()!;
      expect(state.transition).toMatchObject({
        via: "elevator",
        direction: "up",
        fromFloorId: "f1",
        toFloorId: "f2",
      });
      expect(state.transition!.progress).toBeCloseTo(0.25);
      expect(state).toMatchObject({
        floorId: "f1",
        legIndex: 0,
        legCount: 2,
        distance: 10,
        totalDistance: 40,
      });
      const rising = marker();
      expect(rising).toBeGreaterThan(0.5);
      expect(Number(opacity())).toBeLessThan(1);

      at(10 + 3.9 * 0.75); // coming up into 2F from below
      state = renderer.getRoutePlaybackState()!;
      expect(state).toMatchObject({ floorId: "f2", legIndex: 1, distance: 10 });
      expect(onRouteLegChange).toHaveBeenLastCalledWith("f2", 1);
      expect(marker()).toBeLessThan(0);

      at(20); // walking on 2F again: no transition, no fade
      state = renderer.getRoutePlaybackState()!;
      expect(state.transition).toBeUndefined();
      expect(state.distance).toBeCloseTo(20 - 3.9);
      expect(opacity()).toBe("");

      renderer.stopRoute();
      expect(opacity()).toBe("");
      renderer.dispose();
    });

    it("pauses, resumes and changes speed; remaining time follows the speed", () => {
      const renderer = new Renderer3D(container);
      renderer.playRoute(legs, { curve: "straight", cameraMode: "overview" });

      const atWalk = renderer.getRoutePlaybackState()!;
      expect(atWalk.remainingSeconds).toBeCloseTo(40 / 1.3);
      renderer.setRoutePlaybackSpeed(2);
      expect(renderer.getRoutePlaybackState()!.remainingSeconds).toBeCloseTo(40 / 2.6);
      renderer.setRoutePlaybackSpeed(1000);
      expect(renderer.getRoutePlaybackState()!.speed).toBe(16);

      renderer.pauseRoute();
      expect(renderer.getRoutePlaybackState()!.paused).toBe(true);
      expect(renderer.isRoutePlaying()).toBe(true);
      renderer.resumeRoute();
      expect(renderer.getRoutePlaybackState()!.paused).toBe(false);
      renderer.dispose();
    });

    it("has no duration cap: a long route keeps walking pace", () => {
      const renderer = new Renderer3D(container);
      renderer.playRoute(
        [
          {
            points: [
              { x: 0, y: 0 },
              { x: 500, y: 0 },
            ],
          },
        ],
        {},
      );
      expect(renderer.getRoutePlaybackState()!.remainingSeconds).toBeCloseTo(500 / 1.3);
      renderer.dispose();
    });

    it("keeps relative progress when the route shape changes mid-playback", () => {
      const renderer = new Renderer3D(container);
      renderer.playRoute(legs, { curve: "straight" });
      renderer.seekRoute(0.5);
      renderer.setRouteShape("smooth");
      const state = renderer.getRoutePlaybackState()!;
      expect(state.progress).toBeCloseTo(0.5);
      expect(state.totalDistance).toBeLessThanOrEqual(40);
      expect(renderer.getRouteShape()).toBe("smooth");
      renderer.dispose();
    });

    it("hands the camera back where it was when a follow playback stops", () => {
      const renderer = new Renderer3D(container);
      const camera = (renderer as unknown as { camera: { position: { clone(): unknown } } }).camera;
      const before = camera.position.clone();
      renderer.playRoute(legs, { cameraMode: "third" });
      expect(camera.position).not.toEqual(before);
      renderer.stopRoute();
      expect(camera.position).toEqual(before);
      expect(renderer.getRoutePlaybackState()).toBeNull();
      renderer.dispose();
    });
  });

  it("update() with an undefined floor and empty overlays/route doesn't throw", () => {
    const renderer = new Renderer3D(container);

    expect(() =>
      renderer.update({ floor: undefined, overlays: [], routePoints: [] }),
    ).not.toThrow();

    renderer.dispose();
  });

  it("fitView() on an empty scene doesn't throw", () => {
    const renderer = new Renderer3D(container);
    expect(() => renderer.fitView()).not.toThrow();
    renderer.dispose();
  });

  it("setHighlightedSpace() doesn't throw before any update() and after update() with a real space", () => {
    const renderer = new Renderer3D(container);

    // No spaces loaded yet — findSpaceMesh() must come back empty-handed, not throw.
    expect(() => renderer.setHighlightedSpace("nonexistent")).not.toThrow();
    expect(() => renderer.setHighlightedSpace(null)).not.toThrow();

    const { floor, space } = makeFloorWithSpace();
    renderer.update({ floor, overlays: [], routePoints: [] });

    expect(() => renderer.setHighlightedSpace(space.id)).not.toThrow();
    expect(() => renderer.setHighlightedSpace("still-not-a-real-space")).not.toThrow();
    expect(() => renderer.setHighlightedSpace(null)).not.toThrow();

    renderer.dispose();
  });

  it("pauses the animation loop on webglcontextlost and resumes + rebuilds on webglcontextrestored", () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    let nextHandle = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return nextHandle++;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const runQueuedFrame = () => {
      const cb = rafCallbacks.shift();
      cb?.(0);
    };

    const onContextLost = vi.fn();
    const onContextRestored = vi.fn();
    const renderer = new Renderer3D(container, { onContextLost, onContextRestored });

    // The constructor's animate() call already rendered one frame and queued the next.
    expect(rafCallbacks.length).toBe(1);
    runQueuedFrame();
    expect(rafCallbacks.length).toBe(1); // still running normally, rescheduled itself

    const { floor, space } = makeFloorWithSpace();
    renderer.update({ floor, overlays: [], routePoints: [] });

    const meshBeforeLoss = renderer.getSpaceMeshForTesting(space.id);
    expect(meshBeforeLoss).not.toBeNull();

    const lostEvent = new Event("webglcontextlost", { cancelable: true });
    const preventDefaultSpy = vi.spyOn(lostEvent, "preventDefault");
    renderer.getDomElement().dispatchEvent(lostEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(onContextLost).toHaveBeenCalledTimes(1);

    // The frame that was already queued before context loss must not reschedule another one.
    runQueuedFrame();
    expect(rafCallbacks.length).toBe(0);

    renderer.getDomElement().dispatchEvent(new Event("webglcontextrestored"));

    expect(onContextRestored).toHaveBeenCalledTimes(1);
    // The loop resumed: it rendered immediately and queued its next frame.
    expect(rafCallbacks.length).toBe(1);

    // The scene content itself was rebuilt from lastState, not just left as-is: the space mesh
    // exists again under the same id, and as a genuinely fresh instance (proving rebuildSpaces()
    // ran) rather than the same object reference surviving untouched.
    const meshAfterRestore = renderer.getSpaceMeshForTesting(space.id);
    expect(meshAfterRestore).not.toBeNull();
    expect(meshAfterRestore).not.toBe(meshBeforeLoss);

    renderer.dispose();
  });
});
