import type { Point } from "./common.js";

export type NavigationNodeType = "normal" | "junction" | "entrance" | "stairs" | "elevator";

export interface NavigationNode {
  id: string;
  floorId: string;

  position: Point;

  type: NavigationNodeType;

  /** User-assigned label (e.g. "정문", "동쪽 계단") so nodes are recognizable anywhere they're listed — falls back to type + id when unset. */
  name?: string;
}

export type NavigationEdgeType = "walk" | "stairs" | "elevator" | "escalator";

export interface NavigationEdge {
  id: string;

  from: string;
  to: string;

  type: NavigationEdgeType;

  distance: number;

  accessible: boolean;

  /** Traversable only from `from` to `to` (e.g. an escalator). Unset = both ways. */
  oneWay?: boolean;
}

export interface NavigationGraph {
  nodes: NavigationNode[];
  edges: NavigationEdge[];
}
