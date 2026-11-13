import {
  buildingOutline,
  buildingSiteOutline,
  buildingToSite,
  isPointInPolygon,
  polygonCentroid,
  type Building,
  type BuildingPlacement,
  type Point,
} from "@indoor/core";
import type { Command } from "../commands/Command.js";
import { ChangePropertyCommand } from "../commands/PropertyCommands.js";
import type { EditorKeyboardEvent, EditorPointerEvent, EditorTool } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

interface Drag {
  building: Building;
  original: BuildingPlacement | undefined;
  start: Point;
  rotate: boolean;
  /** Rotation pivot: the outline centroid, in building-local and site coordinates. */
  pivotLocal: Point;
  pivotSite: Point;
}

const DEG = 180 / Math.PI;

function placementOf(building: Building): BuildingPlacement {
  return building.placement ?? { origin: { x: 0, y: 0 }, bearing: 0 };
}

/** Normalizes to [0, 360) and drops float dust. */
function normalizeBearing(bearing: number): number {
  return Number((((bearing % 360) + 360) % 360).toFixed(6));
}

/**
 * Site view: drag a building's outline to move it in the site frame; Shift-
 * drag rotates it around its outline's centroid. Each drag is one undoable
 * step (Building.placement). Escape cancels a drag in progress.
 */
export class SiteBuildingTool implements EditorTool {
  readonly id = "site-building";

  private drag: Drag | null = null;
  private selectedId: string | null = null;

  constructor(
    private readonly context: ToolContext,
    private readonly getBuildings: () => readonly Building[],
    /** Builds the undoable placement change (the editor also re-measures outdoor links). */
    private readonly placeCommand: (building: Building, placement: BuildingPlacement) => Command = (
      building,
      placement,
    ) => new ChangePropertyCommand(building, "placement", placement, "Place Building"),
  ) {}

  /** The building last picked, for highlighting. */
  getSelectedBuildingId(): string | null {
    return this.selectedId;
  }

  activate(): void {
    this.drag = null;
  }

  deactivate(): void {
    this.cancel();
  }

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const buildings = this.getBuildings();
    // Topmost (last drawn) first.
    const building = [...buildings].reverse().find((b) => {
      const outline = buildingSiteOutline(b);
      return outline.length >= 3 && isPointInPolygon(event.worldPoint, outline);
    });
    this.selectedId = building?.id ?? null;
    this.context.requestRender();
    if (!building) return;

    const pivotLocal = polygonCentroid(buildingOutline(building));
    this.drag = {
      building,
      original: building.placement,
      start: event.worldPoint,
      rotate: event.shiftKey,
      pivotLocal,
      pivotSite: buildingToSite(building, pivotLocal),
    };
  }

  onPointerMove(event: EditorPointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    drag.building.placement = this.placementFor(drag, event.worldPoint);
    this.context.requestRender();
  }

  onPointerUp(event: EditorPointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    const next = this.placementFor(drag, event.worldPoint);
    // Revert, then let the command apply it so undo captures the original.
    if (drag.original) drag.building.placement = drag.original;
    else delete drag.building.placement;
    const before = placementOf(drag.building);
    const moved =
      Math.hypot(next.origin.x - before.origin.x, next.origin.y - before.origin.y) > 1e-6 ||
      Math.abs(next.bearing - before.bearing) > 1e-6;
    if (moved) {
      this.context.executeCommand(this.placeCommand(drag.building, next));
    } else {
      this.context.requestRender();
    }
  }

  onKeyDown(event: EditorKeyboardEvent): void {
    if (event.key === "Escape") this.cancel();
  }

  private cancel(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (drag.original) drag.building.placement = drag.original;
    else delete drag.building.placement;
    this.context.requestRender();
  }

  private placementFor(drag: Drag, pointer: Point): BuildingPlacement {
    const original = drag.original ?? { origin: { x: 0, y: 0 }, bearing: 0 };
    if (!drag.rotate) {
      return {
        origin: {
          x: original.origin.x + pointer.x - drag.start.x,
          y: original.origin.y + pointer.y - drag.start.y,
        },
        bearing: original.bearing,
      };
    }
    // Angle swept around the pivot; counter-clockwise drag = negative bearing change.
    const a0 = Math.atan2(drag.start.y - drag.pivotSite.y, drag.start.x - drag.pivotSite.x);
    const a1 = Math.atan2(pointer.y - drag.pivotSite.y, pointer.x - drag.pivotSite.x);
    const bearing = normalizeBearing(original.bearing - (a1 - a0) * DEG);
    // Keep the pivot fixed: origin = pivotSite − R(bearing)·pivotLocal.
    const rotated = buildingToSite(
      { placement: { origin: { x: 0, y: 0 }, bearing } },
      drag.pivotLocal,
    );
    return {
      origin: { x: drag.pivotSite.x - rotated.x, y: drag.pivotSite.y - rotated.y },
      bearing,
    };
  }
}
