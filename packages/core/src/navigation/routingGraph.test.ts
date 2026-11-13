import { describe, expect, it } from "vitest";
import {
  createBuilding,
  createConnector,
  createEmptyProject,
  createEntrance,
  createFloor,
  createNavigationEdge,
  createNavigationNode,
  createSite,
  createSpace,
} from "../factories.js";
import type { Connector } from "../types/connector.js";
import type { NavigationNode } from "../types/navigation.js";
import type { Building, Floor, IndoorProject } from "../types/project.js";
import { findShortestPath, prepareRoutingGraph, type RoutingGraph } from "./pathfinding.js";
import {
  buildRoutingGraph,
  connectorRoutingEdges,
  DEFAULT_STOREY_HEIGHT,
  floorRoutingEdges,
  resolveConnectorTiming,
  siteRoutingEdges,
} from "./routingGraph.js";

/**
 * A tower with `count` floors (elevation = index × 4 m). Each floor has a
 * lobby node at x=0, an elevator node at x=10 and a stair node at x=20, the
 * lobby linked to both by a 10 m walk.
 */
function tower(count: number): {
  project: IndoorProject;
  building: Building;
  floors: Floor[];
  lobby: NavigationNode[];
  lift: NavigationNode[];
  stair: NavigationNode[];
} {
  const project = createEmptyProject("Tower");
  const building = createBuilding("T");
  project.buildings.push(building);
  const floors: Floor[] = [];
  const lobby: NavigationNode[] = [];
  const lift: NavigationNode[] = [];
  const stair: NavigationNode[] = [];
  for (let i = 0; i < count; i++) {
    const floor = createFloor(`${i + 1}F`, i + 1, i * 4);
    const l = createNavigationNode(floor.id, { x: 0, y: 0 });
    const e = createNavigationNode(floor.id, { x: 10, y: 0 }, "elevator");
    const s = createNavigationNode(floor.id, { x: -10, y: 0 }, "stairs");
    floor.navigation.nodes.push(l, e, s);
    floor.navigation.edges.push(createNavigationEdge(l.id, e.id, 10));
    floor.navigation.edges.push(createNavigationEdge(l.id, s.id, 10));
    floors.push(floor);
    lobby.push(l);
    lift.push(e);
    stair.push(s);
  }
  building.floors.push(...floors);
  return { project, building, floors, lobby, lift, stair };
}

function stopsOf(floors: Floor[], nodes: NavigationNode[]): Connector["stops"] {
  return floors.map((floor, i) => ({ floorId: floor.id, nodeId: nodes[i]!.id }));
}

describe("connectorRoutingEdges", () => {
  it("links every pair of elevator stops, so a ride pays the wait once", () => {
    const { building, floors, lift } = tower(3);
    building.connectors = [createConnector("elevator", stopsOf(floors, lift))];
    const edges = connectorRoutingEdges(building);
    expect(edges).toHaveLength(3); // 1-2, 1-3, 2-3

    const ground = lift[0]!.id;
    const top = lift[2]!.id;
    const direct = edges.find((e) => e.from === ground && e.to === top)!;
    // Default timing: 30 s wait + 10 s boarding + 8 m / 1.5 m/s.
    expect(direct.duration).toBeCloseTo(30 + 10 + 8 / 1.5);
    expect(direct.distance).toBe(8);
    expect(direct.type).toBe("elevator");
    expect(direct.oneWay).toBeUndefined();
  });

  it("links only consecutive stairs stops, ordered by elevation regardless of list order", () => {
    const { building, floors, stair } = tower(3);
    building.connectors = [createConnector("stairs", stopsOf(floors, stair).reverse())];
    const edges = connectorRoutingEdges(building);
    expect(edges.map((e) => [e.from, e.to])).toEqual([
      [stair[0]!.id, stair[1]!.id],
      [stair[1]!.id, stair[2]!.id],
    ]);
    // 4 m climb at 0.4 m/s; nodes are stacked so there is no horizontal walk.
    expect(edges[0]!.duration).toBeCloseTo(10);
    expect(edges[0]!.accessible).toBe(false);
  });

  it("makes directional escalators one-way, in the travel direction", () => {
    const { building, floors, stair } = tower(2);
    const up = createConnector("escalator", stopsOf(floors, stair));
    up.direction = "up";
    const down = createConnector("escalator", stopsOf(floors, stair));
    down.direction = "down";
    building.connectors = [up, down];
    const [upEdge, downEdge] = connectorRoutingEdges(building);
    expect([upEdge!.from, upEdge!.to, upEdge!.oneWay]).toEqual([stair[0]!.id, stair[1]!.id, true]);
    expect([downEdge!.from, downEdge!.to, downEdge!.oneWay]).toEqual([
      stair[1]!.id,
      stair[0]!.id,
      true,
    ]);
  });

  it("falls back to level × storey height when floors share an elevation", () => {
    const { building, floors, lift } = tower(2);
    for (const floor of floors) floor.elevation = 0;
    building.connectors = [createConnector("elevator", stopsOf(floors, lift))];
    expect(connectorRoutingEdges(building)[0]!.distance).toBe(DEFAULT_STOREY_HEIGHT);
  });

  it("skips stops whose floor or node is missing, and repeated floors", () => {
    const { building, floors, lift } = tower(2);
    building.connectors = [
      createConnector("elevator", [
        ...stopsOf(floors, lift),
        { floorId: floors[0]!.id, nodeId: lift[0]!.id },
        { floorId: "gone", nodeId: lift[1]!.id },
        { floorId: floors[1]!.id, nodeId: "gone" },
      ]),
    ];
    expect(connectorRoutingEdges(building)).toHaveLength(1);
  });
});

describe("resolveConnectorTiming", () => {
  it("prefers the connector's own spec, then call-site defaults, then built-ins", () => {
    const lift = createConnector("elevator");
    lift.spec = { speed: 4 };
    expect(
      resolveConnectorTiming(lift, {
        connectorDefaults: { elevator: { speed: 2, averageWait: 5 } },
      }),
    ).toEqual({ speed: 4, averageWait: 5, boardingTime: 10 });
  });

  it("ignores invalid values instead of producing NaN or zero-speed costs", () => {
    const lift = createConnector("elevator");
    lift.spec = { speed: 0, averageWait: -3 };
    expect(resolveConnectorTiming(lift)).toEqual({ speed: 1.5, averageWait: 30, boardingTime: 10 });
  });

  it("uses the walking speed for ramps without a spec", () => {
    expect(resolveConnectorTiming(createConnector("ramp"), { walkingSpeed: 0.8 }).speed).toBe(0.8);
  });
});

describe("routing with connectors", () => {
  function towerWithBoth(count: number): ReturnType<typeof tower> {
    const fixture = tower(count);
    fixture.building.connectors = [
      createConnector("elevator", stopsOf(fixture.floors, fixture.lift)),
      createConnector("stairs", stopsOf(fixture.floors, fixture.stair)),
    ];
    return fixture;
  }

  it("takes the stairs for one floor and the elevator for nine", () => {
    const { project, lobby, lift, stair } = towerWithBoth(10);
    const graph = buildRoutingGraph(project);

    const oneUp = findShortestPath(graph, lobby[0]!.id, lobby[1]!.id)!;
    expect(oneUp.nodeIds).toContain(stair[0]!.id);
    expect(oneUp.cost).toBeCloseTo(10 / 1.2 + 10 + 10 / 1.2);

    const nineUp = findShortestPath(graph, lobby[0]!.id, lobby[9]!.id)!;
    expect(nineUp.nodeIds).toEqual([lobby[0]!.id, lift[0]!.id, lift[9]!.id, lobby[9]!.id]);
    expect(nineUp.cost).toBeCloseTo(20 / 1.2 + 30 + 10 + 36 / 1.5);
    expect(nineUp.distance).toBeCloseTo(20 + 36);
  });

  it("a faster elevator spec changes the decision", () => {
    const { project, building, lobby, lift } = towerWithBoth(3);
    building.connectors![0]!.spec = { averageWait: 0, boardingTime: 0, speed: 8 };
    const route = findShortestPath(buildRoutingGraph(project), lobby[0]!.id, lobby[1]!.id)!;
    expect(route.nodeIds).toContain(lift[0]!.id);
  });

  it("requireAccessible routes around the stairs connector", () => {
    const { project, lobby, lift } = towerWithBoth(2);
    const route = findShortestPath(buildRoutingGraph(project), lobby[0]!.id, lobby[1]!.id, {
      requireAccessible: true,
    })!;
    expect(route.nodeIds).toContain(lift[0]!.id);
  });

  it("respects a one-way escalator", () => {
    const { project, building, floors, lobby, stair } = tower(2);
    const escalator = createConnector("escalator", stopsOf(floors, stair));
    escalator.direction = "up";
    building.connectors = [escalator];
    const graph = buildRoutingGraph(project);
    expect(findShortestPath(graph, lobby[0]!.id, lobby[1]!.id)).not.toBeNull();
    expect(findShortestPath(graph, lobby[1]!.id, lobby[0]!.id)).toBeNull();
  });

  it("routes from the site's outdoor graph into a building and up a floor", () => {
    const { project, lobby } = towerWithBoth(2);
    const site = createSite("Campus");
    project.site = site;
    const gate = createNavigationNode(site.id, { x: -100, y: 0 }, "entrance");
    site.navigation.nodes.push(gate);
    site.navigation.edges.push(createNavigationEdge(gate.id, lobby[0]!.id, 100));

    const route = findShortestPath(buildRoutingGraph(project), gate.id, lobby[1]!.id)!;
    expect(route.nodeIds[0]).toBe(gate.id);
    expect(route.nodeIds.at(-1)).toBe(lobby[1]!.id);
  });

  it("a prepared graph gives the same answer as the plain one", () => {
    const { project, lobby } = towerWithBoth(6);
    const graph = buildRoutingGraph(project);
    const prepared = prepareRoutingGraph(graph);
    for (const target of lobby) {
      expect(findShortestPath(prepared, lobby[0]!.id, target.id)).toEqual(
        findShortestPath(graph, lobby[0]!.id, target.id),
      );
    }
  });
});

describe("findShortestPath cost model", () => {
  const a: NavigationNode = { id: "A", floorId: "F", position: { x: 0, y: 0 }, type: "normal" };
  const b: NavigationNode = { id: "B", floorId: "F", position: { x: 12, y: 0 }, type: "normal" };

  it("uses walking speed for stored edges and an edge's own duration when present", () => {
    const graph: RoutingGraph = {
      nodes: [a, b],
      edges: [{ id: "w", from: "A", to: "B", type: "walk", distance: 12, accessible: true }],
    };
    expect(findShortestPath(graph, "A", "B")!.cost).toBeCloseTo(10);
    expect(findShortestPath(graph, "A", "B", { walkingSpeed: 0.6 })!.cost).toBeCloseTo(20);

    graph.edges[0]!.duration = 3;
    expect(findShortestPath(graph, "A", "B")!.cost).toBe(3);
  });

  it("ignores a non-positive walking speed", () => {
    const graph: RoutingGraph = {
      nodes: [a, b],
      edges: [{ id: "w", from: "A", to: "B", type: "walk", distance: 12, accessible: true }],
    };
    expect(findShortestPath(graph, "A", "B", { walkingSpeed: 0 })!.cost).toBeCloseTo(10);
  });

  it("only traverses a one-way stored edge forwards", () => {
    const graph: RoutingGraph = {
      nodes: [a, b],
      edges: [
        { id: "w", from: "A", to: "B", type: "walk", distance: 12, accessible: true, oneWay: true },
      ],
    };
    expect(findShortestPath(graph, "A", "B")).not.toBeNull();
    expect(findShortestPath(graph, "B", "A")).toBeNull();
  });
});

describe("siteRoutingEdges", () => {
  it("re-measures outdoor↔building links from the current placement", () => {
    const { project, building, lobby } = tower(1);
    const site = createSite("Campus");
    project.site = site;
    const gate = createNavigationNode(site.id, { x: 0, y: -100 });
    const bench = createNavigationNode(site.id, { x: 0, y: -130 });
    site.navigation.nodes.push(gate, bench);
    const link = createNavigationEdge(gate.id, lobby[0]!.id, 100);
    const path = createNavigationEdge(gate.id, bench.id, 42); // deliberate path length
    site.navigation.edges.push(link, path);

    // The building moved 800 m away after the link was made; the stored 100 m is stale.
    building.placement = { origin: { x: 0, y: 800 }, bearing: 0 };
    const edges = siteRoutingEdges(project);
    expect(edges.find((e) => e.id === link.id)!.distance).toBeCloseTo(900);
    expect(edges.find((e) => e.id === path.id)).toBe(path);
    expect(link.distance).toBe(100); // stored data is not mutated

    const route = findShortestPath(
      prepareRoutingGraph(buildRoutingGraph(project)),
      gate.id,
      lobby[0]!.id,
    );
    expect(route?.distance).toBeCloseTo(900);
  });
});

describe("stairs drawn on the plan (floorRoutingEdges)", () => {
  /**
   * Two ways from A (0,0) to B (10,0): straight across over a staircase
   * (via S at 5,0 — 10 m), or around the stair through C (5,6) — ~15.6 m.
   * All edges are plain "walk" edges, as the path tool draws them.
   */
  function plan(stair: "element" | "space") {
    const project = createEmptyProject("Stairs");
    const building = createBuilding("A");
    const floor = createFloor("1F", 1);
    building.floors.push(floor);
    project.buildings.push(building);
    const node = (x: number, y: number) => {
      const n = createNavigationNode(floor.id, { x, y });
      floor.navigation.nodes.push(n);
      return n;
    };
    const a = node(0, 0),
      s = node(5, 0),
      b = node(10, 0),
      c = node(5, 6);
    const link = (p: NavigationNode, q: NavigationNode) =>
      floor.navigation.edges.push(
        createNavigationEdge(
          p.id,
          q.id,
          Math.hypot(q.position.x - p.position.x, q.position.y - p.position.y),
        ),
      );
    link(a, s);
    link(s, b);
    link(a, c);
    link(c, b);
    if (stair === "element") {
      const element = createEntrance(floor.id, { x: 5, y: 0 }, "stairs");
      Object.assign(element, { width: 1.2, depth: 3, rotation: 0 });
      floor.entrances.push(element);
    } else {
      floor.spaces.push(
        createSpace(
          floor.id,
          [
            { x: 4, y: -1 },
            { x: 6, y: -1 },
            { x: 6, y: 1 },
            { x: 4, y: 1 },
          ],
          "stairs",
        ),
      );
    }
    return { project, a, b, c };
  }

  for (const stair of ["element", "space"] as const) {
    it(`"avoid stairs" and "accessible only" detour around a stair ${stair}`, () => {
      const { project, a, b, c } = plan(stair);
      const graph = buildRoutingGraph(project);
      const direct = findShortestPath(graph, a.id, b.id);
      expect(direct?.nodeIds).toHaveLength(3);
      expect(direct?.nodeIds).not.toContain(c.id);
      for (const options of [{ avoidStairs: true }, { requireAccessible: true }]) {
        const detour = findShortestPath(graph, a.id, b.id, options);
        expect(detour?.nodeIds).toEqual([a.id, c.id, b.id]);
      }
    });
  }

  it("leaves edges that only end at the stair foot, and hand-typed edges, alone", () => {
    const { project } = plan("element");
    const floor = project.buildings[0]!.floors[0]!;
    floor.entrances[0]!.position = { x: 7, y: 0 }; // stair now spans x 5.5..8.5
    floor.navigation.edges[0]!.type = "elevator";
    const edges = floorRoutingEdges(floor);
    expect(edges[0]!.type).toBe("elevator"); // kept as typed
    expect(edges[1]!.type).toBe("stairs"); // S(5,0)→B(10,0) runs over it
    expect(edges[2]!.type).toBe("walk");
  });
});
