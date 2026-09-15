import type { Point } from "../types/common.js";

/**
 * Pure screen<->world projection math, shared by @indoor/editor's camera
 * (rotation always 0) and @indoor/runtime's camera (which supports rotation).
 * World Y points north (up); screen Y points down — the one place that flip
 * happens. `rotation` is applied clockwise on screen, in radians.
 */
export interface CameraProjection {
  center: Point;
  zoom: number;
  rotation: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function projectToScreen(world: Point, camera: CameraProjection): Point {
  const dx = world.x - camera.center.x;
  const dy = world.y - camera.center.y;

  const cos = Math.cos(camera.rotation);
  const sin = Math.sin(camera.rotation);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  return {
    x: camera.viewportWidth / 2 + rx * camera.zoom,
    y: camera.viewportHeight / 2 - ry * camera.zoom,
  };
}

export function projectToWorld(screen: Point, camera: CameraProjection): Point {
  const sx = (screen.x - camera.viewportWidth / 2) / camera.zoom;
  const sy = -(screen.y - camera.viewportHeight / 2) / camera.zoom;

  const cos = Math.cos(-camera.rotation);
  const sin = Math.sin(-camera.rotation);
  const dx = sx * cos - sy * sin;
  const dy = sx * sin + sy * cos;

  return { x: camera.center.x + dx, y: camera.center.y + dy };
}

/** Converts a screen-space drag delta into the world-space delta it represents. */
export function screenDeltaToWorldDelta(
  delta: Point,
  camera: Pick<CameraProjection, "zoom" | "rotation">,
): Point {
  const sx = delta.x / camera.zoom;
  const sy = -delta.y / camera.zoom;

  const cos = Math.cos(-camera.rotation);
  const sin = Math.sin(-camera.rotation);

  return { x: sx * cos - sy * sin, y: sx * sin + sy * cos };
}
