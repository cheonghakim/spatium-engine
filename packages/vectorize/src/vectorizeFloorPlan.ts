import type { Point } from "@indoor/core";
import { binarize, denoise, robustThreshold, toGrayscale, type RawImage } from "./binarize.js";
import {
  detectHorizontalSegments,
  detectVerticalSegments,
  mergeParallelSegments,
} from "./detectLines.js";
import { buildPlanarGraph } from "./buildGraph.js";
import {
  absorbFringes,
  mergeCollinearEdges,
  pruneGraph,
  estimateFaceGap,
  findLadders,
  joinWallEnds,
  pairWallFaces,
  singleLinePartitions,
  splitWallSegments,
  unionCollinearSegments,
} from "./cleanup.js";
import { findFaces, selectRoomFaces } from "./findFaces.js";
import { detectElements, type DetectElementsOptions, type DraftElement } from "./detectElements.js";
import { estimateSkewAngle, imageCenter, rotateBinaryImage, rotatePoint } from "./deskew.js";
import type { PixelPoint } from "./buildGraph.js";
import { detectRegions, structuralInk } from "./regions.js";

export interface VectorizeOptions {
  /**
   * `lines` (default): find straight horizontal/vertical strokes and close them
   * into rooms. `regions`: start from the open floor areas and read the walls
   * off their outlines — copes with hand-drawn lines and walls at any angle,
   * and depends on the scale calibration being right.
   */
  method?: "lines" | "regions";
  autoThreshold?: boolean;
  /** Bridge small scan defects, preserving larger openings. */
  maxLineGapPx?: number;
  /** Reject thin furniture/text strokes before constructing the graph. */
  minWallThicknessPx?: number;
  /**
   * Estimate the plan's wall stroke thickness and set aside strokes thinner
   * than half of it (furniture, text, dimension lines, door leaves). Plans
   * drawn entirely in thin single lines are unaffected.
   */
  autoWallThickness?: boolean;
  /**
   * On plans drawn in thin lines, pair each wall's two face lines into one
   * wall and drop lines with no partner (dimension lines, furniture, text).
   */
  pairWallFaces?: boolean;
  /**
   * Keep only wall groups at least this share (0–1) of the largest connected
   * wall structure; smaller free-floating groups are annotations, paving or
   * furniture. 0 keeps everything.
   */
  minStructureShare?: number;
  /** Grayscale threshold (0-255); pixels darker than this count as wall ink. */
  threshold?: number;
  /** Minimum run length (px) to count as a wall segment candidate. */
  minSegmentLengthPx?: number;
  /** Max gap (px) between parallel runs to merge into one wall centerline. */
  maxMergeGapPx?: number;
  /** Tolerance (px) for snapping nearby endpoints into one graph node. */
  snapTolerancePx?: number;
  /** Minimum face area (px²) to keep as a room candidate, rejecting slivers. */
  minRoomAreaPx?: number;
  /** Estimate and correct small global rotation (a crooked photo/scan) before scanning for axis-aligned segments. */
  autoDeskew?: boolean;
  /** Below this width (m), a gap between two collinear walls is a scan defect, not a door/window opening. Passed through to `detectElements`. */
  minOpeningGapM?: number;
  /** Above this width (m), a gap is too wide to read as a single door/window opening. Passed through to `detectElements`. */
  maxOpeningGapM?: number;
  /** Minimum wall run length (m) eligible to be paired across a candidate opening. Passed through to `detectElements`. */
  minElementWallLengthM?: number;
  /** Minimum spacing (m) between adjacent stair-tread strokes. Passed through to `detectElements`. */
  minTreadSpacingM?: number;
  /** Maximum spacing (m) between adjacent stair-tread strokes. Passed through to `detectElements`. */
  maxTreadSpacingM?: number;
  /** Stair-tread candidate run width bounds (m). Passed through to `detectElements`. */
  minTreadWidthM?: number;
  maxTreadWidthM?: number;
  /** Maximum stroke thickness (m) for a wall to be considered a tread. Passed through to `detectElements`. */
  maxTreadThicknessM?: number;
  /** Minimum number of regularly spaced treads required to report a staircase candidate. Passed through to `detectElements`. */
  minTreadCount?: number;
}

export interface DraftWall {
  start: Point;
  end: Point;
  thickness: number;
}

export interface DraftSpace {
  polygon: Point[];
  /** Enclosed areas that are not floor (stair cores, shafts, courts). */
  holes?: Point[][];
  /** Boundary crosses an inferred opening; requires explicit review. */
  needsReview?: boolean;
}

export interface VectorizationWarning {
  message: string;
}

export interface VectorizationResult {
  walls: DraftWall[];
  spaces: DraftSpace[];
  warnings: VectorizationWarning[];
  elements: DraftElement[];
}

/** Default option values, in source-image pixel units for the `*Px` fields. */
export const DEFAULTS: Required<VectorizeOptions> = {
  method: "lines",
  autoThreshold: true,
  maxLineGapPx: 2,
  minWallThicknessPx: 1,
  autoWallThickness: true,
  pairWallFaces: true,
  minStructureShare: 0.08,
  threshold: 128,
  minSegmentLengthPx: 15,
  maxMergeGapPx: 2,
  snapTolerancePx: 4,
  minRoomAreaPx: 400,
  autoDeskew: true,
  minOpeningGapM: 0.55,
  maxOpeningGapM: 2.4,
  minElementWallLengthM: 0.4,
  minTreadSpacingM: 0.16,
  maxTreadSpacingM: 0.4,
  minTreadWidthM: 0.6,
  maxTreadWidthM: 3,
  maxTreadThicknessM: 0.12,
  minTreadCount: 5,
};

function elementOptions(options: VectorizeOptions): DetectElementsOptions {
  return {
    ...(options.minOpeningGapM !== undefined ? { minOpeningGapM: options.minOpeningGapM } : {}),
    ...(options.maxOpeningGapM !== undefined ? { maxOpeningGapM: options.maxOpeningGapM } : {}),
    ...(options.minElementWallLengthM !== undefined
      ? { minWallLengthM: options.minElementWallLengthM }
      : {}),
    ...(options.minTreadSpacingM !== undefined
      ? { minTreadSpacingM: options.minTreadSpacingM }
      : {}),
    ...(options.maxTreadSpacingM !== undefined
      ? { maxTreadSpacingM: options.maxTreadSpacingM }
      : {}),
    ...(options.minTreadWidthM !== undefined ? { minTreadWidthM: options.minTreadWidthM } : {}),
    ...(options.maxTreadWidthM !== undefined ? { maxTreadWidthM: options.maxTreadWidthM } : {}),
    ...(options.maxTreadThicknessM !== undefined
      ? { maxTreadThicknessM: options.maxTreadThicknessM }
      : {}),
    ...(options.minTreadCount !== undefined ? { minTreadCount: options.minTreadCount } : {}),
  };
}

/** Below this, an estimated rotation is treated as measurement noise rather than real skew, so an already-straight plan is never touched. */
const MIN_SIGNIFICANT_SKEW_DEGREES = 0.3;

/**
 * Classical-CV floor plan vectorization (spec §18's VectorizationService,
 * implemented with heuristics instead of a trained model — see project notes
 * on why: no license-clean, Node-runnable pretrained model was available).
 * Never publishes directly: callers get draft walls/spaces for human review.
 * Handles only straight walls — a bounded auto-deskew pass (see `autoDeskew`)
 * corrects small global rotation, but curved walls are not detected and
 * remain out of scope.
 *
 * `pixelToWorld` should be the same calibration transform the reference
 * image itself uses, so results line up with it exactly.
 */
export function vectorizeFloorPlan(
  image: RawImage,
  pixelToWorld: (pixel: Point) => Point,
  options: VectorizeOptions = {},
): VectorizationResult {
  const opts = { ...DEFAULTS, ...options };
  const warnings: VectorizationWarning[] = [];

  const origin = pixelToWorld({ x: 0, y: 0 });
  const unitX = pixelToWorld({ x: 1, y: 0 });
  const unitY = pixelToWorld({ x: 0, y: 1 });
  const metersPerPixel = Math.hypot(unitX.x - origin.x, unitX.y - origin.y) || 1;
  // Linear part of `pixelToWorld` (columns = images of the pixel unit axes,
  // relative to `origin`), used below to build/undo the "detection frame" —
  // see `detectionWalls`. Assumes (as the rest of this function already does
  // for `metersPerPixel`) that `pixelToWorld` is affine — scale, translation,
  // and optionally an axis flip/reflection, but no rotation of its own.
  const detectionColX = { x: unitX.x - origin.x, y: unitX.y - origin.y };
  const detectionColY = { x: unitY.x - origin.x, y: unitY.y - origin.y };
  const detectionDeterminant =
    detectionColX.x * detectionColY.y - detectionColY.x * detectionColX.y;

  // Noisy scans/photos are smoothed first; clean drawings pass through untouched.
  const gray = denoise(toGrayscale(image));
  const binary = binarize(
    gray,
    opts.autoThreshold && options.threshold === undefined ? robustThreshold(gray) : opts.threshold,
  );

  // Bounded deskew pre-pass: estimate a small global rotation (a crooked
  // photo/scan) and, only if it's meaningfully non-zero, correct it before
  // scanning for axis-aligned segments. Whenever `autoDeskew` is enabled
  // (the default), `estimateSkewAngle` itself always runs (~9ms measured on
  // a 1200x900 image) — what's skipped when the estimate is negligible is
  // only the subsequent full-raster rotation (`rotateBinaryImage`) and its
  // associated behavior change, not the estimation cost.
  const skewAngleDegrees = opts.autoDeskew ? estimateSkewAngle(binary) : 0;
  const deskewed = Math.abs(skewAngleDegrees) > MIN_SIGNIFICANT_SKEW_DEGREES;
  const workingBinary = deskewed ? rotateBinaryImage(binary, -skewAngleDegrees) : binary;
  const rotationCenter = imageCenter(binary);
  // Segments/graph points below are in `workingBinary`'s (possibly rotated)
  // pixel frame; map back to the original image's pixel frame before
  // applying the caller's calibration transform.
  const toWorld = (p: PixelPoint): Point =>
    pixelToWorld(deskewed ? rotatePoint(p, skewAngleDegrees, rotationCenter) : p);
  if (deskewed) {
    warnings.push({
      message: `이미지가 약 ${Math.abs(skewAngleDegrees).toFixed(1)}도 기울어진 것으로 추정되어 자동으로 보정했습니다. 벽 인식 결과를 확인하세요.`,
    });
  }

  if (opts.method === "regions") {
    const px = (meters: number) => meters / metersPerPixel;
    // Stairs first: runs of evenly spaced tread lines. They are hairlines, so
    // the structural ink below has lost them and the flight would read as open
    // floor. Each flight found is blocked out of the floor and offered as a
    // stair candidate.
    const strokes = [
      ...mergeParallelSegments(
        detectHorizontalSegments(workingBinary, px(0.6), opts.maxLineGapPx),
        opts.maxMergeGapPx,
        "horizontal",
      ),
      ...mergeParallelSegments(
        detectVerticalSegments(workingBinary, px(0.6), opts.maxLineGapPx),
        opts.maxMergeGapPx,
        "vertical",
      ),
    ].filter((stroke) => stroke.thicknessPx <= Math.max(3, px(0.12)));
    const strokeEnds = (stroke: (typeof strokes)[number]) =>
      stroke.orientation === "horizontal"
        ? [
            { x: stroke.start, y: stroke.offset },
            { x: stroke.end, y: stroke.offset },
          ]
        : [
            { x: stroke.offset, y: stroke.start },
            { x: stroke.offset, y: stroke.end },
          ];
    const structure = structuralInk(workingBinary, px(2.5));
    const blocked = { ...structure, ink: new Uint8Array(structure.ink) };
    const stairs: DraftElement[] = [];
    for (const candidate of detectElements(
      strokes.map((stroke) => {
        const [start, end] = strokeEnds(stroke);
        return {
          start: toWorld(start!),
          end: toWorld(end!),
          thickness: Math.max(0.02, stroke.thicknessPx * metersPerPixel),
        };
      }),
      // Two flights side by side are often drawn with treads running across both.
      { maxTreadWidthM: 3.6, ...elementOptions(options), resolutionM: metersPerPixel },
    )) {
      if (candidate.type !== "stairs" || !candidate.replacesWallIndices?.length) continue;
      const treads = candidate.replacesWallIndices.map((index) => strokes[index]!);
      const orientation = treads[0]!.orientation;
      const from = Math.min(...treads.map((tread) => tread.start)),
        to = Math.max(...treads.map((tread) => tread.end)),
        first = Math.min(...treads.map((tread) => tread.offset)),
        last = Math.max(...treads.map((tread) => tread.offset));
      // Tiles and paving repeat just like treads, but have joints the other way too.
      // (One or two lines down a flight are its arrow or a grid line passing through.)
      const joints = strokes.filter(
        (stroke) =>
          stroke.orientation !== orientation &&
          stroke.offset > from + 0.2 * (to - from) &&
          stroke.offset < to - 0.2 * (to - from) &&
          Math.min(stroke.end, last) - Math.max(stroke.start, first) >= 0.5 * (last - first),
      );
      if (joints.length >= 3) continue;
      const horizontal = orientation === "horizontal";
      for (let across = Math.floor(first); across <= Math.ceil(last); across++)
        for (let along = Math.floor(from); along <= Math.ceil(to); along++) {
          const x = horizontal ? along : across,
            y = horizontal ? across : along;
          if (x >= 0 && y >= 0 && x < blocked.width && y < blocked.height)
            blocked.ink[y * blocked.width + x] = 1;
        }
      const { replacesWallIndices: _treads, ...stair } = candidate;
      stairs.push(stair);
    }
    const regions = detectRegions(blocked, {
      wallHalfPx: px(0.2),
      doorHalfPx: px(0.5),
      minRoomAreaPx: px(1) * px(1),
      minHoleAreaPx: 1.5 * px(1) * px(1),
      maxWallThicknessPx: px(0.8),
      minWallThicknessPx: Math.max(1, px(0.05)),
      minWallLengthPx: px(0.4),
      simplifyPx: Math.max(2.5, px(0.06)),
      ...(structure === workingBinary ? {} : { detail: workingBinary }),
    });
    const walls: DraftWall[] = regions.walls.map((wall) => ({
      start: toWorld(wall.start),
      end: toWorld(wall.end),
      thickness: Math.max(0.05, wall.thicknessPx * metersPerPixel),
    }));
    const spaces: DraftSpace[] = regions.rooms.map((room) => ({
      polygon: room.polygon.map(toWorld),
      ...(room.holes.length ? { holes: room.holes.map((hole) => hole.map(toWorld)) } : {}),
      ...(room.exposed ? { needsReview: true } : {}),
    }));
    const elements = [
      ...detectElements(walls, elementOptions(options)).filter(
        (element) => element.type !== "stairs",
      ),
      ...stairs,
    ];
    // Region sizes are set in metres, so a wrong scale shows up as no rooms at
    // all or as "walls" far from any real wall thickness. Then the line-based
    // reading below is the better guess, and the user should fix the scale.
    const thicknesses = walls.map((wall) => wall.thickness).sort((p, q) => p - q);
    const typical = thicknesses[thicknesses.length >> 1];
    if (spaces.length && typical !== undefined && typical >= 0.07 && typical <= 0.6) {
      if (spaces.some((space) => space.needsReview))
        warnings.push({
          message:
            "바깥과 벽 없이 이어진 영역이 있습니다(목록에 ‘틈 경계 확인’ 표시). 로비·테라스이거나 건물 바깥일 수 있으니 윤곽을 확인하세요.",
        });
      if (elements.length)
        warnings.push({
          message:
            "건축 요소 후보는 기본 제외 상태입니다. 종류·치수·방향을 확인하고 포함하세요. 높이는 도면에서 추출하지 않습니다.",
        });
      return { walls, spaces, elements, warnings };
    }
    warnings.push({
      message:
        "영역 기준으로는 실내를 찾지 못해 선 기준으로 분석했습니다. 축척이 맞지 않으면 영역 기준이 동작하지 않습니다 — ‘축척 보정’으로 실제 길이를 맞춘 뒤 다시 실행해 보세요.",
    });
  }

  const rawHorizontal = detectHorizontalSegments(
    workingBinary,
    opts.minSegmentLengthPx,
    opts.maxLineGapPx,
  );
  const rawVertical = detectVerticalSegments(
    workingBinary,
    opts.minSegmentLengthPx,
    opts.maxLineGapPx,
  );
  const mergedHorizontal = mergeParallelSegments(rawHorizontal, opts.maxMergeGapPx, "horizontal");
  const mergedVertical = mergeParallelSegments(rawVertical, opts.maxMergeGapPx, "vertical");
  // Furniture outlines, text, dimension lines and door leaves are drawn much
  // thinner than walls; set them aside so they don't become walls/rooms.
  const merged = [...mergedHorizontal, ...mergedVertical];
  const split = splitWallSegments(merged, opts.minWallThicknessPx, opts.autoWallThickness);
  let segments = split.walls;
  const thinSegments = split.thin;
  const snapTolerancePx = opts.snapTolerancePx;

  // Plans drawn in thin lines show each wall as its two faces. Pair the faces
  // into one wall (centre line + real thickness) instead of producing a wall
  // per face, and leave out lines with no partner (dimensions, furniture, text).
  if (opts.pairWallFaces) {
    const minSide = Math.min(image.width, image.height);
    // Join the fragments a blurred or noisy scan breaks each line into first.
    // Face lines are thin by nature: pair from every stroke (blobs aside), not
    // just those passing the minimum wall thickness meant for filled walls.
    // Filled walls and thin double-line walls can coexist in the same scan.
    // A heavy symbol must not disable face pairing for the entire drawing.
    const filledWalls = thinSegments.length ? split.walls : [];
    const faceStrokes = thinSegments.length
      ? split.thin
      : splitWallSegments(merged, 1, false).walls;
    const allLines = absorbFringes(
      unionCollinearSegments(faceStrokes, opts.maxLineGapPx + 1),
      opts.maxMergeGapPx,
    );
    // Repeating parallel strokes (stairs, paving, hatching) aren't wall faces;
    // they would pair up into fake walls and skew the wall-thickness estimate.
    const ladders = findLadders(allLines, opts.minSegmentLengthPx);
    const lines = allLines.filter((s) => !ladders.has(s));
    const faceGap = estimateFaceGap(
      lines,
      Math.max(12, Math.min(60, minSide * 0.04)),
      opts.minSegmentLengthPx * 2,
    );
    if (faceGap !== null) {
      const faces = pairWallFaces(lines, faceGap, opts.minSegmentLengthPx);
      // Balusters, mullions and treads drawn as thin double lines pair up too —
      // as a row of short, evenly spaced "walls". Those aren't walls either.
      const repeated = findLadders(faces.walls, opts.minSegmentLengthPx);
      const paired = {
        walls: faces.walls.filter((w) => !repeated.has(w)),
        unpaired: [...faces.unpaired, ...repeated],
      };
      const length = (list: typeof segments) =>
        list.reduce((sum, s) => sum + s.end - s.start + 1, 0);
      // Only when pairing explains a good part of the drawing (two faces per wall).
      if (2 * length(paired.walls) >= 0.15 * length(lines)) {
        const partitions = singleLinePartitions(
          paired.unpaired,
          paired.walls,
          faceGap,
          opts.minSegmentLengthPx * 3,
        );
        // A wall's centre line stops half a wall short of the wall it meets: join them up.
        segments = joinWallEnds(
          unionCollinearSegments([...filledWalls, ...paired.walls, ...partitions], snapTolerancePx),
          opts.maxLineGapPx + 2,
        );
        thinSegments.push(
          ...paired.unpaired.filter((s) => !partitions.includes(s)),
          ...ladders, // stair treads are found among these
        );
        warnings.push({
          message:
            "벽을 두 줄 선으로 그린 도면으로 보고, 마주 보는 두 선 사이를 하나의 벽으로 만들었습니다. 짝이 없는 선(치수선·가구 등)은 제외했습니다.",
        });
      }
    }
  }

  if (segments.length === 0) {
    warnings.push({
      message:
        "직선을 하나도 찾지 못했습니다. 이미지 대비가 낮거나 흑백 선 도면이 아닐 수 있습니다.",
    });
    return { walls: [], spaces: [], elements: [], warnings };
  }

  // Corner overhangs and stray specks out; one wall per straight line.
  const graph = pruneGraph(
    buildPlanarGraph(unionCollinearSegments(segments, snapTolerancePx), snapTolerancePx),
    {
      stubPx: snapTolerancePx * 2,
      minComponentPx: opts.minSegmentLengthPx * 2,
      minComponentShare: opts.minStructureShare,
      // A lone short stroke isn't a wall, but it may be a stair tread: keep it for the stair search.
      onDropped: (a, b, thicknessPx) => {
        const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
        thinSegments.push({
          orientation: horizontal ? "horizontal" : "vertical",
          offset: horizontal ? (a.y + b.y) / 2 : (a.x + b.x) / 2,
          start: horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
          end: horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
          thicknessPx,
        });
      },
    },
  );
  const chains = mergeCollinearEdges(graph);
  // Thin strokes are kept around only as possible stair treads (see below).
  const thinWalls = (map: (p: PixelPoint) => Point): DraftWall[] =>
    thinSegments.map((s) => {
      const horizontal = s.orientation === "horizontal";
      return {
        start: map(horizontal ? { x: s.start, y: s.offset } : { x: s.offset, y: s.start }),
        end: map(horizontal ? { x: s.end, y: s.offset } : { x: s.offset, y: s.end }),
        thickness: Math.max(0.02, s.thicknessPx * metersPerPixel),
      };
    });

  const walls: DraftWall[] = chains.map((chain) => ({
    start: toWorld(graph.points[chain.from]!),
    end: toWorld(graph.points[chain.to]!),
    thickness: Math.max(0.05, chain.thicknessPx * metersPerPixel),
  }));

  // `detectElements`'s opening-search fast path (see its own doc comment)
  // assumes every wall it receives is exactly axis-aligned, matching this
  // package's own pixel scan — but `walls` above is NOT exactly axis-aligned
  // once deskew is active: `toWorld` rotates coordinates back to the
  // original tilted frame (`rotatePoint` then `pixelToWorld`) before this
  // point, so two walls genuinely collinear on that tilted line can round to
  // different offset buckets and never get compared, silently missing
  // openings. `detectionWalls` instead maps the same pixel data through
  // `pixelToWorld` alone (no rotate-back), which stays axis-aligned as long
  // as `pixelToWorld` itself has no rotation of its own (true for every
  // caller today — see `ReferenceManager.imagePixelToWorld`, a pure
  // scale+translate(+axis-flip) map; `detectionDeterminant` guards the one
  // case that would violate this, a degenerate/singular `pixelToWorld`).
  // Candidate positions/support walls are mapped back into `walls`'s final
  // world frame afterward via `detectionPointToWorld`/`detectionAngleToWorldDegrees`.
  const canRemapDetectionFrame = deskewed && Math.abs(detectionDeterminant) > 1e-9;
  const detectionWalls: DraftWall[] = canRemapDetectionFrame
    ? chains.map((chain) => ({
        start: pixelToWorld(graph.points[chain.from]!),
        end: pixelToWorld(graph.points[chain.to]!),
        thickness: Math.max(0.05, chain.thicknessPx * metersPerPixel),
      }))
    : walls;

  /** Maps a point from `detectionWalls`'s frame into `walls`'s final world frame. */
  const detectionPointToWorld = (p: Point): Point => {
    const dx = p.x - origin.x,
      dy = p.y - origin.y;
    const px = (detectionColY.y * dx - detectionColY.x * dy) / detectionDeterminant;
    const py = (-detectionColX.y * dx + detectionColX.x * dy) / detectionDeterminant;
    return toWorld({ x: px, y: py });
  };
  /** Same remap for a direction vector (no translation) — used for a `rotation` angle below. */
  const detectionVectorToWorld = (v: Point): Point => {
    const px = (detectionColY.y * v.x - detectionColY.x * v.y) / detectionDeterminant;
    const py = (-detectionColX.y * v.x + detectionColX.x * v.y) / detectionDeterminant;
    const rotated = rotatePoint({ x: px, y: py }, skewAngleDegrees, { x: 0, y: 0 });
    return {
      x: detectionColX.x * rotated.x + detectionColY.x * rotated.y,
      y: detectionColX.y * rotated.x + detectionColY.y * rotated.y,
    };
  };
  const detectionAngleToWorldDegrees = (angleDegrees: number): number => {
    const rad = (angleDegrees * Math.PI) / 180;
    const v = detectionVectorToWorld({ x: Math.cos(rad), y: Math.sin(rad) });
    return (Math.atan2(v.y, v.x) * 180) / Math.PI;
  };

  const rawElements = detectElements(detectionWalls, elementOptions(options));
  // Stair treads are thin strokes, so they were set aside above. Look for
  // staircases among those strokes alone and bring back just the treads a
  // candidate uses, appended after the walls (accepting the stair replaces them).
  if (thinSegments.length) {
    const detectionThin = thinWalls(canRemapDetectionFrame ? pixelToWorld : toWorld);
    const worldThin = canRemapDetectionFrame ? thinWalls(toWorld) : detectionThin;
    // Dimension ticks outside the building often have exactly the rhythm of
    // stair treads. Do not restore discarded annotation strokes as walls.
    const bounds = detectionWalls.reduce(
      (box, wall) => ({
        minX: Math.min(box.minX, wall.start.x, wall.end.x),
        minY: Math.min(box.minY, wall.start.y, wall.end.y),
        maxX: Math.max(box.maxX, wall.start.x, wall.end.x),
        maxY: Math.max(box.maxY, wall.start.y, wall.end.y),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    for (const stair of detectElements(detectionThin, elementOptions(options))) {
      if (stair.type !== "stairs" || !stair.replacesWallIndices?.length) continue;
      if (
        stair.replacesWallIndices.some((i) =>
          [detectionThin[i]!.start, detectionThin[i]!.end].some(
            (p) => p.x < bounds.minX || p.x > bounds.maxX || p.y < bounds.minY || p.y > bounds.maxY,
          ),
        )
      )
        continue;
      const indices = stair.replacesWallIndices.map((i) => {
        walls.push(worldThin[i]!);
        if (detectionWalls !== walls) detectionWalls.push(detectionThin[i]!);
        return walls.length - 1;
      });
      rawElements.push({ ...stair, replacesWallIndices: indices });
    }
  }
  // Remap candidate geometry from `detectionWalls`'s frame back into the same
  // final world frame `walls`/`worldPoints` use below, so the bridge-closing
  // match against `worldPoints` (via `nearestNode`) keeps working correctly.
  const elements: DraftElement[] = canRemapDetectionFrame
    ? rawElements.map((element) => ({
        ...element,
        position: detectionPointToWorld(element.position),
        ...(element.rotation !== undefined
          ? { rotation: detectionAngleToWorldDegrees(element.rotation) }
          : {}),
        ...(element.supportWall
          ? {
              supportWall: {
                ...element.supportWall,
                start: detectionPointToWorld(element.supportWall.start),
                end: detectionPointToWorld(element.supportWall.end),
              },
            }
          : {}),
      }))
    : rawElements;
  // Close candidate openings only in the room topology, never in the detected wall output.
  const worldPoints = graph.points.map(toWorld);
  const nearestNode = (point: Point) =>
    worldPoints.reduce(
      (best, p, i) =>
        Math.hypot(p.x - point.x, p.y - point.y) <
        Math.hypot(worldPoints[best]!.x - point.x, worldPoints[best]!.y - point.y)
          ? i
          : best,
      0,
    );
  const bridges = elements.flatMap((element) => {
    if (!element.supportWall) return [];
    const from = nearestNode(element.supportWall.start),
      to = nearestNode(element.supportWall.end);
    return from === to
      ? []
      : [{ from, to, thicknessPx: element.supportWall.thickness / metersPerPixel }];
  });
  const faces = findFaces({ points: graph.points, edges: [...graph.edges, ...bridges] });
  const roomFaces = selectRoomFaces(faces, opts.minRoomAreaPx);
  const spaces: DraftSpace[] = roomFaces.map((face) => ({
    polygon: face.nodeIndices.map((i) => toWorld(graph.points[i]!)),
    ...(bridges.some((bridge) =>
      face.nodeIndices.some((node, i) => {
        const next = face.nodeIndices[(i + 1) % face.nodeIndices.length];
        return (
          (node === bridge.from && next === bridge.to) ||
          (node === bridge.to && next === bridge.from)
        );
      }),
    )
      ? { needsReview: true }
      : {}),
  }));

  // Real walls are ~0.1–0.45 m thick. Far outside that, the image scale is
  // off, and so are door/window widths and room sizes: say so.
  const wallThicknesses = walls
    .filter((w) => w.thickness > 0.05)
    .map((w) => w.thickness)
    .sort((a, b) => a - b);
  const typicalThickness = wallThicknesses[wallThicknesses.length >> 1];
  if (
    typicalThickness !== undefined &&
    wallThicknesses.length >= 3 &&
    (typicalThickness < 0.06 || typicalThickness > 0.6)
  )
    warnings.push({
      message: `벽 두께가 약 ${typicalThickness.toFixed(2)} m로 계산됩니다. 도면 축척이 맞지 않는 것 같습니다 — '축척 보정'으로 실제 길이를 맞춘 뒤 다시 실행하면 문·창문과 방을 더 정확히 찾습니다.`,
    });

  if (spaces.length === 0) {
    warnings.push({ message: "닫힌 방 형태를 찾지 못했습니다 — 벽만 초안으로 제공됩니다." });
  }

  if (spaces.some((s) => s.needsReview))
    warnings.push({
      message:
        "문 틈을 가상으로 이어 닫은 방이 있습니다(목록에 ‘틈 경계 확인’ 표시). 바닥으로 포함해 두었으니 윤곽을 확인하세요.",
    });
  if (elements.length)
    warnings.push({
      message:
        "건축 요소 후보는 기본 제외 상태입니다. 종류·치수·방향을 확인하고 포함하세요. 높이는 도면에서 추출하지 않습니다.",
    });
  return { walls, spaces, elements, warnings };
}
