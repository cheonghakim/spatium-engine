import { describe, expect, it } from "vitest";
import type { NavigationEdge, NavigationGraph, NavigationNode } from "../types/navigation.js";
import { findShortestPath } from "./pathfinding.js";

function node(id: string, x: number, y: number, floorId = "1F"): NavigationNode {
  return { id, floorId, position: { x, y }, type: "normal" };
}

function edge(
  id: string,
  from: string,
  to: string,
  distance: number,
  type: NavigationEdge["type"] = "walk",
  accessible = true,
): NavigationEdge {
  return { id, from, to, type, distance, accessible };
}

// A --1-- B --1-- C
//  \______2_______/
const triangle: NavigationGraph = {
  nodes: [node("A", 0, 0), node("B", 1, 0), node("C", 2, 0)],
  edges: [edge("e1", "A", "B", 1), edge("e2", "B", "C", 1), edge("e3", "A", "C", 2)],
};

describe("findShortestPath", () => {
  it("finds the direct edge when it's shortest", () => {
    const result = findShortestPath(triangle, "A", "C");
    expect(result?.nodeIds).toEqual(["A", "C"]);
    expect(result?.distance).toBe(2);
  });

  it("prefers the two-hop route when it's cheaper than the direct edge", () => {
    const graph: NavigationGraph = {
      nodes: triangle.nodes,
      edges: [edge("e1", "A", "B", 1), edge("e2", "B", "C", 1), edge("e3", "A", "C", 10)],
    };
    const result = findShortestPath(graph, "A", "C");
    expect(result?.nodeIds).toEqual(["A", "B", "C"]);
    expect(result?.distance).toBe(2);
  });

  it("treats edges as undirected", () => {
    const result = findShortestPath(triangle, "C", "A");
    expect(result?.nodeIds[0]).toBe("C");
    expect(result?.nodeIds.at(-1)).toBe("A");
  });

  it("returns null when start or goal doesn't exist", () => {
    expect(findShortestPath(triangle, "A", "ghost")).toBeNull();
    expect(findShortestPath(triangle, "ghost", "A")).toBeNull();
  });

  it("returns null when the graph is disconnected", () => {
    const graph: NavigationGraph = {
      nodes: [node("A", 0, 0), node("B", 10, 0)],
      edges: [],
    };
    expect(findShortestPath(graph, "A", "B")).toBeNull();
  });

  it("returns a trivial zero-length path when start equals goal", () => {
    const result = findShortestPath(triangle, "A", "A");
    expect(result).toEqual({ nodeIds: ["A"], edgeIds: [], distance: 0 });
  });

  it("avoidStairs rejects stairs edges even if they're the only route", () => {
    const graph: NavigationGraph = {
      nodes: [node("A", 0, 0), node("B", 1, 0)],
      edges: [edge("e1", "A", "B", 1, "stairs")],
    };
    expect(findShortestPath(graph, "A", "B")).not.toBeNull();
    expect(findShortestPath(graph, "A", "B", { avoidStairs: true })).toBeNull();
  });

  it("requireAccessible rejects inaccessible edges", () => {
    const graph: NavigationGraph = {
      nodes: [node("A", 0, 0), node("B", 1, 0)],
      edges: [edge("e1", "A", "B", 1, "walk", false)],
    };
    expect(findShortestPath(graph, "A", "B", { requireAccessible: true })).toBeNull();
  });

  it("preferElevator can flip which of two parallel edges is chosen", () => {
    const graph: NavigationGraph = {
      nodes: [node("A", 0, 0), node("B", 1, 0)],
      edges: [edge("walk", "A", "B", 5, "walk"), edge("lift", "A", "B", 8, "elevator")],
    };

    const withoutPreference = findShortestPath(graph, "A", "B");
    expect(withoutPreference?.edgeIds).toEqual(["walk"]);
    expect(withoutPreference?.distance).toBe(5);

    const withPreference = findShortestPath(graph, "A", "B", { preferElevator: true });
    expect(withPreference?.edgeIds).toEqual(["lift"]);
    expect(withPreference?.distance).toBeCloseTo(4);
  });

  it("supports multi-floor routing across a connecting edge", () => {
    const graph: NavigationGraph = {
      nodes: [node("A", 0, 0, "1F"), node("B", 0, 0, "2F")],
      edges: [edge("stairs", "A", "B", 3, "stairs")],
    };
    const result = findShortestPath(graph, "A", "B");
    expect(result?.nodeIds).toEqual(["A", "B"]);
    expect(result?.distance).toBe(3);
  });
});
