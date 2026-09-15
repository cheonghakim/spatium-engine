import type { Point } from "./common.js";

export type SpaceType =
  | "room"
  | "store"
  | "corridor"
  | "lobby"
  | "stairs"
  | "elevator"
  | "restricted"
  | "unknown";

export interface SpaceProperties {
  name?: string;
  category?: string;
  code?: string;
  tenantId?: string;
}

export interface Space {
  id: string;
  floorId: string;

  polygon: Point[];

  type: SpaceType;

  height: number;

  properties: SpaceProperties;
}
