import { createPOI, isPointInPolygon } from "@indoor/core";
import { AddPOICommand } from "../commands/POICommands.js";
import type { EditorTool, EditorPointerEvent } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

/** Click places a POI. If the click lands inside a Space, that space is auto-assigned. */
export class POITool implements EditorTool {
  readonly id = "poi";

  constructor(private readonly context: ToolContext) {}

  activate(): void {}
  deactivate(): void {}

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const floor = this.context.getActiveFloor();
    if (!floor) return;

    const point = this.context.snapping.resolve(event.worldPoint, { floor });
    const containingSpace = floor.spaces.find((space) => isPointInPolygon(point, space.polygon));

    const poi = createPOI(floor.id, point, "custom", `POI ${floor.pois.length + 1}`);
    if (containingSpace) poi.spaceId = containingSpace.id;

    this.context.executeCommand(new AddPOICommand(floor, poi));
    this.context.selection.select(poi.id);
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
}
