import { polygonCentroid, type IndoorProject, type Point } from "@indoor/core";

export interface ObjectLocation {
  floorId: string;
  position: Point;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Finds which floor an object belongs to and a reasonable point to center a camera on it. */
export function locateObject(project: IndoorProject, id: string): ObjectLocation | null {
  for (const building of project.buildings) {
    for (const floor of building.floors) {
      const space = floor.spaces.find((s) => s.id === id);
      if (space) return { floorId: floor.id, position: polygonCentroid(space.polygon) };

      const wall = floor.walls.find((w) => w.id === id);
      if (wall) return { floorId: floor.id, position: midpoint(wall.start, wall.end) };

      const entrance = floor.entrances.find((e) => e.id === id);
      if (entrance) return { floorId: floor.id, position: entrance.position };

      const poi = floor.pois.find((p) => p.id === id);
      if (poi) return { floorId: floor.id, position: poi.position };

      const node = floor.navigation.nodes.find((n) => n.id === id);
      if (node) return { floorId: floor.id, position: node.position };

      const edge = floor.navigation.edges.find((e) => e.id === id);
      if (edge) {
        const from = floor.navigation.nodes.find((n) => n.id === edge.from);
        const to = floor.navigation.nodes.find((n) => n.id === edge.to);
        if (from && to) return { floorId: floor.id, position: midpoint(from.position, to.position) };
      }
    }
  }
  return null;
}
