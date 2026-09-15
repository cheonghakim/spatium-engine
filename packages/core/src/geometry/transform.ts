import type { Point } from "../types/common.js";

export function translatePoint(point: Point, delta: Point): Point {
  return { x: point.x + delta.x, y: point.y + delta.y };
}

export function translatePoints(points: Point[], delta: Point): Point[] {
  return points.map((p) => translatePoint(p, delta));
}

/** Rotate a point around a pivot by the given angle (radians, counter-clockwise). */
export function rotatePoint(point: Point, pivot: Point, angleRad: number): Point {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

export function scalePointFrom(point: Point, pivot: Point, factor: number): Point {
  return {
    x: pivot.x + (point.x - pivot.x) * factor,
    y: pivot.y + (point.y - pivot.y) * factor,
  };
}
