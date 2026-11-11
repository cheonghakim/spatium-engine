import { describe, expect, it } from "vitest";
import {
  createBuilding,
  createEmptyProject,
  createFloor,
  createSite,
  createSpace,
} from "../factories.js";
import type { Point } from "../types/common.js";
import { projectToGeoJSON } from "../serialization/geojson.js";
import { validateSpaces } from "../validation/rules.js";
import {
  findHoleProblems,
  isPointInSpace,
  polygonArea,
  polygonsOverlap,
  spaceArea,
} from "./polygon.js";

const square = (x: number, y: number, size: number): Point[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

const hall = { polygon: square(0, 0, 10), holes: [square(4, 4, 2)] };

describe("holed spaces", () => {
  it("spaceArea subtracts holes", () => {
    expect(spaceArea(hall)).toBe(96);
    expect(spaceArea({ polygon: square(0, 0, 10) })).toBe(100);
  });

  it("isPointInSpace excludes points inside a hole", () => {
    expect(isPointInSpace(hall, { x: 1, y: 1 })).toBe(true);
    expect(isPointInSpace(hall, { x: 5, y: 5 })).toBe(false);
    expect(isPointInSpace(hall, { x: 11, y: 5 })).toBe(false);
  });

  it("a space sitting inside another's hole doesn't overlap it", () => {
    const kiosk = square(4.5, 4.5, 1);
    expect(polygonsOverlap(hall.polygon, kiosk)).toBe(true);
    expect(polygonsOverlap(hall.polygon, kiosk, hall.holes)).toBe(false);
    // Poking out of the hole still overlaps.
    expect(polygonsOverlap(hall.polygon, square(5, 5, 2), hall.holes)).toBe(true);
  });

  it("findHoleProblems reports bad holes", () => {
    expect(findHoleProblems(hall.polygon, hall.holes)).toEqual([]);
    expect(
      findHoleProblems(hall.polygon, [
        [{ x: 1, y: 1 }],
        square(8, 8, 4),
        [
          { x: 1, y: 1 },
          { x: 3, y: 3 },
          { x: 3, y: 1 },
          { x: 1, y: 3 },
        ],
        square(5, 5, 2),
        square(4, 4, 2),
      ]).map((p) => p.kind),
    ).toEqual(["too-few-vertices", "outside-outer", "self-intersecting", "holes-overlap"]);
  });

  it("validateSpaces flags invalid holes and honors holes when checking overlap", () => {
    const floor = createFloor("1F", 1);
    const atrium = createSpace(floor.id, square(0, 0, 10));
    atrium.holes = [square(4, 4, 2)];
    floor.spaces.push(atrium, createSpace(floor.id, square(4.5, 4.5, 1)));
    expect(validateSpaces(floor).filter((i) => i.type !== "unknown-space-type")).toEqual([]);

    atrium.holes = [square(9, 9, 3)];
    const types = validateSpaces(floor).map((i) => i.type);
    expect(types).toContain("invalid-hole");
    expect(types).toContain("overlapping-spaces");
  });
});

describe("projectToGeoJSON with holes and georeference", () => {
  function fixture() {
    const project = createEmptyProject("P");
    const building = createBuilding("B");
    const floor = createFloor("1F", 1);
    const space = createSpace(floor.id, [...square(0, 0, 10)].reverse()); // clockwise input
    space.holes = [square(4, 4, 2)]; // counter-clockwise input
    floor.spaces.push(space);
    building.floors.push(floor);
    project.buildings.push(building);
    return { project, building };
  }

  function rings(
    project: ReturnType<typeof fixture>["project"],
    mode?: "local" | "site" | "wgs84",
  ) {
    const feature = projectToGeoJSON(project, mode ? { coordinates: mode } : {}).features.find(
      (f) => f.properties.kind === "space",
    )!;
    if (feature.geometry.type !== "Polygon") throw new Error("expected polygon");
    return feature.geometry.coordinates;
  }

  const signedArea = (ring: [number, number][]) =>
    polygonArea(ring.slice(0, -1).map(([x, y]) => ({ x, y })));

  it("writes holes as interior rings, outer CCW and holes CW", () => {
    const [outer, hole] = rings(fixture().project);
    expect(outer).toHaveLength(5);
    expect(hole).toHaveLength(5);
    expect(signedArea(outer!)).toBeGreaterThan(0);
    expect(signedArea(hole!)).toBeLessThan(0);
  });

  it("applies the building placement in site mode", () => {
    const { project, building } = fixture();
    building.placement = { origin: { x: 100, y: 0 }, bearing: 0 };
    const [outer] = rings(project, "site");
    expect(outer!.every(([x]) => x >= 100 && x <= 110)).toBe(true);
    // local mode keeps stored coordinates.
    expect(rings(project, "local")[0]!.every(([x]) => x <= 10)).toBe(true);
  });

  it("defaults to WGS84 when the site has a geoAnchor, and refuses wgs84 without one", () => {
    const { project } = fixture();
    expect(() => projectToGeoJSON(project, { coordinates: "wgs84" })).toThrow(/geoAnchor/);
    project.site = createSite("Campus", { longitude: 127, latitude: 37.5 });
    const [outer] = rings(project);
    for (const [lng, lat] of outer!) {
      expect(lng).toBeCloseTo(127, 3);
      expect(lat).toBeCloseTo(37.5, 3);
    }
  });

  it("includes the site's outdoor graph", () => {
    const { project } = fixture();
    const site = createSite("Campus");
    site.navigation.nodes.push(
      { id: "g1", floorId: site.id, position: { x: 0, y: 0 }, type: "entrance" },
      { id: "g2", floorId: site.id, position: { x: 5, y: 0 }, type: "normal" },
    );
    site.navigation.edges.push({
      id: "ge",
      from: "g1",
      to: "g2",
      type: "walk",
      distance: 5,
      accessible: true,
    });
    project.site = site;
    const outdoor = projectToGeoJSON(project).features.filter((f) => f.properties.siteId);
    expect(outdoor.map((f) => f.properties.kind)).toEqual([
      "navigationNode",
      "navigationNode",
      "navigationEdge",
    ]);
  });
});
