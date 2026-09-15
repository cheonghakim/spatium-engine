import type { Point } from "@indoor/core";
import type { EditorTool, EditorPointerEvent } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

export class PanTool implements EditorTool {
  readonly id = "pan";

  private dragging = false;
  private lastScreenPoint: Point | null = null;

  constructor(private readonly context: ToolContext) {}

  activate(): void {}

  deactivate(): void {
    this.dragging = false;
    this.lastScreenPoint = null;
  }

  onPointerDown(event: EditorPointerEvent): void {
    this.dragging = true;
    this.lastScreenPoint = event.screenPoint;
  }

  onPointerMove(event: EditorPointerEvent): void {
    if (!this.dragging || !this.lastScreenPoint) return;
    const delta: Point = {
      x: event.screenPoint.x - this.lastScreenPoint.x,
      y: event.screenPoint.y - this.lastScreenPoint.y,
    };
    this.context.camera.panByScreenDelta(delta);
    this.lastScreenPoint = event.screenPoint;
    this.context.requestRender();
  }

  onPointerUp(): void {
    this.dragging = false;
    this.lastScreenPoint = null;
  }
}
