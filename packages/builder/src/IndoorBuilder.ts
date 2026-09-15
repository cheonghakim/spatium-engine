import { findPOIInProject, findSpaceInProject, type IndoorProject } from "@indoor/core";
import { IndoorRuntime, type RoutePlaybackOptions, type RuntimeEventMap } from "@indoor/runtime";
import type { BuilderConfig } from "./BuilderConfig.js";
import type { Action } from "./actions.js";
import { matchesConditions } from "./conditions.js";
import { EventEmitter } from "./events/EventEmitter.js";

export interface IndoorBuilderOptions {
  container: HTMLElement | string;
  project: IndoorProject;
  config?: BuilderConfig;
}

export interface BuilderEventMap {
  /** Fired for every action a rule triggers — actions with no direct map effect
   *  (popup.open, panel.open/close, url.open, event.emit) are ONLY observable
   *  this way, since the host app owns that UI, not the Builder. */
  action: { action: Action; sourceEvent: string };
  configChanged: { config: BuilderConfig };
}

const DEFAULT_CONFIG: BuilderConfig = {
  camera: { mode: "2d", pan: true, zoom: true, rotate: true },
  controls: { floorSelector: true, cameraToggle: true },
  events: [],
};

const RUNTIME_EVENT_NAMES: ReadonlyArray<keyof RuntimeEventMap> = [
  "map.loaded",
  "poi.click",
  "poi.hover",
  "space.click",
  "marker.click",
  "floor.changed",
  "camera.changed",
  "route.started",
  "route.finished",
];

/**
 * Configures how a Runtime instance behaves — camera, controls, markers,
 * events — without editing map geometry (that's Studio's job). Wraps a real
 * @indoor/runtime instance directly: this *is* the live preview, and Export
 * (Phase 10) replays the same config against the same engine, so what you
 * see here is what ships (spec §29).
 */
export class IndoorBuilder {
  readonly runtime: IndoorRuntime;

  private readonly project: IndoorProject;
  private config: BuilderConfig;
  private readonly emitter = new EventEmitter<BuilderEventMap>();

  constructor(options: IndoorBuilderOptions) {
    this.project = options.project;
    this.config = options.config ?? DEFAULT_CONFIG;
    this.runtime = new IndoorRuntime({ container: options.container });

    for (const eventName of RUNTIME_EVENT_NAMES) {
      this.runtime.on(eventName, (payload) => this.handleRuntimeEvent(eventName, payload));
    }

    void this.runtime.load(this.project).then(() => {
      this.applyConfig();
      this.runtime.start();
    });
  }

  getConfig(): BuilderConfig {
    return this.config;
  }

  setConfig(config: BuilderConfig): void {
    this.config = config;
    this.applyConfig();
    this.emitter.emit("configChanged", { config });
  }

  /** Captures the live preview camera's current position as the config's initial camera. */
  captureCurrentCameraAsInitial(): void {
    const state = this.runtime.camera.getState();
    this.setConfig({
      ...this.config,
      camera: { ...this.config.camera, initialCenter: { ...state.center }, initialZoom: state.zoom },
    });
  }

  on<K extends keyof BuilderEventMap>(event: K, handler: (payload: BuilderEventMap[K]) => void): () => void {
    return this.emitter.on(event, handler);
  }

  off<K extends keyof BuilderEventMap>(event: K, handler: (payload: BuilderEventMap[K]) => void): void {
    this.emitter.off(event, handler);
  }

  private applyConfig(): void {
    const { camera } = this.config;
    const current = this.runtime.camera.getState();
    this.runtime.setCameraState({
      center: camera.initialCenter ?? current.center,
      zoom: camera.initialZoom ?? current.zoom,
      rotation: current.rotation,
    });
    this.runtime.setInteractionOptions({ pan: camera.pan, zoom: camera.zoom, rotate: camera.rotate });
    this.runtime.setCameraMode(camera.mode);
    this.runtime.setTheme(this.config.theme ?? {});
  }

  private handleRuntimeEvent(eventName: keyof RuntimeEventMap, payload: unknown): void {
    for (const rule of this.config.events) {
      if (rule.event !== eventName) continue;
      if (!matchesConditions(rule.conditions, payload)) continue;
      for (const action of rule.actions) this.executeAction(action, payload);
    }
  }

  private executeAction(action: Action, sourcePayload: unknown): void {
    this.emitter.emit("action", { action, sourceEvent: action.type });

    switch (action.type) {
      case "poi.focus": {
        const poiId = action.poiId ?? extractId(sourcePayload, "poi");
        const found = poiId ? findPOIInProject(this.project, poiId) : null;
        if (found) {
          const state = this.runtime.camera.getState();
          this.runtime.setCameraState({ center: found.poi.position, zoom: state.zoom, rotation: state.rotation });
        }
        break;
      }
      case "space.highlight": {
        // Visual highlighting of an arbitrary space on demand isn't wired into
        // the renderers yet (only hover-driven highlight is) — resolving the
        // target here and emitting "action" above is what a host UI needs to
        // implement its own highlight today.
        const spaceId = action.spaceId ?? extractId(sourcePayload, "space");
        if (spaceId) findSpaceInProject(this.project, spaceId);
        break;
      }
      case "marker.add":
        this.runtime.addOverlay({
          id: action.markerId,
          floorId: action.floorId,
          type: "marker",
          position: { x: action.x, y: action.y },
        });
        break;
      case "marker.remove":
        this.runtime.removeOverlay(action.markerId);
        break;
      case "floor.change":
        this.runtime.setFloor(action.floorId);
        break;
      case "camera.move": {
        const state = this.runtime.camera.getState();
        this.runtime.setCameraState({
          center: { x: action.x, y: action.y },
          zoom: action.zoom ?? state.zoom,
          rotation: state.rotation,
        });
        break;
      }
      case "camera.setMode2d":
        this.runtime.setCameraMode("2d");
        break;
      case "camera.setMode3d":
        this.runtime.setCameraMode("3d");
        break;
      case "route.start":
        this.runtime.startRoute(action.fromNodeId, action.toNodeId);
        break;
      case "route.clear":
        this.runtime.clearRoute();
        break;
      case "route.playAnimation": {
        const options: RoutePlaybackOptions = {};
        if (action.animationType !== undefined) options.animationType = action.animationType;
        if (action.cameraMode !== undefined) options.cameraMode = action.cameraMode;
        if (action.curve !== undefined) options.curve = action.curve;
        if (action.durationSeconds !== undefined) options.durationSeconds = action.durationSeconds;
        this.runtime.playRouteAnimation(options);
        break;
      }
      case "route.stopAnimation":
        this.runtime.stopRouteAnimation();
        break;
      case "popup.open":
      case "panel.open":
      case "panel.close":
      case "url.open":
      case "event.emit":
        // Host-application UI concerns — already surfaced via the "action" event above.
        break;
    }
  }
}

function extractId(payload: unknown, key: "poi" | "space"): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const nested = (payload as Record<string, unknown>)[key];
  if (!nested || typeof nested !== "object") return undefined;
  const id = (nested as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}
