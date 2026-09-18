import type { IndoorProject, ValidationIssue } from "@indoor/core";
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
  /**
   * `validateProject(input.project)` output, surfaced so callers can warn on
   * data-quality problems (e.g. disconnected floors, dangling nav edges)
   * without the exporter itself throwing — a project with issues (even
   * `error`-severity ones) is still exported; it's up to the caller to
   * decide whether to block on them.
   */
  validationIssues?: ValidationIssue[];
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
