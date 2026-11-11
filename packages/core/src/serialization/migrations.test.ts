import { describe, expect, it } from "vitest";
import {
  compareSchemaVersions,
  migrateProjectData,
  SchemaVersionMismatchError,
  type ProjectMigration,
} from "./migrations.js";
import { CURRENT_SCHEMA_VERSION } from "./schemaVersion.js";
import { deserializeProject, serializeProject } from "./serialize.js";
import { createEmptyProject } from "../factories.js";

describe("compareSchemaVersions", () => {
  it("orders by major, then minor, then patch numerically", () => {
    expect(compareSchemaVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareSchemaVersions("1.0.0", "1.1.0")).toBeLessThan(0);
    expect(compareSchemaVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareSchemaVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });

  it("returns NaN for malformed versions", () => {
    expect(compareSchemaVersions("1.0", "1.0.0")).toBeNaN();
    expect(compareSchemaVersions("1.0.0", "v1.0.0")).toBeNaN();
  });
});

describe("migrateProjectData", () => {
  const chain: ProjectMigration[] = [
    { from: "1.0.0", to: "1.1.0", migrate: (d) => ({ ...d, step1: true }) },
    { from: "1.1.0", to: "2.0.0", migrate: (d) => ({ ...d, step2: d.step1 === true }) },
  ];

  it("returns data at the target version untouched", () => {
    const data = { schemaVersion: "2.0.0", keep: 1 };
    expect(migrateProjectData(data, chain, "2.0.0")).toBe(data);
  });

  it("applies each step in order and stamps the final version", () => {
    const result = migrateProjectData({ schemaVersion: "1.0.0" }, chain, "2.0.0");
    expect(result).toEqual({ schemaVersion: "2.0.0", step1: true, step2: true });
  });

  it("stops at an intermediate target", () => {
    const result = migrateProjectData({ schemaVersion: "1.0.0" }, chain, "1.1.0");
    expect(result).toEqual({ schemaVersion: "1.1.0", step1: true });
  });

  it("does not mutate the input", () => {
    const input = { schemaVersion: "1.0.0", nested: { a: 1 } };
    const chainMutating: ProjectMigration[] = [
      {
        from: "1.0.0",
        to: "1.1.0",
        migrate: (d) => {
          (d.nested as { a: number }).a = 2;
          return d;
        },
      },
    ];
    migrateProjectData(input, chainMutating, "1.1.0");
    expect(input.nested.a).toBe(1);
  });

  it("refuses data from a newer schema", () => {
    expect(() => migrateProjectData({ schemaVersion: "3.0.0" }, chain, "2.0.0")).toThrow(
      SchemaVersionMismatchError,
    );
  });

  it("refuses an older version with no migration path", () => {
    expect(() => migrateProjectData({ schemaVersion: "0.9.0" }, chain, "2.0.0")).toThrow(
      SchemaVersionMismatchError,
    );
  });

  it("refuses a malformed version", () => {
    expect(() => migrateProjectData({ schemaVersion: "latest" }, chain, "2.0.0")).toThrow(
      SchemaVersionMismatchError,
    );
  });

  it("does not loop forever on a cyclic or backwards registry", () => {
    const cyclic: ProjectMigration[] = [
      { from: "1.0.0", to: "1.1.0", migrate: (d) => d },
      { from: "1.1.0", to: "1.0.0", migrate: (d) => d },
    ];
    expect(() => migrateProjectData({ schemaVersion: "1.0.0" }, cyclic, "2.0.0")).toThrow(
      SchemaVersionMismatchError,
    );
  });

  it("refuses a chain that overshoots the target", () => {
    const overshoot: ProjectMigration[] = [{ from: "1.0.0", to: "3.0.0", migrate: (d) => d }];
    expect(() => migrateProjectData({ schemaVersion: "1.0.0" }, overshoot, "2.0.0")).toThrow(
      SchemaVersionMismatchError,
    );
  });
});

describe("deserializeProject version handling", () => {
  it("loads a current-version project", () => {
    const project = createEmptyProject("P");
    expect(deserializeProject(serializeProject(project)).schemaVersion).toBe(
      CURRENT_SCHEMA_VERSION,
    );
  });

  it("refuses a project saved by a newer build", () => {
    const project = { ...createEmptyProject("P"), schemaVersion: "99.0.0" };
    expect(() => deserializeProject(JSON.stringify(project))).toThrow(SchemaVersionMismatchError);
  });
});
