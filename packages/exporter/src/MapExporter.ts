import type { IndoorProject } from "@indoor/core";
import type { BuilderConfig } from "@indoor/builder";

export type ExportTarget = "vanilla-js" | "vue" | "json";

export interface ExportInput {
  project: IndoorProject;
  config: BuilderConfig;
}

export interface ExportedFile {
  path: string;
  contents: string;
}

export interface ExportResult {
  files: ExportedFile[];
}

/**
 * Packages a Builder config + project into a runnable project (spec §30-31).
 * Every target must render through the same @indoor/runtime the Builder
 * preview used, so "what you saw in preview" and "what got exported" match.
 */
export interface MapExporter {
  readonly target: ExportTarget;
  export(input: ExportInput): Promise<ExportResult>;
}
