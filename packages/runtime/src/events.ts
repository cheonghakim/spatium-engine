import type { Furniture, IndoorProject, POI, Space } from "@indoor/core";
import type { CameraMode } from "./IndoorRuntime.js";
import type { RuntimeCameraState } from "./camera/RuntimeCamera.js";

export interface RuntimeEventMap {
  "map.loaded": { project: IndoorProject };
  "poi.click": { poi: POI };
  /** Fires with the POI being hovered, and again with null when the pointer leaves it. */
  "poi.hover": { poi: POI | null };
  "furniture.click": { furniture: Furniture };
  "space.click": { space: Space };
  "marker.click": { markerId: string };
  "floor.changed": { floorId: string };
  "camera.changed": { mode: CameraMode; state: RuntimeCameraState };
  "route.started": { fromNodeId: string; toNodeId: string };
  "route.finished": Record<string, never>;
  /** 3D was requested (setCameraMode("3d") / playRouteAnimation()) but WebGL isn't available
   *  (headless/sandboxed embeds, old browsers, some CI) — the camera mode stays unchanged. */
  "render3d.unavailable": { message: string };
  /** The 3D renderer's WebGL context was lost; rendering is paused until it recovers. */
  "render3d.contextLost": Record<string, never>;
  /** The 3D renderer's WebGL context was restored and its scene rebuilt automatically. */
  "render3d.contextRestored": Record<string, never>;
}
