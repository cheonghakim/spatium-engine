import type { Point } from "./common.js";

export type NavigationNodeType = "normal" | "junction" | "entrance" | "stairs" | "elevator";

export interface NavigationNode {
  id: string;
  floorId: string;

  position: Point;

  type: NavigationNodeType;
}

export type NavigationEdgeType = "walk" | "stairs" | "elevator" | "escalator";

export interface NavigationEdge {
  id: string;

  from: string;
  to: string;

  type: NavigationEdgeType;

  distance: number;

  accessible: boolean;
}

export interface NavigationGraph {
  nodes: NavigationNode[];
  edges: NavigationEdge[];
}
