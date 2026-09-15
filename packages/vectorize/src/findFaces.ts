import type { PixelPoint, PlanarGraph } from "./buildGraph.js";

export interface Face {
  /** Node indices in order, forming a closed loop (first point is not repeated at the end). */
  nodeIndices: number[];
  areaPx: number;
}

function signedArea(points: PixelPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Traces every face of a planar straight-line graph (spec §18: wall lines ->
 * closed room loops), including the single unbounded outer face.
 *
 * Standard rotation-system face traversal: sort each vertex's neighbors by
 * angle, then for a dart (u -> v), the next dart is (v -> w) where w is
 * v's neighbor immediately after u in v's sorted list (wrapping around).
 * Every directed dart belongs to exactly one face, so tracing from every
 * unvisited dart enumerates all faces exactly once.
 */
export function findFaces(graph: PlanarGraph): Face[] {
  const neighbors: number[][] = graph.points.map(() => []);
  for (const edge of graph.edges) {
    neighbors[edge.from]!.push(edge.to);
    neighbors[edge.to]!.push(edge.from);
  }

  const angleFrom = (from: number, to: number): number => {
    const a = graph.points[from]!;
    const b = graph.points[to]!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };

  const sortedNeighbors: number[][] = graph.points.map((_, node) => {
    const list = [...new Set(neighbors[node])];
    list.sort((a, b) => angleFrom(node, a) - angleFrom(node, b));
    return list;
  });

  function nextDart(from: number, current: number): number {
    const list = sortedNeighbors[current]!;
    const index = list.indexOf(from);
    return list[(index + 1) % list.length]!;
  }

  const visited = new Set<string>();
  const faces: Face[] = [];

  for (const edge of graph.edges) {
    for (const [start, next] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ] as const) {
      const startKey = `${start}:${next}`;
      if (visited.has(startKey)) continue;

      const loop = [start];
      let prev = start;
      let current = next;
      visited.add(`${prev}:${current}`);

      while (current !== start) {
        loop.push(current);
        const upcoming = nextDart(prev, current);
        prev = current;
        current = upcoming;
        const key = `${prev}:${current}`;
        if (visited.has(key)) break;
        visited.add(key);
      }

      if (current === start && loop.length >= 3) {
        faces.push({ nodeIndices: loop, areaPx: signedArea(loop.map((i) => graph.points[i]!)) });
      }
    }
  }

  return faces;
}

/**
 * Drops the single largest-area face (the unbounded "outside") and any
 * slivers below `minAreaPx`, leaving room-polygon candidates.
 */
export function selectRoomFaces(faces: Face[], minAreaPx: number): Face[] {
  if (faces.length === 0) return [];
  let outerIndex = 0;
  for (let i = 1; i < faces.length; i++) {
    if (Math.abs(faces[i]!.areaPx) > Math.abs(faces[outerIndex]!.areaPx)) outerIndex = i;
  }
  return faces.filter((f, i) => i !== outerIndex && Math.abs(f.areaPx) >= minAreaPx);
}
