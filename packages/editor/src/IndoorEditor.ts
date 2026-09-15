import { createSpace, createWall, type Floor, type IndoorProject, type Point } from "@indoor/core";
import type { Command } from "./commands/Command.js";
import { AddSpaceCommand } from "./commands/SpaceCommands.js";
import { AddWallCommand } from "./commands/WallCommands.js";
import { CompoundCommand } from './commands/CompoundCommand.js';
import { DraftReviewTool } from './tools/DraftReviewTool.js';
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
  readonly project: IndoorProject;
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

  private readonly emitter = new EventEmitter<IndoorEditorEvents>();
  private activeFloorId: string | null = null;

  constructor(options: IndoorEditorOptions) {
    this.project = options.project;
    this.selection = new SelectionManager((entries) =>
      this.emitter.emit("selectionChanged", entries),
    );
    this.reference = new ReferenceManager(() => this.emitter.emit("projectChanged", undefined));
    this.draft = new DraftManager(() => this.emitter.emit("projectChanged", undefined));
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
    };

    this.tools = new ToolManager();
    this.tools.register(new PanTool(toolContext));
    this.tools.register(new SelectTool(toolContext));
    this.tools.register(new DraftReviewTool(toolContext, this.draft));
    this.tools.register(new PolygonTool(toolContext));
    this.tools.register(new WallTool(toolContext));
    this.tools.register(new DoorTool(toolContext));
    this.tools.register(new POITool(toolContext));
    this.tools.register(new NavigationNodeTool(toolContext));
    this.tools.register(new NavigationEdgeTool(toolContext));
    this.tools.register(new NavigationTool(toolContext));
    this.tools.register(
      new CalibrateTool(toolContext, (a, b) => this.emitter.emit("calibrationPointsPicked", { a, b })),
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
    return {
      ...this.project,
      buildings: this.project.buildings.map(building => ({
        ...building,
        floors: building.floors.map(floor => floor.id !== floorId ? floor : {
          ...floor,
          walls: [...floor.walls, ...draft.walls.filter(w => w.accepted).map(w => ({
            ...createWall(floor.id, { ...w.start }, { ...w.end }, w.thickness), id: w.id,
          }))],
          spaces: [...floor.spaces, ...draft.spaces.filter(s => s.accepted).map(s => ({
            ...createSpace(floor.id, s.polygon.map(p => ({ ...p }))), id: s.id,
          }))],
        }),
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

    for (const entry of draft.walls) {
      if (!entry.accepted) continue;
      const wall = createWall(floor.id, entry.start, entry.end, entry.thickness);
      commands.push(new AddWallCommand(floor, wall));
    }
    for (const entry of draft.spaces) {
      if (!entry.accepted) continue;
      const space = createSpace(floor.id, entry.polygon);
      commands.push(new AddSpaceCommand(floor, space));
    }

    if (commands.length) this.executeCommand(new CompoundCommand('Apply vectorization', commands));
    this.draft.clear();
    this.setTool('select');
  }

  undo(): void {
    this.tools.active?.deactivate();
    this.tools.active?.activate();
    if (this.tools.active?.id === 'draft-review') { this.draft.undo(); return; }
    if (this.history.undo()) this.afterHistoryChange();
  }

  redo(): void {
    this.tools.active?.deactivate();
    this.tools.active?.activate();
    if (this.tools.active?.id === 'draft-review') { this.draft.redo(); return; }
    if (this.history.redo()) this.afterHistoryChange();
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
