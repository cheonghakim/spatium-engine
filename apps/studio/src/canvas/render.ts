import {
  distanceToSegment,
  FURNITURE_PRESETS,
  type Entrance,
  type Floor,
  type Furniture,
  type Group,
  type Point,
} from "@indoor/core";
import type {
  DraftSpaceEntry,
  DraftElementEntry,
  DraftWallEntry,
  EditorCamera,
  LayerId,
  ReferenceLayerState,
  SelectionEntry,
} from "@indoor/editor";
import { getLoadedImage } from "./imageCache";

export interface RenderState {
  floor: Floor | undefined;
  camera: EditorCamera;
  selection: readonly SelectionEntry[];
  draftPoints: readonly Point[];
  reference: ReferenceLayerState | null;
  layerVisibility: Readonly<Record<LayerId, boolean>>;
  calibrationPoints: readonly Point[];
  /** Id of a navigation node picked as the "from" end of a pending edge connection. */
  pendingEdgeNodeId: string | null;
  /** Route preview: one entry per path node, null where that node lives on another floor. */
  routePoints: ReadonlyArray<Point | null>;
  /** Start point of a wall chain in progress (Wall tool). */
  pendingWallStart: Point | null;
  /** Auto-vectorized geometry awaiting human review (spec §16-18), drawn distinctly until confirmed. */
  draftWalls: readonly DraftWallEntry[];
  draftSpaces: readonly DraftSpaceEntry[];
  draftElements?: readonly DraftElementEntry[];
  selectedDraftId?: string | null;
  showGrid?: boolean;
}

/**
 * Mirrors the semantic palette in styles/tokens.css (canvas 2D can't read
 * CSS custom properties without a getComputedStyle round-trip per frame, so
 * the values are duplicated here as literals — keep the two in sync).
 * Selection always reads as accent blue; muted grays/teals carry structural
 * meaning instead of each object type getting its own saturated hue.
 */
const COLORS = {
  background: "#191c21",
  gridMinor: "rgba(255, 255, 255, 0.05)",
  gridMajor: "rgba(255, 255, 255, 0.11)",
  spaceFill: "rgba(184, 189, 199, 0.05)",
  spaceStroke: "#9aa6c8",
  spaceSelectedFill: "rgba(110, 140, 255, 0.16)",
  spaceSelectedStroke: "#6e8cff",
  entrance: "#8fb3ae",
  poi: "#c9aa6e",
  furniture: "#b68b60",
  furnitureFill: "rgba(182, 139, 96, 0.12)",
  draft: "#d7dae0",
  calibration: "#6e8cff",
  draftWallAccepted: "#d6a84f",
  draftWallRejected: "#565c66",
  draftSpaceAcceptedFill: "rgba(214, 168, 79, 0.14)",
  draftSpaceAcceptedStroke: "#d6a84f",
  draftSpaceRejectedFill: "rgba(86, 92, 102, 0.12)",
  draftSpaceRejectedStroke: "#565c66",
  draftSelected: "#6e8cff",
  wall: "#b8bdc7",
  wallSelected: "#6e8cff",
  vertexHandle: "#b8bdc7",
  vertexHandleSelected: "#6e8cff",
  navigationNode: "#9298a3",
  navigationNodePending: "#6e8cff",
  navigationEdge: "#565c66",
  route: "#5ec2c2",
};

/** Pure render function: reads editor/core state, never mutates it. */
export function render(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { canvas } = ctx;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (state.reference && state.layerVisibility.reference) {
    drawReference(ctx, state.camera, state.reference);
  }

  if (state.showGrid !== false) drawGrid(ctx, state.camera, canvas.width, canvas.height);

  if (state.floor) {
    let selectedSpace: Floor["spaces"][number] | undefined;
    let selectedVertexIndex: number | undefined;

    if (state.layerVisibility.spaces) {
      for (const space of state.floor.spaces) {
        const selectionEntry = state.selection.find((e) => e.id === space.id);
        const selected = !!selectionEntry;
        if (selected) {
          selectedSpace = space;
          selectedVertexIndex = selectionEntry.vertexIndex;
        }
        drawPolygon(
          ctx,
          state.camera,
          space.polygon,
          selected ? COLORS.spaceSelectedFill : COLORS.spaceFill,
          selected ? COLORS.spaceSelectedStroke : COLORS.spaceStroke,
          true,
        );
      }
    }

    if (state.layerVisibility.walls) {
      for (const wall of state.floor.walls) {
        const selected = state.selection.some((e) => e.id === wall.id);
        drawLine(
          ctx,
          state.camera,
          wall.start,
          wall.end,
          selected ? COLORS.wallSelected : COLORS.wall,
          Math.max(3, wall.thickness * 20),
        );
        if (selected) {
          drawVertexHandle(ctx, state.camera, wall.start, COLORS.vertexHandle);
          drawVertexHandle(ctx, state.camera, wall.end, COLORS.vertexHandle);
        }
      }
      if (state.pendingWallStart) {
        drawDot(ctx, state.camera, state.pendingWallStart, COLORS.wall, 4);
      }
    }

    if (selectedSpace) {
      for (let i = 0; i < selectedSpace.polygon.length; i++) {
        const isSelectedVertex = selectedVertexIndex === i;
        drawVertexHandle(
          ctx,
          state.camera,
          selectedSpace.polygon[i] as Point,
          isSelectedVertex ? COLORS.vertexHandleSelected : COLORS.vertexHandle,
        );
      }
    }

    if (state.layerVisibility.entrances) {
      for (const entrance of state.floor.entrances) {
        const wall = state.floor.walls
          .filter((w) => !entrance.wallId || w.id === entrance.wallId)
          .map((w) => ({
            wall: w,
            distance: distanceToSegment(entrance.position, w.start, w.end).distance,
          }))
          .filter((hit) => hit.distance < hit.wall.thickness / 2 + 0.2)
          .sort((a, b) => a.distance - b.distance)[0]?.wall;
        const rotation =
          wall && ["door", "window", "opening"].includes(entrance.type)
            ? (Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) * 180) / Math.PI
            : entrance.rotation;
        drawElement(
          ctx,
          state.camera,
          { ...entrance, ...(rotation !== undefined ? { rotation } : {}) },
          state.selection.some((s) => s.id === entrance.id) ? COLORS.wallSelected : COLORS.entrance,
        );
      }
    }

    if (state.layerVisibility.pois) {
      for (const poi of state.floor.pois) {
        drawDot(ctx, state.camera, poi.position, COLORS.poi);
      }
    }

    if (state.layerVisibility.furniture) {
      for (const item of state.floor.furniture) {
        const selected = state.selection.some((s) => s.id === item.id);
        drawFurniture(
          ctx,
          state.camera,
          item,
          selected ? COLORS.wallSelected : COLORS.furniture,
          selected ? COLORS.spaceSelectedFill : COLORS.furnitureFill,
        );
      }
    }

    if (state.layerVisibility.navigation) {
      const nodesById = new Map(state.floor.navigation.nodes.map((n) => [n.id, n]));
      for (const edge of state.floor.navigation.edges) {
        const from = nodesById.get(edge.from);
        const to = nodesById.get(edge.to);
        if (from && to) {
          drawLine(ctx, state.camera, from.position, to.position, COLORS.navigationEdge, 2);
        }
      }
      for (const node of state.floor.navigation.nodes) {
        const pending = node.id === state.pendingEdgeNodeId;
        drawDot(
          ctx,
          state.camera,
          node.position,
          pending ? COLORS.navigationNodePending : COLORS.navigationNode,
          pending ? 7 : 5,
        );
      }
    }

    for (const group of state.floor.groups) {
      if (!state.selection.some((s) => s.id === group.id)) continue;
      const bounds = groupBounds(state.floor, group);
      if (bounds) drawGroupOutline(ctx, state.camera, bounds, group.label);
    }
  }

  drawRoute(ctx, state.camera, state.routePoints);

  for (const space of state.draftSpaces) {
    drawPolygon(
      ctx,
      state.camera,
      space.polygon,
      space.accepted ? COLORS.draftSpaceAcceptedFill : COLORS.draftSpaceRejectedFill,
      space.accepted ? COLORS.draftSpaceAcceptedStroke : COLORS.draftSpaceRejectedStroke,
      true,
      true,
    );
    if (space.id === state.selectedDraftId) {
      for (const point of space.polygon)
        drawVertexHandle(ctx, state.camera, point, COLORS.draftSelected);
    }
  }
  for (const wall of state.draftWalls) {
    const replaced = state.draftElements?.some(
      (element) => element.accepted && element.replacesWallIds.includes(wall.id),
    );
    drawLine(
      ctx,
      state.camera,
      wall.start,
      wall.end,
      wall.id === state.selectedDraftId
        ? COLORS.draftSelected
        : wall.accepted && !replaced
          ? COLORS.draftWallAccepted
          : COLORS.draftWallRejected,
      Math.max(3, wall.thickness * 20),
      true,
    );
    if (wall.id === state.selectedDraftId) {
      drawVertexHandle(ctx, state.camera, wall.start, COLORS.draftSelected);
      drawVertexHandle(ctx, state.camera, wall.end, COLORS.draftSelected);
    }
  }

  for (const element of state.draftElements ?? []) {
    drawElement(
      ctx,
      state.camera,
      element,
      element.id === state.selectedDraftId
        ? COLORS.draftSelected
        : element.accepted
          ? COLORS.draftWallAccepted
          : COLORS.draftWallRejected,
    );
  }

  if (state.draftPoints.length > 0) {
    drawPolygon(ctx, state.camera, state.draftPoints, "transparent", COLORS.draft, false);
    for (const point of state.draftPoints) {
      drawDot(ctx, state.camera, point, COLORS.draft, 3);
    }
  }

  for (const point of state.calibrationPoints) {
    drawDot(ctx, state.camera, point, COLORS.calibration, 5);
  }
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  element: Pick<Entrance, "position" | "type" | "rotation" | "width" | "depth" | "stepCount">,
  color: string,
): void {
  const angle = ((element.rotation ?? 0) * Math.PI) / 180,
    ux = Math.cos(angle),
    uy = Math.sin(angle);
  const point = (x: number, y: number) => ({
    x: element.position.x + ux * x - uy * y,
    y: element.position.y + uy * x + ux * y,
  });
  const width = element.width ?? (element.type === "door" ? 0.9 : 1.2);
  if (element.type === "stairs" || element.type === "escalator") {
    const depth = element.depth ?? 4,
      count = Math.min(40, Math.max(2, element.stepCount ?? 12));
    drawPolygon(
      ctx,
      camera,
      [
        point(-depth / 2, -width / 2),
        point(depth / 2, -width / 2),
        point(depth / 2, width / 2),
        point(-depth / 2, width / 2),
      ],
      "transparent",
      color,
      true,
    );
    for (let i = 1; i < count; i++)
      drawLine(
        ctx,
        camera,
        point(-depth / 2 + (depth * i) / count, -width / 2),
        point(-depth / 2 + (depth * i) / count, width / 2),
        color,
        1,
      );
    drawLine(ctx, camera, point(-depth / 3, 0), point(depth / 3, 0), color, 2);
    drawLine(ctx, camera, point(depth / 3, 0), point(depth / 3 - 0.2, 0.15), color, 2);
    drawLine(ctx, camera, point(depth / 3, 0), point(depth / 3 - 0.2, -0.15), color, 2);
  } else {
    drawLine(ctx, camera, point(-width / 2, 0), point(width / 2, 0), color, 3);
    if (element.type === "window")
      for (const offset of [-0.08, 0.08])
        drawLine(ctx, camera, point(-width / 2, offset), point(width / 2, offset), color, 1);
    if (element.type === "door")
      drawLine(ctx, camera, point(-width / 2, 0), point(-width / 2, width), color, 2);
  }
  drawDot(ctx, camera, element.position, color, 4);
}

/**
 * Draws a furniture item's rotated footprint plus a thicker "back" edge
 * (the local -depth side) as an at-a-glance orientation cue — matching how
 * drawElement's door/window silhouettes hint at facing without a full 3D
 * render. All furniture types share one muted color; the footprint size and
 * label (in the property panel) carry the distinction, not a per-type hue.
 */
function drawFurniture(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  item: Pick<Furniture, "position" | "type" | "rotation" | "width" | "depth">,
  color: string,
  fillColor: string,
): void {
  const preset = FURNITURE_PRESETS[item.type];
  const width = item.width ?? preset.width;
  const depth = item.depth ?? preset.depth;
  const angle = ((item.rotation ?? 0) * Math.PI) / 180,
    ux = Math.cos(angle),
    uy = Math.sin(angle);
  const point = (x: number, y: number) => ({
    x: item.position.x + ux * x - uy * y,
    y: item.position.y + uy * x + ux * y,
  });
  drawPolygon(
    ctx,
    camera,
    [
      point(-width / 2, -depth / 2),
      point(width / 2, -depth / 2),
      point(width / 2, depth / 2),
      point(-width / 2, depth / 2),
    ],
    fillColor,
    color,
    true,
  );
  drawLine(ctx, camera, point(-width / 2, -depth / 2), point(width / 2, -depth / 2), color, 3);
}

/** World-space bounding box spanning every one of a group's members, regardless of kind. Null if none of its members resolve to anything on the floor (e.g. all deleted). */
function groupBounds(
  floor: Floor,
  group: Group,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const include = (p: Point) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };

  for (const id of group.memberIds) {
    const space = floor.spaces.find((s) => s.id === id);
    if (space) {
      for (const p of space.polygon) include(p);
      continue;
    }
    const wall = floor.walls.find((w) => w.id === id);
    if (wall) {
      include(wall.start);
      include(wall.end);
      continue;
    }
    const entrance = floor.entrances.find((e) => e.id === id);
    if (entrance) {
      include(entrance.position);
      continue;
    }
    const poi = floor.pois.find((p) => p.id === id);
    if (poi) {
      include(poi.position);
      continue;
    }
    const item = floor.furniture.find((f) => f.id === id);
    if (item) {
      include(item.position);
      continue;
    }
    const node = floor.navigation.nodes.find((n) => n.id === id);
    if (node) {
      include(node.position);
      continue;
    }
    const edge = floor.navigation.edges.find((e) => e.id === id);
    if (edge) {
      const from = floor.navigation.nodes.find((n) => n.id === edge.from);
      const to = floor.navigation.nodes.find((n) => n.id === edge.to);
      if (from) include(from.position);
      if (to) include(to.position);
    }
  }

  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

const GROUP_OUTLINE_PADDING_METERS = 0.3;

/** Dashed bounding box + a small name chip — the "you're editing a group" indicator, shown only while the group is the current selection. */
function drawGroupOutline(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  label: string,
): void {
  const topLeft = camera.worldToScreen({
    x: bounds.minX - GROUP_OUTLINE_PADDING_METERS,
    y: bounds.maxY + GROUP_OUTLINE_PADDING_METERS,
  });
  const bottomRight = camera.worldToScreen({
    x: bounds.maxX + GROUP_OUTLINE_PADDING_METERS,
    y: bounds.minY - GROUP_OUTLINE_PADDING_METERS,
  });

  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = COLORS.wallSelected;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  ctx.restore();

  ctx.font = "600 11px system-ui, sans-serif";
  const chipPadding = 5;
  const chipHeight = 18;
  const chipWidth = ctx.measureText(label).width + chipPadding * 2;
  const chipX = topLeft.x;
  const chipY = topLeft.y - chipHeight - 3;
  ctx.fillStyle = COLORS.wallSelected;
  ctx.fillRect(chipX, chipY, chipWidth, chipHeight);
  ctx.fillStyle = COLORS.background;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(label, chipX + chipPadding, chipY + chipHeight / 2 + 1);
}

function drawReference(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  reference: ReferenceLayerState,
): void {
  const image = getLoadedImage(reference.imageUrl);
  if (!image) return;

  const widthMeters = reference.naturalWidth * reference.metersPerPixel;
  const heightMeters = reference.naturalHeight * reference.metersPerPixel;
  const topLeft = camera.worldToScreen(reference.origin);
  const bottomRight = camera.worldToScreen({
    x: reference.origin.x + widthMeters,
    y: reference.origin.y - heightMeters,
  });

  ctx.save();
  ctx.globalAlpha = reference.opacity;
  ctx.drawImage(image, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  ctx.restore();
}

const MINOR_GRID_METERS = 1;
const MAJOR_GRID_METERS = 5;
/** Below this on-screen spacing (px) the 1m lines would just be visual noise, so only the 5m lines are drawn. */
const MIN_MINOR_SPACING_PX = 10;

/** Two-tier grid: faint 1m lines plus a slightly stronger line every 5m, matching how CAD tools separate minor/major divisions without either competing with the drawing itself. */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  width: number,
  height: number,
): void {
  const topLeft = camera.screenToWorld({ x: 0, y: 0 });
  const bottomRight = camera.screenToWorld({ x: width, y: height });
  const pixelsPerMeter = camera.getState().zoom;
  const showMinor = pixelsPerMeter * MINOR_GRID_METERS >= MIN_MINOR_SPACING_PX;

  const drawLines = (step: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const startX = Math.floor(topLeft.x / step) * step;
    for (let x = startX; x <= bottomRight.x; x += step) {
      const screen = camera.worldToScreen({ x, y: 0 });
      ctx.moveTo(screen.x, 0);
      ctx.lineTo(screen.x, height);
    }
    const startY = Math.floor(bottomRight.y / step) * step;
    for (let y = startY; y <= topLeft.y; y += step) {
      const screen = camera.worldToScreen({ x: 0, y });
      ctx.moveTo(0, screen.y);
      ctx.lineTo(width, screen.y);
    }
    ctx.stroke();
  };

  if (showMinor) drawLines(MINOR_GRID_METERS, COLORS.gridMinor);
  drawLines(MAJOR_GRID_METERS, COLORS.gridMajor);
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  points: readonly Point[],
  fillStyle: string,
  strokeStyle: string,
  closed: boolean,
  dashed = false,
): void {
  if (points.length === 0) return;

  ctx.save();
  if (dashed) ctx.setLineDash([6, 4]);

  ctx.beginPath();
  const first = camera.worldToScreen(points[0] as Point);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i++) {
    const screen = camera.worldToScreen(points[i] as Point);
    ctx.lineTo(screen.x, screen.y);
  }
  if (closed) ctx.closePath();

  if (fillStyle !== "transparent") {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  a: Point,
  b: Point,
  strokeStyle: string,
  lineWidth: number,
  dashed = false,
): void {
  const screenA = camera.worldToScreen(a);
  const screenB = camera.worldToScreen(b);
  ctx.save();
  if (dashed) ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(screenA.x, screenA.y);
  ctx.lineTo(screenB.x, screenB.y);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

/** Draws the route as connected segments, breaking wherever a node lives off-floor (null). */
function drawRoute(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  points: ReadonlyArray<Point | null>,
): void {
  if (points.length === 0) return;

  ctx.save();
  ctx.strokeStyle = COLORS.route;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  let drawing = false;
  for (const point of points) {
    if (!point) {
      drawing = false;
      continue;
    }
    const screen = camera.worldToScreen(point);
    if (!drawing) {
      ctx.moveTo(screen.x, screen.y);
      drawing = true;
    } else {
      ctx.lineTo(screen.x, screen.y);
    }
  }
  ctx.stroke();
  ctx.restore();

  for (const point of points) {
    if (point) drawDot(ctx, camera, point, COLORS.route, 4);
  }
}

function drawVertexHandle(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  worldPoint: Point,
  color: string,
): void {
  const screen = camera.worldToScreen(worldPoint);
  const size = 6;
  ctx.fillStyle = color;
  ctx.strokeStyle = COLORS.background;
  ctx.lineWidth = 1;
  ctx.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
  ctx.strokeRect(screen.x - size / 2, screen.y - size / 2, size, size);
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  worldPoint: Point,
  color: string,
  radius = 6,
): void {
  const screen = camera.worldToScreen(worldPoint);
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
