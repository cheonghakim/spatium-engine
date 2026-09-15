import { IndoorRuntime } from "@indoor/runtime";
import { createSampleProject } from "./sampleProject";

const { project, floor1, floor2, routeStartNodeId, routeEndNodeId } = createSampleProject();

const runtime = new IndoorRuntime({ container: "#map" });

const logEl = document.querySelector<HTMLDivElement>("#log")!;
function log(message: string): void {
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.prepend(line);
}

runtime.on("map.loaded", ({ project: loaded }) => log(`map.loaded: "${loaded.name}"`));
runtime.on("floor.changed", ({ floorId }) => log(`floor.changed: ${floorId.slice(0, 8)}`));
runtime.on("space.click", ({ space }) => log(`space.click: ${space.properties.name ?? space.id.slice(0, 8)}`));
runtime.on("poi.click", ({ poi }) => log(`poi.click: ${poi.name}`));
runtime.on("poi.hover", ({ poi }) => {
  if (poi) log(`poi.hover: ${poi.name}`);
});
runtime.on("marker.click", ({ markerId }) => log(`marker.click: ${markerId}`));
runtime.on("route.started", ({ fromNodeId, toNodeId }) =>
  log(`route.started: ${fromNodeId.slice(0, 6)} → ${toNodeId.slice(0, 6)}`),
);
runtime.on("route.finished", () => log("route.finished"));
runtime.on("camera.changed", ({ state }) =>
  log(`camera.changed: zoom=${state.zoom.toFixed(0)} rotation=${((state.rotation * 180) / Math.PI).toFixed(0)}°`),
);

void runtime.load(project).then(() => {
  runtime.start();
  log("runtime.start() called");
});

const floorButtons = document.querySelector<HTMLDivElement>("#floor-buttons")!;
for (const floor of [floor1, floor2]) {
  const button = document.createElement("button");
  button.textContent = floor.name;
  button.addEventListener("click", () => runtime.setFloor(floor.id));
  floorButtons.appendChild(button);
}

document.querySelector("#zoom-in")!.addEventListener("click", () => {
  runtime.camera.zoomBy(1.25);
  runtime.start();
});
document.querySelector("#zoom-out")!.addEventListener("click", () => {
  runtime.camera.zoomBy(1 / 1.25);
  runtime.start();
});
document.querySelector("#rotate")!.addEventListener("click", () => {
  runtime.camera.rotateBy(Math.PI / 12);
  runtime.start();
});

let is3d = false;
document.querySelector("#toggle-3d")!.addEventListener("click", () => {
  is3d = !is3d;
  runtime.setCameraMode(is3d ? "3d" : "2d");
});

let markerCount = 0;
document.querySelector("#add-marker")!.addEventListener("click", () => {
  const floor = runtime.getActiveFloor();
  const space = floor?.spaces[0];
  if (!floor || !space) return;
  const centroid = space.polygon.reduce(
    (acc, p) => ({ x: acc.x + p.x / space.polygon.length, y: acc.y + p.y / space.polygon.length }),
    { x: 0, y: 0 },
  );
  markerCount += 1;
  runtime.addOverlay({
    id: `marker-${markerCount}`,
    floorId: floor.id,
    type: "marker",
    position: centroid,
  });
  log(`added marker-${markerCount}`);
});
document.querySelector("#clear-markers")!.addEventListener("click", () => {
  for (const overlay of runtime.getOverlays()) runtime.removeOverlay(overlay.id);
  log("cleared markers");
});

document.querySelector("#start-route")!.addEventListener("click", () => {
  const result = runtime.startRoute(routeStartNodeId, routeEndNodeId);
  log(result ? `route found: ${result.distance.toFixed(1)}m over ${result.nodeIds.length} nodes` : "no route found");
});
document.querySelector("#clear-route")!.addEventListener("click", () => runtime.clearRoute());
