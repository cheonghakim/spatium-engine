import type { Point } from "./common.js";

export type EntranceType = "door" | "opening" | "stairs" | "elevator" | "escalator";

export interface Entrance {
  id: string;
  floorId: string;

  position: Point;

  spaceA?: string;
  spaceB?: string;

  type: EntranceType;
}
