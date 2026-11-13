import {
  buildingSiteOutline,
  buildingToSite,
  buildRoutingGraph,
  createFloor,
  distance,
  distanceToSegment,
  edgeDuration,
  findPOIInProject,
  findRoute,
  prepareRoutingGraph,
  resolveRouteEndpoint,
  searchProject,
  type Floor,
  type IndoorProject,
  type PathfindingOptions,
  type PathResult,
  type Point,
  type PreparedRoutingGraph,
  type RouteEndpoint,
  type RoutingGraphOptions,
  type SearchOptions,
  type SearchResult,
} from "@indoor/core";
import { RuntimeCamera, type RuntimeCameraState } from "./camera/RuntimeCamera.js";
import { EventEmitter } from "./events/EventEmitter.js";
import { hitTest, HIT_RADIUS_PX } from "./hitTest.js";
import { render2d } from "./render/render2d.js";
import {
  Renderer3D,
  type RouteLeg,
  type RoutePlaybackOptions,
  type RoutePlaybackState,
} from "./render/Renderer3D.js";
import { routeObstaclesForFloor, type RouteCurveShape } from "./render/routePath.js";
import type { RuntimeEventMap } from "./events.js";
import { OVERLAY_SUPPORT, type Overlay } from "./overlay.js";
import type { RuntimeTheme } from "./theme.js";

export type CameraMode = "2d" | "3d";

/**
 * Something the runtime can display: a building floor, or the site's outdoor
 * plane (campus paths with building outlines). Both are selected with setFloor().
 */
export interface DisplayPlane {
  id: string;
  name: string;
  kind: "floor" | "site";
  /** Owning building, for floors. */
  buildingId?: string;
  buildingName?: string;
  level?: number;
}

interface RouteSpot {
  floorId: string;
  position: Point;
}

/**
 * A visitor's position from whatever positioning system the host uses (BLE,
 * Wi-Fi, UWB, QR check-ins…). `floorId` may be a floor id or the site id
 * (outdoor, site coordinates). Coordinates are in the plane's meters.
 */
export interface UserLocation {
  floorId: string;
  position: Point;
  /** Horizontal uncertainty radius in meters (widens arrival/off-route thresholds). */
  accuracy?: number;
  /** Degrees clockwise from the plane's +Y axis. */
  heading?: number;
}

/**
 * Adapter for a positioning provider. The runtime calls start() with a
 * callback when attached and stop() when detached or destroyed.
 */
export interface LocationProvider {
  start(onLocation: (location: UserLocation | null) => void): void;
  stop(): void;
}

export interface GuidanceOptions {
  /** Within this many meters of the route's end counts as arrived (default 5). */
  arrivalRadius?: number;
  /** Farther than this from the route line on its floor counts as off route (default 10). */
  offRouteDistance?: number;
}

/** Route search options plus the travel-time model for connectors (elevators, stairs…). */
export type RouteOptions = PathfindingOptions & RoutingGraphOptions;

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
  /** The query that produced `route`, so invalidate() can recompute it against the edited project. */
  private routeQuery: { from: RouteEndpoint; to: RouteEndpoint; options: RouteOptions } | null =
    null;
  /** Where the route really starts/ends when that isn't a node (a POI, a free position). */
  private routeEnds: { start: RouteSpot | null; end: RouteSpot | null } = {
    start: null,
    end: null,
  };
  /**
   * Routing graphs prepared for the loaded project, keyed by the options that
   * shape edge costs, so repeated startRoute calls (kiosks) skip rebuilding
   * the merged graph and adjacency. Cleared on load().
   */
  private routingGraphs = new Map<string, PreparedRoutingGraph>();
  /** The site's outdoor plane presented as a Floor (see sitePlane()); rebuilt on load/invalidate. */
  private sitePlaneCache: Floor | null = null;
  private destroyed = false;
  private hoveredId: string | null = null;
  private highlightedSpaceId: string | null = null;

  private dragging = false;
  private lastPointerScreen: Point | null = null;
  private interaction = { pan: true, zoom: true, rotate: true };
  private theme: RuntimeTheme = {};
  private routeShape: RouteCurveShape = "smooth";
  private userLocation: UserLocation | null = null;
  /** Drawn like a marker overlay; kept stable so renderers don't rebuild it needlessly. */
  private userLocationOverlay: Overlay | null = null;
  private locationProvider: LocationProvider | null = null;
  private guidance: Required<GuidanceOptions> = { arrivalRadius: 5, offRouteDistance: 10 };
  /** Per-route guidance state: arrival fires once; off-route fires once per excursion. */
  private guidanceState = { arrived: false, offRoute: false };

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

  /**
   * Shows a project. The runtime keeps a reference to `project` (it is not
   * copied): if you change it in place afterwards, call invalidate() so
   * routing and rendering pick the change up — or pass a new object to load().
   * Rejects once the runtime has been destroyed.
   */
  async load(project: IndoorProject): Promise<void> {
    if (this.destroyed) throw new Error("IndoorRuntime: load() called after destroy().");
    this.project = project;
    this.routingGraphs.clear();
    this.sitePlaneCache = null;
    this.renderer3d?.stopRoute();
    this.activeFloorId = project.buildings[0]?.floors[0]?.id ?? null;
    this.route = null;
    this.routeQuery = null;
    this.routeEnds = { start: null, end: null };
    this.overlays = [];
    this.emitter.emit("map.loaded", { project });
    this.render();
  }

  start(): void {
    this.render();
  }

  fitView3D(): void {
    this.renderer3d?.fitView();
  }

  /**
   * Call after mutating the loaded project in place: drops cached routing
   * graphs, falls back to the first floor if the active one was removed, and
   * redraws. Not needed after load().
   *
   * An active route is recomputed with its original endpoints and options so
   * the display never shows a path through removed edges/nodes/floors.
   * `route.recomputed` fires with the new route (or null — then the route is
   * cleared and `route.finished` fires too). Route playback is stopped, since
   * its legs were built from the old path.
   */
  invalidate(): void {
    if (this.destroyed || !this.project) return;
    this.routingGraphs.clear();
    this.sitePlaneCache = null;
    if (!this.getActiveFloor()) {
      this.activeFloorId = this.project.buildings[0]?.floors[0]?.id ?? null;
    }
    if (this.route && this.routeQuery) {
      this.renderer3d?.stopRoute();
      const { from, to, options } = this.routeQuery;
      const route = this.computeRoute(from, to, options);
      if (route) {
        this.route = route;
        this.routeEnds = { start: this.spotOf(from), end: this.spotOf(to) };
        this.emitter.emit("route.recomputed", { route });
      } else {
        this.route = null;
        this.routeQuery = null;
        this.routeEnds = { start: null, end: null };
        this.emitter.emit("route.recomputed", { route: null });
        this.emitter.emit("route.finished", {});
      }
    }
    this.render();
  }

  /** True after destroy(); the instance can't be reused. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Releases the canvas, listeners and WebGL resources. Safe to call more than once. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener("click", this.handleClick);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointerleave", this.handlePointerUp);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.canvas.remove();
    this.locationProvider?.stop();
    this.locationProvider = null;
    this.renderer3d?.dispose();
    this.renderer3d = null;
    this.route = null;
    this.routeQuery = null;
    this.routingGraphs.clear();
    this.overlays = [];
  }

  /**
   * The displayed plane as a Floor. For the site plane this is a synthesized
   * Floor whose `navigation` is the site graph and whose spaces are the
   * buildings' outlines (in site coordinates).
   */
  getActiveFloor(): Floor | undefined {
    return this.activeFloorId ? this.findPlane(this.activeFloorId) : undefined;
  }

  /** Every plane setFloor() accepts: the site first (when present), then each building's floors. */
  getPlanes(): DisplayPlane[] {
    if (!this.project) return [];
    const planes: DisplayPlane[] = [];
    const site = this.project.site;
    if (site) planes.push({ id: site.id, name: site.name, kind: "site" });
    for (const building of this.project.buildings) {
      for (const floor of building.floors) {
        planes.push({
          id: floor.id,
          name: floor.name,
          kind: "floor",
          buildingId: building.id,
          buildingName: building.name,
          level: floor.level,
        });
      }
    }
    return planes;
  }

  /** True while the site's outdoor plane is displayed. */
  isSiteView(): boolean {
    return !!this.project?.site && this.activeFloorId === this.project.site.id;
  }

  /**
   * Switches the displayed floor — a building floor id, or the site id for the
   * outdoor plane. Returns false (and changes nothing) when no such plane exists.
   */
  setFloor(floorId: string): boolean {
    if (this.destroyed) return false;
    if (this.activeFloorId === floorId) return true;
    if (!this.findPlane(floorId)) return false;
    this.activeFloorId = floorId;
    this.renderer3d?.stopRoute();
    this.emitter.emit("floor.changed", { floorId });
    this.render();
    return true;
  }

  /**
   * Shows `position` on plane `floorId`: switches to that floor (or the site)
   * first, then centers the 2D camera and pans the 3D view there. Returns
   * false when the plane doesn't exist.
   */
  focusPosition(floorId: string, position: Point): boolean {
    if (this.destroyed || !this.setFloor(floorId)) return false;
    const state = this.camera.getState();
    this.camera.setState({ ...state, center: { ...position } });
    this.renderer3d?.focusPoint(position);
    this.emitter.emit("camera.changed", { mode: this.cameraMode, state: this.camera.getState() });
    this.render();
    return true;
  }

  /** Focuses a POI on whatever floor it is on (see focusPosition). False if it doesn't exist. */
  focusPOI(poiId: string): boolean {
    const found = this.project ? findPOIInProject(this.project, poiId) : null;
    return found ? this.focusPosition(found.floor.id, found.poi.position) : false;
  }

  /** No-op after destroy(): it would otherwise create a fresh WebGL renderer nobody disposes. */
  setCameraMode(mode: CameraMode): void {
    if (this.destroyed || mode === this.cameraMode) return;

    if (mode === "3d") {
      if (!this.renderer3d) {
        try {
          this.renderer3d = new Renderer3D(this.container, {
            onSpaceClick: (space) => this.emitter.emit("space.click", { space }),
            onPoiClick: (poi) => this.emitter.emit("poi.click", { poi }),
            onPoiHover: (poi) => this.emitter.emit("poi.hover", { poi }),
            onMarkerClick: (overlay) => this.emitter.emit("marker.click", { markerId: overlay.id }),
            onContextLost: () => this.emitter.emit("render3d.contextLost", {}),
            onContextRestored: () => this.emitter.emit("render3d.contextRestored", {}),
            onRouteLegChange: (floorId) => this.showPlaybackFloor(floorId),
          });
        } catch (error) {
          // WebGL unavailable (headless/sandboxed embeds, old browsers, some CI): stay in
          // whatever camera mode was active instead of throwing out of setCameraMode(), so a
          // caller like playRouteAnimation() (which also calls setCameraMode("3d")) degrades to
          // a no-op rather than crashing the host page.
          this.renderer3d = null;
          this.emitter.emit("render3d.unavailable", {
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        const rect = this.container.getBoundingClientRect();
        this.renderer3d.resize(rect.width, rect.height);
        this.renderer3d.setControlsEnabled(this.interaction);
        this.renderer3d.setTheme(this.theme);
        this.renderer3d.setHighlightedSpace(this.highlightedSpaceId);
        this.renderer3d.setRouteShape(this.routeShape);
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

  /**
   * Adds an overlay. Types not drawn natively by a renderer fall back to a
   * marker there; `overlay.fallback` says which (see OVERLAY_SUPPORT).
   */
  addOverlay(overlay: Overlay): void {
    if (this.destroyed) return;
    this.overlays.push(overlay);
    const support = OVERLAY_SUPPORT[overlay.type];
    const renderers = (["2d", "3d"] as const).filter((mode) => support?.[mode] !== "native");
    if (renderers.length) {
      this.emitter.emit("overlay.fallback", {
        overlayId: overlay.id,
        type: overlay.type,
        renderers,
      });
    }
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

  /**
   * Computes the fastest route across the whole project — every floor, the
   * building connectors (elevators, stairs, escalators, ramps) and the site's
   * outdoor paths — and displays it. The result's `cost` is the estimated
   * travel time in seconds, `distance` the travel distance in meters.
   *
   * Endpoints are a node id, or `{ poiId }`, `{ spaceId }` or
   * `{ floorId, position }`: a POI routes to the nearest-in-time door of its
   * space and adds the walk to the POI; a space with several doors uses the
   * best one (see resolveRouteEndpoint). Returns null when either endpoint
   * doesn't exist or nothing connects them.
   *
   * The routing graph is cached per project; call load() again after
   * changing the loaded project so routes reflect the change.
   */
  startRoute(
    from: RouteEndpoint,
    to: RouteEndpoint,
    options: RouteOptions = {},
  ): PathResult | null {
    if (this.destroyed || !this.project) return null;
    this.renderer3d?.stopRoute();
    this.route = this.computeRoute(from, to, options);
    this.routeQuery = this.route ? { from, to, options: { ...options } } : null;
    this.guidanceState = { arrived: false, offRoute: false };
    this.routeEnds = this.route
      ? { start: this.spotOf(from), end: this.spotOf(to) }
      : { start: null, end: null };
    const nodeIdOf = (endpoint: RouteEndpoint, fallback: string | undefined): string =>
      fallback ??
      (typeof endpoint === "string" ? endpoint : "nodeId" in endpoint ? endpoint.nodeId : "");
    this.emitter.emit("route.started", {
      fromNodeId: nodeIdOf(from, this.route?.nodeIds[0]),
      toNodeId: nodeIdOf(to, this.route?.nodeIds.at(-1)),
      ...(typeof from === "string" ? {} : { from }),
      ...(typeof to === "string" ? {} : { to }),
    });
    this.render();
    return this.route;
  }

  /**
   * Shows the visitor's position (a "you are here" marker on its plane) and,
   * while a route is active, checks it against the route: `route.arrived`
   * fires once on reaching the end, `route.offRoute` once each time the
   * visitor strays from the route line on their current plane (it fires
   * again only after they return to it). Pass null to hide the position.
   * The route isn't recomputed automatically — call startRoute from the new
   * position on `route.offRoute` if you want rerouting.
   */
  setUserLocation(location: UserLocation | null): void {
    if (this.destroyed) return;
    this.userLocation = location ? { ...location, position: { ...location.position } } : null;
    this.userLocationOverlay = location
      ? {
          id: "__spatium_user_location",
          type: "marker",
          floorId: location.floorId,
          position: { ...location.position },
          properties: { userLocation: true },
        }
      : null;
    this.emitter.emit("location.changed", { location: this.userLocation });
    this.checkGuidance();
    this.render();
  }

  getUserLocation(): UserLocation | null {
    return this.userLocation;
  }

  /** Connects a positioning provider (replacing any previous one). Returns a detach function. */
  attachLocationProvider(provider: LocationProvider): () => void {
    if (this.destroyed) return () => {};
    this.locationProvider?.stop();
    this.locationProvider = provider;
    provider.start((location) => {
      if (this.locationProvider === provider) this.setUserLocation(location);
    });
    return () => {
      if (this.locationProvider !== provider) return;
      provider.stop();
      this.locationProvider = null;
    };
  }

  /** Arrival / off-route thresholds in meters (see GuidanceOptions). */
  setGuidanceOptions(options: GuidanceOptions): void {
    this.guidance = { ...this.guidance, ...options };
    this.checkGuidance();
  }

  /**
   * Finds POIs and named spaces by name (any locale, Korean initials too),
   * external id or space code. Feed a result into startRoute as
   * `{ poiId: r.id }` / `{ spaceId: r.id }`.
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    return this.project ? searchProject(this.project, query, options) : [];
  }

  /**
   * Plays the currently held route (from `startRoute`) in the 3D view,
   * switching to it if needed — playback only exists in the 3D renderer.
   * Multi-floor routes play floor by floor: the runtime switches the active
   * floor as playback reaches each leg (`floor.changed` fires). The marker
   * follows exactly the drawn route line. Available from any host: the
   * Studio 3D preview, an exported app, or a Builder `route.playAnimation`
   * rule (see @indoor/builder's action vocabulary).
   */
  playRouteAnimation(options?: RoutePlaybackOptions): void {
    if (this.destroyed) return;
    if (options?.curve) this.routeShape = options.curve;
    this.setCameraMode("3d");
    this.renderer3d?.playRoute(this.computeRouteLegs(), options ?? {});
  }

  stopRouteAnimation(): void {
    this.renderer3d?.stopRoute();
  }

  /** Freezes route playback in place (follow cameras hand orbit/zoom back to the user). */
  pauseRouteAnimation(): void {
    this.renderer3d?.pauseRoute();
  }

  resumeRouteAnimation(): void {
    this.renderer3d?.resumeRoute();
  }

  /** Jumps route playback to `progress` (0–1) along the whole route, across floors. */
  seekRouteAnimation(progress: number): void {
    this.renderer3d?.seekRoute(progress);
  }

  /** Playback speed multiplier (1 = walking pace), applied immediately. */
  setRouteAnimationSpeed(speed: number): void {
    this.renderer3d?.setRoutePlaybackSpeed(speed);
  }

  /** True while route playback is active — including while paused. */
  isPlayingRouteAnimation(): boolean {
    return this.renderer3d?.isRoutePlaying() ?? false;
  }

  /** Progress, speed and current floor of route playback, or null when none is active. */
  getRouteAnimationState(): RoutePlaybackState | null {
    return this.renderer3d?.getRoutePlaybackState() ?? null;
  }

  /**
   * Shape of the route line in 3D — `"smooth"` (default) rounds corners,
   * `"straight"` keeps the raw polyline. Playback always follows the same shape.
   */
  setRouteShape(shape: RouteCurveShape): void {
    this.routeShape = shape;
    this.renderer3d?.setRouteShape(shape);
  }

  getRouteShape(): RouteCurveShape {
    return this.routeShape;
  }

  /**
   * Highlights a space by id (e.g. a Builder `space.highlight` rule action) on whichever
   * renderer(s) are active, so the highlight survives a `setCameraMode()` switch. Pass null
   * to clear it.
   */
  highlightSpace(spaceId: string | null): void {
    this.highlightedSpaceId = spaceId;
    this.renderer3d?.setHighlightedSpace(spaceId);
    this.render();
  }

  clearRoute(): void {
    if (!this.route) return;
    this.route = null;
    this.routeQuery = null;
    this.routeEnds = { start: null, end: null };
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
    if (this.destroyed) return;
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
    // The site plane's "spaces" are synthesized building outlines, not real spaces.
    if (hit.kind === "space" && this.isSiteView()) return;

    if (hit.kind === "marker") this.emitter.emit("marker.click", { markerId: hit.overlay.id });
    else if (hit.kind === "poi") this.emitter.emit("poi.click", { poi: hit.poi });
    else if (hit.kind === "furniture")
      this.emitter.emit("furniture.click", { furniture: hit.item });
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
      const delta = {
        x: current.x - this.lastPointerScreen.x,
        y: current.y - this.lastPointerScreen.y,
      };
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
    const newHoveredId =
      hit?.kind === "poi" ? hit.poi.id : hit?.kind === "marker" ? hit.overlay.id : null;

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

  private computeRoute(
    from: RouteEndpoint,
    to: RouteEndpoint,
    options: RouteOptions,
  ): PathResult | null {
    const project = this.project!;
    return findRoute(
      this.getRoutingGraph(options),
      resolveRouteEndpoint(project, from),
      resolveRouteEndpoint(project, to),
      options,
    );
  }

  private getRoutingGraph(options: RoutingGraphOptions): PreparedRoutingGraph {
    const key = JSON.stringify([options.walkingSpeed ?? null, options.connectorDefaults ?? null]);
    let graph = this.routingGraphs.get(key);
    if (!graph) {
      graph = prepareRoutingGraph(buildRoutingGraph(this.project!, options));
      this.routingGraphs.set(key, graph);
    }
    return graph;
  }

  private spotOf(endpoint: RouteEndpoint): RouteSpot | null {
    if (typeof endpoint === "string") return null;
    if ("position" in endpoint) return { floorId: endpoint.floorId, position: endpoint.position };
    if ("poiId" in endpoint) {
      const found = findPOIInProject(this.project!, endpoint.poiId);
      return found ? { floorId: found.floor.id, position: found.poi.position } : null;
    }
    return null;
  }

  /**
   * The held route split into per-plane legs in travel order: consecutive
   * nodes on the same floor, or on the site's outdoor plane. A site leg also
   * includes the building nodes it connects to (placed into site
   * coordinates), so the outdoor walk visibly starts and ends at the doors;
   * the real start/end spots are attached to the first/last leg.
   */
  private computeRouteLegs(): RouteLeg[] {
    if (!this.route || !this.project) return [];
    const site = this.project.site;
    const nodes = new Map<string, { floorId: string; position: Point; sitePosition: Point }>();
    for (const building of this.project.buildings) {
      for (const floor of building.floors) {
        for (const node of floor.navigation.nodes)
          nodes.set(node.id, {
            floorId: floor.id,
            position: node.position,
            sitePosition: buildingToSite(building, node.position),
          });
      }
    }
    for (const node of site?.navigation.nodes ?? [])
      nodes.set(node.id, {
        floorId: site!.id,
        position: node.position,
        sitePosition: node.position,
      });

    type Leg = { floorId: string; points: Point[]; arrival?: NonNullable<RouteLeg["arrival"]> };
    const legs: Leg[] = [];
    let current = null as Leg | null;
    const ids = this.route.nodeIds;
    for (let i = 0; i < ids.length; i++) {
      const node = nodes.get(ids[i]!);
      if (!node) {
        current = null;
        continue;
      }
      if (current?.floorId !== node.floorId) {
        current = { floorId: node.floorId, points: [] };
        const arrival = i > 0 ? this.floorChangeArrival(ids[i - 1]!, ids[i]!, i - 1) : undefined;
        if (arrival) current.arrival = arrival;
        legs.push(current);
        // Entering the site from a building: start the outdoor leg at that door.
        const previous = i > 0 ? nodes.get(ids[i - 1]!) : undefined;
        if (site && node.floorId === site.id && previous && previous.floorId !== site.id)
          current.points.push(previous.sitePosition);
      }
      current.points.push(node.position);
      // Leaving the site into a building: end the outdoor leg at that door.
      const next = i + 1 < ids.length ? nodes.get(ids[i + 1]!) : undefined;
      if (site && node.floorId === site.id && next && next.floorId !== site.id)
        current.points.push(next.sitePosition);
    }
    const { start, end } = this.routeEnds;
    const first = legs[0];
    const last = legs.at(-1);
    if (start && first?.floorId === start.floorId) first.points.unshift(start.position);
    if (end && last?.floorId === end.floorId) last.points.push(end.position);
    // Each leg rounds its corners against its own floor's walls/holes, so the
    // marker follows the same line that floor draws once it becomes active.
    return legs
      .filter((leg) => leg.points.length >= 2)
      .map((leg) => {
        const obstacles = routeObstaclesForFloor(this.findPlane(leg.floorId));
        const any = !!obstacles?.walls?.length || !!obstacles?.polygons?.length;
        return any ? { ...leg, obstacles: obstacles! } : leg;
      });
  }

  /**
   * How the route gets from node `fromId` to node `toId` (consecutive on the
   * route, on different building floors): the edge's kind, its travel time
   * and whether it goes up or down. Undefined when either end is outdoors —
   * walking out of a door needs no floor-change transition.
   */
  private floorChangeArrival(
    fromId: string,
    toId: string,
    edgeIndex: number,
  ): RouteLeg["arrival"] | undefined {
    if (!this.project || !this.route) return undefined;
    const floorOf = (nodeId: string) => {
      for (const building of this.project!.buildings)
        for (const floor of building.floors)
          if (floor.navigation.nodes.some((n) => n.id === nodeId)) return floor;
      return undefined;
    };
    const from = floorOf(fromId),
      to = floorOf(toId);
    if (!from || !to || from.id === to.id) return undefined;
    const options = this.routeQuery?.options ?? {};
    const edgeId = this.route.edgeIds[edgeIndex];
    const edge = this.getRoutingGraph(options)
      .adjacency.get(fromId)
      ?.find((n) => n.edge.id === edgeId)?.edge;
    const up =
      to.elevation !== from.elevation ? to.elevation > from.elevation : to.level > from.level;
    return {
      via: edge?.type ?? "walk",
      ...(edge ? { seconds: edgeDuration(edge, options.walkingSpeed) } : {}),
      direction: up ? "up" : "down",
    };
  }

  /** Playback reached a leg on another floor: show it without stopping playback (unlike setFloor). */
  private showPlaybackFloor(floorId: string | undefined): void {
    if (!floorId || floorId === this.activeFloorId) return;
    if (!this.findPlane(floorId)) return;
    this.activeFloorId = floorId;
    this.emitter.emit("floor.changed", { floorId });
    this.render();
  }

  private computeRoutePoints(): Array<Point | null> {
    const floor = this.getActiveFloor();
    if (!this.route || !floor) return [];
    const own = new Set(floor.navigation.nodes.map((n) => n.id));
    const positions = new Map(floor.navigation.nodes.map((n) => [n.id, n.position]));
    const siteView = this.isSiteView();
    // On the site plane, building nodes adjacent to an outdoor node show at
    // their site position, so the outdoor line reaches the building doors.
    if (siteView && this.project) {
      for (const building of this.project.buildings) {
        for (const f of building.floors) {
          for (const node of f.navigation.nodes)
            positions.set(node.id, buildingToSite(building, node.position));
        }
      }
    }
    const ids = this.route.nodeIds;
    const points = ids.map((id, i) => {
      const position = positions.get(id);
      if (!position) return null;
      if (own.has(id)) return position;
      const nextToOutdoor = own.has(ids[i - 1] ?? "") || own.has(ids[i + 1] ?? "");
      return siteView && nextToOutdoor ? position : null;
    });
    const { start, end } = this.routeEnds;
    if (start?.floorId === floor.id && points[0]) points.unshift(start.position);
    if (end?.floorId === floor.id && points.at(-1)) points.push(end.position);
    return points;
  }

  /** A building floor by id, or the synthesized site plane when `id` is the site's. */
  private findPlane(id: string): Floor | undefined {
    if (!this.project) return undefined;
    for (const building of this.project.buildings) {
      const floor = building.floors.find((f) => f.id === id);
      if (floor) return floor;
    }
    return this.project.site?.id === id ? this.sitePlane() : undefined;
  }

  /**
   * The site's outdoor graph as a Floor: `navigation` IS site.navigation
   * (same object), spaces are building outlines in site coordinates.
   */
  private sitePlane(): Floor | undefined {
    const site = this.project?.site;
    if (!site) return undefined;
    if (this.sitePlaneCache?.navigation === site.navigation) return this.sitePlaneCache;
    const plane = createFloor(site.name, 0, 0);
    plane.id = site.id;
    plane.navigation = site.navigation;
    for (const building of this.project!.buildings) {
      const outline = buildingSiteOutline(building);
      if (outline.length < 3) continue;
      plane.spaces.push({
        id: `${site.id}:building:${building.id}`,
        floorId: site.id,
        polygon: outline,
        type: "unknown",
        height: 0.2,
        properties: { name: building.name },
      });
    }
    this.sitePlaneCache = plane;
    return plane;
  }

  /** Compares the visitor's position with the active route (see setUserLocation). */
  private checkGuidance(): void {
    const location = this.userLocation;
    if (!location || !this.route || this.guidanceState.arrived) return;
    const legs = this.computeRouteLegs();
    const last = legs.at(-1);
    const accuracy = Math.max(0, location.accuracy ?? 0);
    const end = last?.points.at(-1);
    if (last && end && last.floorId === location.floorId) {
      if (distance(location.position, end) <= this.guidance.arrivalRadius + accuracy) {
        this.guidanceState.arrived = true;
        this.emitter.emit("route.arrived", { location });
        return;
      }
    }
    let nearest = Infinity;
    for (const leg of legs) {
      if (leg.floorId !== location.floorId) continue;
      for (let i = 1; i < leg.points.length; i++) {
        const d = distanceToSegment(location.position, leg.points[i - 1]!, leg.points[i]!).distance;
        if (d < nearest) nearest = d;
      }
    }
    // On a plane the route doesn't visit at all, the visitor is off route too.
    const off = nearest > this.guidance.offRouteDistance + accuracy;
    if (off && !this.guidanceState.offRoute) {
      this.emitter.emit("route.offRoute", {
        location,
        distance: Number.isFinite(nearest) ? nearest : null,
      });
    }
    this.guidanceState.offRoute = off;
  }

  /** Overlays plus the visitor's position marker when it's on the displayed plane. */
  private displayOverlays(): Overlay[] {
    const user = this.userLocationOverlay;
    return user ? [...this.overlays, user] : this.overlays;
  }

  private render(): void {
    if (this.destroyed) return;
    if (this.cameraMode === "3d") {
      this.renderer3d?.update({
        floor: this.getActiveFloor(),
        overlays: this.displayOverlays(),
        routePoints: this.computeRoutePoints(),
      });
      return;
    }
    if (!this.ctx) return;
    render2d(this.ctx, {
      floor: this.getActiveFloor(),
      camera: this.camera,
      overlays: this.displayOverlays(),
      hoveredId: this.hoveredId,
      highlightedSpaceId: this.highlightedSpaceId,
      routePoints: this.computeRoutePoints(),
      theme: this.theme,
    });
  }
}
