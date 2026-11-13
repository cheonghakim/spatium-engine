import {
  createId,
  createWall,
  createSpace,
  createEntrance,
  type Entrance,
  type Point,
} from "@indoor/core";

export interface DraftElementInput extends Pick<
  Entrance,
  "type" | "position" | "width" | "height" | "depth" | "rotation" | "stepCount" | "sillHeight"
> {
  confidence: number;
  reason: string;
  supportWall?: DraftWallInput;
  replacesWallIndices?: number[];
}
export interface DraftElementEntry extends DraftElementInput {
  id: string;
  accepted: boolean;
  replacesWallIds: string[];
}

/**
 * Draft geometry proposed by an automated source (spec §16-18: CV-heuristic
 * floor-plan vectorization) awaiting human review before it becomes real,
 * undoable project data. Kept structurally identical to, but independent
 * from, `@indoor/vectorize`'s output types — the editor package does not
 * depend on the vectorizer, mirroring how editor/runtime/builder each keep
 * their own small types instead of sharing across layers.
 */
export interface DraftWallEntry {
  id: string;
  start: Point;
  end: Point;
  thickness: number;
  accepted: boolean;
}

export interface DraftSpaceEntry {
  id: string;
  polygon: Point[];
  /** Enclosed areas that are not floor (stair cores, shafts). Carried through to the confirmed space. */
  holes?: Point[][];
  accepted: boolean;
  needsReview?: boolean;
}

export interface DraftState {
  floorId?: string;
  walls: DraftWallEntry[];
  spaces: DraftSpaceEntry[];
  warnings: string[];
  elements: DraftElementEntry[];
}

export interface DraftWallInput {
  start: Point;
  end: Point;
  thickness: number;
}

export interface DraftSpaceInput {
  polygon: Point[];
  holes?: Point[][];
  needsReview?: boolean;
}

/** How close (m) a point must be to a wall's centreline to count as joined to it. */
function attachTolerance(thickness: number): number {
  return Math.min(0.15, Math.max(0.05, thickness / 2));
}

function projectOnSegment(
  p: Point,
  a: Point,
  b: Point,
): { t: number; point: Point; distance: number } {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

export class DraftManager {
  private state: DraftState | null = null;
  private selected: string[] = [];
  private past: DraftState[] = [];
  private future: DraftState[] = [];
  private beforeEdit: DraftState | null = null;

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  /** Every selected draft entry id (walls, rooms, element candidates), in selection order. */
  get selectedIds(): readonly string[] {
    return this.selected;
  }
  /** The selected entry when exactly one is selected — single-item editors (coordinates, handles) use this. */
  get selectedId(): string | null {
    return this.selected.length === 1 ? this.selected[0]! : null;
  }
  isSelected(id: string): boolean {
    return this.selected.includes(id);
  }
  select(id: string | null): void {
    this.setSelection(id === null ? [] : [id]);
  }
  /** Adds the id to the selection, or removes it if already selected (Shift/Ctrl+click). */
  toggleSelected(id: string): void {
    this.setSelection(
      this.isSelected(id) ? this.selected.filter((s) => s !== id) : [...this.selected, id],
    );
  }
  setSelection(ids: readonly string[]): void {
    this.selected = [...new Set(ids)];
    if (this.state) this.state = { ...this.state };
    this.onChange();
  }
  /**
   * Includes/excludes every given entry as ONE undoable draft edit (bulk
   * review of a multi-selection). Element candidates are only ever included
   * here when explicitly selected — setAllAccepted still never auto-approves them.
   */
  setAccepted(ids: readonly string[], accepted: boolean): void {
    if (!this.state) return;
    const set = new Set(ids);
    const changes =
      this.state.walls.some((w) => set.has(w.id) && w.accepted !== accepted) ||
      this.state.spaces.some((s) => set.has(s.id) && s.accepted !== accepted) ||
      this.state.elements.some((e) => set.has(e.id) && e.accepted !== accepted);
    if (!changes) return;
    this.checkpoint();
    this.state = {
      ...this.state,
      walls: this.state.walls.map((w) => (set.has(w.id) ? { ...w, accepted } : w)),
      spaces: this.state.spaces.map((s) => (set.has(s.id) ? { ...s, accepted } : s)),
      elements: this.state.elements.map((e) => (set.has(e.id) ? { ...e, accepted } : e)),
    };
    this.onChange(true);
  }
  private checkpoint(): void {
    if (!this.state) return;
    this.past.push(structuredClone(this.state));
    if (this.past.length > 50) this.past.shift();
    this.future = [];
  }
  undo(): void {
    this.cancelEdit();
    const previous = this.past.pop();
    if (!previous || !this.state) return;
    this.future.push(this.state);
    this.state = previous;
    this.onChange();
  }
  redo(): void {
    this.cancelEdit();
    const next = this.future.pop();
    if (!next || !this.state) return;
    this.past.push(this.state);
    this.state = next;
    this.onChange();
  }
  beginEdit(): void {
    this.cancelEdit();
    this.beforeEdit = this.state ? structuredClone(this.state) : null;
  }
  cancelEdit(): void {
    if (!this.beforeEdit) return;
    this.state = this.beforeEdit;
    this.beforeEdit = null;
    this.onChange();
  }
  commitEdit(): void {
    if (!this.beforeEdit || !this.state) return;
    if (JSON.stringify(this.beforeEdit) !== JSON.stringify(this.state)) {
      this.past.push(this.beforeEdit);
      if (this.past.length > 50) this.past.shift();
      this.future = [];
      this.beforeEdit = null;
      this.onChange(true);
      return;
    }
    this.beforeEdit = null;
    this.onChange();
  }
  /**
   * Moves/reshapes one draft wall. Walls joined to it stretch and rooms along
   * it follow, keeping the plan closed — unless `detach` (Alt-drag) is set.
   */
  updateWall(id: string, start: Point, end: Point, options: { detach?: boolean } = {}): void {
    const wall = this.state?.walls.find((w) => w.id === id);
    if (!wall || !this.state || Math.hypot(end.x - start.x, end.y - start.y) < 0.01) return;
    if ([start.x, start.y, end.x, end.y].some((n) => !Number.isFinite(n))) return;
    if (
      wall.start.x === start.x &&
      wall.start.y === start.y &&
      wall.end.x === end.x &&
      wall.end.y === end.y
    )
      return;
    // Attachments are measured against the geometry at drag start (beforeEdit),
    // so a wall swept across some unrelated vertex mid-drag never picks it up.
    const base = this.beforeEdit ?? structuredClone(this.state);
    const baseWall = base.walls.find((w) => w.id === id) ?? wall;
    const a = baseWall.start,
      b = baseWall.end;
    const tolerance = attachTolerance(baseWall.thickness);
    // A point lying on the old wall keeps its place along it (parameter t) and its offset from it.
    const follow = (point: Point): Point | null => {
      if (options.detach) return null;
      const hit = projectOnSegment(point, a, b);
      if (hit.distance > tolerance) return null;
      return {
        x: start.x + (end.x - start.x) * hit.t + (point.x - hit.point.x),
        y: start.y + (end.y - start.y) * hit.t + (point.y - hit.point.y),
      };
    };
    const walls = this.state.walls.map((w) => {
      if (w.id === id) return { ...w, start: { ...start }, end: { ...end } };
      const original = base.walls.find((o) => o.id === w.id);
      if (!original) return w;
      // Walls joined to this one stretch so the joint stays closed.
      const s = follow(original.start),
        e = follow(original.end);
      return s || e ? { ...w, start: s ?? w.start, end: e ?? w.end } : w;
    });
    // Rooms keep hugging the wall instead of being dropped from the result.
    const spaces = this.state.spaces.map((space) => {
      const original = base.spaces.find((o) => o.id === space.id);
      if (!original || original.polygon.length !== space.polygon.length) return space;
      let moved = false;
      const polygon = original.polygon.map((p, i) => {
        const next = follow(p);
        if (next) moved = true;
        return next ?? space.polygon[i]!;
      });
      return moved ? { ...space, polygon } : space;
    });
    // An accepted opening on this wall may no longer fit: send it back for review.
    const elements = this.state.elements.map((element) =>
      element.accepted &&
      projectOnSegment(element.position, a, b).distance <= (element.width ?? 1) / 2 + tolerance
        ? { ...element, accepted: false }
        : element,
    );
    this.state = { ...this.state, walls, spaces, elements };
    this.onChange();
  }

  /**
   * Translates the given draft entries by (dx, dy) relative to their geometry
   * at `beginEdit()` — the live preview of dragging a multi-selection. Walls
   * that aren't moving but touch a moving wall stretch to stay joined, and
   * rooms that aren't moving follow a moving wall along their shared edge.
   */
  moveEntries(ids: readonly string[], dx: number, dy: number): void {
    if (!this.state || ![dx, dy].every(Number.isFinite)) return;
    const base = this.beforeEdit ?? structuredClone(this.state);
    const set = new Set(ids);
    const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
    const movedWalls = base.walls.filter((w) => set.has(w.id));
    const attached = (p: Point) =>
      movedWalls.some(
        (w) => projectOnSegment(p, w.start, w.end).distance <= attachTolerance(w.thickness),
      );
    const walls = base.walls.map((w) =>
      set.has(w.id)
        ? { ...w, start: shift(w.start), end: shift(w.end) }
        : {
            ...w,
            start: attached(w.start) ? shift(w.start) : w.start,
            end: attached(w.end) ? shift(w.end) : w.end,
          },
    );
    const spaces = base.spaces.map((s) => ({
      ...s,
      polygon: s.polygon.map((p) => (set.has(s.id) || attached(p) ? shift(p) : p)),
      ...(s.holes && set.has(s.id) ? { holes: s.holes.map((hole) => hole.map(shift)) } : {}),
    }));
    const elements = base.elements.map((e) =>
      set.has(e.id)
        ? {
            ...e,
            position: shift(e.position),
            ...(e.supportWall
              ? {
                  supportWall: {
                    ...e.supportWall,
                    start: shift(e.supportWall.start),
                    end: shift(e.supportWall.end),
                  },
                }
              : {}),
          }
        : e,
    );
    this.state = { ...this.state, walls, spaces, elements };
    this.onChange();
  }
  updateSpaceVertex(id: string, index: number, point: Point): void {
    const space = this.state?.spaces.find((s) => s.id === id);
    if (!space?.polygon[index] || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    space.polygon[index] = { ...point };
    this.state = {
      ...this.state!,
      spaces: this.state!.spaces.map((s) => (s.id === id ? { ...s, polygon: [...s.polygon] } : s)),
    };
    this.onChange();
  }

  /**
   * `onChange(mutated)` fires on every state change; `mutated` is true only
   * when the change created (or loaded) a new undoable draft edit — as
   * opposed to a selection change or an undo/redo/cancel that merely moves
   * within the existing draft history. IndoorEditor uses this to know which
   * stack (draft vs. main history) was most recently acted on, so `undo()`
   * can route correctly even after switching tools mid-draft (see F2).
   */
  constructor(private readonly onChange: (mutated?: boolean) => void) {}

  get current(): DraftState | null {
    return this.state;
  }

  get hasDraft(): boolean {
    return this.state !== null;
  }

  setDraft(
    walls: DraftWallInput[],
    spaces: DraftSpaceInput[],
    warnings: string[] = [],
    floorId?: string,
    elements: DraftElementInput[] = [],
  ): void {
    this.past = [];
    this.future = [];
    this.beforeEdit = null;
    this.selected = [];
    this.state = {
      ...(floorId ? { floorId } : {}),
      walls: walls.map((w) => ({
        id: createId(),
        start: w.start,
        end: w.end,
        thickness: w.thickness,
        accepted: true,
      })),
      spaces: spaces.map((s) => ({
        ...structuredClone(s),
        id: createId(),
        // Rooms closed across a door gap are still the floor of that room —
        // include them by default (flagged for a look) so confirming the
        // result actually lays a floor instead of leaving bare walls.
        accepted: true,
      })),
      warnings,
      elements: [],
    };
    this.state.elements = elements.map((element) => ({
      ...structuredClone(element),
      id: createId(),
      accepted: false,
      replacesWallIds: (element.replacesWallIndices ?? []).flatMap((i) =>
        this.state!.walls[i] ? [this.state!.walls[i]!.id] : [],
      ),
    }));
    // NOT `onChange(true)`: `past`/`future` were just reset above, so the
    // freshly (re)loaded draft has nothing undoable yet — `canUndo`/`canRedo`
    // are both false. Reporting `mutated: true` here would tell IndoorEditor
    // the draft stack was "just touched" even though it's empty, which is
    // exactly what let undo()/redo() silently no-op instead of falling
    // through to main history (see IndoorEditor.undo/redo for the full fix).
    this.onChange();
  }

  toggleElement(id: string): void {
    const element = this.state?.elements.find((e) => e.id === id);
    if (!element) return;
    this.checkpoint();
    element.accepted = !element.accepted;
    this.state = { ...this.state!, elements: [...this.state!.elements] };
    this.onChange(true);
  }

  updateElement(
    id: string,
    patch: Partial<
      Pick<
        Entrance,
        "type" | "position" | "width" | "height" | "depth" | "rotation" | "stepCount" | "sillHeight"
      >
    >,
  ): void {
    const element = this.state?.elements.find((e) => e.id === id);
    if (!element) return;
    for (const [key, value] of Object.entries(patch)) {
      if (
        typeof value === "number" &&
        (!Number.isFinite(value) ||
          (["width", "height", "depth"].includes(key) && value <= 0) ||
          (key === "sillHeight" && value < 0) ||
          (key === "stepCount" && (!Number.isInteger(value) || value < 2 || value > 200)))
      )
        return;
    }
    if (patch.position && ![patch.position.x, patch.position.y].every(Number.isFinite)) return;
    this.checkpoint();
    // Move a proposed support wall with its opening, preserving the candidate's relative geometry.
    if (patch.position && element.supportWall) {
      const dx = patch.position.x - element.position.x,
        dy = patch.position.y - element.position.y;
      element.supportWall.start = {
        x: element.supportWall.start.x + dx,
        y: element.supportWall.start.y + dy,
      };
      element.supportWall.end = {
        x: element.supportWall.end.x + dx,
        y: element.supportWall.end.y + dy,
      };
    }
    Object.assign(element, structuredClone(patch));
    this.state = { ...this.state!, elements: [...this.state!.elements] };
    this.onChange(true);
  }

  /** Shared by preview and confirmation, including replacement of stair strokes. */
  materialize(floorId: string) {
    const elements = this.state?.elements.filter((e) => e.accepted) ?? [];
    const replaced = new Set(elements.flatMap((e) => e.replacesWallIds));
    const walls = (this.state?.walls ?? [])
      .filter((w) => w.accepted && !replaced.has(w.id))
      .map((w) => ({
        ...createWall(floorId, { ...w.start }, { ...w.end }, w.thickness),
        id: w.id,
      }));
    const spaces = (this.state?.spaces ?? [])
      .filter(
        (s) =>
          s.accepted &&
          !elements.some((e) => {
            if (e.type !== "stairs" || !e.width || !e.depth) return false;
            const angle = ((e.rotation ?? 0) * Math.PI) / 180,
              ux = Math.cos(angle),
              uy = Math.sin(angle);
            return s.polygon.every(
              (p) =>
                Math.abs((p.x - e.position.x) * ux + (p.y - e.position.y) * uy) <=
                  e.depth! / 2 + 0.05 &&
                Math.abs(-(p.x - e.position.x) * uy + (p.y - e.position.y) * ux) <=
                  e.width! / 2 + 0.05,
            );
          }),
      )
      .map((s) => ({
        ...createSpace(
          floorId,
          s.polygon.map((p) => ({ ...p })),
        ),
        ...(s.holes?.length ? { holes: s.holes.map((hole) => hole.map((p) => ({ ...p }))) } : {}),
        id: s.id,
      }));
    const entrances = elements.map((e) => {
      const entrance = createEntrance(floorId, { ...e.position }, e.type);
      entrance.id = e.id;
      for (const key of [
        "width",
        "height",
        "depth",
        "rotation",
        "stepCount",
        "sillHeight",
      ] as const) {
        const value = e[key];
        if (value !== undefined) entrance[key] = value;
      }
      if (e.type === "stairs") entrance.landingDepth = 0;
      if (e.supportWall && ["door", "window", "opening"].includes(e.type)) {
        const wall = {
          ...createWall(
            floorId,
            { ...e.supportWall.start },
            { ...e.supportWall.end },
            e.supportWall.thickness,
          ),
          id: `${e.id}-support`,
        };
        walls.push(wall);
        entrance.wallId = wall.id;
      }
      return entrance;
    });
    return { walls, spaces, entrances };
  }

  clear(): void {
    if (!this.state) return;
    this.state = null;
    this.past = [];
    this.future = [];
    this.beforeEdit = null;
    this.selected = [];
    this.onChange();
  }

  toggleWall(id: string): void {
    if (!this.state) return;
    const wall = this.state.walls.find((w) => w.id === id);
    if (!wall) return;
    this.checkpoint();
    wall.accepted = !wall.accepted;
    this.state = { ...this.state, walls: [...this.state.walls] };
    this.onChange(true);
  }

  toggleSpace(id: string): void {
    if (!this.state) return;
    const space = this.state.spaces.find((s) => s.id === id);
    if (!space) return;
    this.checkpoint();
    space.accepted = !space.accepted;
    this.state = { ...this.state, spaces: [...this.state.spaces] };
    this.onChange(true);
  }

  setAllAccepted(accepted: boolean): void {
    if (!this.state) return;
    this.checkpoint();
    for (const wall of this.state.walls) wall.accepted = accepted;
    for (const space of this.state.spaces) space.accepted = accepted;
    // Bulk acceptance does not silently approve uncertain semantic candidates.
    if (!accepted) for (const element of this.state.elements) element.accepted = false;
    this.state = { ...this.state, walls: [...this.state.walls], spaces: [...this.state.spaces] };
    this.onChange(true);
  }
}
