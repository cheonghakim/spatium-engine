import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createEntrance, createSpace, createWall } from "@indoor/core";
import { buildArchitecture, resolveOpenings, stairSpaceGeometry, wallPanels } from "./architecture.js";

describe("architectural geometry", () => {
  it("retains the wall above doors and below windows", () => {
    const wall = createWall("f", { x: 0, y: 0 }, { x: 6, y: 0 });
    const door = { ...createEntrance("f", { x: 1, y: 0 }), width: 1, height: 2 };
    const window = { ...createEntrance("f", { x: 4, y: 0 }, "window"), width: 2, height: 1, sillHeight: 0.8 };
    const panels = wallPanels(6, 2.4, resolveOpenings([wall], [door, window]));
    const solid = (x: number, y: number) => panels.some(p => x > p.from && x < p.to && y > p.bottom && y < p.top);
    expect(solid(1, 1)).toBe(false);
    expect(solid(1, 2.2)).toBe(true);
    expect(solid(4, 0.4)).toBe(true);
    expect(solid(4, 1.3)).toBe(false);
    expect(solid(4, 2.2)).toBe(true);
    const volume = panels.reduce((sum, p) => sum + (p.to - p.from) * (p.top - p.bottom), 0);
    expect(volume).toBeCloseTo(6 * 2.4 - 1 * 2 - 2 * 1);
  });
  it("assigns a corner opening once and never cuts walls for stairs", () => {
    const a = createWall("f", { x: 0, y: 0 }, { x: 4, y: 0 });
    const b = createWall("f", { x: 0, y: 0 }, { x: 0, y: 4 });
    const door = createEntrance("f", { x: 0, y: 0 });
    const stair = createEntrance("f", { x: 2, y: 0 }, "stairs");
    expect(resolveOpenings([a, b], [door, stair])).toHaveLength(1);
    door.wallId = b.id;
    expect(resolveOpenings([a, b], [door])[0]?.wall.id).toBe(b.id);
    door.wallId = "deleted";
    expect(resolveOpenings([a, b], [door])).toHaveLength(0);
  });
  it("subtracts overlapping openings as a union, with no negative or duplicate panels", () => {
    const wall = createWall("f", { x: 0, y: 0 }, { x: 4, y: 0 });
    const a = { ...createEntrance("f", { x: 1.5, y: 0 }), width: 2, height: 2 };
    const b = { ...createEntrance("f", { x: 2, y: 0 }, "window"), width: 2, height: 1, sillHeight: 1 };
    const panels = wallPanels(4, 2.4, resolveOpenings([wall], [a, b]));
    expect(panels.every(p => p.to > p.from && p.top > p.bottom)).toBe(true);
    expect(panels.reduce((sum,p) => sum + (p.to-p.from)*(p.top-p.bottom),0)).toBeCloseTo(9.6 - 4.5);
  });
  it("builds stairs at their actual position, direction, rise, width and landing", () => {
    const stair = { ...createEntrance("f", { x: 10, y: 20 }, "stairs"), width: 1.5, depth: 4, height: 3, stepCount: 12, rotation: 90, landingDepth: 1 };
    const model = buildArchitecture([], [stair]);
    const bounds = new THREE.Box3().setFromObject(model.elements);
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(1.5);
    expect(size.y).toBeCloseTo(3);
    expect(size.z).toBeCloseTo(4);
    expect(model.elements.children[0]?.children).toHaveLength(13);
  });
  it("clips stair space steps to a rotated footprint", () => {
    const space = createSpace("f", [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 4 }, { x: 0, y: 4 }], "stairs");
    space.stairSteps = 10; space.stairDirection = 90;
    const geometries = stairSpaceGeometry(space);
    expect(geometries).toHaveLength(10);
    geometries.forEach((geometry, i) => {
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.max.y).toBeCloseTo(3 * (i + 1) / 10);
      expect(geometry.boundingBox!.min.x).toBeGreaterThanOrEqual(-0.0001);
      expect(geometry.boundingBox!.max.x).toBeLessThanOrEqual(2.0001);
      geometry.dispose();
    });
  });
  it("creates glass and door leaves, including legacy entrances with no dimensions", () => {
    const model = buildArchitecture([], [createEntrance("f", { x: 0, y: 0 }), createEntrance("f", { x: 3, y: 0 }, "window")]);
    let glass = 0, meshes = 0;
    model.elements.traverse(object => {
      if (object instanceof THREE.Mesh) { meshes++; if (object.material.transparent) glass++; }
    });
    expect(meshes).toBeGreaterThan(8);
    expect(glass).toBe(1);
  });
});
