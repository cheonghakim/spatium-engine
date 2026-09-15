import type { ExportInput, ExportedFile, ExportResult, ExportTarget, MapExporter } from "./MapExporter.js";
import { buildDataFiles, buildReadme } from "./sharedFiles.js";
import { slugify } from "./slugify.js";

/**
 * Plain HTML + JS + Vite export target (spec §30-31) — no framework. The
 * generated src/map.js constructs a real @indoor/builder IndoorBuilder, the
 * same class Studio's preview runs, from the exported map.json/map.config.json.
 */
export class VanillaJsExporter implements MapExporter {
  readonly target: ExportTarget = "vanilla-js";

  async export(input: ExportInput): Promise<ExportResult> {
    const name = slugify(input.project.name);
    const files: ExportedFile[] = [
      ...buildDataFiles(input),
      { path: "index.html", contents: buildIndexHtml(input.project.name) },
      { path: "package.json", contents: buildPackageJson(name) },
      { path: "vite.config.js", contents: "export default {};\n" },
      { path: "src/map.js", contents: MAP_JS },
      { path: "src/events.js", contents: EVENTS_JS },
      { path: "src/main.js", contents: MAIN_JS },
      { path: "README.md", contents: buildReadme(name) },
    ];
    return { files };
  }
}

function buildIndexHtml(projectName: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(projectName)}</title>
    <style>
      html, body, #map { margin: 0; height: 100%; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`;
}

function buildPackageJson(name: string): string {
  return (
    JSON.stringify(
      {
        name,
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
        dependencies: {
          "@indoor/core": "workspace:*",
          "@indoor/runtime": "workspace:*",
          "@indoor/builder": "workspace:*",
        },
        devDependencies: { vite: "^5.4.0" },
      },
      null,
      2,
    ) + "\n"
  );
}

const MAP_JS = `import { IndoorBuilder } from "@indoor/builder";
import project from "../assets/map.json";
import config from "../config/map.config.json";

export function createIndoorMap(containerSelector) {
  return new IndoorBuilder({ container: containerSelector, project, config });
}
`;

const EVENTS_JS = `// Customize event handling here, e.g.:
// builder.runtime.on("poi.click", ({ poi }) => console.log(poi));
export function registerEvents(builder) {
  void builder;
}
`;

const MAIN_JS = `import { createIndoorMap } from "./map.js";
import { registerEvents } from "./events.js";

const builder = createIndoorMap("#map");
registerEvents(builder);
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export { escapeHtml };
