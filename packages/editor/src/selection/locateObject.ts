import { polygonCentroid, type Floor, type IndoorProject, type Point } from "@indoor/core";

export interface ObjectLocation {
  floorId: string;
  position: Point;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Resolves a non-group object's own position on `floor`, or null if `id`
 * doesn't belong to any of this floor's collections. Deliberately excludes
 * groups (groups don't nest) — factored out so the group branch below can
 * reuse it per member without recursing into another group lookup.
 */
function locatePrimitive(floor: Floor, id: string): Point | null {
  const space = floor.spaces.find((s) => s.id === id);
  if (space) return polygonCentroid(space.polygon);

  const wall = floor.walls.find((w) => w.id === id);
  if (wall) return midpoint(wall.start, wall.end);

  const entrance = floor.entrances.find((e) => e.id === id);
  if (entrance) return entrance.position;

  const poi = floor.pois.find((p) => p.id === id);
  if (poi) return poi.position;

  const furniture = floor.furniture.find((f) => f.id === id);
  if (furniture) return furniture.position;

  const node = floor.navigation.nodes.find((n) => n.id === id);
  if (node) return node.position;

  const edge = floor.navigation.edges.find((e) => e.id === id);
  if (edge) {
    const from = floor.navigation.nodes.find((n) => n.id === edge.from);
    const to = floor.navigation.nodes.find((n) => n.id === edge.to);
    if (from && to) return midpoint(from.position, to.position);
  }

  return null;
}

/** Finds which floor an object belongs to and a reasonable point to center a camera on it. */
export function locateObject(project: IndoorProject, id: string): ObjectLocation | null {
  for (const building of project.buildings) {
    for (const floor of building.floors) {
      const group = floor.groups.find((g) => g.id === id);
      if (group) {
        const positions = group.memberIds
          .map((memberId) => locatePrimitive(floor, memberId))
          .filter((p): p is Point => p !== null);
        if (positions.length === 0) continue;
        const center = positions.reduce(
          (sum, p) => ({ x: sum.x + p.x / positions.length, y: sum.y + p.y / positions.length }),
          { x: 0, y: 0 },
        );
        return { floorId: floor.id, position: center };
      }

      const position = locatePrimitive(floor, id);
      if (position) return { floorId: floor.id, position };
    }
  }
  return null;
}
