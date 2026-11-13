import type { LocalizedText } from "./common.js";
import type { NavigationGraph } from "./navigation.js";

/** WGS84 position of the site's local origin (0, 0). */
export interface GeoAnchor {
  longitude: number;
  latitude: number;
}

/** Postal address — maps onto IMDF's address feature. */
export interface SiteAddress {
  address?: string;
  locality?: string;
  province?: string;
  /** ISO 3166-1 alpha-2, e.g. "KR". */
  country?: string;
  postalCode?: string;
}

/**
 * The campus/venue the project's buildings sit in. Site-local coordinates are
 * meters with +X east and +Y north; buildings are placed into it through
 * Building.placement.
 */
export interface Site {
  id: string;
  name: string;
  names?: LocalizedText;
  externalId?: string;
  geoAnchor?: GeoAnchor;
  address?: SiteAddress;
  /**
   * Outdoor walking graph in site-local coordinates. Outdoor nodes use the
   * site's own id as their floorId, so "same floorId = same coordinate plane"
   * keeps holding for pathfinding. Edges linking a building's entrance node to
   * an outdoor node are stored here too.
   */
  navigation: NavigationGraph;
}
