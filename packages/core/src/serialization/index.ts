export { CURRENT_SCHEMA_VERSION } from "./schemaVersion.js";
export {
  serializeProject,
  deserializeProject,
  SchemaVersionMismatchError,
  InvalidProjectDataError,
} from "./serialize.js";
export { projectToGeoJSON } from "./geojson.js";
export type { GeoJSONFeature, GeoJSONFeatureCollection, GeoJSONPosition } from "./geojson.js";
