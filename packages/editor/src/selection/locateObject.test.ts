import { describe, expect, it } from "vitest";
import { createBuilding, createEmptyProject, createEntrance, createFloor, createSpace } from "@indoor/core";
import { locateObject } from "./locateObject.js";

describe("locateObject", () => {
  it("locates a space by its centroid", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    floor.spaces.push(space);
    building.floors.push(floor);
    project.buildings.push(building);

    const location = locateObject(project, space.id);
    expect(location?.floorId).toBe(floor.id);
    expect(location?.position.x).toBeCloseTo(2);
    expect(location?.position.y).toBeCloseTo(2);
  });

  it("locates an entrance by its own position", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    const entrance = createEntrance(floor.id, { x: 3, y: 5 });
    floor.entrances.push(entrance);
    building.floors.push(floor);
    project.buildings.push(building);

    expect(locateObject(project, entrance.id)).toEqual({ floorId: floor.id, position: { x: 3, y: 5 } });
  });

  it("locates a navigation edge at the midpoint of its two nodes", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    floor.navigation.nodes.push(
      { id: "a", floorId: floor.id, position: { x: 0, y: 0 }, type: "normal" },
      { id: "b", floorId: floor.id, position: { x: 4, y: 0 }, type: "normal" },
    );
    floor.navigation.edges.push({ id: "e1", from: "a", to: "b", type: "walk", distance: 4, accessible: true });
    building.floors.push(floor);
    project.buildings.push(building);

    expect(locateObject(project, "e1")).toEqual({ floorId: floor.id, position: { x: 2, y: 0 } });
  });

  it("returns null for an unknown id", () => {
    const project = createEmptyProject("P");
    expect(locateObject(project, "does-not-exist")).toBeNull();
  });
});
