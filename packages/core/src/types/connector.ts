import type { LocalizedText } from "./common.js";

export type ConnectorType = "elevator" | "stairs" | "escalator" | "ramp";

export interface ConnectorStop {
  floorId: string;
  /** Navigation node on that floor where the connector is boarded/left. */
  nodeId: string;
  /** Space the connector occupies on that floor (e.g. the elevator shaft). */
  spaceId?: string;
}

/**
 * Equipment spec used to estimate travel time. Units: meters, seconds, m/s.
 * Unset values fall back to per-type defaults (see docs/design/0001 §4).
 */
export interface ConnectorSpec {
  /** Rated speed (elevators, escalators). Typical elevators 1.0–2.5 m/s, high-speed 4–10 m/s. */
  speed?: number;
  /** Average time from call to boarding. Depends on car count and traffic. */
  averageWait?: number;
  /** Fixed per-ride overhead: acceleration, doors, boarding/alighting. */
  boardingTime?: number;
  /** Rated capacity in persons — informational, not used for routing cost. */
  capacity?: number;
}

/**
 * A vertical connection spanning several floors of one building — the source
 * of truth for floor-to-floor routing. Navigation edges between its stops are
 * derived, not stored, so adding a stop takes effect immediately.
 */
export interface Connector {
  id: string;
  name?: string;
  names?: LocalizedText;
  externalId?: string;
  type: ConnectorType;
  /** Floors this connector serves. Order doesn't matter; routing sorts by floor elevation. */
  stops: ConnectorStop[];
  accessible: boolean;
  /** Escalator travel direction. Unset = both ways. */
  direction?: "up" | "down";
  spec?: ConnectorSpec;
}
