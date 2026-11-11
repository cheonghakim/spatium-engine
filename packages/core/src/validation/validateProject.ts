import { createId } from "../id.js";
import type { NavigationEdge } from "../types/navigation.js";
import type { Building, IndoorProject } from "../types/project.js";
import type { ValidationIssue } from "./types.js";
import {
  validateEntrances,
  validateFurniture,
  validateGroups,
  validatePOIs,
  validateNavigation,
  validateSpaces,
  validateWalls,
} from "./rules.js";
import {
  connectorConnectivityEdges,
  validateConnectors,
  validateFloorLinkDuplicates,
  validateExternalIds,
  validateSite,
} from "./structure.js";

function validateFloorConnections(
  building: Building,
  connectorEdges: NavigationEdge[],
): ValidationIssue[] {
  if (building.floors.length < 2) return [];

  const floorIdToNodeIds = new Map<string, Set<string>>();
  const nodeIdToFloorId = new Map<string, string>();

  for (const floor of building.floors) {
    floorIdToNodeIds.set(floor.id, new Set());
    for (const node of floor.navigation.nodes) {
      nodeIdToFloorId.set(node.id, floor.id);
    }
  }

  const connectedFloorIds = new Set<string>();
  // Connector-derived links count as vertical connections even when their
  // type is "walk" (ramps): crossing floors is what matters here.
  const verticalEdges = [
    ...building.floors.flatMap((f) =>
      f.navigation.edges.filter(
        (e) => e.type === "stairs" || e.type === "elevator" || e.type === "escalator",
      ),
    ),
    ...connectorEdges,
  ];
  for (const edge of verticalEdges) {
    const fromFloor = nodeIdToFloorId.get(edge.from);
    const toFloor = nodeIdToFloorId.get(edge.to);
    if (fromFloor && toFloor && fromFloor !== toFloor) {
      connectedFloorIds.add(fromFloor);
      connectedFloorIds.add(toFloor);
    }
  }

  const issues: ValidationIssue[] = [];
  for (const floor of building.floors) {
    if (!connectedFloorIds.has(floor.id)) {
      issues.push({
        id: createId(),
        severity: "warning",
        type: "missing-floor-connection",
        objectId: floor.id,
        message: `Floor "${floor.name}" has no vertical navigation edge or connector (stairs/elevator/escalator/ramp) linking it to another floor.`,
      });
    }
  }
  return issues;
}

export function validateProject(project: IndoorProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Edges that make a node "connected" without being stored on its floor:
  // connector links between stops, and site edges reaching into buildings.
  // Site nodes must be resolvable too, or validateNavigation skips a site
  // edge (unknown endpoint) and the building node it reaches looks isolated.
  const siteEdges = project.site?.navigation.edges ?? [];
  const siteNodes = project.site?.navigation.nodes ?? [];

  for (const building of project.buildings) {
    const buildingNodes = [...building.floors.flatMap((f) => f.navigation.nodes), ...siteNodes];
    const connectorEdges = connectorConnectivityEdges(building);
    const buildingEdges = [
      ...building.floors.flatMap((f) => f.navigation.edges),
      ...connectorEdges,
      ...siteEdges,
    ];

    for (const floor of building.floors) {
      issues.push(...validateSpaces(floor));
      issues.push(...validateWalls(floor));
      issues.push(...validateEntrances(floor));
      issues.push(...validatePOIs(floor));
      issues.push(...validateFurniture(floor));
      issues.push(...validateGroups(floor));
      issues.push(...validateNavigation(floor, buildingNodes, buildingEdges));
    }
    issues.push(...validateFloorConnections(building, connectorEdges));
    issues.push(...validateConnectors(building));
    issues.push(...validateFloorLinkDuplicates(building));
  }
  issues.push(...validateSite(project));
  issues.push(...validateExternalIds(project));

  return issues;
}
