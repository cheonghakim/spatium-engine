import { distance, distanceToSegment, isPointInPolygon, type Point } from "@indoor/core";
import type { DraftManager, DraftState } from "../draft/DraftManager.js";
import {
  MARQUEE_THRESHOLD_PX,
  marqueeMode,
  marqueeRect,
  pointInRect,
  polygonInMarquee,
  segmentInMarquee,
  type Marquee,
} from "../selection/marquee.js";
import type { EditorKeyboardEvent, EditorPointerEvent, EditorTool } from "./EditorTool.js";
import type { ToolContext } from "./ToolContext.js";

/** Reshaping one entry: a wall endpoint or a room vertex (single selection only). */
type HandleDrag =
  | { id: string; start: Point; end: Point; handle: "start" | "end" }
  | { id: string; vertex: number };

/** Moving the whole selection; armed on press, active once past the click threshold. */
interface MoveDrag {
  ids: string[];
  origin: Point;
  originScreen: Point;
  active: boolean;
  /** Released without dragging: narrow a multi-selection to this entry. */
  narrowTo?: string;
}

interface PendingMarquee extends Marquee {
  startScreen: Point;
  active: boolean;
  additive: boolean;
  base: readonly string[];
  /** What a press that never becomes a box does on release. */
  click?: { id: string; action: "select" | "toggle" };
}

type HitKind = "element" | "wall" | "space";

/** Arrow-key nudge step in metres (Shift = coarse). */
const NUDGE_M = 0.1;
const NUDGE_COARSE_M = 1;

/** Draft entries the box picks: window (left→right) = fully inside, crossing (right→left) = touched. */
function draftIdsInMarquee(state: DraftState, marquee: Marquee): string[] {
  const rect = marqueeRect(marquee),
    mode = marqueeMode(marquee);
  return [
    ...state.elements.filter((e) => pointInRect(e.position, rect)).map((e) => e.id),
    ...state.walls.filter((w) => segmentInMarquee(w.start, w.end, rect, mode)).map((w) => w.id),
    ...state.spaces.filter((s) => polygonInMarquee(s.polygon, rect, mode)).map((s) => s.id),
  ];
}

export class DraftReviewTool implements EditorTool {
  readonly id = "draft-review";
  private handleDrag: HandleDrag | null = null;
  private moveDrag: MoveDrag | null = null;
  private marquee: PendingMarquee | null = null;
  constructor(
    private readonly context: ToolContext,
    private readonly draft: DraftManager,
  ) {}
  activate(): void {
    this.context.selection.clear();
  }
  deactivate(): void {
    this.handleDrag = null;
    this.moveDrag = null;
    this.marquee = null;
    this.draft.cancelEdit();
  }
  /** The rubber-band box being dragged (world coordinates), for the canvas overlay. */
  getMarquee(): Marquee | null {
    return this.marquee?.active ? { start: this.marquee.start, end: this.marquee.end } : null;
  }

  private radius(): number {
    return 10 / this.context.camera.getState().zoom;
  }

  /** Topmost draft entry under the pointer: element candidates, then the nearest wall, then rooms. */
  private hitTest(state: DraftState, point: Point): { id: string; kind: HitKind } | null {
    const radius = this.radius();
    const element = state.elements.find((e) => distance(e.position, point) <= radius);
    if (element) return { id: element.id, kind: "element" };
    let best: { id: string; d: number } | null = null;
    for (const wall of state.walls) {
      const d = distanceToSegment(point, wall.start, wall.end).distance;
      if (d <= radius && (!best || d < best.d)) best = { id: wall.id, d };
    }
    if (best) return { id: best.id, kind: "wall" };
    const space = [...state.spaces].reverse().find((s) => isPointInPolygon(point, s.polygon));
    return space ? { id: space.id, kind: "space" } : null;
  }

  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const state = this.draft.current;
    if (!state || (state.floorId && state.floorId !== this.context.getActiveFloor()?.id)) return;
    const radius = this.radius();
    // Shift or Ctrl: click toggles an entry, drag adds a box to the selection.
    const additive = event.shiftKey || event.ctrlKey;
    const base = [...this.draft.selectedIds];
    const startMarquee = (click?: PendingMarquee["click"]): void => {
      this.marquee = {
        start: { ...event.worldPoint },
        end: { ...event.worldPoint },
        startScreen: { ...event.screenPoint },
        active: false,
        additive,
        base,
        ...(click ? { click } : {}),
      };
    };

    if (!additive) {
      // Handles of a single selected wall/room take priority.
      const selectedWall = state.walls.find((w) => w.id === this.draft.selectedId);
      const handle = selectedWall
        ? distance(selectedWall.start, event.worldPoint) <= radius
          ? "start"
          : distance(selectedWall.end, event.worldPoint) <= radius
            ? "end"
            : null
        : null;
      if (selectedWall && handle) {
        this.startHandleDrag({
          id: selectedWall.id,
          start: { ...selectedWall.start },
          end: { ...selectedWall.end },
          handle,
        });
        return;
      }
      const space = state.spaces.find((s) => s.id === this.draft.selectedId);
      const vertex = space?.polygon.findIndex((p) => distance(p, event.worldPoint) <= radius) ?? -1;
      if (space && vertex >= 0) {
        this.startHandleDrag({ id: space.id, vertex });
        return;
      }
    }

    const hit = this.hitTest(state, event.worldPoint);
    if (!hit) {
      if (!additive) this.draft.select(null);
      startMarquee();
      return;
    }
    if (additive) {
      startMarquee({ id: hit.id, action: "toggle" });
      return;
    }
    // Pressing on something already selected moves the whole selection.
    if (this.draft.isSelected(hit.id)) {
      this.startMove(event, base.length > 1 ? hit.id : undefined);
      return;
    }
    // An unselected room: click selects it, drag draws a box (rooms cover
    // most of the plan, so the box must be startable from inside one).
    if (hit.kind === "space") {
      startMarquee({ id: hit.id, action: "select" });
      return;
    }
    this.draft.select(hit.id);
    if (hit.kind === "wall") {
      const wall = state.walls.find((w) => w.id === hit.id)!;
      const handle =
        distance(wall.start, event.worldPoint) <= radius
          ? "start"
          : distance(wall.end, event.worldPoint) <= radius
            ? "end"
            : null;
      if (handle) {
        this.startHandleDrag({
          id: wall.id,
          start: { ...wall.start },
          end: { ...wall.end },
          handle,
        });
        return;
      }
    }
    this.startMove(event);
  }

  private startHandleDrag(drag: HandleDrag): void {
    this.handleDrag = drag;
    this.draft.beginEdit();
  }

  private startMove(event: EditorPointerEvent, narrowTo?: string): void {
    this.moveDrag = {
      ids: [...this.draft.selectedIds],
      origin: { ...event.worldPoint },
      originScreen: { ...event.screenPoint },
      active: false,
      ...(narrowTo ? { narrowTo } : {}),
    };
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
    const move = this.moveDrag;
    if (move) {
      if (
        !move.active &&
        Math.hypot(
          event.screenPoint.x - move.originScreen.x,
          event.screenPoint.y - move.originScreen.y,
        ) < MARQUEE_THRESHOLD_PX
      )
        return;
      if (!move.active) {
        move.active = true;
        this.draft.beginEdit();
      }
      let dx = event.worldPoint.x - move.origin.x,
        dy = event.worldPoint.y - move.origin.y;
      // Shift locks the move to the dominant axis.
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      this.draft.moveEntries(move.ids, dx, dy);
      return;
    }
    const drag = this.handleDrag;
    if (!drag) return;
    let point = event.worldPoint;
    if (!event.altKey) {
      // General snapping (grid / already-confirmed floor geometry) — this is
      // what makes the shared "격자 맞춤" toggle apply here too. Draft walls
      // aren't part of `floor` yet (they're still pending review, held in
      // DraftManager rather than the floor's own arrays), so they're
      // invisible to VertexSnap/EdgeSnap/GridSnap above — the loop below
      // additionally snaps to a nearby *other* draft wall's endpoint,
      // winning only if it's closer than whatever the general snap already
      // resolved to, so adjacent draft walls still line up with each other
      // during review without silently overriding an explicit grid snap.
      const floor = this.context.getActiveFloor();
      if (floor) point = this.context.snapping.resolve(event.worldPoint, { floor });

      const radius = this.radius();
      let best = distance(event.worldPoint, point);
      for (const wall of this.draft.current?.walls ?? []) {
        if (wall.id === drag.id || !wall.accepted) continue;
        for (const candidate of [wall.start, wall.end]) {
          const d = distance(candidate, event.worldPoint);
          if (d <= radius && d < best) {
            point = candidate;
            best = d;
          }
        }
      }
    }
    if ("vertex" in drag) {
      this.draft.updateSpaceVertex(drag.id, drag.vertex, point);
      return;
    }
    let start = drag.start,
      end = drag.end;
    if (event.shiftKey) {
      const anchor = drag.handle === "start" ? end : start;
      point =
        Math.abs(point.x - anchor.x) > Math.abs(point.y - anchor.y)
          ? { x: point.x, y: anchor.y }
          : { x: anchor.x, y: point.y };
    }
    if (drag.handle === "start") start = point;
    else end = point;
    this.draft.updateWall(drag.id, start, end, { detach: event.altKey });
  }
  onPointerUp(): void {
    const marquee = this.marquee;
    this.marquee = null;
    if (marquee) {
      const state = this.draft.current;
      if (marquee.active && state) {
        const ids = draftIdsInMarquee(state, marquee);
        this.draft.setSelection(marquee.additive ? [...marquee.base, ...ids] : ids);
      } else if (marquee.click?.action === "toggle") this.draft.toggleSelected(marquee.click.id);
      else if (marquee.click?.action === "select") this.draft.select(marquee.click.id);
      return;
    }
    const move = this.moveDrag;
    this.moveDrag = null;
    if (move) {
      if (move.active) this.draft.commitEdit();
      else if (move.narrowTo) this.draft.select(move.narrowTo);
      return;
    }
    this.handleDrag = null;
    this.draft.commitEdit();
  }
  onKeyDown(event: EditorKeyboardEvent): void {
    if (event.key === "Escape") {
      // First Escape cancels an in-progress drag/box; the next one clears the selection.
      if (this.handleDrag || this.moveDrag || this.marquee) this.deactivate();
      else this.draft.select(null);
      this.context.requestRender();
      return;
    }
    const state = this.draft.current;
    if (event.ctrlKey && event.key.toLowerCase() === "a") {
      if (state)
        this.draft.setSelection([
          ...state.elements.map((e) => e.id),
          ...state.walls.map((w) => w.id),
          ...state.spaces.map((s) => s.id),
        ]);
      return;
    }
    const step = event.shiftKey ? NUDGE_COARSE_M : NUDGE_M;
    const nudge: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const delta = nudge[event.key];
    if (delta) {
      if (this.handleDrag || this.moveDrag || !this.draft.selectedIds.length) return;
      this.draft.beginEdit();
      this.draft.moveEntries(this.draft.selectedIds, delta.x, delta.y);
      this.draft.commitEdit();
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    this.deactivate();
    // Excludes every selected entry in one undoable step.
    this.draft.setAccepted(this.draft.selectedIds, false);
  }
}
