import type { Point } from "./common.js";

export type EntranceType = "door" | "window" | "opening" | "stairs" | "elevator" | "escalator";

export interface Entrance {
  id: string;
  floorId: string;

  position: Point;

  spaceA?: string;
  spaceB?: string;

  type: EntranceType;
  /** Optional for compatibility with existing projects. Dimensions are meters. */
  wallId?: string;
  width?: number;
  height?: number;
  sillHeight?: number;
  /** Counterclockwise degrees in the plan; stairs ascend along this direction. */
  rotation?: number;
  depth?: number;
  stepCount?: number;
  landingDepth?: number;
  doorOpenAngle?: number;
}
