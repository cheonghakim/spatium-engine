import type { Point } from "../types/common.js";

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Point, factor: number): Point {
  return { x: a.x * factor, y: a.y * factor };
}

export function length(a: Point): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function normalize(a: Point): Point {
  const len = length(a);
  if (len === 0) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

/** Z-component of the 3D cross product of two 2D vectors. */
export function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
