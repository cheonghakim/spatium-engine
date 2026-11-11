import type { Point } from "../types/common.js";
import type { BuildingPlacement } from "../types/project.js";
import type { GeoAnchor } from "../types/site.js";

/** [longitude, latitude] in degrees (WGS84), GeoJSON axis order. */
export type LngLat = [number, number];

/** WGS84 ellipsoid. */
const WGS84_A = 6378137;
const WGS84_E2 = 6.69437999014e-3;

const DEG = Math.PI / 180;

/**
 * Building-local → site-local (docs/design/0001 §2). The building's local +Y
 * axis points `bearing` degrees clockwise from north; site-local is +X east,
 * +Y north. No placement = identity.
 */
export function buildingToSite(building: { placement?: BuildingPlacement }, point: Point): Point {
  const placement = building.placement;
  if (!placement) return { x: point.x, y: point.y };
  // Clockwise by `bearing` = counter-clockwise by -bearing.
  const angle = -placement.bearing * DEG;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: placement.origin.x + point.x * cos - point.y * sin,
    y: placement.origin.y + point.x * sin + point.y * cos,
  };
}

/** Site-local → building-local; inverse of buildingToSite. */
export function siteToBuilding(building: { placement?: BuildingPlacement }, point: Point): Point {
  const placement = building.placement;
  if (!placement) return { x: point.x, y: point.y };
  const angle = placement.bearing * DEG;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - placement.origin.x;
  const dy = point.y - placement.origin.y;
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/** Meters per radian of latitude (meridian radius) and of longitude at `latitude`. */
function radii(latitude: number): { north: number; east: number } {
  const phi = latitude * DEG;
  const s = Math.sin(phi);
  const w = 1 - WGS84_E2 * s * s;
  const meridian = (WGS84_A * (1 - WGS84_E2)) / (w * Math.sqrt(w));
  const primeVertical = WGS84_A / Math.sqrt(w);
  return { north: meridian, east: primeVertical * Math.cos(phi) };
}

/**
 * Site-local meters → WGS84, using a local tangent plane at the anchor. Over a
 * campus (a few km) the error stays at the centimeter level, without pulling a
 * projection library into the SDK.
 */
export function siteToLngLat(site: { geoAnchor?: GeoAnchor }, point: Point): LngLat {
  const anchor = requireAnchor(site);
  const { north, east } = radii(anchor.latitude);
  return [anchor.longitude + point.x / east / DEG, anchor.latitude + point.y / north / DEG];
}

/** WGS84 → site-local meters; inverse of siteToLngLat. */
export function lngLatToSite(site: { geoAnchor?: GeoAnchor }, lngLat: LngLat): Point {
  const anchor = requireAnchor(site);
  const { north, east } = radii(anchor.latitude);
  return {
    x: (lngLat[0] - anchor.longitude) * DEG * east,
    y: (lngLat[1] - anchor.latitude) * DEG * north,
  };
}

function requireAnchor(site: { geoAnchor?: GeoAnchor }): GeoAnchor {
  if (!site.geoAnchor) {
    throw new Error("Site has no geoAnchor; set one to convert to WGS84.");
  }
  return site.geoAnchor;
}
