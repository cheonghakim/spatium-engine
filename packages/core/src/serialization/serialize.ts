import type { IndoorProject } from "../types/project.js";
import { CURRENT_SCHEMA_VERSION } from "./schemaVersion.js";

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

export function serializeProject(project: IndoorProject): string {
  return JSON.stringify(project, null, 2);
}

/**
 * Parses project JSON. Throws SchemaVersionMismatchError if the stored
 * schemaVersion doesn't match the version this build understands — future
 * phases can catch that and run a migration before retrying.
 */
export function deserializeProject(json: string): IndoorProject {
  const data = JSON.parse(json) as IndoorProject;
  if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new SchemaVersionMismatchError(data.schemaVersion, CURRENT_SCHEMA_VERSION);
  }
  return data;
}
