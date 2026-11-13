import { buildingToSite, siteToLngLat, type LngLat } from "../geometry/georeference.js";
import { convexHull, isPointInSpace, polygonArea, polygonCentroid } from "../geometry/polygon.js";
import type { ConnectorType } from "../types/connector.js";
import type { LocalizedText, Point } from "../types/common.js";
import type { POIType } from "../types/poi.js";
import type { Building, Floor, IndoorProject } from "../types/project.js";
import type { Space, SpaceType } from "../types/space.js";
import { createZip } from "./zip.js";

/**
 * IMDF (Indoor Mapping Data Format 1.0) export — docs/design/0001 §7.
 *
 * Produces one GeoJSON file per feature type plus manifest.json. Geometry is
 * WGS84, so the project needs `site.geoAnchor`; each building is placed
 * through `Building.placement`. Anything that can't be mapped cleanly is
 * reported in `issues` instead of being silently dropped or invented.
 */

export interface IMDFExportOptions {
  /** Language tag for names (`name` → this key; `names` are merged in). Default "ko". */
  language?: string;
  /** IMDF venue category. Default "businesscampus". */
  venueCategory?: string;
  /** manifest.json `created`. Default now. */
  created?: Date;
  /** manifest.json `generated_by`. Default "Spatium Engine". */
  generatedBy?: string;
}

export interface IMDFIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  objectId?: string;
}

export interface IMDFFile {
  path: string;
  contents: string;
}

export interface IMDFExportResult {
  /** Empty when an error made export impossible (see issues). */
  files: IMDFFile[];
  issues: IMDFIssue[];
}

type Geometry =
  | { type: "Point"; coordinates: LngLat }
  | { type: "LineString"; coordinates: LngLat[] }
  | { type: "Polygon"; coordinates: LngLat[][] }
  | null;

interface IMDFFeature {
  id: string;
  type: "Feature";
  feature_type: string;
  geometry: Geometry;
  properties: Record<string, unknown>;
}

/** SpaceType → IMDF unit category. Stores are rooms; tenants (occupants) aren't exported yet. */
export const IMDF_UNIT_CATEGORY: Record<SpaceType, string> = {
  room: "room",
  store: "room",
  corridor: "walkway",
  lobby: "lobby",
  stairs: "stairs",
  elevator: "elevator",
  restricted: "nonpublic",
  unknown: "unspecified",
};

/** POIType → IMDF amenity category. Types without a clear counterpart map to "unspecified". */
export const IMDF_AMENITY_CATEGORY: Record<POIType, string> = {
  restroom: "restroom",
  elevator: "elevator",
  stairs: "stairs",
  information: "information",
  store: "unspecified",
  exit: "unspecified",
  custom: "unspecified",
};

const RELATIONSHIP_CATEGORY: Record<ConnectorType, string> = {
  elevator: "elevator",
  escalator: "escalator",
  stairs: "stairs",
  ramp: "ramp",
};

/** Default opening widths (m) when an entrance has none. */
const DEFAULT_OPENING_WIDTH = { door: 0.9, opening: 1.2 } as const;

/**
 * Stable UUID-shaped id derived from a string, so re-exporting the same
 * project yields the same IMDF ids (diffable deliveries).
 */
export function stableUuid(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0xdeadbeef;
  let h4 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
    h3 = Math.imul(h3 ^ c, 0xc2b2ae35);
    h4 = Math.imul(h4 ^ c, 0x27d4eb2f);
  }
  const mix = (h: number, k: number): number => {
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b ^ k);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const hex = [mix(h1, h4), mix(h2, h1), mix(h3, h2), mix(h4, h3)]
    .map((n) => n.toString(16).padStart(8, "0"))
    .join("");
  // Version 5 / RFC 4122 variant bits, so strict UUID validators accept it.
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function labels(name: string | undefined, names: LocalizedText | undefined, language: string) {
  const out: Record<string, string> = {};
  if (name?.trim()) out[language] = name.trim();
  for (const [lang, text] of Object.entries(names ?? {})) if (text.trim()) out[lang] = text.trim();
  return Object.keys(out).length ? out : null;
}

/** Closed ring, outer counter-clockwise or hole clockwise (RFC 7946). */
function ring(points: Point[], project: (p: Point) => LngLat, clockwise: boolean): LngLat[] {
  const ccw = polygonArea(points) > 0;
  const ordered = ccw === clockwise ? [...points].reverse() : points;
  const out = ordered.map(project);
  out.push(out[0]!);
  return out;
}

function point(coordinates: LngLat): { type: "Point"; coordinates: LngLat } {
  return { type: "Point", coordinates };
}

function collection(features: IMDFFeature[]): string {
  return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
}

/** Ground floor = ordinal 0. With a level 0 in use, levels are ordinals as-is; else 1F → 0, B1 (-1) → -1. */
function ordinalOf(floors: readonly Floor[]): (floor: Floor) => number {
  const zeroBased = floors.some((f) => f.level === 0);
  return (floor) => (zeroBased || floor.level < 1 ? floor.level : floor.level - 1);
}

export function projectToIMDF(
  project: IndoorProject,
  options: IMDFExportOptions = {},
): IMDFExportResult {
  const issues: IMDFIssue[] = [];
  const language = options.language ?? "ko";
  const site = project.site;
  if (!site?.geoAnchor) {
    issues.push({
      severity: "error",
      code: "missing-geo-anchor",
      message: "IMDF needs WGS84 coordinates: set project.site.geoAnchor.",
    });
    return { files: [], issues };
  }
  const toLngLat =
    (building: Building) =>
    (p: Point): LngLat =>
      siteToLngLat(site, buildingToSite(building, p));

  const addresses: IMDFFeature[] = [];
  const venues: IMDFFeature[] = [];
  const buildings: IMDFFeature[] = [];
  const footprints: IMDFFeature[] = [];
  const levels: IMDFFeature[] = [];
  const units: IMDFFeature[] = [];
  const openings: IMDFFeature[] = [];
  const amenities: IMDFFeature[] = [];
  const relationships: IMDFFeature[] = [];

  let addressId: string | null = null;
  if (site.address && Object.values(site.address).some((v) => v)) {
    addressId = stableUuid(`address:${site.id}`);
    const a = site.address;
    addresses.push({
      id: addressId,
      type: "Feature",
      feature_type: "address",
      geometry: null,
      properties: {
        address: a.address ?? null,
        unit: null,
        locality: a.locality ?? null,
        province: a.province ?? null,
        country: a.country ?? null,
        postal_code: a.postalCode ?? null,
        postal_code_ext: null,
        postal_code_vanity: null,
      },
    });
    if (!a.address || !a.locality || !a.country) {
      issues.push({
        severity: "warning",
        code: "incomplete-address",
        message: "IMDF addresses need address, locality and country.",
      });
    }
  } else {
    issues.push({
      severity: "error",
      code: "missing-address",
      message: "IMDF venues need an address: set project.site.address.",
    });
  }

  const venueOutline: Point[] = [];
  const unitIdOf = (spaceId: string) => stableUuid(`unit:${spaceId}`);

  for (const building of project.buildings) {
    const toWorld = toLngLat(building);
    const buildingId = stableUuid(`building:${building.id}`);
    const allVertices = building.floors.flatMap((f) => f.spaces.flatMap((s) => s.polygon));
    let outline = building.footprint && building.footprint.length >= 3 ? building.footprint : null;
    if (!outline) {
      outline = convexHull(allVertices);
      if (outline.length >= 3) {
        issues.push({
          severity: "warning",
          code: "approximated-footprint",
          message: `Building "${building.name}" has no footprint; using the convex hull of its spaces.`,
          objectId: building.id,
        });
      }
    }
    const hasOutline = outline.length >= 3;
    if (hasOutline) venueOutline.push(...outline.map((p) => buildingToSite(building, p)));

    buildings.push({
      id: buildingId,
      type: "Feature",
      feature_type: "building",
      geometry: null,
      properties: {
        name: labels(building.name, building.names, language),
        alt_name: null,
        category: "unspecified",
        restriction: null,
        display_point: hasOutline ? point(toWorld(polygonCentroid(outline))) : null,
        address_id: addressId,
      },
    });

    if (hasOutline) {
      footprints.push({
        id: stableUuid(`footprint:${building.id}`),
        type: "Feature",
        feature_type: "footprint",
        geometry: { type: "Polygon", coordinates: [ring(outline, toWorld, false)] },
        properties: { category: "ground", name: null, building_ids: [buildingId] },
      });
    } else {
      issues.push({
        severity: "error",
        code: "missing-footprint",
        message: `Building "${building.name}" has no footprint and no spaces to derive one from.`,
        objectId: building.id,
      });
    }

    const ordinal = ordinalOf(building.floors);
    for (const floor of building.floors) {
      const levelId = stableUuid(`level:${floor.id}`);
      const levelOutline = convexHull(floor.spaces.flatMap((s) => s.polygon));
      if (levelOutline.length < 3) {
        issues.push({
          severity: "warning",
          code: "empty-level",
          message: `Floor "${floor.name}" has no spaces; skipped (IMDF levels need a geometry).`,
          objectId: floor.id,
        });
        continue;
      }
      levels.push({
        id: levelId,
        type: "Feature",
        feature_type: "level",
        geometry: { type: "Polygon", coordinates: [ring(levelOutline, toWorld, false)] },
        properties: {
          category: "unspecified",
          restriction: null,
          ordinal: ordinal(floor),
          outdoor: false,
          name: labels(floor.name, floor.names, language),
          short_name: labels(floor.name, undefined, language),
          display_point: point(toWorld(polygonCentroid(levelOutline))),
          address_id: null,
          building_ids: [buildingId],
        },
      });

      for (const space of floor.spaces) {
        if (space.polygon.length < 3) continue;
        units.push({
          id: unitIdOf(space.id),
          type: "Feature",
          feature_type: "unit",
          geometry: {
            type: "Polygon",
            coordinates: [
              ring(space.polygon, toWorld, false),
              ...(space.holes ?? [])
                .filter((hole) => hole.length >= 3)
                .map((hole) => ring(hole, toWorld, true)),
            ],
          },
          properties: {
            category: IMDF_UNIT_CATEGORY[space.type],
            restriction: space.type === "restricted" ? "restricted" : null,
            accessibility: null,
            name: labels(space.properties.name, space.properties.names, language),
            alt_name: null,
            level_id: levelId,
            display_point: point(toWorld(polygonCentroid(space.polygon))),
          },
        });
      }

      for (const entrance of floor.entrances) {
        if (entrance.type !== "door" && entrance.type !== "opening") continue;
        const width = entrance.width ?? DEFAULT_OPENING_WIDTH[entrance.type];
        const wall = floor.walls.find((w) => w.id === entrance.wallId);
        let dx: number;
        let dy: number;
        if (wall) {
          const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) || 1;
          dx = (wall.end.x - wall.start.x) / length;
          dy = (wall.end.y - wall.start.y) / length;
        } else {
          const angle = ((entrance.rotation ?? 0) * Math.PI) / 180;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
        }
        const half = width / 2;
        const { x, y } = entrance.position;
        openings.push({
          id: stableUuid(`opening:${entrance.id}`),
          type: "Feature",
          feature_type: "opening",
          geometry: {
            type: "LineString",
            coordinates: [
              toWorld({ x: x - dx * half, y: y - dy * half }),
              toWorld({ x: x + dx * half, y: y + dy * half }),
            ],
          },
          properties: {
            category: "pedestrian",
            accessibility: null,
            access_control: null,
            door:
              entrance.type === "door"
                ? { type: "swinging", automatic: false, material: null }
                : null,
            name: null,
            alt_name: null,
            display_point: point(toWorld(entrance.position)),
            level_id: levelId,
          },
        });
      }

      for (const poi of floor.pois) {
        const space =
          floor.spaces.find((s) => s.id === poi.spaceId) ??
          floor.spaces.find((s) => isPointInSpace(s, poi.position));
        if (!space) {
          issues.push({
            severity: "warning",
            code: "amenity-without-unit",
            message: `POI "${poi.name}" is not inside any space; IMDF amenities need a unit.`,
            objectId: poi.id,
          });
        }
        if (poi.type === "store") {
          issues.push({
            severity: "warning",
            code: "store-as-amenity",
            message: `Store "${poi.name}" is exported as an "unspecified" amenity; IMDF occupants are not supported yet.`,
            objectId: poi.id,
          });
        }
        amenities.push({
          id: stableUuid(`amenity:${poi.id}`),
          type: "Feature",
          feature_type: "amenity",
          geometry: point(toWorld(poi.position)),
          properties: {
            category: IMDF_AMENITY_CATEGORY[poi.type],
            accessibility: null,
            name: labels(poi.name, poi.names, language),
            alt_name: null,
            hours: null,
            phone: null,
            website: null,
            unit_ids: space ? [unitIdOf(space.id)] : [],
            address_id: null,
            correlation_id: poi.externalId ?? null,
          },
        });
      }
    }

    for (const connector of building.connectors ?? []) {
      const stops = connector.stops
        .map((stop) => {
          const floor = building.floors.find((f) => f.id === stop.floorId);
          const node = floor?.navigation.nodes.find((n) => n.id === stop.nodeId);
          const space: Space | undefined =
            floor?.spaces.find((s) => s.id === stop.spaceId) ??
            (node ? floor?.spaces.find((s) => isPointInSpace(s, node.position)) : undefined);
          return floor && space ? { floor, space } : null;
        })
        .filter((s): s is { floor: Floor; space: Space } => s !== null)
        .sort((a, b) => a.floor.elevation - b.floor.elevation || a.floor.level - b.floor.level);
      if (stops.length < 2) {
        issues.push({
          severity: "warning",
          code: "connector-without-units",
          message: `Connector "${connector.name ?? connector.id}" needs at least two stops inside spaces to become an IMDF relationship.`,
          objectId: connector.id,
        });
        continue;
      }
      const ref = (space: Space) => ({ id: unitIdOf(space.id), feature_type: "unit" });
      const base = {
        category: RELATIONSHIP_CATEGORY[connector.type],
        hours: null,
      };
      if (connector.type === "elevator") {
        relationships.push({
          id: stableUuid(`relationship:${connector.id}`),
          type: "Feature",
          feature_type: "relationship",
          geometry: null,
          properties: {
            ...base,
            direction: "undirected",
            origin: ref(stops[0]!.space),
            intermediary: stops.length > 2 ? stops.slice(1, -1).map((s) => ref(s.space)) : null,
            destination: ref(stops.at(-1)!.space),
          },
        });
        continue;
      }
      for (let i = 1; i < stops.length; i++) {
        const down = connector.type === "escalator" && connector.direction === "down";
        const [from, to] = down ? [stops[i]!, stops[i - 1]!] : [stops[i - 1]!, stops[i]!];
        relationships.push({
          id: stableUuid(`relationship:${connector.id}:${i}`),
          type: "Feature",
          feature_type: "relationship",
          geometry: null,
          properties: {
            ...base,
            direction:
              connector.type === "escalator" && connector.direction ? "directed" : "undirected",
            origin: ref(from.space),
            intermediary: null,
            destination: ref(to.space),
          },
        });
      }
    }
  }

  const venueHull = convexHull(venueOutline);
  if (venueHull.length < 3) {
    issues.push({
      severity: "error",
      code: "empty-venue",
      message: "No building footprints to derive the venue outline from.",
    });
    return { files: [], issues };
  }
  const siteProject = (p: Point): LngLat => siteToLngLat(site, p);
  venues.push({
    id: stableUuid(`venue:${site.id}`),
    type: "Feature",
    feature_type: "venue",
    geometry: { type: "Polygon", coordinates: [ring(venueHull, siteProject, false)] },
    properties: {
      category: options.venueCategory ?? "businesscampus",
      restriction: null,
      name: labels(site.name, site.names, language),
      alt_name: null,
      hours: null,
      phone: null,
      website: null,
      display_point: point(siteProject(polygonCentroid(venueHull))),
      address_id: addressId,
    },
  });

  const manifest = {
    version: "1.0.0",
    created: (options.created ?? new Date()).toISOString(),
    generated_by: options.generatedBy ?? "Spatium Engine",
    language,
  };

  const files: IMDFFile[] = [
    { path: "manifest.json", contents: JSON.stringify(manifest, null, 2) },
  ];
  const byType: Array<[string, IMDFFeature[]]> = [
    ["address", addresses],
    ["venue", venues],
    ["building", buildings],
    ["footprint", footprints],
    ["level", levels],
    ["unit", units],
    ["opening", openings],
    ["amenity", amenities],
    ["relationship", relationships],
  ];
  for (const [type, features] of byType) {
    if (features.length) files.push({ path: `${type}.geojson`, contents: collection(features) });
  }
  return { files, issues };
}

/** projectToIMDF packaged as a .zip (IMDF's delivery format). */
export function projectToIMDFArchive(
  project: IndoorProject,
  options: IMDFExportOptions = {},
): { archive: Uint8Array<ArrayBuffer> | null; issues: IMDFIssue[] } {
  const { files, issues } = projectToIMDF(project, options);
  return { archive: files.length ? createZip(files, options.created) : null, issues };
}
