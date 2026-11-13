import {
  distance,
  distanceToSegment,
  isPointInSpace,
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
import { buildDeleteSelectionCommand } from "../commands/buildDeleteCommand.js";
import { findObjectKind, type SelectableKind } from "../selection/findObjectKind.js";
import { findGroupContaining } from "../selection/findGroupContaining.js";
import type { SelectionEntry } from "../selection/SelectionManager.js";
import {
  MARQUEE_THRESHOLD_PX,
  marqueeMode,
  marqueeRect,
  pointInRect,
  polygonInMarquee,
  segmentInMarquee,
  type Marquee,
  type MarqueeMode,
  type Rect,
} from "../selection/marquee.js";
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
  | { kind: "space"; obj: Space; originalPolygon: Point[]; originalHoles: Point[][] | undefined };

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
      if (obj)
        members.push({
          kind,
          obj,
          originalPolygon: obj.polygon.map((p) => ({ ...p })),
          originalHoles: obj.holes?.map((hole) => hole.map((p) => ({ ...p }))),
        });
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
      if (member.originalHoles) {
        member.obj.holes = member.originalHoles.map((hole) =>
          hole.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        );
      }
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
      if (member.originalHoles) member.obj.holes = member.originalHoles;
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
      if (member.originalHoles && member.obj.holes) {
        const finalHoles = member.obj.holes;
        member.obj.holes = member.originalHoles;
        commands.push(new ChangePropertyCommand(member.obj, "holes", finalHoles, "Move Space"));
      }
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

/** A press on empty canvas (or on a room, which has no body-drag) that may grow into a rubber-band selection. */
interface PendingMarquee {
  start: Point;
  end: Point;
  startScreen: Point;
  /** True once the pointer travelled past MARQUEE_THRESHOLD_PX - before that it's still just a click. */
  active: boolean;
  additive: boolean;
  /** Selection at press time, which an additive (Shift/Ctrl) marquee extends. */
  base: readonly SelectionEntry[];
}

export class SelectTool implements EditorTool {
  readonly id = "select";

  private drag: PoiDrag | null = null;
  private furnitureDrag: FurnitureDrag | null = null;
  private groupDrag: GroupDrag | null = null;
  private vertexDrag: VertexDrag | null = null;
  private marquee: PendingMarquee | null = null;
  private wallDrag: {
    wall: Wall;
    start: Point;
    end: Point;
    origin: Point;
    handle: "start" | "end" | "body";
  } | null = null;

  constructor(private readonly context: ToolContext) {}

  activate(): void {}

  /** The rubber-band box being dragged (world coordinates), for the canvas overlay. */
  getMarquee(): Marquee | null {
    return this.marquee?.active ? { start: this.marquee.start, end: this.marquee.end } : null;
  }

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
    this.marquee = null;
  }

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const floor = this.context.getActiveFloor();
    if (!floor) return;

    const hitRadiusWorld = HIT_RADIUS_PX / this.context.camera.getState().zoom;
    // Shift or Ctrl extends the selection instead of replacing it.
    const additive = event.shiftKey || event.ctrlKey;
    const baseSelection = [...this.context.selection.current];
    const startMarquee = (): void => {
      this.marquee = {
        start: { ...event.worldPoint },
        end: { ...event.worldPoint },
        startScreen: { ...event.screenPoint },
        active: false,
        additive,
        base: baseSelection,
      };
    };

    // If a Space is already selected, its own vertices/edges take priority —
    // click a vertex to drag it, or click its boundary to insert a new one.
    // Only with a single selection: a multi-selection shows no such handles.
    const currentEntry = baseSelection.length === 1 ? baseSelection[0] : undefined;
    const selectedWall = floor.walls.find((w) => w.id === currentEntry?.id);
    if (selectedWall && !additive) {
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
    if (currentEntry && currentEntry.vertexIndex === undefined && !additive) {
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
      if (!additive) this.context.selection.clear();
      startMarquee();
      return;
    }

    if (additive) {
      this.context.selection.toggle(hit.id);
    } else {
      this.context.selection.select(hit.id);
    }

    // Rooms have no body-drag, so pressing inside one and dragging draws a
    // selection box — after vectorization rooms cover most of the canvas,
    // so "start the box on empty space" alone would rarely be possible.
    if (hit.kind === "space") startMarquee();

    if (hit.kind === "group" && !additive) {
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
      if (poi && !additive) this.drag = { poi, originalPosition: { ...poi.position } };
    }
    if (hit.kind === "furniture") {
      const item = floor.furniture.find((f) => f.id === hit.id);
      if (item && !additive)
        this.furnitureDrag = {
          item,
          originalPosition: { ...item.position },
          origin: { ...event.worldPoint },
        };
    }
    if (hit.kind === "wall" && !additive) {
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
    if (this.marquee) {
      const marquee = this.marquee;
      marquee.end = { ...event.worldPoint };
      if (
        !marquee.active &&
        Math.hypot(
          event.screenPoint.x - marquee.startScreen.x,
          event.screenPoint.y - marquee.startScreen.y,
        ) >= MARQUEE_THRESHOLD_PX
      )
        marquee.active = true;
      if (marquee.active) this.context.requestRender();
      return;
    }
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
    if (this.marquee) {
      const marquee = this.marquee;
      this.marquee = null;
      if (marquee.active) this.applyMarquee(marquee);
      return;
    }
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
          ?.spaces.find((space) => isPointInSpace(space, finalPosition))?.id;
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

    const entries = this.context.selection.current;
    const entry = entries[0];
    if (!entry) return;

    if (entries.length === 1 && entry.vertexIndex !== undefined) {
      const space = floor.spaces.find((s) => s.id === entry.id);
      if (space && space.polygon.length > 3) {
        this.context.executeCommand(new DeleteVertexCommand(space, entry.vertexIndex));
        this.context.selection.select(space.id);
      }
      return;
    }

    // One undo step for the whole selection; grouped objects are also
    // dropped from their group (dissolving it if <=1 member remains).
    const command = buildDeleteSelectionCommand(
      floor,
      entries.filter((e) => e.vertexIndex === undefined).map((e) => e.id),
      this.context.findNodeBuilding,
      (floorId) => this.context.findFloorBuilding?.(floorId),
    );
    if (!command) return;
    this.context.executeCommand(command);
    this.context.selection.clear();
  }

  private applyMarquee(marquee: PendingMarquee): void {
    const floor = this.context.getActiveFloor();
    if (!floor) return;
    const ids = idsInMarquee(floor, marqueeRect(marquee), marqueeMode(marquee)).map(
      (id) => findGroupContaining(floor, id)?.id ?? id,
    );
    const base = marquee.additive ? marquee.base.filter((e) => e.vertexIndex === undefined) : [];
    this.context.selection.setAll([...base, ...ids.map((id) => ({ id }))]);
    this.context.requestRender();
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
      if (space && isPointInSpace(space, point)) return { id: space.id, kind: "space" };
    }
    return null;
  }
}

/** Every object on `floor` the marquee picks, in hit-test priority order. */
function idsInMarquee(floor: Floor, rect: Rect, mode: MarqueeMode): string[] {
  const ids: string[] = [];
  const inside = (p: Point) => pointInRect(p, rect);
  for (const poi of floor.pois) if (inside(poi.position)) ids.push(poi.id);
  for (const item of floor.furniture) if (inside(item.position)) ids.push(item.id);
  for (const entrance of floor.entrances) if (inside(entrance.position)) ids.push(entrance.id);
  for (const node of floor.navigation.nodes) if (inside(node.position)) ids.push(node.id);
  for (const edge of floor.navigation.edges) {
    const from = floor.navigation.nodes.find((n) => n.id === edge.from);
    const to = floor.navigation.nodes.find((n) => n.id === edge.to);
    if (from && to && segmentInMarquee(from.position, to.position, rect, mode)) ids.push(edge.id);
  }
  for (const wall of floor.walls)
    if (segmentInMarquee(wall.start, wall.end, rect, mode)) ids.push(wall.id);
  for (const space of floor.spaces)
    if (polygonInMarquee(space.polygon, rect, mode)) ids.push(space.id);
  return ids;
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
