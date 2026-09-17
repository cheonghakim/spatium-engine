import { createId, createWall, createSpace, createEntrance, type Entrance, type Point } from "@indoor/core";

export interface DraftElementInput extends Pick<Entrance, "type" | "position" | "width" | "height" | "depth" | "rotation" | "stepCount" | "sillHeight"> {
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
  accepted: boolean;
  needsReview?: boolean;
}

export interface DraftState {
  floorId?: string;
  roomsNeedReview?: boolean;
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
  needsReview?: boolean;
}

export class DraftManager {
  private state: DraftState | null = null;
  selectedId: string | null = null;
  private past: DraftState[] = [];
  private future: DraftState[] = [];
  private beforeEdit: DraftState | null = null;

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  select(id: string | null): void { this.selectedId = id; if (this.state) this.state = { ...this.state }; this.onChange(); }
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
    this.future.push(this.state); this.state = previous; this.onChange();
  }
  redo(): void {
    this.cancelEdit();
    const next = this.future.pop();
    if (!next || !this.state) return;
    this.past.push(this.state); this.state = next; this.onChange();
  }
  beginEdit(): void { this.cancelEdit(); this.beforeEdit = this.state ? structuredClone(this.state) : null; }
  cancelEdit(): void {
    if (!this.beforeEdit) return;
    this.state = this.beforeEdit; this.beforeEdit = null; this.onChange();
  }
  commitEdit(): void {
    if (!this.beforeEdit || !this.state) return;
    if (JSON.stringify(this.beforeEdit) !== JSON.stringify(this.state)) {
      this.past.push(this.beforeEdit);
      if (this.past.length > 50) this.past.shift();
      this.future = [];
    }
    this.beforeEdit = null; this.onChange();
  }
  updateWall(id: string, start: Point, end: Point): void {
    const wall = this.state?.walls.find(w => w.id === id);
    if (!wall || !this.state || Math.hypot(end.x - start.x, end.y - start.y) < 0.01) return;
    if ([start.x, start.y, end.x, end.y].some(n => !Number.isFinite(n))) return;
    if (wall.start.x === start.x && wall.start.y === start.y && wall.end.x === end.x && wall.end.y === end.y) return;
    wall.start = { ...start }; wall.end = { ...end };
    for (const element of this.state.elements) element.accepted = false;
    // Detected room polygons are independent; do not silently accept stale rooms.
    for (const space of this.state.spaces) space.accepted = false;
    this.state.roomsNeedReview = this.state.spaces.length > 0;
    this.state = { ...this.state, walls: this.state.walls.map(w => w.id === id ? { ...w } : w), spaces: [...this.state.spaces] };
    this.onChange();
  }
  updateSpaceVertex(id: string, index: number, point: Point): void {
    const space = this.state?.spaces.find(s => s.id === id);
    if (!space?.polygon[index] || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    space.polygon[index] = { ...point };
    this.state = { ...this.state!, spaces: this.state!.spaces.map(s => s.id === id ? { ...s, polygon: [...s.polygon] } : s) };
    this.onChange();
  }

  constructor(private readonly onChange: () => void) {}

  get current(): DraftState | null {
    return this.state;
  }

  get hasDraft(): boolean {
    return this.state !== null;
  }

  setDraft(walls: DraftWallInput[], spaces: DraftSpaceInput[], warnings: string[] = [], floorId?: string, elements: DraftElementInput[] = []): void {
    this.past = []; this.future = []; this.beforeEdit = null; this.selectedId = null;
    this.state = {
      ...(floorId ? { floorId } : {}),
      walls: walls.map((w) => ({ id: createId(), start: w.start, end: w.end, thickness: w.thickness, accepted: true })),
      spaces: spaces.map((s) => ({ ...structuredClone(s), id: createId(), accepted: !s.needsReview })),
      warnings,
      elements: [],
    };
    this.state.elements = elements.map(element => ({ ...structuredClone(element), id: createId(), accepted: false,
      replacesWallIds: (element.replacesWallIndices ?? []).flatMap(i => this.state!.walls[i] ? [this.state!.walls[i]!.id] : []) }));
    this.onChange();
  }

  toggleElement(id: string): void {
    const element = this.state?.elements.find(e => e.id === id);
    if (!element) return;
    this.checkpoint();
    element.accepted = !element.accepted;
    this.state = { ...this.state!, elements: [...this.state!.elements] };
    this.onChange();
  }

  updateElement(id: string, patch: Partial<Pick<Entrance, "type" | "position" | "width" | "height" | "depth" | "rotation" | "stepCount" | "sillHeight">>): void {
    const element = this.state?.elements.find(e => e.id === id);
    if (!element) return;
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === "number" && (!Number.isFinite(value) ||
        (["width", "height", "depth"].includes(key) && value <= 0) ||
        (key === "sillHeight" && value < 0) || (key === "stepCount" && (!Number.isInteger(value) || value < 2 || value > 200)))) return;
    }
    if (patch.position && ![patch.position.x, patch.position.y].every(Number.isFinite)) return;
    this.checkpoint();
    // Move a proposed support wall with its opening, preserving the candidate's relative geometry.
    if (patch.position && element.supportWall) {
      const dx = patch.position.x - element.position.x, dy = patch.position.y - element.position.y;
      element.supportWall.start = { x: element.supportWall.start.x + dx, y: element.supportWall.start.y + dy };
      element.supportWall.end = { x: element.supportWall.end.x + dx, y: element.supportWall.end.y + dy };
    }
    Object.assign(element, structuredClone(patch));
    this.state = { ...this.state!, elements: [...this.state!.elements] };
    this.onChange();
  }

  /** Shared by preview and confirmation, including replacement of stair strokes. */
  materialize(floorId: string) {
    const elements = this.state?.elements.filter(e => e.accepted) ?? [];
    const replaced = new Set(elements.flatMap(e => e.replacesWallIds));
    const walls = (this.state?.walls ?? []).filter(w => w.accepted && !replaced.has(w.id))
      .map(w => ({ ...createWall(floorId, { ...w.start }, { ...w.end }, w.thickness), id: w.id }));
    const spaces = (this.state?.spaces ?? []).filter(s => s.accepted && !elements.some(e => {
      if (e.type !== "stairs" || !e.width || !e.depth) return false;
      const angle = (e.rotation ?? 0) * Math.PI / 180, ux = Math.cos(angle), uy = Math.sin(angle);
      return s.polygon.every(p => Math.abs((p.x - e.position.x) * ux + (p.y - e.position.y) * uy) <= e.depth! / 2 + 0.05 &&
        Math.abs(-(p.x - e.position.x) * uy + (p.y - e.position.y) * ux) <= e.width! / 2 + 0.05);
    })).map(s => ({ ...createSpace(floorId, s.polygon.map(p => ({ ...p }))), id: s.id }));
    const entrances = elements.map(e => {
      const entrance = createEntrance(floorId, { ...e.position }, e.type);
      entrance.id = e.id;
      for (const key of ["width", "height", "depth", "rotation", "stepCount", "sillHeight"] as const) {
        const value = e[key];
        if (value !== undefined) entrance[key] = value;
      }
      if (e.type === "stairs") entrance.landingDepth = 0;
      if (e.supportWall && ["door", "window", "opening"].includes(e.type)) {
        const wall = { ...createWall(floorId, { ...e.supportWall.start }, { ...e.supportWall.end }, e.supportWall.thickness), id: `${e.id}-support` };
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
    this.past = []; this.future = []; this.beforeEdit = null; this.selectedId = null;
    this.onChange();
  }

  toggleWall(id: string): void {
    if (!this.state) return;
    const wall = this.state.walls.find((w) => w.id === id);
    if (!wall) return;
    this.checkpoint();
    wall.accepted = !wall.accepted;
    this.state = { ...this.state, walls: [...this.state.walls] };
    this.onChange();
  }

  toggleSpace(id: string): void {
    if (!this.state) return;
    const space = this.state.spaces.find((s) => s.id === id);
    if (!space) return;
    this.checkpoint();
    space.accepted = !space.accepted;
    this.state = { ...this.state, spaces: [...this.state.spaces] };
    this.onChange();
  }

  setAllAccepted(accepted: boolean): void {
    if (!this.state) return;
    this.checkpoint();
    for (const wall of this.state.walls) wall.accepted = accepted;
    for (const space of this.state.spaces) space.accepted = accepted;
    // Bulk acceptance does not silently approve uncertain semantic candidates.
    if (!accepted) for (const element of this.state.elements) element.accepted = false;
    this.state = { ...this.state, walls: [...this.state.walls], spaces: [...this.state.spaces] };
    this.onChange();
  }
}
