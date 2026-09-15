import { createNavigationNode } from "@indoor/core";
import { AddNavigationNodeCommand } from "../commands/NavigationCommands.js";
import type { EditorTool, EditorPointerEvent } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

/** Click places a navigation node (type "normal" by default, editable afterward). */
export class NavigationNodeTool implements EditorTool {
  readonly id = "navigation-node";

  constructor(private readonly context: ToolContext) {}

  activate(): void {}
  deactivate(): void {}

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const floor = this.context.getActiveFloor();
    if (!floor) return;

    const point = this.context.snapping.resolve(event.worldPoint, { floor });
    const node = createNavigationNode(floor.id, point, "normal");

    this.context.executeCommand(new AddNavigationNodeCommand(floor, node));
    this.context.selection.select(node.id);
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
}
