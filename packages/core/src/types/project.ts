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

export interface Building {
  id: string;
  name: string;
  floors: Floor[];
}

export interface IndoorProject {
  schemaVersion: string;
  id: string;
  name: string;
  buildings: Building[];
}
