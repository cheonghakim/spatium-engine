import type { IndoorProject } from "../types/project.js";
import type { NavigationGraph } from "../types/navigation.js";

/**
 * Combines every floor's navigation graph in the project into one. Pathfinding
 * needs this: a stairs/elevator edge crossing floors lives in one floor's edge
 * list but references a node id from another, so routing can't work floor by floor.
 */
export function mergeProjectNavigationGraph(project: IndoorProject): NavigationGraph {
  const nodes: NavigationGraph["nodes"] = [];
  const edges: NavigationGraph["edges"] = [];

  for (const building of project.buildings) {
    for (const floor of building.floors) {
      nodes.push(...floor.navigation.nodes);
      edges.push(...floor.navigation.edges);
    }
  }

  return { nodes, edges };
}
