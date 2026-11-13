import { distance } from "../geometry/distance.js";
import { buildingToSite } from "../geometry/georeference.js";
import { isPointInPolygon } from "../geometry/polygon.js";
import type { Point } from "../types/common.js";
import type { Connector, ConnectorSpec, ConnectorType } from "../types/connector.js";
import type { NavigationEdge, NavigationEdgeType, NavigationNode } from "../types/navigation.js";
import type { Building, Floor, IndoorProject } from "../types/project.js";
import { DEFAULT_WALKING_SPEED, type RoutingEdge, type RoutingGraph } from "./pathfinding.js";

/** Spec values that feed the time model; capacity is informational only. */
export type ConnectorTiming = Required<
  Pick<ConnectorSpec, "speed" | "averageWait" | "boardingTime">
>;

/**
 * Defaults when a connector has no spec of its own (docs/design/0001 §4).
 * `speed` means: elevator — car speed (m/s, vertical); escalator — step speed
 * along the incline; stairs — vertical climbing speed; ramp — walking speed
 * along the incline (null here = use the walking speed).
 */
export const DEFAULT_CONNECTOR_TIMING: Record<ConnectorType, ConnectorTiming> = {
  elevator: { speed: 1.5, averageWait: 30, boardingTime: 10 },
  escalator: { speed: 0.5, averageWait: 0, boardingTime: 0 },
  stairs: { speed: 0.4, averageWait: 0, boardingTime: 0 },
  ramp: { speed: DEFAULT_WALKING_SPEED, averageWait: 0, boardingTime: 0 },
};

/** Storey height assumed when floors don't carry distinct elevations (all 0 is common). */
export const DEFAULT_STOREY_HEIGHT = 4;

export interface RoutingGraphOptions {
  /** Walking speed (m/s) for the horizontal part of stairs and for ramps without a spec. */
  walkingSpeed?: number;
  /** Per-type overrides of DEFAULT_CONNECTOR_TIMING; a connector's own spec still wins. */
  connectorDefaults?: Partial<Record<ConnectorType, Partial<ConnectorTiming>>>;
}

const EDGE_TYPE: Record<ConnectorType, NavigationEdgeType> = {
  elevator: "elevator",
  stairs: "stairs",
  escalator: "escalator",
  ramp: "walk",
};

function positive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function nonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Precedence: connector spec > call-site defaults > built-in defaults. */
export function resolveConnectorTiming(
  connector: Pick<Connector, "type" | "spec">,
  options: RoutingGraphOptions = {},
): ConnectorTiming {
  const builtIn = DEFAULT_CONNECTOR_TIMING[connector.type];
  const callSite = options.connectorDefaults?.[connector.type] ?? {};
  const own = connector.spec ?? {};
  const walking = positive(options.walkingSpeed) ?? DEFAULT_WALKING_SPEED;
  return {
    speed:
      positive(own.speed) ??
      positive(callSite.speed) ??
      (connector.type === "ramp" ? walking : builtIn.speed),
    averageWait:
      nonNegative(own.averageWait) ?? nonNegative(callSite.averageWait) ?? builtIn.averageWait,
    boardingTime:
      nonNegative(own.boardingTime) ?? nonNegative(callSite.boardingTime) ?? builtIn.boardingTime,
  };
}

interface ResolvedStop {
  floor: Floor;
  node: NavigationNode;
}

function verticalGap(a: Floor, b: Floor): number {
  const byElevation = Math.abs(b.elevation - a.elevation);
  if (byElevation > 0) return byElevation;
  return Math.abs(b.level - a.level) * DEFAULT_STOREY_HEIGHT;
}

function edgeBetween(
  connector: Connector,
  from: ResolvedStop,
  to: ResolvedStop,
  timing: ConnectorTiming,
  walkingSpeed: number,
  oneWay: boolean,
): RoutingEdge {
  const vertical = verticalGap(from.floor, to.floor);
  const horizontal = distance(from.node.position, to.node.position);
  const incline = Math.hypot(horizontal, vertical);

  let travelDistance: number;
  let seconds: number;
  switch (connector.type) {
    case "elevator":
      // Riders walk out at the same plan position; only the shaft travel counts.
      travelDistance = vertical;
      seconds = timing.averageWait + timing.boardingTime + vertical / timing.speed;
      break;
    case "stairs":
      travelDistance = incline;
      seconds = timing.boardingTime + vertical / timing.speed + horizontal / walkingSpeed;
      break;
    case "escalator":
    case "ramp":
      travelDistance = incline;
      seconds = timing.averageWait + timing.boardingTime + incline / timing.speed;
      break;
  }

  return {
    id: `${connector.id}:${from.node.id}->${to.node.id}`,
    from: from.node.id,
    to: to.node.id,
    type: EDGE_TYPE[connector.type],
    distance: travelDistance,
    accessible: connector.accessible,
    ...(oneWay ? { oneWay: true } : {}),
    duration: seconds,
    connectorId: connector.id,
  };
}

/**
 * Routing edges derived from a building's connectors. Stops whose floor or
 * node doesn't exist are skipped (validateProject reports them).
 *  - Elevators link every pair of stops, so a ride pays the wait once.
 *  - Stairs, escalators and ramps link consecutive stops (by elevation),
 *    since you pass through the floors in between.
 *  - An escalator with a direction yields one-way edges.
 */
export function connectorRoutingEdges(
  building: Building,
  options: RoutingGraphOptions = {},
): RoutingEdge[] {
  const walkingSpeed = positive(options.walkingSpeed) ?? DEFAULT_WALKING_SPEED;
  const edges: RoutingEdge[] = [];

  for (const connector of building.connectors ?? []) {
    const seenFloors = new Set<string>();
    const stops: ResolvedStop[] = [];
    for (const stop of connector.stops) {
      if (seenFloors.has(stop.floorId)) continue;
      const floor = building.floors.find((f) => f.id === stop.floorId);
      const node = floor?.navigation.nodes.find((n) => n.id === stop.nodeId);
      if (!floor || !node) continue;
      seenFloors.add(floor.id);
      stops.push({ floor, node });
    }
    stops.sort((a, b) => a.floor.elevation - b.floor.elevation || a.floor.level - b.floor.level);

    const timing = resolveConnectorTiming(connector, options);
    if (connector.type === "elevator") {
      for (let i = 0; i < stops.length; i++) {
        for (let j = i + 1; j < stops.length; j++) {
          edges.push(edgeBetween(connector, stops[i]!, stops[j]!, timing, walkingSpeed, false));
        }
      }
      continue;
    }

    for (let i = 1; i < stops.length; i++) {
      const lower = stops[i - 1]!;
      const upper = stops[i]!;
      if (connector.type === "escalator" && connector.direction === "down") {
        edges.push(edgeBetween(connector, upper, lower, timing, walkingSpeed, true));
      } else {
        const oneWay = connector.type === "escalator" && connector.direction === "up";
        edges.push(edgeBetween(connector, lower, upper, timing, walkingSpeed, oneWay));
      }
    }
  }
  return edges;
}

/**
 * The full graph routing runs on: every floor's stored nodes and edges, edges
 * derived from connectors (with travel time), and the site's outdoor graph.
 * Rebuild it after the project changes.
 */
export function buildRoutingGraph(
  project: IndoorProject,
  options: RoutingGraphOptions = {},
): RoutingGraph {
  const nodes: NavigationNode[] = [];
  const edges: RoutingEdge[] = [];
  for (const building of project.buildings) {
    for (const floor of building.floors) {
      nodes.push(...floor.navigation.nodes);
      edges.push(...floorRoutingEdges(floor));
    }
    edges.push(...connectorRoutingEdges(building, options));
  }
  if (project.site) {
    nodes.push(...project.site.navigation.nodes);
    edges.push(...siteRoutingEdges(project));
  }
  return { nodes, edges };
}

/** Plan footprints a walk edge can't cross without climbing: stair/escalator elements and stair rooms. */
function climbFootprints(floor: Floor): Array<{ type: "stairs" | "escalator"; polygon: Point[] }> {
  const footprints: Array<{ type: "stairs" | "escalator"; polygon: Point[] }> = [];
  for (const element of floor.entrances) {
    if (element.type !== "stairs" && element.type !== "escalator") continue;
    // Same footprint the plan draws: `depth` along the climbing direction, `width` across it.
    const depth = element.depth ?? 4,
      width = element.width ?? 1.2;
    const angle = ((element.rotation ?? 0) * Math.PI) / 180;
    const ux = Math.cos(angle),
      uy = Math.sin(angle);
    const corner = (along: number, across: number) => ({
      x: element.position.x + ux * along - uy * across,
      y: element.position.y + uy * along + ux * across,
    });
    footprints.push({
      type: element.type,
      polygon: [
        corner(-depth / 2, -width / 2),
        corner(depth / 2, -width / 2),
        corner(depth / 2, width / 2),
        corner(-depth / 2, width / 2),
      ],
    });
  }
  for (const space of floor.spaces)
    if (space.type === "stairs" && space.polygon.length >= 3)
      footprints.push({ type: "stairs", polygon: space.polygon });
  return footprints;
}

/** Sample spacing (m) when testing whether an edge runs through a footprint. */
const CROSSING_SAMPLE_M = 0.1;

/**
 * A floor's stored edges as routing sees them. Paths are usually drawn as
 * plain "walk" edges even where they run over a staircase, which made the
 * "avoid stairs" / "accessible only" options do nothing. An edge that runs
 * through a stair (or escalator) footprint — or joins two stair nodes — is
 * routed as that type and as not step-free. Edges already typed, or marked
 * by hand, keep their stored values.
 */
export function floorRoutingEdges(floor: Floor): NavigationEdge[] {
  const footprints = climbFootprints(floor);
  const nodesById = new Map(floor.navigation.nodes.map((n) => [n.id, n]));
  return floor.navigation.edges.map((edge) => {
    if (edge.type !== "walk") return edge;
    const a = nodesById.get(edge.from),
      b = nodesById.get(edge.to);
    if (!a || !b) return edge;
    let climb: "stairs" | "escalator" | null =
      a.type === "stairs" && b.type === "stairs" ? "stairs" : null;
    if (!climb && footprints.length) {
      const steps = Math.max(2, Math.ceil(distance(a.position, b.position) / CROSSING_SAMPLE_M));
      // Interior samples only: an edge that merely ends at the stair foot isn't a climb.
      for (let i = 1; i < steps && !climb; i++) {
        const t = i / steps;
        const p = {
          x: a.position.x + (b.position.x - a.position.x) * t,
          y: a.position.y + (b.position.y - a.position.y) * t,
        };
        climb = footprints.find((f) => isPointInPolygon(p, f.polygon))?.type ?? null;
      }
    }
    return climb ? { ...edge, type: climb, accessible: false } : edge;
  });
}

/**
 * Every navigation node's position in site coordinates: outdoor nodes as
 * stored, building nodes through their building's placement.
 */
function sitePositions(project: IndoorProject): Map<string, Point> {
  const positions = new Map<string, Point>();
  for (const building of project.buildings) {
    for (const floor of building.floors) {
      for (const node of floor.navigation.nodes)
        positions.set(node.id, buildingToSite(building, node.position));
    }
  }
  for (const node of project.site?.navigation.nodes ?? []) positions.set(node.id, node.position);
  return positions;
}

/**
 * The site graph's edges with every link between an outdoor node and a
 * building node re-measured from the current geometry. Moving or rotating a
 * building changes where its entrances sit in the site frame, so the length
 * stored when the link was made goes stale; routing must use the live one.
 * Outdoor↔outdoor edges keep their stored distance (it may be a deliberate
 * path length). Edges whose endpoints don't resolve are passed through
 * unchanged (validateProject reports them).
 */
export function siteRoutingEdges(project: IndoorProject): NavigationEdge[] {
  const site = project.site;
  if (!site) return [];
  const outdoor = new Set(site.navigation.nodes.map((n) => n.id));
  let positions: Map<string, Point> | null = null;
  return site.navigation.edges.map((edge) => {
    if (outdoor.has(edge.from) && outdoor.has(edge.to)) return edge;
    positions ??= sitePositions(project);
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return edge;
    const length = distance(from, to);
    return length === edge.distance ? edge : { ...edge, distance: length };
  });
}
