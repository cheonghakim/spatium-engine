import {
  distance,
  distanceToSegment,
  isPointInPolygon,
  type Floor,
  type Point,
  type POI,
  type Space,
  type Wall,
} from "@indoor/core";
import type { Command } from "../commands/Command.js";
import { CompoundCommand } from "../commands/CompoundCommand.js";
import { ChangePropertyCommand } from "../commands/PropertyCommands.js";
import { DeleteSpaceCommand } from "../commands/SpaceCommands.js";
import {
  MoveVertexCommand,
  AddVertexCommand,
  DeleteVertexCommand,
} from "../commands/VertexCommands.js";
import { DeleteEntranceCommand } from "../commands/EntranceCommands.js";
import { DeletePOICommand, MovePOICommand } from "../commands/POICommands.js";
import { DeleteWallCommand, MoveWallCommand } from "../commands/WallCommands.js";
import {
  DeleteNavigationNodeCommand,
  DeleteNavigationEdgeCommand,
} from "../commands/NavigationCommands.js";
import { findObjectKind, type SelectableKind } from "../selection/findObjectKind.js";
import type { EditorTool, EditorKeyboardEvent, EditorPointerEvent } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

const HIT_RADIUS_PX = 12;

interface HitResult {
  id: string;
  kind: SelectableKind;
}

interface PoiDrag {
  poi: POI;
  originalPosition: Point;
}

interface VertexDrag {
  space: Space;
  vertexIndex: number;
  originalPoint: Point;
}

export class SelectTool implements EditorTool {
  readonly id = "select";

  private drag: PoiDrag | null = null;
  private vertexDrag: VertexDrag | null = null;
  private wallDrag: {
    wall: Wall;
    start: Point;
    end: Point;
    origin: Point;
    handle: "start" | "end" | "body";
  } | null = null;

  constructor(private readonly context: ToolContext) {}

  activate(): void {}

  deactivate(): void {
    if (this.wallDrag) {
      this.wallDrag.wall.start = this.wallDrag.start;
      this.wallDrag.wall.end = this.wallDrag.end;
    }
    if (this.drag) this.drag.poi.position = this.drag.originalPosition;
    if (this.vertexDrag)
      this.vertexDrag.space.polygon[this.vertexDrag.vertexIndex] = this.vertexDrag.originalPoint;
    this.wallDrag = null;
    this.drag = null;
    this.vertexDrag = null;
  }

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const floor = this.context.getActiveFloor();
    if (!floor) return;

    const hitRadiusWorld = HIT_RADIUS_PX / this.context.camera.getState().zoom;

    // If a Space is already selected, its own vertices/edges take priority —
    // click a vertex to drag it, or click its boundary to insert a new one.
    const currentEntry = this.context.selection.current[0];
    const selectedWall = floor.walls.find((w) => w.id === currentEntry?.id);
    if (selectedWall && !event.shiftKey) {
      const handle =
        distance(selectedWall.start, event.worldPoint) <= hitRadiusWorld
          ? "start"
          : distance(selectedWall.end, event.worldPoint) <= hitRadiusWorld
            ? "end"
            : null;
      if (handle) {
        this.wallDrag = {
          wall: selectedWall,
          start: { ...selectedWall.start },
          end: { ...selectedWall.end },
          origin: event.worldPoint,
          handle,
        };
        return;
      }
    }
    if (currentEntry && currentEntry.vertexIndex === undefined && !event.shiftKey) {
      const selectedSpace = floor.spaces.find((s) => s.id === currentEntry.id);
      if (selectedSpace) {
        const vertexIndex = findVertexIndex(event.worldPoint, selectedSpace, hitRadiusWorld);
        if (vertexIndex !== null) {
          this.context.selection.select(selectedSpace.id, vertexIndex);
          this.vertexDrag = {
            space: selectedSpace,
            vertexIndex,
            originalPoint: { ...selectedSpace.polygon[vertexIndex]! },
          };
          this.context.requestRender();
          return;
        }

        const insertion = findEdgeInsertion(event.worldPoint, selectedSpace, hitRadiusWorld);
        if (insertion) {
          this.context.executeCommand(
            new AddVertexCommand(selectedSpace, insertion.index, insertion.point),
          );
          this.context.selection.select(selectedSpace.id, insertion.index);
          return;
        }
      }
    }

    const hit = this.hitTest(event.worldPoint, floor, hitRadiusWorld);

    if (!hit) {
      if (!event.shiftKey) this.context.selection.clear();
      return;
    }

    if (event.shiftKey) {
      this.context.selection.add(hit.id);
    } else {
      this.context.selection.select(hit.id);
    }

    if (hit.kind === "poi") {
      const poi = floor.pois.find((p) => p.id === hit.id);
      if (poi) this.drag = { poi, originalPosition: { ...poi.position } };
    }
    if (hit.kind === "wall" && !event.shiftKey) {
      const wall = floor.walls.find((w) => w.id === hit.id)!;
      this.wallDrag = {
        wall,
        start: { ...wall.start },
        end: { ...wall.end },
        origin: event.worldPoint,
        handle:
          distance(wall.start, event.worldPoint) <= hitRadiusWorld
            ? "start"
            : distance(wall.end, event.worldPoint) <= hitRadiusWorld
              ? "end"
              : "body",
      };
    }

    this.context.requestRender();
  }

  onPointerMove(event: EditorPointerEvent): void {
    if (this.wallDrag) {
      const drag = this.wallDrag;
      let point = event.worldPoint;
      const floor = this.context.getActiveFloor();
      if (floor && !event.altKey && drag.handle !== "body")
        point = this.context.snapping.resolve(point, { floor, excludeId: drag.wall.id });
      if (drag.handle === "body") {
        const dx = point.x - drag.origin.x,
          dy = point.y - drag.origin.y;
        drag.wall.start = { x: drag.start.x + dx, y: drag.start.y + dy };
        drag.wall.end = { x: drag.end.x + dx, y: drag.end.y + dy };
      } else {
        const anchor = drag.handle === "start" ? drag.end : drag.start;
        if (event.shiftKey)
          point =
            Math.abs(point.x - anchor.x) > Math.abs(point.y - anchor.y)
              ? { x: point.x, y: anchor.y }
              : { x: anchor.x, y: point.y };
        if (distance(point, anchor) < 0.01) return;
        drag.wall[drag.handle] = { ...point };
      }
      this.context.requestRender();
      return;
    }
    if (this.vertexDrag) {
      const floor = this.context.getActiveFloor();
      const point = floor
        ? this.context.snapping.resolve(event.worldPoint, {
            floor,
            excludeId: this.vertexDrag.space.id,
          })
        : event.worldPoint;
      this.vertexDrag.space.polygon[this.vertexDrag.vertexIndex] = point;
      this.context.requestRender();
      return;
    }

    if (!this.drag) return;
    const floor = this.context.getActiveFloor();
    const point = floor
      ? this.context.snapping.resolve(event.worldPoint, { floor, excludeId: this.drag.poi.id })
      : event.worldPoint;
    this.drag.poi.position = point;
    this.context.requestRender();
  }

  onPointerUp(): void {
    if (this.wallDrag) {
      const { wall, start, end } = this.wallDrag;
      const finalStart = { ...wall.start },
        finalEnd = { ...wall.end };
      wall.start = start;
      wall.end = end;
      this.wallDrag = null;
      if (distance(start, finalStart) + distance(end, finalEnd) > 0.00001)
        this.context.executeCommand(new MoveWallCommand(wall, finalStart, finalEnd));
      return;
    }
    if (this.vertexDrag) {
      const { space, vertexIndex, originalPoint } = this.vertexDrag;
      const finalPoint = { ...space.polygon[vertexIndex]! };
      space.polygon[vertexIndex] = originalPoint;
      this.context.executeCommand(new MoveVertexCommand(space, vertexIndex, finalPoint));
      this.vertexDrag = null;
      return;
    }

    if (!this.drag) return;
    const { poi, originalPosition } = this.drag;
    const finalPosition = { ...poi.position };
    poi.position = originalPosition;
    this.context.executeCommand(new MovePOICommand(poi, finalPosition));
    this.drag = null;
  }

  onKeyDown(event: EditorKeyboardEvent): void {
    if (event.key === "Escape") {
      this.deactivate();
      this.context.requestRender();
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    this.deactivate();

    const floor = this.context.getActiveFloor();
    if (!floor) return;

    const entry = this.context.selection.current[0];
    if (!entry) return;

    if (entry.vertexIndex !== undefined) {
      const space = floor.spaces.find((s) => s.id === entry.id);
      if (space && space.polygon.length > 3) {
        this.context.executeCommand(new DeleteVertexCommand(space, entry.vertexIndex));
        this.context.selection.select(space.id);
      }
      return;
    }

    const kind = findObjectKind(floor, entry.id);
    if (!kind) return;
    this.context.executeCommand(buildDeleteCommand(this.context, floor, entry.id, kind));
    this.context.selection.clear();
  }

  private hitTest(point: Point, floor: Floor, hitRadiusWorld: number): HitResult | null {
    for (const poi of floor.pois) {
      if (distance(point, poi.position) <= hitRadiusWorld) return { id: poi.id, kind: "poi" };
    }
    for (const entrance of floor.entrances) {
      if (distance(point, entrance.position) <= hitRadiusWorld) {
        return { id: entrance.id, kind: "entrance" };
      }
    }
    for (const node of floor.navigation.nodes) {
      if (distance(point, node.position) <= hitRadiusWorld) {
        return { id: node.id, kind: "navigationNode" };
      }
    }
    for (const edge of floor.navigation.edges) {
      const from = floor.navigation.nodes.find((n) => n.id === edge.from);
      const to = floor.navigation.nodes.find((n) => n.id === edge.to);
      if (
        from &&
        to &&
        distanceToSegment(point, from.position, to.position).distance <= hitRadiusWorld
      ) {
        return { id: edge.id, kind: "navigationEdge" };
      }
    }
    for (const wall of floor.walls) {
      if (distanceToSegment(point, wall.start, wall.end).distance <= hitRadiusWorld) {
        return { id: wall.id, kind: "wall" };
      }
    }
    for (let i = floor.spaces.length - 1; i >= 0; i--) {
      const space = floor.spaces[i];
      if (space && isPointInPolygon(point, space.polygon)) return { id: space.id, kind: "space" };
    }
    return null;
  }
}

/**
 * Deleting an object can leave dangling cross-references elsewhere (an
 * Entrance's spaceA/spaceB/wallId, a POI's spaceId, a NavigationEdge's
 * from/to) — bundle the primary delete with commands that clear/remove those
 * references so the whole thing undoes as one step.
 *
 * Entrance/POI/Wall references are only ever stored on the same floor as the
 * object they reference, so those cases only need to search `floor`'s own
 * arrays. A NavigationNode is different: IndoorEditor.linkFloorNode can store
 * a cross-floor edge on *either* endpoint's floor (whichever node was the
 * "source" when the link was created), so deleting a node has to search
 * every floor of the building that owns it via `context.findNodeBuilding`,
 * not just the active floor.
 */
function buildDeleteCommand(
  context: ToolContext,
  floor: Floor,
  id: string,
  kind: SelectableKind,
): Command {
  const commands: Command[] = [];

  if (kind === "space") {
    for (const entrance of floor.entrances) {
      if (entrance.spaceA === id)
        commands.push(
          new ChangePropertyCommand(entrance, "spaceA", undefined, "Clear Entrance Space"),
        );
      if (entrance.spaceB === id)
        commands.push(
          new ChangePropertyCommand(entrance, "spaceB", undefined, "Clear Entrance Space"),
        );
    }
    for (const poi of floor.pois) {
      if (poi.spaceId === id)
        commands.push(new ChangePropertyCommand(poi, "spaceId", undefined, "Clear POI Space"));
    }
    commands.push(new DeleteSpaceCommand(floor, id));
  } else if (kind === "wall") {
    for (const entrance of floor.entrances) {
      if (entrance.wallId === id)
        commands.push(
          new ChangePropertyCommand(entrance, "wallId", undefined, "Clear Entrance Wall"),
        );
    }
    commands.push(new DeleteWallCommand(floor, id));
  } else if (kind === "navigationNode") {
    const buildingFloors = context.findNodeBuilding(id) ?? [floor];
    for (const floorInBuilding of buildingFloors) {
      for (const edge of floorInBuilding.navigation.edges) {
        if (edge.from === id || edge.to === id)
          commands.push(new DeleteNavigationEdgeCommand(floorInBuilding, edge.id));
      }
    }
    commands.push(new DeleteNavigationNodeCommand(floor, id));
  } else if (kind === "entrance") {
    commands.push(new DeleteEntranceCommand(floor, id));
  } else if (kind === "poi") {
    commands.push(new DeletePOICommand(floor, id));
  } else {
    commands.push(new DeleteNavigationEdgeCommand(floor, id));
  }

  return commands.length > 1 ? new CompoundCommand("Delete", commands) : commands[0]!;
}

function findVertexIndex(point: Point, space: Space, hitRadiusWorld: number): number | null {
  for (let i = 0; i < space.polygon.length; i++) {
    if (distance(point, space.polygon[i]!) <= hitRadiusWorld) return i;
  }
  return null;
}

function findEdgeInsertion(
  point: Point,
  space: Space,
  hitRadiusWorld: number,
): { index: number; point: Point } | null {
  let best: { index: number; point: Point; dist: number } | null = null;
  for (let i = 0; i < space.polygon.length; i++) {
    const a = space.polygon[i]!;
    const b = space.polygon[(i + 1) % space.polygon.length]!;
    const result = distanceToSegment(point, a, b);
    if (result.distance <= hitRadiusWorld && (!best || result.distance < best.dist)) {
      best = { index: i + 1, point: result.point, dist: result.distance };
    }
  }
  return best ? { index: best.index, point: best.point } : null;
}
