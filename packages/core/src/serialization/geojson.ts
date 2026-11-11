import type { Building, IndoorProject } from "../types/project.js";
import type { Point } from "../types/common.js";
import type { NavigationGraph } from "../types/navigation.js";
import { buildingToSite, siteToLngLat } from "../geometry/georeference.js";
import { polygonArea } from "../geometry/polygon.js";

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

/**
 * Output coordinate frame (docs/design/0001 §2):
 *  - "local": each building's own meters, as stored (no georeference).
 *  - "site": site-local meters (+X east, +Y north) via Building.placement.
 *  - "wgs84": [longitude, latitude] via Building.placement + Site.geoAnchor.
 *  - "auto" (default): "wgs84" when the project's site has a geoAnchor, else "local".
 */
export type GeoJSONCoordinateMode = "auto" | "local" | "site" | "wgs84";

export interface GeoJSONExportOptions {
  coordinates?: GeoJSONCoordinateMode;
}

type Project = (point: Point) => GeoJSONPosition;

/** Ring as GeoJSON wants it: closed, outer counter-clockwise, holes clockwise (RFC 7946 §3.1.6). */
function toRing(points: Point[], project: Project, clockwise: boolean): GeoJSONPosition[] {
  // Winding is decided in the input frame: placement is a rotation (keeps
  // winding) and the WGS84 tangent plane keeps east/north orientation.
  const ccw = polygonArea(points) > 0;
  const ordered = ccw === clockwise ? [...points].reverse() : points;
  const ring = ordered.map(project);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push(first);
  }
  return ring;
}

function resolveMode(project: IndoorProject, mode: GeoJSONCoordinateMode): GeoJSONCoordinateMode {
  if (mode === "auto") return project.site?.geoAnchor ? "wgs84" : "local";
  if (mode === "wgs84" && !project.site?.geoAnchor) {
    throw new Error('GeoJSON "wgs84" output needs project.site.geoAnchor.');
  }
  return mode;
}

function projector(
  project: IndoorProject,
  mode: GeoJSONCoordinateMode,
  building: Building | null,
): Project {
  const toSite = (p: Point): Point => (building ? buildingToSite(building, p) : p);
  switch (mode) {
    case "wgs84":
      return (p) => siteToLngLat(project.site!, toSite(p));
    case "site":
      return (p) => {
        const q = toSite(p);
        return [q.x, q.y];
      };
    default:
      return (p) => [p.x, p.y];
  }
}

function navigationFeatures(
  graph: NavigationGraph,
  project: Project,
  extra: Record<string, unknown>,
  lookup: ReadonlyMap<string, Point>,
): GeoJSONFeature[] {
  const features: GeoJSONFeature[] = [];
  for (const node of graph.nodes) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: project(node.position) },
      properties: { kind: "navigationNode", id: node.id, nodeType: node.type, ...extra },
    });
  }
  for (const edge of graph.edges) {
    const from = lookup.get(edge.from);
    const to = lookup.get(edge.to);
    if (!from || !to) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [project(from), project(to)] },
      properties: {
        kind: "navigationEdge",
        id: edge.id,
        edgeType: edge.type,
        distance: edge.distance,
        accessible: edge.accessible,
        ...(edge.oneWay ? { oneWay: true } : {}),
        ...extra,
      },
    });
  }
  return features;
}

/**
 * Converts the project to a flat GeoJSON FeatureCollection. GeoJSON has no
 * floors, so floorId/buildingId ride along as properties. See
 * GeoJSONCoordinateMode for the coordinate frame; with a geoAnchor the output
 * is real WGS84 and lines up with web maps.
 *
 * Spaces with holes become Polygons with interior rings. The site's outdoor
 * graph is included with `siteId` instead of floor/building ids.
 */
export function projectToGeoJSON(
  project: IndoorProject,
  options: GeoJSONExportOptions = {},
): GeoJSONFeatureCollection {
  const mode = resolveMode(project, options.coordinates ?? "auto");
  const features: GeoJSONFeature[] = [];

  for (const building of project.buildings) {
    const toPos = projector(project, mode, building);
    for (const floor of building.floors) {
      for (const space of floor.spaces) {
        features.push({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              toRing(space.polygon, toPos, false),
              ...(space.holes ?? [])
                .filter((hole) => hole.length >= 3)
                .map((hole) => toRing(hole, toPos, true)),
            ],
          },
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
            coordinates: [toPos(wall.start), toPos(wall.end)],
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
          geometry: { type: "Point", coordinates: toPos(entrance.position) },
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
          geometry: { type: "Point", coordinates: toPos(poi.position) },
          properties: {
            kind: "poi",
            id: poi.id,
            name: poi.name,
            ...(poi.names ? { names: poi.names } : {}),
            ...(poi.externalId ? { externalId: poi.externalId } : {}),
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
          geometry: { type: "Point", coordinates: toPos(item.position) },
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

      const lookup = new Map<string, Point>();
      for (const node of floor.navigation.nodes) lookup.set(node.id, node.position);
      features.push(
        ...navigationFeatures(
          floor.navigation,
          toPos,
          { floorId: floor.id, buildingId: building.id },
          lookup,
        ),
      );
    }
  }

  if (project.site) {
    const site = project.site;
    // Site edges may end on a building node (entrance links); resolve those
    // through their building's placement so the line meets the right spot.
    const lookup = new Map<string, Point>();
    for (const node of site.navigation.nodes) lookup.set(node.id, node.position);
    for (const building of project.buildings) {
      for (const floor of building.floors) {
        for (const node of floor.navigation.nodes) {
          if (!lookup.has(node.id)) lookup.set(node.id, buildingToSite(building, node.position));
        }
      }
    }
    features.push(
      ...navigationFeatures(
        site.navigation,
        projector(project, mode, null),
        { siteId: site.id },
        lookup,
      ),
    );
  }

  return { type: "FeatureCollection", features };
}
