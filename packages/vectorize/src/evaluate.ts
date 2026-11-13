import type { Point } from "@indoor/core";
import type { DraftElement } from "./detectElements.js";
import type { DraftSpace, DraftWall } from "./vectorizeFloorPlan.js";

/** Hand-checked answer for one drawing, in the same world frame (meters) as the result being scored. */
export interface EvaluationTruth {
  walls: Array<{ start: Point; end: Point }>;
  /** Floor areas. Voids (stairwell openings, atria) are `holes`, or simply left uncovered. */
  spaces: Array<{ polygon: Point[]; holes?: Point[][] }>;
  stairs: Array<{ position: Point; polygon?: Point[] }>;
  /** Doors, windows and passages. */
  openings: Point[];
}

/** What gets scored: a `VectorizationResult`, or any other recognizer's output in the same shape. */
export interface EvaluationPrediction {
  walls: ReadonlyArray<Pick<DraftWall, "start" | "end">>;
  spaces: ReadonlyArray<Pick<DraftSpace, "polygon">>;
  elements?: ReadonlyArray<Pick<DraftElement, "type" | "position" | "replacesWallIndices">>;
}

export interface EvaluationOptions {
  /** A wall sample counts as right when a wall of the other set runs within this distance (m). */
  wallToleranceM?: number;
  /** Raster cell (m) used to compare floor areas. Enlarged automatically on very large plans. */
  cellM?: number;
  /** A truth room counts as found when one predicted room overlaps it at least this much (IoU). */
  roomIou?: number;
  stairToleranceM?: number;
  openingToleranceM?: number;
}

export interface MatchCount {
  matched: number;
  truth: number;
  predicted: number;
}

/** Ratios are null when their denominator is empty (nothing predicted / nothing in the truth). */
export interface VectorizationScore {
  walls: {
    /** Share of predicted wall length lying on a real wall — low = false walls. */
    precision: number | null;
    /** Share of real wall length that was detected — low = missed walls. */
    recall: number | null;
    predictedLengthM: number;
    truthLengthM: number;
  };
  floor: {
    precision: number | null;
    recall: number | null;
    iou: number | null;
    predictedAreaM2: number;
    truthAreaM2: number;
  };
  rooms: MatchCount;
  stairs: MatchCount;
  openings: MatchCount;
}

const DEFAULT_OPTIONS: Required<EvaluationOptions> = {
  wallToleranceM: 0.2,
  cellM: 0.1,
  roomIou: 0.5,
  stairToleranceM: 1.5,
  openingToleranceM: 0.5,
};

const MAX_CELLS = 4_000_000;

type Segment = { start: Point; end: Point };

const segmentLength = (s: Segment) => Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);

function distanceToSegment(p: Point, s: Segment): number {
  const dx = s.end.x - s.start.x,
    dy = s.end.y - s.start.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq
    ? Math.max(0, Math.min(1, ((p.x - s.start.x) * dx + (p.y - s.start.y) * dy) / lengthSq))
    : 0;
  return Math.hypot(p.x - s.start.x - t * dx, p.y - s.start.y - t * dy);
}

/** Length of `walls` (m) that runs within `tolerance` of some wall in `reference`. */
function coveredLength(
  walls: readonly Segment[],
  reference: readonly Segment[],
  tolerance: number,
) {
  let covered = 0;
  for (const wall of walls) {
    const length = segmentLength(wall);
    if (!length) continue;
    const pieces = Math.max(1, Math.ceil(length / 0.1));
    for (let i = 0; i < pieces; i++) {
      const t = (i + 0.5) / pieces;
      const p = {
        x: wall.start.x + (wall.end.x - wall.start.x) * t,
        y: wall.start.y + (wall.end.y - wall.start.y) * t,
      };
      if (reference.some((r) => distanceToSegment(p, r) <= tolerance)) covered += length / pieces;
    }
  }
  return covered;
}

function inside(p: Point, polygon: readonly Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!,
      b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      result = !result;
  }
  return result;
}

interface Grid {
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
}

/** Per cell: index of the space covering its centre, or -1. */
function rasterize(
  spaces: ReadonlyArray<{ polygon: readonly Point[]; holes?: readonly Point[][] }>,
  grid: Grid,
): Int32Array {
  const labels = new Int32Array(grid.cols * grid.rows).fill(-1);
  spaces.forEach((space, index) => {
    if (space.polygon.length < 3) return;
    const xs = space.polygon.map((p) => p.x),
      ys = space.polygon.map((p) => p.y);
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
    const c0 = clamp(Math.floor((Math.min(...xs) - grid.minX) / grid.cell), grid.cols);
    const c1 = clamp(Math.floor((Math.max(...xs) - grid.minX) / grid.cell), grid.cols);
    const r0 = clamp(Math.floor((Math.min(...ys) - grid.minY) / grid.cell), grid.rows);
    const r1 = clamp(Math.floor((Math.max(...ys) - grid.minY) / grid.cell), grid.rows);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const p = { x: grid.minX + (c + 0.5) * grid.cell, y: grid.minY + (r + 0.5) * grid.cell };
        if (inside(p, space.polygon) && !space.holes?.some((hole) => inside(p, hole)))
          labels[r * grid.cols + c] = index;
      }
  });
  return labels;
}

/** Each truth item takes the nearest still-unclaimed prediction within reach. */
function matchPoints(
  predicted: readonly Point[],
  truth: ReadonlyArray<{ position: Point; polygon?: readonly Point[] }>,
  tolerance: number,
): MatchCount {
  const used = new Set<number>();
  let matched = 0;
  for (const item of truth) {
    let best = -1,
      bestDistance = Infinity;
    predicted.forEach((p, i) => {
      if (used.has(i)) return;
      const d = Math.hypot(p.x - item.position.x, p.y - item.position.y);
      if ((d <= tolerance || (item.polygon && inside(p, item.polygon))) && d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched++;
    }
  }
  return { matched, truth: truth.length, predicted: predicted.length };
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/**
 * Scores a vectorization against a hand-checked answer: missed and false
 * walls, floor area, rooms, stairs and openings. Synthetic fixtures only show
 * the pipeline works on drawings it was written for; this is for measuring it
 * (or any other recognizer producing the same shape) on real ones.
 */
export function evaluateVectorization(
  prediction: EvaluationPrediction,
  truth: EvaluationTruth,
  options: EvaluationOptions = {},
): VectorizationScore {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const elements = prediction.elements ?? [];

  // Treads a stair candidate claims are that stair's strokes, not walls.
  const treads = new Set(
    elements.flatMap((e) => (e.type === "stairs" ? (e.replacesWallIndices ?? []) : [])),
  );
  const predictedWalls = prediction.walls.filter((_, i) => !treads.has(i));
  const predictedLengthM = predictedWalls.reduce((sum, w) => sum + segmentLength(w), 0);
  const truthLengthM = truth.walls.reduce((sum, w) => sum + segmentLength(w), 0);

  const points = [...prediction.spaces, ...truth.spaces].flatMap((s) => s.polygon);
  let floor: VectorizationScore["floor"] = {
    precision: null,
    recall: null,
    iou: null,
    predictedAreaM2: 0,
    truthAreaM2: 0,
  };
  let roomsFound = 0;
  if (points.length) {
    const minX = Math.min(...points.map((p) => p.x)),
      minY = Math.min(...points.map((p) => p.y));
    const width = Math.max(...points.map((p) => p.x)) - minX,
      height = Math.max(...points.map((p) => p.y)) - minY;
    let cell = opts.cellM;
    while (Math.ceil(width / cell + 1) * Math.ceil(height / cell + 1) > MAX_CELLS) cell *= 2;
    const grid: Grid = {
      minX,
      minY,
      cell,
      cols: Math.ceil(width / cell + 1),
      rows: Math.ceil(height / cell + 1),
    };
    const truthLabels = rasterize(truth.spaces, grid);
    const predictedLabels = rasterize(prediction.spaces, grid);
    const truthCells = new Map<number, number>(),
      predictedCells = new Map<number, number>(),
      shared = new Map<string, number>();
    let both = 0,
      either = 0;
    const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);
    for (let i = 0; i < truthLabels.length; i++) {
      const t = truthLabels[i]!,
        p = predictedLabels[i]!;
      if (t < 0 && p < 0) continue;
      either++;
      if (t >= 0) bump(truthCells, t);
      if (p >= 0) bump(predictedCells, p);
      if (t >= 0 && p >= 0) {
        both++;
        bump(shared, `${t}:${p}`);
      }
    }
    const count = (map: Map<number, number>) => [...map.values()].reduce((a, b) => a + b, 0);
    const truthTotal = count(truthCells),
      predictedTotal = count(predictedCells);
    floor = {
      precision: ratio(both, predictedTotal),
      recall: ratio(both, truthTotal),
      iou: ratio(both, either),
      predictedAreaM2: predictedTotal * cell * cell,
      truthAreaM2: truthTotal * cell * cell,
    };
    const found = new Set<number>();
    for (const [key, overlap] of shared) {
      const [t, p] = key.split(":").map(Number) as [number, number];
      const union = truthCells.get(t)! + predictedCells.get(p)! - overlap;
      if (overlap / union >= opts.roomIou) found.add(t);
    }
    roomsFound = found.size;
  }

  const positions = (type: (t: DraftElement["type"]) => boolean) =>
    elements.filter((e) => type(e.type)).map((e) => e.position);
  return {
    walls: {
      precision: ratio(
        coveredLength(predictedWalls, truth.walls, opts.wallToleranceM),
        predictedLengthM,
      ),
      recall: ratio(coveredLength(truth.walls, predictedWalls, opts.wallToleranceM), truthLengthM),
      predictedLengthM,
      truthLengthM,
    },
    floor,
    rooms: {
      matched: roomsFound,
      truth: truth.spaces.length,
      predicted: prediction.spaces.length,
    },
    stairs: matchPoints(
      positions((t) => t === "stairs"),
      truth.stairs,
      opts.stairToleranceM,
    ),
    openings: matchPoints(
      positions((t) => t === "door" || t === "window" || t === "opening"),
      truth.openings.map((position) => ({ position })),
      opts.openingToleranceM,
    ),
  };
}

/**
 * Reads the answer out of a floor traced (or corrected) in the Studio and
 * exported as project JSON. Stair spaces are stairs, not floor.
 */
export function truthFromFloor(floor: {
  walls?: ReadonlyArray<{ start: Point; end: Point }>;
  spaces?: ReadonlyArray<{ polygon: Point[]; holes?: Point[][]; type?: string }>;
  entrances?: ReadonlyArray<{ position: Point; type?: string }>;
}): EvaluationTruth {
  const spaces = floor.spaces ?? [],
    entrances = floor.entrances ?? [];
  const stairSpaces = spaces.filter((s) => s.type === "stairs");
  const centre = (polygon: Point[]): Point => ({
    x: polygon.reduce((sum, p) => sum + p.x, 0) / (polygon.length || 1),
    y: polygon.reduce((sum, p) => sum + p.y, 0) / (polygon.length || 1),
  });
  return {
    walls: (floor.walls ?? []).map((w) => ({ start: w.start, end: w.end })),
    spaces: spaces
      .filter((s) => s.type !== "stairs")
      .map((s) => ({ polygon: s.polygon, ...(s.holes ? { holes: s.holes } : {}) })),
    stairs: [
      ...stairSpaces.map((s) => ({ position: centre(s.polygon), polygon: s.polygon })),
      // A stair entrance drawn inside a stair space is the same staircase.
      ...entrances
        .filter(
          (e) => e.type === "stairs" && !stairSpaces.some((s) => inside(e.position, s.polygon)),
        )
        .map((e) => ({ position: e.position })),
    ],
    openings: entrances
      .filter((e) => e.type === "door" || e.type === "window" || e.type === "opening")
      .map((e) => e.position),
  };
}
