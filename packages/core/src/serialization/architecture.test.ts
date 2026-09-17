import { describe, expect, it } from "vitest";
import { createBuilding, createEmptyProject, createEntrance, createFloor, createWall } from "../factories.js";
import { serializeProject, deserializeProject } from "./serialize.js";
import { projectToGeoJSON } from "./geojson.js";
import { validateEntrances } from "../validation/rules.js";

describe("architectural data compatibility", () => {
  it("preserves legacy entrances and new dimensions through JSON and GeoJSON export", () => {
    const project = createEmptyProject("Architecture"), building = createBuilding("A"), floor = createFloor("1F", 1);
    building.floors.push(floor); project.buildings.push(building);
    const wall = createWall(floor.id, {x:0,y:0}, {x:5,y:0}); floor.walls.push(wall);
    const legacy = createEntrance(floor.id, {x:1,y:0});
    const window = { ...createEntrance(floor.id, {x:3,y:0}, "window"), wallId:wall.id, width:1.2, height:1, sillHeight:0.8 };
    floor.entrances.push(legacy,window);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
    const feature = projectToGeoJSON(project).features.find(f => f.properties.id === window.id);
    expect(feature?.properties).toMatchObject({ entranceType:"window", wallId:wall.id, width:1.2, height:1, sillHeight:0.8 });
  });
  it("does not treat windows as disconnected walking entrances and reports invalid geometry", () => {
    const floor=createFloor("1F",1), window=createEntrance(floor.id,{x:0,y:0},"window");
    floor.entrances.push(window);
    expect(validateEntrances(floor)).toEqual([]);
    window.width=-1;window.wallId="missing";
    expect(validateEntrances(floor).map(i=>i.type)).toEqual(expect.arrayContaining(["invalid-element-dimension","missing-host-wall"]));
  });
});
