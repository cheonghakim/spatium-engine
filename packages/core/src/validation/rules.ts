import { createId } from "../id.js";
import { isPolygonSelfIntersecting, polygonsOverlap } from "../geometry/polygon.js";
import { distance } from "../geometry/distance.js";
import type { Floor } from "../types/project.js";
import type { Space } from "../types/space.js";
import type { NavigationEdge, NavigationNode } from "../types/navigation.js";
import type { ValidationIssue } from "./types.js";

/** Below this length (meters) a wall is considered degenerate. */
const MIN_WALL_LENGTH = 0.01;

/**
 * Tolerance for the navigation edge distance-sanity check: an edge's stored
 * `distance` is allowed to diverge from the true geometric distance between
 * its nodes by whichever is larger of a relative tolerance (20%) or a flat
 * tolerance (1m), before it's flagged. This keeps the check from firing on
 * ordinary rounding while still catching edges whose distance is clearly
 * stale or wrong.
 */
const EDGE_DISTANCE_RELATIVE_TOLERANCE = 0.2;
const EDGE_DISTANCE_MIN_TOLERANCE_METERS = 1;

function issue(
  severity: ValidationIssue["severity"],
  type: string,
  message: string,
  objectId?: string,
): ValidationIssue {
  return objectId !== undefined
    ? { id: createId(), severity, type, objectId, message }
    : { id: createId(), severity, type, message };
}

export function validateSpaces(floor: Floor): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const space of floor.spaces) {
    if (space.polygon.length < 3) {
      issues.push(
        issue(
          "error",
          "invalid-polygon",
          `Space "${space.properties.name ?? space.id}" has fewer than 3 vertices.`,
          space.id,
        ),
      );
      continue;
    }

    if (isPolygonSelfIntersecting(space.polygon)) {
      issues.push(
        issue(
          "error",
          "self-intersecting-polygon",
          `Space "${space.properties.name ?? space.id}" polygon self-intersects.`,
          space.id,
        ),
      );
    }

    if (space.type === "unknown") {
      issues.push(
        issue(
          "warning",
          "unknown-space-type",
          `Space "${space.properties.name ?? space.id}" has no assigned type.`,
          space.id,
        ),
      );
    }
  }

  for (let i = 0; i < floor.spaces.length; i++) {
    const spaceA = floor.spaces[i] as Space;
    if (spaceA.polygon.length < 3) continue;

    for (let j = i + 1; j < floor.spaces.length; j++) {
      const spaceB = floor.spaces[j] as Space;
      if (spaceB.polygon.length < 3) continue;

      if (polygonsOverlap(spaceA.polygon, spaceB.polygon)) {
        issues.push(
          issue(
            "error",
            "overlapping-spaces",
            `Space "${spaceA.properties.name ?? spaceA.id}" overlaps space "${spaceB.properties.name ?? spaceB.id}".`,
            spaceA.id,
          ),
        );
        issues.push(
          issue(
            "error",
            "overlapping-spaces",
            `Space "${spaceB.properties.name ?? spaceB.id}" overlaps space "${spaceA.properties.name ?? spaceA.id}".`,
            spaceB.id,
          ),
        );
      }
    }
  }

  return issues;
}

export function validateWalls(floor: Floor): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const wall of floor.walls) {
    if (distance(wall.start, wall.end) < MIN_WALL_LENGTH) {
      issues.push(
        issue("error", "degenerate-wall", `Wall ${wall.id} has zero or near-zero length.`, wall.id),
      );
    }

    if (wall.thickness <= 0) {
      issues.push(
        issue(
          "error",
          "invalid-wall-thickness",
          `Wall ${wall.id} has non-positive thickness.`,
          wall.id,
        ),
      );
    }
  }

  return issues;
}

export function validateEntrances(floor: Floor): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const spaceIds = new Set(floor.spaces.map((s) => s.id));

  for (const entrance of floor.entrances) {
    for (const key of ["width", "height", "depth", "stepCount"] as const) {
      const value = entrance[key];
      if (
        value !== undefined &&
        (!Number.isFinite(value) ||
          value <= 0 ||
          (key === "stepCount" && (!Number.isInteger(value) || value < 2 || value > 200)))
      ) {
        issues.push(
          issue(
            "error",
            "invalid-element-dimension",
            `Element ${entrance.id}: invalid ${key}.`,
            entrance.id,
          ),
        );
      }
    }
    for (const key of ["sillHeight", "landingDepth", "rotation", "doorOpenAngle"] as const) {
      const value = entrance[key];
      if (
        value !== undefined &&
        (!Number.isFinite(value) || (["sillHeight", "landingDepth"].includes(key) && value < 0))
      ) {
        issues.push(
          issue(
            "error",
            "invalid-element-dimension",
            `Element ${entrance.id}: invalid ${key}.`,
            entrance.id,
          ),
        );
      }
    }
    const wall = floor.walls.find((w) => w.id === entrance.wallId);
    if (entrance.wallId && !wall)
      issues.push(
        issue(
          "warning",
          "missing-host-wall",
          `Element ${entrance.id}: connected wall was removed.`,
          entrance.id,
        ),
      );
    if (
      wall &&
      (entrance.height ?? (entrance.type === "window" ? 1.2 : 2.1)) +
        (entrance.type === "window" ? (entrance.sillHeight ?? 0.9) : 0) >
        (wall.height ?? 2.4)
    ) {
      issues.push(
        issue(
          "warning",
          "opening-above-wall",
          `Element ${entrance.id}: opening exceeds wall height and will be clipped.`,
          entrance.id,
        ),
      );
    }
    const hasA = entrance.spaceA !== undefined;
    const hasB = entrance.spaceB !== undefined;

    if (hasA && !spaceIds.has(entrance.spaceA as string)) {
      issues.push(
        issue(
          "error",
          "disconnected-entrance",
          `Entrance ${entrance.id} references missing space "${entrance.spaceA}".`,
          entrance.id,
        ),
      );
    }
    if (hasB && !spaceIds.has(entrance.spaceB as string)) {
      issues.push(
        issue(
          "error",
          "disconnected-entrance",
          `Entrance ${entrance.id} references missing space "${entrance.spaceB}".`,
          entrance.id,
        ),
      );
    }
    if (!hasA && !hasB && entrance.type !== "window") {
      issues.push(
        issue(
          "warning",
          "disconnected-entrance",
          `Entrance ${entrance.id} is not connected to any space.`,
          entrance.id,
        ),
      );
    }
  }

  return issues;
}

export function validatePOIs(floor: Floor): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const spaceIds = new Set(floor.spaces.map((s) => s.id));

  for (const poi of floor.pois) {
    if (poi.spaceId !== undefined && !spaceIds.has(poi.spaceId)) {
      issues.push(
        issue(
          "error",
          "invalid-poi",
          `POI "${poi.name}" references missing space "${poi.spaceId}".`,
          poi.id,
        ),
      );
    }
  }

  return issues;
}

export function validateFurniture(floor: Floor): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const spaceIds = new Set(floor.spaces.map((s) => s.id));

  for (const item of floor.furniture) {
    if (item.spaceId !== undefined && !spaceIds.has(item.spaceId)) {
      issues.push(
        issue(
          "error",
          "invalid-furniture",
          `Furniture "${item.name ?? item.id}" references missing space "${item.spaceId}".`,
          item.id,
        ),
      );
    }
  }

  return issues;
}

/** Every id that currently exists on the floor, across every collection a Group can reference. */
function allObjectIds(floor: Floor): Set<string> {
  return new Set([
    ...floor.spaces.map((s) => s.id),
    ...floor.walls.map((w) => w.id),
    ...floor.entrances.map((e) => e.id),
    ...floor.pois.map((p) => p.id),
    ...floor.furniture.map((f) => f.id),
    ...floor.navigation.nodes.map((n) => n.id),
    ...floor.navigation.edges.map((e) => e.id),
  ]);
}

/**
 * Flags a group referencing a member id that no longer exists on the floor —
 * belt-and-suspenders on top of the delete-time cleanup in SelectTool's
 * buildDeleteCommand (which strips a deleted member from every group's
 * memberIds as part of the same undo step), catching drift from hand-edited
 * or corrupted project files instead.
 */
export function validateGroups(floor: Floor): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = allObjectIds(floor);

  for (const group of floor.groups) {
    for (const memberId of group.memberIds) {
      if (!ids.has(memberId)) {
        issues.push(
          issue(
            "warning",
            "dangling-group-member",
            `Group "${group.label}" references a missing object "${memberId}".`,
            group.id,
          ),
        );
      }
    }
  }

  return issues;
}

/**
 * Validates one floor's navigation graph.
 *
 * A stairs/elevator/escalator edge can legitimately reference a node that
 * lives on a *different* floor (see mergeGraph.ts) — the edge itself is
 * just stored in one floor's edge list. So both the "does this node exist"
 * check and the "is this node connected to anything" check need to see
 * every floor's nodes/edges, not just this floor's own — otherwise every
 * cross-floor edge gets wrongly flagged as broken, and the nodes at its
 * far end get wrongly flagged as disconnected. Callers (validateProject)
 * pass the whole building's nodes/edges for that reason.
 */
export function validateNavigation(
  floor: Floor,
  buildingNodes: NavigationNode[] = floor.navigation.nodes,
  buildingEdges: NavigationEdge[] = floor.navigation.edges,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { nodes, edges } = floor.navigation;
  const nodesById = new Map(buildingNodes.map((n) => [n.id, n]));

  for (const edge of edges) {
    const fromNode = nodesById.get(edge.from);
    const toNode = nodesById.get(edge.to);

    if (!fromNode || !toNode) {
      issues.push(
        issue(
          "error",
          "broken-navigation-edge",
          `Navigation edge ${edge.id} references a missing node (${!fromNode ? edge.from : edge.to}).`,
          edge.id,
        ),
      );
      continue;
    }

    if (fromNode.floorId === toNode.floorId) {
      const actualDistance = distance(fromNode.position, toNode.position);
      const tolerance = Math.max(
        actualDistance * EDGE_DISTANCE_RELATIVE_TOLERANCE,
        EDGE_DISTANCE_MIN_TOLERANCE_METERS,
      );
      if (Math.abs(edge.distance - actualDistance) > tolerance) {
        issues.push(
          issue(
            "warning",
            "inaccurate-edge-distance",
            `Navigation edge ${edge.id} distance (${edge.distance}) diverges from the geometric distance between its nodes (${actualDistance.toFixed(2)}).`,
            edge.id,
          ),
        );
      }
    }
  }

  const duplicateGroups = new Map<string, NavigationEdge[]>();
  for (const edge of edges) {
    const key = [edge.from, edge.to].sort().join("::");
    const group = duplicateGroups.get(key);
    if (group) group.push(edge);
    else duplicateGroups.set(key, [edge]);
  }
  for (const group of duplicateGroups.values()) {
    if (group.length <= 1) continue;
    for (const edge of group) {
      issues.push(
        issue(
          "warning",
          "duplicate-navigation-edge",
          `Navigation edge ${edge.id} duplicates another edge between the same two nodes (${edge.from} <-> ${edge.to}).`,
          edge.id,
        ),
      );
    }
  }

  const connectedNodeIds = new Set<string>();
  for (const edge of buildingEdges) {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) continue;
    connectedNodeIds.add(edge.from);
    connectedNodeIds.add(edge.to);
  }

  if (nodes.length > 1) {
    for (const node of nodes) {
      if (!connectedNodeIds.has(node.id)) {
        issues.push(
          issue(
            "warning",
            "disconnected-navigation-node",
            `Navigation node ${node.id} has no edges connecting it to the graph.`,
            node.id,
          ),
        );
      }
    }
  }

  return issues;
}
