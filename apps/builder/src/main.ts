import { IndoorBuilder, type BuilderConfig, type EventActionRule } from "@indoor/builder";
import { createSampleProject } from "./sampleProject";

const { project } = createSampleProject();

const logEl = document.querySelector<HTMLDivElement>("#log")!;
function log(message: string): void {
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.prepend(line);
}

const RULE_STORE: EventActionRule = {
  event: "poi.click",
  conditions: [{ field: "poi.type", operator: "equals", value: "store" }],
  actions: [
    { type: "poi.focus" },
    { type: "panel.open", panelId: "poi-detail" },
  ],
};

const RULE_RESTROOM: EventActionRule = {
  event: "poi.click",
  conditions: [{ field: "poi.type", operator: "equals", value: "restroom" }],
  actions: [{ type: "event.emit", name: "restroom-selected", payload: { note: "demo payload" } }],
};

function buildConfig(): BuilderConfig {
  const events: EventActionRule[] = [];
  if ((document.querySelector("#rule-store") as HTMLInputElement).checked) events.push(RULE_STORE);
  if ((document.querySelector("#rule-restroom") as HTMLInputElement).checked) events.push(RULE_RESTROOM);

  return {
    camera: {
      mode: (document.querySelector("#mode-3d") as HTMLInputElement).checked ? "3d" : "2d",
      pan: (document.querySelector("#pan-enabled") as HTMLInputElement).checked,
      zoom: (document.querySelector("#zoom-enabled") as HTMLInputElement).checked,
      rotate: true,
    },
    controls: { floorSelector: true, cameraToggle: true },
    events,
    theme: {
      background: (document.querySelector("#theme-background") as HTMLInputElement).value,
      accentColor: (document.querySelector("#theme-accent") as HTMLInputElement).value,
    },
  };
}

const builder = new IndoorBuilder({ container: "#map", project, config: buildConfig() });

// Host application owns any actual UI chrome (popups/panels) — it listens to
// the Builder's "action" event and decides what to do. This is the seam
// between the map-native actions Builder executes itself and everything else.
const hostPanel = document.querySelector<HTMLDivElement>("#host-panel")!;
const hostPanelBody = document.querySelector<HTMLParagraphElement>("#host-panel-body")!;

builder.on("action", ({ action, sourceEvent }) => {
  log(`action: ${sourceEvent} ${JSON.stringify(action)}`);
  if (action.type === "panel.open") {
    hostPanelBody.textContent = `panelId = "${action.panelId}"`;
    hostPanel.classList.add("open");
  }
  if (action.type === "panel.close") {
    hostPanel.classList.remove("open");
  }
});

document.querySelector("#host-panel-close")!.addEventListener("click", () => {
  hostPanel.classList.remove("open");
});

builder.runtime.on("map.loaded", ({ project: loaded }) => log(`map.loaded: "${loaded.name}"`));
builder.runtime.on("poi.click", ({ poi }) => log(`poi.click: ${poi.name} (${poi.type})`));
builder.runtime.on("camera.changed", ({ state }) =>
  log(`camera.changed: mode target reached, zoom=${state.zoom.toFixed(0)}`),
);

function applyConfigFromForm(): void {
  builder.setConfig(buildConfig());
  log("config updated");
}

for (const id of [
  "mode-3d",
  "pan-enabled",
  "zoom-enabled",
  "rule-store",
  "rule-restroom",
  "theme-background",
  "theme-accent",
]) {
  document.querySelector(`#${id}`)!.addEventListener("change", applyConfigFromForm);
}

document.querySelector("#capture-camera")!.addEventListener("click", () => {
  builder.captureCurrentCameraAsInitial();
  log(`captured camera: ${JSON.stringify(builder.getConfig().camera)}`);
});
