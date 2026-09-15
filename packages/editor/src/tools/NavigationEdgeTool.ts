import { createNavigationEdge, distance } from "@indoor/core";
import { AddNavigationEdgeCommand } from "../commands/NavigationCommands.js";
import type { EditorTool, EditorKeyboardEvent, EditorPointerEvent } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

const HIT_RADIUS_PX = 12;

/**
 * Click an existing navigation node to start, click a second one to connect
 * them. Only links existing nodes — place them with the Node tool first.
 * distance is computed automatically from the two nodes' positions.
 */
export class NavigationEdgeTool implements EditorTool {
  readonly id = "navigation-edge";

  private fromNodeId: string | null = null;

  constructor(private readonly context: ToolContext) {}

  activate(): void {
    this.fromNodeId = null;
  }

  deactivate(): void {
    this.fromNodeId = null;
  }

  getPendingNodeId(): string | null {
    return this.fromNodeId;
  }

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const floor = this.context.getActiveFloor();
    if (!floor) return;

    const hitRadiusWorld = HIT_RADIUS_PX / this.context.camera.getState().zoom;
    const node = floor.navigation.nodes.find(
      (n) => distance(event.worldPoint, n.position) <= hitRadiusWorld,
    );
    if (!node) return;

    if (!this.fromNodeId) {
      this.fromNodeId = node.id;
      this.context.selection.select(node.id);
      this.context.requestRender();
      return;
    }

    if (node.id === this.fromNodeId) {
      this.fromNodeId = null;
      this.context.requestRender();
      return;
    }

    const fromNode = floor.navigation.nodes.find((n) => n.id === this.fromNodeId);
    if (!fromNode) {
      this.fromNodeId = null;
      return;
    }

    const edge = createNavigationEdge(fromNode.id, node.id, distance(fromNode.position, node.position));
    this.context.executeCommand(new AddNavigationEdgeCommand(floor, edge));
    this.context.selection.select(edge.id);
    this.fromNodeId = null;
  }

  onPointerMove(): void {}
  onPointerUp(): void {}

  onKeyDown(event: EditorKeyboardEvent): void {
    if (event.key === "Escape") {
      this.fromNodeId = null;
      this.context.requestRender();
    }
  }
}
