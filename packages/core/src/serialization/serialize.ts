import type { IndoorProject } from "../types/project.js";
import { migrateProjectData, SchemaVersionMismatchError } from "./migrations.js";
import { FURNITURE_PRESETS, isModelData } from "../types/furniture.js";

export { SchemaVersionMismatchError };

/**
 * Thrown by deserializeProject when the parsed JSON is syntactically valid
 * but doesn't have the shape of an IndoorProject (e.g. hand-edited or
 * corrupted project files, or data from an unrelated JSON document).
 */
export class InvalidProjectDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProjectDataError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPointLike(value: unknown): value is { x: number; y: number } {
  return isPlainObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

const CONNECTOR_TYPES = new Set(["elevator", "stairs", "escalator", "ramp"]);
const NAVIGATION_NODE_TYPES = new Set(["normal", "junction", "entrance", "stairs", "elevator"]);
const NAVIGATION_EDGE_TYPES = new Set(["walk", "stairs", "elevator", "escalator"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
const CONNECTOR_SPEC_KEYS = ["speed", "averageWait", "boardingTime", "capacity"] as const;
const ADDRESS_KEYS = ["address", "locality", "province", "country", "postalCode"] as const;

/** `names` / `externalId`, shared by every object that can carry them (schema 1.1.0+). */
function assertValidLabels(value: Record<string, unknown>, where: string): void {
  if (value.names !== undefined) {
    if (
      !isPlainObject(value.names) ||
      Object.values(value.names).some((text) => typeof text !== "string")
    ) {
      throw new InvalidProjectDataError(
        `${where} must have a "names" object of strings when present.`,
      );
    }
  }
  if (value.externalId !== undefined && typeof value.externalId !== "string") {
    throw new InvalidProjectDataError(`${where} must have a string "externalId" when present.`);
  }
}

function assertValidRing(ring: unknown, where: string): void {
  if (!Array.isArray(ring) || ring.some((vertex) => !isPointLike(vertex))) {
    throw new InvalidProjectDataError(`${where} must be an array of points with numeric x/y.`);
  }
}

function assertValidConnectorShape(connector: unknown, index: number, buildingId: unknown): void {
  const where = `Connector at index ${index} in building "${buildingId}"`;
  if (!isPlainObject(connector) || typeof connector.id !== "string") {
    throw new InvalidProjectDataError(`${where} must be an object with an "id" string.`);
  }
  if (typeof connector.type !== "string" || !CONNECTOR_TYPES.has(connector.type)) {
    throw new InvalidProjectDataError(`${where} must have a supported "type".`);
  }
  if (typeof connector.accessible !== "boolean") {
    throw new InvalidProjectDataError(`${where} must have a boolean "accessible".`);
  }
  if (connector.name !== undefined && typeof connector.name !== "string") {
    throw new InvalidProjectDataError(`${where} must have a string "name" when present.`);
  }
  if (
    connector.direction !== undefined &&
    connector.direction !== "up" &&
    connector.direction !== "down"
  ) {
    throw new InvalidProjectDataError(
      `${where} must have "direction" "up" or "down" when present.`,
    );
  }
  if (!Array.isArray(connector.stops)) {
    throw new InvalidProjectDataError(`${where} must have a "stops" array.`);
  }
  connector.stops.forEach((stop: unknown, stopIndex: number) => {
    if (
      !isPlainObject(stop) ||
      typeof stop.floorId !== "string" ||
      typeof stop.nodeId !== "string" ||
      (stop.spaceId !== undefined && typeof stop.spaceId !== "string")
    ) {
      throw new InvalidProjectDataError(
        `${where} has an invalid stop at index ${stopIndex} (needs "floorId" and "nodeId" strings).`,
      );
    }
  });
  if (connector.spec !== undefined) {
    if (!isPlainObject(connector.spec)) {
      throw new InvalidProjectDataError(`${where} must have a "spec" object when present.`);
    }
    const spec = connector.spec;
    for (const key of CONNECTOR_SPEC_KEYS) {
      const value = spec[key];
      if (value === undefined) continue;
      // speed/capacity must be positive; waiting/boarding time may be 0.
      const positive = key === "speed" || key === "capacity";
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        (positive && value === 0)
      ) {
        throw new InvalidProjectDataError(`${where} has an invalid spec "${key}".`);
      }
    }
  }
  assertValidLabels(connector, where);
}

const FLOOR_ARRAY_FIELDS = ["spaces", "walls", "entrances", "pois"] as const;

function assertValidSpaceShape(space: unknown, index: number, floorId: unknown): void {
  if (!isPlainObject(space) || typeof space.id !== "string") {
    throw new InvalidProjectDataError(
      `Space at index ${index} on floor "${floorId}" must be an object with an "id" string.`,
    );
  }
  if (!Array.isArray(space.polygon)) {
    throw new InvalidProjectDataError(
      `Space at index ${index} on floor "${floorId}" must have a "polygon" array.`,
    );
  }
  space.polygon.forEach((vertex, vertexIndex) => {
    if (!isPointLike(vertex)) {
      throw new InvalidProjectDataError(
        `Space at index ${index} on floor "${floorId}" has an invalid polygon vertex at index ${vertexIndex}.`,
      );
    }
  });
  if (typeof space.type !== "string") {
    throw new InvalidProjectDataError(
      `Space at index ${index} on floor "${floorId}" must have a "type" string.`,
    );
  }
  if (typeof space.floorId !== "string") {
    throw new InvalidProjectDataError(
      `Space at index ${index} on floor "${floorId}" must have a "floorId" string.`,
    );
  }
  if (typeof space.height !== "number" || !Number.isFinite(space.height)) {
    throw new InvalidProjectDataError(
      `Space at index ${index} on floor "${floorId}" must have a finite numeric "height".`,
    );
  }
  if (!isPlainObject(space.properties)) {
    throw new InvalidProjectDataError(
      `Space at index ${index} on floor "${floorId}" must have a "properties" object.`,
    );
  }
  assertValidLabels(space.properties, `Space at index ${index} on floor "${floorId}" properties`);
  if (space.holes !== undefined) {
    if (!Array.isArray(space.holes)) {
      throw new InvalidProjectDataError(
        `Space at index ${index} on floor "${floorId}" must have a "holes" array when present.`,
      );
    }
    space.holes.forEach((hole: unknown, holeIndex: number) =>
      assertValidRing(hole, `Space at index ${index} on floor "${floorId}" hole ${holeIndex}`),
    );
  }
}

function assertValidWallShape(wall: unknown, index: number, floorId: unknown): void {
  if (!isPlainObject(wall) || typeof wall.id !== "string") {
    throw new InvalidProjectDataError(
      `Wall at index ${index} on floor "${floorId}" must be an object with an "id" string.`,
    );
  }
  if (!isPointLike(wall.start) || !isPointLike(wall.end)) {
    throw new InvalidProjectDataError(
      `Wall at index ${index} on floor "${floorId}" must have "start" and "end" points with numeric x/y.`,
    );
  }
  if (typeof wall.thickness !== "number" || !Number.isFinite(wall.thickness)) {
    throw new InvalidProjectDataError(
      `Wall at index ${index} on floor "${floorId}" must have a finite numeric "thickness".`,
    );
  }
}

function assertValidEntranceShape(entrance: unknown, index: number, floorId: unknown): void {
  if (!isPlainObject(entrance) || typeof entrance.id !== "string") {
    throw new InvalidProjectDataError(
      `Entrance at index ${index} on floor "${floorId}" must be an object with an "id" string.`,
    );
  }
  if (typeof entrance.type !== "string") {
    throw new InvalidProjectDataError(
      `Entrance at index ${index} on floor "${floorId}" must have a "type" string.`,
    );
  }
  if (!isPointLike(entrance.position)) {
    throw new InvalidProjectDataError(
      `Entrance at index ${index} on floor "${floorId}" must have a "position" with numeric x/y.`,
    );
  }
}

function assertValidPOIShape(poi: unknown, index: number, floorId: unknown): void {
  if (!isPlainObject(poi) || typeof poi.id !== "string") {
    throw new InvalidProjectDataError(
      `POI at index ${index} on floor "${floorId}" must be an object with an "id" string.`,
    );
  }
  if (typeof poi.name !== "string") {
    throw new InvalidProjectDataError(
      `POI at index ${index} on floor "${floorId}" must have a "name" string.`,
    );
  }
  if (!isPointLike(poi.position)) {
    throw new InvalidProjectDataError(
      `POI at index ${index} on floor "${floorId}" must have a "position" with numeric x/y.`,
    );
  }
  assertValidLabels(poi, `POI at index ${index} on floor "${floorId}"`);
}

function assertValidFurnitureShape(item: unknown, index: number, floorId: unknown): void {
  if (!isPlainObject(item) || typeof item.id !== "string") {
    throw new InvalidProjectDataError(
      `Furniture at index ${index} on floor "${floorId}" must be an object with an "id" string.`,
    );
  }
  if (typeof item.type !== "string" || !Object.hasOwn(FURNITURE_PRESETS, item.type)) {
    throw new InvalidProjectDataError(
      `Furniture at index ${index} on floor "${floorId}" must have a supported "type".`,
    );
  }
  if (!isPointLike(item.position)) {
    throw new InvalidProjectDataError(
      `Furniture at index ${index} on floor "${floorId}" must have a "position" with numeric x/y.`,
    );
  }
  if ((item.type === "custom" || item.modelData !== undefined) && !isModelData(item.modelData)) {
    throw new InvalidProjectDataError(`Furniture at index ${index} has invalid embedded GLB data.`);
  }
  for (const key of ["width", "depth", "height", "rotation"] as const) {
    const value = item[key];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || (key !== "rotation" && value <= 0))
    ) {
      throw new InvalidProjectDataError(
        `Furniture at index ${index} on floor "${floorId}" has an invalid "${key}".`,
      );
    }
  }
}

function assertValidGroupShape(group: unknown, index: number, floorId: unknown): void {
  if (!isPlainObject(group) || typeof group.id !== "string") {
    throw new InvalidProjectDataError(
      `Group at index ${index} on floor "${floorId}" must be an object with an "id" string.`,
    );
  }
  if (typeof group.label !== "string") {
    throw new InvalidProjectDataError(
      `Group at index ${index} on floor "${floorId}" must have a "label" string.`,
    );
  }
  if (!Array.isArray(group.memberIds) || group.memberIds.some((m) => typeof m !== "string")) {
    throw new InvalidProjectDataError(
      `Group at index ${index} on floor "${floorId}" must have a "memberIds" array of strings.`,
    );
  }
}

function assertValidNavigationNodeShape(node: unknown, index: number, floorId: unknown): void {
  if (!isPlainObject(node) || typeof node.id !== "string") {
    throw new InvalidProjectDataError(
      `Navigation node at index ${index} on floor "${floorId}" must be an object with an "id" string.`,
    );
  }
  if (!isPointLike(node.position)) {
    throw new InvalidProjectDataError(
      `Navigation node at index ${index} on floor "${floorId}" must have a "position" with numeric x/y.`,
    );
  }
  if (typeof node.type !== "string" || !NAVIGATION_NODE_TYPES.has(node.type)) {
    throw new InvalidProjectDataError(
      `Navigation node at index ${index} on floor "${floorId}" must have a supported "type".`,
    );
  }
  if (node.floorId !== undefined && typeof node.floorId !== "string") {
    throw new InvalidProjectDataError(
      `Navigation node at index ${index} on floor "${floorId}" must have a string "floorId" when present.`,
    );
  }
  if (node.name !== undefined && typeof node.name !== "string") {
    throw new InvalidProjectDataError(
      `Navigation node at index ${index} on floor "${floorId}" must have a string "name" when present.`,
    );
  }
}

function assertValidNavigationEdgeShape(edge: unknown, index: number, floorId: unknown): void {
  if (!isPlainObject(edge) || typeof edge.id !== "string") {
    throw new InvalidProjectDataError(
      `Navigation edge at index ${index} on floor "${floorId}" must be an object with an "id" string.`,
    );
  }
  if (typeof edge.from !== "string" || typeof edge.to !== "string") {
    throw new InvalidProjectDataError(
      `Navigation edge at index ${index} on floor "${floorId}" must have "from" and "to" strings.`,
    );
  }
  if (typeof edge.distance !== "number" || !Number.isFinite(edge.distance) || edge.distance < 0) {
    // Negative costs break shortest-path search (Dijkstra/A* assume non-negative weights).
    throw new InvalidProjectDataError(
      `Navigation edge at index ${index} on floor "${floorId}" must have a non-negative, finite numeric "distance".`,
    );
  }
  if (
    edge.type !== undefined &&
    (typeof edge.type !== "string" || !NAVIGATION_EDGE_TYPES.has(edge.type))
  ) {
    throw new InvalidProjectDataError(
      `Navigation edge at index ${index} on floor "${floorId}" must have a supported "type".`,
    );
  }
  if (edge.accessible !== undefined && typeof edge.accessible !== "boolean") {
    throw new InvalidProjectDataError(
      `Navigation edge at index ${index} on floor "${floorId}" must have a boolean "accessible".`,
    );
  }
  if (edge.oneWay !== undefined && typeof edge.oneWay !== "boolean") {
    throw new InvalidProjectDataError(
      `Navigation edge at index ${index} on floor "${floorId}" must have a boolean "oneWay" when present.`,
    );
  }
}

function assertValidFloorShape(floor: unknown): void {
  if (!isPlainObject(floor)) {
    throw new InvalidProjectDataError("Each floor must be an object.");
  }
  if (!isNonEmptyString(floor.id)) {
    throw new InvalidProjectDataError('Each floor must have a non-empty "id" string.');
  }
  if (typeof floor.name !== "string") {
    throw new InvalidProjectDataError(`Floor "${floor.id}" must have a "name" string.`);
  }
  for (const key of ["level", "elevation"] as const) {
    if (typeof floor[key] !== "number" || !Number.isFinite(floor[key])) {
      throw new InvalidProjectDataError(`Floor "${floor.id}" must have a finite numeric "${key}".`);
    }
  }
  for (const key of FLOOR_ARRAY_FIELDS) {
    if (!Array.isArray(floor[key])) {
      throw new InvalidProjectDataError(`Each floor must have a "${key}" array.`);
    }
  }

  const floorId = floor.id;
  assertValidLabels(floor, `Floor "${floorId}"`);
  (floor.spaces as unknown[]).forEach((space, i) => assertValidSpaceShape(space, i, floorId));
  (floor.walls as unknown[]).forEach((wall, i) => assertValidWallShape(wall, i, floorId));
  (floor.entrances as unknown[]).forEach((entrance, i) =>
    assertValidEntranceShape(entrance, i, floorId),
  );
  (floor.pois as unknown[]).forEach((poi, i) => assertValidPOIShape(poi, i, floorId));

  // Furniture is deliberately NOT in FLOOR_ARRAY_FIELDS: it was added after
  // the current schema version, so projects saved before it exist have no
  // "furniture" key at all. Validate it only when present; deserializeProject
  // backfills a missing array to `[]` once the shape check passes, so this
  // stays a purely additive, backward-compatible field.
  if (floor.furniture !== undefined) {
    if (!Array.isArray(floor.furniture)) {
      throw new InvalidProjectDataError(
        `Each floor's "furniture", when present, must be an array.`,
      );
    }
    (floor.furniture as unknown[]).forEach((item, i) =>
      assertValidFurnitureShape(item, i, floorId),
    );
  }

  // Same backward-compat story as `furniture` above.
  if (floor.groups !== undefined) {
    if (!Array.isArray(floor.groups)) {
      throw new InvalidProjectDataError(`Each floor's "groups", when present, must be an array.`);
    }
    (floor.groups as unknown[]).forEach((group, i) => assertValidGroupShape(group, i, floorId));
  }

  assertValidNavigationShape(floor.navigation, "floor", floorId);
}

function assertValidNavigationShape(navigation: unknown, owner: string, ownerId: unknown): void {
  if (!isPlainObject(navigation)) {
    throw new InvalidProjectDataError(`Each ${owner} must have a "navigation" object.`);
  }
  const { nodes, edges } = navigation;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new InvalidProjectDataError(
      `Each ${owner}'s "navigation" must have "nodes" and "edges" arrays.`,
    );
  }
  nodes.forEach((node, i) => assertValidNavigationNodeShape(node, i, ownerId));
  edges.forEach((edge, i) => assertValidNavigationEdgeShape(edge, i, ownerId));
}

function assertValidSiteShape(site: unknown): void {
  if (!isPlainObject(site) || typeof site.id !== "string" || typeof site.name !== "string") {
    throw new InvalidProjectDataError('"site", when present, must have "id" and "name" strings.');
  }
  assertValidLabels(site, "Site");
  if (site.geoAnchor !== undefined) {
    const anchor = site.geoAnchor;
    if (
      !isPlainObject(anchor) ||
      typeof anchor.longitude !== "number" ||
      typeof anchor.latitude !== "number" ||
      !(Math.abs(anchor.longitude) <= 180) ||
      !(Math.abs(anchor.latitude) <= 90)
    ) {
      throw new InvalidProjectDataError(
        'Site "geoAnchor" must have "longitude" in [-180, 180] and "latitude" in [-90, 90].',
      );
    }
  }
  if (site.address !== undefined) {
    const address = site.address;
    if (
      !isPlainObject(address) ||
      ADDRESS_KEYS.some((key) => address[key] !== undefined && typeof address[key] !== "string")
    ) {
      throw new InvalidProjectDataError('Site "address" fields must be strings when present.');
    }
  }
  assertValidNavigationShape(site.navigation, "site", site.id);
}

function assertValidBuildingShape(building: unknown): void {
  if (!isPlainObject(building)) {
    throw new InvalidProjectDataError("Each building must be an object.");
  }
  const { id, name, floors } = building;
  if (!isNonEmptyString(id) || typeof name !== "string") {
    throw new InvalidProjectDataError(
      'Each building must have a non-empty "id" and a "name" string.',
    );
  }
  if (!Array.isArray(floors)) {
    throw new InvalidProjectDataError('Each building must have a "floors" array.');
  }
  const where = `Building "${id}"`;
  assertValidLabels(building, where);
  if (building.placement !== undefined) {
    const { placement } = building;
    if (
      !isPlainObject(placement) ||
      !isPointLike(placement.origin) ||
      typeof placement.bearing !== "number" ||
      !Number.isFinite(placement.bearing)
    ) {
      throw new InvalidProjectDataError(
        `${where} "placement" must have an "origin" point and a finite numeric "bearing".`,
      );
    }
  }
  if (building.footprint !== undefined) {
    assertValidRing(building.footprint, `${where} "footprint"`);
  }
  if (building.connectors !== undefined) {
    if (!Array.isArray(building.connectors)) {
      throw new InvalidProjectDataError(`${where} "connectors", when present, must be an array.`);
    }
    building.connectors.forEach((connector: unknown, i: number) =>
      assertValidConnectorShape(connector, i, id),
    );
  }
  for (const floor of floors) {
    assertValidFloorShape(floor);
  }
}

/**
 * Structural guard run before the project is trusted as an IndoorProject.
 * Hand-rolled rather than a schema-validation dependency — this package
 * ships inside exported standalone apps, where bundle size matters.
 */
function assertValidProjectShape(data: unknown): asserts data is IndoorProject {
  if (!isPlainObject(data)) {
    throw new InvalidProjectDataError("Project data must be a non-null object.");
  }
  const { buildings, schemaVersion } = data;
  if (!Array.isArray(buildings)) {
    throw new InvalidProjectDataError('Project data is missing a "buildings" array.');
  }
  for (const building of buildings) {
    assertValidBuildingShape(building);
  }
  if (data.site !== undefined) {
    assertValidSiteShape(data.site);
  }
  if (typeof schemaVersion !== "string") {
    throw new InvalidProjectDataError('Project data is missing a "schemaVersion" string.');
  }
  assertUniqueIds(data as unknown as IndoorProject);
}

/**
 * Ids that other data and the routing graph look objects up by must be
 * unique project-wide: buildings, floors (the site's id shares their
 * namespace, as outdoor nodes use it as their floorId) and navigation nodes
 * (all floors and the site merge into one routing graph).
 */
function assertUniqueIds(project: IndoorProject): void {
  const check = (seen: Set<string>, id: string, what: string): void => {
    if (seen.has(id)) throw new InvalidProjectDataError(`Duplicate ${what} id "${id}".`);
    seen.add(id);
  };
  const buildings = new Set<string>();
  const planes = new Set<string>();
  const nodes = new Set<string>();
  for (const building of project.buildings) {
    check(buildings, building.id, "building");
    for (const floor of building.floors) {
      check(planes, floor.id, "floor");
      for (const node of floor.navigation.nodes) check(nodes, node.id, "navigation node");
    }
  }
  if (project.site) {
    check(planes, project.site.id, "site/floor");
    for (const node of project.site.navigation.nodes) check(nodes, node.id, "navigation node");
  }
}

export function serializeProject(project: IndoorProject): string {
  return JSON.stringify(project, null, 2);
}

/**
 * Fills in fields that are always present in memory but may be absent on
 * disk because they were added as optional within the same schema version
 * (purely additive changes that didn't warrant a version bump). Distinct
 * from migrations, which move data *between* schema versions.
 */
function normalizeProject(project: IndoorProject): IndoorProject {
  for (const building of project.buildings) {
    for (const floor of building.floors) {
      if (floor.furniture === undefined) floor.furniture = [];
      if (floor.groups === undefined) floor.groups = [];
      normalizeNavigation(floor.navigation, floor.id);
    }
  }
  if (project.site) normalizeNavigation(project.site.navigation, project.site.id);
  return project;
}

/**
 * A node's floorId always names the plane that stores it (routing and
 * rendering rely on it); edge `type`/`accessible` default to a plain,
 * accessible walk when a hand-written file omits them.
 */
function normalizeNavigation(
  navigation: IndoorProject["buildings"][number]["floors"][number]["navigation"],
  planeId: string,
): void {
  for (const node of navigation.nodes) {
    if (node.floorId !== planeId) node.floorId = planeId;
  }
  for (const edge of navigation.edges) {
    if (edge.type === undefined) edge.type = "walk";
    if (edge.accessible === undefined) edge.accessible = true;
  }
}

/**
 * Parses project JSON. Older schema versions are upgraded through the
 * registered migrations (see migrations.ts) before validation. Throws:
 *  - a native SyntaxError if the string isn't valid JSON at all;
 *  - InvalidProjectDataError if it parses but doesn't have the shape of an
 *    IndoorProject;
 *  - SchemaVersionMismatchError if the stored schemaVersion is newer than
 *    this build understands, or older with no migration path to it.
 */
export function deserializeProject(json: string): IndoorProject {
  const data: unknown = JSON.parse(json);
  if (!isPlainObject(data)) {
    throw new InvalidProjectDataError("Project data must be a non-null object.");
  }
  if (typeof data.schemaVersion !== "string") {
    throw new InvalidProjectDataError('Project data is missing a "schemaVersion" string.');
  }
  const migrated = migrateProjectData(data as Record<string, unknown> & { schemaVersion: string });
  assertValidProjectShape(migrated);
  return normalizeProject(migrated);
}
