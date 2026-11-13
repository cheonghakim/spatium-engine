import type { LocalizedText, Point } from "./common.js";
import type { Connector } from "./connector.js";
import type { Site } from "./site.js";
import type { Space } from "./space.js";
import type { Wall } from "./wall.js";
import type { Entrance } from "./entrance.js";
import type { POI } from "./poi.js";
import type { Furniture } from "./furniture.js";
import type { Group } from "./group.js";
import type { NavigationGraph } from "./navigation.js";

export interface Floor {
  id: string;
  name: string;
  names?: LocalizedText;
  externalId?: string;
  level: number;
  elevation: number;

  spaces: Space[];
  walls: Wall[];
  entrances: Entrance[];
  pois: POI[];
  /**
   * Optional for compatibility with projects saved before furniture existed —
   * deserializeProject backfills a missing array to `[]` on load, so once a
   * project has passed through there this is always present in practice.
   */
  furniture: Furniture[];
  /** Same backward-compat story as `furniture` — backfilled to `[]` on load. */
  groups: Group[];

  navigation: NavigationGraph;
}

/**
 * Where a building's local frame sits in the site frame. Building-local
 * coordinates stay exactly as drawn/imported (each CAD file has its own
 * origin); this transform is applied on top.
 */
export interface BuildingPlacement {
  /** Site-local position (meters) of the building's local origin. */
  origin: Point;
  /** Degrees clockwise from true north to the building's local +Y axis. 0 = already north-aligned. */
  bearing: number;
}

export interface Building {
  id: string;
  name: string;
  names?: LocalizedText;
  externalId?: string;
  /** Unset = identity (origin 0,0, bearing 0). */
  placement?: BuildingPlacement;
  /** Building outline in building-local coordinates. Needed for IMDF footprints. */
  footprint?: Point[];
  /** Elevators, stairs, escalators and ramps spanning this building's floors. */
  connectors?: Connector[];
  floors: Floor[];
}

export interface IndoorProject {
  schemaVersion: string;
  id: string;
  name: string;
  /** Optional: single-building projects work without one. */
  site?: Site;
  buildings: Building[];
}
