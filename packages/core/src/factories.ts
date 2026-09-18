import { createId } from "./id.js";
import { CURRENT_SCHEMA_VERSION } from "./serialization/schemaVersion.js";
import type { Building, Floor, IndoorProject } from "./types/project.js";
import type { Point } from "./types/common.js";
import type { Space, SpaceType } from "./types/space.js";
import type { Wall } from "./types/wall.js";
import type { Entrance, EntranceType } from "./types/entrance.js";
import type { POI, POIType } from "./types/poi.js";
import type {
  NavigationEdge,
  NavigationEdgeType,
  NavigationNode,
  NavigationNodeType,
} from "./types/navigation.js";

export function createEmptyProject(name: string): IndoorProject {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: createId(),
    name,
    buildings: [],
  };
}

export function createBuilding(name: string): Building {
  return {
    id: createId(),
    name,
    floors: [],
  };
}

export function createFloor(name: string, level: number, elevation = 0): Floor {
  return {
    id: createId(),
    name,
    level,
    elevation,
    spaces: [],
    walls: [],
    entrances: [],
    pois: [],
    navigation: { nodes: [], edges: [] },
  };
}

export function createSpace(floorId: string, polygon: Point[], type: SpaceType = "unknown"): Space {
  return {
    id: createId(),
    floorId,
    polygon,
    type,
    height: 3,
    properties: {},
  };
}

export function createWall(floorId: string, start: Point, end: Point, thickness = 0.2): Wall {
  return {
    id: createId(),
    floorId,
    start,
    end,
    thickness,
  };
}

export function createEntrance(
  floorId: string,
  position: Point,
  type: EntranceType = "door",
): Entrance {
  return {
    id: createId(),
    floorId,
    position,
    type,
  };
}

export function createPOI(
  floorId: string,
  position: Point,
  type: POIType = "custom",
  name = "New POI",
): POI {
  return {
    id: createId(),
    floorId,
    position,
    type,
    name,
  };
}

export function createNavigationNode(
  floorId: string,
  position: Point,
  type: NavigationNodeType = "normal",
  name?: string,
): NavigationNode {
  return {
    id: createId(),
    floorId,
    position,
    type,
    ...(name !== undefined ? { name } : {}),
  };
}

export function createNavigationEdge(
  from: string,
  to: string,
  distanceMeters: number,
  type: NavigationEdgeType = "walk",
  accessible = true,
): NavigationEdge {
  return {
    id: createId(),
    from,
    to,
    type,
    distance: distanceMeters,
    accessible,
  };
}
