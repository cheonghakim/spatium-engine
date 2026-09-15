import { describe, expect, it } from "vitest";
import { createBuilding, createEmptyProject, createFloor } from "../factories.js";
import { createId } from "../id.js";
import type { Space } from "../types/space.js";
import { validateProject } from "./validateProject.js";

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: createId(),
    floorId: "floor-1",
    polygon: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ],
    type: "room",
    height: 3,
    properties: {},
    ...overrides,
  };
}

describe("validateProject", () => {
  it("flags an invalid polygon with fewer than 3 vertices", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    floor.spaces.push(makeSpace({ polygon: [{ x: 0, y: 0 }] }));
    building.floors.push(floor);
    project.buildings.push(building);

    const issues = validateProject(project);
    expect(issues.some((i) => i.type === "invalid-polygon")).toBe(true);
  });

  it("flags a self-intersecting polygon", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    floor.spaces.push(
      makeSpace({
        polygon: [
          { x: 0, y: 0 },
          { x: 4, y: 4 },
          { x: 4, y: 0 },
          { x: 0, y: 4 },
        ],
      }),
    );
    building.floors.push(floor);
    project.buildings.push(building);

    const issues = validateProject(project);
    expect(issues.some((i) => i.type === "self-intersecting-polygon")).toBe(true);
  });

  it("flags an entrance referencing a missing space", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    floor.entrances.push({
      id: createId(),
      floorId: floor.id,
      position: { x: 0, y: 0 },
      spaceA: "does-not-exist",
      type: "door",
    });
    building.floors.push(floor);
    project.buildings.push(building);

    const issues = validateProject(project);
    expect(issues.some((i) => i.type === "disconnected-entrance" && i.severity === "error")).toBe(
      true,
    );
  });

  it("flags a POI referencing a missing space", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    floor.pois.push({
      id: createId(),
      floorId: floor.id,
      position: { x: 0, y: 0 },
      spaceId: "does-not-exist",
      type: "custom",
      name: "Ghost POI",
    });
    building.floors.push(floor);
    project.buildings.push(building);

    const issues = validateProject(project);
    expect(issues.some((i) => i.type === "invalid-poi")).toBe(true);
  });

  it("flags a navigation edge referencing a missing node", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    floor.navigation.edges.push({
      id: createId(),
      from: "missing-a",
      to: "missing-b",
      type: "walk",
      distance: 1,
      accessible: true,
    });
    building.floors.push(floor);
    project.buildings.push(building);

    const issues = validateProject(project);
    expect(issues.some((i) => i.type === "broken-navigation-edge")).toBe(true);
  });

  it("flags a floor with no vertical connection in a multi-floor building", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor1 = createFloor("1F", 1);
    const floor2 = createFloor("2F", 2);
    building.floors.push(floor1, floor2);
    project.buildings.push(building);

    const issues = validateProject(project);
    expect(issues.filter((i) => i.type === "missing-floor-connection")).toHaveLength(2);
  });

  it("returns no issues for a valid, well-connected project", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    const space = makeSpace();
    floor.spaces.push(space);
    building.floors.push(floor);
    project.buildings.push(building);

    const issues = validateProject(project);
    expect(issues).toEqual([]);
  });
});
