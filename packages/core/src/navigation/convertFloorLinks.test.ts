import { describe, expect, it } from "vitest";
import {
  createBuilding,
  createConnector,
  createEmptyProject,
  createEntrance,
  createFloor,
  createNavigationEdge,
  createNavigationNode,
  createPOI,
  createSpace,
  createWall,
} from "../factories.js";
import { buildingOutline, groundFloor } from "../query/buildings.js";
import { validateProject } from "../validation/validateProject.js";
import { planFloorLinkConversion } from "./convertFloorLinks.js";
import { resolveRouteEndpoint } from "./endpoints.js";
import { findShortestPath } from "./pathfinding.js";
import { buildRoutingGraph } from "./routingGraph.js";

function stairsTower() {
  const building = createBuilding("T");
  const floors = [createFloor("1F", 1, 0), createFloor("2F", 2, 4), createFloor("3F", 3, 8)];
  const nodes = floors.map((floor) => {
    const node = createNavigationNode(floor.id, { x: 0, y: 0 }, "stairs");
    floor.navigation.nodes.push(node);
    return node;
  });
  // A 1F–2F–3F stairs chain stored on mixed floors, as linkFloorNode did.
  floors[0]!.navigation.edges.push(createNavigationEdge(nodes[0]!.id, nodes[1]!.id, 4, "stairs"));
  floors[2]!.navigation.edges.push(createNavigationEdge(nodes[2]!.id, nodes[1]!.id, 4, "stairs"));
  building.floors.push(...floors);
  return { building, floors, nodes };
}

describe("planFloorLinkConversion", () => {
  it("groups a chain of cross-floor edges into one connector, lowest floor first", () => {
    const { building, floors, nodes } = stairsTower();
    const plan = planFloorLinkConversion(building);
    expect(plan.skipped).toEqual([]);
    expect(plan.conversions).toHaveLength(1);
    const [conversion] = plan.conversions;
    expect(conversion!.type).toBe("stairs");
    expect(conversion!.accessible).toBe(false);
    expect(conversion!.stops).toEqual(
      floors.map((floor, i) => ({ floorId: floor.id, nodeId: nodes[i]!.id })),
    );
    expect(conversion!.edges.map((e) => e.floorId)).toEqual([floors[0]!.id, floors[2]!.id]);
  });

  it("keeps different edge types apart and can target one node's group", () => {
    const { building, floors } = stairsTower();
    const a = createNavigationNode(floors[0]!.id, { x: 9, y: 0 }, "elevator");
    const b = createNavigationNode(floors[1]!.id, { x: 9, y: 0 }, "elevator");
    floors[0]!.navigation.nodes.push(a);
    floors[1]!.navigation.nodes.push(b);
    floors[0]!.navigation.edges.push(createNavigationEdge(a.id, b.id, 4, "elevator"));

    expect(
      planFloorLinkConversion(building)
        .conversions.map((c) => c.type)
        .sort(),
    ).toEqual(["elevator", "stairs"]);
    const only = planFloorLinkConversion(building, a.id).conversions;
    expect(only).toHaveLength(1);
    expect(only[0]!.accessible).toBe(true);
  });

  it("skips groups with two nodes on one floor", () => {
    const { building, floors, nodes } = stairsTower();
    const extra = createNavigationNode(floors[1]!.id, { x: 5, y: 0 }, "stairs");
    floors[1]!.navigation.nodes.push(extra);
    floors[0]!.navigation.edges.push(createNavigationEdge(nodes[0]!.id, extra.id, 4, "stairs"));
    const plan = planFloorLinkConversion(building);
    expect(plan.conversions).toEqual([]);
    expect(plan.skipped[0]!.reason).toBe("multiple-nodes-on-floor");
  });
});

describe("planFloorLinkConversion and one-way links", () => {
  function escalator(oneWay: Array<"up" | "down" | "both">) {
    const building = createBuilding("E");
    const floors = oneWay.map((_, i) => createFloor(`${i + 1}F`, i + 1, i * 4));
    floors.push(createFloor(`${oneWay.length + 1}F`, oneWay.length + 1, oneWay.length * 4));
    const nodes = floors.map((floor) => {
      const node = createNavigationNode(floor.id, { x: 0, y: 0 });
      floor.navigation.nodes.push(node);
      return node;
    });
    oneWay.forEach((dir, i) => {
      const [from, to] = dir === "down" ? [nodes[i + 1]!, nodes[i]!] : [nodes[i]!, nodes[i + 1]!];
      const edge = createNavigationEdge(from.id, to.id, 4, "escalator");
      if (dir !== "both") edge.oneWay = true;
      floors[i]!.navigation.edges.push(edge);
    });
    building.floors.push(...floors);
    return { building, nodes };
  }

  it("keeps a down-only escalator chain one-way", () => {
    const { building, nodes } = escalator(["down", "down"]);
    const [conversion] = planFloorLinkConversion(building).conversions;
    expect(conversion!.direction).toBe("down");

    // End to end: after conversion the connector still only runs downward.
    const project = createEmptyProject("P");
    project.buildings.push(building);
    for (const floor of building.floors) floor.navigation.edges = [];
    building.connectors = [
      Object.assign(createConnector("escalator", conversion!.stops), {
        direction: "down" as const,
      }),
    ];
    const graph = buildRoutingGraph(project);
    expect(findShortestPath(graph, nodes[2]!.id, nodes[0]!.id)).not.toBeNull();
    expect(findShortestPath(graph, nodes[0]!.id, nodes[2]!.id)).toBeNull();
  });

  it("skips mixed or non-escalator one-way groups instead of making them two-way", () => {
    expect(planFloorLinkConversion(escalator(["up", "down"]).building).skipped).toEqual([
      expect.objectContaining({ reason: "one-way-ambiguous" }),
    ]);
    expect(planFloorLinkConversion(escalator(["up", "both"]).building).conversions).toEqual([]);

    const { building, floors, nodes } = stairsTower();
    floors[0]!.navigation.edges[0]!.oneWay = true;
    expect(planFloorLinkConversion(building).skipped[0]!.reason).toBe("one-way-ambiguous");
    void nodes;
  });
});

describe("validateFloorLinkDuplicates", () => {
  it("warns when a hand-drawn link duplicates a connector", () => {
    const project = createEmptyProject("P");
    const { building, floors, nodes } = stairsTower();
    project.buildings.push(building);
    const types = () => validateProject(project).map((i) => i.type);
    expect(types()).not.toContain("duplicate-floor-link");

    building.connectors = [
      createConnector(
        "stairs",
        floors.map((floor, i) => ({ floorId: floor.id, nodeId: nodes[i]!.id })),
      ),
    ];
    expect(types().filter((t) => t === "duplicate-floor-link")).toHaveLength(2);
  });
});

describe("building helpers", () => {
  it("picks the ground floor and outlines a building", () => {
    const { building, floors } = stairsTower();
    expect(groundFloor(building)?.id).toBe(floors[0]!.id);
    expect(buildingOutline(building)).toEqual([]);
    floors[1]!.spaces.push(
      createSpace(floors[1]!.id, [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 2, y: 1 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ]),
    );
    expect(buildingOutline(building)).toHaveLength(4); // convex hull drops the notch
    building.footprint = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(buildingOutline(building)).toBe(building.footprint);
  });
});

describe("route endpoints avoid walls", () => {
  it("doesn't connect a POI to a node on the other side of a wall without a door", () => {
    const project = createEmptyProject("P");
    const building = createBuilding("B");
    const floor = createFloor("1F", 1);
    // One big open-plan space split by a wall at x=5 (no door).
    floor.spaces.push(
      createSpace(floor.id, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
        { x: 0, y: 4 },
      ]),
    );
    floor.walls.push(createWall(floor.id, { x: 5, y: 0 }, { x: 5, y: 4 }));
    const near = createNavigationNode(floor.id, { x: 6, y: 2 }); // across the wall
    const far = createNavigationNode(floor.id, { x: 1, y: 3 }); // same side
    floor.navigation.nodes.push(near, far);
    const poi = createPOI(floor.id, { x: 4, y: 2 }, "store", "Shop");
    floor.pois.push(poi);
    building.floors.push(floor);
    project.buildings.push(building);

    expect(resolveRouteEndpoint(project, { poiId: poi.id }).map((a) => a.nodeId)).toEqual([far.id]);

    // Walled in completely (a second wall west of the POI): no anchor at all,
    // so routing reports no route rather than walking through a wall.
    const westWall = createWall(floor.id, { x: 3, y: 0 }, { x: 3, y: 4 });
    floor.walls.push(westWall);
    expect(resolveRouteEndpoint(project, { poiId: poi.id })).toEqual([]);
    expect(resolveRouteEndpoint(project, { floorId: floor.id, position: { x: 4, y: 2 } })).toEqual(
      [],
    );
    floor.walls.splice(floor.walls.indexOf(westWall), 1);

    // A door in the wall makes the near node reachable again.
    floor.entrances.push(createEntrance(floor.id, { x: 5, y: 2 }, "door"));
    expect(resolveRouteEndpoint(project, { poiId: poi.id }).map((a) => a.nodeId)).toEqual([
      near.id,
      far.id,
    ]);
  });
});
