import { describe, expect, it } from "vitest";
import {
  createBuilding,
  createConnector,
  createEmptyProject,
  createEntrance,
  createFloor,
  createNavigationNode,
  createPOI,
  createSite,
  createSpace,
} from "../factories.js";
import type { Point } from "../types/common.js";
import { projectToIMDF, projectToIMDFArchive, stableUuid } from "./imdf.js";

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function campus() {
  const project = createEmptyProject("Campus");
  const site = createSite("Spatium Campus", { longitude: 127.0, latitude: 37.5 });
  site.address = { address: "1 Example-ro", locality: "Seoul", country: "KR" };
  project.site = site;
  const building = createBuilding("Main");
  building.placement = { origin: { x: 100, y: 0 }, bearing: 0 };
  const floors = [createFloor("1F", 1, 0), createFloor("2F", 2, 4)];
  const shafts = floors.map((floor) => {
    const hall = createSpace(floor.id, rect(0, 0, 20, 10), "lobby");
    hall.properties.name = `${floor.name} Hall`;
    hall.holes = [rect(8, 4, 9, 5)];
    const shaft = createSpace(floor.id, rect(20, 0, 22, 2), "elevator");
    floor.spaces.push(hall, shaft);
    const node = createNavigationNode(floor.id, { x: 21, y: 1 }, "elevator");
    floor.navigation.nodes.push(node);
    return { floor, shaft, node };
  });
  const door = createEntrance(floors[0]!.id, { x: 10, y: 0 }, "door");
  floors[0]!.entrances.push(door);
  const restroom = createPOI(floors[0]!.id, { x: 2, y: 2 }, "restroom", "화장실");
  restroom.names = { en: "Restroom" };
  floors[0]!.pois.push(restroom);
  building.floors.push(...floors);
  building.connectors = [
    createConnector(
      "elevator",
      shafts.map((s) => ({ floorId: s.floor.id, nodeId: s.node.id })),
    ),
  ];
  project.buildings.push(building);
  return { project, building, floors, restroom };
}

function parse(result: ReturnType<typeof projectToIMDF>, type: string) {
  const file = result.files.find((f) => f.path === `${type}.geojson`);
  return file ? JSON.parse(file.contents).features : [];
}

describe("projectToIMDF", () => {
  it("refuses to export without a geoAnchor", () => {
    const { project } = campus();
    delete project.site!.geoAnchor;
    const result = projectToIMDF(project);
    expect(result.files).toEqual([]);
    expect(result.issues.map((i) => i.code)).toEqual(["missing-geo-anchor"]);
  });

  it("writes manifest and one file per feature type", () => {
    const result = projectToIMDF(campus().project, { created: new Date("2026-01-01T00:00:00Z") });
    expect(result.files.map((f) => f.path)).toEqual([
      "manifest.json",
      "address.geojson",
      "venue.geojson",
      "building.geojson",
      "footprint.geojson",
      "level.geojson",
      "unit.geojson",
      "opening.geojson",
      "amenity.geojson",
      "relationship.geojson",
    ]);
    expect(JSON.parse(result.files[0]!.contents)).toEqual({
      version: "1.0.0",
      created: "2026-01-01T00:00:00.000Z",
      generated_by: "Spatium Engine",
      language: "ko",
    });
    // Footprint is approximated (no Building.footprint) and the store warning doesn't apply.
    expect(result.issues.map((i) => i.code)).toEqual(["approximated-footprint"]);
  });

  it("maps levels, units with holes, openings, amenities and connectors", () => {
    const { project, floors } = campus();
    const result = projectToIMDF(project);

    const levels = parse(result, "level");
    expect(levels.map((l: { properties: { ordinal: number } }) => l.properties.ordinal)).toEqual([
      0, 1,
    ]);

    const units = parse(result, "unit");
    const hall = units.find(
      (u: { properties: { category: string } }) => u.properties.category === "lobby",
    );
    expect(hall.geometry.coordinates).toHaveLength(2); // outer + hole
    expect(hall.properties.name).toEqual({ ko: "1F Hall" });
    // Placed 100 m east of the anchor → longitude slightly above 127.
    const [lng, lat] = hall.geometry.coordinates[0][0];
    expect(lng).toBeGreaterThan(127.001);
    expect(lat).toBeCloseTo(37.5, 3);

    const [opening] = parse(result, "opening");
    expect(opening.geometry.type).toBe("LineString");
    expect(opening.properties.door.type).toBe("swinging");

    const [amenity] = parse(result, "amenity");
    expect(amenity.properties.category).toBe("restroom");
    expect(amenity.properties.name).toEqual({ ko: "화장실", en: "Restroom" });
    expect(amenity.properties.unit_ids).toEqual([hall.id]);

    const [relationship] = parse(result, "relationship");
    expect(relationship.properties.category).toBe("elevator");
    expect(relationship.properties.origin.feature_type).toBe("unit");
    void floors;
  });

  it("uses stable UUIDs, so re-exports are identical", () => {
    const { project } = campus();
    const created = new Date(0);
    expect(projectToIMDF(project, { created })).toEqual(projectToIMDF(project, { created }));
    expect(stableUuid("unit:a")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(stableUuid("unit:a")).not.toBe(stableUuid("unit:b"));
  });

  it("reports what can't be mapped", () => {
    const { project, floors } = campus();
    delete project.site!.address;
    floors[0]!.pois.push(createPOI(floors[0]!.id, { x: 50, y: 50 }, "store", "Kiosk"));
    const codes = projectToIMDF(project).issues.map((i) => i.code);
    expect(codes).toContain("missing-address");
    expect(codes).toContain("amenity-without-unit");
    expect(codes).toContain("store-as-amenity");
  });
});

describe("projectToIMDFArchive", () => {
  it("produces a zip with every file", () => {
    const { archive } = projectToIMDFArchive(campus().project);
    expect(archive).not.toBeNull();
    const bytes = archive!;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(10);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("manifest.json");
    expect(text).toContain("unit.geojson");
  });
});
