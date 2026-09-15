import {
  projectToScreen,
  projectToWorld,
  screenDeltaToWorldDelta,
  type Point,
} from "@indoor/core";

export interface RuntimeCameraState {
  center: Point;
  zoom: number;
  rotation: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

const DEFAULT_ZOOM = 50;
const MIN_ZOOM = 2;
const MAX_ZOOM = 2000;

/**
 * Runtime's own screen<->world camera — deliberately not shared with
 * @indoor/editor's EditorCamera (packages don't depend on each other); both
 * wrap the same core projection math. Unlike the editor, the runtime
 * supports rotation (spec §19's Pan/Zoom/Rotate).
 */
export class RuntimeCamera {
  private center: Point = { x: 0, y: 0 };
  private zoom: number = DEFAULT_ZOOM;
  private rotation = 0;
  private viewport: ViewportSize = { width: 0, height: 0 };

  setViewportSize(size: ViewportSize): void {
    this.viewport = size;
  }

  getState(): RuntimeCameraState {
    return { center: { ...this.center }, zoom: this.zoom, rotation: this.rotation };
  }

  setState(state: RuntimeCameraState): void {
    this.center = { ...state.center };
    this.zoom = state.zoom;
    this.rotation = state.rotation;
  }

  panByScreenDelta(delta: Point): void {
    const worldDelta = screenDeltaToWorldDelta(delta, { zoom: this.zoom, rotation: this.rotation });
    this.center = { x: this.center.x - worldDelta.x, y: this.center.y - worldDelta.y };
  }

  zoomBy(factor: number, pivotScreen: Point = this.viewportCenter()): void {
    const worldBefore = this.screenToWorld(pivotScreen);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    const worldAfter = this.screenToWorld(pivotScreen);
    this.center = {
      x: this.center.x + (worldBefore.x - worldAfter.x),
      y: this.center.y + (worldBefore.y - worldAfter.y),
    };
  }

  rotateBy(angleDeltaRad: number, pivotScreen: Point = this.viewportCenter()): void {
    const worldBefore = this.screenToWorld(pivotScreen);
    this.rotation += angleDeltaRad;
    const worldAfter = this.screenToWorld(pivotScreen);
    this.center = {
      x: this.center.x + (worldBefore.x - worldAfter.x),
      y: this.center.y + (worldBefore.y - worldAfter.y),
    };
  }

  setRotation(angleRad: number): void {
    this.rotateBy(angleRad - this.rotation);
  }

  screenToWorld(screenPoint: Point): Point {
    return projectToWorld(screenPoint, this.toProjection());
  }

  worldToScreen(worldPoint: Point): Point {
    return projectToScreen(worldPoint, this.toProjection());
  }

  private toProjection() {
    return {
      center: this.center,
      zoom: this.zoom,
      rotation: this.rotation,
      viewportWidth: this.viewport.width,
      viewportHeight: this.viewport.height,
    };
  }

  private viewportCenter(): Point {
    return { x: this.viewport.width / 2, y: this.viewport.height / 2 };
  }
}
