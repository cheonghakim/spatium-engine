import type { Furniture, IndoorProject, PathResult, POI, RouteEndpoint, Space } from "@indoor/core";
import type { CameraMode, UserLocation } from "./IndoorRuntime.js";
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
  /**
   * Node ids are the first/last node of the found route (or the given ids when
   * none was found). `from`/`to` are set when the endpoint wasn't a node id.
   */
  "route.started": {
    fromNodeId: string;
    toNodeId: string;
    from?: RouteEndpoint;
    to?: RouteEndpoint;
  };
  "route.finished": Record<string, never>;
  /**
   * invalidate() recomputed the active route against the edited project. `route`
   * is null when its endpoints no longer connect (the route was cleared).
   */
  "route.recomputed": { route: PathResult | null };
  /** setUserLocation() / a location provider reported a new position (null = hidden). */
  "location.changed": { location: UserLocation | null };
  /** The visitor reached the active route's end (fires once per route). */
  "route.arrived": { location: UserLocation };
  /**
   * The visitor is farther than the off-route distance from the route line on
   * their plane (`distance` null when the route doesn't visit that plane).
   * Fires once per excursion; reroute by calling startRoute from `location`.
   */
  "route.offRoute": { location: UserLocation; distance: number | null };
  /** An overlay was added whose type some renderer draws only as a marker (see OVERLAY_SUPPORT). */
  "overlay.fallback": { overlayId: string; type: string; renderers: Array<"2d" | "3d"> };
  /** 3D was requested (setCameraMode("3d") / playRouteAnimation()) but WebGL isn't available
   *  (headless/sandboxed embeds, old browsers, some CI) — the camera mode stays unchanged. */
  "render3d.unavailable": { message: string };
  /** The 3D renderer's WebGL context was lost; rendering is paused until it recovers. */
  "render3d.contextLost": Record<string, never>;
  /** The 3D renderer's WebGL context was restored and its scene rebuilt automatically. */
  "render3d.contextRestored": Record<string, never>;
}
