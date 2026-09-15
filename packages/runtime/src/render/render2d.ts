import type { Floor, Point } from "@indoor/core";
import type { RuntimeCamera } from "../camera/RuntimeCamera.js";
import type { Overlay } from "../overlay.js";
import type { RuntimeTheme } from "../theme.js";

export interface Render2DState {
  floor: Floor | undefined;
  camera: RuntimeCamera;
  overlays: readonly Overlay[];
  hoveredId: string | null;
  /** One entry per route node; null marks a gap where a node lives on another floor. */
  routePoints: ReadonlyArray<Point | null>;
  theme?: RuntimeTheme;
}

const DEFAULT_COLORS = {
  background: "#f5f5f7",
  spaceFill: "rgba(90, 140, 255, 0.15)",
  spaceStroke: "#6f93e0",
  wall: "#4a4a52",
  entrance: "#3ddc84",
  poi: "#ff5c8a",
  accent: "#ffb03c",
};

function resolveColors(theme: RuntimeTheme | undefined) {
  return {
    background: theme?.background ?? DEFAULT_COLORS.background,
    spaceFill: theme?.spaceFill ?? DEFAULT_COLORS.spaceFill,
    spaceStroke: theme?.spaceStroke ?? DEFAULT_COLORS.spaceStroke,
    wall: DEFAULT_COLORS.wall,
    entrance: DEFAULT_COLORS.entrance,
    poi: DEFAULT_COLORS.poi,
    accent: theme?.accentColor ?? DEFAULT_COLORS.accent,
  };
}

/** Pure render function: reads state, never mutates it — the Runtime owns all state. */
export function render2d(ctx: CanvasRenderingContext2D, state: Render2DState): void {
  const colors = resolveColors(state.theme);
  const { canvas } = ctx;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (state.floor) {
    for (const space of state.floor.spaces) {
      const hovered = space.id === state.hoveredId;
      drawPolygon(
        ctx,
        state.camera,
        space.polygon,
        colors.spaceFill,
        hovered ? colors.accent : colors.spaceStroke,
        hovered,
      );
    }

    for (const wall of state.floor.walls) {
      drawLine(ctx, state.camera, wall.start, wall.end, colors.wall, Math.max(2, wall.thickness * 20));
    }

    for (const entrance of state.floor.entrances) {
      drawDot(ctx, state.camera, entrance.position, colors.entrance, 4);
    }

    for (const poi of state.floor.pois) {
      const hovered = poi.id === state.hoveredId;
      drawDot(ctx, state.camera, poi.position, hovered ? colors.accent : colors.poi, hovered ? 8 : 6);
    }
  }

  for (const overlay of state.overlays) {
    if (overlay.floorId !== state.floor?.id) continue;
    drawOverlay(ctx, state.camera, overlay, overlay.id === state.hoveredId, colors.accent);
  }

  drawRoute(ctx, state.camera, state.routePoints, colors.accent);
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  camera: RuntimeCamera,
  overlay: Overlay,
  hovered: boolean,
  accentColor: string,
): void {
  switch (overlay.type) {
    case "circle": {
      const radius = Number(overlay.properties?.radius ?? 0.5);
      const screen = camera.worldToScreen(overlay.position);
      const edge = camera.worldToScreen({ x: overlay.position.x + radius, y: overlay.position.y });
      const color = String(overlay.properties?.color ?? accentColor);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, Math.hypot(edge.x - screen.x, edge.y - screen.y), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }
    case "label": {
      const screen = camera.worldToScreen(overlay.position);
      ctx.fillStyle = String(overlay.properties?.color ?? "#1c1c20");
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(overlay.properties?.text ?? ""), screen.x, screen.y);
      return;
    }
    default:
      drawDot(ctx, camera, overlay.position, accentColor, hovered ? 9 : 7);
  }
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  camera: RuntimeCamera,
  points: readonly Point[],
  fillStyle: string,
  strokeStyle: string,
  emphasized = false,
): void {
  if (points.length === 0) return;

  ctx.beginPath();
  const first = camera.worldToScreen(points[0] as Point);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i++) {
    const screen = camera.worldToScreen(points[i] as Point);
    ctx.lineTo(screen.x, screen.y);
  }
  ctx.closePath();

  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = emphasized ? 3 : 2;
  ctx.stroke();
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  camera: RuntimeCamera,
  a: Point,
  b: Point,
  color: string,
  lineWidth: number,
): void {
  const screenA = camera.worldToScreen(a);
  const screenB = camera.worldToScreen(b);
  ctx.beginPath();
  ctx.moveTo(screenA.x, screenA.y);
  ctx.lineTo(screenB.x, screenB.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  camera: RuntimeCamera,
  worldPoint: Point,
  color: string,
  radius: number,
): void {
  const screen = camera.worldToScreen(worldPoint);
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawRoute(
  ctx: CanvasRenderingContext2D,
  camera: RuntimeCamera,
  points: ReadonlyArray<Point | null>,
  color: string,
): void {
  if (points.length === 0) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
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
}
