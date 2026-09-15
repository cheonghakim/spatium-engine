import type { Point } from "../types/common.js";

export interface BoundingBox {
  min: Point;
  max: Point;
}

export function boundingBoxOfPoints(points: Point[]): BoundingBox {
  if (points.length === 0) {
    return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

export function boundingBoxContainsPoint(box: BoundingBox, point: Point): boolean {
  return (
    point.x >= box.min.x && point.x <= box.max.x && point.y >= box.min.y && point.y <= box.max.y
  );
}

export function boundingBoxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y;
}
