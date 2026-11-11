import type { LocalizedText, Point } from "./common.js";

export type SpaceType =
  "room" | "store" | "corridor" | "lobby" | "stairs" | "elevator" | "restricted" | "unknown";

export interface SpaceProperties {
  name?: string;
  category?: string;
  code?: string;
  tenantId?: string;
  names?: LocalizedText;
  /** Key in the customer's own system (room number, tenant code…). Unique per project. */
  externalId?: string;
}

export interface Space {
  id: string;
  floorId: string;

  polygon: Point[];
  /** Areas cut out of the polygon (columns, cores, atrium voids). Each ring is unclosed. */
  holes?: Point[][];

  type: SpaceType;

  height: number;
  /** Stair spaces rise along this plan direction (degrees). */
  stairDirection?: number;
  stairSteps?: number;

  properties: SpaceProperties;
}
