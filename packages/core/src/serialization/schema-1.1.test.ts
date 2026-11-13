import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createBuilding,
  createConnector,
  createEmptyProject,
  createFloor,
  createNavigationEdge,
  createNavigationNode,
  createSite,
  createSpace,
  createPOI,
} from "../factories.js";
import type { IndoorProject } from "../types/project.js";
import { CURRENT_SCHEMA_VERSION } from "./schemaVersion.js";
import { deserializeProject, InvalidProjectDataError, serializeProject } from "./serialize.js";

const LEGACY_1_0_0 = readFileSync(
  new URL("./__fixtures__/project-1.0.0.json", import.meta.url),
  "utf8",
);

describe("schema 1.0.0 → 1.1.0", () => {
  it("is the current version", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe("1.1.0");
  });

  it("loads a 1.0.0 project with nothing changed but the version stamp", () => {
    const original = JSON.parse(LEGACY_1_0_0) as IndoorProject;
    const loaded = deserializeProject(LEGACY_1_0_0);

    expect(loaded.schemaVersion).toBe("1.1.0");
    // Same data, plus the arrays normalization always backfills.
    const expected = structuredClone(original);
    expected.schemaVersion = "1.1.0";
    for (const floor of expected.buildings[0]!.floors) {
      floor.furniture = [];
      floor.groups = [];
    }
    expect(loaded).toEqual(expected);
    // No 1.1.0-only structure is invented for legacy data.
    expect(loaded.site).toBeUndefined();
    expect(loaded.buildings[0]!.connectors).toBeUndefined();
    expect(loaded.buildings[0]!.placement).toBeUndefined();
  });
});

function fullProject(): IndoorProject {
  const project = createEmptyProject("Campus");
  const site = createSite("Campus", { longitude: 126.978, latitude: 37.5665 });
  site.names = { ko: "본캠퍼스", en: "Main Campus" };
  site.address = { address: "1 Sejong-daero", locality: "Seoul", country: "KR" };
  project.site = site;

  const building = createBuilding("Hall A");
  building.placement = { origin: { x: 120, y: -40 }, bearing: 17.5 };
  building.footprint = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 0, y: 20 },
  ];
  building.externalId = "BLDG-A";
  project.buildings.push(building);

  const f1 = createFloor("1F", 1, 0);
  const f2 = createFloor("2F", 2, 4.2);
  f1.names = { en: "Ground" };
  building.floors.push(f1, f2);

  const hall = createSpace(
    f1.id,
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    "lobby",
  );
  hall.holes = [
    [
      { x: 9, y: 9 },
      { x: 11, y: 9 },
      { x: 11, y: 11 },
      { x: 9, y: 11 },
    ],
  ];
  hall.properties = { name: "Lobby", names: { en: "Lobby" }, externalId: "R-101" };
  f1.spaces.push(hall);

  const poi = createPOI(f1.id, { x: 2, y: 2 }, "information", "Info");
  poi.names = { en: "Information" };
  poi.externalId = "POI-1";
  f1.pois.push(poi);

  const lift1 = createNavigationNode(f1.id, { x: 30, y: 10 }, "elevator");
  const lift2 = createNavigationNode(f2.id, { x: 30, y: 10 }, "elevator");
  f1.navigation.nodes.push(lift1);
  f2.navigation.nodes.push(lift2);
  const escalatorUp = createNavigationEdge(lift1.id, lift2.id, 6, "escalator", false);
  escalatorUp.oneWay = true;
  f1.navigation.edges.push(escalatorUp);

  const elevator = createConnector("elevator", [
    { floorId: f1.id, nodeId: lift1.id },
    { floorId: f2.id, nodeId: lift2.id },
  ]);
  elevator.name = "EV-1";
  elevator.spec = { speed: 2.5, averageWait: 25, boardingTime: 8, capacity: 15 };
  building.connectors = [elevator];

  const gate = createNavigationNode(site.id, { x: 0, y: 0 }, "entrance", "Main Gate");
  site.navigation.nodes.push(gate);
  site.navigation.edges.push(createNavigationEdge(gate.id, lift1.id, 150));
  return project;
}

/**
 * Raw parsed JSON, deliberately untyped so each case can corrupt any field —
 * that's the point of these tests. (JSON.parse's own return type.)
 */
type ProjectJson = ReturnType<typeof JSON.parse>;

describe("schema 1.1.0 fields", () => {
  it("round-trips every new field", () => {
    const project = fullProject();
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });

  function mutated(mutate: (data: ProjectJson) => void): string {
    const data = JSON.parse(serializeProject(fullProject()));
    mutate(data);
    return JSON.stringify(data);
  }

  it.each<[string, (data: ProjectJson) => void, RegExp]>([
    [
      "unknown connector type",
      (d) => (d.buildings[0].connectors[0].type = "lift"),
      /supported "type"/,
    ],
    [
      "connector without accessible",
      (d) => delete d.buildings[0].connectors[0].accessible,
      /boolean "accessible"/,
    ],
    [
      "stop without nodeId",
      (d) => delete d.buildings[0].connectors[0].stops[0].nodeId,
      /invalid stop at index 0/,
    ],
    ["zero elevator speed", (d) => (d.buildings[0].connectors[0].spec.speed = 0), /spec "speed"/],
    [
      "negative wait",
      (d) => (d.buildings[0].connectors[0].spec.averageWait = -1),
      /spec "averageWait"/,
    ],
    [
      "bad escalator direction",
      (d) => (d.buildings[0].connectors[0].direction = "sideways"),
      /"direction"/,
    ],
    ["latitude out of range", (d) => (d.site.geoAnchor.latitude = 91), /"latitude" in \[-90, 90\]/],
    ["non-string address field", (d) => (d.site.address.country = 82), /"address" fields/],
    ["site without navigation", (d) => delete d.site.navigation, /site must have a "navigation"/],
    ["placement without bearing", (d) => delete d.buildings[0].placement.bearing, /"placement"/],
    ["footprint with a bad vertex", (d) => (d.buildings[0].footprint[1] = { x: 1 }), /"footprint"/],
    ["holes not an array", (d) => (d.buildings[0].floors[0].spaces[0].holes = {}), /"holes" array/],
    [
      "hole with a bad vertex",
      (d) => d.buildings[0].floors[0].spaces[0].holes[0].push({ y: 2 }),
      /hole 0/,
    ],
    [
      "non-string localized name",
      (d) => (d.buildings[0].floors[0].pois[0].names.en = 5),
      /"names" object/,
    ],
    ["numeric externalId", (d) => (d.buildings[0].externalId = 7), /"externalId"/],
    [
      "non-boolean oneWay",
      (d) => (d.buildings[0].floors[0].navigation.edges[0].oneWay = "yes"),
      /"oneWay"/,
    ],
  ])("rejects %s", (_label, mutate, message) => {
    const json = mutated(mutate);
    expect(() => deserializeProject(json)).toThrow(InvalidProjectDataError);
    expect(() => deserializeProject(json)).toThrow(message);
  });

  it("accepts zero waiting and boarding time", () => {
    const json = mutated((d) => {
      d.buildings[0].connectors[0].spec.averageWait = 0;
      d.buildings[0].connectors[0].spec.boardingTime = 0;
    });
    expect(() => deserializeProject(json)).not.toThrow();
  });
});
