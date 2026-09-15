import { createEntrance, nearestPointOnPolygon } from "@indoor/core";
import { AddEntranceCommand } from "../commands/EntranceCommands.js";
import type { EditorTool, EditorPointerEvent } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

const NEARBY_SPACE_THRESHOLD_METERS = 0.3;

/**
 * Click places a Door entrance. The up-to-two nearest spaces (within a small
 * threshold of the click) are auto-assigned as spaceA/spaceB, since a door
 * usually sits on the wall between two rooms (or one room and a corridor).
 */
export class DoorTool implements EditorTool {
  readonly id = "door";

  constructor(private readonly context: ToolContext) {}

  activate(): void {}
  deactivate(): void {}

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const floor = this.context.getActiveFloor();
    if (!floor) return;

    const point = this.context.snapping.resolve(event.worldPoint, { floor });

    const nearbySpaceIds = floor.spaces
      .map((space) => ({ id: space.id, distance: nearestPointOnPolygon(point, space.polygon).distance }))
      .filter((candidate) => candidate.distance <= NEARBY_SPACE_THRESHOLD_METERS)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2);

    const entrance = createEntrance(floor.id, point, "door");
    if (nearbySpaceIds[0]) entrance.spaceA = nearbySpaceIds[0].id;
    if (nearbySpaceIds[1]) entrance.spaceB = nearbySpaceIds[1].id;

    this.context.executeCommand(new AddEntranceCommand(floor, entrance));
    this.context.selection.select(entrance.id);
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
}
