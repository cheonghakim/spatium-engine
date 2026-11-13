import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  type Entrance,
  type Floor,
  type Furniture,
  type POI,
  type Point,
  type Space,
  type SpaceType,
  type Wall,
} from "@indoor/core";
import { buildArchitecture, stairSpaceGeometry } from "./architecture.js";
import { buildFurnitureModel } from "./furniture.js";
import {
  loadFurnitureGLB,
  instanceFurnitureGLB,
  disposeImportedModel,
} from "./importedFurniture.js";
import type { Overlay } from "../overlay.js";
import type { RuntimeTheme } from "../theme.js";
import {
  buildRoutePath,
  densifyRoutePath,
  routeObstaclesForFloor,
  sampleRoutePath,
  segmentIndexAt,
  type RouteCurveShape,
  type RouteObstacles,
  type RoutePath,
} from "./routePath.js";

export interface Renderer3DCallbacks {
  onSpaceClick?(space: Space): void;
  onPoiClick?(poi: POI): void;
  onPoiHover?(poi: POI | null): void;
  onMarkerClick?(overlay: Overlay): void;
  /** The WebGL context was lost; rendering is paused until it's restored (or never, if the
   *  browser can't recover it) — see `webglcontextlost`/`webglcontextrestored`. */
  onContextLost?(): void;
  /** The WebGL context came back and the scene was rebuilt from the last known state. */
  onContextRestored?(): void;
  /** Route playback moved onto another leg — the host should show that leg's floor. */
  onRouteLegChange?(floorId: string | undefined, legIndex: number): void;
}

export interface Renderer3DState {
  floor: Floor | undefined;
  overlays: readonly Overlay[];
  routePoints: ReadonlyArray<Point | null>;
}

export type { RouteCurveShape };
/** `"marker"` shows a moving marker; `"flythrough"` moves only the camera. */
export type RouteAnimationType = "marker" | "flythrough";
/**
 * `"third"` follows behind the marker, `"first"` looks from eye height,
 * `"overview"` leaves the camera to the user (orbit/zoom stay enabled) and
 * only moves the marker.
 */
export type RouteCameraMode = "first" | "third" | "overview";

export interface RoutePlaybackOptions {
  /** Shape of the drawn route line and the playback path (they always match). */
  curve?: RouteCurveShape;
  animationType?: RouteAnimationType;
  cameraMode?: RouteCameraMode;
  /** Playback time for the whole route at speed 1. Defaults to walking pace (1.3 m/s). */
  durationSeconds?: number;
  /** Speed multiplier (default 1, clamped to 0.1–16). Change it later with setRoutePlaybackSpeed(). */
  speed?: number;
}

/** One contiguous stretch of a route on a single floor, in travel order. */
export interface RouteLeg {
  floorId?: string;
  points: ReadonlyArray<Point>;
  /**
   * Walls/holes a smoothed corner must keep clear of on this leg's floor. When
   * omitted, the active floor's walls and holes are used if the leg is on it.
   */
  obstacles?: RouteObstacles;
  /**
   * How this leg is reached from the previous one when they're on different
   * floors (an elevator ride, a flight of stairs…). Playback then shows a
   * short floor-change transition between the two legs.
   */
  arrival?: RouteLegArrival;
}

/** The vertical move into a leg on another floor. */
export interface RouteLegArrival {
  /** What carries you there — shown to the viewer ("엘리베이터로 이동 중"). */
  via: "elevator" | "stairs" | "escalator" | "ramp" | "walk";
  /** Real travel time (wait + ride / climb). Only scales the transition; playback compresses it. */
  seconds?: number;
  direction?: "up" | "down";
}

export interface RoutePlaybackState {
  paused: boolean;
  /** 0–1 along the whole route, across floors (including floor-change transitions). */
  progress: number;
  /** Meters walked / total, along the drawn shape (floor changes add no distance). */
  distance: number;
  totalDistance: number;
  speed: number;
  /** Seconds left at the current speed. */
  remainingSeconds: number;
  /** Index of the floor leg being shown, and how many floor legs there are. */
  legIndex: number;
  legCount: number;
  /** The floor currently shown. */
  floorId?: string;
  /** Set while playback is moving between floors. */
  transition?: RoutePlaybackTransition;
}

export interface RoutePlaybackTransition extends RouteLegArrival {
  fromFloorId?: string;
  toFloorId?: string;
  /** 0–1 through the transition; the floor switches at 0.5. */
  progress: number;
}

/** A floor leg, or the floor-change transition between two of them, on the playback timeline. */
type PlaybackLeg =
  | {
      kind: "walk";
      floorId?: string;
      path: RoutePath;
      /** Timeline position where the leg starts, and its length (timeline units = metres). */
      start: number;
      length: number;
      /** Metres walked before this leg (transitions add none). */
      walkedBefore: number;
      /** Index among the walk legs. */
      walkIndex: number;
    }
  | {
      kind: "transition";
      fromFloorId?: string;
      floorId?: string;
      from: Point;
      to: Point;
      arrival: RouteLegArrival;
      start: number;
      length: number;
      walkedBefore: number;
      /** Walk index of the leg before (first half) / after (second half). */
      walkIndex: number;
    };

interface ActiveRoutePlayback {
  rawLegs: RouteLeg[];
  legs: PlaybackLeg[];
  /** Timeline length (walked metres + transition lengths). */
  total: number;
  walkedTotal: number;
  walkLegCount: number;
  /** Position on the timeline. */
  distance: number;
  legIndex: number;
  /** Floor + walk index last reported through onRouteLegChange. */
  shownKey: string | null;
  durationSeconds: number | undefined;
  speed: number;
  paused: boolean;
  animationType: RouteAnimationType;
  cameraMode: RouteCameraMode;
  markerMesh: THREE.Mesh | null;
  traveledMesh: THREE.Mesh | null;
  traveledPath: RoutePath | null;
  /** Smoothed horizontal heading (radians, three.js XZ plane) the follow camera looks along. */
  headingYaw: number;
  snapCamera: boolean;
  priorControls: { pan: boolean; zoom: boolean; rotate: boolean };
  priorCamera: { position: THREE.Vector3; target: THREE.Vector3 };
  lastFrameTime: number;
}

const SPACE_COLORS: Record<SpaceType, number> = {
  room: 0xb0bec5,
  store: 0x5a8cff,
  corridor: 0xdfe3e8,
  lobby: 0xffd54f,
  stairs: 0x8865cc,
  elevator: 0x3ddc84,
  restricted: 0xff6b6b,
  unknown: 0xb0bec5,
};

const POI_HOVER_SCALE = 1.4;
const WALK_SPEED_METERS_PER_SECOND = 1.3;
const MIN_PLAYBACK_DURATION_SECONDS = 2;
const MIN_PLAYBACK_SPEED = 0.1;
const MAX_PLAYBACK_SPEED = 16;
const THIRD_PERSON_BACK_METERS = 4;
const THIRD_PERSON_HEIGHT_METERS = 2.5;
const THIRD_PERSON_LOOK_HEIGHT_METERS = 1;
/** Closest the follow camera is pulled in when a wall blocks its view of the marker. */
const THIRD_PERSON_MIN_BACK_METERS = 0.6;
const FIRST_PERSON_EYE_HEIGHT_METERS = 1.6;
/** The camera aims at the path this far ahead, so it starts turning before a corner. */
const CAMERA_LOOK_AHEAD_METERS = 2;
/** Exponential smoothing rates (1/s) for the follow camera's heading and position. */
const CAMERA_HEADING_RESPONSE = 5;
const CAMERA_POSITION_RESPONSE = 8;
const MARKER_HEIGHT_METERS = 0.35;
const ROUTE_LINE_WIDTH_METERS = 0.3;
const ROUTE_LINE_HEIGHT_METERS = 0.04;
const ROUTE_TRAVELED_HEIGHT_METERS = 0.05;
const ROUTE_TRAVELED_COLOR = 0x9aa0a8;
/** Segment length the travelled overlay is split into, so it tracks the marker closely. */
const ROUTE_TRAVELED_STEP_METERS = 0.2;
/**
 * Floor changes are compressed: a 40 s elevator ride shouldn't stall playback
 * for 40 s. Shown for seconds ÷ this, clamped to the range below (at speed 1).
 */
const TRANSITION_TIME_COMPRESSION = 8;
const TRANSITION_MIN_SECONDS = 1.5;
const TRANSITION_MAX_SECONDS = 4;
const TRANSITION_DEFAULT_SECONDS = 2.5;
/** How far (m) the marker/camera rise or sink out of a floor before it switches. */
const TRANSITION_RISE_METERS = 3;
/** How dark the view gets at the moment the floor switches (0 = none, 1 = black). */
const TRANSITION_FADE = 0.75;

/**
 * Three.js scene derived from Core data on update() — meshes are never the
 * source of truth (spec §22); each section is rebuilt only when its input
 * data changed (see syncSections()). World XY (map plane) maps to the
 * three.js XZ ground plane; world/space height maps to three.js Y (up):
 * (x, y) -> (x, elevationY, -y).
 */
export class Renderer3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();

  private readonly spaceGroup = new THREE.Group();
  private readonly wallGroup = new THREE.Group();
  private readonly entranceGroup = new THREE.Group();
  private readonly poiGroup = new THREE.Group();
  private readonly furnitureGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  private readonly routeGroup = new THREE.Group();
  private readonly playbackGroup = new THREE.Group();

  private theme: { background: string; accentColor: string } = {
    background: "#f0f0f3",
    accentColor: "#3d5afe",
  };

  private readonly spaceByMesh = new Map<THREE.Object3D, Space>();
  private readonly poiByMesh = new Map<THREE.Object3D, POI>();
  private readonly overlayByMesh = new Map<THREE.Object3D, Overlay>();

  private hoveredSpaceMesh: THREE.Object3D | null = null;
  private hoveredPoiMesh: THREE.Object3D | null = null;
  /** Set via setHighlightedSpace(), independent of pointer hover — e.g. a Builder
   *  `space.highlight` rule action. When it targets a different mesh than the current hover,
   *  both are shown highlighted (same emissive color, so there's nothing to arbitrate). */
  private highlightedSpaceId: string | null = null;
  private highlightedSpaceMesh: THREE.Object3D | null = null;
  private animationHandle: number | null = null;
  private disposed = false;
  private furnitureRevision = 0;
  private readonly importedModels = new Map<string, Promise<THREE.Group>>();
  private fittedFloorId: string | undefined;
  private hadGeometry = false;
  private routePlayback: ActiveRoutePlayback | null = null;
  private routeShape: RouteCurveShape = "smooth";
  /** Separate from the pointer raycaster so its `far` limit never leaks into picking. */
  private readonly occlusionRaycaster = new THREE.Raycaster();
  /** WebGL context lost (see webglcontextlost) — the animate loop is paused until restored. */
  private contextLost = false;
  /** The last state passed to update(), replayed to rebuild the scene after context restore. */
  private lastState: Renderer3DState | null = null;
  /** What each section was last built from — see syncSections()/sectionKey(). */
  private sectionKeys: Partial<Record<SceneSection, SectionKey>> = {};

  constructor(
    container: HTMLElement,
    private readonly callbacks: Renderer3DCallbacks = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.touchAction = "none";
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    this.camera.position.set(15, 18, 20);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);

    this.scene.add(
      this.spaceGroup,
      this.wallGroup,
      this.entranceGroup,
      this.poiGroup,
      this.furnitureGroup,
      this.overlayGroup,
      this.routeGroup,
      this.playbackGroup,
    );
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(20, 30, 10);
    this.scene.add(sun);
    this.scene.background = new THREE.Color(this.theme.background);

    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("click", this.handleClick);
    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);
    this.renderer.domElement.addEventListener("webglcontextrestored", this.handleContextRestored);

    this.animate();
  }

  getDomElement(): HTMLElement {
    return this.renderer.domElement;
  }

  /** Exposed for tests only: there's no real WebGL context to render and read pixels from in
   *  Vitest/jsdom, so resize()'s aspect-ratio guard is otherwise unobservable from outside. */
  getCameraAspectForTesting(): number {
    return this.camera.aspect;
  }

  /** Exposed for tests only: returns the live mesh object for a space id (or null), so a test can
   *  assert the scene was actually rebuilt (a fresh mesh instance) rather than merely that some
   *  mesh happens to still be mapped to that id — e.g. after a WebGL context restore rebuilds the
   *  scene from the last known state. Typed as an opaque `object` so the public declarations
   *  never reference `three` types (consumers would otherwise need `@types/three`). */
  getSpaceMeshForTesting(spaceId: string): object | null {
    return this.findSpaceMesh(spaceId);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = Math.max(width, 1) / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  setControlsEnabled(options: { pan: boolean; zoom: boolean; rotate: boolean }): void {
    this.controls.enablePan = options.pan;
    this.controls.enableZoom = options.zoom;
    this.controls.enableRotate = options.rotate;
  }

  setTheme(theme: RuntimeTheme): void {
    if (theme.background) {
      this.theme.background = theme.background;
      this.scene.background = new THREE.Color(theme.background);
    }
    if (theme.accentColor) this.theme.accentColor = theme.accentColor;
  }

  isRoutePlaying(): boolean {
    return this.routePlayback !== null;
  }

  /** Highlights the space with this id (independent of pointer hover), or clears it if null. */
  setHighlightedSpace(spaceId: string | null): void {
    this.highlightedSpaceId = spaceId;
    this.highlightedSpaceMesh = spaceId ? this.findSpaceMesh(spaceId) : null;
    this.refreshSpaceEmissive();
  }

  private findSpaceMesh(spaceId: string): THREE.Object3D | null {
    for (const [mesh, space] of this.spaceByMesh) {
      if (space.id === spaceId) return mesh;
    }
    return null;
  }

  /** Re-derives every space mesh's emissive color from current hover + explicit highlight. */
  private refreshSpaceEmissive(): void {
    for (const mesh of this.spaceByMesh.keys()) {
      const active = mesh === this.hoveredSpaceMesh || mesh === this.highlightedSpaceMesh;
      setSpaceEmissive(mesh, active ? 0x333333 : 0x000000);
    }
  }

  /**
   * Plays the route leg by leg, in travel order — legs on other floors are
   * reached through `onRouteLegChange`, which asks the host to switch floors.
   * The marker and camera follow exactly the shape `rebuildRoute` draws
   * (same `buildRoutePath` call on the same points), so the marker never
   * leaves the line. Legs with fewer than two points are skipped.
   */
  playRoute(legs: ReadonlyArray<RouteLeg>, options: RoutePlaybackOptions = {}): void {
    this.stopRoute();
    if (options.curve) this.setRouteShape(options.curve);

    const rawLegs: RouteLeg[] = legs.map((leg) => ({
      ...(leg.floorId !== undefined ? { floorId: leg.floorId } : {}),
      points: [...leg.points],
      ...(leg.obstacles ? { obstacles: leg.obstacles } : {}),
      ...(leg.arrival ? { arrival: { ...leg.arrival } } : {}),
    }));
    const built = this.buildPlaybackLegs(rawLegs);
    if (!built) return;

    const animationType = options.animationType ?? "marker";
    const cameraMode = options.cameraMode ?? "third";

    let markerMesh: THREE.Mesh | null = null;
    if (animationType === "marker") {
      markerMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 20, 16),
        new THREE.MeshStandardMaterial({
          color: this.theme.accentColor,
          emissive: this.theme.accentColor,
          emissiveIntensity: 0.25,
        }),
      );
      this.playbackGroup.add(markerMesh);
    }

    this.routePlayback = {
      rawLegs,
      legs: built.legs,
      total: built.total,
      walkedTotal: built.walkedTotal,
      walkLegCount: built.walkLegCount,
      distance: 0,
      legIndex: -1,
      shownKey: null,
      durationSeconds:
        options.durationSeconds !== undefined && options.durationSeconds > 0
          ? options.durationSeconds
          : undefined,
      speed: clampPlaybackSpeed(options.speed ?? 1),
      paused: false,
      animationType,
      cameraMode,
      markerMesh,
      traveledMesh: null,
      traveledPath: null,
      headingYaw: 0,
      snapCamera: true,
      priorControls: {
        pan: this.controls.enablePan,
        zoom: this.controls.enableZoom,
        rotate: this.controls.enableRotate,
      },
      priorCamera: {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
      },
      lastFrameTime: performance.now(),
    };
    if (cameraMode !== "overview")
      this.setControlsEnabled({ pan: false, zoom: false, rotate: false });
    this.positionPlayback(0, true);
  }

  /**
   * Ends playback. Follow cameras hand the view back where it was before
   * playback started, with the user's controls restored.
   */
  stopRoute(): void {
    const playback = this.routePlayback;
    if (!playback) return;
    this.routePlayback = null;
    disposeGroup(this.playbackGroup);
    this.renderer.domElement.style.opacity = "";
    if (playback.cameraMode !== "overview") {
      this.camera.position.copy(playback.priorCamera.position);
      this.controls.target.copy(playback.priorCamera.target);
      this.setControlsEnabled(playback.priorControls);
      this.controls.update();
    }
  }

  /**
   * Freezes playback where it is. Follow cameras hand orbit/zoom back to the
   * user around the marker until resumeRoute().
   */
  pauseRoute(): void {
    const playback = this.routePlayback;
    if (!playback || playback.paused) return;
    playback.paused = true;
    if (playback.cameraMode !== "overview") {
      this.controls.target.copy(this.followLookTarget(playback));
      this.setControlsEnabled({ pan: true, zoom: true, rotate: true });
      this.controls.update();
    }
  }

  resumeRoute(): void {
    const playback = this.routePlayback;
    if (!playback || !playback.paused) return;
    playback.paused = false;
    playback.lastFrameTime = performance.now();
    if (playback.cameraMode !== "overview")
      this.setControlsEnabled({ pan: false, zoom: false, rotate: false });
  }

  /** Jumps to `progress` (0–1) along the whole route; works while paused too. */
  seekRoute(progress: number): void {
    const playback = this.routePlayback;
    if (!playback || !Number.isFinite(progress)) return;
    playback.distance = Math.max(0, Math.min(1, progress)) * playback.total;
    playback.snapCamera = true;
    this.positionPlayback(0, true);
    if (playback.paused && playback.cameraMode !== "overview") {
      this.controls.target.copy(this.followLookTarget(playback));
      this.controls.update();
    }
  }

  setRoutePlaybackSpeed(speed: number): void {
    if (this.routePlayback && Number.isFinite(speed))
      this.routePlayback.speed = clampPlaybackSpeed(speed);
  }

  getRoutePlaybackState(): RoutePlaybackState | null {
    const playback = this.routePlayback;
    if (!playback) return null;
    const metersPerSecond = this.baseSpeed(playback) * playback.speed;
    const leg = playback.legs[Math.max(0, playback.legIndex)] as PlaybackLeg;
    const local = Math.max(0, Math.min(leg.length, playback.distance - leg.start));
    const view = this.playbackView(leg, local);
    return {
      paused: playback.paused,
      progress: playback.total > 0 ? playback.distance / playback.total : 1,
      distance: leg.walkedBefore + (leg.kind === "walk" ? local : 0),
      totalDistance: playback.walkedTotal,
      speed: playback.speed,
      remainingSeconds:
        metersPerSecond > 0 ? (playback.total - playback.distance) / metersPerSecond : 0,
      legIndex: view.walkIndex,
      legCount: playback.walkLegCount,
      ...(view.floorId !== undefined ? { floorId: view.floorId } : {}),
      ...(leg.kind === "transition"
        ? {
            transition: {
              ...leg.arrival,
              ...(leg.fromFloorId !== undefined ? { fromFloorId: leg.fromFloorId } : {}),
              ...(leg.floorId !== undefined ? { toFloorId: leg.floorId } : {}),
              progress: leg.length > 0 ? local / leg.length : 1,
            },
          }
        : {}),
    };
  }

  /**
   * Shape of the drawn route line and of playback. Changing it mid-playback
   * reshapes both and keeps the relative progress.
   */
  setRouteShape(shape: RouteCurveShape): void {
    if (shape === this.routeShape) return;
    this.routeShape = shape;
    this.rebuildRoute(this.lastState?.routePoints ?? []);
    // Record what was just drawn so the next update() doesn't redraw it again.
    if (this.lastState) this.sectionKeys.route = this.routeKey(this.lastState);
    else delete this.sectionKeys.route;
    const playback = this.routePlayback;
    if (!playback) return;
    const built = this.buildPlaybackLegs(playback.rawLegs);
    if (!built) {
      this.stopRoute();
      return;
    }
    const progress = playback.total > 0 ? playback.distance / playback.total : 0;
    playback.legs = built.legs;
    playback.total = built.total;
    playback.walkedTotal = built.walkedTotal;
    playback.walkLegCount = built.walkLegCount;
    playback.distance = progress * built.total;
    playback.legIndex = -1;
    this.positionPlayback(0, true);
  }

  getRouteShape(): RouteCurveShape {
    return this.routeShape;
  }

  private buildPlaybackLegs(legs: ReadonlyArray<RouteLeg>): {
    legs: PlaybackLeg[];
    total: number;
    walkedTotal: number;
    walkLegCount: number;
  } | null {
    const built: PlaybackLeg[] = [];
    let total = 0,
      walked = 0,
      walkIndex = 0;
    for (const leg of legs) {
      const activeFloor = this.lastState?.floor;
      const obstacles =
        leg.obstacles ??
        (leg.floorId === undefined || leg.floorId === activeFloor?.id
          ? routeObstaclesForFloor(activeFloor)
          : undefined);
      const path = buildRoutePath(leg.points, this.routeShape, undefined, obstacles);
      if (!path) continue;
      const previous = built.at(-1);
      // Reaching this leg means changing floors: put a transition in between.
      if (leg.arrival && previous?.kind === "walk" && previous.floorId !== leg.floorId) {
        const seconds =
          leg.arrival.seconds !== undefined && Number.isFinite(leg.arrival.seconds)
            ? Math.min(
                TRANSITION_MAX_SECONDS,
                Math.max(TRANSITION_MIN_SECONDS, leg.arrival.seconds / TRANSITION_TIME_COMPRESSION),
              )
            : TRANSITION_DEFAULT_SECONDS;
        const length = seconds * WALK_SPEED_METERS_PER_SECOND;
        built.push({
          kind: "transition",
          ...(previous.floorId !== undefined ? { fromFloorId: previous.floorId } : {}),
          ...(leg.floorId !== undefined ? { floorId: leg.floorId } : {}),
          from: sampleRoutePath(previous.path, previous.path.length).point,
          to: sampleRoutePath(path, 0).point,
          arrival: { ...leg.arrival },
          start: total,
          length,
          walkedBefore: walked,
          walkIndex: walkIndex - 1,
        });
        total += length;
      }
      built.push({
        kind: "walk",
        ...(leg.floorId !== undefined ? { floorId: leg.floorId } : {}),
        path,
        start: total,
        length: path.length,
        walkedBefore: walked,
        walkIndex: walkIndex++,
      });
      total += path.length;
      walked += path.length;
    }
    return built.length > 0
      ? { legs: built, total, walkedTotal: walked, walkLegCount: walkIndex }
      : null;
  }

  /** Meters per second at speed 1: walking pace, slowed so a short route still lasts a moment. */
  private baseSpeed(playback: ActiveRoutePlayback): number {
    if (playback.durationSeconds) return playback.total / playback.durationSeconds;
    return Math.min(WALK_SPEED_METERS_PER_SECOND, playback.total / MIN_PLAYBACK_DURATION_SECONDS);
  }

  /** Advances the active playback by one frame; called from the animate() loop. */
  private stepRoutePlayback(): void {
    const playback = this.routePlayback;
    if (!playback) return;

    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - playback.lastFrameTime) / 1000));
    playback.lastFrameTime = now;
    if (playback.paused) return;

    playback.distance = Math.min(
      playback.total,
      playback.distance + this.baseSpeed(playback) * playback.speed * dt,
    );
    this.positionPlayback(dt, false);
    if (this.routePlayback === playback && playback.distance >= playback.total) this.stopRoute();
  }

  /** Index of the leg containing `distance`: the last leg starting at or before it. */
  private legIndexAt(playback: ActiveRoutePlayback, distance: number): number {
    let index = 0;
    for (let i = 1; i < playback.legs.length; i++) {
      if ((playback.legs[i] as PlaybackLeg).start <= distance) index = i;
    }
    return index;
  }

  /**
   * Where playback stands at `local` metres into `leg`: the plan point, how
   * far above/below the floor (floor-change transitions rise out of one floor
   * and into the next), which floor is shown, and the fade to apply.
   */
  private playbackView(
    leg: PlaybackLeg,
    local: number,
  ): {
    point: Point;
    direction: Point | null;
    lift: number;
    floorId: string | undefined;
    walkIndex: number;
    fade: number;
  } {
    if (leg.kind === "walk") {
      const here = sampleRoutePath(leg.path, local);
      return {
        point: here.point,
        direction: here.direction,
        lift: 0,
        floorId: leg.floorId,
        walkIndex: leg.walkIndex,
        fade: 0,
      };
    }
    const t = leg.length > 0 ? Math.max(0, Math.min(1, local / leg.length)) : 1;
    const sign = leg.arrival.direction === "down" ? -1 : 1;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const firstHalf = t < 0.5;
    // Leave the old floor (rise/sink away), then arrive from the other side.
    const lift = firstHalf
      ? sign * TRANSITION_RISE_METERS * ease(t * 2)
      : -sign * TRANSITION_RISE_METERS * (1 - ease((t - 0.5) * 2));
    return {
      point: firstHalf ? leg.from : leg.to,
      direction: null,
      lift,
      floorId: firstHalf ? leg.fromFloorId : leg.floorId,
      walkIndex: firstHalf ? leg.walkIndex : leg.walkIndex + 1,
      // Darkest at the switch, so the floor swap happens out of sight.
      fade: TRANSITION_FADE * Math.max(0, 1 - Math.abs(t - 0.5) * 4),
    };
  }

  /** Enters leg `index`: rebuilds the travelled overlay for a floor leg. */
  private enterLeg(playback: ActiveRoutePlayback, index: number): void {
    if (playback.legIndex === index) return;
    playback.legIndex = index;
    const leg = playback.legs[index] as PlaybackLeg;
    if (leg.kind === "transition") return; // keeps the previous floor's travelled line, fully drawn
    playback.snapCamera = true;

    if (playback.traveledMesh) {
      this.playbackGroup.remove(playback.traveledMesh);
      playback.traveledMesh.geometry.dispose();
      (playback.traveledMesh.material as THREE.Material).dispose();
    }
    playback.traveledPath = densifyRoutePath(leg.path, ROUTE_TRAVELED_STEP_METERS);
    playback.traveledMesh = new THREE.Mesh(
      buildRibbonGeometry(
        playback.traveledPath,
        ROUTE_LINE_WIDTH_METERS * 1.05,
        ROUTE_TRAVELED_HEIGHT_METERS,
      ),
      routeRibbonMaterial(ROUTE_TRAVELED_COLOR),
    );
    playback.traveledMesh.geometry.setDrawRange(0, 0);
    this.playbackGroup.add(playback.traveledMesh);
  }

  /** Asks the host to show `floorId` when playback reaches a different floor (or floor leg). */
  private showPlaybackFloor(
    playback: ActiveRoutePlayback,
    floorId: string | undefined,
    walkIndex: number,
  ): void {
    const key = `${floorId ?? ""}|${walkIndex}`;
    if (playback.shownKey === key) return;
    playback.shownKey = key;
    playback.snapCamera = true;
    this.callbacks.onRouteLegChange?.(floorId, walkIndex);
  }

  /** Places marker, travelled overlay and (optionally) the follow camera at the current distance. */
  private positionPlayback(dt: number, driveCameraWhilePaused: boolean): void {
    const playback = this.routePlayback;
    if (!playback) return;
    this.enterLeg(playback, this.legIndexAt(playback, playback.distance));
    const leg = playback.legs[playback.legIndex] as PlaybackLeg;
    const local = playback.distance - leg.start;
    const view = this.playbackView(leg, local);
    this.showPlaybackFloor(playback, view.floorId, view.walkIndex);
    // onRouteLegChange may have stopped or replaced playback (e.g. the host failed to switch floors).
    if (this.routePlayback !== playback) return;
    this.renderer.domElement.style.opacity = view.fade > 0 ? String(1 - view.fade) : "";
    const point = this.toGroundVector(view.point, ROUTE_LINE_HEIGHT_METERS + view.lift);

    if (playback.markerMesh) {
      playback.markerMesh.position.set(point.x, point.y + MARKER_HEIGHT_METERS, point.z);
    }
    if (playback.traveledMesh && playback.traveledPath) {
      const done =
        leg.kind === "walk"
          ? segmentIndexAt(playback.traveledPath, local)
          : playback.traveledPath.points.length;
      playback.traveledMesh.geometry.setDrawRange(0, done * 6);
    }

    if (playback.cameraMode === "overview") return;
    if (playback.paused && !driveCameraWhilePaused) return;

    // Aim a little ahead along the path so the camera starts turning before a corner.
    // A floor change keeps the heading it arrived with.
    if (leg.kind === "walk") {
      const ahead = sampleRoutePath(leg.path, local + CAMERA_LOOK_AHEAD_METERS).point;
      let dx = ahead.x - view.point.x;
      let dy = ahead.y - view.point.y;
      if (Math.hypot(dx, dy) < 0.05 && view.direction) {
        dx = view.direction.x;
        dy = view.direction.y;
      }
      // Map (x, y) -> three.js (x, -y): yaw is measured in the XZ plane.
      const targetYaw = Math.atan2(-dy, dx);
      if (playback.snapCamera) {
        playback.headingYaw = targetYaw;
      } else {
        const delta = wrapAngle(targetYaw - playback.headingYaw);
        playback.headingYaw += delta * (1 - Math.exp(-dt * CAMERA_HEADING_RESPONSE));
      }
    }
    const heading = new THREE.Vector3(
      Math.cos(playback.headingYaw),
      0,
      Math.sin(playback.headingYaw),
    );
    // During a floor change the camera rides with the marker instead of easing after it.
    const snap = playback.snapCamera || leg.kind === "transition";

    if (playback.cameraMode === "third") {
      const target = this.followLookTarget(playback);
      const desired = point
        .clone()
        .addScaledVector(heading, -THIRD_PERSON_BACK_METERS)
        .setY(point.y + THIRD_PERSON_HEIGHT_METERS);
      if (leg.kind === "walk") this.pullInFrontOfWalls(target, desired);
      if (snap) this.camera.position.copy(desired);
      else this.camera.position.lerp(desired, 1 - Math.exp(-dt * CAMERA_POSITION_RESPONSE));
      this.camera.lookAt(target);
    } else {
      const eye = point.clone().setY(point.y + FIRST_PERSON_EYE_HEIGHT_METERS);
      this.camera.position.copy(eye);
      this.camera.lookAt(eye.clone().add(heading));
    }
    playback.snapCamera = false;
  }

  /** Where the follow camera looks: just above the current playback position. */
  private followLookTarget(playback: ActiveRoutePlayback): THREE.Vector3 {
    const leg = playback.legs[Math.max(0, playback.legIndex)] as PlaybackLeg;
    const view = this.playbackView(leg, playback.distance - leg.start);
    return this.toGroundVector(view.point, THIRD_PERSON_LOOK_HEIGHT_METERS + view.lift);
  }

  /** Moves `camera` toward `target` so no wall sits between them. Mutates `camera`. */
  private pullInFrontOfWalls(target: THREE.Vector3, camera: THREE.Vector3): void {
    const offset = camera.clone().sub(target);
    const length = offset.length();
    if (length < 1e-6) return;
    const direction = offset.divideScalar(length);
    this.occlusionRaycaster.set(target, direction);
    this.occlusionRaycaster.far = length;
    const hit = this.occlusionRaycaster
      .intersectObject(this.wallGroup, true)
      .find((h) => h.object instanceof THREE.Mesh);
    if (!hit) return;
    const pulled = Math.max(THIRD_PERSON_MIN_BACK_METERS, hit.distance - 0.3);
    camera.copy(target).addScaledVector(direction, pulled);
  }

  /**
   * Pans the view so `point` (plan coordinates) is the orbit target, keeping the
   * camera's current distance and angle. Ignored while a follow-camera route
   * playback is driving the view (it would be overwritten next frame anyway);
   * overview playback leaves the camera to the user, so it pans as usual.
   */
  focusPoint(point: Point): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const playback = this.routePlayback;
    if (playback && !playback.paused && playback.cameraMode !== "overview") return;
    const target = this.toGroundVector(point, 0);
    const delta = target.clone().sub(this.controls.target);
    this.controls.target.copy(target);
    this.camera.position.add(delta);
    this.controls.update();
  }

  /**
   * Syncs the scene to `state`. Each section (spaces, walls+entrances, POIs,
   * furniture, overlays, route) is rebuilt only when its inputs changed — see
   * `sectionKey()`: the identity of every input element plus a structural
   * fingerprint of its content, so in-place edits (e.g. pushing a space or
   * moving a vertex) are picked up while repeated calls with the same data
   * (camera moves, hover, resize…) cost no geometry churn.
   */
  update(state: Renderer3DState): void {
    this.lastState = state;
    this.syncSections(state, false);
    const bounds = new THREE.Box3()
      .setFromObject(this.spaceGroup)
      .union(new THREE.Box3().setFromObject(this.wallGroup))
      .union(new THREE.Box3().setFromObject(this.entranceGroup))
      .union(new THREE.Box3().setFromObject(this.furnitureGroup));
    const hasGeometry = !bounds.isEmpty();
    if (hasGeometry && (this.fittedFloorId !== state.floor?.id || !this.hadGeometry))
      this.fitView();
    this.fittedFloorId = state.floor?.id;
    this.hadGeometry = hasGeometry;
  }

  /** Frame the actual model, including off-origin and unusually large floor plans. */
  fitView(): void {
    const bounds = new THREE.Box3();
    for (const group of [
      this.spaceGroup,
      this.wallGroup,
      this.entranceGroup,
      this.poiGroup,
      this.furnitureGroup,
    ])
      bounds.union(new THREE.Box3().setFromObject(group));
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 1);
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const horizontalFov = Math.atan(Math.tan(verticalFov) * this.camera.aspect);
    const distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov))) * 1.15;
    this.controls.target.copy(center);
    this.camera.position
      .copy(center)
      .add(new THREE.Vector3(1, 1.2, 1).normalize().multiplyScalar(distance));
    this.camera.near = Math.max(0.01, distance / 10000);
    this.camera.far = Math.max(2000, distance + radius * 10);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  dispose(): void {
    this.disposed = true;
    for (const pending of this.importedModels.values())
      pending.then(disposeImportedModel, () => {});
    this.importedModels.clear();
    if (this.animationHandle !== null) cancelAnimationFrame(this.animationHandle);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("click", this.handleClick);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.handleContextLost);
    this.renderer.domElement.removeEventListener(
      "webglcontextrestored",
      this.handleContextRestored,
    );
    this.controls.dispose();
    for (const group of [
      this.spaceGroup,
      this.wallGroup,
      this.entranceGroup,
      this.poiGroup,
      this.furnitureGroup,
      this.overlayGroup,
      this.routeGroup,
      this.playbackGroup,
    ])
      disposeGroup(group);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /**
   * Rebuilds each section whose inputs differ from what it was last built from
   * (`force` rebuilds all — used after a WebGL context restore, when every GPU
   * resource is gone). A skipped section keeps its meshes, materials and the
   * mesh→data maps untouched, so nothing is created or disposed for it.
   */
  private syncSections(state: Renderer3DState, force: boolean): void {
    const floor = state.floor;
    const spaces = floor?.spaces ?? [];
    const walls = floor?.walls ?? [];
    const entrances = floor?.entrances ?? [];
    const pois = floor?.pois ?? [];
    const furniture = floor?.furniture ?? [];
    const keys = this.sectionKeys;
    const next = (section: SceneSection, key: SectionKey): boolean => {
      if (!force && sameSectionKey(keys[section], key)) return false;
      keys[section] = key;
      return true;
    };

    if (next("spaces", sectionKey([spaces]))) this.rebuildSpaces(spaces);
    if (next("walls", sectionKey([walls, entrances]))) this.rebuildWalls(walls, entrances);
    if (next("pois", sectionKey([pois]))) this.rebuildPois(pois);
    if (next("furniture", sectionKey([furniture]))) this.rebuildFurniture(furniture);
    if (
      next("overlays", sectionKey([state.overlays], `${floor?.id ?? ""}|${this.theme.accentColor}`))
    )
      this.rebuildOverlays(state.overlays, floor?.id);
    if (next("route", this.routeKey(state))) this.rebuildRoute(state.routePoints);
  }

  /** Route inputs: points (by value — hosts often rebuild the array), shape, accent color, and the
   *  floor's walls + space holes, which the drawn curve avoids (routeObstaclesForFloor). Must be
   *  called after the walls/spaces keys are current for `state`. */
  private routeKey(state: Renderer3DState): SectionKey {
    const obstacles = state.floor
      ? `${this.sectionKeys.walls?.hash ?? ""}|${this.sectionKeys.spaces?.hash ?? ""}`
      : "none";
    return {
      refs: [],
      hash: `${fingerprint([state.routePoints])}|${this.routeShape}|${this.theme.accentColor}|${obstacles}`,
    };
  }

  private toGroundVector(point: Point, y = 0): THREE.Vector3 {
    return new THREE.Vector3(point.x, y, -point.y);
  }

  private rebuildSpaces(spaces: readonly Space[]): void {
    disposeGroup(this.spaceGroup);
    this.spaceByMesh.clear();
    this.hoveredSpaceMesh = null;
    this.highlightedSpaceMesh = null;

    for (const space of spaces) {
      if (space.polygon.length < 3) continue;

      const geometries =
        space.type === "stairs"
          ? stairSpaceGeometry(space)
          : (() => {
              const shape = new THREE.Shape(space.polygon.map((p) => new THREE.Vector2(p.x, p.y)));
              for (const hole of space.holes ?? []) {
                if (hole.length >= 3) {
                  shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))));
                }
              }
              const geometry = new THREE.ExtrudeGeometry(shape, {
                depth: 0.08,
                bevelEnabled: false,
              });
              geometry.rotateX(-Math.PI / 2);
              geometry.translate(0, -0.08, 0);
              return [geometry];
            })();
      for (const geometry of geometries) {
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: SPACE_COLORS[space.type],
            emissive: 0x000000,
            side: THREE.DoubleSide,
          }),
        );
        this.spaceGroup.add(mesh);
        this.spaceByMesh.set(mesh, space);
        this.spaceGroup.add(
          new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: 0x666666 }),
          ),
        );
      }
    }

    // Mesh references above are freshly created — re-resolve any explicit highlight against them.
    this.highlightedSpaceMesh = this.highlightedSpaceId
      ? this.findSpaceMesh(this.highlightedSpaceId)
      : null;
    this.refreshSpaceEmissive();
  }

  private rebuildWalls(walls: readonly Wall[], entrances: readonly Entrance[]): void {
    disposeGroup(this.wallGroup);
    disposeGroup(this.entranceGroup);
    const architecture = buildArchitecture(walls, entrances);
    this.wallGroup.add(architecture.walls);
    this.entranceGroup.add(architecture.elements);
  }

  private rebuildPois(pois: readonly POI[]): void {
    disposeGroup(this.poiGroup);
    this.poiByMesh.clear();
    this.hoveredPoiMesh = null;

    // Template geometry, cloned per mesh below so each mesh owns a genuinely distinct disposable
    // resource (disposeGroup() disposes every child's geometry independently) rather than all N
    // meshes sharing one instance by reference.
    const geometry = new THREE.SphereGeometry(0.3, 16, 16);
    for (const poi of pois) {
      const material = new THREE.MeshStandardMaterial({ color: 0xff5c8a });
      const mesh = new THREE.Mesh(geometry.clone(), material);
      mesh.position.copy(this.toGroundVector(poi.position, 1.2));
      this.poiGroup.add(mesh);
      this.poiByMesh.set(mesh, poi);
    }
    geometry.dispose();
  }

  /** Builds a small procedural box model per item (see render/furniture.ts) — no external assets. */
  private rebuildFurniture(items: readonly Furniture[]): void {
    const revision = ++this.furnitureRevision;
    disposeGroup(this.furnitureGroup);
    const used = new Set(items.map((item) => item.modelData).filter(Boolean));
    for (const [data, pending] of this.importedModels) {
      if (!used.has(data)) {
        this.importedModels.delete(data);
        pending.then(disposeImportedModel, () => {});
      }
    }

    for (const item of items) {
      const model = buildFurnitureModel(item);
      model.position.copy(this.toGroundVector(item.position, 0));
      model.rotation.y = THREE.MathUtils.degToRad(item.rotation ?? 0);
      this.furnitureGroup.add(model);
      if (item.modelData) {
        let pending = this.importedModels.get(item.modelData);
        if (!pending) {
          pending = loadFurnitureGLB(item.modelData);
          this.importedModels.set(item.modelData, pending);
        }
        pending.then(
          (source) => {
            if (this.disposed || revision !== this.furnitureRevision) return;
            const instance = instanceFurnitureGLB(source, item);
            disposeGroup(model);
            model.add(instance);
          },
          () => {
            if (this.disposed || revision !== this.furnitureRevision) return;
            model.traverse((object) => {
              if (object instanceof THREE.Mesh)
                (object.material as THREE.MeshStandardMaterial).color.setHex(0xcc5555);
            });
          },
        );
      }
    }
  }

  private rebuildOverlays(overlays: readonly Overlay[], activeFloorId: string | undefined): void {
    disposeGroup(this.overlayGroup);
    this.overlayByMesh.clear();

    // See rebuildPois() above: clone per mesh so each owns its own disposable geometry.
    const geometry = new THREE.ConeGeometry(0.3, 0.8, 12);
    for (const overlay of overlays) {
      if (overlay.floorId !== activeFloorId) continue;
      const material = new THREE.MeshStandardMaterial({ color: this.theme.accentColor });
      const mesh = new THREE.Mesh(geometry.clone(), material);
      mesh.position.copy(this.toGroundVector(overlay.position, 1.5));
      this.overlayGroup.add(mesh);
      this.overlayByMesh.set(mesh, overlay);
    }
    geometry.dispose();
  }

  private rebuildRoute(points: ReadonlyArray<Point | null>): void {
    disposeGroup(this.routeGroup);
    if (points.length === 0) return;

    // Drawn as a flat ribbon (WebGL ignores line widths above 1px) through the same
    // buildRoutePath() shape playback follows, so the marker stays on the line.
    const obstacles = routeObstaclesForFloor(this.lastState?.floor);
    let run: Point[] = [];
    const flushRun = () => {
      const path = buildRoutePath(run, this.routeShape, undefined, obstacles);
      if (path) {
        this.routeGroup.add(
          new THREE.Mesh(
            buildRibbonGeometry(path, ROUTE_LINE_WIDTH_METERS, ROUTE_LINE_HEIGHT_METERS),
            routeRibbonMaterial(this.theme.accentColor),
          ),
        );
      }
      run = [];
    };

    for (const point of points) {
      if (!point) {
        flushRun();
        continue;
      }
      run.push(point);
    }
    flushRun();
  }

  private updatePointer(evt: PointerEvent): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((evt.clientX - rect.left) / rect.width) * 2 - 1,
      -((evt.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private readonly handlePointerMove = (evt: PointerEvent): void => {
    const pointer = this.updatePointer(evt);
    this.raycaster.setFromCamera(pointer, this.camera);

    const poiHit =
      this.raycaster.intersectObjects([...this.poiByMesh.keys()], false)[0]?.object ?? null;
    if (poiHit !== this.hoveredPoiMesh) {
      this.hoveredPoiMesh = poiHit;
      const poi = poiHit ? (this.poiByMesh.get(poiHit) ?? null) : null;
      poiHit?.scale.setScalar(POI_HOVER_SCALE);
      this.callbacks.onPoiHover?.(poi);
      for (const [mesh] of this.poiByMesh) {
        if (mesh !== poiHit) mesh.scale.setScalar(1);
      }
    }

    const spaceHit = poiHit
      ? null
      : (this.raycaster.intersectObjects([...this.spaceByMesh.keys()], false)[0]?.object ?? null);
    if (spaceHit !== this.hoveredSpaceMesh) {
      this.hoveredSpaceMesh = spaceHit;
      this.refreshSpaceEmissive();
    }
  };

  private readonly handleContextLost = (event: Event): void => {
    // preventDefault() is what allows the browser to actually attempt automatic context
    // restoration — without it, the context is permanently lost.
    event.preventDefault();
    this.contextLost = true;
    this.callbacks.onContextLost?.();
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    // All GPU-side geometry/textures were lost with the context — rebuild the scene from the
    // last known state rather than waiting for the next unrelated update() call.
    if (this.lastState) this.syncSections(this.lastState, true);
    this.callbacks.onContextRestored?.();
    if (!this.disposed && this.animationHandle === null) this.animate();
  };

  private readonly handleClick = (evt: MouseEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((evt.clientX - rect.left) / rect.width) * 2 - 1,
      -((evt.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);

    const overlayHit = this.raycaster.intersectObjects([...this.overlayByMesh.keys()], false)[0]
      ?.object;
    if (overlayHit) {
      const overlay = this.overlayByMesh.get(overlayHit);
      if (overlay) this.callbacks.onMarkerClick?.(overlay);
      return;
    }

    const poiHit = this.raycaster.intersectObjects([...this.poiByMesh.keys()], false)[0]?.object;
    if (poiHit) {
      const poi = this.poiByMesh.get(poiHit);
      if (poi) this.callbacks.onPoiClick?.(poi);
      return;
    }

    const spaceHit = this.raycaster.intersectObjects([...this.spaceByMesh.keys()], false)[0]
      ?.object;
    if (spaceHit) {
      const space = this.spaceByMesh.get(spaceHit);
      if (space) this.callbacks.onSpaceClick?.(space);
    }
  };

  private readonly animate = (): void => {
    if (this.disposed) return;
    if (this.contextLost) {
      // Don't reschedule while the context is lost — handleContextRestored() resumes the loop.
      this.animationHandle = null;
      return;
    }
    const playback = this.routePlayback;
    if (playback) this.stepRoutePlayback();
    // Follow cameras drive the view themselves while playing; otherwise the user's controls do.
    const cameraDriven =
      playback !== null &&
      this.routePlayback === playback &&
      !playback.paused &&
      playback.cameraMode !== "overview";
    if (!cameraDriven) this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animationHandle = requestAnimationFrame(this.animate);
  };
}

type SceneSection = "spaces" | "walls" | "pois" | "furniture" | "overlays" | "route";

/**
 * What a scene section was built from: the identity of every input element
 * (so the mesh→Space/POI/Overlay maps never hand out stale objects after a
 * floor swap or undo that recreates equal data) plus a structural fingerprint
 * of their content (so in-place mutation is caught).
 */
interface SectionKey {
  refs: readonly unknown[];
  hash: string;
}

function sectionKey(inputs: ReadonlyArray<readonly unknown[]>, extra = ""): SectionKey {
  const refs: unknown[] = [];
  for (const list of inputs) for (const item of list) refs.push(item);
  return { refs, hash: `${fingerprint(inputs)}|${extra}` };
}

function sameSectionKey(previous: SectionKey | undefined, next: SectionKey): boolean {
  if (!previous || previous.hash !== next.hash) return false;
  if (previous.refs.length !== next.refs.length) return false;
  for (let i = 0; i < next.refs.length; i++) if (previous.refs[i] !== next.refs[i]) return false;
  return true;
}

const FINGERPRINT_F64 = new Float64Array(1);
const FINGERPRINT_U32 = new Uint32Array(FINGERPRINT_F64.buffer);
/** Strings at least this long (e.g. base64 GLB `modelData`) have their hash memoized. */
const LONG_STRING = 512;
const longStringHashes = new Map<string, readonly [number, number]>();

/**
 * Two independent 32-bit hashes (FNV-1a and a murmur-style mix) over every
 * primitive reachable from `value` — array lengths, object keys, numbers by
 * their exact float bits, strings by char code. No JSON serialization;
 * linear in the data size, which is far cheaper than rebuilding geometry.
 */
function fingerprint(value: unknown): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  const word = (x: number): void => {
    a = Math.imul(a ^ x, 0x01000193);
    b = Math.imul(b ^ x, 0x5bd1e995);
    b ^= b >>> 15;
  };
  const text = (s: string): void => {
    word(s.length);
    if (s.length < LONG_STRING) {
      for (let i = 0; i < s.length; i++) word(s.charCodeAt(i));
      return;
    }
    let cached = longStringHashes.get(s);
    if (!cached) {
      let x = 0x811c9dc5;
      let y = 0x9747b28c;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        x = Math.imul(x ^ c, 0x01000193);
        y = Math.imul(y ^ c, 0x5bd1e995);
        y ^= y >>> 15;
      }
      cached = [x, y];
      if (longStringHashes.size >= 64) longStringHashes.clear();
      longStringHashes.set(s, cached);
    }
    word(cached[0]);
    word(cached[1]);
  };
  const visiting = new Set<object>();
  const visit = (v: unknown): void => {
    switch (typeof v) {
      case "number":
        FINGERPRINT_F64[0] = v;
        word(1);
        word(FINGERPRINT_U32[0] as number);
        word(FINGERPRINT_U32[1] as number);
        return;
      case "string":
        word(2);
        text(v);
        return;
      case "boolean":
        word(v ? 3 : 4);
        return;
      case "undefined":
        word(5);
        return;
      case "bigint":
        word(6);
        text(v.toString());
        return;
      case "object": {
        if (v === null) {
          word(7);
          return;
        }
        if (visiting.has(v)) {
          word(8);
          return;
        }
        visiting.add(v);
        if (Array.isArray(v)) {
          word(9);
          word(v.length);
          for (const item of v) visit(item);
        } else {
          word(10);
          for (const key of Object.keys(v)) {
            text(key);
            visit((v as Record<string, unknown>)[key]);
          }
          word(11);
        }
        visiting.delete(v);
        return;
      }
      default:
        word(12); // functions / symbols carry no render input
    }
  };
  visit(value);
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}

function setSpaceEmissive(mesh: THREE.Object3D | null, color: number): void {
  if (!mesh || !(mesh instanceof THREE.Mesh)) return;
  const material = mesh.material as THREE.MeshStandardMaterial;
  material.emissive.setHex(color);
}

function clampPlaybackSpeed(speed: number): number {
  return Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, speed));
}

/** Wraps an angle difference into (-π, π]. */
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function routeRibbonMaterial(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/**
 * A flat strip `width` wide along `path`, lying `y` above the floor, with
 * mitred joins so sharp corners don't open gaps. Two vertices per path point
 * and six indices per segment — so `setDrawRange(0, 6 * k)` shows exactly the
 * first k segments.
 */
function buildRibbonGeometry(path: RoutePath, width: number, y: number): THREE.BufferGeometry {
  const { points } = path;
  const n = points.length;
  const half = width / 2;
  const positions = new Float32Array(n * 2 * 3);
  const normalOf = (a: Point, b: Point): Point => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  };
  for (let i = 0; i < n; i++) {
    const p = points[i] as Point;
    const prev = i > 0 ? normalOf(points[i - 1] as Point, p) : null;
    const next = i < n - 1 ? normalOf(p, points[i + 1] as Point) : null;
    let offset: Point;
    if (prev && next) {
      const mx = prev.x + next.x;
      const my = prev.y + next.y;
      const len = Math.hypot(mx, my);
      if (len < 1e-6) {
        offset = { x: prev.x * half, y: prev.y * half };
      } else {
        const m = { x: mx / len, y: my / len };
        // Miter length grows as 1/cos(half-angle); cap it so a hairpin doesn't spike.
        const scale = half / Math.max(0.35, m.x * prev.x + m.y * prev.y);
        offset = { x: m.x * scale, y: m.y * scale };
      }
    } else {
      const only = (prev ?? next) as Point;
      offset = { x: only.x * half, y: only.y * half };
    }
    // Map (x, y) -> three.js (x, y-up, -y), matching toGroundVector().
    positions.set(
      [p.x + offset.x, y, -(p.y + offset.y), p.x - offset.x, y, -(p.y - offset.y)],
      i * 6,
    );
  }
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.LineSegments
    ) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
    if (child instanceof THREE.SkinnedMesh) child.skeleton.dispose();
  });
  group.clear();
}
