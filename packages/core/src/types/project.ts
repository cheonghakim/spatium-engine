import type { Space } from "./space.js";
import type { Wall } from "./wall.js";
import type { Entrance } from "./entrance.js";
import type { POI } from "./poi.js";
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
