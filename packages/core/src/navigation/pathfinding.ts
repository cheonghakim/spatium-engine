import { distance } from "../geometry/distance.js";
import type { NavigationEdge, NavigationGraph } from "../types/navigation.js";

export interface PathfindingOptions {
  /** Reject edges of type "stairs" entirely. */
  avoidStairs?: boolean;
  /** Reject any edge not marked accessible. */
  requireAccessible?: boolean;
  /** Halve the effective cost of elevator edges, biasing the search toward them. */
  preferElevator?: boolean;
}

export interface PathResult {
  nodeIds: string[];
  edgeIds: string[];
  distance: number;
}

function isTraversable(edge: NavigationEdge, options: PathfindingOptions): boolean {
  if (options.requireAccessible && !edge.accessible) return false;
  if (options.avoidStairs && edge.type === "stairs") return false;
  return true;
}

function edgeWeight(edge: NavigationEdge, options: PathfindingOptions): number {
  const multiplier = options.preferElevator && edge.type === "elevator" ? 0.5 : 1;
  return edge.distance * multiplier;
}

/**
 * A* search over the navigation graph (undirected — edges are walkable both
 * ways). The heuristic is straight-line distance to the goal for nodes on
 * the same floor, and 0 across floors (inter-floor travel cost isn't known
 * ahead of time). Both are safe lower bounds on the true cost, so results
 * stay optimal; the same-floor case gives A* a real edge over plain Dijkstra
 * once a floor has more than a handful of nodes.
 */
export function findShortestPath(
  graph: NavigationGraph,
  startNodeId: string,
  goalNodeId: string,
  options: PathfindingOptions = {},
): PathResult | null {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const goal = nodesById.get(goalNodeId);
  if (!nodesById.has(startNodeId) || !goal) return null;
  if (startNodeId === goalNodeId) return { nodeIds: [startNodeId], edgeIds: [], distance: 0 };

  const adjacency = new Map<string, Array<{ edge: NavigationEdge; neighborId: string }>>();
  for (const edge of graph.edges) {
    if (!isTraversable(edge, options)) continue;
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) continue;

    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from)?.push({ edge, neighborId: edge.to });
    adjacency.get(edge.to)?.push({ edge, neighborId: edge.from });
  }

  function heuristic(nodeId: string): number {
    const node = nodesById.get(nodeId);
    // `goal` was verified non-null above; TS can't carry that into this
    // nested closure, so it's asserted here instead of re-checked at runtime.
    if (!node || node.floorId !== goal!.floorId) return 0;
    return distance(node.position, goal!.position);
  }

  const gScore = new Map<string, number>([[startNodeId, 0]]);
  const cameFrom = new Map<string, { nodeId: string; edge: NavigationEdge }>();
  const visited = new Set<string>();
  const open = new Set<string>([startNodeId]);

  while (open.size > 0) {
    let currentId: string | null = null;
    let bestF = Infinity;
    for (const id of open) {
      const f = (gScore.get(id) ?? Infinity) + heuristic(id);
      if (f < bestF) {
        bestF = f;
        currentId = id;
      }
    }
    if (currentId === null || currentId === goalNodeId) break;

    open.delete(currentId);
    visited.add(currentId);
    const currentG = gScore.get(currentId) ?? Infinity;

    for (const { edge, neighborId } of adjacency.get(currentId) ?? []) {
      if (visited.has(neighborId)) continue;
      const tentativeG = currentG + edgeWeight(edge, options);
      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        gScore.set(neighborId, tentativeG);
        cameFrom.set(neighborId, { nodeId: currentId, edge });
        open.add(neighborId);
      }
    }
  }

  if (!gScore.has(goalNodeId)) return null;

  const nodeIds: string[] = [goalNodeId];
  const edgeIds: string[] = [];
  let cursor = goalNodeId;
  while (cursor !== startNodeId) {
    const step = cameFrom.get(cursor);
    if (!step) return null;
    edgeIds.push(step.edge.id);
    nodeIds.push(step.nodeId);
    cursor = step.nodeId;
  }
  nodeIds.reverse();
  edgeIds.reverse();

  return { nodeIds, edgeIds, distance: gScore.get(goalNodeId) ?? 0 };
}
