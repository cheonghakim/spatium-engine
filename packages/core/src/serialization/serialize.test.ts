import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../factories.js";
import { deserializeProject, SchemaVersionMismatchError, serializeProject } from "./serialize.js";

describe("serializeProject / deserializeProject", () => {
  it("round-trips a project through JSON", () => {
    const project = createEmptyProject("Test Mall");
    const json = serializeProject(project);
    const restored = deserializeProject(json);
    expect(restored).toEqual(project);
  });

  it("throws SchemaVersionMismatchError for an unknown schema version", () => {
    const project = { ...createEmptyProject("Old Mall"), schemaVersion: "0.0.1" };
    const json = JSON.stringify(project);
    expect(() => deserializeProject(json)).toThrow(SchemaVersionMismatchError);
  });
});
