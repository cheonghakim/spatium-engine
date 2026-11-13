import { describe, expect, it } from "vitest";
import {
  createBuilding,
  createEmptyProject,
  createFloor,
  createNavigationEdge,
  createNavigationNode,
  createPOI,
  createSpace,
} from "../factories.js";
import type { Point } from "../types/common.js";
import { diagnoseRoute } from "./diagnose.js";
import { resolveRouteEndpoint } from "./endpoints.js";
import { findRoute, findShortestPath } from "./pathfinding.js";
import { buildRoutingGraph } from "./routingGraph.js";

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/**
 * A corridor along y∈[0,2], x∈[0,30], with a shop above it (y∈[2,10],
 * x∈[10,20]) that has two doors, at x=11 and x=19.
 *   corridor nodes: c0 (0,1) — c1 (11,1) — c2 (19,1) — c3 (30,1)
 *   doors on the shop's wall: d1 (11,2), d2 (19,2)
 */
function mall() {
  const project = createEmptyProject("Mall");
  const building = createBuilding("M");
  const floor = createFloor("1F", 1);
  const corridor = createSpace(floor.id, rect(0, 0, 30, 2), "corridor");
  const shop = createSpace(floor.id, rect(10, 2, 20, 10), "store");
  shop.properties.name = "Coffee";
  floor.spaces.push(corridor, shop);

  const node = (x: number, y: number) => createNavigationNode(floor.id, { x, y });
  const c0 = node(0, 1);
  const c1 = node(11, 1);
  const c2 = node(19, 1);
  const c3 = node(30, 1);
  const d1 = node(11, 2);
  const d2 = node(19, 2);
  floor.navigation.nodes.push(c0, c1, c2, c3, d1, d2);
  floor.navigation.edges.push(
    createNavigationEdge(c0.id, c1.id, 11),
    createNavigationEdge(c1.id, c2.id, 8),
    createNavigationEdge(c2.id, c3.id, 11),
    createNavigationEdge(c1.id, d1.id, 1),
    createNavigationEdge(c2.id, d2.id, 1),
  );
  const poi = createPOI(floor.id, { x: 18, y: 8 }, "store", "Coffee counter");
  floor.pois.push(poi);
  building.floors.push(floor);
  project.buildings.push(building);
  return { project, floor, corridor, shop, poi, c0, c1, c2, c3, d1, d2 };
}

describe("resolveRouteEndpoint", () => {
  it("passes node ids through", () => {
    const { project } = mall();
    expect(resolveRouteEndpoint(project, "n1")).toEqual([{ nodeId: "n1" }]);
    expect(resolveRouteEndpoint(project, { nodeId: "n1" })).toEqual([{ nodeId: "n1" }]);
  });

  it("a space resolves to its door nodes at no extra cost", () => {
    const { project, shop, d1, d2 } = mall();
    expect(resolveRouteEndpoint(project, { spaceId: shop.id })).toEqual([
      { nodeId: d1.id },
      { nodeId: d2.id },
    ]);
  });

  it("a POI resolves to its space's nodes plus the walk to it", () => {
    const { project, poi, d1, d2 } = mall();
    const anchors = resolveRouteEndpoint(project, { poiId: poi.id });
    expect(anchors.map((a) => a.nodeId)).toEqual([d1.id, d2.id]);
    expect(anchors[1]!.distance).toBeCloseTo(Math.hypot(1, 6));
  });

  it("a free position falls back to the nearest node when its space has none", () => {
    const { project, floor, c3 } = mall();
    const anchors = resolveRouteEndpoint(project, { floorId: floor.id, position: { x: 40, y: 1 } });
    expect(anchors).toEqual([{ nodeId: c3.id, distance: 10 }]);
  });

  it("returns [] for unknown endpoints", () => {
    const { project } = mall();
    expect(resolveRouteEndpoint(project, { poiId: "nope" })).toEqual([]);
    expect(resolveRouteEndpoint(project, { spaceId: "nope" })).toEqual([]);
    expect(resolveRouteEndpoint(project, { floorId: "nope", position: { x: 0, y: 0 } })).toEqual(
      [],
    );
  });
});

describe("findRoute with several anchors", () => {
  it("enters the shop by the door closer to the start", () => {
    const { project, shop, c0, c3, d1, d2 } = mall();
    const graph = buildRoutingGraph(project);
    const goals = resolveRouteEndpoint(project, { spaceId: shop.id });

    const fromWest = findRoute(graph, [{ nodeId: c0.id }], goals)!;
    expect(fromWest.nodeIds.at(-1)).toBe(d1.id);
    expect(fromWest.distance).toBe(12);

    const fromEast = findRoute(graph, [{ nodeId: c3.id }], goals)!;
    expect(fromEast.nodeIds.at(-1)).toBe(d2.id);
  });

  it("counts the walk from the door to the POI, choosing the door nearer the POI", () => {
    const { project, poi, c0, d2 } = mall();
    const graph = buildRoutingGraph(project);
    const route = findRoute(
      graph,
      [{ nodeId: c0.id }],
      resolveRouteEndpoint(project, { poiId: poi.id }),
    )!;
    // Via d1: 12 + |(11,2)-(18,8)| ≈ 21.2; via d2: 20 + |(19,2)-(18,8)| ≈ 26.1 → d1.
    expect(route.nodeIds.at(-1)).not.toBe(d2.id);
    expect(route.distance).toBeCloseTo(12 + Math.hypot(7, 6));
    expect(route.cost).toBeCloseTo(route.distance / 1.2);
  });

  it("counts the walk at the start too and agrees with findShortestPath for single nodes", () => {
    const { project, c0, c3 } = mall();
    const graph = buildRoutingGraph(project);
    const plain = findShortestPath(graph, c0.id, c3.id)!;
    expect(findRoute(graph, [{ nodeId: c0.id }], [{ nodeId: c3.id }])).toEqual(plain);
    const offset = findRoute(graph, [{ nodeId: c0.id, distance: 5 }], [{ nodeId: c3.id }])!;
    expect(offset.distance).toBe(plain.distance + 5);
  });

  it("returns null when no anchor exists or connects", () => {
    const { project, c0 } = mall();
    const graph = buildRoutingGraph(project);
    expect(findRoute(graph, [], [{ nodeId: c0.id }])).toBeNull();
    expect(findRoute(graph, [{ nodeId: c0.id }], [{ nodeId: "ghost" }])).toBeNull();
  });
});

describe("diagnoseRoute", () => {
  it("names the reason a route is missing", () => {
    const { project, floor, shop, c0, c3 } = mall();
    expect(diagnoseRoute(project, c0.id, { spaceId: shop.id })).toBeNull();
    expect(diagnoseRoute(project, { poiId: "gone" }, c0.id)).toBe("start-unreachable");
    expect(diagnoseRoute(project, c0.id, { spaceId: "gone" })).toBe("end-unreachable");

    // Every edge inaccessible: a route exists, just not a wheelchair one.
    floor.navigation.edges = floor.navigation.edges.map((e) => ({ ...e, accessible: false }));
    expect(diagnoseRoute(project, c0.id, c3.id, { requireAccessible: true })).toBe(
      "blocked-by-options",
    );

    floor.navigation.edges = [];
    expect(diagnoseRoute(project, c0.id, c3.id)).toBe("disconnected");
  });
});
