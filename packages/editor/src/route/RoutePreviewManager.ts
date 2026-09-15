import {
  findShortestPath,
  mergeProjectNavigationGraph,
  type IndoorProject,
  type PathfindingOptions,
  type PathResult,
} from "@indoor/core";

export interface RoutePreviewState {
  startNodeId: string;
  endNodeId: string;
  options: PathfindingOptions;
  result: PathResult | null;
}

/**
 * Editor-time route preview: runs core's A* over the whole project's merged
 * navigation graph (routing can cross floors) so map authors can verify their
 * graph works before Builder/Runtime exist. Not part of the domain data —
 * nothing here is saved with the project.
 */
export class RoutePreviewManager {
  private state: RoutePreviewState | null = null;

  constructor(
    private readonly getProject: () => IndoorProject,
    private readonly onChange: () => void,
  ) {}

  get current(): RoutePreviewState | null {
    return this.state;
  }

  compute(startNodeId: string, endNodeId: string, options: PathfindingOptions = {}): void {
    const graph = mergeProjectNavigationGraph(this.getProject());
    const result = findShortestPath(graph, startNodeId, endNodeId, options);
    this.state = { startNodeId, endNodeId, options, result };
    this.onChange();
  }

  clear(): void {
    if (!this.state) return;
    this.state = null;
    this.onChange();
  }
}
