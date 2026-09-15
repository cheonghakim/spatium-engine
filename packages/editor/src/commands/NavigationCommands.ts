import type { Floor, NavigationEdge, NavigationNode } from "@indoor/core";
import type { Command } from "./Command.js";

export class AddNavigationNodeCommand implements Command {
  readonly label = "Add Navigation Node";

  constructor(
    private readonly floor: Floor,
    private readonly node: NavigationNode,
  ) {}

  execute(): void {
    this.floor.navigation.nodes.push(this.node);
  }

  undo(): void {
    const index = this.floor.navigation.nodes.findIndex((n) => n.id === this.node.id);
    if (index !== -1) this.floor.navigation.nodes.splice(index, 1);
  }
}

export class DeleteNavigationNodeCommand implements Command {
  readonly label = "Delete Navigation Node";

  private removedIndex = -1;
  private removedNode: NavigationNode | undefined;

  constructor(
    private readonly floor: Floor,
    private readonly nodeId: string,
  ) {}

  execute(): void {
    const index = this.floor.navigation.nodes.findIndex((n) => n.id === this.nodeId);
    if (index === -1) return;
    this.removedIndex = index;
    this.removedNode = this.floor.navigation.nodes[index];
    this.floor.navigation.nodes.splice(index, 1);
  }

  undo(): void {
    if (this.removedNode !== undefined && this.removedIndex !== -1) {
      this.floor.navigation.nodes.splice(this.removedIndex, 0, this.removedNode);
    }
  }
}

export class AddNavigationEdgeCommand implements Command {
  readonly label = "Add Navigation Edge";

  constructor(
    private readonly floor: Floor,
    private readonly edge: NavigationEdge,
  ) {}

  execute(): void {
    this.floor.navigation.edges.push(this.edge);
  }

  undo(): void {
    const index = this.floor.navigation.edges.findIndex((e) => e.id === this.edge.id);
    if (index !== -1) this.floor.navigation.edges.splice(index, 1);
  }
}

export class DeleteNavigationEdgeCommand implements Command {
  readonly label = "Delete Navigation Edge";

  private removedIndex = -1;
  private removedEdge: NavigationEdge | undefined;

  constructor(
    private readonly floor: Floor,
    private readonly edgeId: string,
  ) {}

  execute(): void {
    const index = this.floor.navigation.edges.findIndex((e) => e.id === this.edgeId);
    if (index === -1) return;
    this.removedIndex = index;
    this.removedEdge = this.floor.navigation.edges[index];
    this.floor.navigation.edges.splice(index, 1);
  }

  undo(): void {
    if (this.removedEdge !== undefined && this.removedIndex !== -1) {
      this.floor.navigation.edges.splice(this.removedIndex, 0, this.removedEdge);
    }
  }
}
