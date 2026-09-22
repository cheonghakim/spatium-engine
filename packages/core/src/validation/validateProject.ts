import { createId } from "../id.js";
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

function validateFloorConnections(building: Building): ValidationIssue[] {
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
  for (const floor of building.floors) {
    for (const edge of floor.navigation.edges) {
      if (edge.type !== "stairs" && edge.type !== "elevator" && edge.type !== "escalator") {
        continue;
      }
      const fromFloor = nodeIdToFloorId.get(edge.from);
      const toFloor = nodeIdToFloorId.get(edge.to);
      if (fromFloor && toFloor && fromFloor !== toFloor) {
        connectedFloorIds.add(fromFloor);
        connectedFloorIds.add(toFloor);
      }
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
        message: `Floor "${floor.name}" has no vertical navigation edge (stairs/elevator/escalator) linking it to another floor.`,
      });
    }
  }
  return issues;
}

export function validateProject(project: IndoorProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const building of project.buildings) {
    const buildingNodes = building.floors.flatMap((f) => f.navigation.nodes);
    const buildingEdges = building.floors.flatMap((f) => f.navigation.edges);

    for (const floor of building.floors) {
      issues.push(...validateSpaces(floor));
      issues.push(...validateWalls(floor));
      issues.push(...validateEntrances(floor));
      issues.push(...validatePOIs(floor));
      issues.push(...validateFurniture(floor));
      issues.push(...validateGroups(floor));
      issues.push(...validateNavigation(floor, buildingNodes, buildingEdges));
    }
    issues.push(...validateFloorConnections(building));
  }

  return issues;
}
