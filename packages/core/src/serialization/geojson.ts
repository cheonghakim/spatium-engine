import type { IndoorProject } from "../types/project.js";
import type { Point } from "../types/common.js";

export type GeoJSONPosition = [number, number];

export interface GeoJSONFeature {
  type: "Feature";
  geometry:
    | { type: "Point"; coordinates: GeoJSONPosition }
    | { type: "LineString"; coordinates: GeoJSONPosition[] }
    | { type: "Polygon"; coordinates: GeoJSONPosition[][] };
  properties: Record<string, unknown>;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

function toPosition(point: Point): GeoJSONPosition {
  return [point.x, point.y];
}

function toClosedRing(points: Point[]): GeoJSONPosition[] {
  const ring = points.map(toPosition);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push(first);
  }
  return ring;
}

/**
 * Converts the project to a flat GeoJSON FeatureCollection. Coordinates are
 * the project's local meter-based X/Y as-is — there is no geographic anchor
 * (lat/lon) in this data model yet, so this is not spatially referenced to
 * the earth. floorId/buildingId ride along as properties since GeoJSON has
 * no native concept of floors.
 */
export function projectToGeoJSON(project: IndoorProject): GeoJSONFeatureCollection {
  const features: GeoJSONFeature[] = [];

  for (const building of project.buildings) {
    for (const floor of building.floors) {
      for (const space of floor.spaces) {
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [toClosedRing(space.polygon)] },
          properties: {
            kind: "space",
            id: space.id,
            spaceType: space.type,
            stairDirection: space.stairDirection,
            stairSteps: space.stairSteps,
            height: space.height,
            ...space.properties,
            floorId: floor.id,
            floorName: floor.name,
            buildingId: building.id,
          },
        });
      }

      for (const wall of floor.walls) {
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [toPosition(wall.start), toPosition(wall.end)],
          },
          properties: {
            kind: "wall",
            id: wall.id,
            thickness: wall.thickness,
            height: wall.height,
            floorId: floor.id,
            buildingId: building.id,
          },
        });
      }

      for (const entrance of floor.entrances) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: toPosition(entrance.position) },
          properties: {
            kind: "entrance",
            id: entrance.id,
            entranceType: entrance.type,
            wallId: entrance.wallId,
            width: entrance.width,
            height: entrance.height,
            sillHeight: entrance.sillHeight,
            rotation: entrance.rotation,
            depth: entrance.depth,
            stepCount: entrance.stepCount,
            landingDepth: entrance.landingDepth,
            doorOpenAngle: entrance.doorOpenAngle,
            spaceA: entrance.spaceA,
            spaceB: entrance.spaceB,
            floorId: floor.id,
            buildingId: building.id,
          },
        });
      }

      for (const poi of floor.pois) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: toPosition(poi.position) },
          properties: {
            kind: "poi",
            id: poi.id,
            name: poi.name,
            poiType: poi.type,
            spaceId: poi.spaceId,
            floorId: floor.id,
            buildingId: building.id,
            ...poi.properties,
          },
        });
      }

      for (const item of floor.furniture) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: toPosition(item.position) },
          properties: {
            kind: "furniture",
            id: item.id,
            furnitureType: item.type,
            name: item.name,
            spaceId: item.spaceId,
            width: item.width,
            depth: item.depth,
            height: item.height,
            rotation: item.rotation,
            floorId: floor.id,
            buildingId: building.id,
          },
        });
      }

      for (const node of floor.navigation.nodes) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: toPosition(node.position) },
          properties: {
            kind: "navigationNode",
            id: node.id,
            nodeType: node.type,
            floorId: floor.id,
            buildingId: building.id,
          },
        });
      }

      const nodesById = new Map(floor.navigation.nodes.map((n) => [n.id, n]));
      for (const edge of floor.navigation.edges) {
        const from = nodesById.get(edge.from);
        const to = nodesById.get(edge.to);
        if (!from || !to) continue;
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [toPosition(from.position), toPosition(to.position)],
          },
          properties: {
            kind: "navigationEdge",
            id: edge.id,
            edgeType: edge.type,
            distance: edge.distance,
            accessible: edge.accessible,
            floorId: floor.id,
            buildingId: building.id,
          },
        });
      }
    }
  }

  return { type: "FeatureCollection", features };
}
