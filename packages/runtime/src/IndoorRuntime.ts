import {
  findShortestPath,
  mergeProjectNavigationGraph,
  type Floor,
  type IndoorProject,
  type PathfindingOptions,
  type PathResult,
  type Point,
} from "@indoor/core";
import { RuntimeCamera, type RuntimeCameraState } from "./camera/RuntimeCamera.js";
import { EventEmitter } from "./events/EventEmitter.js";
import { hitTest, HIT_RADIUS_PX } from "./hitTest.js";
import { render2d } from "./render/render2d.js";
import { Renderer3D, type RoutePlaybackOptions } from "./render/Renderer3D.js";
import type { RuntimeEventMap } from "./events.js";
import type { Overlay } from "./overlay.js";
import type { RuntimeTheme } from "./theme.js";

export type CameraMode = "2d" | "3d";

export interface IndoorRuntimeOptions {
  container: HTMLElement | string;
  project?: IndoorProject;
}

function resolveContainer(container: HTMLElement | string): HTMLElement {
  if (typeof container === "string") {
    const element = document.querySelector(container);
    if (!element) throw new Error(`IndoorRuntime: container "${container}" was not found.`);
    return element as HTMLElement;
  }
  return container;
}

/**
 * Plays back an IndoorProject — no editing capability, no dependency on
 * @indoor/editor (spec §19-23). Same map data drives both the 2D canvas and
 * the 3D (Three.js) renderer; setCameraMode() swaps which one is visible.
 */
export class IndoorRuntime {
  readonly camera = new RuntimeCamera();

  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private renderer3d: Renderer3D | null = null;
  private readonly emitter = new EventEmitter<RuntimeEventMap>();
  private resizeObserver: ResizeObserver | null = null;

  private project: IndoorProject | null = null;
  private activeFloorId: string | null = null;
  private cameraMode: CameraMode = "2d";
  private overlays: Overlay[] = [];
  private route: PathResult | null = null;
  private hoveredId: string | null = null;

  private dragging = false;
  private lastPointerScreen: Point | null = null;
  private interaction = { pan: true, zoom: true, rotate: true };
  private theme: RuntimeTheme = {};

  constructor(options: IndoorRuntimeOptions) {
    this.container = resolveContainer(options.container);

    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.touchAction = "none";
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
    }
    this.resize();

    this.canvas.addEventListener("click", this.handleClick);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointerleave", this.handlePointerUp);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });

    if (options.project) void this.load(options.project);
  }

  async load(project: IndoorProject): Promise<void> {
    this.project = project;
    this.activeFloorId = project.buildings[0]?.floors[0]?.id ?? null;
    this.route = null;
    this.overlays = [];
    this.emitter.emit("map.loaded", { project });
    this.render();
  }

  start(): void {
    this.render();
  }

  fitView3D(): void { this.renderer3d?.fitView(); }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener("click", this.handleClick);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointerleave", this.handlePointerUp);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.container.removeChild(this.canvas);
    this.renderer3d?.dispose();
  }

  getActiveFloor(): Floor | undefined {
    if (!this.project || !this.activeFloorId) return undefined;
    for (const building of this.project.buildings) {
      const floor = building.floors.find((f) => f.id === this.activeFloorId);
      if (floor) return floor;
    }
    return undefined;
  }

  setFloor(floorId: string): void {
    if (this.activeFloorId === floorId) return;
    this.activeFloorId = floorId;
    this.renderer3d?.stopRoute();
    this.emitter.emit("floor.changed", { floorId });
    this.render();
  }

  setCameraMode(mode: CameraMode): void {
    if (mode === this.cameraMode) return;

    if (mode === "3d") {
      if (!this.renderer3d) {
        this.renderer3d = new Renderer3D(this.container, {
          onSpaceClick: (space) => this.emitter.emit("space.click", { space }),
          onPoiClick: (poi) => this.emitter.emit("poi.click", { poi }),
          onPoiHover: (poi) => this.emitter.emit("poi.hover", { poi }),
          onMarkerClick: (overlay) => this.emitter.emit("marker.click", { markerId: overlay.id }),
        });
        const rect = this.container.getBoundingClientRect();
        this.renderer3d.resize(rect.width, rect.height);
        this.renderer3d.setControlsEnabled(this.interaction);
        this.renderer3d.setTheme(this.theme);
      }
      this.canvas.style.display = "none";
      this.renderer3d.getDomElement().style.display = "block";
    } else {
      this.renderer3d?.getDomElement().style.setProperty("display", "none");
      this.canvas.style.display = "block";
    }

    this.cameraMode = mode;
    this.emitter.emit("camera.changed", { mode, state: this.camera.getState() });
    this.render();
  }

  addOverlay(overlay: Overlay): void {
    this.overlays.push(overlay);
    this.render();
  }

  removeOverlay(id: string): void {
    const index = this.overlays.findIndex((o) => o.id === id);
    if (index !== -1) this.overlays.splice(index, 1);
    this.render();
  }

  getOverlays(): readonly Overlay[] {
    return this.overlays;
  }

  /** Sets the camera directly (e.g. from a Builder "Move Camera" action) and re-renders. */
  setCameraState(state: RuntimeCameraState): void {
    this.camera.setState(state);
    this.emitter.emit("camera.changed", { mode: this.cameraMode, state: this.camera.getState() });
    this.render();
  }

  /** Enables/disables end-user pan, zoom, and rotate gestures (Builder camera toggles). */
  setInteractionOptions(options: Partial<{ pan: boolean; zoom: boolean; rotate: boolean }>): void {
    this.interaction = { ...this.interaction, ...options };
    this.renderer3d?.setControlsEnabled(this.interaction);
  }

  /** Applies visual theme overrides (Builder "Theme" setting, spec §25) to whichever renderer is active. */
  setTheme(theme: RuntimeTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.renderer3d?.setTheme(this.theme);
    this.render();
  }

  /** Computes the shortest route across the whole project's navigation graph and displays it. */
  startRoute(fromNodeId: string, toNodeId: string, options: PathfindingOptions = {}): PathResult | null {
    if (!this.project) return null;
    const graph = mergeProjectNavigationGraph(this.project);
    this.route = findShortestPath(graph, fromNodeId, toNodeId, options);
    this.emitter.emit("route.started", { fromNodeId, toNodeId });
    this.render();
    return this.route;
  }

  /**
   * Plays a moving-marker/camera-flythrough animation along the currently
   * held route (from `startRoute`), switching to the 3D view if needed —
   * playback only exists in the 3D renderer. Available from any host: the
   * Studio 3D preview, an exported app, or a Builder `route.playAnimation`
   * rule (see @indoor/builder's action vocabulary).
   */
  playRouteAnimation(options?: RoutePlaybackOptions): void {
    this.setCameraMode("3d");
    this.renderer3d?.playRoute(this.computeRoutePoints(), options ?? {});
  }

  stopRouteAnimation(): void {
    this.renderer3d?.stopRoute();
  }

  isPlayingRouteAnimation(): boolean {
    return this.renderer3d?.isRoutePlaying() ?? false;
  }

  clearRoute(): void {
    if (!this.route) return;
    this.route = null;
    this.renderer3d?.stopRoute();
    this.emitter.emit("route.finished", {});
    this.render();
  }

  on<K extends keyof RuntimeEventMap>(
    event: K,
    handler: (payload: RuntimeEventMap[K]) => void,
  ): () => void {
    return this.emitter.on(event, handler);
  }

  off<K extends keyof RuntimeEventMap>(
    event: K,
    handler: (payload: RuntimeEventMap[K]) => void,
  ): void {
    this.emitter.off(event, handler);
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.setViewportSize({ width: rect.width, height: rect.height });
    this.renderer3d?.resize(rect.width, rect.height);
    this.render();
  }

  private toScreenPoint(evt: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  private readonly handleClick = (evt: MouseEvent): void => {
    const floor = this.getActiveFloor();
    if (!floor) return;

    const point = this.camera.screenToWorld(this.toScreenPoint(evt));
    const hitRadiusWorld = HIT_RADIUS_PX / this.camera.getState().zoom;
    const hit = hitTest(point, floor, this.overlays, hitRadiusWorld);
    if (!hit) return;

    if (hit.kind === "marker") this.emitter.emit("marker.click", { markerId: hit.overlay.id });
    else if (hit.kind === "poi") this.emitter.emit("poi.click", { poi: hit.poi });
    else this.emitter.emit("space.click", { space: hit.space });
  };

  private readonly handlePointerDown = (evt: PointerEvent): void => {
    if (!this.interaction.pan) return;
    this.dragging = true;
    this.lastPointerScreen = this.toScreenPoint(evt);
  };

  private readonly handlePointerUp = (): void => {
    this.dragging = false;
    this.lastPointerScreen = null;
  };

  private readonly handlePointerMove = (evt: PointerEvent): void => {
    if (this.dragging && this.lastPointerScreen) {
      const current = this.toScreenPoint(evt);
      const delta = { x: current.x - this.lastPointerScreen.x, y: current.y - this.lastPointerScreen.y };
      this.camera.panByScreenDelta(delta);
      this.lastPointerScreen = current;
      this.emitter.emit("camera.changed", { mode: this.cameraMode, state: this.camera.getState() });
      this.render();
      return;
    }

    const floor = this.getActiveFloor();
    if (!floor) return;

    const point = this.camera.screenToWorld(this.toScreenPoint(evt));
    const hitRadiusWorld = HIT_RADIUS_PX / this.camera.getState().zoom;
    const hit = hitTest(point, floor, this.overlays, hitRadiusWorld);
    const newHoveredId = hit?.kind === "poi" ? hit.poi.id : hit?.kind === "marker" ? hit.overlay.id : null;

    if (newHoveredId !== this.hoveredId) {
      this.hoveredId = newHoveredId;
      this.emitter.emit("poi.hover", { poi: hit?.kind === "poi" ? hit.poi : null });
      this.render();
    }
  };

  private readonly handleWheel = (evt: WheelEvent): void => {
    evt.preventDefault();
    if (!this.interaction.zoom) return;
    const pivot = this.toScreenPoint(evt);
    const factor = evt.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.camera.zoomBy(factor, pivot);
    this.emitter.emit("camera.changed", { mode: this.cameraMode, state: this.camera.getState() });
    this.render();
  };

  private computeRoutePoints(): Array<Point | null> {
    const floor = this.getActiveFloor();
    if (!this.route || !floor) return [];
    return this.route.nodeIds.map((id) => {
      const node = floor.navigation.nodes.find((n) => n.id === id);
      return node ? node.position : null;
    });
  }

  private render(): void {
    if (this.cameraMode === "3d") {
      this.renderer3d?.update({
        floor: this.getActiveFloor(),
        overlays: this.overlays,
        routePoints: this.computeRoutePoints(),
      });
      return;
    }
    if (!this.ctx) return;
    render2d(this.ctx, {
      floor: this.getActiveFloor(),
      camera: this.camera,
      overlays: this.overlays,
      hoveredId: this.hoveredId,
      routePoints: this.computeRoutePoints(),
      theme: this.theme,
    });
  }
}
