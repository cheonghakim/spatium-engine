import { distance } from "../geometry/distance.js";
import type { NavigationEdge, NavigationGraph, NavigationNode } from "../types/navigation.js";
import { MinHeap } from "./minHeap.js";

/** Average indoor walking speed (m/s) used to turn walking distance into time. */
export const DEFAULT_WALKING_SPEED = 1.2;

export interface PathfindingOptions {
  /** Reject edges of type "stairs" entirely. */
  avoidStairs?: boolean;
  /** Reject any edge not marked accessible. */
  requireAccessible?: boolean;
  /** Halve the effective cost of elevator edges, biasing the search toward them. */
  preferElevator?: boolean;
  /** Walking speed in m/s for edges without their own duration. Default DEFAULT_WALKING_SPEED. */
  walkingSpeed?: number;
}

/**
 * A navigation edge as used for routing. Edges derived from connectors carry
 * a `duration` from the equipment spec (waiting, boarding, travel); stored
 * edges usually don't, and cost distance ÷ walking speed.
 */
export interface RoutingEdge extends NavigationEdge {
  /** Estimated traversal time in seconds. Overrides distance ÷ walking speed. */
  duration?: number;
  /** Set on edges derived from a building connector. */
  connectorId?: string;
}

export interface RoutingGraph {
  nodes: NavigationNode[];
  edges: RoutingEdge[];
}

export interface PathResult {
  nodeIds: string[];
  edgeIds: string[];
  /** Total travel distance in meters (sum of edge distances along the path). */
  distance: number;
  /** Estimated travel time in seconds — what the search minimizes. */
  cost: number;
}

interface Neighbor {
  edge: RoutingEdge;
  neighborId: string;
}

/**
 * A graph indexed for repeated searches: node lookup and adjacency are built
 * once instead of on every findShortestPath call. Build it again after the
 * graph changes — it doesn't track later mutations of the source graph.
 */
export interface PreparedRoutingGraph {
  readonly kind: "prepared-routing-graph";
  readonly nodesById: ReadonlyMap<string, NavigationNode>;
  readonly adjacency: ReadonlyMap<string, readonly Neighbor[]>;
}

export function prepareRoutingGraph(graph: RoutingGraph): PreparedRoutingGraph {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, Neighbor[]>();
  const link = (from: string, edge: RoutingEdge, to: string): void => {
    const list = adjacency.get(from);
    if (list) list.push({ edge, neighborId: to });
    else adjacency.set(from, [{ edge, neighborId: to }]);
  };
  for (const edge of graph.edges) {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) continue;
    link(edge.from, edge, edge.to);
    if (!edge.oneWay) link(edge.to, edge, edge.from);
  }
  return { kind: "prepared-routing-graph", nodesById, adjacency };
}

function isPrepared(graph: RoutingGraph | PreparedRoutingGraph): graph is PreparedRoutingGraph {
  return (graph as PreparedRoutingGraph).kind === "prepared-routing-graph";
}

function isTraversable(edge: NavigationEdge, options: PathfindingOptions): boolean {
  if (options.requireAccessible && !edge.accessible) return false;
  if (options.avoidStairs && edge.type === "stairs") return false;
  return true;
}

function walkingSpeedOf(options: PathfindingOptions): number {
  const speed = options.walkingSpeed;
  return speed !== undefined && Number.isFinite(speed) && speed > 0 ? speed : DEFAULT_WALKING_SPEED;
}

/** Seconds to traverse `edge`, before any preference weighting. */
export function edgeDuration(edge: RoutingEdge, walkingSpeed = DEFAULT_WALKING_SPEED): number {
  return edge.duration ?? edge.distance / walkingSpeed;
}

/**
 * A place a route may start or end at: a graph node, plus the walk between
 * that node and the actual spot (e.g. from a corridor node to a shop's POI).
 */
export interface RouteAnchor {
  nodeId: string;
  /** Extra meters walked between the node and the real endpoint. Default 0. */
  distance?: number;
}

/**
 * A* search for the fastest route. Edges are walkable both ways unless
 * `oneWay`. Cost is time (seconds). The heuristic is straight-line distance ×
 * the graph's lowest seconds-per-meter edge ratio, which is consistent for any
 * data (connectors, imperfect stored distances), so results are optimal.
 *
 * Accepts a plain graph or one from prepareRoutingGraph; pass a prepared graph
 * when routing repeatedly over the same data.
 */
export function findShortestPath(
  graph: NavigationGraph | RoutingGraph | PreparedRoutingGraph,
  startNodeId: string,
  goalNodeId: string,
  options: PathfindingOptions = {},
): PathResult | null {
  return findRoute(graph, [{ nodeId: startNodeId }], [{ nodeId: goalNodeId }], options);
}

/**
 * Fastest route from any of `starts` to any of `goals` — e.g. from a POI to a
 * room with several doors. Each anchor's extra walk (distance ÷ walking speed)
 * is added to the cost, and to the reported distance, so the search picks the
 * best pair. Unknown node ids are ignored; returns null when no anchor pair
 * connects.
 */
export function findRoute(
  graph: NavigationGraph | RoutingGraph | PreparedRoutingGraph,
  starts: readonly RouteAnchor[],
  goals: readonly RouteAnchor[],
  options: PathfindingOptions = {},
): PathResult | null {
  const prepared = isPrepared(graph) ? graph : prepareRoutingGraph(graph);
  const { nodesById, adjacency } = prepared;
  const walkingSpeed = walkingSpeedOf(options);
  const extra = (anchor: RouteAnchor): number => {
    const d = anchor.distance;
    return d !== undefined && Number.isFinite(d) && d > 0 ? d : 0;
  };

  const startExtra = new Map<string, number>();
  for (const anchor of starts) {
    if (!nodesById.has(anchor.nodeId)) continue;
    const d = extra(anchor);
    if (d < (startExtra.get(anchor.nodeId) ?? Infinity)) startExtra.set(anchor.nodeId, d);
  }
  const goalExtra = new Map<string, number>();
  for (const anchor of goals) {
    if (!nodesById.has(anchor.nodeId)) continue;
    const d = extra(anchor);
    if (d < (goalExtra.get(anchor.nodeId) ?? Infinity)) goalExtra.set(anchor.nodeId, d);
  }
  if (startExtra.size === 0 || goalExtra.size === 0) return null;

  const weight = (edge: RoutingEdge): number => {
    const seconds = edgeDuration(edge, walkingSpeed);
    return options.preferElevator && edge.type === "elevator" ? seconds * 0.5 : seconds;
  };
  // Heuristic: straight-line distance × the lowest seconds-per-meter any edge
  // in the graph achieves (between its endpoints' plan positions), to the
  // closest goal. By the triangle inequality every path costs at least that,
  // and h(u) ≤ cost(u,v) + h(v) holds edge by edge — the heuristic is
  // consistent, so the closed set below never settles a node too early. A
  // per-floor "distance ÷ walking speed" bound is NOT consistent here: an
  // elevator leaving the floor can cost less than the walk it skips, and
  // stored edge distances may be shorter than the geometry.
  let secondsPerMeter = 1 / walkingSpeed;
  for (const [fromId, neighbors] of adjacency) {
    const from = nodesById.get(fromId)!;
    for (const { edge, neighborId } of neighbors) {
      const d = distance(from.position, nodesById.get(neighborId)!.position);
      if (d > 1e-9) secondsPerMeter = Math.min(secondsPerMeter, weight(edge) / d);
    }
  }
  const goalNodes = [...goalExtra.keys()].map((id) => nodesById.get(id)!);
  const heuristic = (nodeId: string): number => {
    if (secondsPerMeter <= 0) return 0;
    const node = nodesById.get(nodeId);
    if (!node) return 0;
    let best = Infinity;
    for (const goal of goalNodes) {
      const d = distance(node.position, goal.position);
      if (d < best) best = d;
    }
    return best === Infinity ? 0 : best * secondsPerMeter;
  };

  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, { nodeId: string; edge: RoutingEdge }>();
  const visited = new Set<string>();
  // Binary min-heap keyed by f-score. Array heaps lack an efficient
  // decrease-key, so a cheaper path just pushes the node again; the stale
  // entry is skipped by the `visited` check when popped (gScore only ever
  // improves, so the first pop of a node carries its best f-score).
  const open = new MinHeap<string>();
  for (const [nodeId, d] of startExtra) {
    const g = d / walkingSpeed;
    gScore.set(nodeId, g);
    open.push(nodeId, g + heuristic(nodeId));
  }

  // The goal is virtual: reaching goal node n costs g(n) + its extra walk.
  // Settling stops once no open entry can beat the best finish found.
  let bestGoal: string | null = null;
  let bestTotal = Infinity;
  while (open.size > 0) {
    // f never overestimates the cost to any goal node, and finishing there
    // only adds more, so nothing left in the heap can beat bestTotal.
    if (open.peekPriority() >= bestTotal) break;
    const currentId = open.pop();
    if (currentId === undefined) break;
    if (visited.has(currentId)) continue;
    const currentG = gScore.get(currentId) ?? Infinity;
    visited.add(currentId);

    const finish = goalExtra.get(currentId);
    if (finish !== undefined && currentG + finish / walkingSpeed < bestTotal) {
      bestTotal = currentG + finish / walkingSpeed;
      bestGoal = currentId;
      if (finish === 0 && goalExtra.size === 1) break;
    }

    for (const { edge, neighborId } of adjacency.get(currentId) ?? []) {
      if (visited.has(neighborId) || !isTraversable(edge, options)) continue;
      const tentativeG = currentG + weight(edge);
      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        gScore.set(neighborId, tentativeG);
        cameFrom.set(neighborId, { nodeId: currentId, edge });
        open.push(neighborId, tentativeG + heuristic(neighborId));
      }
    }
  }

  if (bestGoal === null) return null;

  const nodeIds: string[] = [bestGoal];
  const edgeIds: string[] = [];
  const goalWalk = goalExtra.get(bestGoal) ?? 0;
  let totalDistance = goalWalk;
  let totalSeconds = goalWalk / walkingSpeed;
  let cursor = bestGoal;
  for (let step = cameFrom.get(cursor); step; step = cameFrom.get(cursor)) {
    edgeIds.push(step.edge.id);
    nodeIds.push(step.nodeId);
    totalDistance += step.edge.distance;
    // Report real time, not the preferElevator-weighted search cost.
    totalSeconds += edgeDuration(step.edge, walkingSpeed);
    cursor = step.nodeId;
  }
  const startWalk = startExtra.get(cursor) ?? 0;
  totalDistance += startWalk;
  totalSeconds += startWalk / walkingSpeed;
  nodeIds.reverse();
  edgeIds.reverse();

  return { nodeIds, edgeIds, distance: totalDistance, cost: totalSeconds };
}
