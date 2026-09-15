/**
 * Action vocabulary for the Event -> Condition -> Action system (spec §26-27).
 * `poiId`/`spaceId` are optional on the two focus/highlight actions: when
 * omitted, the id is taken from whatever object the triggering event carries
 * (e.g. a "poi.click" rule can say "focus the clicked POI" without knowing
 * its id ahead of time). Pass one explicitly for a fixed, event-independent target.
 */
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
  | { type: "route.start"; fromNodeId: string; toNodeId: string }
  | { type: "route.clear" }
  | {
      type: "route.playAnimation";
      animationType?: "marker" | "flythrough";
      cameraMode?: "first" | "third";
      curve?: "straight" | "smooth";
      durationSeconds?: number;
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
