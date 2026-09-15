import { describe, expect, it } from "vitest";
import { createBuilding, createEmptyProject, createFloor, createPOI, createSpace } from "../factories.js";
import { findPOIInProject, findSpaceInProject } from "./findInProject.js";

describe("findSpaceInProject / findPOIInProject", () => {
  it("finds a space and its floor across the project", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    floor.spaces.push(space);
    building.floors.push(floor);
    project.buildings.push(building);

    expect(findSpaceInProject(project, space.id)).toEqual({ floor, space });
    expect(findSpaceInProject(project, "missing")).toBeNull();
  });

  it("finds a POI and its floor across the project", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    const poi = createPOI(floor.id, { x: 1, y: 1 }, "store", "Coffee");
    floor.pois.push(poi);
    building.floors.push(floor);
    project.buildings.push(building);

    expect(findPOIInProject(project, poi.id)).toEqual({ floor, poi });
    expect(findPOIInProject(project, "missing")).toBeNull();
  });
});
