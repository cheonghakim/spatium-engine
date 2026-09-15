import type { Floor, IndoorProject } from "../types/project.js";
import type { Space } from "../types/space.js";
import type { POI } from "../types/poi.js";

/** Finds a Space by id anywhere in the project, along with the floor it's on. */
export function findSpaceInProject(
  project: IndoorProject,
  spaceId: string,
): { floor: Floor; space: Space } | null {
  for (const building of project.buildings) {
    for (const floor of building.floors) {
      const space = floor.spaces.find((s) => s.id === spaceId);
      if (space) return { floor, space };
    }
  }
  return null;
}

/** Finds a POI by id anywhere in the project, along with the floor it's on. */
export function findPOIInProject(
  project: IndoorProject,
  poiId: string,
): { floor: Floor; poi: POI } | null {
  for (const building of project.buildings) {
    for (const floor of building.floors) {
      const poi = floor.pois.find((p) => p.id === poiId);
      if (poi) return { floor, poi };
    }
  }
  return null;
}
