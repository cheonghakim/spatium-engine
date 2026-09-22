import {
  createGroup,
  createNavigationEdge,
  distance,
  type Building,
  type Floor,
  type IndoorProject,
  type NavigationEdge,
  type NavigationEdgeType,
  type Point,
} from "@indoor/core";
import type { Command } from "./commands/Command.js";
import { AddSpaceCommand } from "./commands/SpaceCommands.js";
import { AddEntranceCommand } from "./commands/EntranceCommands.js";
import { AddWallCommand } from "./commands/WallCommands.js";
import { AddGroupCommand, DeleteGroupCommand } from "./commands/GroupCommands.js";
import {
  AddNavigationEdgeCommand,
  DeleteNavigationEdgeCommand,
} from "./commands/NavigationCommands.js";
import { DeleteVertexCommand } from "./commands/VertexCommands.js";
import { buildDeleteCommand, stripFromGroups } from "./commands/buildDeleteCommand.js";
import { CompoundCommand } from "./commands/CompoundCommand.js";
import { ClearFloorCommand } from "./commands/ClearFloorCommand.js";
import { findObjectKind } from "./selection/findObjectKind.js";
import { DraftReviewTool } from "./tools/DraftReviewTool.js";
import { EditorCamera } from "./camera/EditorCamera.js";
import { DraftManager } from "./draft/DraftManager.js";
import { EventEmitter } from "./events/EventEmitter.js";
import { HistoryManager } from "./history/HistoryManager.js";
import { LayerVisibilityManager } from "./layers/LayerVisibilityManager.js";
import { ReferenceManager } from "./reference/ReferenceManager.js";
import { SelectionManager, type SelectionEntry } from "./selection/SelectionManager.js";
import { locateObject } from "./selection/locateObject.js";
import { SnapManager } from "./snapping/SnapManager.js";
import { GridSnap } from "./snapping/providers/GridSnap.js";
import { VertexSnap } from "./snapping/providers/VertexSnap.js";
import { EdgeSnap } from "./snapping/providers/EdgeSnap.js";
import { OrthogonalSnap } from "./snapping/providers/OrthogonalSnap.js";
import { ToolManager } from "./tools/ToolManager.js";
import { PanTool } from "./tools/PanTool.js";
import { SelectTool } from "./tools/SelectTool.js";
import { PolygonTool } from "./tools/PolygonTool.js";
import { WallTool } from "./tools/WallTool.js";
import { CalibrateTool } from "./tools/CalibrateTool.js";
import { DoorTool } from "./tools/DoorTool.js";
import { POITool } from "./tools/POITool.js";
import { FurnitureTool } from "./tools/FurnitureTool.js";
import { NavigationNodeTool } from "./tools/NavigationNodeTool.js";
import { NavigationEdgeTool } from "./tools/NavigationEdgeTool.js";
import { NavigationTool } from "./tools/NavigationTool.js";
import { RoutePreviewManager } from "./route/RoutePreviewManager.js";
import type { EditorKeyboardEvent, EditorPointerEvent } from "./tools/EditorTool.js";
import type { ToolContext } from "./tools/ToolContext.js";

export interface IndoorEditorOptions {
  project: IndoorProject;
}

export interface IndoorEditorEvents {
  selectionChanged: readonly SelectionEntry[];
  toolChanged: string;
  floorChanged: string | null;
  /** Fired whenever the project data, camera, or an in-progress draft changes and the view should redraw. */
  projectChanged: void;
  /**
   * Fired when the *entire* project has been swapped out via `loadProject`
   * (opening a saved file, starting a new project, restoring an autosave) —
   * as opposed to `projectChanged`, which fires for incremental in-place
   * edits to the existing project. A host app should listen for this to
   * re-derive any of its own local UI state that was keyed off the previous
   * project (e.g. an active building id), which `projectChanged` alone
   * wouldn't signal since the project identity itself changed.
   */
  projectLoaded: IndoorProject;
  /** The calibrate tool collected two clicks; caller should ask the user for the real distance. */
  calibrationPointsPicked: { a: Point; b: Point };
}

/**
 * The editor engine. Framework-independent: owns domain state (project) plus
 * all transient editing state (camera, selection, tools, history, snapping).
 * Vue (or any UI) only calls methods on this and listens to events — it
 * never mutates `project` directly.
 */
export class IndoorEditor {
  /**
   * Not `readonly`: `loadProject` reassigns it wholesale when opening a
   * saved file, starting a new project, or restoring an autosave. Every
   * other mutation must still go through `executeCommand`.
   */
  project: IndoorProject;
  readonly camera = new EditorCamera();
  readonly history = new HistoryManager();
  readonly snapping = new SnapManager();
  readonly gridSnap = new GridSnap();
  readonly selection: SelectionManager;
  readonly reference: ReferenceManager;
  readonly draft: DraftManager;
  readonly layers: LayerVisibilityManager;
  readonly routePreview: RoutePreviewManager;
  readonly tools: ToolManager;
  readonly furnitureTool: FurnitureTool;

  private readonly emitter = new EventEmitter<IndoorEditorEvents>();
  private activeFloorId: string | null = null;
  /**
   * Which of the two undo/redo stacks (main history vs. the pending draft)
   * was most recently acted on. `undo()`/`redo()` consult this — instead of
   * just `draft.hasDraft` — so that a normal command executed via another
   * tool while a draft sits open unconfirmed correctly takes precedence over
   * the draft stack (see F2 in the editor package review).
   */
  private lastEditSource: "main" | "draft" = "main";

  constructor(options: IndoorEditorOptions) {
    this.project = options.project;
    this.selection = new SelectionManager((entries) =>
      this.emitter.emit("selectionChanged", entries),
    );
    this.reference = new ReferenceManager(() => this.emitter.emit("projectChanged", undefined));
    this.draft = new DraftManager((mutated) => {
      // Track which stack was most recently mutated so undo()/redo() can
      // route correctly even after the user switches tools mid-draft (F2):
      // `mutated` is only true for an actual new draft edit (or a freshly
      // loaded draft), not for a selection change or an undo/redo/cancel
      // that merely moves within existing draft history.
      if (mutated) this.lastEditSource = "draft";
      this.emitter.emit("projectChanged", undefined);
    });
    this.layers = new LayerVisibilityManager(() => this.emitter.emit("projectChanged", undefined));
    this.routePreview = new RoutePreviewManager(
      () => this.project,
      () => this.emitter.emit("projectChanged", undefined),
    );

    this.snapping.register(new VertexSnap());
    this.snapping.register(new EdgeSnap());
    this.snapping.register(new OrthogonalSnap());
    this.snapping.register(this.gridSnap);

    const toolContext: ToolContext = {
      getActiveFloor: () => this.getActiveFloor(),
      camera: this.camera,
      selection: this.selection,
      snapping: this.snapping,
      executeCommand: (command) => this.executeCommand(command),
      requestRender: () => this.emitter.emit("projectChanged", undefined),
      findNodeBuilding: (nodeId) => this.findNodeLocation(nodeId)?.building.floors,
    };

    this.tools = new ToolManager();
    this.tools.register(new PanTool(toolContext));
    this.tools.register(new SelectTool(toolContext));
    this.tools.register(new DraftReviewTool(toolContext, this.draft));
    this.tools.register(new PolygonTool(toolContext));
    this.tools.register(new WallTool(toolContext));
    this.tools.register(new DoorTool(toolContext));
    this.tools.register(new POITool(toolContext));
    this.furnitureTool = new FurnitureTool(toolContext);
    this.tools.register(this.furnitureTool);
    this.tools.register(new NavigationNodeTool(toolContext));
    this.tools.register(new NavigationEdgeTool(toolContext));
    this.tools.register(new NavigationTool(toolContext));
    this.tools.register(
      new CalibrateTool(toolContext, (a, b) =>
        this.emitter.emit("calibrationPointsPicked", { a, b }),
      ),
    );
    this.tools.setActive("select");

    const firstFloor = this.project.buildings[0]?.floors[0];
    if (firstFloor) this.activeFloorId = firstFloor.id;
  }

  getActiveFloor(): Floor | undefined {
    if (!this.activeFloorId) return undefined;
    for (const building of this.project.buildings) {
      const floor = building.floors.find((f) => f.id === this.activeFloorId);
      if (floor) return floor;
    }
    return undefined;
  }

  /** A read-only preview snapshot including accepted draft geometry, without confirming it. */
  getPreviewProject(): IndoorProject {
    const draft = this.draft.current;
    const floorId = draft?.floorId ?? this.getActiveFloor()?.id;
    if (!draft || !floorId) return this.project;
    const geometry = this.draft.materialize(floorId);
    return {
      ...this.project,
      buildings: this.project.buildings.map((building) => ({
        ...building,
        floors: building.floors.map((floor) =>
          floor.id !== floorId
            ? floor
            : {
                ...floor,
                walls: [...floor.walls, ...geometry.walls],
                spaces: [...floor.spaces, ...geometry.spaces],
                entrances: [...floor.entrances, ...geometry.entrances],
              },
        ),
      })),
    };
  }

  setFloor(floorId: string): void {
    if (this.activeFloorId === floorId) return;
    this.tools.active?.deactivate();
    this.tools.active?.activate();
    this.activeFloorId = floorId;
    this.selection.clear();
    this.emitter.emit("floorChanged", floorId);
    this.emitter.emit("projectChanged", undefined);
  }

  /** Switches to the object's floor if needed, selects it, and centers the camera on it. */
  focusObject(id: string): void {
    const location = locateObject(this.project, id);
    if (!location) return;

    this.setFloor(location.floorId);
    this.selection.select(id);
    this.camera.setState({ center: location.position, zoom: this.camera.getState().zoom });
    this.emitter.emit("projectChanged", undefined);
  }

  setTool(toolId: string): void {
    this.tools.setActive(toolId);
    this.emitter.emit("toolChanged", toolId);
  }

  /** Applies a Command through history and redraws. The only way project data should change. */
  executeCommand(command: Command): void {
    this.history.execute(command);
    this.lastEditSource = "main";
    this.emitter.emit("projectChanged", undefined);
  }

  /**
   * Turns every accepted draft wall/space (spec §16-18 human-review step)
   * into real geometry in one undoable operation via the normal command
   * path, then clears the draft. Rejected entries are simply dropped.
   */
  confirmDraft(): void {
    const draft = this.draft.current;
    const floor = this.getActiveFloor();
    if (!draft || !floor) return;
    if (draft.floorId && draft.floorId !== floor.id) return;
    const commands: Command[] = [];

    const geometry = this.draft.materialize(floor.id);
    for (const wall of geometry.walls) commands.push(new AddWallCommand(floor, wall));
    for (const space of geometry.spaces) commands.push(new AddSpaceCommand(floor, space));
    for (const entrance of geometry.entrances)
      commands.push(new AddEntranceCommand(floor, entrance));

    if (commands.length) this.executeCommand(new CompoundCommand("Apply vectorization", commands));
    this.draft.clear();
    this.setTool("select");
  }

  undo(): void {
    this.tools.active?.deactivate();
    this.tools.active?.activate();
    // A pending (unconfirmed) draft and the main history are two independent
    // undo/redo stacks. Route to whichever one was mutated most recently
    // (tracked in `lastEditSource`) rather than always preferring the draft
    // just because one happens to be open: a user can switch to another tool
    // and perform a normal, unrelated edit while a draft sits open, and
    // Ctrl+Z should undo THAT edit, not silently reach into the draft.
    //
    // `lastEditSource === "draft"` alone isn't sufficient, though: it can be
    // stale relative to the draft's own stack — e.g. `lastEditSource` is
    // already "draft" from editing an earlier draft, and the user then
    // re-runs auto-vectorization, which loads a brand-new draft whose
    // past/future are reset to empty. Requiring `draft.canUndo` too ensures
    // we only commit to the draft branch when it actually has something to
    // undo; otherwise we fall through to main history instead of silently
    // no-oping.
    if (this.draft.hasDraft && this.lastEditSource === "draft" && this.draft.canUndo) {
      this.draft.undo();
      return;
    }
    if (this.history.undo()) {
      this.lastEditSource = "main";
      this.afterHistoryChange();
      return;
    }
    // Main history had nothing to undo — fall back to the draft stack if one
    // exists, so a draft can still be undone even if it was never the "most
    // recently touched" stack (e.g. right after loading a draft that hasn't
    // been edited yet). If the draft stack is also empty this is a no-op.
    if (this.draft.hasDraft) this.draft.undo();
  }

  redo(): void {
    this.tools.active?.deactivate();
    this.tools.active?.activate();
    // See undo() above: `draft.canRedo` guards against a stale
    // `lastEditSource` pointing at a draft stack with nothing to redo.
    if (this.draft.hasDraft && this.lastEditSource === "draft" && this.draft.canRedo) {
      this.draft.redo();
      return;
    }
    if (this.history.redo()) {
      this.lastEditSource = "main";
      this.afterHistoryChange();
      return;
    }
    if (this.draft.hasDraft) this.draft.redo();
  }

  /**
   * Replaces the entire project — used when opening a saved file, starting a
   * new project, or restoring an autosave. Every piece of transient editing
   * state (undo/redo history, selection, any in-progress draft or tool
   * interaction, the loaded reference image, layer visibility, the route
   * preview, and the camera's pan/zoom) is reset, since none of it is
   * meaningful against a different project — in particular, leaving the
   * camera wherever the previous project's geometry happened to be would risk
   * rendering a freshly loaded (likely small, origin-centered) project
   * off-screen. Emits the existing `floorChanged`/`projectChanged` events so
   * every panel already listening for those redraws, plus a new
   * `projectLoaded` event so a host app can tell a full swap apart from an
   * incremental edit.
   */
  loadProject(project: IndoorProject): void {
    this.tools.active?.deactivate();
    this.project = project;
    this.history.clear();
    this.selection.clear();
    this.draft.clear();
    this.reference.clear();
    this.layers.reset();
    this.routePreview.clear();
    this.camera.reset();

    const firstFloor = this.project.buildings[0]?.floors[0];
    this.activeFloorId = firstFloor ? firstFloor.id : null;
    this.tools.active?.activate();

    this.emitter.emit("floorChanged", this.activeFloorId);
    this.emitter.emit("projectChanged", undefined);
    this.emitter.emit("projectLoaded", project);
  }

  /**
   * Connects (or disconnects) `nodeId` to another floor's navigation node.
   * Any existing navigation edge already linking nodeId — OR targetNodeId —
   * to a node on a different floor within the same building is replaced: at
   * most one cross-floor link is kept per node, matching how a stairs/
   * elevator connection is a single vertical link rather than a set. This is
   * enforced symmetrically from both endpoints at link-creation time (rather
   * than only from nodeId's side) so a single node can never end up with two
   * simultaneous cross-floor edges — e.g. linking floor-1 node A to floor-2
   * node B, then separately linking floor-3 node C to that same node B, must
   * drop the stale A-B edge, not leave B with two links. Passing
   * `targetNodeId: null` just removes the existing link.
   *
   * The new edge (when targetNodeId is given) is stored in the source node's
   * floor's navigation.edges array. Per core's mergeGraph docstring, edges
   * are collected across every floor in a building regardless of which
   * floor's array holds them, so this is purely a storage-location choice
   * made for consistency with NavigationTool, which always appends to the
   * active floor's edges.
   */
  linkFloorNode(nodeId: string, targetNodeId: string | null, edgeType: NavigationEdgeType): void {
    const source = this.findNodeLocation(nodeId);
    if (!source) return;
    const { building, floor: sourceFloor, node: sourceNode } = source;

    const existing = this.findCrossFloorEdge(building, sourceFloor, nodeId);
    const commands: Command[] = [];
    if (existing) commands.push(new DeleteNavigationEdgeCommand(existing.floor, existing.edge.id));

    if (targetNodeId) {
      const target = this.findNodeLocation(targetNodeId, building);
      if (target) {
        // targetNodeId may already carry its own cross-floor link (e.g. it
        // was previously linked from a different source node). That link
        // must be dropped too, otherwise targetNodeId would end up with two
        // simultaneous cross-floor edges, violating the "at most one per
        // node" invariant documented above. Guard against double-deleting
        // the same edge when nodeId and targetNodeId already share the one
        // link being replaced (e.g. relinking a node to its current partner
        // with a new edgeType).
        const existingOnTarget = this.findCrossFloorEdge(building, target.floor, targetNodeId);
        if (existingOnTarget && existingOnTarget.edge.id !== existing?.edge.id) {
          commands.push(
            new DeleteNavigationEdgeCommand(existingOnTarget.floor, existingOnTarget.edge.id),
          );
        }

        // Straight-line distance ignores the vertical travel of a real
        // stairs/elevator connection, but it's a deterministic default the
        // user can refine afterward (same convention NavigationTool/
        // NavigationEdgeTool already use for same-floor edges) rather than
        // leaving distance unset.
        const edgeDistance = distance(sourceNode.position, target.node.position);
        const edge = createNavigationEdge(nodeId, targetNodeId, edgeDistance, edgeType);
        commands.push(new AddNavigationEdgeCommand(sourceFloor, edge));
      }
    }

    if (commands.length) this.executeCommand(new CompoundCommand("Link Floor Node", commands));
  }

  /**
   * Empties every space/wall/entrance/POI/navigation node/edge on a floor
   * (the active floor by default) in one undoable step. Also drops any
   * cross-floor navigation edge (see linkFloorNode) stored on *another*
   * floor that links to a node being removed here — that other floor isn't
   * being cleared, so it would otherwise dangle.
   */
  clearFloor(floorId?: string): void {
    const floor = floorId
      ? this.project.buildings.flatMap((b) => b.floors).find((f) => f.id === floorId)
      : this.getActiveFloor();
    if (!floor) return;
    const isEmpty =
      !floor.spaces.length &&
      !floor.walls.length &&
      !floor.entrances.length &&
      !floor.pois.length &&
      !floor.furniture.length &&
      !floor.groups.length &&
      !floor.navigation.nodes.length &&
      !floor.navigation.edges.length;
    if (isEmpty) return;

    const commands: Command[] = [];
    const building = this.project.buildings.find((b) => b.floors.includes(floor));
    if (building) {
      const nodeIds = new Set(floor.navigation.nodes.map((n) => n.id));
      for (const otherFloor of building.floors) {
        if (otherFloor.id === floor.id) continue;
        for (const edge of otherFloor.navigation.edges) {
          if (nodeIds.has(edge.from) || nodeIds.has(edge.to)) {
            commands.push(new DeleteNavigationEdgeCommand(otherFloor, edge.id));
          }
        }
      }
    }
    commands.push(new ClearFloorCommand(floor));

    this.executeCommand(
      commands.length > 1 ? new CompoundCommand("Clear Floor", commands) : commands[0]!,
    );
  }

  /**
   * Bundles the current selection (2+ non-vertex entries) into a new named
   * Group and selects it. Ids already belonging to another group, or that
   * are themselves a group, are excluded — groups don't nest (v1). A no-op
   * if fewer than 2 groupable ids remain after that filtering.
   */
  groupSelection(label = "그룹"): void {
    const floor = this.getActiveFloor();
    if (!floor) return;
    const groupIds = new Set(floor.groups.map((g) => g.id));
    const alreadyGrouped = new Set(floor.groups.flatMap((g) => g.memberIds));
    const memberIds = [
      ...new Set(
        this.selection.current
          .filter((entry) => entry.vertexIndex === undefined)
          .map((entry) => entry.id)
          .filter((id) => !groupIds.has(id) && !alreadyGrouped.has(id)),
      ),
    ];
    if (memberIds.length < 2) return;

    const group = createGroup(floor.id, label, memberIds);
    this.executeCommand(new AddGroupCommand(floor, group));
    this.selection.select(group.id);
  }

  /** Dissolves the currently selected group (only) and re-selects its former members. A no-op unless the selection is exactly one group. */
  ungroupSelection(): void {
    const floor = this.getActiveFloor();
    if (!floor) return;
    const entries = this.selection.current;
    if (entries.length !== 1) return;
    const group = floor.groups.find((g) => g.id === entries[0]?.id);
    if (!group) return;

    this.executeCommand(new DeleteGroupCommand(floor, group.id));
    this.selection.clear();
    for (const memberId of group.memberIds) this.selection.add(memberId);
  }

  /**
   * Deletes whatever is currently selected — the same operation SelectTool
   * runs for the Delete/Backspace key, exposed here so a host UI can offer
   * an explicit delete button (e.g. in a property panel) instead of relying
   * on the keyboard shortcut alone. A no-op if nothing is selected.
   */
  deleteSelection(): void {
    this.tools.active?.deactivate();
    this.tools.active?.activate();

    const floor = this.getActiveFloor();
    if (!floor) return;
    const entry = this.selection.current[0];
    if (!entry) return;

    if (entry.vertexIndex !== undefined) {
      const space = floor.spaces.find((s) => s.id === entry.id);
      if (space && space.polygon.length > 3) {
        this.executeCommand(new DeleteVertexCommand(space, entry.vertexIndex));
        this.selection.select(space.id);
      }
      return;
    }

    const kind = findObjectKind(floor, entry.id);
    if (!kind) return;
    const commands: Command[] = [
      buildDeleteCommand(
        floor,
        entry.id,
        kind,
        (nodeId) => this.findNodeLocation(nodeId)?.building.floors,
      ),
    ];
    if (kind !== "group") commands.push(...stripFromGroups(floor, entry.id));
    this.executeCommand(
      commands.length > 1 ? new CompoundCommand("Delete", commands) : commands[0]!,
    );
    this.selection.clear();
  }

  /** Finds which building/floor a navigation node belongs to, optionally restricted to one building. */
  private findNodeLocation(
    nodeId: string,
    withinBuilding?: Building,
  ): { building: Building; floor: Floor; node: Floor["navigation"]["nodes"][number] } | null {
    const buildings = withinBuilding ? [withinBuilding] : this.project.buildings;
    for (const building of buildings) {
      for (const floor of building.floors) {
        const node = floor.navigation.nodes.find((n) => n.id === nodeId);
        if (node) return { building, floor, node };
      }
    }
    return null;
  }

  /** Finds an existing navigation edge connecting nodeId to a node on a *different* floor of the same building. */
  private findCrossFloorEdge(
    building: Building,
    sourceFloor: Floor,
    nodeId: string,
  ): { floor: Floor; edge: NavigationEdge } | null {
    for (const floor of building.floors) {
      for (const edge of floor.navigation.edges) {
        if (edge.from !== nodeId && edge.to !== nodeId) continue;
        const otherId = edge.from === nodeId ? edge.to : edge.from;
        const otherOnDifferentFloor = building.floors.some(
          (f) => f.id !== sourceFloor.id && f.navigation.nodes.some((n) => n.id === otherId),
        );
        if (otherOnDifferentFloor) return { floor, edge };
      }
    }
    return null;
  }

  private afterHistoryChange(): void {
    if (!this.getActiveFloor()) {
      const floor = this.project.buildings.flatMap((building) => building.floors)[0];
      if (floor) this.setFloor(floor.id);
      else {
        this.activeFloorId = null;
        this.emitter.emit("floorChanged", null);
      }
    }
    this.selection.clear();
    this.routePreview.clear();
    this.emitter.emit("projectChanged", undefined);
  }

  handlePointerDown(event: EditorPointerEvent): void {
    this.tools.dispatchPointerDown(event);
  }

  handlePointerMove(event: EditorPointerEvent): void {
    this.tools.dispatchPointerMove(event);
  }

  handlePointerUp(event: EditorPointerEvent): void {
    this.tools.dispatchPointerUp(event);
  }

  handleKeyDown(event: EditorKeyboardEvent): void {
    this.tools.dispatchKeyDown(event);
  }

  on<K extends keyof IndoorEditorEvents>(
    event: K,
    handler: (payload: IndoorEditorEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, handler);
  }

  off<K extends keyof IndoorEditorEvents>(
    event: K,
    handler: (payload: IndoorEditorEvents[K]) => void,
  ): void {
    this.emitter.off(event, handler);
  }
}
