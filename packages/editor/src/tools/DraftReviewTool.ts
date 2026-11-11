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

type Drag =
  | { id: string; start: Point; end: Point; origin: Point; handle: "start" | "end" | "body" }
  | { id: string; vertex: number };

interface PendingMarquee extends Marquee {
  startScreen: Point;
  active: boolean;
  additive: boolean;
  base: readonly string[];
}

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
  private drag: Drag | null = null;
  private marquee: PendingMarquee | null = null;
  constructor(
    private readonly context: ToolContext,
    private readonly draft: DraftManager,
  ) {}
  activate(): void {
    this.context.selection.clear();
  }
  deactivate(): void {
    this.drag = null;
    this.marquee = null;
    this.draft.cancelEdit();
  }
  /** The rubber-band box being dragged (world coordinates), for the canvas overlay. */
  getMarquee(): Marquee | null {
    return this.marquee?.active ? { start: this.marquee.start, end: this.marquee.end } : null;
  }
  onPointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const state = this.draft.current;
    if (!state || (state.floorId && state.floorId !== this.context.getActiveFloor()?.id)) return;
    const radius = 10 / this.context.camera.getState().zoom;
    // Shift or Ctrl toggles entries in/out of the selection instead of replacing it.
    const additive = event.shiftKey || event.ctrlKey;
    const base = [...this.draft.selectedIds];
    const element = state.elements.find((e) => distance(e.position, event.worldPoint) <= radius);
    if (element) {
      if (additive) this.draft.toggleSelected(element.id);
      else this.draft.select(element.id);
      return;
    }
    const selectedWall = state.walls.find((w) => w.id === this.draft.selectedId);
    if (selectedWall && !additive) {
      const handle =
        distance(selectedWall.start, event.worldPoint) <= radius
          ? "start"
          : distance(selectedWall.end, event.worldPoint) <= radius
            ? "end"
            : null;
      if (handle) {
        this.drag = {
          id: selectedWall.id,
          start: { ...selectedWall.start },
          end: { ...selectedWall.end },
          origin: event.worldPoint,
          handle,
        };
        this.draft.beginEdit();
        return;
      }
    }
    const space = state.spaces.find((s) => s.id === this.draft.selectedId);
    const vertex = space?.polygon.findIndex((p) => distance(p, event.worldPoint) <= radius) ?? -1;
    if (space && vertex >= 0 && !additive) {
      this.drag = { id: space.id, vertex };
      this.draft.beginEdit();
      return;
    }
    const walls = state.walls
      .map((wall) => ({
        wall,
        d: distanceToSegment(event.worldPoint, wall.start, wall.end).distance,
      }))
      .filter((hit) => hit.d <= radius)
      .sort((a, b) => a.d - b.d);
    const wall = walls[0]?.wall;
    if (wall && additive) {
      this.draft.toggleSelected(wall.id);
      return;
    }
    if (wall) {
      this.draft.select(wall.id);
      this.drag = {
        id: wall.id,
        start: { ...wall.start },
        end: { ...wall.end },
        origin: event.worldPoint,
        handle:
          distance(wall.start, event.worldPoint) <= radius
            ? "start"
            : distance(wall.end, event.worldPoint) <= radius
              ? "end"
              : "body",
      };
      this.draft.beginEdit();
      return;
    }
    const hit = [...state.spaces]
      .reverse()
      .find((s) => isPointInPolygon(event.worldPoint, s.polygon));
    if (additive) {
      if (hit) this.draft.toggleSelected(hit.id);
    } else this.draft.select(hit?.id ?? null);
    // Pressing inside a room or on empty canvas and dragging draws a selection box.
    this.marquee = {
      start: { ...event.worldPoint },
      end: { ...event.worldPoint },
      startScreen: { ...event.screenPoint },
      active: false,
      additive,
      base,
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
    const drag = this.drag;
    if (!drag) return;
    let point = event.worldPoint;
    if (!event.altKey && !("handle" in drag && drag.handle === "body")) {
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

      const radius = 10 / this.context.camera.getState().zoom;
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
    if (drag.handle === "body") {
      const dx = point.x - drag.origin.x,
        dy = point.y - drag.origin.y;
      start = { x: drag.start.x + dx, y: drag.start.y + dy };
      end = { x: drag.end.x + dx, y: drag.end.y + dy };
    } else {
      if (event.shiftKey) {
        const anchor = drag.handle === "start" ? end : start;
        point =
          Math.abs(point.x - anchor.x) > Math.abs(point.y - anchor.y)
            ? { x: point.x, y: anchor.y }
            : { x: anchor.x, y: point.y };
      }
      if (drag.handle === "start") start = point;
      else end = point;
    }
    this.draft.updateWall(drag.id, start, end);
  }
  onPointerUp(): void {
    const marquee = this.marquee;
    this.marquee = null;
    if (marquee) {
      const state = this.draft.current;
      if (marquee.active && state) {
        const ids = draftIdsInMarquee(state, marquee);
        this.draft.setSelection(marquee.additive ? [...marquee.base, ...ids] : ids);
      }
      return;
    }
    this.drag = null;
    this.draft.commitEdit();
  }
  onKeyDown(event: EditorKeyboardEvent): void {
    if (event.key === "Escape") {
      // First Escape cancels an in-progress drag/box; the next one clears the selection.
      if (this.drag || this.marquee) this.deactivate();
      else this.draft.select(null);
      this.context.requestRender();
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    this.deactivate();
    // Excludes every selected entry in one undoable step.
    this.draft.setAccepted(this.draft.selectedIds, false);
  }
}
