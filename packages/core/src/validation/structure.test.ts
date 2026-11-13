import { describe, expect, it } from "vitest";
import {
  createBuilding,
  createConnector,
  createEmptyProject,
  createFloor,
  createNavigationEdge,
  createNavigationNode,
  createPOI,
  createSite,
} from "../factories.js";
import type { Floor, IndoorProject } from "../types/project.js";
import type { NavigationNode } from "../types/navigation.js";
import { validateProject } from "./validateProject.js";

/** Two floors, each with a connected pair of walk nodes; `lift` is the node a connector would use. */
function twoFloorProject(): {
  project: IndoorProject;
  floors: [Floor, Floor];
  lifts: [NavigationNode, NavigationNode];
} {
  const project = createEmptyProject("P");
  const building = createBuilding("B");
  project.buildings.push(building);
  const floors: [Floor, Floor] = [createFloor("1F", 1, 0), createFloor("2F", 2, 4)];
  building.floors.push(...floors);
  const lifts = floors.map((floor) => {
    const hall = createNavigationNode(floor.id, { x: 0, y: 0 });
    const lift = createNavigationNode(floor.id, { x: 10, y: 0 }, "elevator");
    floor.navigation.nodes.push(hall, lift);
    floor.navigation.edges.push(createNavigationEdge(hall.id, lift.id, 10));
    return lift;
  }) as [NavigationNode, NavigationNode];
  return { project, floors, lifts };
}

function types(project: IndoorProject): string[] {
  return validateProject(project).map((i) => i.type);
}

describe("connectors", () => {
  it("without a connector, floors are reported unconnected (baseline)", () => {
    const { project } = twoFloorProject();
    expect(types(project).filter((t) => t === "missing-floor-connection")).toHaveLength(2);
  });

  it("a connector links floors and its stop nodes without any hand-drawn vertical edge", () => {
    const { project, floors, lifts } = twoFloorProject();
    project.buildings[0]!.connectors = [
      createConnector("elevator", [
        { floorId: floors[0].id, nodeId: lifts[0].id },
        { floorId: floors[1].id, nodeId: lifts[1].id },
      ]),
    ];
    expect(validateProject(project)).toEqual([]);
  });

  it("ramps count as vertical connections too", () => {
    const { project, floors, lifts } = twoFloorProject();
    project.buildings[0]!.connectors = [
      createConnector("ramp", [
        { floorId: floors[0].id, nodeId: lifts[0].id },
        { floorId: floors[1].id, nodeId: lifts[1].id },
      ]),
    ];
    expect(types(project)).not.toContain("missing-floor-connection");
  });

  it("flags stops pointing at missing floors, nodes, and spaces", () => {
    const { project, floors, lifts } = twoFloorProject();
    project.buildings[0]!.connectors = [
      createConnector("elevator", [
        { floorId: floors[0].id, nodeId: lifts[0].id, spaceId: "no-such-space" },
        { floorId: floors[1].id, nodeId: "no-such-node" },
        { floorId: "no-such-floor", nodeId: lifts[1].id },
      ]),
    ];
    const issues = validateProject(project);
    expect(issues.find((i) => i.type === "connector-missing-space")?.severity).toBe("warning");
    expect(issues.find((i) => i.type === "connector-missing-node")?.severity).toBe("error");
    expect(issues.find((i) => i.type === "connector-missing-floor")?.severity).toBe("error");
    // Only stop 1 resolves, so the floors are still unconnected.
    expect(types(project)).toContain("missing-floor-connection");
  });

  it("warns about too few stops and a floor served twice", () => {
    const { project, floors, lifts } = twoFloorProject();
    project.buildings[0]!.connectors = [
      createConnector("stairs", [{ floorId: floors[0].id, nodeId: lifts[0].id }]),
      createConnector("stairs", [
        { floorId: floors[0].id, nodeId: lifts[0].id },
        { floorId: floors[0].id, nodeId: lifts[0].id },
      ]),
    ];
    expect(types(project)).toEqual(
      expect.arrayContaining(["connector-too-few-stops", "connector-duplicate-floor"]),
    );
  });

  it("defaults accessibility by type", () => {
    expect(createConnector("elevator").accessible).toBe(true);
    expect(createConnector("ramp").accessible).toBe(true);
    expect(createConnector("stairs").accessible).toBe(false);
    expect(createConnector("escalator").accessible).toBe(false);
  });
});

describe("site graph", () => {
  function withSite(): ReturnType<typeof twoFloorProject> & { gate: NavigationNode } {
    const fixture = twoFloorProject();
    const { project, floors, lifts } = fixture;
    project.buildings[0]!.connectors = [
      createConnector("elevator", [
        { floorId: floors[0].id, nodeId: lifts[0].id },
        { floorId: floors[1].id, nodeId: lifts[1].id },
      ]),
    ];
    const site = createSite("Campus");
    project.site = site;
    const gate = createNavigationNode(site.id, { x: -50, y: 0 }, "entrance");
    site.navigation.nodes.push(gate);
    return { ...fixture, gate };
  }

  it("a building node reached only by a site edge isn't reported disconnected", () => {
    const { project, floors, gate } = withSite();
    const door = createNavigationNode(floors[0].id, { x: -5, y: 0 }, "entrance");
    floors[0].navigation.nodes.push(door);
    project.site!.navigation.edges.push(createNavigationEdge(gate.id, door.id, 45));
    expect(validateProject(project)).toEqual([]);
  });

  it("flags site edges to missing nodes", () => {
    const { project, gate } = withSite();
    project.site!.navigation.edges.push(createNavigationEdge(gate.id, "nowhere", 10));
    expect(types(project)).toContain("broken-navigation-edge");
  });

  it("flags outdoor nodes that aren't on the site plane", () => {
    const { project, floors } = withSite();
    project.site!.navigation.nodes.push(createNavigationNode(floors[0].id, { x: 0, y: 0 }));
    expect(types(project)).toContain("site-node-wrong-plane");
  });
});

describe("externalId", () => {
  it("flags every object sharing an externalId, across object kinds", () => {
    const { project, floors } = twoFloorProject();
    const poi = createPOI(floors[0].id, { x: 1, y: 1 }, "store", "Shop");
    poi.externalId = "X-1";
    floors[0].pois.push(poi);
    floors[1].externalId = "X-1";
    project.buildings[0]!.externalId = "B-1";

    const dupes = validateProject(project).filter((i) => i.type === "duplicate-external-id");
    expect(dupes.map((i) => i.objectId).sort()).toEqual([floors[1].id, poi.id].sort());
  });

  it("ignores empty externalIds", () => {
    const { project, floors } = twoFloorProject();
    floors[0].externalId = "";
    floors[1].externalId = "";
    expect(types(project)).not.toContain("duplicate-external-id");
  });
});
