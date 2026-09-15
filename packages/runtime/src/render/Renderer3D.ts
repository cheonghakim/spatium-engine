import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { distanceToSegment, type Entrance, type Floor, type POI, type Point, type Space, type SpaceType, type Wall } from "@indoor/core";
import type { Overlay } from "../overlay.js";
import type { RuntimeTheme } from "../theme.js";

export interface Renderer3DCallbacks {
  onSpaceClick?(space: Space): void;
  onPoiClick?(poi: POI): void;
  onPoiHover?(poi: POI | null): void;
  onMarkerClick?(overlay: Overlay): void;
}

export interface Renderer3DState {
  floor: Floor | undefined;
  overlays: readonly Overlay[];
  routePoints: ReadonlyArray<Point | null>;
}

export type RouteCurveShape = "straight" | "smooth";
export type RouteAnimationType = "marker" | "flythrough";
export type RouteCameraMode = "first" | "third";

export interface RoutePlaybackOptions {
  curve?: RouteCurveShape;
  animationType?: RouteAnimationType;
  cameraMode?: RouteCameraMode;
  /** Defaults to the path length divided by a fixed walking speed, clamped to a sane range. */
  durationSeconds?: number;
}

interface ActiveRoutePlayback {
  curve: THREE.Curve<THREE.Vector3>;
  duration: number;
  elapsed: number;
  animationType: RouteAnimationType;
  cameraMode: RouteCameraMode;
  markerMesh: THREE.Mesh | null;
  priorControls: { pan: boolean; zoom: boolean; rotate: boolean };
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
const DEFAULT_WALL_HEIGHT = 2.4;
const WALL_COLOR = 0xb8b8c0;
const WALL_JOIN_EPSILON = 0.01;
const ENTRANCE_COLOR = 0x3ddc84;
const DOOR_WIDTH_METERS = 0.9;
const DOOR_ATTACH_MARGIN_METERS = 0.2;
const MIN_WALL_SEGMENT_METERS = 0.05;
const WALK_SPEED_METERS_PER_SECOND = 1.3;
const MIN_PLAYBACK_DURATION_SECONDS = 2;
const MAX_PLAYBACK_DURATION_SECONDS = 40;
const THIRD_PERSON_BACK_METERS = 4;
const THIRD_PERSON_HEIGHT_METERS = 2.5;
const FIRST_PERSON_EYE_HEIGHT_METERS = 1.6;
const MARKER_HEIGHT_METERS = 0.35;

function pointsClose(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= WALL_JOIN_EPSILON;
}

/**
 * Three.js scene built fresh from Core data every update() — meshes are
 * never the source of truth (spec §22). World XY (map plane) maps to the
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
  private animationHandle: number | null = null;
  private disposed = false;
  private fittedFloorId: string | undefined;
  private hadGeometry = false;
  private routePlayback: ActiveRoutePlayback | null = null;

  constructor(container: HTMLElement, private readonly callbacks: Renderer3DCallbacks = {}) {
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

    this.scene.add(this.spaceGroup, this.wallGroup, this.entranceGroup, this.poiGroup, this.overlayGroup, this.routeGroup, this.playbackGroup);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(20, 30, 10);
    this.scene.add(sun);
    this.scene.background = new THREE.Color(this.theme.background);

    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("click", this.handleClick);

    this.animate();
  }

  getDomElement(): HTMLElement {
    return this.renderer.domElement;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / (height || 1);
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

  /**
   * Plays a moving-marker and/or camera fly-through along the route's
   * on-screen shape — the first contiguous run of non-null points, i.e.
   * whatever `rebuildRoute` currently draws as a line on the active floor
   * (a route can dip to null where a node lives on another floor; playback
   * only follows what's actually visible here, matching the static line's
   * existing scope). `curve: 'smooth'` runs a Catmull-Rom spline through the
   * same points instead of straight segments — no new path data is stored,
   * it's computed fresh each call.
   */
  playRoute(points: ReadonlyArray<Point | null>, options: RoutePlaybackOptions = {}): void {
    const curve = this.buildRouteCurve(points, options.curve ?? "smooth");
    if (!curve) return;

    this.stopRoute();

    const animationType = options.animationType ?? "marker";
    const cameraMode = options.cameraMode ?? "third";
    const duration =
      options.durationSeconds ??
      Math.min(
        MAX_PLAYBACK_DURATION_SECONDS,
        Math.max(MIN_PLAYBACK_DURATION_SECONDS, curve.getLength() / WALK_SPEED_METERS_PER_SECOND),
      );

    let markerMesh: THREE.Mesh | null = null;
    if (animationType === "marker") {
      const geometry = new THREE.SphereGeometry(0.28, 16, 16);
      const material = new THREE.MeshStandardMaterial({ color: this.theme.accentColor });
      markerMesh = new THREE.Mesh(geometry, material);
      this.playbackGroup.add(markerMesh);
    }

    this.routePlayback = {
      curve,
      duration,
      elapsed: 0,
      animationType,
      cameraMode,
      markerMesh,
      priorControls: {
        pan: this.controls.enablePan,
        zoom: this.controls.enableZoom,
        rotate: this.controls.enableRotate,
      },
      lastFrameTime: performance.now(),
    };
    this.setControlsEnabled({ pan: false, zoom: false, rotate: false });
  }

  stopRoute(): void {
    const playback = this.routePlayback;
    if (!playback) return;
    disposeGroup(this.playbackGroup);

    const lastPoint = playback.curve.getPointAt(1);
    this.controls.target.copy(lastPoint);
    this.setControlsEnabled(playback.priorControls);
    this.controls.update();

    this.routePlayback = null;
  }

  private buildRouteCurve(
    points: ReadonlyArray<Point | null>,
    shape: RouteCurveShape,
  ): THREE.Curve<THREE.Vector3> | null {
    let run: THREE.Vector3[] = [];
    for (const point of points) {
      if (point) {
        run.push(this.toGroundVector(point, 0.05));
        continue;
      }
      if (run.length >= 2) break;
      run = [];
    }
    if (run.length < 2) return null;

    if (shape === "smooth") return new THREE.CatmullRomCurve3(run, false, "catmullrom", 0.5);

    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < run.length - 1; i++) {
      path.add(new THREE.LineCurve3(run[i] as THREE.Vector3, run[i + 1] as THREE.Vector3));
    }
    return path;
  }

  /** Advances the active playback by one frame; called from the animate() loop instead of controls.update(). */
  private stepRoutePlayback(): void {
    const playback = this.routePlayback;
    if (!playback) return;

    const now = performance.now();
    const dt = Math.min(0.1, (now - playback.lastFrameTime) / 1000);
    playback.lastFrameTime = now;
    playback.elapsed += dt;

    const u = Math.min(1, playback.duration > 0 ? playback.elapsed / playback.duration : 1);
    const point = playback.curve.getPointAt(u);
    const tangent = playback.curve.getTangentAt(u).normalize();
    const up = new THREE.Vector3(0, 1, 0);

    if (playback.markerMesh) {
      playback.markerMesh.position.set(point.x, point.y + MARKER_HEIGHT_METERS, point.z);
    }

    if (playback.cameraMode === "third") {
      const camPos = point
        .clone()
        .addScaledVector(tangent, -THIRD_PERSON_BACK_METERS)
        .addScaledVector(up, THIRD_PERSON_HEIGHT_METERS);
      this.camera.position.copy(camPos);
      this.camera.lookAt(point.x, point.y + 1, point.z);
    } else {
      const eye = point.clone().addScaledVector(up, FIRST_PERSON_EYE_HEIGHT_METERS);
      this.camera.position.copy(eye);
      this.camera.lookAt(eye.clone().add(tangent));
    }

    if (u >= 1) this.stopRoute();
  }

  update(state: Renderer3DState): void {
    this.rebuildSpaces(state.floor?.spaces ?? []);
    this.rebuildWalls(state.floor?.walls ?? [], state.floor?.entrances ?? []);
    this.rebuildPois(state.floor?.pois ?? []);
    this.rebuildOverlays(state.overlays, state.floor?.id);
    this.rebuildRoute(state.routePoints);
    const hasGeometry = this.spaceGroup.children.length + this.wallGroup.children.length + this.entranceGroup.children.length > 0;
    if (hasGeometry && (this.fittedFloorId !== state.floor?.id || !this.hadGeometry)) this.fitView();
    this.fittedFloorId = state.floor?.id;
    this.hadGeometry = hasGeometry;
  }

  /** Frame the actual model, including off-origin and unusually large floor plans. */
  fitView(): void {
    const bounds = new THREE.Box3();
    for (const group of [this.spaceGroup, this.wallGroup, this.entranceGroup, this.poiGroup]) bounds.union(new THREE.Box3().setFromObject(group));
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 1);
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const horizontalFov = Math.atan(Math.tan(verticalFov) * this.camera.aspect);
    const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov)) * 1.15;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(1, 1.2, 1).normalize().multiplyScalar(distance));
    this.camera.near = Math.max(0.01, distance / 10000);
    this.camera.far = Math.max(2000, distance + radius * 10);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  dispose(): void {
    this.disposed = true;
    if (this.animationHandle !== null) cancelAnimationFrame(this.animationHandle);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("click", this.handleClick);
    this.controls.dispose();
    for (const group of [this.spaceGroup, this.wallGroup, this.entranceGroup, this.poiGroup, this.overlayGroup, this.routeGroup, this.playbackGroup]) disposeGroup(group);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private toGroundVector(point: Point, y = 0): THREE.Vector3 {
    return new THREE.Vector3(point.x, y, -point.y);
  }

  private rebuildSpaces(spaces: readonly Space[]): void {
    disposeGroup(this.spaceGroup);
    this.spaceByMesh.clear();
    this.hoveredSpaceMesh = null;

    for (const space of spaces) {
      if (space.polygon.length < 3) continue;

      const shape = new THREE.Shape(space.polygon.map((p) => new THREE.Vector2(p.x, p.y)));
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: space.height,
        bevelEnabled: false,
      });
      geometry.rotateX(-Math.PI / 2);

      const material = new THREE.MeshStandardMaterial({
        color: SPACE_COLORS[space.type],
        emissive: 0x000000,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      this.spaceGroup.add(mesh);
      this.spaceByMesh.set(mesh, space);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x333333 }),
      );
      this.spaceGroup.add(edges);
    }
  }

  /**
   * Extrudes each wall into a real 3D box (thickness x height), using the
   * same Shape -> ExtrudeGeometry -> rotateX(-90deg) pipeline as rooms so a
   * floor plan with only walls (no closed Space yet) still shows something
   * in 3D instead of an all-but-invisible flat line.
   *
   * Each wall is otherwise a square-cut rectangle aligned to its own
   * direction, so two walls meeting at a corner (any angle, not just 90deg)
   * leave a visible gap on one side and a jagged overlap on the other where
   * the cuts don't line up. Extending a wall's own half-thickness past any
   * endpoint it shares with another wall's endpoint (WALL_JOIN_EPSILON)
   * closes that gap by fully covering the joint — a cheap miter
   * approximation that's invisible since adjoining walls share material.
   *
   * Entrances sitting on (or very near) a wall cut a door-width gap in that
   * wall instead of an unbroken box — this is the only renderer that models
   * doors as actual 3D geometry (the 2D renderers just draw a dot), since
   * before this a door never showed up in the 3D preview at all. Entrances
   * with no nearby wall fall back to a small marker via
   * rebuildUnattachedEntranceMarkers so they're still visible rather than
   * silently missing.
   */
  private rebuildWalls(walls: readonly Wall[], entrances: readonly Entrance[]): void {
    disposeGroup(this.wallGroup);
    disposeGroup(this.entranceGroup);
    if (walls.length === 0) {
      this.rebuildUnattachedEntranceMarkers(entrances);
      return;
    }

    const material = new THREE.MeshStandardMaterial({ color: WALL_COLOR });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x333333 });
    const sharesEndpoint = (point: Point, self: Wall) =>
      walls.some(
        (other) =>
          other !== self &&
          (pointsClose(other.start, point) || pointsClose(other.end, point)),
      );

    const addWallSegmentMesh = (start: Point, end: Point, nx: number, ny: number, height: number) => {
      const corners = [
        { x: start.x + nx, y: start.y + ny },
        { x: end.x + nx, y: end.y + ny },
        { x: end.x - nx, y: end.y - ny },
        { x: start.x - nx, y: start.y - ny },
      ];
      const shape = new THREE.Shape(corners.map((c) => new THREE.Vector2(c.x, c.y)));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      this.wallGroup.add(new THREE.Mesh(geometry, material));
      this.wallGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial));
    };

    const attachedEntranceIds = new Set<string>();

    for (const wall of walls) {
      const dx = wall.end.x - wall.start.x;
      const dy = wall.end.y - wall.start.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;

      const halfThickness = wall.thickness / 2;
      const ux = dx / length;
      const uy = dy / length;
      const nx = -uy * halfThickness;
      const ny = ux * halfThickness;
      const height = wall.height ?? DEFAULT_WALL_HEIGHT;

      const extendedStart = sharesEndpoint(wall.start, wall)
        ? { x: wall.start.x - ux * halfThickness, y: wall.start.y - uy * halfThickness }
        : wall.start;
      const extendedEnd = sharesEndpoint(wall.end, wall)
        ? { x: wall.end.x + ux * halfThickness, y: wall.end.y + uy * halfThickness }
        : wall.end;

      // Door gaps as [from, to] distance-along-wall intervals, for every
      // entrance close enough to this wall's centerline to count as "on" it.
      const attachMargin = halfThickness + DOOR_ATTACH_MARGIN_METERS;
      const gaps: Array<{ from: number; to: number }> = [];
      for (const entrance of entrances) {
        const hit = distanceToSegment(entrance.position, wall.start, wall.end);
        if (hit.distance > attachMargin) continue;
        attachedEntranceIds.add(entrance.id);
        const t = (hit.point.x - wall.start.x) * ux + (hit.point.y - wall.start.y) * uy;
        const doorWidth = Math.min(DOOR_WIDTH_METERS, length * 0.8);
        gaps.push({ from: t - doorWidth / 2, to: t + doorWidth / 2 });
      }

      if (gaps.length === 0) {
        addWallSegmentMesh(extendedStart, extendedEnd, nx, ny, height);
        continue;
      }

      gaps.sort((a, b) => a.from - b.from);
      let cursor = 0;
      for (const gap of gaps) {
        const gapFrom = Math.max(0, gap.from);
        const gapTo = Math.min(length, gap.to);
        if (gapFrom - cursor > MIN_WALL_SEGMENT_METERS) {
          const segStart = cursor <= 0 ? extendedStart : { x: wall.start.x + ux * cursor, y: wall.start.y + uy * cursor };
          const segEnd = { x: wall.start.x + ux * gapFrom, y: wall.start.y + uy * gapFrom };
          addWallSegmentMesh(segStart, segEnd, nx, ny, height);
        }
        cursor = Math.max(cursor, gapTo);
      }
      if (length - cursor > MIN_WALL_SEGMENT_METERS) {
        const segStart = { x: wall.start.x + ux * cursor, y: wall.start.y + uy * cursor };
        addWallSegmentMesh(segStart, extendedEnd, nx, ny, height);
      }
    }

    this.rebuildUnattachedEntranceMarkers(entrances, attachedEntranceIds);
  }

  /**
   * Entrances that aren't close enough to any wall (e.g. placed before a
   * wall existed, or the "not connected to any space" validation case) get
   * a small visible marker instead of vanishing from the 3D view entirely.
   */
  private rebuildUnattachedEntranceMarkers(entrances: readonly Entrance[], attachedIds?: ReadonlySet<string>): void {
    const geometry = new THREE.BoxGeometry(0.5, 1.4, 0.08);
    const material = new THREE.MeshStandardMaterial({ color: ENTRANCE_COLOR });
    for (const entrance of entrances) {
      if (attachedIds?.has(entrance.id)) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(this.toGroundVector(entrance.position, 0.7));
      this.entranceGroup.add(mesh);
    }
  }

  private rebuildPois(pois: readonly POI[]): void {
    disposeGroup(this.poiGroup);
    this.poiByMesh.clear();
    this.hoveredPoiMesh = null;

    const geometry = new THREE.SphereGeometry(0.3, 16, 16);
    for (const poi of pois) {
      const material = new THREE.MeshStandardMaterial({ color: 0xff5c8a });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(this.toGroundVector(poi.position, 1.2));
      this.poiGroup.add(mesh);
      this.poiByMesh.set(mesh, poi);
    }
  }

  private rebuildOverlays(overlays: readonly Overlay[], activeFloorId: string | undefined): void {
    disposeGroup(this.overlayGroup);
    this.overlayByMesh.clear();

    const geometry = new THREE.ConeGeometry(0.3, 0.8, 12);
    for (const overlay of overlays) {
      if (overlay.floorId !== activeFloorId) continue;
      const material = new THREE.MeshStandardMaterial({ color: this.theme.accentColor });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(this.toGroundVector(overlay.position, 1.5));
      this.overlayGroup.add(mesh);
      this.overlayByMesh.set(mesh, overlay);
    }
  }

  private rebuildRoute(points: ReadonlyArray<Point | null>): void {
    disposeGroup(this.routeGroup);
    if (points.length === 0) return;

    let segment: THREE.Vector3[] = [];
    const flushSegment = () => {
      if (segment.length >= 2) {
        const geometry = new THREE.BufferGeometry().setFromPoints(segment);
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: this.theme.accentColor }));
        this.routeGroup.add(line);
      }
      segment = [];
    };

    for (const point of points) {
      if (!point) {
        flushSegment();
        continue;
      }
      segment.push(this.toGroundVector(point, 0.05));
    }
    flushSegment();
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

    const poiHit = this.raycaster.intersectObjects([...this.poiByMesh.keys()], false)[0]?.object ?? null;
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
      setSpaceEmissive(this.hoveredSpaceMesh, 0x000000);
      setSpaceEmissive(spaceHit, 0x333333);
      this.hoveredSpaceMesh = spaceHit;
    }
  };

  private readonly handleClick = (evt: MouseEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((evt.clientX - rect.left) / rect.width) * 2 - 1,
      -((evt.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);

    const overlayHit = this.raycaster.intersectObjects([...this.overlayByMesh.keys()], false)[0]?.object;
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

    const spaceHit = this.raycaster.intersectObjects([...this.spaceByMesh.keys()], false)[0]?.object;
    if (spaceHit) {
      const space = this.spaceByMesh.get(spaceHit);
      if (space) this.callbacks.onSpaceClick?.(space);
    }
  };

  private readonly animate = (): void => {
    if (this.disposed) return;
    if (this.routePlayback) {
      this.stepRoutePlayback();
    } else {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
    this.animationHandle = requestAnimationFrame(this.animate);
  };
}

function setSpaceEmissive(mesh: THREE.Object3D | null, color: number): void {
  if (!mesh || !(mesh instanceof THREE.Mesh)) return;
  const material = mesh.material as THREE.MeshStandardMaterial;
  material.emissive.setHex(color);
}

function disposeGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
  }
}
