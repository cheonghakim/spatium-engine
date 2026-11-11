import { findHoleProblems, isPointInPolygon, type Floor, type Point } from "@indoor/core";
import { ChangePropertyCommand } from "../commands/PropertyCommands.js";
import { PolygonTool } from "./PolygonTool.js";
import type { ToolContext } from "./ToolContext.js";

/** Why a drawn hole was rejected, for the host to show. */
export type HoleRejection = "no-space" | "invalid";

/**
 * Draws a hole (column, core, void) into a space, with the same clicks as
 * the space tool. The hole goes into the selected space, or else the space
 * whose outline contains every vertex. A hole that would be invalid (outside
 * the outline, crossing itself or another hole) is rejected, not stored.
 */
export class HoleTool extends PolygonTool {
  override readonly id: string = "hole";

  constructor(
    context: ToolContext,
    private readonly onRejected: (reason: HoleRejection) => void = () => {},
  ) {
    super(context);
  }

  protected override commit(floor: Floor, _floorId: string, points: Point[]): void {
    const selectedId = this.context.selection.current[0]?.id;
    const space =
      floor.spaces.find((s) => s.id === selectedId) ??
      floor.spaces.find((s) => points.every((p) => isPointInPolygon(p, s.polygon)));
    if (!space) {
      this.onRejected("no-space");
      return;
    }
    const holes = [...(space.holes ?? []), points];
    if (findHoleProblems(space.polygon, holes).length > 0) {
      this.onRejected("invalid");
      return;
    }
    this.context.executeCommand(new ChangePropertyCommand(space, "holes", holes, "Add Hole"));
    this.context.selection.select(space.id);
  }
}
