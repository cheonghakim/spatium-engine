import {
  buildRoutingGraph,
  findRoute,
  resolveRouteEndpoint,
  type IndoorProject,
  type PathfindingOptions,
  type PathResult,
  type RouteEndpoint,
} from "@indoor/core";

export interface RoutePreviewState {
  start: RouteEndpoint;
  end: RouteEndpoint;
  /** First/last node of the found route; the endpoint itself when it was a node id. */
  startNodeId: string;
  endNodeId: string;
  options: PathfindingOptions;
  result: PathResult | null;
}

function nodeIdOf(endpoint: RouteEndpoint): string {
  if (typeof endpoint === "string") return endpoint;
  return "nodeId" in endpoint ? endpoint.nodeId : "";
}

/**
 * Editor-time route preview: runs core's routing over the whole project's
 * graph (routing can cross floors, ride connectors, start or end at a POI or
 * space) so map authors can verify their graph before Builder/Runtime exist.
 * Not part of the domain data — nothing here is saved with the project.
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

  compute(start: RouteEndpoint, end: RouteEndpoint, options: PathfindingOptions = {}): void {
    // Rebuilt per call (not cached): the project is being edited live.
    const project = this.getProject();
    const graph = buildRoutingGraph(project, options);
    const result = findRoute(
      graph,
      resolveRouteEndpoint(project, start),
      resolveRouteEndpoint(project, end),
      options,
    );
    this.state = {
      start,
      end,
      startNodeId: result?.nodeIds[0] ?? nodeIdOf(start),
      endNodeId: result?.nodeIds.at(-1) ?? nodeIdOf(end),
      options,
      result,
    };
    this.onChange();
  }

  clear(): void {
    if (!this.state) return;
    this.state = null;
    this.onChange();
  }
}
