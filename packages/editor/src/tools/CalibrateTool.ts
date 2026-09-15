import type { Point } from "@indoor/core";
import type { EditorTool, EditorPointerEvent } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

/**
 * Click two points on the reference image; once both are picked, hands them
 * off so the caller (Studio UI) can ask the user for the real-world distance
 * and apply it via ReferenceManager.calibrate(). This tool only measures —
 * it has no opinion about how the distance is collected.
 */
export class CalibrateTool implements EditorTool {
  readonly id = "calibrate";

  private points: Point[] = [];

  constructor(
    private readonly context: ToolContext,
    private readonly onPointsPicked: (a: Point, b: Point) => void,
  ) {}

  activate(): void {
    this.points = [];
  }

  deactivate(): void {
    this.points = [];
  }

  getPendingPoints(): readonly Point[] {
    return this.points;
  }

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    this.points.push(event.worldPoint);

    if (this.points.length === 2) {
      const [a, b] = this.points as [Point, Point];
      this.points = [];
      this.onPointsPicked(a, b);
    }
    this.context.requestRender();
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
}
