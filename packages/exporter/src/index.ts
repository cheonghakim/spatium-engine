export type {
  MapExporter,
  ExportTarget,
  ExportInput,
  ExportedFile,
  ExportResult,
} from "./MapExporter.js";
export { JsonExporter } from "./JsonExporter.js";
export { VanillaJsExporter } from "./VanillaJsExporter.js";
export { VueExporter } from "./VueExporter.js";
export { slugify } from "./slugify.js";

import type { ExportInput, ExportResult, ExportTarget } from "./MapExporter.js";
import { JsonExporter } from "./JsonExporter.js";
import { VanillaJsExporter } from "./VanillaJsExporter.js";
import { VueExporter } from "./VueExporter.js";

const EXPORTERS = {
  json: new JsonExporter(),
  "vanilla-js": new VanillaJsExporter(),
  vue: new VueExporter(),
};

/** Convenience dispatcher — picks the right MapExporter by target name. */
export async function exportProject(target: ExportTarget, input: ExportInput): Promise<ExportResult> {
  return EXPORTERS[target].export(input);
}
