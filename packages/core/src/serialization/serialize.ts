import type { IndoorProject } from "../types/project.js";
import { CURRENT_SCHEMA_VERSION } from "./schemaVersion.js";
import { FURNITURE_PRESETS, isModelData } from "../types/furniture.js";

export class SchemaVersionMismatchError extends Error {
  constructor(
    public readonly foundVersion: string,
    public readonly expectedVersion: string,
  ) {
    super(
      `Project schema version "${foundVersion}" does not match expected "${expectedVersion}". A migration step is required.`,
    );
    this.name = "SchemaVersionMismatchError";
  }
}

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
  if (typeof node.type !== "string") {
    throw new InvalidProjectDataError(
      `Navigation node at index ${index} on floor "${floorId}" must have a "type" string.`,
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
  if (typeof edge.distance !== "number" || !Number.isFinite(edge.distance)) {
    throw new InvalidProjectDataError(
      `Navigation edge at index ${index} on floor "${floorId}" must have a finite numeric "distance".`,
    );
  }
}

function assertValidFloorShape(floor: unknown): void {
  if (!isPlainObject(floor)) {
    throw new InvalidProjectDataError("Each floor must be an object.");
  }
  for (const key of FLOOR_ARRAY_FIELDS) {
    if (!Array.isArray(floor[key])) {
      throw new InvalidProjectDataError(`Each floor must have a "${key}" array.`);
    }
  }

  const floorId = floor.id;
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

  const { navigation } = floor;
  if (!isPlainObject(navigation)) {
    throw new InvalidProjectDataError('Each floor must have a "navigation" object.');
  }
  const { nodes, edges } = navigation;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new InvalidProjectDataError(
      'Each floor\'s "navigation" must have "nodes" and "edges" arrays.',
    );
  }
  nodes.forEach((node, i) => assertValidNavigationNodeShape(node, i, floorId));
  edges.forEach((edge, i) => assertValidNavigationEdgeShape(edge, i, floorId));
}

function assertValidBuildingShape(building: unknown): void {
  if (!isPlainObject(building)) {
    throw new InvalidProjectDataError("Each building must be an object.");
  }
  const { id, name, floors } = building;
  if (typeof id !== "string" || typeof name !== "string") {
    throw new InvalidProjectDataError('Each building must have an "id" and "name" string.');
  }
  if (!Array.isArray(floors)) {
    throw new InvalidProjectDataError('Each building must have a "floors" array.');
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
  if (typeof schemaVersion !== "string") {
    throw new InvalidProjectDataError('Project data is missing a "schemaVersion" string.');
  }
}

export function serializeProject(project: IndoorProject): string {
  return JSON.stringify(project, null, 2);
}

/**
 * Parses project JSON. Throws:
 *  - a native SyntaxError if the string isn't valid JSON at all;
 *  - InvalidProjectDataError if it parses but doesn't have the shape of an
 *    IndoorProject;
 *  - SchemaVersionMismatchError if the stored schemaVersion doesn't match
 *    the version this build understands — future phases can catch that and
 *    run a migration before retrying.
 */
export function deserializeProject(json: string): IndoorProject {
  const data: unknown = JSON.parse(json);
  assertValidProjectShape(data);
  if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new SchemaVersionMismatchError(data.schemaVersion, CURRENT_SCHEMA_VERSION);
  }
  // Backfill floors saved before `furniture` existed so every consumer can
  // treat Floor.furniture as always present, without bumping the schema
  // version for what is otherwise a purely additive field.
  for (const building of data.buildings) {
    for (const floor of building.floors) {
      if (floor.furniture === undefined) floor.furniture = [];
      if (floor.groups === undefined) floor.groups = [];
    }
  }
  return data;
}
