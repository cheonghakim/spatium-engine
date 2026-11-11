export { CURRENT_SCHEMA_VERSION } from "./schemaVersion.js";
export {
  serializeProject,
  deserializeProject,
  SchemaVersionMismatchError,
  InvalidProjectDataError,
} from "./serialize.js";
export { migrateProjectData, compareSchemaVersions, MIGRATIONS } from "./migrations.js";
export type { ProjectMigration, RawProjectData } from "./migrations.js";
export { projectToGeoJSON } from "./geojson.js";
export type {
  GeoJSONCoordinateMode,
  GeoJSONExportOptions,
  GeoJSONFeature,
  GeoJSONFeatureCollection,
  GeoJSONPosition,
} from "./geojson.js";
