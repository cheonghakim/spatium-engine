import { serializeProject } from "@indoor/core";
import type { ExportInput, ExportedFile } from "./MapExporter.js";

/** map.json + config/map.config.json — shared by every runnable export target (spec §31, §34). */
export function buildDataFiles(input: ExportInput): ExportedFile[] {
  return [
    { path: "assets/map.json", contents: serializeProject(input.project) },
    { path: "config/map.config.json", contents: JSON.stringify(input.config, null, 2) },
  ];
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

## Note on dependencies

This export uses \`workspace:*\` for \`@indoor/core\`, \`@indoor/runtime\`, and
\`@indoor/builder\`, since those packages aren't published to npm yet. To run
this project standalone outside the Spatium Studio monorepo, replace those
with published version numbers once available, or vendor the built packages
directly.
`;
}
