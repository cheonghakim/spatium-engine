/**
 * Action vocabulary for the Event -> Condition -> Action system (spec §26-27).
 * `poiId`/`spaceId` are optional on the two focus/highlight actions: when
 * omitted, the id is taken from whatever object the triggering event carries
 * (e.g. a "poi.click" rule can say "focus the clicked POI" without knowing
 * its id ahead of time). Pass one explicitly for a fixed, event-independent target.
 */
import type { RouteEndpoint } from "@indoor/core";
import type { RouteOptions } from "@indoor/runtime";

export type Action =
  | { type: "poi.focus"; poiId?: string }
  | { type: "space.highlight"; spaceId?: string }
  | { type: "popup.open"; content: string }
  | { type: "panel.open"; panelId: string }
  | { type: "panel.close"; panelId: string }
  | { type: "marker.add"; markerId: string; floorId: string; x: number; y: number }
  | { type: "marker.remove"; markerId: string }
  | { type: "floor.change"; floorId: string }
  | { type: "camera.move"; x: number; y: number; zoom?: number }
  | { type: "camera.setMode2d" }
  | { type: "camera.setMode3d" }
  | {
      /**
       * Routes between two endpoints. `from`/`to` take anything the runtime's
       * startRoute takes — a node id, { poiId }, { spaceId } or
       * { floorId, position } — and win over the older `fromNodeId`/`toNodeId`.
       * `options` are the runtime's RouteOptions (requireAccessible, …).
       */
      type: "route.start";
      fromNodeId?: string;
      toNodeId?: string;
      from?: RouteEndpoint;
      to?: RouteEndpoint;
      options?: RouteOptions;
    }
  | { type: "route.clear" }
  | {
      type: "route.playAnimation";
      animationType?: "marker" | "flythrough";
      cameraMode?: "first" | "third" | "overview";
      curve?: "straight" | "smooth";
      durationSeconds?: number;
      /** Speed multiplier (1 = walking pace). */
      speed?: number;
    }
  | { type: "route.stopAnimation" }
  | { type: "url.open"; url: string }
  | { type: "event.emit"; name: string; payload?: Record<string, unknown> };

export type ConditionOperator = "equals" | "notEquals" | "in" | "notIn" | "gt" | "lt";

export interface Condition {
  field: string;
  operator: ConditionOperator;
  value: unknown;
}

export interface EventActionRule {
  event: string;
  conditions?: Condition[];
  actions: Action[];
}
