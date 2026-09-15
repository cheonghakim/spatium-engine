import { serializeProject } from "@indoor/core";
import type { ExportInput, ExportResult, ExportTarget, MapExporter } from "./MapExporter.js";

/**
 * Raw data export (spec §34): just the map and its app configuration, no
 * runnable app scaffold. Map data and app config stay separate files so the
 * same map.json can be reused across multiple app.config.json variants.
 */
export class JsonExporter implements MapExporter {
  readonly target: ExportTarget = "json";

  async export(input: ExportInput): Promise<ExportResult> {
    return {
      files: [
        { path: "map.json", contents: serializeProject(input.project) },
        { path: "app.config.json", contents: JSON.stringify(input.config, null, 2) },
      ],
    };
  }
}
