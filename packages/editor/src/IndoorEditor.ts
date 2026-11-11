import {
  buildingToSite,
  createConnector,
  createFloor,
  createSite,
  planFloorLinkConversion,
  createGroup,
  createNavigationEdge,
  distance,
  isPointInSpace,
  siteRoutingEdges,
  type Building,
  type BuildingPlacement,
  type Connector,
  type ConnectorType,
  type Floor,
  type IndoorProject,
  type NavigationEdge,
  type NavigationEdgeType,
  type Point,
  type Site,
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
import { buildDeleteSelectionCommand } from "./commands/buildDeleteCommand.js";
import { CompoundCommand } from "./commands/CompoundCommand.js";
import { ClearFloorCommand } from "./commands/ClearFloorCommand.js";
import {
  AddConnectorCommand,
  DeleteConnectorCommand,
  connectorCleanupCommands,
} from "./commands/ConnectorCommands.js";
import { ChangePropertyCommand } from "./commands/PropertyCommands.js";
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
import { HoleTool } from "./tools/HoleTool.js";
import { SiteBuildingTool } from "./tools/SiteBuildingTool.js";
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
  /** A tool refused an action; the code says why ("hole-no-space", "hole-invalid"). */
  toolNotice: string;
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
  private sitePlaneCache: { site: Site; floor: Floor } | null = null;
  readonly siteBuildingTool: SiteBuildingTool;
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
    // Edge/orthogonal snaps lock one axis; with the grid on they round the
    // other one to it, so they can't pull points off the grid.
    const gridSize = () => this.gridSnap.activeGridSize();
    this.snapping.register(new EdgeSnap(undefined, gridSize));
    this.snapping.register(new OrthogonalSnap(undefined, gridSize));
    this.snapping.register(this.gridSnap);

    const toolContext: ToolContext = {
      getActiveFloor: () => this.getActiveFloor(),
      camera: this.camera,
      selection: this.selection,
      snapping: this.snapping,
      executeCommand: (command) => this.executeCommand(command),
      requestRender: () => this.emitter.emit("projectChanged", undefined),
      findNodeBuilding: (nodeId) => this.nodeEdgeFloors(nodeId),
      findFloorBuilding: (floorId) => this.findFloorBuilding(floorId),
    };

    this.tools = new ToolManager();
    this.tools.register(new PanTool(toolContext));
    this.tools.register(new SelectTool(toolContext));
    this.tools.register(new DraftReviewTool(toolContext, this.draft));
    this.tools.register(new PolygonTool(toolContext));
    this.tools.register(
      new HoleTool(toolContext, (reason) =>
        this.emitter.emit("toolNotice", reason === "no-space" ? "hole-no-space" : "hole-invalid"),
      ),
    );
    this.siteBuildingTool = new SiteBuildingTool(
      toolContext,
      () => this.project.buildings,
      (building, placement) => this.placementCommand(building, placement),
    );
    this.tools.register(this.siteBuildingTool);
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
    if (this.project.site?.id === this.activeFloorId) return this.getSitePlane();
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
    // A connector isn't drawn itself: focus one of its stop nodes, whose
    // property panel shows the connector card where the problem gets fixed.
    const connector = this.findConnector(id);
    if (connector) {
      const stopNode = connector.connector.stops
        .map((stop) => stop.nodeId)
        .find((nodeId) => this.findNodeLocation(nodeId, connector.building));
      if (stopNode) this.focusObject(stopNode);
      return;
    }

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
      commands.push(...connectorCleanupCommands(building, { floorIds: new Set([floor.id]) }));
      const plane = this.getSitePlane();
      if (plane) {
        for (const edge of plane.navigation.edges) {
          if (nodeIds.has(edge.from) || nodeIds.has(edge.to)) {
            commands.push(new DeleteNavigationEdgeCommand(plane, edge.id));
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
    const entries = this.selection.current;
    const entry = entries[0];
    if (!entry) return;

    if (entries.length === 1 && entry.vertexIndex !== undefined) {
      const space = floor.spaces.find((s) => s.id === entry.id);
      if (space && space.polygon.length > 3) {
        this.executeCommand(new DeleteVertexCommand(space, entry.vertexIndex));
        this.selection.select(space.id);
      }
      return;
    }

    const command = buildDeleteSelectionCommand(
      floor,
      entries.filter((e) => e.vertexIndex === undefined).map((e) => e.id),
      (nodeId) => this.nodeEdgeFloors(nodeId),
      (floorId) => this.findFloorBuilding(floorId),
    );
    if (!command) return;
    this.executeCommand(command);
    this.selection.clear();
  }

  // ---- Site (campus) and georeference ----

  /** Creates the project's site if it has none (named after the project) and returns it. */
  ensureSite(): Site {
    if (!this.project.site) {
      this.executeCommand(
        new ChangePropertyCommand(this.project, "site", createSite(this.project.name), "Add Site"),
      );
    }
    return this.project.site!;
  }

  /** Sets one site field (name, geoAnchor, address…) as an undoable step. */
  updateSite<K extends keyof Site>(key: K, value: Site[K]): void {
    const site = this.ensureSite();
    this.executeCommand(new ChangePropertyCommand(site, key, value, "Edit Site"));
  }

  /** Places a building in the site frame (origin in meters, bearing in degrees); undefined resets it. */
  setBuildingPlacement(buildingId: string, placement: BuildingPlacement | undefined): void {
    const building = this.project.buildings.find((b) => b.id === buildingId);
    if (!building) return;
    this.executeCommand(this.placementCommand(building, placement));
  }

  /**
   * Moving/rotating a building moves its entrances in the site frame, so the
   * stored length of every outdoor link to it changes too. One undo step
   * covers both, keeping saved data consistent with the routing graph (which
   * re-measures these links anyway — see siteRoutingEdges).
   */
  private placementCommand(building: Building, placement: BuildingPlacement | undefined): Command {
    const place = new ChangePropertyCommand(building, "placement", placement, "Place Building");
    const site = this.project.site;
    if (!site?.navigation.edges.length) return place;
    // Measure against the new placement, then restore it for the command to apply.
    const previous = building.placement;
    place.execute();
    const updated = new Map(siteRoutingEdges(this.project).map((e) => [e.id, e.distance]));
    place.undo();
    if (previous === undefined) delete building.placement;
    const commands: Command[] = [place];
    for (const edge of site.navigation.edges) {
      const length = updated.get(edge.id);
      if (length !== undefined && length !== edge.distance)
        commands.push(new ChangePropertyCommand(edge, "distance", length, "Update Link Length"));
    }
    return commands.length === 1 ? place : new CompoundCommand("Place Building", commands);
  }

  // ---- Site view: the outdoor graph edited like a floor ----

  /**
   * The site's outdoor graph presented as a Floor, so the ordinary select /
   * navigation tools and delete logic work on it unchanged. Its `navigation`
   * IS `site.navigation` (same object), so every edit lands in the site; the
   * other collections are empty and unused. Rebuilt when the site changes.
   */
  getSitePlane(): Floor | undefined {
    const site = this.project.site;
    if (!site) return undefined;
    const cached = this.sitePlaneCache;
    if (!cached || cached.site !== site || cached.floor.navigation !== site.navigation) {
      const floor = createFloor(site.name, 0, 0);
      floor.id = site.id;
      floor.navigation = site.navigation;
      this.sitePlaneCache = { site, floor };
    }
    this.sitePlaneCache!.floor.name = site.name;
    return this.sitePlaneCache!.floor;
  }

  /** True while the site (campus outdoor) plane is the active "floor". */
  isSiteView(): boolean {
    return !!this.project.site && this.activeFloorId === this.project.site.id;
  }

  /** Switches to the site plane, creating the site first if the project has none. */
  enterSiteView(): void {
    const site = this.ensureSite();
    this.setFloor(site.id);
    this.setTool("site-building");
  }

  /** Building navigation nodes an outdoor node can link to, labeled for pickers. */
  siteLinkTargets(): Array<{ nodeId: string; buildingId: string; label: string; type: string }> {
    const targets: Array<{ nodeId: string; buildingId: string; label: string; type: string }> = [];
    for (const building of this.project.buildings) {
      for (const floor of building.floors) {
        for (const node of floor.navigation.nodes) {
          targets.push({
            nodeId: node.id,
            buildingId: building.id,
            label: `${building.name} · ${floor.name} · ${node.name?.trim() || node.id.slice(0, 6)}`,
            type: node.type,
          });
        }
      }
    }
    return targets;
  }

  /** Site edges between this outdoor node and building nodes. */
  siteLinksOf(siteNodeId: string): Array<{ edgeId: string; nodeId: string }> {
    const site = this.project.site;
    if (!site) return [];
    const outdoor = new Set(site.navigation.nodes.map((n) => n.id));
    const links: Array<{ edgeId: string; nodeId: string }> = [];
    for (const edge of site.navigation.edges) {
      if (edge.from === siteNodeId && !outdoor.has(edge.to)) {
        links.push({ edgeId: edge.id, nodeId: edge.to });
      } else if (edge.to === siteNodeId && !outdoor.has(edge.from)) {
        links.push({ edgeId: edge.id, nodeId: edge.from });
      }
    }
    return links;
  }

  /** Building node position in site coordinates (through its building's placement). */
  siteNodePosition(nodeId: string): Point | null {
    const site = this.project.site;
    const outdoor = site?.navigation.nodes.find((n) => n.id === nodeId);
    if (outdoor) return outdoor.position;
    const location = this.findNodeLocation(nodeId);
    return location ? buildingToSite(location.building, location.node.position) : null;
  }

  /**
   * Links an outdoor node to a building node (typically an entrance) with a
   * walk edge stored in the site graph. Distance is measured in site
   * coordinates, so place the building first.
   */
  linkSiteNode(siteNodeId: string, buildingNodeId: string): void {
    const plane = this.getSitePlane();
    const from = this.siteNodePosition(siteNodeId);
    const to = this.siteNodePosition(buildingNodeId);
    if (!plane || !from || !to) return;
    if (this.siteLinksOf(siteNodeId).some((link) => link.nodeId === buildingNodeId)) return;
    const edge = createNavigationEdge(siteNodeId, buildingNodeId, distance(from, to));
    this.executeCommand(new AddNavigationEdgeCommand(plane, edge));
  }

  removeSiteEdge(edgeId: string): void {
    const plane = this.getSitePlane();
    if (plane) this.executeCommand(new DeleteNavigationEdgeCommand(plane, edgeId));
  }

  // ---- Holes ----

  /** Removes one hole from a space (undoable). */
  removeHole(spaceId: string, holeIndex: number): void {
    const space = this.project.buildings
      .flatMap((b) => b.floors)
      .flatMap((f) => f.spaces)
      .find((s) => s.id === spaceId);
    if (!space?.holes?.[holeIndex]) return;
    const holes = space.holes.filter((_, i) => i !== holeIndex);
    this.executeCommand(
      new ChangePropertyCommand(space, "holes", holes.length ? holes : undefined, "Remove Hole"),
    );
  }

  // ---- Converting hand-drawn cross-floor links into connectors ----

  /**
   * Replaces hand-drawn cross-floor edges with connectors, in one undoable
   * step (see planFloorLinkConversion). With `nodeId`, only that node's chain
   * is converted. Returns how many connectors were created and which groups
   * were left alone and why (two nodes on one floor, or one-way links a
   * connector can't express).
   */
  convertFloorLinksToConnectors(nodeId?: string): {
    created: number;
    skipped: number;
    reasons: Array<"multiple-nodes-on-floor" | "one-way-ambiguous">;
  } {
    const buildings = nodeId
      ? [this.findNodeLocation(nodeId)?.building].filter((b): b is Building => !!b)
      : this.project.buildings;
    const commands: Command[] = [];
    let created = 0;
    let skipped = 0;
    const reasons: Array<"multiple-nodes-on-floor" | "one-way-ambiguous"> = [];
    for (const building of buildings) {
      const plan = planFloorLinkConversion(building, nodeId);
      skipped += plan.skipped.length;
      reasons.push(...plan.skipped.map((s) => s.reason));
      for (const conversion of plan.conversions) {
        for (const { floorId, edgeId } of conversion.edges) {
          const floor = building.floors.find((f) => f.id === floorId);
          if (floor) commands.push(new DeleteNavigationEdgeCommand(floor, edgeId));
        }
        const stops = conversion.stops.map((stop) => {
          const floor = building.floors.find((f) => f.id === stop.floorId)!;
          return this.stopFor(floor, stop.nodeId);
        });
        const connector = createConnector(conversion.type, stops, conversion.accessible);
        if (conversion.direction) connector.direction = conversion.direction;
        commands.push(new AddConnectorCommand(building, connector));
        created++;
      }
    }
    if (commands.length) {
      this.executeCommand(new CompoundCommand("Convert Floor Links", commands));
    }
    return { created, skipped, reasons };
  }

  // ---- Connectors (elevators, stairs, escalators, ramps) ----

  /** The building that owns a floor. */
  findFloorBuilding(floorId: string): Building | undefined {
    return this.project.buildings.find((b) => b.floors.some((f) => f.id === floorId));
  }

  /** Connectors with a stop at this navigation node, with their building. */
  connectorsAtNode(nodeId: string): Array<{ building: Building; connector: Connector }> {
    const result: Array<{ building: Building; connector: Connector }> = [];
    for (const building of this.project.buildings) {
      for (const connector of building.connectors ?? []) {
        if (connector.stops.some((stop) => stop.nodeId === nodeId)) {
          result.push({ building, connector });
        }
      }
    }
    return result;
  }

  /** Finds a connector by id anywhere in the project. */
  findConnector(connectorId: string): { building: Building; connector: Connector } | null {
    for (const building of this.project.buildings) {
      const connector = building.connectors?.find((c) => c.id === connectorId);
      if (connector) return { building, connector };
    }
    return null;
  }

  /**
   * Creates a connector whose first stop is this node (and the space it
   * stands in, when it's an elevator/stairs space). Returns it, or null when
   * the node doesn't exist.
   */
  createConnectorAtNode(nodeId: string, type: ConnectorType, name?: string): Connector | null {
    const location = this.findNodeLocation(nodeId);
    if (!location) return null;
    const connector = createConnector(type, [this.stopFor(location.floor, nodeId)]);
    if (name) connector.name = name;
    this.executeCommand(new AddConnectorCommand(location.building, connector));
    return connector;
  }

  /**
   * Adds (or moves) the connector's stop on the node's floor. A connector
   * stops at most once per floor, so an existing stop there is replaced.
   */
  addConnectorStop(connectorId: string, nodeId: string): void {
    const found = this.findConnector(connectorId);
    const location = this.findNodeLocation(nodeId, found?.building);
    if (!found || !location) return;
    const stops = found.connector.stops.filter((stop) => stop.floorId !== location.floor.id);
    stops.push(this.stopFor(location.floor, nodeId));
    this.executeCommand(
      new ChangePropertyCommand(found.connector, "stops", stops, "Add Connector Stop"),
    );
  }

  removeConnectorStop(connectorId: string, nodeId: string): void {
    const found = this.findConnector(connectorId);
    if (!found) return;
    const stops = found.connector.stops.filter((stop) => stop.nodeId !== nodeId);
    if (stops.length === found.connector.stops.length) return;
    this.executeCommand(
      new ChangePropertyCommand(found.connector, "stops", stops, "Remove Connector Stop"),
    );
  }

  /** Sets one connector field (name, type, accessible, direction, spec…) as an undoable step. */
  updateConnector<K extends keyof Connector>(
    connectorId: string,
    key: K,
    value: Connector[K],
  ): void {
    const found = this.findConnector(connectorId);
    if (!found) return;
    this.executeCommand(new ChangePropertyCommand(found.connector, key, value, "Edit Connector"));
  }

  deleteConnector(connectorId: string): void {
    const found = this.findConnector(connectorId);
    if (!found) return;
    this.executeCommand(new DeleteConnectorCommand(found.building, connectorId));
  }

  private stopFor(floor: Floor, nodeId: string): Connector["stops"][number] {
    const node = floor.navigation.nodes.find((n) => n.id === nodeId);
    const shaft = node
      ? floor.spaces.find(
          (space) =>
            (space.type === "elevator" || space.type === "stairs") &&
            isPointInSpace(space, node.position),
        )
      : undefined;
    return shaft ? { floorId: floor.id, nodeId, spaceId: shaft.id } : { floorId: floor.id, nodeId };
  }

  /**
   * Every graph that may store an edge touching this node: its building's
   * floors (cross-floor links) plus the site plane (outdoor links to
   * entrances) — so deleting a node also drops those edges.
   */
  private nodeEdgeFloors(nodeId: string): readonly Floor[] | undefined {
    const floors = this.findNodeLocation(nodeId)?.building.floors;
    const plane = this.getSitePlane();
    if (!plane) return floors;
    return floors ? [...floors, plane] : [plane];
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
