import {
  distance,
  distanceToSegment,
  isPointInPolygon,
  FURNITURE_PRESETS,
  type Entrance,
  type Floor,
  type Furniture,
  type Group,
  type NavigationNode,
  type Point,
  type POI,
  type Space,
  type Wall,
} from "@indoor/core";
import type { Command } from "../commands/Command.js";
import { CompoundCommand } from "../commands/CompoundCommand.js";
import { ChangePropertyCommand } from "../commands/PropertyCommands.js";
import {
  MoveVertexCommand,
  AddVertexCommand,
  DeleteVertexCommand,
} from "../commands/VertexCommands.js";
import { MovePOICommand } from "../commands/POICommands.js";
import { MoveFurnitureCommand } from "../commands/FurnitureCommands.js";
import { MoveWallCommand } from "../commands/WallCommands.js";
import { buildDeleteCommand, stripFromGroups } from "../commands/buildDeleteCommand.js";
import { findObjectKind, type SelectableKind } from "../selection/findObjectKind.js";
import { findGroupContaining } from "../selection/findGroupContaining.js";
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

interface FurnitureDrag {
  item: Furniture;
  originalPosition: Point;
  origin: Point;
}

/** Local (unrotated) footprint half-extents, falling back to the type's default preset — mirrors how width/height default elsewhere (e.g. Entrance dimension fields). */
function footprint(item: Furniture): { halfWidth: number; halfDepth: number } {
  const preset = FURNITURE_PRESETS[item.type];
  return {
    halfWidth: (item.width ?? preset.width) / 2,
    halfDepth: (item.depth ?? preset.depth) / 2,
  };
}

/** True if `point` lands inside `item`'s footprint rectangle, accounting for its rotation. */
function isPointInFurniture(point: Point, item: Furniture): boolean {
  const angle = ((item.rotation ?? 0) * Math.PI) / 180;
  const ux = Math.cos(angle),
    uy = Math.sin(angle);
  const dx = point.x - item.position.x,
    dy = point.y - item.position.y;
  // Inverse rotation (transpose, since it's orthogonal): world delta -> local axes.
  const localX = ux * dx + uy * dy;
  const localY = -uy * dx + ux * dy;
  const { halfWidth, halfDepth } = footprint(item);
  return Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfDepth;
}

interface VertexDrag {
  space: Space;
  vertexIndex: number;
  originalPoint: Point;
}

/** One group member's geometry snapshot, tagged by kind so a group-move/restore knows how to read/write it. Navigation edges have no independent geometry, so they're never snapshotted — they just follow their endpoint nodes if those are also members. */
type GroupMember =
  | { kind: "poi"; obj: POI; original: Point }
  | { kind: "furniture"; obj: Furniture; original: Point }
  | { kind: "entrance"; obj: Entrance; original: Point }
  | { kind: "navigationNode"; obj: NavigationNode; original: Point }
  | { kind: "wall"; obj: Wall; originalStart: Point; originalEnd: Point }
  | { kind: "space"; obj: Space; originalPolygon: Point[] };

function snapshotGroupMembers(floor: Floor, group: Group): GroupMember[] {
  const members: GroupMember[] = [];
  for (const id of group.memberIds) {
    const kind = findObjectKind(floor, id);
    if (kind === "poi") {
      const obj = floor.pois.find((p) => p.id === id);
      if (obj) members.push({ kind, obj, original: { ...obj.position } });
    } else if (kind === "furniture") {
      const obj = floor.furniture.find((f) => f.id === id);
      if (obj) members.push({ kind, obj, original: { ...obj.position } });
    } else if (kind === "entrance") {
      const obj = floor.entrances.find((e) => e.id === id);
      if (obj) members.push({ kind, obj, original: { ...obj.position } });
    } else if (kind === "navigationNode") {
      const obj = floor.navigation.nodes.find((n) => n.id === id);
      if (obj) members.push({ kind, obj, original: { ...obj.position } });
    } else if (kind === "wall") {
      const obj = floor.walls.find((w) => w.id === id);
      if (obj)
        members.push({ kind, obj, originalStart: { ...obj.start }, originalEnd: { ...obj.end } });
    } else if (kind === "space") {
      const obj = floor.spaces.find((s) => s.id === id);
      if (obj) members.push({ kind, obj, originalPolygon: obj.polygon.map((p) => ({ ...p })) });
    }
  }
  return members;
}

/** Live drag preview: translates every member by the same world-space delta, without touching history. */
function applyGroupDelta(members: readonly GroupMember[], dx: number, dy: number): void {
  for (const member of members) {
    if (member.kind === "wall") {
      member.obj.start = { x: member.originalStart.x + dx, y: member.originalStart.y + dy };
      member.obj.end = { x: member.originalEnd.x + dx, y: member.originalEnd.y + dy };
    } else if (member.kind === "space") {
      member.obj.polygon = member.originalPolygon.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else {
      member.obj.position = { x: member.original.x + dx, y: member.original.y + dy };
    }
  }
}

/** Reverts every member to its drag-start geometry (Escape / deactivate) — no commands, no undo entry. */
function restoreGroupMembers(members: readonly GroupMember[]): void {
  for (const member of members) {
    if (member.kind === "wall") {
      member.obj.start = member.originalStart;
      member.obj.end = member.originalEnd;
    } else if (member.kind === "space") {
      member.obj.polygon = member.originalPolygon;
    } else {
      member.obj.position = member.original;
    }
  }
}

/**
 * Commits a finished group drag: for each member, reads its current
 * (live-updated by applyGroupDelta) geometry as the final value, reverts it
 * to the drag-start snapshot, then builds the one command that carries it
 * back to that final value — mirroring the existing revert-then-construct
 * pattern used by every other drag in this file (e.g. the single-wall case
 * in onPointerUp), so each command's own "previous value" is captured
 * correctly at construction time.
 */
function buildGroupMoveCommands(members: readonly GroupMember[]): Command[] {
  const commands: Command[] = [];
  for (const member of members) {
    if (member.kind === "wall") {
      const finalStart = { ...member.obj.start };
      const finalEnd = { ...member.obj.end };
      member.obj.start = member.originalStart;
      member.obj.end = member.originalEnd;
      if (
        distance(finalStart, member.originalStart) + distance(finalEnd, member.originalEnd) >
        0.00001
      )
        commands.push(new MoveWallCommand(member.obj, finalStart, finalEnd));
    } else if (member.kind === "space") {
      const finalPolygon = member.obj.polygon.map((p) => ({ ...p }));
      member.obj.polygon = member.originalPolygon;
      commands.push(new ChangePropertyCommand(member.obj, "polygon", finalPolygon, "Move Space"));
    } else {
      const finalPosition = { ...member.obj.position };
      member.obj.position = member.original;
      if (distance(finalPosition, member.original) > 0.00001)
        commands.push(new ChangePropertyCommand(member.obj, "position", finalPosition, "Move"));
    }
  }
  return commands;
}

interface GroupDrag {
  group: Group;
  members: GroupMember[];
  origin: Point;
}

export class SelectTool implements EditorTool {
  readonly id = "select";

  private drag: PoiDrag | null = null;
  private furnitureDrag: FurnitureDrag | null = null;
  private groupDrag: GroupDrag | null = null;
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
    if (this.furnitureDrag) this.furnitureDrag.item.position = this.furnitureDrag.originalPosition;
    if (this.groupDrag) restoreGroupMembers(this.groupDrag.members);
    if (this.vertexDrag)
      this.vertexDrag.space.polygon[this.vertexDrag.vertexIndex] = this.vertexDrag.originalPoint;
    this.wallDrag = null;
    this.drag = null;
    this.furnitureDrag = null;
    this.groupDrag = null;
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

    const rawHit = this.hitTest(event.worldPoint, floor, hitRadiusWorld);

    // Clicking any member of a group selects the group as a whole (Figma/
    // AutoCAD convention) — resolved here, once, so every existing
    // select/add/clear/drag/delete path below just sees a "group" hit and
    // needs no group-specific branching of its own.
    let hit = rawHit;
    if (hit && hit.kind !== "group") {
      const containingGroup = findGroupContaining(floor, hit.id);
      if (containingGroup) hit = { id: containingGroup.id, kind: "group" };
    }

    if (!hit) {
      if (!event.shiftKey) this.context.selection.clear();
      return;
    }

    if (event.shiftKey) {
      this.context.selection.add(hit.id);
    } else {
      this.context.selection.select(hit.id);
    }

    if (hit.kind === "group" && !event.shiftKey) {
      const group = floor.groups.find((g) => g.id === hit.id);
      if (group) {
        this.groupDrag = {
          group,
          members: snapshotGroupMembers(floor, group),
          origin: { ...event.worldPoint },
        };
      }
    }
    if (hit.kind === "poi") {
      const poi = floor.pois.find((p) => p.id === hit.id);
      if (poi) this.drag = { poi, originalPosition: { ...poi.position } };
    }
    if (hit.kind === "furniture") {
      const item = floor.furniture.find((f) => f.id === hit.id);
      if (item && !event.shiftKey)
        this.furnitureDrag = {
          item,
          originalPosition: { ...item.position },
          origin: { ...event.worldPoint },
        };
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

    if (this.groupDrag) {
      const { members, origin } = this.groupDrag;
      applyGroupDelta(members, event.worldPoint.x - origin.x, event.worldPoint.y - origin.y);
      this.context.requestRender();
      return;
    }

    if (this.furnitureDrag) {
      const { originalPosition, origin } = this.furnitureDrag;
      const target = {
        x: originalPosition.x + event.worldPoint.x - origin.x,
        y: originalPosition.y + event.worldPoint.y - origin.y,
      };
      const floor = this.context.getActiveFloor();
      const point = floor
        ? this.context.snapping.resolve(target, {
            floor,
            excludeId: this.furnitureDrag.item.id,
          })
        : target;
      this.furnitureDrag.item.position = point;
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

    if (this.groupDrag) {
      const commands = buildGroupMoveCommands(this.groupDrag.members);
      this.groupDrag = null;
      if (commands.length) this.context.executeCommand(new CompoundCommand("Move Group", commands));
      return;
    }

    if (this.furnitureDrag) {
      const { item, originalPosition } = this.furnitureDrag;
      const finalPosition = { ...item.position };
      item.position = originalPosition;
      if (distance(originalPosition, finalPosition) > 0) {
        const commands: Command[] = [new MoveFurnitureCommand(item, finalPosition)];
        const spaceId = this.context
          .getActiveFloor()
          ?.spaces.find((space) => isPointInPolygon(finalPosition, space.polygon))?.id;
        if (item.spaceId !== spaceId)
          commands.push(
            new ChangePropertyCommand(item, "spaceId", spaceId, "Update Furniture Space"),
          );
        this.context.executeCommand(new CompoundCommand("Move Furniture", commands));
      }
      this.furnitureDrag = null;
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
    const commands: Command[] = [
      buildDeleteCommand(floor, entry.id, kind, this.context.findNodeBuilding),
    ];
    // Deleting a single grouped object (as opposed to deleting the whole
    // group, handled inside buildDeleteCommand's "group" branch) must also
    // drop it from its group's membership, dissolving the group if that
    // leaves it with ≤1 member.
    if (kind !== "group") commands.push(...stripFromGroups(floor, entry.id));
    this.context.executeCommand(
      commands.length > 1 ? new CompoundCommand("Delete", commands) : commands[0]!,
    );
    this.context.selection.clear();
  }

  private hitTest(point: Point, floor: Floor, hitRadiusWorld: number): HitResult | null {
    for (const poi of floor.pois) {
      if (distance(point, poi.position) <= hitRadiusWorld) return { id: poi.id, kind: "poi" };
    }
    for (const item of floor.furniture) {
      if (isPointInFurniture(point, item)) return { id: item.id, kind: "furniture" };
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
