import { createId } from "../id.js";
import type { Connector, ConnectorType } from "../types/connector.js";
import type { NavigationEdge, NavigationEdgeType } from "../types/navigation.js";
import type { Building, IndoorProject } from "../types/project.js";
import type { ValidationIssue } from "./types.js";

/**
 * Project-level rules for the schema 1.1.0 structures: connectors, the site
 * graph, and externalId uniqueness. Per-floor geometry rules live in rules.ts.
 */

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

const EDGE_TYPE_FOR_CONNECTOR: Record<ConnectorType, NavigationEdgeType> = {
  elevator: "elevator",
  stairs: "stairs",
  escalator: "escalator",
  ramp: "walk",
};

/** Stops whose floor and node actually exist in the building. */
function resolvableStops(building: Building, connector: Connector): Connector["stops"] {
  return connector.stops.filter((stop) => {
    const floor = building.floors.find((f) => f.id === stop.floorId);
    return floor?.navigation.nodes.some((n) => n.id === stop.nodeId) ?? false;
  });
}

/**
 * Placeholder edges linking each connector's resolvable stops, for
 * **connectivity checks only** (so connector-served nodes and floors aren't
 * reported as disconnected). Distances are 0 — real routing edges with travel
 * cost are derived separately for pathfinding.
 */
export function connectorConnectivityEdges(building: Building): NavigationEdge[] {
  const edges: NavigationEdge[] = [];
  for (const connector of building.connectors ?? []) {
    const stops = resolvableStops(building, connector);
    for (let i = 1; i < stops.length; i++) {
      edges.push({
        id: `${connector.id}:${i}`,
        from: (stops[i - 1] as Connector["stops"][number]).nodeId,
        to: (stops[i] as Connector["stops"][number]).nodeId,
        type: EDGE_TYPE_FOR_CONNECTOR[connector.type],
        distance: 0,
        accessible: connector.accessible,
      });
    }
  }
  return edges;
}

export function validateConnectors(building: Building): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const connector of building.connectors ?? []) {
    const label = connector.name ?? connector.id;

    if (connector.stops.length < 2) {
      issues.push(
        issue(
          "warning",
          "connector-too-few-stops",
          `Connector "${label}" has fewer than two stops, so it doesn't connect any floors.`,
          connector.id,
        ),
      );
    }

    const seenFloors = new Set<string>();
    for (const stop of connector.stops) {
      if (seenFloors.has(stop.floorId)) {
        issues.push(
          issue(
            "warning",
            "connector-duplicate-floor",
            `Connector "${label}" stops on floor ${stop.floorId} more than once.`,
            connector.id,
          ),
        );
      }
      seenFloors.add(stop.floorId);

      const floor = building.floors.find((f) => f.id === stop.floorId);
      if (!floor) {
        issues.push(
          issue(
            "error",
            "connector-missing-floor",
            `Connector "${label}" has a stop on floor ${stop.floorId}, which doesn't exist in building "${building.name}".`,
            connector.id,
          ),
        );
        continue;
      }
      if (!floor.navigation.nodes.some((n) => n.id === stop.nodeId)) {
        issues.push(
          issue(
            "error",
            "connector-missing-node",
            `Connector "${label}" stop on floor "${floor.name}" references missing navigation node ${stop.nodeId}.`,
            connector.id,
          ),
        );
      }
      if (stop.spaceId !== undefined && !floor.spaces.some((s) => s.id === stop.spaceId)) {
        issues.push(
          issue(
            "warning",
            "connector-missing-space",
            `Connector "${label}" stop on floor "${floor.name}" references missing space ${stop.spaceId}.`,
            connector.id,
          ),
        );
      }
    }
  }
  return issues;
}

/** Every navigation node in the project — building floors and the site graph. */
function allNodeIds(project: IndoorProject): Set<string> {
  const ids = new Set<string>();
  for (const building of project.buildings) {
    for (const floor of building.floors) {
      for (const node of floor.navigation.nodes) ids.add(node.id);
    }
  }
  for (const node of project.site?.navigation.nodes ?? []) ids.add(node.id);
  return ids;
}

export function validateSite(project: IndoorProject): ValidationIssue[] {
  const { site } = project;
  if (!site) return [];
  const issues: ValidationIssue[] = [];

  for (const node of site.navigation.nodes) {
    if (node.floorId !== site.id) {
      issues.push(
        issue(
          "error",
          "site-node-wrong-plane",
          `Outdoor navigation node ${node.id} must use the site id as its floorId (found ${node.floorId}).`,
          node.id,
        ),
      );
    }
  }

  const nodeIds = allNodeIds(project);
  for (const edge of site.navigation.edges) {
    const missing = !nodeIds.has(edge.from) ? edge.from : !nodeIds.has(edge.to) ? edge.to : null;
    if (missing !== null) {
      issues.push(
        issue(
          "error",
          "broken-navigation-edge",
          `Navigation edge ${edge.id} references a missing node (${missing}).`,
          edge.id,
        ),
      );
    }
  }
  return issues;
}

/** externalId is the join key for bulk updates from customer systems, so it must be unique. */
export function validateExternalIds(project: IndoorProject): ValidationIssue[] {
  const owners = new Map<string, string[]>();
  const record = (externalId: string | undefined, objectId: string): void => {
    if (externalId === undefined || externalId === "") return;
    const list = owners.get(externalId);
    if (list) list.push(objectId);
    else owners.set(externalId, [objectId]);
  };

  if (project.site) record(project.site.externalId, project.site.id);
  for (const building of project.buildings) {
    record(building.externalId, building.id);
    for (const connector of building.connectors ?? []) record(connector.externalId, connector.id);
    for (const floor of building.floors) {
      record(floor.externalId, floor.id);
      for (const space of floor.spaces) record(space.properties.externalId, space.id);
      for (const poi of floor.pois) record(poi.externalId, poi.id);
    }
  }

  const issues: ValidationIssue[] = [];
  for (const [externalId, objectIds] of owners) {
    if (objectIds.length <= 1) continue;
    for (const objectId of objectIds) {
      issues.push(
        issue(
          "warning",
          "duplicate-external-id",
          `External id "${externalId}" is used by ${objectIds.length} objects; it must be unique.`,
          objectId,
        ),
      );
    }
  }
  return issues;
}

/**
 * A hand-drawn cross-floor edge (schema 1.0.0 style) whose two nodes are
 * also stops of the same connector duplicates that connector's route — the
 * connector wins on cost, but the leftover edge can still be taken with a
 * walking-speed cost and keeps the old wiring around after the connector is
 * edited. Convert or delete it.
 */
export function validateFloorLinkDuplicates(building: Building): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const floorOf = new Map<string, string>();
  for (const floor of building.floors) {
    for (const node of floor.navigation.nodes) floorOf.set(node.id, floor.id);
  }
  const stopSets = (building.connectors ?? []).map((connector) => ({
    connector,
    nodes: new Set(connector.stops.map((stop) => stop.nodeId)),
  }));
  for (const floor of building.floors) {
    for (const edge of floor.navigation.edges) {
      const a = floorOf.get(edge.from);
      const b = floorOf.get(edge.to);
      if (!a || !b || a === b) continue;
      const shared = stopSets.find((s) => s.nodes.has(edge.from) && s.nodes.has(edge.to));
      if (shared) {
        issues.push(
          issue(
            "warning",
            "duplicate-floor-link",
            `Cross-floor edge "${edge.id}" duplicates connector "${shared.connector.name ?? shared.connector.id}".`,
            edge.id,
          ),
        );
      }
    }
  }
  return issues;
}
