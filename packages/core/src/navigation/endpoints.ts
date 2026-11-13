import { distance, distanceToSegment } from "../geometry/distance.js";
import { segmentIntersection } from "../geometry/line.js";
import { isPointInSpace, polygonCentroid } from "../geometry/polygon.js";
import type { Point } from "../types/common.js";
import type { Entrance } from "../types/entrance.js";
import type { Wall } from "../types/wall.js";
import type { NavigationNode } from "../types/navigation.js";
import type { Building, IndoorProject } from "../types/project.js";
import type { Space } from "../types/space.js";
import type { RouteAnchor } from "./pathfinding.js";

/**
 * Where a route starts or ends. A bare string is a navigation node id, so
 * existing `startRoute(nodeA, nodeB)` calls keep working.
 */
export type RouteEndpoint =
  | string
  | { nodeId: string }
  | { poiId: string }
  | { spaceId: string }
  /** Any spot on a floor (or on the site plane, with floorId = site.id). */
  | { floorId: string; position: Point };

/** Nodes this close to a space's outline count as its doors. */
const DOOR_TOLERANCE = 0.5;

/** Crossings this close to either end of a walk segment are ignored (nodes often sit on a wall line). */
const END_TOLERANCE = 0.05;
const DEFAULT_PASSAGE_WIDTH = 0.9;

interface Plane {
  nodes: NavigationNode[];
  spaces: Space[];
  walls: Wall[];
  entrances: Entrance[];
  building: Building | null;
}

function planeOf(project: IndoorProject, floorId: string): Plane | null {
  if (project.site?.id === floorId) {
    const nodes = project.site.navigation.nodes;
    return { nodes, spaces: [], walls: [], entrances: [], building: null };
  }
  for (const building of project.buildings) {
    const floor = building.floors.find((f) => f.id === floorId);
    if (floor) {
      return {
        nodes: floor.navigation.nodes,
        spaces: floor.spaces,
        walls: floor.walls,
        entrances: floor.entrances,
        building,
      };
    }
  }
  return null;
}

/** True when `point` is within a passable entrance (not a window) on `wall`. */
function inDoorway(plane: Plane, wall: Wall, point: Point): boolean {
  return plane.entrances.some((entrance) => {
    if (entrance.type === "window") return false;
    const onWall =
      entrance.wallId === wall.id ||
      distanceToSegment(entrance.position, wall.start, wall.end).distance < 0.3;
    return (
      onWall &&
      distance(entrance.position, point) <= (entrance.width ?? DEFAULT_PASSAGE_WIDTH) / 2 + 0.05
    );
  });
}

/**
 * Whether walking straight from `a` to `b` would pass through a wall (outside
 * a doorway) or through one of the space's holes (a column, a void).
 */
function walkBlocked(plane: Plane, a: Point, b: Point, space: Space | undefined): boolean {
  const walk = { a, b };
  const nearEnd = (p: Point) => distance(p, a) <= END_TOLERANCE || distance(p, b) <= END_TOLERANCE;
  for (const wall of plane.walls) {
    const hit = segmentIntersection(walk, { a: wall.start, b: wall.end });
    if (hit && !nearEnd(hit) && !inDoorway(plane, wall, hit)) return true;
  }
  for (const hole of space?.holes ?? []) {
    for (let i = 0; i < hole.length; i++) {
      const hit = segmentIntersection(walk, { a: hole[i]!, b: hole[(i + 1) % hole.length]! });
      if (hit && !nearEnd(hit)) return true;
    }
  }
  return false;
}

function onOutline(space: Space, point: Point): boolean {
  const rings = [space.polygon, ...(space.holes ?? [])];
  return rings.some((ring) =>
    ring.some(
      (a, i) =>
        distanceToSegment(point, a, ring[(i + 1) % ring.length]!).distance <= DOOR_TOLERANCE,
    ),
  );
}

/** Nodes inside a space, on its outline (doors), or at a connector stop in it. */
function nodesOfSpace(plane: Plane, space: Space): NavigationNode[] {
  const stopNodes = new Set<string>();
  for (const connector of plane.building?.connectors ?? []) {
    for (const stop of connector.stops) {
      if (stop.spaceId === space.id) stopNodes.add(stop.nodeId);
    }
  }
  return plane.nodes.filter(
    (node) =>
      stopNodes.has(node.id) ||
      isPointInSpace(space, node.position) ||
      onOutline(space, node.position),
  );
}

function nearestNode(nodes: readonly NavigationNode[], point: Point): NavigationNode | null {
  let best: NavigationNode | null = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const d = distance(node.position, point);
    if (d < bestDistance) {
      best = node;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * Anchors for a spot on a plane: the nodes of the space it's in (plus the
 * walk to the spot), or failing that the nearest node on the plane. A node
 * only qualifies if walking straight from it to the spot crosses no wall
 * (outside a doorway) and no hole. When none qualifies the spot is
 * unreachable as mapped (often a missing door) and [] is returned — routing
 * then reports no route instead of walking through a wall.
 */
function anchorsAt(plane: Plane, point: Point, space: Space | undefined): RouteAnchor[] {
  const clear = (node: NavigationNode) => !walkBlocked(plane, node.position, point, space);
  const toAnchor = (node: NavigationNode): RouteAnchor => ({
    nodeId: node.id,
    distance: distance(node.position, point),
  });
  const reachable = (space ? nodesOfSpace(plane, space) : []).filter(clear);
  if (reachable.length > 0) return reachable.map(toAnchor);
  const nearest = nearestNode(plane.nodes.filter(clear), point);
  return nearest ? [toAnchor(nearest)] : [];
}

/**
 * Turns a route endpoint into candidate graph nodes for findRoute:
 *  - node id: that node.
 *  - POI: the nodes of its space (its spaceId, or the space it stands in),
 *    each with the walk to the POI; else the nearest node on its floor.
 *  - space: its nodes at no extra cost — inside, on the outline (doors) or a
 *    connector stop placed in it; else the nearest node to its centroid.
 *  - floor + position: like a POI at that position.
 * Returns [] when the endpoint doesn't exist, its floor has no nodes, or no
 * node can reach the spot without crossing a wall or hole.
 */
export function resolveRouteEndpoint(
  project: IndoorProject,
  endpoint: RouteEndpoint,
): RouteAnchor[] {
  if (typeof endpoint === "string") return [{ nodeId: endpoint }];
  if ("nodeId" in endpoint) return [{ nodeId: endpoint.nodeId }];

  if ("position" in endpoint) {
    const plane = planeOf(project, endpoint.floorId);
    if (!plane) return [];
    const space = plane.spaces.find((s) => isPointInSpace(s, endpoint.position));
    return anchorsAt(plane, endpoint.position, space);
  }

  for (const building of project.buildings) {
    for (const floor of building.floors) {
      const plane: Plane = {
        nodes: floor.navigation.nodes,
        spaces: floor.spaces,
        walls: floor.walls,
        entrances: floor.entrances,
        building,
      };
      if ("poiId" in endpoint) {
        const poi = floor.pois.find((p) => p.id === endpoint.poiId);
        if (!poi) continue;
        const space =
          floor.spaces.find((s) => s.id === poi.spaceId) ??
          floor.spaces.find((s) => isPointInSpace(s, poi.position));
        return anchorsAt(plane, poi.position, space);
      }
      const space = floor.spaces.find((s) => s.id === endpoint.spaceId);
      if (!space) continue;
      const own = nodesOfSpace(plane, space);
      if (own.length > 0) return own.map((node) => ({ nodeId: node.id }));
      return anchorsAt(plane, polygonCentroid(space.polygon), undefined);
    }
  }
  return [];
}
