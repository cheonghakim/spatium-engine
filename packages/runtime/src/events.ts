import type { IndoorProject, POI, Space } from "@indoor/core";
import type { CameraMode } from "./IndoorRuntime.js";
import type { RuntimeCameraState } from "./camera/RuntimeCamera.js";

export interface RuntimeEventMap {
  "map.loaded": { project: IndoorProject };
  "poi.click": { poi: POI };
  /** Fires with the POI being hovered, and again with null when the pointer leaves it. */
  "poi.hover": { poi: POI | null };
  "space.click": { space: Space };
  "marker.click": { markerId: string };
  "floor.changed": { floorId: string };
  "camera.changed": { mode: CameraMode; state: RuntimeCameraState };
  "route.started": { fromNodeId: string; toNodeId: string };
  "route.finished": Record<string, never>;
}
