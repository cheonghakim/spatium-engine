import { createNavigationEdge, createNavigationNode, distance } from "@indoor/core";
import {
  AddNavigationEdgeCommand,
  AddNavigationNodeCommand,
} from "../commands/NavigationCommands.js";
import type { EditorTool, EditorKeyboardEvent, EditorPointerEvent } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

const HIT_RADIUS_PX = 12;

/**
 * Combined node-placement + connection tool (merges NavigationNodeTool and
 * NavigationEdgeTool into one fluid path-drawing interaction for Studio's
 * toolbar): click empty canvas to place a node — if a node is already
 * pending, an edge is also drawn from it to the new node, so a route chain
 * can be drawn with repeated clicks. Click an existing node to set it
 * pending (or, with a pending node already set, connect to it and make the
 * clicked node the new pending node, continuing the chain). Click the
 * pending node again to cancel it. Escape also cancels. Holding Shift while
 * placing a new node constrains it horizontally/vertically relative to the
 * pending node, matching WallTool's Shift convention.
 *
 * NavigationNodeTool/NavigationEdgeTool remain separately registered and
 * unchanged for API/back-compat — this tool only adds a friendlier combined
 * entry point on top of the same commands.
 */
export class NavigationTool implements EditorTool {
  readonly id = "navigation";

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
    const hitNode = floor.navigation.nodes.find(
      (n) => distance(event.worldPoint, n.position) <= hitRadiusWorld,
    );

    if (hitNode) {
      if (!this.fromNodeId) {
        this.fromNodeId = hitNode.id;
        this.context.selection.select(hitNode.id);
        this.context.requestRender();
        return;
      }

      if (hitNode.id === this.fromNodeId) {
        this.fromNodeId = null;
        this.context.requestRender();
        return;
      }

      const fromNode = floor.navigation.nodes.find((n) => n.id === this.fromNodeId);
      this.fromNodeId = null;
      if (!fromNode) return;

      const edge = createNavigationEdge(
        fromNode.id,
        hitNode.id,
        distance(fromNode.position, hitNode.position),
      );
      this.context.executeCommand(new AddNavigationEdgeCommand(floor, edge));
      this.context.selection.select(edge.id);
      this.fromNodeId = hitNode.id;
      return;
    }

    let point = this.context.snapping.resolve(event.worldPoint, { floor });
    if (event.shiftKey && this.fromNodeId) {
      const anchor = floor.navigation.nodes.find((n) => n.id === this.fromNodeId)?.position;
      if (anchor) {
        point =
          Math.abs(point.x - anchor.x) > Math.abs(point.y - anchor.y)
            ? { x: point.x, y: anchor.y }
            : { x: anchor.x, y: point.y };
      }
    }
    const node = createNavigationNode(
      floor.id,
      point,
      "normal",
      `노드 ${floor.navigation.nodes.length + 1}`,
    );
    this.context.executeCommand(new AddNavigationNodeCommand(floor, node));
    this.context.selection.select(node.id);

    if (this.fromNodeId) {
      const fromNode = floor.navigation.nodes.find((n) => n.id === this.fromNodeId);
      if (fromNode) {
        const edge = createNavigationEdge(
          fromNode.id,
          node.id,
          distance(fromNode.position, node.position),
        );
        this.context.executeCommand(new AddNavigationEdgeCommand(floor, edge));
      }
    }
    this.fromNodeId = node.id;
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
