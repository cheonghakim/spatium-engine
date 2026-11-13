import type { Point } from "@indoor/core";

/**
 * Rubber-band (marquee) selection geometry, shared by SelectTool and
 * DraftReviewTool. Follows the CAD convention floor-plan users expect:
 * dragging left→right is a *window* selection (only objects fully inside the
 * box), dragging right→left is a *crossing* selection (anything the box
 * touches). A room that merely encloses the box is NOT picked by crossing —
 * otherwise boxing noise inside a big detected room would always grab the
 * room too.
 */
export type MarqueeMode = "window" | "crossing";

export interface Marquee {
  start: Point;
  end: Point;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function marqueeMode(marquee: Marquee): MarqueeMode {
  return marquee.end.x >= marquee.start.x ? "window" : "crossing";
}

export function marqueeRect({ start, end }: Marquee): Rect {
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

function orientation(a: Point, b: Point, c: Point): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(v) < 1e-12 ? 0 : Math.sign(v);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c),
    o2 = orientation(a, b, d),
    o3 = orientation(c, d, a),
    o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b))
  );
}

function segmentTouchesRect(a: Point, b: Point, r: Rect): boolean {
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const tl = { x: r.minX, y: r.minY },
    tr = { x: r.maxX, y: r.minY },
    br = { x: r.maxX, y: r.maxY },
    bl = { x: r.minX, y: r.maxY };
  return (
    segmentsIntersect(a, b, tl, tr) ||
    segmentsIntersect(a, b, tr, br) ||
    segmentsIntersect(a, b, br, bl) ||
    segmentsIntersect(a, b, bl, tl)
  );
}

export function segmentInMarquee(a: Point, b: Point, r: Rect, mode: MarqueeMode): boolean {
  return mode === "window" ? pointInRect(a, r) && pointInRect(b, r) : segmentTouchesRect(a, b, r);
}

export function polygonInMarquee(polygon: readonly Point[], r: Rect, mode: MarqueeMode): boolean {
  if (polygon.length === 0) return false;
  if (mode === "window") return polygon.every((p) => pointInRect(p, r));
  return polygon.some((p, i) => segmentTouchesRect(p, polygon[(i + 1) % polygon.length]!, r));
}

/** Screen-space distance (px) a press must travel before it becomes a marquee instead of a click. */
export const MARQUEE_THRESHOLD_PX = 4;
