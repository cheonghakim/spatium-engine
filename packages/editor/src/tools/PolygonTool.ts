import { createSpace, distance, type Point } from "@indoor/core";
import { AddSpaceCommand } from "../commands/SpaceCommands.js";
import type { EditorTool, EditorKeyboardEvent, EditorPointerEvent } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

const CLOSE_LOOP_RADIUS_PX = 10;
/** Below this length a new vertex is considered a stray/duplicate click rather than an intentional zero-length edge. */
const MIN_SEGMENT_LENGTH_METERS = 0.01;

/**
 * click -> add vertex, click on first vertex or Enter -> finish (creates a
 * Space via AddSpaceCommand), Escape -> cancel, Backspace -> drop last vertex.
 */
export class PolygonTool implements EditorTool {
  readonly id = "polygon";

  private draftPoints: Point[] = [];

  constructor(private readonly context: ToolContext) {}

  activate(): void {
    this.draftPoints = [];
  }

  deactivate(): void {
    this.draftPoints = [];
  }

  getDraftPoints(): readonly Point[] {
    return this.draftPoints;
  }

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const floor = this.context.getActiveFloor();
    if (!floor) return;

    const first = this.draftPoints[0];
    if (first && this.draftPoints.length >= 3) {
      const closeRadiusWorld = CLOSE_LOOP_RADIUS_PX / this.context.camera.getState().zoom;
      if (distance(event.worldPoint, first) <= closeRadiusWorld) {
        this.finish(floor.id);
        return;
      }
    }

    const previous = this.draftPoints[this.draftPoints.length - 1];
    const snapped = this.context.snapping.resolve(
      event.worldPoint,
      previous ? { floor, referencePoint: previous } : { floor },
    );

    // Ignore a click that lands right back on the previous vertex instead of
    // adding a zero-length edge.
    if (previous && distance(snapped, previous) < MIN_SEGMENT_LENGTH_METERS) return;

    this.draftPoints.push(snapped);
    this.context.requestRender();
  }

  onPointerMove(): void {}
  onPointerUp(): void {}

  onKeyDown(event: EditorKeyboardEvent): void {
    const floor = this.context.getActiveFloor();

    if (event.key === "Enter" && floor) {
      this.finish(floor.id);
      return;
    }
    if (event.key === "Escape") {
      this.draftPoints = [];
      this.context.requestRender();
      return;
    }
    if (event.key === "Backspace") {
      this.draftPoints.pop();
      this.context.requestRender();
    }
  }

  private finish(floorId: string): void {
    const floor = this.context.getActiveFloor();
    if (!floor || this.draftPoints.length < 3) {
      this.draftPoints = [];
      return;
    }

    const space = createSpace(floorId, [...this.draftPoints]);
    this.context.executeCommand(new AddSpaceCommand(floor, space));
    this.context.selection.select(space.id);

    this.draftPoints = [];
    this.context.requestRender();
  }
}
