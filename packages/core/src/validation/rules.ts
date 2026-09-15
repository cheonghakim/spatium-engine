import { createId } from "../id.js";
import { isPolygonSelfIntersecting } from "../geometry/polygon.js";
import type { Floor } from "../types/project.js";
import type { ValidationIssue } from "./types.js";

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

  return issues;
}

export function validateEntrances(floor: Floor): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const spaceIds = new Set(floor.spaces.map((s) => s.id));

  for (const entrance of floor.entrances) {
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
    if (!hasA && !hasB) {
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

export function validateNavigation(floor: Floor): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { nodes, edges } = floor.navigation;
  const nodeIds = new Set(nodes.map((n) => n.id));
  const connectedNodeIds = new Set<string>();

  for (const edge of edges) {
    const fromOk = nodeIds.has(edge.from);
    const toOk = nodeIds.has(edge.to);

    if (!fromOk || !toOk) {
      issues.push(
        issue(
          "error",
          "broken-navigation-edge",
          `Navigation edge ${edge.id} references a missing node (${!fromOk ? edge.from : edge.to}).`,
          edge.id,
        ),
      );
      continue;
    }

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
