import { describe, expect, it } from "vitest";
import type { NavigationNode } from "../types/navigation.js";
import {
  edgeDuration,
  findRoute,
  findShortestPath,
  type PathfindingOptions,
  type RoutingEdge,
  type RoutingGraph,
} from "./pathfinding.js";

/** Plain Dijkstra over the same cost model — the reference answer. */
function dijkstra(
  graph: RoutingGraph,
  start: string,
  goal: string,
  options: PathfindingOptions = {},
): number | null {
  const speed = options.walkingSpeed ?? 1.2;
  const dist = new Map<string, number>([[start, 0]]);
  const done = new Set<string>();
  for (;;) {
    let current: string | null = null;
    for (const [id, d] of dist) {
      if (!done.has(id) && (current === null || d < dist.get(current)!)) current = id;
    }
    if (current === null) return null;
    if (current === goal) return dist.get(goal)!;
    done.add(current);
    for (const edge of graph.edges) {
      if (options.requireAccessible && !edge.accessible) continue;
      if (options.avoidStairs && edge.type === "stairs") continue;
      const next =
        edge.from === current ? edge.to : !edge.oneWay && edge.to === current ? edge.from : null;
      if (next === null) continue;
      let w = edgeDuration(edge, speed);
      if (options.preferElevator && edge.type === "elevator") w *= 0.5;
      const candidate = dist.get(current)! + w;
      if (candidate < (dist.get(next) ?? Infinity)) dist.set(next, candidate);
    }
  }
}

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Random multi-floor graph: walk edges on each floor (some with a stored
 * distance shorter than the geometry — real data is imperfect), plus
 * cross-floor edges with arbitrary durations, like connectors.
 */
function randomGraph(seed: number): RoutingGraph {
  const rand = rng(seed);
  const nodes: NavigationNode[] = [];
  const edges: RoutingEdge[] = [];
  const floors = 3;
  const perFloor = 8;
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < perFloor; i++) {
      nodes.push({
        id: `${f}-${i}`,
        floorId: `F${f}`,
        position: { x: rand() * 100, y: rand() * 100 },
        type: "normal",
      });
    }
  }
  let id = 0;
  for (let f = 0; f < floors; f++) {
    for (let k = 0; k < 14; k++) {
      const a = nodes[f * perFloor + Math.floor(rand() * perFloor)]!;
      const b = nodes[f * perFloor + Math.floor(rand() * perFloor)]!;
      if (a === b) continue;
      const geometric = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
      edges.push({
        id: `e${id++}`,
        from: a.id,
        to: b.id,
        type: "walk",
        distance: rand() < 0.2 ? geometric * 0.5 : geometric,
        accessible: true,
        ...(rand() < 0.1 ? { oneWay: true } : {}),
      });
    }
  }
  for (let k = 0; k < 6; k++) {
    const f = Math.floor(rand() * (floors - 1));
    const a = nodes[f * perFloor + Math.floor(rand() * perFloor)]!;
    const b = nodes[(f + 1) * perFloor + Math.floor(rand() * perFloor)]!;
    edges.push({
      id: `c${id++}`,
      from: a.id,
      to: b.id,
      type: rand() < 0.5 ? "elevator" : "stairs",
      distance: 4,
      accessible: true,
      duration: 1 + rand() * 40,
    });
  }
  return { nodes, edges };
}

describe("findShortestPath optimality", () => {
  it("matches Dijkstra on random multi-floor graphs", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const graph = randomGraph(seed);
      const rand = rng(seed * 7);
      for (let q = 0; q < 4; q++) {
        const start = graph.nodes[Math.floor(rand() * graph.nodes.length)]!.id;
        const goal = graph.nodes[Math.floor(rand() * graph.nodes.length)]!.id;
        for (const options of [{}, { preferElevator: true }, { walkingSpeed: 0.8 }]) {
          const expected = dijkstra(graph, start, goal, options);
          const found = findShortestPath(graph, start, goal, options);
          if (expected === null) {
            expect(found, `seed ${seed} ${start}->${goal}`).toBeNull();
            continue;
          }
          // `cost` is real time; compare the searched (weighted) cost via a re-sum.
          const weighted = found!.edgeIds.reduce((sum, edgeId) => {
            const edge = graph.edges.find((e) => e.id === edgeId)!;
            const w = edgeDuration(edge, options.walkingSpeed ?? 1.2);
            return sum + (options.preferElevator && edge.type === "elevator" ? w * 0.5 : w);
          }, 0);
          expect(weighted, `seed ${seed} ${start}->${goal} ${JSON.stringify(options)}`).toBeCloseTo(
            expected,
            6,
          );
        }
      }
    }
  });

  it("an elevator detour back to the goal floor beats walking around", () => {
    // Goal G is 100 m east of S on the same floor but the floor path is a
    // 240 m detour (200 s). Up and down via elevators is 2 × 60 s = 120 s.
    const n = (id: string, floorId: string, x: number): NavigationNode => ({
      id,
      floorId,
      position: { x, y: 0 },
      type: "normal",
    });
    const graph: RoutingGraph = {
      nodes: [
        n("S", "F1", 0),
        n("G", "F1", 100),
        n("U1", "F2", 0),
        n("U2", "F2", 100),
        n("M", "F1", 50),
      ],
      edges: [
        { id: "walk1", from: "S", to: "M", type: "walk", distance: 120, accessible: true },
        { id: "walk2", from: "M", to: "G", type: "walk", distance: 120, accessible: true },
        {
          id: "up",
          from: "S",
          to: "U1",
          type: "elevator",
          distance: 4,
          accessible: true,
          duration: 60,
        },
        {
          id: "cross",
          from: "U1",
          to: "U2",
          type: "walk",
          distance: 0,
          accessible: true,
          duration: 0,
        },
        {
          id: "down",
          from: "U2",
          to: "G",
          type: "elevator",
          distance: 4,
          accessible: true,
          duration: 60,
        },
      ],
    };
    expect(findShortestPath(graph, "S", "G")!.cost).toBeCloseTo(120);
    expect(findRoute(graph, [{ nodeId: "S" }], [{ nodeId: "G" }])!.nodeIds).toEqual([
      "S",
      "U1",
      "U2",
      "G",
    ]);
  });
});
