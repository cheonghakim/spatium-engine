import type { Point } from "./common.js";

export type POIType =
  | "store"
  | "restroom"
  | "elevator"
  | "stairs"
  | "information"
  | "exit"
  | "custom";

export interface POI {
  id: string;
  floorId: string;

  position: Point;

  spaceId?: string;

  type: POIType;

  name: string;

  properties?: Record<string, unknown>;
}
