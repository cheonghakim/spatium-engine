import { projectToScreen, projectToWorld, screenDeltaToWorldDelta, type Point } from "@indoor/core";

export interface CameraState {
  center: Point;
  zoom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

const DEFAULT_ZOOM = 50; // screen pixels per world meter
const MIN_ZOOM = 2;
const MAX_ZOOM = 2000;

/**
 * Owns the screen<->world conversion for the editor view. Editing is always
 * top-down and unrotated, so this is a thin wrapper around core's shared
 * camera projection math with rotation fixed at 0 — @indoor/runtime wraps
 * the same functions in its own camera, which does support rotation.
 */
export class EditorCamera {
  private center: Point = { x: 0, y: 0 };
  private zoom: number = DEFAULT_ZOOM;
  private viewport: ViewportSize = { width: 0, height: 0 };

  setViewportSize(size: ViewportSize): void {
    this.viewport = size;
  }

  getState(): CameraState {
    return { center: { ...this.center }, zoom: this.zoom };
  }

  setState(state: CameraState): void {
    this.center = { ...state.center };
    // Clamp here too, not just in zoomBy, so a caller can never push the
    // camera into a zoom level the UI's own zoom controls would refuse.
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom));
  }

  /**
   * Resets pan/zoom back to the camera's initial state (origin-centered, at
   * the default zoom level). Used whenever the view should no longer reflect
   * wherever the previous project happened to leave it — e.g. loading a new
   * project — since a stale pan/zoom could otherwise leave a fresh project's
   * geometry rendered off-screen. Viewport size is untouched: it describes
   * the canvas element, not where the camera happens to be looking.
   */
  reset(): void {
    this.center = { x: 0, y: 0 };
    this.zoom = DEFAULT_ZOOM;
  }

  /** Pan by a delta expressed in screen pixels. */
  panByScreenDelta(delta: Point): void {
    const worldDelta = screenDeltaToWorldDelta(delta, { zoom: this.zoom, rotation: 0 });
    this.center = { x: this.center.x - worldDelta.x, y: this.center.y - worldDelta.y };
  }

  /** Zoom by a multiplicative factor, keeping the given screen point fixed. */
  zoomBy(factor: number, pivotScreen: Point = this.viewportCenter()): void {
    const worldBefore = this.screenToWorld(pivotScreen);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    const worldAfter = this.screenToWorld(pivotScreen);
    this.center = {
      x: this.center.x + (worldBefore.x - worldAfter.x),
      y: this.center.y + (worldBefore.y - worldAfter.y),
    };
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
      rotation: 0,
      viewportWidth: this.viewport.width,
      viewportHeight: this.viewport.height,
    };
  }

  private viewportCenter(): Point {
    return { x: this.viewport.width / 2, y: this.viewport.height / 2 };
  }
}
