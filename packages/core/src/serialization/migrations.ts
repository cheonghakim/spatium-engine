import { CURRENT_SCHEMA_VERSION } from "./schemaVersion.js";

/**
 * Thrown when stored project data can't be brought to the schema version this
 * build understands — either it's from a *newer* build (unknown fields would be
 * silently dropped, so it's refused rather than guessed at), or it's an older
 * version with no registered migration path.
 */
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

/** Raw, not-yet-validated project JSON. Migrations run before shape validation. */
export type RawProjectData = Record<string, unknown>;

/**
 * One step in the upgrade chain. `migrate` receives data at `from` and must
 * return data at `to`; it doesn't need to set `schemaVersion` itself — the
 * runner stamps `to` after each step.
 */
export interface ProjectMigration {
  from: string;
  to: string;
  migrate: (data: RawProjectData) => RawProjectData;
}

/**
 * Registered upgrade steps, oldest first. When bumping CURRENT_SCHEMA_VERSION,
 * add the previous → new step here and a fixture of the previous version to
 * the tests (see docs/design/0001-data-model-v1.1.md §1).
 */
export const MIGRATIONS: readonly ProjectMigration[] = [
  // 1.1.0 only adds optional fields (site, building placement/footprint/
  // connectors, space holes, localized names, externalId, edge oneWay), so
  // 1.0.0 data is already valid 1.1.0 data — only the version stamp changes.
  { from: "1.0.0", to: "1.1.0", migrate: (data) => data },
];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(version: string): [number, number, number] | null {
  const match = SEMVER.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Orders two "major.minor.patch" schema versions: negative if a < b, 0 if
 * equal, positive if a > b. Returns NaN if either isn't a valid version, so
 * callers can't mistake garbage for "equal".
 */
export function compareSchemaVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return Number.NaN;
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] as number) - (pb[i] as number);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Walks `data` from its stored schemaVersion up to `targetVersion` through
 * `migrations`. Data already at the target is returned as-is. Throws
 * SchemaVersionMismatchError for newer-than-target data, unparseable
 * versions, or a gap in the chain. Each step gets its own deep copy so a
 * migration that throws midway never leaves the caller's object half-mutated.
 */
export function migrateProjectData(
  data: RawProjectData & { schemaVersion: string },
  migrations: readonly ProjectMigration[] = MIGRATIONS,
  targetVersion: string = CURRENT_SCHEMA_VERSION,
): RawProjectData & { schemaVersion: string } {
  const startVersion = data.schemaVersion;
  const order = compareSchemaVersions(startVersion, targetVersion);
  if (order === 0) return data;
  if (Number.isNaN(order) || order > 0) {
    throw new SchemaVersionMismatchError(startVersion, targetVersion);
  }

  let current: RawProjectData = structuredClone(data);
  let version = startVersion;
  // Bounded by the registry size so a cyclic registry can't loop forever.
  for (let steps = 0; steps <= migrations.length; steps++) {
    if (version === targetVersion) {
      return { ...current, schemaVersion: version };
    }
    const step = migrations.find((m) => m.from === version);
    if (!step || compareSchemaVersions(step.to, version) <= 0) break;
    if (compareSchemaVersions(step.to, targetVersion) > 0) break;
    current = { ...step.migrate(current), schemaVersion: step.to };
    version = step.to;
  }
  throw new SchemaVersionMismatchError(startVersion, targetVersion);
}
