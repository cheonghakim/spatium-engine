import {
  distance,
  distanceToSegment,
  isPointInSpace,
  FURNITURE_PRESETS,
  type Entrance,
  type Floor,
  type Furniture,
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

/**
 * Snapshots everything a move of `ids` carries along: groups expand to their
 * members, and a moved wall drags the doors/windows hosted on it (wallId) so
 * they don't end up floating beside it. Each object appears once.
 */
function snapshotMembers(floor: Floor, ids: readonly string[]): GroupMember[] {
  const expanded: string[] = [];
  for (const id of ids) {
    const group = floor.groups.find((g) => g.id === id);
    expanded.push(...(group ? group.memberIds : [id]));
  }
  const unique = new Set(expanded);
  for (const entrance of floor.entrances)
    if (entrance.wallId && unique.has(entrance.wallId)) unique.add(entrance.id);
  const members: GroupMember[] = [];
  for (const id of unique) {
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
function buildGroupMoveCommands(floor: Floor, members: readonly GroupMember[]): Command[] {
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
      if (distance(finalPosition, member.original) <= 0.00001) continue;
      commands.push(new ChangePropertyCommand(member.obj, "position", finalPosition, "Move"));
      // Furniture remembers which room it stands in; keep that in step.
      if (member.kind === "furniture") {
        const spaceId = floor.spaces.find((space) => isPointInSpace(space, finalPosition))?.id;
        if (member.obj.spaceId !== spaceId)
          commands.push(
            new ChangePropertyCommand(member.obj, "spaceId", spaceId, "Update Furniture Space"),
          );
      }
    }
  }
  return commands;
}

/**
 * Moving the selection as a whole (one object, a group, or a multi-selection).
 * Armed on press and only `active` once the pointer has travelled past the
 * click threshold, so a plain click never nudges anything.
 */
interface MoveDrag {
  members: GroupMember[];
  origin: Point;
  originScreen: Point;
  active: boolean;
  /** Single point-like object (POI/furniture): snap its own position, not the cursor. */
  snapAnchor?: { point: Point; excludeId: string };
  /** Released without dragging: select only this id (narrowing a multi-selection). */
  narrowTo?: string;
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
  /**
   * What a press that never turns into a box does on release: an unselected
   * room is selected, a Shift/Ctrl press toggles the object under it. Done on
   * release (not press) so a box started over a room doesn't light it up.
   */
  click?: { hit: HitResult; action: "select" | "toggle" };
}

/** Arrow-key nudge step in metres (Shift = coarse). */
const NUDGE_M = 0.1;
const NUDGE_COARSE_M = 1;

export class SelectTool implements EditorTool {
  readonly id = "select";

  private moveDrag: MoveDrag | null = null;
  private vertexDrag: VertexDrag | null = null;
  private marquee: PendingMarquee | null = null;
  private wallDrag: {
    wall: Wall;
    start: Point;
    end: Point;
    origin: Point;
    handle: "start" | "end";
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
    if (this.moveDrag) restoreGroupMembers(this.moveDrag.members);
    if (this.vertexDrag)
      this.vertexDrag.space.polygon[this.vertexDrag.vertexIndex] = this.vertexDrag.originalPoint;
    this.wallDrag = null;
    this.moveDrag = null;
    this.vertexDrag = null;
    this.marquee = null;
  }

  /** Arms a move of every selected object, grabbed at `event`. */
  private startMove(floor: Floor, event: EditorPointerEvent): void {
    const ids = this.context.selection.current
      .filter((e) => e.vertexIndex === undefined)
      .map((e) => e.id);
    const members = snapshotMembers(floor, ids);
    if (members.length === 0) return;
    const only = members.length === 1 ? members[0] : undefined;
    this.moveDrag = {
      members,
      origin: { ...event.worldPoint },
      originScreen: { ...event.screenPoint },
      active: false,
      ...(only && (only.kind === "poi" || only.kind === "furniture")
        ? { snapAnchor: { point: only.original, excludeId: only.obj.id } }
        : {}),
    };
  }

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const floor = this.context.getActiveFloor();
    if (!floor) return;

    const hitRadiusWorld = HIT_RADIUS_PX / this.context.camera.getState().zoom;
    // Shift or Ctrl extends the selection instead of replacing it.
    const additive = event.shiftKey || event.ctrlKey;
    const baseSelection = [...this.context.selection.current];
    const startMarquee = (click?: PendingMarquee["click"]): void => {
      this.marquee = {
        start: { ...event.worldPoint },
        end: { ...event.worldPoint },
        startScreen: { ...event.screenPoint },
        active: false,
        additive,
        base: baseSelection,
        ...(click ? { click } : {}),
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

    // Shift/Ctrl: a click toggles the object, a drag adds a box to the selection.
    if (additive) {
      startMarquee({ hit, action: "toggle" });
      return;
    }

    // Pressing on something already selected moves the whole selection —
    // that's how a multi-selection (or a selected room) is dragged.
    if (this.context.selection.isSelected(hit.id)) {
      this.startMove(floor, event);
      // A click (no drag) on one member of a multi-selection narrows to it.
      if (this.moveDrag && baseSelection.length > 1) this.moveDrag.narrowTo = hit.id;
      return;
    }

    // An unselected room: click selects it, drag draws a box. After
    // vectorization rooms cover most of the canvas, so the box has to be
    // startable from inside one. Select the room first to move it.
    if (hit.kind === "space") {
      startMarquee({ hit, action: "select" });
      return;
    }

    // Anything else: select it and arm a move, so press-and-drag moves it in one go.
    this.context.selection.select(hit.id);
    if (hit.kind === "wall") {
      const wall = floor.walls.find((w) => w.id === hit.id)!;
      const handle =
        distance(wall.start, event.worldPoint) <= hitRadiusWorld
          ? "start"
          : distance(wall.end, event.worldPoint) <= hitRadiusWorld
            ? "end"
            : null;
      if (handle) {
        this.wallDrag = {
          wall,
          start: { ...wall.start },
          end: { ...wall.end },
          origin: event.worldPoint,
          handle,
        };
        this.context.requestRender();
        return;
      }
    }
    this.startMove(floor, event);
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
      if (floor && !event.altKey)
        point = this.context.snapping.resolve(point, { floor, excludeId: drag.wall.id });
      const anchor = drag.handle === "start" ? drag.end : drag.start;
      if (event.shiftKey)
        point =
          Math.abs(point.x - anchor.x) > Math.abs(point.y - anchor.y)
            ? { x: point.x, y: anchor.y }
            : { x: anchor.x, y: point.y };
      if (distance(point, anchor) < 0.01) return;
      drag.wall[drag.handle] = { ...point };
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

    const move = this.moveDrag;
    if (!move) return;
    if (
      !move.active &&
      Math.hypot(
        event.screenPoint.x - move.originScreen.x,
        event.screenPoint.y - move.originScreen.y,
      ) < MARQUEE_THRESHOLD_PX
    )
      return;
    move.active = true;
    let dx = event.worldPoint.x - move.origin.x,
      dy = event.worldPoint.y - move.origin.y;
    // Shift locks the move to the dominant axis.
    if (event.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const floor = this.context.getActiveFloor();
    if (move.snapAnchor && floor && !event.altKey) {
      const anchor = move.snapAnchor.point;
      const snapped = this.context.snapping.resolve(
        { x: anchor.x + dx, y: anchor.y + dy },
        { floor, excludeId: move.snapAnchor.excludeId },
      );
      dx = snapped.x - anchor.x;
      dy = snapped.y - anchor.y;
    }
    applyGroupDelta(move.members, dx, dy);
    this.context.requestRender();
  }

  /** Arrow keys nudge the whole selection (Shift = 1 m steps), one undo step per press. */
  private nudge(event: EditorKeyboardEvent): boolean {
    const step = event.shiftKey ? NUDGE_COARSE_M : NUDGE_M;
    const delta =
      event.key === "ArrowLeft"
        ? { x: -step, y: 0 }
        : event.key === "ArrowRight"
          ? { x: step, y: 0 }
          : event.key === "ArrowUp"
            ? { x: 0, y: -step }
            : event.key === "ArrowDown"
              ? { x: 0, y: step }
              : null;
    if (!delta) return false;
    const floor = this.context.getActiveFloor();
    if (!floor) return true;
    const ids = this.context.selection.current
      .filter((e) => e.vertexIndex === undefined)
      .map((e) => e.id);
    const members = snapshotMembers(floor, ids);
    if (members.length === 0) return true;
    applyGroupDelta(members, delta.x, delta.y);
    const commands = buildGroupMoveCommands(floor, members);
    if (commands.length) this.context.executeCommand(new CompoundCommand("Move", commands));
    return true;
  }

  onPointerUp(): void {
    if (this.marquee) {
      const marquee = this.marquee;
      this.marquee = null;
      if (marquee.active) this.applyMarquee(marquee);
      else if (marquee.click?.action === "toggle") {
        this.context.selection.toggle(marquee.click.hit.id);
        this.context.requestRender();
      } else if (marquee.click?.action === "select") {
        this.context.selection.select(marquee.click.hit.id);
        this.context.requestRender();
      }
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

    const move = this.moveDrag;
    if (!move) return;
    this.moveDrag = null;
    if (!move.active) {
      if (move.narrowTo) this.context.selection.select(move.narrowTo);
      return;
    }
    const floor = this.context.getActiveFloor();
    if (!floor) return;
    const commands = buildGroupMoveCommands(floor, move.members);
    if (commands.length) this.context.executeCommand(new CompoundCommand("Move", commands));
  }

  onKeyDown(event: EditorKeyboardEvent): void {
    if (event.key === "Escape") {
      // First Escape cancels a drag/box in progress; the next clears the selection.
      const busy = !!(this.moveDrag || this.wallDrag || this.vertexDrag || this.marquee);
      this.deactivate();
      if (!busy) this.context.selection.clear();
      this.context.requestRender();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "a") {
      const floor = this.context.getActiveFloor();
      if (floor) {
        const ids = idsInMarquee(
          floor,
          { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity },
          "window",
        ).map((id) => findGroupContaining(floor, id)?.id ?? id);
        this.context.selection.setAll(ids.map((id) => ({ id })));
        this.context.requestRender();
      }
      return;
    }
    if (!this.moveDrag && !this.wallDrag && !this.vertexDrag && this.nudge(event)) return;
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
