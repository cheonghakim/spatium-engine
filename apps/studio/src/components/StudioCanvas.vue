<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  buildingSiteOutline,
  buildingToSite,
  groundFloor,
  type Point,
  type RouteEndpoint,
} from "@indoor/core";
import {
  IndoorEditor,
  PolygonTool,
  WallTool,
  SelectTool,
  DraftReviewTool,
  CalibrateTool,
  NavigationEdgeTool,
  NavigationTool,
} from "@indoor/editor";
import { render, type SiteContext } from "../canvas/render";
import { setImageLoadListener } from "../canvas/imageCache";

const props = defineProps<{ editor: IndoorEditor }>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const showGrid = ref(true);
/** Mirrors EditorCamera's default zoom (screen px per world meter) so the HUD can render a 100% baseline; the camera itself doesn't expose this constant. */
const BASE_ZOOM = 50;
const zoomPercent = ref(100);
const spacePressed = ref(false);
const isPanning = ref(false);
let panLastScreen: Point | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let resizeObserver: ResizeObserver | null = null;
let unsubscribers: Array<() => void> = [];

function currentDraftPoints() {
  const tool = props.editor.tools.active;
  return tool instanceof PolygonTool ? tool.getDraftPoints() : [];
}

function currentCalibrationPoints() {
  const tool = props.editor.tools.active;
  return tool instanceof CalibrateTool ? tool.getPendingPoints() : [];
}

function currentPendingEdgeNodeId(): string | null {
  const tool = props.editor.tools.active;
  if (tool instanceof NavigationEdgeTool || tool instanceof NavigationTool)
    return tool.getPendingNodeId();
  return null;
}

function currentPendingWallStart(): Point | null {
  const tool = props.editor.tools.active;
  return tool instanceof WallTool ? tool.getPendingStart() : null;
}

function currentMarquee() {
  const tool = props.editor.tools.active;
  return tool instanceof SelectTool || tool instanceof DraftReviewTool ? tool.getMarquee() : null;
}

function currentRoutePoints(): Array<Point | null> {
  const preview = props.editor.routePreview.current;
  const floor = props.editor.getActiveFloor();
  if (!preview?.result || !floor) return [];
  const points = preview.result.nodeIds.map((id) => {
    const node = floor.navigation.nodes.find((n) => n.id === id);
    return node ? node.position : null;
  });
  // A POI endpoint: draw the last stretch from the door to the POI itself.
  const poiAt = (endpoint: RouteEndpoint): Point | null =>
    typeof endpoint === "object" && "poiId" in endpoint
      ? (floor.pois.find((p) => p.id === endpoint.poiId)?.position ?? null)
      : null;
  const startPoi = poiAt(preview.start);
  const endPoi = poiAt(preview.end);
  if (startPoi && points[0]) points.unshift(startPoi);
  if (endPoi && points.at(-1)) points.push(endPoi);
  return points;
}

/** Site view: buildings (placed), their entrances and outdoor links, in site coordinates. */
function currentSiteContext(): SiteContext | null {
  const editor = props.editor;
  if (!editor.isSiteView()) return null;
  const selectedId = editor.siteBuildingTool.getSelectedBuildingId();
  const anchors: Point[] = [];
  const buildings = editor.project.buildings.map((building) => {
    const ground = groundFloor(building);
    for (const floor of building.floors) {
      for (const node of floor.navigation.nodes) {
        if (node.type === "entrance") anchors.push(buildingToSite(building, node.position));
      }
    }
    return {
      id: building.id,
      name: building.name,
      outline: buildingSiteOutline(building),
      spaces: (ground?.spaces ?? []).map((space) =>
        space.polygon.map((p) => buildingToSite(building, p)),
      ),
      selected: building.id === selectedId,
    };
  });
  // Outdoor–outdoor edges are drawn by the normal navigation layer; only
  // edges reaching into a building need drawing here.
  const site = editor.project.site;
  const outdoor = new Set(site?.navigation.nodes.map((n) => n.id));
  const links: Array<[Point, Point]> = [];
  for (const edge of site?.navigation.edges ?? []) {
    if (outdoor.has(edge.from) && outdoor.has(edge.to)) continue;
    const a = editor.siteNodePosition(edge.from);
    const b = editor.siteNodePosition(edge.to);
    if (a && b) links.push([a, b]);
  }
  return { buildings, anchors, links };
}

function draw(): void {
  if (!ctx) return;
  zoomPercent.value = Math.round((props.editor.camera.getState().zoom / BASE_ZOOM) * 100);
  const draft = props.editor.draft.current;
  const visibleDraft =
    !draft?.floorId || draft.floorId === props.editor.getActiveFloor()?.id ? draft : null;
  render(ctx, {
    floor: props.editor.getActiveFloor(),
    site: currentSiteContext(),
    camera: props.editor.camera,
    selection: props.editor.selection.current,
    draftPoints: currentDraftPoints(),
    reference: props.editor.reference.current,
    layerVisibility: props.editor.layers.all,
    calibrationPoints: currentCalibrationPoints(),
    pendingEdgeNodeId: currentPendingEdgeNodeId(),
    routePoints: currentRoutePoints(),
    pendingWallStart: currentPendingWallStart(),
    draftWalls: visibleDraft?.walls ?? [],
    draftSpaces: visibleDraft?.spaces ?? [],
    draftElements: visibleDraft?.elements ?? [],
    selectedDraftIds: props.editor.draft.selectedIds,
    marquee: currentMarquee(),
    showGrid: showGrid.value,
  });
}

function resizeCanvas(): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.parentElement?.getBoundingClientRect();
  const width = rect?.width ?? canvas.clientWidth;
  const height = rect?.height ?? canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

  props.editor.camera.setViewportSize({ width, height });
  draw();
}

function toPointerEvent(evt: PointerEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const screenPoint = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  return {
    screenPoint,
    worldPoint: props.editor.camera.screenToWorld(screenPoint),
    button: evt.button,
    shiftKey: evt.shiftKey,
    ctrlKey: evt.ctrlKey,
    altKey: evt.altKey,
  };
}

function onPointerDown(evt: PointerEvent): void {
  canvasRef.value?.focus();
  canvasRef.value?.setPointerCapture(evt.pointerId);
  if (evt.button === 1 || spacePressed.value) {
    isPanning.value = true;
    panLastScreen = { x: evt.clientX, y: evt.clientY };
    return;
  }
  const event = toPointerEvent(evt);
  if (event) props.editor.handlePointerDown(event);
}

function onPointerMove(evt: PointerEvent): void {
  if (isPanning.value && panLastScreen) {
    const current = { x: evt.clientX, y: evt.clientY };
    props.editor.camera.panByScreenDelta({
      x: current.x - panLastScreen.x,
      y: current.y - panLastScreen.y,
    });
    panLastScreen = current;
    draw();
    return;
  }
  const event = toPointerEvent(evt);
  if (event) props.editor.handlePointerMove(event);
}

function onPointerUp(evt: PointerEvent): void {
  if (isPanning.value) {
    isPanning.value = false;
    panLastScreen = null;
    return;
  }
  const event = toPointerEvent(evt);
  if (event) props.editor.handlePointerUp(event);
}
function onPointerCancel(): void {
  props.editor.handleKeyDown({ key: "Escape", shiftKey: false, ctrlKey: false, altKey: false });
  draw();
}

const HANDLED_KEYS = new Set(["Enter", "Escape", "Backspace", "Delete"]);

function onKeyDown(evt: KeyboardEvent): void {
  if (evt.code === "Space") {
    if (!evt.repeat) spacePressed.value = true;
    evt.preventDefault();
    return;
  }
  if (HANDLED_KEYS.has(evt.key)) evt.preventDefault();
  props.editor.handleKeyDown({
    key: evt.key,
    shiftKey: evt.shiftKey,
    ctrlKey: evt.ctrlKey,
    altKey: evt.altKey,
  });
}

function onKeyUp(evt: KeyboardEvent): void {
  if (evt.code === "Space") {
    spacePressed.value = false;
    isPanning.value = false;
    panLastScreen = null;
  }
}

function onWheel(evt: WheelEvent): void {
  evt.preventDefault();
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const pivot = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  const factor = evt.deltaY < 0 ? 1.1 : 1 / 1.1;
  props.editor.camera.zoomBy(factor, pivot);
  draw();
}

function zoomBy(factor: number): void {
  props.editor.camera.zoomBy(factor);
  draw();
}
function resetView(): void {
  props.editor.camera.reset();
  draw();
}
function toggleGrid(): void {
  showGrid.value = !showGrid.value;
  draw();
}
defineExpose({ zoomBy, resetView, toggleGrid, showGrid, zoomPercent });

onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  setImageLoadListener(draw);

  resizeObserver = new ResizeObserver(resizeCanvas);
  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
  resizeCanvas();

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  unsubscribers = [
    props.editor.on("projectChanged", draw),
    props.editor.on("selectionChanged", draw),
    props.editor.on("floorChanged", draw),
    props.editor.on("toolChanged", () => {
      canvas.focus({ preventScroll: true });
      draw();
    }),
  ];
});

onBeforeUnmount(() => {
  const canvas = canvasRef.value;
  resizeObserver?.disconnect();
  canvas?.removeEventListener("pointerdown", onPointerDown);
  canvas?.removeEventListener("pointermove", onPointerMove);
  canvas?.removeEventListener("pointercancel", onPointerCancel);
  window.removeEventListener("pointerup", onPointerUp);
  canvas?.removeEventListener("keydown", onKeyDown);
  canvas?.removeEventListener("keyup", onKeyUp);
  canvas?.removeEventListener("wheel", onWheel);
  for (const unsubscribe of unsubscribers) unsubscribe();
  setImageLoadListener(() => {});
});
</script>

<template>
  <canvas
    ref="canvasRef"
    tabindex="0"
    class="studio-canvas"
    :class="{ panning: isPanning, 'pan-ready': spacePressed && !isPanning }"
    aria-label="실내 지도 편집 캔버스"
  />
</template>

<style scoped>
.studio-canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
  cursor: crosshair;
  touch-action: none;
}
.studio-canvas.pan-ready {
  cursor: grab;
}
.studio-canvas.panning {
  cursor: grabbing;
}
</style>
