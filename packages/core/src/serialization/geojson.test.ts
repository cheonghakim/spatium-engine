import { describe, expect, it } from "vitest";
import { createBuilding, createEmptyProject, createEntrance, createFloor, createPOI, createSpace } from "../factories.js";
import { projectToGeoJSON } from "./geojson.js";

describe("projectToGeoJSON", () => {
  it("converts a space to a closed Polygon feature", () => {
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

    const geojson = projectToGeoJSON(project);
    const feature = geojson.features.find((f) => f.properties.kind === "space");

    expect(feature?.geometry.type).toBe("Polygon");
    if (feature?.geometry.type === "Polygon") {
      const ring = feature.geometry.coordinates[0];
      expect(ring?.[0]).toEqual(ring?.[ring.length - 1]); // closed ring
      expect(ring).toHaveLength(5);
    }
    expect(feature?.properties.floorId).toBe(floor.id);
  });

  it("converts entrances and POIs to Point features", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    floor.entrances.push(createEntrance(floor.id, { x: 1, y: 2 }, "door"));
    floor.pois.push(createPOI(floor.id, { x: 3, y: 4 }, "store", "Coffee"));
    building.floors.push(floor);
    project.buildings.push(building);

    const geojson = projectToGeoJSON(project);
    const entranceFeature = geojson.features.find((f) => f.properties.kind === "entrance");
    const poiFeature = geojson.features.find((f) => f.properties.kind === "poi");

    expect(entranceFeature?.geometry).toEqual({ type: "Point", coordinates: [1, 2] });
    expect(poiFeature?.geometry).toEqual({ type: "Point", coordinates: [3, 4] });
    expect(poiFeature?.properties.name).toBe("Coffee");
  });

  it("converts navigation edges to LineString features using their nodes' positions", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B1");
    const floor = createFloor("1F", 1);
    floor.navigation.nodes.push(
      { id: "a", floorId: floor.id, position: { x: 0, y: 0 }, type: "normal" },
      { id: "b", floorId: floor.id, position: { x: 5, y: 0 }, type: "normal" },
    );
    floor.navigation.edges.push({ id: "e1", from: "a", to: "b", type: "walk", distance: 5, accessible: true });
    building.floors.push(floor);
    project.buildings.push(building);

    const geojson = projectToGeoJSON(project);
    const edgeFeature = geojson.features.find((f) => f.properties.kind === "navigationEdge");

    expect(edgeFeature?.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [0, 0],
        [5, 0],
      ],
    });
  });

  it("returns an empty feature collection for an empty project", () => {
    const project = createEmptyProject("P");
    expect(projectToGeoJSON(project)).toEqual({ type: "FeatureCollection", features: [] });
  });
});
