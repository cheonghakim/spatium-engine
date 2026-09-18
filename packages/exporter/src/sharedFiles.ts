import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { serializeProject, validateProject } from "@indoor/core";
import type { ExportInput, ExportedFile } from "./MapExporter.js";
import type { ValidationIssue } from "@indoor/core";

/** map.json + config/map.config.json — shared by every runnable export target (spec §31, §34). */
export function buildDataFiles(input: ExportInput): ExportedFile[] {
  return [
    { path: "assets/map.json", contents: serializeProject(input.project) },
    { path: "config/map.config.json", contents: JSON.stringify(input.config, null, 2) },
  ];
}

/** Data-quality issues in the source project, surfaced (not enforced) on every export — see ExportResult.validationIssues. */
export function buildValidationIssues(input: ExportInput): ValidationIssue[] {
  return validateProject(input.project);
}

// packages/exporter/src/sharedFiles.ts -> packages/exporter (works both from
// src/ in dev and from dist/ once this package itself is built).
const EXPORTER_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Bundles `@indoor/builder` — and, transitively, `@indoor/core`,
 * `@indoor/runtime`, and `three` — into a single vendored ESM file so a
 * generated app doesn't need `workspace:*` deps (which don't resolve outside
 * this monorepo) to run standalone.
 *
 * Resolution note: esbuild's default conditions (no explicit `conditions`
 * option passed here) do NOT include `development`, so given each
 * package's `exports` map — `{ types, development, import, default }` —
 * esbuild skips the `development` entry (which points at raw `src/index.ts`)
 * and resolves through `import`/`default`, i.e. the real tsup-built
 * `dist/index.js`. This was verified by inspecting the bundle's esbuild
 * metafile: every `@indoor/*` input path resolved was a `dist/index.js`,
 * never a `src/index.ts`, and the output contains no TypeScript syntax
 * (no `interface`, no type annotations). No workaround (NODE_ENV, explicit
 * `conditions`, or resolving dist paths directly) was needed.
 *
 * This does mean `packages/core`, `packages/runtime`, and `packages/builder`
 * must already have a `dist/` (i.e. `pnpm build` has run) before this can
 * succeed — see the check below for a clear error if it hasn't.
 */
export async function buildVendorFiles(): Promise<ExportedFile[]> {
  for (const pkg of ["core", "runtime", "builder"]) {
    if (!existsSync(new URL(`../../${pkg}/dist/index.js`, import.meta.url))) {
      throw new Error(
        `@indoor/exporter: cannot bundle the vendor file because packages/${pkg}/dist/index.js ` +
          `is missing. Run "pnpm build" at the repo root first, then re-run the export.`,
      );
    }
  }

  const result = await build({
    stdin: {
      contents: `export { IndoorBuilder } from "@indoor/builder";\n`,
      resolveDir: EXPORTER_ROOT,
      loader: "js",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    minify: true,
    legalComments: "none",
  });

  const [bundle] = result.outputFiles;
  if (!bundle) {
    throw new Error("@indoor/exporter: esbuild produced no output while bundling the vendor file.");
  }
  return [{ path: "vendor/indoor.bundle.js", contents: bundle.text }];
}

export function buildReadme(packageName: string): string {
  return `# ${packageName}

Exported from Spatium Studio. Renders through the same @indoor/runtime
engine used by the Builder preview — what you saw there is what runs here.

## Run it

\`\`\`bash
npm install
npm run dev
\`\`\`

## Files

- \`assets/map.json\` — the map data (spaces, POIs, navigation graph, ...)
- \`config/map.config.json\` — camera/controls/event settings from the Builder
- \`src/map.js\` — creates the IndoorBuilder instance from those two files
- \`src/events.js\` — add your own event handling here (e.g. \`builder.runtime.on("poi.click", ...)\`)
- \`vendor/indoor.bundle.js\` — the Builder engine (\`@indoor/builder\` + \`@indoor/core\` +
  \`@indoor/runtime\`), pre-bundled at export time so this project has no
  unpublished \`@indoor/*\` dependencies and runs standalone with a plain
  \`npm install\`.
`;
}
