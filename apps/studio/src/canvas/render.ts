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
  Marquee,
  ReferenceLayerState,
  SelectionEntry,
} from "@indoor/editor";
import { getLoadedImage } from "./imageCache";

/** Buildings drawn under the outdoor graph in the site view, already in site coordinates. */
export interface SiteContext {
  buildings: Array<{
    id: string;
    name: string;
    outline: Point[];
    /** The ground floor's spaces, for orientation. */
    spaces: Point[][];
    selected: boolean;
  }>;
  /** Building nodes outdoor paths can link to (entrances). */
  anchors: Point[];
  /** Outdoor edges ending at a building node. */
  links: Array<[Point, Point]>;
}

export interface RenderState {
  floor: Floor | undefined;
  site?: SiteContext | null;
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
  selectedDraftIds?: readonly string[];
  /** Rubber-band selection box being dragged (Select / Draft Review tools). */
  marquee?: Marquee | null;
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

  if (state.site) drawSiteContext(ctx, state.camera, state.site);

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
          false,
          space.holes,
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
        if (selected && state.selection.length === 1) {
          drawVertexHandle(ctx, state.camera, wall.start, COLORS.vertexHandle);
          drawVertexHandle(ctx, state.camera, wall.end, COLORS.vertexHandle);
        }
      }
      if (state.pendingWallStart) {
        drawDot(ctx, state.camera, state.pendingWallStart, COLORS.wall, 4);
      }
    }

    // Vertex handles only for a single selection — that's when they're editable.
    if (selectedSpace && state.selection.length === 1) {
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
        const selected = state.selection.some((s) => s.id === poi.id);
        if (selected) drawSelectionRing(ctx, state.camera, poi.position, 10);
        drawDot(ctx, state.camera, poi.position, selected ? COLORS.wallSelected : COLORS.poi);
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
          const selected = state.selection.some((s) => s.id === edge.id);
          drawLine(
            ctx,
            state.camera,
            from.position,
            to.position,
            selected ? COLORS.wallSelected : COLORS.navigationEdge,
            selected ? 4 : 2,
          );
        }
      }
      for (const node of state.floor.navigation.nodes) {
        const pending = node.id === state.pendingEdgeNodeId;
        const selected = state.selection.some((s) => s.id === node.id);
        if (selected) drawSelectionRing(ctx, state.camera, node.position, 9);
        drawDot(
          ctx,
          state.camera,
          node.position,
          pending || selected ? COLORS.navigationNodePending : COLORS.navigationNode,
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

  const draftSelected = new Set(state.selectedDraftIds ?? []);

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
    if (draftSelected.has(space.id)) {
      drawPolygon(
        ctx,
        state.camera,
        space.polygon,
        COLORS.spaceSelectedFill,
        COLORS.draftSelected,
        true,
      );
      // Vertex handles only for a single selection — that's when they're draggable.
      if (draftSelected.size === 1)
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
      draftSelected.has(wall.id)
        ? COLORS.draftSelected
        : wall.accepted && !replaced
          ? COLORS.draftWallAccepted
          : COLORS.draftWallRejected,
      Math.max(3, wall.thickness * 20),
      true,
    );
    if (draftSelected.has(wall.id) && draftSelected.size === 1) {
      drawVertexHandle(ctx, state.camera, wall.start, COLORS.draftSelected);
      drawVertexHandle(ctx, state.camera, wall.end, COLORS.draftSelected);
    }
  }

  for (const element of state.draftElements ?? []) {
    drawElement(
      ctx,
      state.camera,
      element,
      draftSelected.has(element.id)
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

  if (state.marquee) drawMarquee(ctx, state.camera, state.marquee);
}

/** Selection box: solid = window (left→right, fully inside), dashed = crossing (right→left, touching). */
function drawMarquee(ctx: CanvasRenderingContext2D, camera: EditorCamera, marquee: Marquee): void {
  const a = camera.worldToScreen(marquee.start);
  const b = camera.worldToScreen(marquee.end);
  const crossing = marquee.end.x < marquee.start.x;
  const color = crossing ? "#6ec88c" : COLORS.draftSelected;
  ctx.save();
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y),
    w = Math.abs(b.x - a.x),
    h = Math.abs(b.y - a.y);
  ctx.fillStyle = crossing ? "rgba(110, 200, 140, 0.18)" : "rgba(110, 140, 255, 0.18)";
  ctx.fillRect(x, y, w, h);
  // Dark under-stroke keeps the box legible over the plan image and selected (blue) geometry.
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.strokeRect(x, y, w, h);
  if (crossing) ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.strokeRect(x, y, w, h);
  // Mode chip, so the left→right / right→left rule doesn't have to be memorised.
  if (w > 40 && h > 20) {
    const label = crossing ? "걸친 항목" : "완전히 포함";
    ctx.setLineDash([]);
    ctx.font = "600 11px system-ui, sans-serif";
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 18, tw + 10, 16);
    ctx.fillStyle = "#11141a";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 5, y - 10);
  }
  ctx.restore();
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

function drawSiteContext(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  site: SiteContext,
): void {
  for (const building of site.buildings) {
    for (const space of building.spaces) {
      drawPolygon(
        ctx,
        camera,
        space,
        "rgba(184, 189, 199, 0.04)",
        "rgba(154, 166, 200, 0.35)",
        true,
      );
    }
    if (building.outline.length >= 3) {
      drawPolygon(
        ctx,
        camera,
        building.outline,
        building.selected ? COLORS.spaceSelectedFill : "rgba(184, 189, 199, 0.06)",
        building.selected ? COLORS.spaceSelectedStroke : COLORS.spaceStroke,
        true,
      );
      const center = building.outline.reduce(
        (sum, p) => ({
          x: sum.x + p.x / building.outline.length,
          y: sum.y + p.y / building.outline.length,
        }),
        { x: 0, y: 0 },
      );
      const screen = camera.worldToScreen(center);
      ctx.save();
      ctx.fillStyle = building.selected ? COLORS.spaceSelectedStroke : "#c3c8d2";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(building.name, screen.x, screen.y);
      ctx.restore();
    }
  }
  for (const [a, b] of site.links) drawLine(ctx, camera, a, b, COLORS.navigationEdge, 2, true);
  for (const anchor of site.anchors) drawDot(ctx, camera, anchor, COLORS.entrance, 4);
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  points: readonly Point[],
  fillStyle: string,
  strokeStyle: string,
  closed: boolean,
  dashed = false,
  holes: readonly (readonly Point[])[] = [],
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
  for (const hole of holes) {
    if (hole.length === 0) continue;
    const start = camera.worldToScreen(hole[0] as Point);
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < hole.length; i++) {
      const screen = camera.worldToScreen(hole[i] as Point);
      ctx.lineTo(screen.x, screen.y);
    }
    ctx.closePath();
  }

  if (fillStyle !== "transparent") {
    ctx.fillStyle = fillStyle;
    // even-odd leaves holes unfilled regardless of ring winding.
    ctx.fill("evenodd");
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

/** Halo around a selected point object (POI, path point), so it reads as selected at any zoom. */
function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  camera: EditorCamera,
  worldPoint: Point,
  radius: number,
): void {
  const screen = camera.worldToScreen(worldPoint);
  ctx.save();
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(110, 140, 255, 0.22)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS.wallSelected;
  ctx.stroke();
  ctx.restore();
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
