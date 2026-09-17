import type { Entrance, Point } from "@indoor/core";
import type { DraftWall } from "./vectorizeFloorPlan.js";

export interface DraftElement extends Pick<Entrance, "type" | "position" | "width" | "height" | "depth" | "rotation" | "stepCount" | "sillHeight"> {
  confidence: number;
  reason: string;
  /** Added only if this candidate is accepted; restores the lintel/sill across a gap. */
  supportWall?: DraftWall;
  /** Existing wall strokes replaced by the accepted architectural element. */
  replacesWallIndices?: number[];
}

/** Conservative, scale-dependent geometric candidates, not a semantic classifier. */
export function detectElements(walls: readonly DraftWall[]): DraftElement[] {
  const result: DraftElement[] = [];
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  for (let i = 0; i < walls.length; i++) {
    const a = walls[i]!, length = distance(a.start, a.end);
    if (length < 0.4) continue;
    const ux = (a.end.x - a.start.x) / length, uy = (a.end.y - a.start.y) / length;
    for (let j = i + 1; j < walls.length; j++) {
      const b = walls[j]!, bl = distance(b.start, b.end);
      if (bl < 0.4 || Math.abs(a.thickness - b.thickness) > 0.08) continue;
      const cross = (p: Point) => (p.x - a.start.x) * uy - (p.y - a.start.y) * ux;
      if (Math.max(Math.abs(cross(b.start)), Math.abs(cross(b.end))) > 0.04) continue;
      const project = (p: Point) => (p.x - a.start.x) * ux + (p.y - a.start.y) * uy;
      const lo = Math.min(project(b.start), project(b.end)), hi = Math.max(project(b.start), project(b.end));
      const from = lo > length ? length : hi < 0 ? hi : 0;
      const to = lo > length ? lo : hi < 0 ? 0 : 0;
      const gap = to - from;
      if (gap < 0.55 || gap > 2.4) continue;
      const start = { x: a.start.x + ux * from, y: a.start.y + uy * from };
      const end = { x: a.start.x + ux * to, y: a.start.y + uy * to };
      const position = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      // Do not bridge a junction, another collinear wall, or a previously proposed gap.
      const obstructed = walls.some((w, k) => k !== i && k !== j && [w.start, w.end].some(p => {
        const t = project(p);
        return t > from + 0.04 && t < to - 0.04 && Math.abs(cross(p)) < 0.15;
      }));
      if (obstructed || result.some(e => distance(e.position, position) < 0.15)) continue;
      result.push({ type: "opening", position, width: gap, rotation: Math.atan2(uy, ux) * 180 / Math.PI,
        confidence: 0.55, reason: "같은 축의 벽 사이 틈입니다. 문·창문·통로인지 확인하세요.",
        supportWall: { start, end, thickness: (a.thickness + b.thickness) / 2 } });
    }
  }

  // Repeated, similarly sized parallel strokes suggest treads. Keep candidates unaccepted.
  const used = new Set<number>();
  for (let i = 0; i < walls.length; i++) {
    if (used.has(i)) continue;
    const base = walls[i]!, width = distance(base.start, base.end);
    if (width < 0.6 || width > 3 || base.thickness > 0.12) continue;
    const ux = (base.end.x - base.start.x) / width, uy = (base.end.y - base.start.y) / width;
    const center = { x: (base.start.x + base.end.x) / 2, y: (base.start.y + base.end.y) / 2 };
    const matches = walls.map((w, index) => {
      const len = distance(w.start, w.end), cx = (w.start.x + w.end.x) / 2 - center.x, cy = (w.start.y + w.end.y) / 2 - center.y;
      return { index, wall: w, offset: -uy * cx + ux * cy, along: ux * cx + uy * cy, len };
    }).filter(m => !used.has(m.index) && m.wall.thickness <= 0.12 && Math.abs(m.len - width) < 0.12 && Math.abs(m.along) < 0.08 &&
      Math.abs((m.wall.end.x - m.wall.start.x) * uy - (m.wall.end.y - m.wall.start.y) * ux) < 0.04)
      .sort((a, b) => a.offset - b.offset);
    const seed = matches.findIndex(m => m.index === i);
    if (seed < 0) continue;
    let first = seed, last = seed;
    const validGap = (a: number, b: number) => b - a >= 0.16 && b - a <= 0.4;
    while (first > 0 && validGap(matches[first - 1]!.offset, matches[first]!.offset)) first--;
    while (last + 1 < matches.length && validGap(matches[last]!.offset, matches[last + 1]!.offset)) last++;
    const run = matches.slice(first, last + 1);
    if (run.length < 5) continue;
    const spacing = (run[run.length - 1]!.offset - run[0]!.offset) / (run.length - 1);
    if (run.some((m, k) => k > 0 && Math.abs(m.offset - run[k - 1]!.offset - spacing) > spacing * 0.2)) continue;
    const middle = (run[0]!.offset + run[run.length - 1]!.offset) / 2;
    result.push({ type: "stairs", position: { x: center.x - uy * middle, y: center.y + ux * middle },
      width, depth: spacing * run.length, stepCount: run.length, rotation: Math.atan2(ux, -uy) * 180 / Math.PI,
      confidence: 0.65, reason: "일정 간격의 평행선입니다. 계단 여부·상행 방향·층고를 확인하세요.",
      replacesWallIndices: run.map(m => m.index) });
    run.forEach(m => used.add(m.index));
  }
  return result;
}
