import { createWall, type Point } from "@indoor/core";
import { AddWallCommand } from "../commands/WallCommands.js";
import type { EditorTool, EditorKeyboardEvent, EditorPointerEvent } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

/**
 * click -> place the first point, click again -> add a wall segment and chain
 * the next one from that same point. Escape cancels the pending chain.
 */
export class WallTool implements EditorTool {
  readonly id = "wall";

  private pendingStart: Point | null = null;

  constructor(private readonly context: ToolContext) {}

  activate(): void {
    this.pendingStart = null;
  }

  deactivate(): void {
    this.pendingStart = null;
  }

  getPendingStart(): Point | null {
    return this.pendingStart;
  }

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const floor = this.context.getActiveFloor();
    if (!floor) return;

    const point = this.context.snapping.resolve(
      event.worldPoint,
      this.pendingStart ? { floor, referencePoint: this.pendingStart } : { floor },
    );

    if (!this.pendingStart) {
      this.pendingStart = point;
      this.context.requestRender();
      return;
    }

    const wall = createWall(floor.id, this.pendingStart, point);
    this.context.executeCommand(new AddWallCommand(floor, wall));
    this.context.selection.select(wall.id);
    this.pendingStart = point;
  }

  onPointerMove(): void {}
  onPointerUp(): void {}

  onKeyDown(event: EditorKeyboardEvent): void {
    if (event.key === "Escape") {
      this.pendingStart = null;
      this.context.requestRender();
    }
  }
}
