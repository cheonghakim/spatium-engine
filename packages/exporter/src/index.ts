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

import type { ExportInput, ExportResult, ExportTarget, MapExporter } from "./MapExporter.js";
import { JsonExporter } from "./JsonExporter.js";
import { VanillaJsExporter } from "./VanillaJsExporter.js";
import { VueExporter } from "./VueExporter.js";

const EXPORTERS = {
  json: new JsonExporter(),
  "vanilla-js": new VanillaJsExporter(),
  vue: new VueExporter(),
};

/** Convenience dispatcher — picks the right MapExporter by target name. */
export async function exportProject(
  target: ExportTarget,
  input: ExportInput,
): Promise<ExportResult> {
  // `target` is typed as ExportTarget here, but callers driven by external
  // input (an HTTP API, CLI arg, etc.) can't be narrowed by TypeScript, so
  // this lookup can genuinely miss at runtime — guard it explicitly rather
  // than letting an unhelpful "Cannot read properties of undefined" surface.
  const exporter = EXPORTERS[target] as MapExporter | undefined;
  if (!exporter) {
    throw new Error(`Unknown export target: "${String(target)}"`);
  }
  return exporter.export(input);
}
