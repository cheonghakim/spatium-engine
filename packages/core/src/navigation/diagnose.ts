import type { IndoorProject } from "../types/project.js";
import { resolveRouteEndpoint, type RouteEndpoint } from "./endpoints.js";
import { findRoute, prepareRoutingGraph, type PathfindingOptions } from "./pathfinding.js";
import { buildRoutingGraph, type RoutingGraphOptions } from "./routingGraph.js";

/**
 * Why no route exists between two endpoints:
 *  - "start-unreachable" / "end-unreachable": the endpoint doesn't exist, its
 *    floor has no navigation nodes, or every node is behind a wall or hole.
 *  - "blocked-by-options": a route exists, but not one that satisfies
 *    `avoidStairs` / `requireAccessible`.
 *  - "disconnected": the endpoints' graph parts aren't linked at all.
 */
export type NoRouteReason =
  "start-unreachable" | "end-unreachable" | "blocked-by-options" | "disconnected";

/**
 * Explains a missing route, or returns null when a route exists. Meant for
 * the "no route" path of a UI, so it rebuilds the graph rather than taking a
 * cached one.
 */
export function diagnoseRoute(
  project: IndoorProject,
  from: RouteEndpoint,
  to: RouteEndpoint,
  options: PathfindingOptions & RoutingGraphOptions = {},
): NoRouteReason | null {
  const starts = resolveRouteEndpoint(project, from);
  if (starts.length === 0) return "start-unreachable";
  const goals = resolveRouteEndpoint(project, to);
  if (goals.length === 0) return "end-unreachable";
  const graph = prepareRoutingGraph(buildRoutingGraph(project, options));
  if (findRoute(graph, starts, goals, options)) return null;
  if (options.avoidStairs || options.requireAccessible) {
    const relaxed: PathfindingOptions = { ...options };
    delete relaxed.avoidStairs;
    delete relaxed.requireAccessible;
    if (findRoute(graph, starts, goals, relaxed)) return "blocked-by-options";
  }
  return "disconnected";
}
