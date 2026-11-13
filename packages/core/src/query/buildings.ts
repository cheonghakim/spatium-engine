import { buildingToSite } from "../geometry/georeference.js";
import { convexHull } from "../geometry/polygon.js";
import type { Point } from "../types/common.js";
import type { Building, Floor } from "../types/project.js";

/**
 * The floor people enter on: level 1 if present, else level 0, else the
 * lowest non-negative level, else the first floor.
 */
export function groundFloor(building: Building): Floor | undefined {
  const floors = building.floors;
  return (
    floors.find((f) => f.level === 1) ??
    floors.find((f) => f.level === 0) ??
    [...floors].filter((f) => f.level >= 0).sort((a, b) => a.level - b.level)[0] ??
    floors[0]
  );
}

/**
 * The building's outline in building-local coordinates: its `footprint`, or
 * the convex hull of every floor's spaces. [] when neither exists.
 */
export function buildingOutline(building: Building): Point[] {
  if (building.footprint && building.footprint.length >= 3) return building.footprint;
  const hull = convexHull(building.floors.flatMap((f) => f.spaces.flatMap((s) => s.polygon)));
  return hull.length >= 3 ? hull : [];
}

/** buildingOutline placed into site coordinates via Building.placement. */
export function buildingSiteOutline(building: Building): Point[] {
  return buildingOutline(building).map((p) => buildingToSite(building, p));
}
