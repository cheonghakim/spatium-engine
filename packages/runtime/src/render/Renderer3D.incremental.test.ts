import { createFloor, createPOI, createSpace, type Floor, type Point } from "@indoor/core";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Overlay } from "../overlay.js";
import { Renderer3D, type Renderer3DState } from "./Renderer3D.js";

// Same WebGL-free mock as Renderer3D.test.ts: only the GPU-facing renderer is faked.
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

function square(x: number, y: number, size = 4): Point[] {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}

function makeFloor(name = "1F"): { floor: Floor; spaceId: string } {
  const floor = createFloor(name, 1);
  const space = createSpace(floor.id, square(0, 0));
  floor.spaces.push(space);
  floor.pois.push(createPOI(floor.id, { x: 2, y: 2 }, "store", "Coffee"));
  return { floor, spaceId: space.id };
}

function marker(id: string, floorId: string, position: Point): Overlay {
  return { id, floorId, type: "marker", position };
}

interface Internals {
  overlayGroup: THREE.Group;
  routeGroup: THREE.Group;
  camera: THREE.PerspectiveCamera;
  controls: { target: THREE.Vector3 };
}
const internals = (r: Renderer3D) => r as unknown as Internals;

let container: HTMLDivElement;
let renderer: Renderer3D;
beforeEach(() => {
  container = document.createElement("div");
  renderer = new Renderer3D(container);
});
afterEach(() => {
  renderer.dispose();
  vi.restoreAllMocks();
});

describe("Renderer3D incremental update()", () => {
  it("a repeat update() with the same data creates and disposes nothing", () => {
    const { floor, spaceId } = makeFloor();
    const state: Renderer3DState = {
      floor,
      overlays: [marker("m1", floor.id, { x: 1, y: 1 })],
      routePoints: [
        { x: 0, y: 0 },
        { x: 3, y: 3 },
      ],
    };
    renderer.update(state);
    const mesh = renderer.getSpaceMeshForTesting(spaceId);
    const overlayChild = internals(renderer).overlayGroup.children[0];
    const routeChild = internals(renderer).routeGroup.children[0];

    const dispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const created = vi.spyOn(THREE.MeshStandardMaterial.prototype, "setValues");
    // Same floor/overlays, plus a fresh-but-equal route array (hosts often rebuild it).
    renderer.update({ ...state, routePoints: state.routePoints.map((p) => ({ ...p! })) });
    renderer.update(state);

    expect(dispose).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
    expect(renderer.getSpaceMeshForTesting(spaceId)).toBe(mesh);
    expect(internals(renderer).overlayGroup.children[0]).toBe(overlayChild);
    expect(internals(renderer).routeGroup.children[0]).toBe(routeChild);
  });

  it("changing only overlays rebuilds overlays, not spaces", () => {
    const { floor, spaceId } = makeFloor();
    renderer.update({ floor, overlays: [], routePoints: [] });
    const mesh = renderer.getSpaceMeshForTesting(spaceId);
    expect(internals(renderer).overlayGroup.children).toHaveLength(0);

    const dispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    renderer.update({
      floor,
      overlays: [marker("m1", floor.id, { x: 1, y: 1 }), marker("m2", floor.id, { x: 2, y: 1 })],
      routePoints: [],
    });
    expect(internals(renderer).overlayGroup.children).toHaveLength(2);
    expect(renderer.getSpaceMeshForTesting(spaceId)).toBe(mesh);
    // Only the cone template used to clone overlay geometry is disposed.
    expect(dispose).toHaveBeenCalledTimes(1);

    // Moving an overlay in place is picked up too.
    const overlays = [marker("m1", floor.id, { x: 1, y: 1 })];
    renderer.update({ floor, overlays, routePoints: [] });
    overlays[0]!.position = { x: 9, y: 9 };
    renderer.update({ floor, overlays, routePoints: [] });
    expect(internals(renderer).overlayGroup.children[0]!.position.x).toBe(9);
    expect(renderer.getSpaceMeshForTesting(spaceId)).toBe(mesh);
  });

  it("redraws the route when its obstacles (walls / space holes) change", () => {
    const { floor, spaceId } = makeFloor();
    const state: Renderer3DState = {
      floor,
      overlays: [],
      routePoints: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
      ],
    };
    renderer.update(state);
    const route = internals(renderer).routeGroup.children[0];
    floor.walls.push({
      id: "w1",
      floorId: floor.id,
      start: { x: 2, y: 1 },
      end: { x: 2, y: 2 },
      thickness: 0.2,
    } as Floor["walls"][number]);
    renderer.update(state);
    const afterWall = internals(renderer).routeGroup.children[0];
    expect(afterWall).not.toBe(route);
    const mesh = renderer.getSpaceMeshForTesting(spaceId);

    floor.spaces[0]!.holes = [square(1, 1, 1)];
    renderer.update(state);
    expect(internals(renderer).routeGroup.children[0]).not.toBe(afterWall);
    expect(renderer.getSpaceMeshForTesting(spaceId)).not.toBe(mesh);
  });

  it("a theme accent change re-colours overlays on the next update()", () => {
    const { floor } = makeFloor();
    const state = { floor, overlays: [marker("m1", floor.id, { x: 1, y: 1 })], routePoints: [] };
    renderer.update(state);
    const before = internals(renderer).overlayGroup.children[0];
    renderer.setTheme({ accentColor: "#ff0000" });
    renderer.update(state);
    const after = internals(renderer).overlayGroup.children[0] as THREE.Mesh;
    expect(after).not.toBe(before);
    expect((after.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xff0000);
  });

  it("picks up in-place floor mutations", () => {
    const { floor, spaceId } = makeFloor();
    const state = { floor, overlays: [], routePoints: [] };
    renderer.update(state);
    const first = renderer.getSpaceMeshForTesting(spaceId);

    const added = createSpace(floor.id, square(10, 0));
    floor.spaces.push(added);
    renderer.update(state);
    expect(renderer.getSpaceMeshForTesting(added.id)).not.toBeNull();

    const beforeMove = renderer.getSpaceMeshForTesting(spaceId);
    expect(beforeMove).not.toBe(first);
    floor.spaces[0]!.polygon[2] = { x: 6, y: 6 };
    renderer.update(state);
    expect(renderer.getSpaceMeshForTesting(spaceId)).not.toBe(beforeMove);
  });

  it("rebuilds on a floor switch, including a structurally identical copy", () => {
    const a = makeFloor("1F");
    renderer.update({ floor: a.floor, overlays: [], routePoints: [] });
    const meshA = renderer.getSpaceMeshForTesting(a.spaceId);

    const b = makeFloor("2F");
    renderer.update({ floor: b.floor, overlays: [], routePoints: [] });
    expect(renderer.getSpaceMeshForTesting(a.spaceId)).toBeNull();
    expect(renderer.getSpaceMeshForTesting(b.spaceId)).not.toBeNull();

    // Equal content but new objects (e.g. undo/deserialize): click callbacks must get the new ones.
    const clone = structuredClone(a.floor);
    renderer.update({ floor: a.floor, overlays: [], routePoints: [] });
    const meshA2 = renderer.getSpaceMeshForTesting(a.spaceId);
    expect(meshA2).not.toBe(meshA);
    renderer.update({ floor: clone, overlays: [], routePoints: [] });
    expect(renderer.getSpaceMeshForTesting(a.spaceId)).not.toBe(meshA2);
  });

  it("context restore fully rebuilds every section, then repeat updates are skipped again", () => {
    const { floor, spaceId } = makeFloor();
    const state: Renderer3DState = {
      floor,
      overlays: [marker("m1", floor.id, { x: 1, y: 1 })],
      routePoints: [
        { x: 0, y: 0 },
        { x: 3, y: 3 },
      ],
    };
    renderer.update(state);
    const mesh = renderer.getSpaceMeshForTesting(spaceId);
    const overlay = internals(renderer).overlayGroup.children[0];
    const route = internals(renderer).routeGroup.children[0];

    renderer.getDomElement().dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    renderer.getDomElement().dispatchEvent(new Event("webglcontextrestored"));

    const restored = renderer.getSpaceMeshForTesting(spaceId);
    expect(restored).not.toBe(mesh);
    expect(internals(renderer).overlayGroup.children[0]).not.toBe(overlay);
    expect(internals(renderer).routeGroup.children[0]).not.toBe(route);

    renderer.update(state);
    expect(renderer.getSpaceMeshForTesting(spaceId)).toBe(restored);
  });

  it("re-resolves an explicit highlight only when spaces are rebuilt", () => {
    const { floor, spaceId } = makeFloor();
    const state = { floor, overlays: [], routePoints: [] };
    renderer.update(state);
    renderer.setHighlightedSpace(spaceId);
    renderer.update(state);
    const mesh = renderer.getSpaceMeshForTesting(spaceId) as THREE.Mesh;
    expect((mesh.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x333333);
    floor.spaces[0]!.polygon[0] = { x: -1, y: 0 };
    renderer.update(state);
    const rebuilt = renderer.getSpaceMeshForTesting(spaceId) as THREE.Mesh;
    expect(rebuilt).not.toBe(mesh);
    expect((rebuilt.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x333333);
  });
});

describe("Renderer3D.focusPoint()", () => {
  it("pans target and camera by the same delta, keeping the view offset", () => {
    const { camera, controls } = internals(renderer);
    const offset = camera.position.clone().sub(controls.target);
    renderer.focusPoint({ x: 12, y: 5 });
    expect(controls.target.x).toBeCloseTo(12);
    expect(controls.target.y).toBeCloseTo(0);
    expect(controls.target.z).toBeCloseTo(-5);
    const after = camera.position.clone().sub(controls.target);
    expect(after.distanceTo(offset)).toBeLessThan(1e-6);
  });

  it("is ignored while a follow-camera playback drives the view", () => {
    const { controls } = internals(renderer);
    renderer.playRoute(
      [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
        },
      ],
      { cameraMode: "third" },
    );
    const before = controls.target.clone();
    renderer.focusPoint({ x: 50, y: 50 });
    expect(controls.target.equals(before)).toBe(true);
  });
});
